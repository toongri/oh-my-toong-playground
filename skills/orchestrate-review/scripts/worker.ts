#!/usr/bin/env bun

import fs from "fs";
import path from "path";

import { initLogger, logInfo, logError, logStart, logEnd } from "@lib/logging";
import { exitWithError, parseArgs, logRootForJobsDir } from "@lib/job-utils";
import { getOmtDir } from "@lib/omt-dir";
import { splitCommand, atomicWriteJson, runOneTurn, reapOwnProcessGroup } from "@lib/worker-utils";
import { detectCliType } from "@lib/generic-job";
import type { CliType } from "@lib/agent-drivers/types";

const PROMPTS_DIR = path.resolve(import.meta.dirname, "prompts");

/**
 * Per-angle allowlist of the conditional sections in chunk-reviewer-prompt.md
 * (spec: orchestrate-review-4angle-redesign.md §2.3). The 4 common sections — Review
 * Premises, Review Scope, What Was Implemented, Diff Command — carry no marker and
 * always pass through; `project_context` is never listed for any angle.
 */
const ANGLE_SECTION_ALLOWLIST: Record<string, string[]> = {
	correctness: [],
	regression: ["commit_history"],
	cleanup: ["non_goal"],
	requirement: ["requirements", "non_goal", "commit_history"],
};

/**
 * Both markers are anchored to start (`^`) and end (`$`) of their own line (`m` flag) since a
 * real marker always sits alone on its line — this rejects an inline reproduction of the
 * closing-marker string inside an interpolated placeholder value that would otherwise
 * truncate the lazy body match early. Remaining gap: a reproduction that lands alone on its
 * own line (nothing else on it) still reads as a genuine boundary and truncates early.
 */
const SECTION_MARKER_RE = /^<!-- section:([a-z_]+) -->$\n([\s\S]*?)^<!-- \/section:\1 -->$\n?/gm;
const OPEN_MARKER_RE = /^<!-- section:([a-z_]+) -->$/gm;
const CLOSE_MARKER_RE = /^<!-- \/section:([a-z_]+) -->$/gm;

/**
 * The complete, exact set of conditional section names chunk-reviewer-prompt.md declares.
 * Every one is always interpolated with real content or a backfill sentinel (never omitted) per
 * code-review/SKILL.md Step 4 (Agent Dispatch), so a legitimate prompt.txt always carries exactly
 * this set — verified against the template itself by worker.test.ts.
 */
export const KNOWN_SECTION_NAMES = new Set([
	"requirements",
	"project_context",
	"non_goal",
	"commit_history",
	"field_reference",
]);

/**
 * Filtering is only safe when the discovered marker names are EXACTLY KNOWN_SECTION_NAMES —
 * neither a stray unknown name nor a known name missing — and each has exactly one
 * standalone-line open marker and one standalone-line close marker. Any deviation means an
 * interpolated value forged or corrupted a marker-shaped line, and a forged marker is safer
 * left unfiltered than silently mis-filtered.
 */
function hasBalancedMarkers(promptContent: string): boolean {
	const opens = new Map<string, number>();
	const closes = new Map<string, number>();
	for (const m of promptContent.matchAll(OPEN_MARKER_RE)) opens.set(m[1], (opens.get(m[1]) ?? 0) + 1);
	for (const m of promptContent.matchAll(CLOSE_MARKER_RE)) closes.set(m[1], (closes.get(m[1]) ?? 0) + 1);
	const names = new Set([...opens.keys(), ...closes.keys()]);
	if (names.size !== KNOWN_SECTION_NAMES.size) return false;
	for (const name of names) {
		if (!KNOWN_SECTION_NAMES.has(name)) return false;
		if (opens.get(name) !== 1 || closes.get(name) !== 1) return false;
	}
	return true;
}

/**
 * Strip the conditional sections a given angle's allowlist doesn't cover, then remove every
 * section marker from what remains — a marker left in the final prompt is noise the finder
 * could misread as an instruction.
 *
 * Unknown member (an angle name absent from ANGLE_SECTION_ALLOWLIST): fails OPEN, passing
 * every section through rather than killing the job, logged via logError so the drift is
 * visible in this job's own worker log.
 */
export function filterPromptSections(promptContent: string, member: string): string {
	// Forged marker count (open/close != 1 for some name) → skip filtering entirely rather than risk truncating on the fake boundary.
	if (!hasBalancedMarkers(promptContent)) return promptContent;

	const allowlist = ANGLE_SECTION_ALLOWLIST[member];
	if (!allowlist) {
		logError(
			`filterPromptSections: unknown member "${member}" — passing all sections through unfiltered`,
		);
		return promptContent.replace(SECTION_MARKER_RE, (_match, _name: string, body: string) => body);
	}
	return promptContent.replace(SECTION_MARKER_RE, (_match, name: string, body: string) =>
		allowlist.includes(name) ? body : "",
	);
}

/** Type-predicate over CliType's members — narrows detectCliType's `string` return without an `as` assertion. */
function isCliType(value: string): value is CliType {
	return (
		value === "opencode" ||
		value === "claude" ||
		value === "codex" ||
		value === "gemini" ||
		value === "unknown"
	);
}

/**
 * Parses caller-provided worker environment values while pinning the role for every
 * orchestrate-review finder process. This object is passed unchanged through both
 * initial and resumed driver commands, then persisted in status.json for resume.
 */
export function buildWorkerEnv(rawArgs: string[]): Record<string, string> {
	const workerEnv: Record<string, string> = {};
	for (let i = 0; i < rawArgs.length; i++) {
		if (rawArgs[i] === "--env" && i + 1 < rawArgs.length) {
			const eqIdx = rawArgs[i + 1].indexOf("=");
			if (eqIdx > 0) {
				workerEnv[rawArgs[i + 1].slice(0, eqIdx)] = rawArgs[i + 1].slice(eqIdx + 1);
			}
			i++;
		}
	}

	workerEnv.OMT_REVIEW_ROLE = "member";
	return workerEnv;
}

function main() {
	const options = parseArgs(process.argv);
	const jobDir = options["job-dir"];
	const member = options.member;
	const command = options.command;
	const timeoutSec = options.timeout ? Number(options.timeout) : 0;

	const resolvedJobDir = jobDir ? path.resolve(String(jobDir)) : null;
	const jobId = resolvedJobDir ? path.basename(resolvedJobDir).replace(/^chunk-review-/, "") : "unknown";
	const logRoot = resolvedJobDir ? logRootForJobsDir(path.dirname(resolvedJobDir)) : getOmtDir();
	initLogger("chunk-review-worker", logRoot, jobId);
	logStart();

	const workerEnv = buildWorkerEnv(process.argv.slice(2));

	if (typeof jobDir !== "string" || !jobDir) {
		logError("missing --job-dir");
		logEnd();
		exitWithError("worker: missing --job-dir");
	}
	if (typeof member !== "string" || !member) {
		logError("missing --member");
		logEnd();
		exitWithError("worker: missing --member");
	}
	if (typeof command !== "string" || !command) {
		logError("missing --command");
		logEnd();
		exitWithError("worker: missing --command");
	}

	logInfo(`worker start: member=${member} command=${command} timeout=${timeoutSec}`);

	const membersRoot = path.join(jobDir, "members");
	const memberDir = path.join(membersRoot, member);

	const promptPath = path.join(jobDir, "prompt.txt");
	const rawPromptContent = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
	const promptContent = filterPromptSections(rawPromptContent, member);

	const EXECUTION_INSTRUCTION =
		"Execute the diff command from REVIEW CONTENT. Review ONLY the files listed in Review Scope. Produce your full analysis following system instructions.";

	const tokens = splitCommand(command);
	if (!tokens || tokens.length === 0) {
		logError(`invalid command string: ${command}`);
		const statusPath = path.join(memberDir, "status.json");
		atomicWriteJson(statusPath, {
			member,
			state: "error",
			message: "Invalid command string",
			finishedAt: new Date().toISOString(),
			command,
		});
		logEnd();
		process.exit(1);
	}

	const program = tokens[0];
	const args = tokens.slice(1);

	const detectedCliType = detectCliType(command);
	const cliType: CliType = isCliType(detectedCliType) ? detectedCliType : "unknown";

	runOneTurn({
		program,
		args,
		prompt: EXECUTION_INSTRUCTION,
		reviewContent: promptContent,
		member,
		memberDir,
		command,
		timeoutSec,
		workerEnv,
		cliType,
		promptsDir: PROMPTS_DIR,
	}).then(async (result) => {
		logInfo(`worker done: member=${member} state=${result.state} exitCode=${result.exitCode}`);
		logEnd();
		// Must run AFTER logging: the group SIGKILL this sends also terminates this
		// worker itself (it is the group leader), so nothing after this call is
		// guaranteed to run — see reapOwnProcessGroup's own doc comment.
		await reapOwnProcessGroup();
		process.exit(result.state === "done" ? 0 : 1);
	});
}

if (import.meta.main) {
	main();
}

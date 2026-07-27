#!/usr/bin/env bun

import fs from "fs";
import path from "path";

import { initLogger, logInfo, logError, logStart, logEnd } from "@lib/logging";
import { exitWithError, parseArgs } from "@lib/job-utils";
import { getOmtDir } from "@lib/omt-dir";
import { splitCommand, atomicWriteJson, runOneTurn } from "@lib/worker-utils";
import { detectCliType } from "@lib/generic-job";
import type { CliType } from "@lib/agent-drivers/types";

const PROMPTS_DIR = path.resolve(import.meta.dirname, "prompts");

/**
 * Per-angle allowlist of the conditional sections in chunk-reviewer-prompt.md
 * (spec: orchestrate-review-4angle-redesign.md §2.3). The 4 common sections — Review
 * Premises, Review Scope, What Was Implemented, Diff Command — carry no marker at all
 * and always pass through, since "no marker on the common sections" is the simpler shape:
 * the filter only ever has to act on marked sections absent from this list.
 * `project_context` is never listed for any angle — it is dropped for all four.
 */
const ANGLE_SECTION_ALLOWLIST: Record<string, string[]> = {
	correctness: [],
	regression: ["commit_history"],
	cleanup: ["non_goal"],
	requirement: ["requirements", "non_goal", "evidence_results", "commit_history"],
};

const SECTION_MARKER_RE = /<!-- section:([a-z_]+) -->\n?([\s\S]*?)<!-- \/section:\1 -->\n?/g;

/**
 * Strip the conditional sections a given angle's allowlist doesn't cover, then remove every
 * section marker from what remains — a marker left in the final prompt is noise the finder
 * could misread as an instruction, so markers never survive regardless of member.
 *
 * Unknown member (an angle name absent from ANGLE_SECTION_ALLOWLIST, e.g.
 * orchestrate-review.config.yaml grows a 5th angle before this map is updated): fail OPEN,
 * not closed. Passing every section through only costs extra tokens; failing closed would
 * kill that angle's job outright the moment the config changes, with no bypass/ask path in
 * this worker to recover from a false deny. Logged via logError (not silent) so the drift is
 * visible in this job's own worker log — this pursuit has already seen a silent fallback here
 * hide a broken measurement window behind an otherwise-green test suite.
 */
export function filterPromptSections(promptContent: string, member: string): string {
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

function main() {
	const options = parseArgs(process.argv);
	const jobDir = options["job-dir"];
	const member = options.member;
	const command = options.command;
	const timeoutSec = options.timeout ? Number(options.timeout) : 0;

	const jobId = jobDir ? path.basename(String(jobDir)).replace(/^chunk-review-/, "") : "unknown";
	initLogger("chunk-review-worker", getOmtDir(), jobId);
	logStart();

	const workerEnv: Record<string, string> = {};
	const rawArgs = process.argv.slice(2);
	for (let i = 0; i < rawArgs.length; i++) {
		if (rawArgs[i] === "--env" && i + 1 < rawArgs.length) {
			const eqIdx = rawArgs[i + 1].indexOf("=");
			if (eqIdx > 0) {
				workerEnv[rawArgs[i + 1].slice(0, eqIdx)] = rawArgs[i + 1].slice(eqIdx + 1);
			}
			i++;
		}
	}

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
	}).then((result) => {
		logInfo(`worker done: member=${member} state=${result.state} exitCode=${result.exitCode}`);
		logEnd();
		process.exit(result.state === "done" ? 0 : 1);
	});
}

if (import.meta.main) {
	main();
}

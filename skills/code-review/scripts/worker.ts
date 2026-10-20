#!/usr/bin/env bun

import fs from "fs";
import path from "path";

import { initLogger, logInfo, logError, logStart, logEnd } from "@lib/logging";
import { exitWithError, parseArgs, logRootForJobsDir } from "@lib/job-utils";
import { getOmtDir } from "@lib/omt-dir";
import {
	splitCommand,
	assemblePrompt,
	atomicWriteJson,
	runOneTurn,
	resumeOneTurn,
	reapOwnProcessGroup,
	type OneTurnResult,
	type CompletionGateResult,
} from "@lib/worker-utils";
import {
	detectCliType,
	recordCoverageResumeBaseline,
	type CoverageHooks,
	type CoverageProgress,
} from "@lib/generic-job";
import type { CliType } from "@lib/agent-drivers/types";
import { run as runDiffCursor, loadPlan, LEDGER_ENV } from "./diff-cursor";

const PROMPTS_DIR = path.resolve(import.meta.dirname, "prompts");
export const DIFF_CURSOR_PATH = path.resolve(import.meta.dirname, "diff-cursor.ts");

/**
 * Per-angle allowlist of the conditional sections in chunk-reviewer-prompt.md
 * (spec: orchestrate-review-4angle-redesign.md §2.3). The 4 common sections — Review
 * Premises, Review Scope, What Was Implemented, Diff Coverage Protocol — carry no marker and
 * always pass through; `project_context` is shared by every angle so finders can judge
 * whether a candidate is reachable in the reviewed system.
 */
const ANGLE_SECTION_ALLOWLIST: Record<string, string[]> = {
	correctness: ["project_context", "non_goal"],
	regression: ["project_context", "non_goal", "commit_history"],
	cleanup: ["project_context", "non_goal"],
	requirement: ["project_context", "requirements", "non_goal", "commit_history"],
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
 * Parses caller-provided worker environment values. This object is passed unchanged through both
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

	return workerEnv;
}

// ---------------------------------------------------------------------------
// Diff cursor coverage (job.json `coverage`, written by `job.ts start --ledger-root`)
// ---------------------------------------------------------------------------

export interface JobCoverage {
	ledgerRoot: string;
	planDir: string;
	planSha: string;
}

/** job.json `coverage`, or null for a job started without --ledger-root. */
export function readJobCoverage(jobDir: string): JobCoverage | null {
	let meta: unknown;
	try {
		meta = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));
	} catch {
		return null;
	}
	if (typeof meta !== "object" || meta === null || !("coverage" in meta)) return null;
	const c: unknown = meta.coverage;
	if (typeof c !== "object" || c === null) return null;
	if (!("ledgerRoot" in c) || !("planDir" in c) || !("planSha" in c)) return null;
	const { ledgerRoot, planDir, planSha } = c;
	if (typeof ledgerRoot !== "string" || typeof planDir !== "string" || typeof planSha !== "string")
		return null;
	return { ledgerRoot, planDir, planSha };
}

export function memberLedgerDir(coverage: JobCoverage, member: string): string {
	return path.join(coverage.ledgerRoot, "ledgers", member);
}

/** Double-quoted shell word: `\`, `"`, `$` and backtick are escaped, so any path stays one literal argument. */
function shellQuote(value: string): string {
	return `"${value.replace(/[\\"$`]/g, "\\$&")}"`;
}

/**
 * The copy-ready command prefix that replaces `{CURSOR}` in the finder prompt. Absolute bun and
 * script paths, so the finder's PATH does not matter.
 */
export function cursorCommand(ledgerDir: string): string {
	return `${shellQuote(process.execPath)} ${shellQuote(DIFF_CURSOR_PATH)} --ledger ${shellQuote(ledgerDir)}`;
}

/** Runs one cursor command in-process against a ledger; throws on a non-zero exit. */
function runCursor(ledgerDir: string, args: string[]): string {
	const r = runDiffCursor([...args, "--ledger", ledgerDir]);
	if (r.code !== 0) throw new Error(`diff-cursor ${args[0]} exited ${r.code}: ${r.stderr.trim()}`);
	return r.stdout;
}

/** Throws when `<planDir>/plan.json` no longer carries the planSha job.json recorded at start. */
function assertPlanUnchanged(coverage: JobCoverage): void {
	const current = loadPlan(coverage.planDir).planSha;
	if (current !== coverage.planSha)
		throw new Error(
			`plan changed since job start: job.json planSha ${coverage.planSha}, ${path.join(coverage.planDir, "plan.json")} planSha ${current}; start a new job for the new plan`,
		);
}

/** Creates the member's ledger (idempotent), refusing a plan that changed since job start. */
export function initMemberLedger(coverage: JobCoverage, member: string): string {
	assertPlanUnchanged(coverage);
	return runCursor(memberLedgerDir(coverage, member), [
		"init",
		"--plan",
		coverage.planDir,
		"--angle",
		member,
	]);
}

function numberField(record: Record<string, unknown>, key: string): number {
	const v = record[key];
	if (typeof v !== "number") throw new Error(`diff-cursor status: ${key} is not a number`);
	return v;
}

/** Coverage counts plus the issued-but-not-done page and its size, read from the member's ledger. */
export function readCoverageProgress(ledgerDir: string): CoverageProgress {
	const statusJson: unknown = JSON.parse(runCursor(ledgerDir, ["status", "--json"]));
	if (typeof statusJson !== "object" || statusJson === null || Array.isArray(statusJson))
		throw new Error("diff-cursor status: not a JSON object");
	const status: Record<string, unknown> = { ...statusJson };
	const pagesAcked = numberField(status, "pagesAcked");
	const pagesTotal = numberField(status, "pagesTotal");
	const finished = status.finished === true;
	const currentPage = typeof status.currentPage === "string" ? status.currentPage : null;

	const ledger = JSON.parse(fs.readFileSync(path.join(ledgerDir, "ledger.json"), "utf8"));
	let lastProgressAt: number | null = null;
	const progressStamps = [
		...Object.values<{ doneAt?: unknown }>(ledger?.pages ?? {}).map((page) => page?.doneAt),
		ledger?.finishedAt,
	];
	for (const stamp of progressStamps) {
		const at = typeof stamp === "string" ? Date.parse(stamp) : NaN;
		if (Number.isFinite(at) && (lastProgressAt === null || at > lastProgressAt)) lastProgressAt = at;
	}

	let issuedPage: CoverageProgress["issuedPage"] = null;
	if (currentPage !== null) {
		if (ledger?.pages?.[currentPage]?.state === "issued") {
			const extraBytes = ledger.extraPages?.[currentPage]?.bytes;
			const bytes =
				typeof extraBytes === "number"
					? extraBytes
					: loadPlan(String(ledger.planDir)).pages.find((p) => p.id === currentPage)?.bytes;
			if (typeof bytes === "number") issuedPage = { id: currentPage, bytes };
		}
	}
	return { pagesAcked, pagesTotal, finished, issuedPage, lastProgressAt };
}

/**
 * A turn is complete only when the member's ledger is finished (100% of pages, finish run). A plan
 * that changed since job start can never complete: the gate reports it fatal, so the turn is error.
 */
export function coverageCompletionGate(coverage: JobCoverage, member: string): () => CompletionGateResult {
	return () => {
		try {
			assertPlanUnchanged(coverage);
		} catch (error: unknown) {
			return { complete: false, fatal: true, message: error instanceof Error ? error.message : String(error) };
		}
		const p = readCoverageProgress(memberLedgerDir(coverage, member));
		const detail = { pagesAcked: p.pagesAcked, pagesTotal: p.pagesTotal, finished: p.finished };
		if (p.finished) return { complete: true, detail };
		return {
			complete: false,
			detail,
			message: `coverage incomplete: ${p.pagesAcked}/${p.pagesTotal} pages acknowledged, ledger not finished; resume the member to continue from the ledger`,
		};
	};
}

/** Cursor probes for lib/generic-job's coverage-gated resume policy. */
export function coverageHooks(coverage: JobCoverage): CoverageHooks {
	return {
		// A changed plan throws here, so the resume policy stalls the member with that reason.
		readProgress: (member) => {
			assertPlanUnchanged(coverage);
			return readCoverageProgress(memberLedgerDir(coverage, member));
		},
		resplit: (member, pageId, pageBytes) => {
			const r = runDiffCursor([
				"resplit",
				pageId,
				"--page-bytes",
				String(pageBytes),
				"--ledger",
				memberLedgerDir(coverage, member),
			]);
			return { ok: r.code === 0, message: r.code === 0 ? r.stdout : r.stderr };
		},
	};
}

const CURSOR_WALK_STEPS = [
	"Read the diff ONLY through the diff cursor. Never read it any other way: no git diff, git show or git log -p, and no opening of the plan's patch or page files.",
	"Never set max_output_tokens or yield_time_ms on the shell tool, and never lower its output limit in any other way: a page that is cut short fails its ack.",
	"1. Run `{CURSOR} resume` to see where the walk stands.",
	'2. Run `{CURSOR} next` to get the current page. After you review it, run `{CURSOR} done <pageId> --ack <code> --note "<note>" --next`, which prints the next page. Repeat until the cursor prints ALL PAGES DONE. Record each candidate with `{CURSOR} candidate add ...` as soon as you find it.',
	"3. Run `{CURSOR} finish`. If it refuses, do what it lists and run it again.",
	"4. Your final message restates the candidates that `{CURSOR} export` prints.",
].join("\n");

export const COVERAGE_EXECUTION_INSTRUCTION = `${CURSOR_WALK_STEPS}\nReview ONLY the files listed in Review Scope. Produce your full analysis following system instructions.`;

export const COVERAGE_RESUME_INSTRUCTION = `Your previous turn ended before your diff cursor ledger was finished. Continue the walk from the ledger.\n${CURSOR_WALK_STEPS}`;

const CURSOR_PLACEHOLDER = "{CURSOR}";

/**
 * The stdin prompt a turn would send, assembled the way runOnce assembles it (role file + review
 * content when promptsDir is given, then the literal substitutions).
 */
function assembleTurnPrompt(turn: {
	prompt: string;
	member: string;
	reviewContent?: string;
	promptsDir?: string;
	substitutions?: Record<string, string>;
}): string {
	let text = turn.promptsDir
		? assemblePrompt({
				promptsDir: turn.promptsDir,
				entityName: turn.member,
				rawPrompt: turn.prompt,
				reviewContent: turn.reviewContent,
			}).assembled
		: turn.prompt;
	for (const [placeholder, value] of Object.entries(turn.substitutions ?? {}))
		text = text.split(placeholder).join(value);
	return text;
}

async function main() {
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

	const coverage = readJobCoverage(jobDir);
	const ledgerDir = coverage ? memberLedgerDir(coverage, member) : null;
	if (ledgerDir) {
		// OMT_LEDGER_WORKER stops the session-ledger PreCompact hook from spawning a summarizer
		// inside the finder; the cursor ledger already carries the finder's state.
		workerEnv.OMT_LEDGER_WORKER = "1";
		workerEnv[LEDGER_ENV] = ledgerDir;
	}

	const membersRoot = path.join(jobDir, "members");
	const memberDir = path.join(membersRoot, member);

	const promptPath = path.join(jobDir, "prompt.txt");
	const rawPromptContent = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
	const promptContent = filterPromptSections(rawPromptContent, member);

	const EXECUTION_INSTRUCTION = coverage
		? COVERAGE_EXECUTION_INSTRUCTION
		: "Execute the diff command from REVIEW CONTENT. Review ONLY the files listed in Review Scope. Produce your full analysis following system instructions.";
	const promptSubstitutions = ledgerDir ? { [CURSOR_PLACEHOLDER]: cursorCommand(ledgerDir) } : undefined;
	const completionGate = coverage ? coverageCompletionGate(coverage, member) : undefined;

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

	// Resume mode: --session + --prompt together (spawned by cmdResumeMember's detached-worker
	// dispatch, lib/generic-job.ts) select resumeOneTurn over the initial-turn runOneTurn below.
	// promptsDir/reviewContent are deliberately NOT forwarded here — session-preserving CLIs
	// (claude --resume, opencode session resume, codex exec resume) retain persona + review
	// content server-side, making assemblePrompt re-injection redundant on resume (see
	// cmdResumeMember's own comment in lib/generic-job.ts).
	const session = options.session;
	const resumePrompt = options.prompt;
	const isResume =
		typeof session === "string" && session !== "" && typeof resumePrompt === "string" && resumePrompt !== "";
	const resumeTurnPrompt =
		coverage && typeof resumePrompt === "string"
			? `${COVERAGE_RESUME_INSTRUCTION}\n\nConductor note: ${resumePrompt}`
			: resumePrompt;

	// The finder prompts read the diff only through `{CURSOR}`. A literal one left in the prompt
	// (a job started without --ledger-root) would let the finder end `done` without reading it.
	const turnPrompt = isResume
		? assembleTurnPrompt({ prompt: String(resumeTurnPrompt), member, substitutions: promptSubstitutions })
		: assembleTurnPrompt({
				prompt: EXECUTION_INSTRUCTION,
				member,
				reviewContent: promptContent,
				promptsDir: PROMPTS_DIR,
				substitutions: promptSubstitutions,
			});
	if (turnPrompt.includes(CURSOR_PLACEHOLDER)) {
		const message = `turn not run: the prompt still contains a literal ${CURSOR_PLACEHOLDER} because this job has no diff cursor ledger (job.json has no coverage); start the job with job.ts start --ledger-root <dir>`;
		logError(message);
		atomicWriteJson(path.join(memberDir, "status.json"), {
			member,
			state: "error",
			message,
			finishedAt: new Date().toISOString(),
			command,
		});
		logEnd();
		process.exit(1);
	}

	if (coverage && ledgerDir && !isResume) {
		try {
			logInfo(initMemberLedger(coverage, member).trim());
			recordCoverageResumeBaseline(memberDir, readCoverageProgress(ledgerDir).pagesAcked);
		} catch (error: unknown) {
			const message = `coverage ledger init failed: ${error instanceof Error ? error.message : String(error)}`;
			logError(message);
			atomicWriteJson(path.join(memberDir, "status.json"), {
				member,
				state: "error",
				message,
				finishedAt: new Date().toISOString(),
				command,
			});
			logEnd();
			process.exit(1);
		}
	}

	// runOneTurn/resumeOneTurn own the machine-wide slot for the complete turn.
	// Keeping acquisition at that shared boundary ensures every worker family is
	// capped and code-review does not double-acquire the same slot.
	const turnPromise =
		isResume && typeof session === "string" && typeof resumePrompt === "string"
			? resumeOneTurn(session, {
					program,
					args,
					prompt: String(resumeTurnPrompt),
					member,
					memberDir,
					command,
					timeoutSec,
					workerEnv,
					cliType,
					promptSubstitutions,
					completionGate,
				})
			: runOneTurn({
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
					promptSubstitutions,
					completionGate,
				});
	const result: OneTurnResult = await turnPromise;

	logInfo(`worker done: member=${member} state=${result.state} exitCode=${result.exitCode}`);
	logEnd();
	// Must run AFTER logging: the group SIGKILL this sends also terminates this
	// worker itself (it is the group leader), so nothing after this call is
	// guaranteed to run — see reapOwnProcessGroup's own doc comment.
	await reapOwnProcessGroup();
	process.exit(result.state === "done" ? 0 : 1);
}

if (import.meta.main) {
	main();
}

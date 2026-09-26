import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { BASELINE_INDEX, chainComplete, type QaCell, type QaStory } from "@lib/qa-chain-core.ts";
import { getQaCase, getQaCaseStoreStatus, resolveQaCaseContext, type QaCaseRecord, type QaCaseStoreOptions } from "@lib/qa-case-store.ts";
import { runQaCase } from "@lib/qa-case-run.ts";
import { resolveSessionIdOrThrow } from "@lib/state-core";
import { readQaState, registerQaCaseRunReceipt } from "./qa-state.ts";

function parseArgs(args: string[]): Record<string, string | boolean> {
	const result: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = args[i + 1];
		if (next !== undefined && !next.startsWith("--")) { result[key] = next; i += 1; }
		else result[key] = true;
	}
	return result;
}
function required(args: Record<string, string | boolean>, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim() === "") throw new Error(`--${key} is required`);
	return value;
}
function optionalPositiveNumber(args: Record<string, string | boolean>, key: string): number | undefined {
	const value = args[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim() === "") throw new Error(`--${key} must be a finite positive number`);
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${key} must be a finite positive number`);
	return parsed;
}
function help(): string {
	return [
		"Usage: qa-replay.ts --case ID --story ID --cls N [--sub SUB] --project DIR --code-ref STR --reset-confirmed STR [--timeout-ms N] [--max-buffer N] [--allow-project-cwd]",
		"",
		"Runs the saved native case only after the active QA actor→story→cell chain is complete.",
		"The reset confirmation must exactly equal the saved reset_description.",
		"Runner success creates a receipt but never records a QA cell PASS.",
		"Unconfigured, disabled, or missing cases print structured status and exit nonzero; --help exits zero.",
		"Runner start failures retain bounded logs and a failed receipt with start_error.",
		"Native runners are not sandboxed; review intended output paths and flags/config before execution.",
		"Relative native_files references resolve from --project; absolute references are accepted when present.",
	].join("\n") + "\n";
}
function fail(message: string): never { throw new Error(`qa-replay: ${message}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
export function replayExitCode(value: unknown): number {
	if (value === null) return 0;
	if (!isRecord(value) || !isRecord(value.exit_status)) return 1;
	return value.exit_status.code !== 0 || value.exit_status.signal !== null || value.exit_status.timedout === true || value.exit_status.max_buffer_exceeded === true ? 1 : 0;
}
function selectedCell(state: NonNullable<ReturnType<typeof readQaState>>, story: string, cls: number, sub: string | undefined): QaCell | undefined {
	return (state.cells ?? []).find((cell) => cell.story === story && cell.cls === cls && (cell.sub ?? undefined) === sub && cell.cycle === state.cycle);
}
function selectedStory(state: NonNullable<ReturnType<typeof readQaState>>, id: string): QaStory {
	const story = (state.stories ?? []).find((candidate) => candidate.id === id);
	if (!story) fail(`unknown story "${id}"`);
	return story;
}

export async function replayFromCli(args: string[] = process.argv.slice(2), options: QaCaseStoreOptions = {}): Promise<unknown> {
	if (args.includes("--help") || args.length === 0) { process.stdout.write(help()); return null; }
	const parsed = parseArgs(args);
	const project = resolve(required(parsed, "project"));
	const storeOptions = { ...options, cwd: project };
	const projectRoot = resolveQaCaseContext(storeOptions).projectRoot;
	const sessionId = resolveSessionIdOrThrow();
	const state = readQaState(sessionId);
	if (!state || state.active !== true) fail("active QA state is required");
	if ((state.phase_max ?? 0) < BASELINE_INDEX) fail("QA replay requires the active cycle to have left PLAN (BASELINE or later)");
	if (!chainComplete(state)) fail("QA actor→story→cell chainComplete gate is not satisfied");
	const storyId = required(parsed, "story");
	const story = selectedStory(state, storyId);
	const cls = Number(required(parsed, "cls"));
	if (!Number.isInteger(cls) || cls < 1 || cls > 6) fail("--cls must be an integer from 1 to 6");
	const timeoutMs = optionalPositiveNumber(parsed, "timeout-ms");
	const maxBuffer = optionalPositiveNumber(parsed, "max-buffer");
	const sub = typeof parsed.sub === "string" ? parsed.sub : undefined;
	if (sub !== undefined && sub !== "hang-timeout" && sub !== "flaky-green") fail("--sub must be hang-timeout or flaky-green");
	const cell = selectedCell(state, storyId, cls, sub);
	if (!cell) fail(`story/cell ${storyId}/${cls}${sub ? `/${sub}` : ""} is not authored in the current cycle`);
	const actorId = story.actor ?? story.actor_id;
	const actor = (state.actors ?? []).find((candidate) => candidate.id === actorId);
	if (!actor?.driver) fail(`story "${storyId}" has no driver-bound actor`);
	const caseResult = getQaCase(required(parsed, "case"), storeOptions);
	if (caseResult.status !== "ok") {
		process.stdout.write(`${JSON.stringify(caseResult)}\n`);
		return caseResult;
	}
	if (!("record" in caseResult)) fail("case lookup did not return a record");
	const storeStatus = getQaCaseStoreStatus(storeOptions);
	if (storeStatus.status !== "configured") fail(`case store is ${storeStatus.status}`);
	const record: QaCaseRecord = caseResult.record;
	if (record.surface !== actor.driver) fail(`case surface "${record.surface}" does not match actor driver "${actor.driver}"`);
	const linkedCriteria = (story.contract?.acceptance_criteria ?? []).map((index) => state.acceptance_criteria?.[index]).filter((value): value is string => typeof value === "string");
	if (!record.acceptance_criteria.every((criterion) => linkedCriteria.includes(criterion))) fail("case acceptance criteria must be a subset of the story's linked session acceptance criteria");
	const result = await runQaCase(record, {
		casePath: caseResult.path,
		caseRevision: caseResult.revision,
		projectRoot,
		storeLocation: storeStatus.location,
		codeRef: required(parsed, "code-ref"),
		resetConfirmed: required(parsed, "reset-confirmed"),
		sessionId,
		storyId,
		actorId: actor.id,
		cellClass: cls,
		cellSub: sub === "hang-timeout" || sub === "flaky-green" ? sub : undefined,
		cycle: state.cycle,
		storyContractSha256: story.contract ? createHash("sha256").update(JSON.stringify(story.contract)).digest("hex") : undefined,
		timeoutMs,
		maxBuffer,
		actorBoundary: actor.boundary,
		allowProjectCwd: parsed["allow-project-cwd"] === true,
	});
	registerQaCaseRunReceipt(sessionId, result.receipt.artifact_paths.receipt, result.receipt.attempt_id, result.receiptSha256);
	process.stdout.write(`${JSON.stringify(result.receipt)}\n`);
	return result.receipt;
}

if (import.meta.main) {
	replayFromCli().then((receipt) => {
		process.exitCode = replayExitCode(receipt);
	}).catch((error) => { process.stderr.write(`${String(error)}\n`); process.exit(1); });
}

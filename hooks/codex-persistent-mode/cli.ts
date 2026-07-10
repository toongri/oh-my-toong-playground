#!/usr/bin/env bun

/**
 * Codex "don't stop while work is incomplete" hook pair.
 *
 * `hook post-tool-use` (writer, G6-2): on every `update_plan` tool call,
 * counts non-completed plan steps and stamps `$OMT_DIR/codex-todo-<sid>.json`
 * with `{"incomplete": <N>}`. Always writes, including N=0 — that zero-write
 * is the release valve that unblocks the reader once a plan finishes.
 *
 * `hook stop` (reader, G6-1 / G6-3): reads that same file. Blocks
 * (`{"decision":"block","reason":...}`) iff incomplete > 0. Fails open
 * (prints nothing, exits 0) for every other case — file absent, unreadable,
 * malformed, non-number, NaN, negative, zero, or an unsafe session_id.
 *
 * Deliberately independent of hooks/persistent-mode/ (Claude-only) and of
 * lib/state-core.ts's STATE_PREFIX registry — this mirror is a per-session
 * derived cache, not a resumable skill mode. See
 * $OMT_DIR-relative design doc: oracle-todo8-spec.md for the full rationale.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { join } from "node:path";

import { isSafeSessionId } from "@lib/state-core";
import { resolveOmtDir } from "@lib/omt-dir";

const command = process.argv[2];
const subcommand = process.argv[3];

if (command === "hook" && subcommand === "post-tool-use") {
	await runHookCli(runPostToolUse);
} else if (command === "hook" && subcommand === "stop") {
	await runHookCli(runStop);
} else {
	process.stderr.write("Usage: codex-persistent-mode hook [post-tool-use|stop]\n");
	process.exitCode = 1;
}

async function runHookCli(handler: (input: Record<string, unknown>) => void): Promise<void> {
	try {
		const raw = await readStdin();
		if (raw.trim().length === 0) return;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return;
		handler(parsed);
	} catch {
		// Advisory fail-open: a hook-execution failure must never block the turn
		// or throw a non-zero exit — swallow and print nothing.
	}
}

function runPostToolUse(input: Record<string, unknown>): void {
	if (input["tool_name"] !== "update_plan") return;
	const sessionId = input["session_id"];
	if (typeof sessionId !== "string" || !isSafeSessionId(sessionId)) return;
	const omtDir = resolveOmtDir(cwdOf(input));
	mkdirSync(omtDir, { recursive: true });
	const incomplete = countIncomplete(input["tool_input"]);
	writeFileSync(mirrorPath(omtDir, sessionId), JSON.stringify({ incomplete }));
}

function runStop(input: Record<string, unknown>): void {
	const sessionId = input["session_id"];
	if (typeof sessionId !== "string" || !isSafeSessionId(sessionId)) return;
	const omtDir = resolveOmtDir(cwdOf(input));
	// Any throw here (ENOENT, permission, malformed JSON) is caught by the outer
	// try/catch in runHookCli, which fails open — nothing printed, exit 0.
	const raw = readFileSync(mirrorPath(omtDir, sessionId), "utf8");
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed)) return;
	const incomplete = parsed["incomplete"];
	if (typeof incomplete !== "number" || !Number.isFinite(incomplete) || incomplete <= 0) return;
	// lazy: no MAX_BLOCK_COUNT stuck-agent escape hatch (compare
	// hooks/persistent-mode/decision.ts:322-334). Add a per-sid block-counter
	// valve here if a Codex session is observed wedging on a stuck plan.
	process.stdout.write(
		JSON.stringify({ decision: "block", reason: `${incomplete} incomplete plan step(s) remaining` }),
	);
}

/** Counts `plan` entries whose `status !== "completed"`. Never throws. */
function countIncomplete(toolInput: unknown): number {
	if (!isRecord(toolInput)) return 0;
	const plan = toolInput["plan"];
	if (!Array.isArray(plan)) return 0;
	let count = 0;
	for (const entry of plan) {
		if (!isRecord(entry) || entry["status"] !== "completed") count++;
	}
	return count;
}

function mirrorPath(omtDir: string, sessionId: string): string {
	return join(omtDir, `codex-todo-${sessionId}.json`);
}

function cwdOf(input: Record<string, unknown>): string {
	const cwd = input["cwd"];
	return typeof cwd === "string" ? cwd : process.cwd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		processStdin.setEncoding("utf8");
		processStdin.on("data", (chunk: string) => {
			data += chunk;
		});
		processStdin.once("error", reject);
		processStdin.once("end", () => {
			processStdin.pause();
			resolve(data);
		});
		processStdin.resume();
	});
}

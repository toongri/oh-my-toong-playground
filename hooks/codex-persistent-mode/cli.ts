#!/usr/bin/env bun

/**
 * Codex "don't stop while work is incomplete" hook pair.
 *
 * `hook post-tool-use` (writer, G6-2): on every `update_plan` tool call,
 * counts non-completed plan steps and stamps `$OMT_DIR/codex-todo-<sid>.json`
 * with `{"incomplete": <N>}`. Always writes, including N=0 — that zero-write
 * is the release valve that unblocks the reader once a plan finishes.
 *
 * `hook stop` (reader, G6-1 / G6-3): reads that same file to derive
 * `incompleteTodoCount` (absent/unreadable/malformed → 0, never an early
 * return) and hands it, plus `last_assistant_message`, to the shared
 * `makeDecision` core (`@lib/persistent-mode-core/decision`) — the same
 * continuation contract hooks/persistent-mode/ (Claude) uses. That core
 * decides block vs. allow-stop: an `<awaiting-user/>` or deep-interview
 * done-token takes priority over a pending todo count; otherwise it blocks
 * (`{"decision":"block","reason":...}`) iff incomplete > 0. Codex's
 * allow-stop contract is silence (exit 0, no stdout) — this hook only ever
 * prints on an explicit block, never `{"continue":true}`. An unsafe
 * session_id fails open with nothing printed.
 *
 * Deliberately independent of lib/state-core.ts's STATE_PREFIX registry —
 * this mirror is a per-session derived cache, not a resumable skill mode.
 * See $OMT_DIR-relative design doc: oracle-todo8-spec.md for the full
 * rationale on the mirror file itself.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { join } from "node:path";

import { isSafeSessionId } from "@lib/state-core";
import { resolveOmtDir } from "@lib/omt-dir";
import { makeDecision, DecisionContext } from "@lib/persistent-mode-core/decision";

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
	const cwd = cwdOf(input);
	// Align process.env.OMT_DIR with this hook's cwd-derived resolution so
	// makeDecision's internal getOmtDir() (which falls back to process.cwd()
	// when OMT_DIR is unset) reads/writes the same directory as the mirror
	// file below, rather than a directory derived from the hook process's own cwd.
	process.env.OMT_DIR = resolveOmtDir(cwd);
	const omtDir = process.env.OMT_DIR;

	// Mirror read: absent/unreadable/malformed all collapse to 0 (no early
	// return) so makeDecision is always reached — awaiting-user and
	// deep-interview done-tokens must be checked regardless of todo state.
	let incompleteTodoCount = 0;
	try {
		const raw = readFileSync(mirrorPath(omtDir, sessionId), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed)) {
			const n = parsed["incomplete"];
			if (typeof n === "number" && Number.isFinite(n) && n > 0) incompleteTodoCount = n;
		}
	} catch {
		// absent/unreadable/malformed mirror file → 0
	}

	const lam = input["last_assistant_message"];
	const context: DecisionContext = {
		sessionId,
		lastAssistantMessage: typeof lam === "string" ? lam : null,
		projectRoot: cwd,
		incompleteTodoCount,
		activeSubagentCount: 0,
	};

	const output = makeDecision(context);

	// Option A: Codex's existing allow-stop contract is silence (exit 0, no
	// stdout) — preserve that. Only print on an explicit block; continue is
	// left silent rather than emitting {continue:true}.
	if (output.decision === "block") {
		process.stdout.write(JSON.stringify(output));
	}
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

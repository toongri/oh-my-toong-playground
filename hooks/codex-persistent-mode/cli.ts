#!/usr/bin/env bun

/**
 * Codex "don't stop while work is incomplete" hook pair.
 *
 * `hook post-tool-use` (writer, G6-2 + chain ratchet): on every `update_plan`
 * tool call, counts non-completed plan steps and merges `{"incomplete": <N>}`
 * into `$OMT_DIR/codex-todo-<sid>.json`. Always writes, including N=0 — that
 * zero-write is the release valve that unblocks the reader once a plan
 * finishes. On every shell/exec tool call whose command argument references a
 * `<skill>/SKILL.md` path that exists on disk, it also records the skill as
 * opened and — by reading that same file and matching `$name` sigils in its
 * body against real sibling skill directories (siblings of the opened
 * skill's own directory, so no deploy-path assumption is baked in) — records
 * any newly-referenced next-step skill as expected. Both writes merge into
 * the same mirror file rather than clobbering each other's fields. Before
 * either write, a shared `isFailedToolResponse` gate (`@lib/tool-response`,
 * moved out of the sibling extractor hooks/rules-injector/tool-paths.ts so
 * both consumers share one predicate) rejects a failed `tool_response` —
 * neither the todo-count mirror nor the skill-chain fields are written for a
 * failed `update_plan` or shell/exec call, so a rejected plan update can't
 * report false completion and a failed command can't report a skill as
 * opened.
 *
 * `hook stop` (reader, G6-1 / G6-3 + chain ratchet): reads that same file to
 * derive `incompleteTodoCount` (absent/unreadable/malformed → 0, never an
 * early return) and `pendingSkillChainSkills` (expected skills not yet
 * opened), and hands both, plus `last_assistant_message`, to the shared
 * `makeDecision` core (`@lib/persistent-mode-core/decision`) — the same
 * continuation contract hooks/persistent-mode/ (Claude) uses; Claude's
 * consumer never populates `pendingSkillChainSkills`, so the chain ratchet is
 * inert there. That core decides block vs. allow-stop: an `<awaiting-user/>`
 * or deep-interview done-token takes priority over a pending todo count or a
 * pending skill chain; otherwise it blocks (`{"decision":"block","reason":...}`)
 * iff incomplete > 0 or a next-step skill remains unopened. Codex's
 * allow-stop contract is silence (exit 0, no stdout) — this hook only ever
 * prints on an explicit block, never `{"continue":true}`. An unsafe
 * session_id fails open with nothing printed.
 *
 * Deliberately independent of lib/state-core.ts's STATE_PREFIX registry —
 * this mirror is a per-session derived cache, not a resumable skill mode.
 * See $OMT_DIR-relative design doc: oracle-todo8-spec.md for the full
 * rationale on the mirror file itself.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { join, dirname, basename, resolve, isAbsolute } from "node:path";

import { isSafeSessionId } from "@lib/state-core";
import { resolveOmtDir } from "@lib/omt-dir";
import { makeDecision, DecisionContext } from "@lib/persistent-mode-core/decision";
import { isFailedToolResponse } from "@lib/tool-response";

// Declared before the top-level dispatch below (not after): this module uses
// top-level await, which pauses module evaluation at that await — any `const`
// textually positioned after the dispatch block would still be uninitialized
// (TDZ) when a handler invoked from within that same await resolves.
const COMMAND_TOOL_NAMES = new Set(["bash", "shell_command", "exec_command"]);

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
	const sessionId = input["session_id"];
	if (typeof sessionId !== "string" || !isSafeSessionId(sessionId)) return;
	// Normalize tool_name to lowercase before routing, mirroring the sibling
	// Codex shims (codex-write-guard.sh, codex-label-commit-gate.sh,
	// codex-label-edit-warn.sh) — this hook's own codex.yaml matcher
	// (`^update_plan$|Bash|bash|exec_command|shell_command`) accepts uppercase
	// `Bash`, so the handler must too or the chain ratchet silently never fires.
	const rawToolName = input["tool_name"];
	const toolName = typeof rawToolName === "string" ? rawToolName.toLowerCase() : rawToolName;

	// Failed-tool-response gate (mirrors the sibling extractor,
	// hooks/rules-injector/tool-paths.ts, which filters the same signal before
	// route dispatch): a failed update_plan or shell/exec call must write
	// neither the todo-count mirror nor the skill-chain fields, or the reader
	// below is handed a false "opened"/"incomplete:0" signal it can't tell
	// apart from a real one.
	if (isFailedToolResponse(input["tool_response"])) return;

	if (toolName === "update_plan") {
		const omtDir = resolveOmtDir(cwdOf(input));
		mkdirSync(omtDir, { recursive: true });
		const incomplete = countIncomplete(input["tool_input"]);
		const path = mirrorPath(omtDir, sessionId);
		writeFileSync(path, JSON.stringify({ ...readMirror(path), incomplete }));
		return;
	}

	if (typeof toolName === "string" && COMMAND_TOOL_NAMES.has(toolName)) {
		recordSkillChain(input, sessionId);
	}
}

/** Reads the mirror file untyped; absent/unreadable/malformed all collapse to `{}`. */
function readMirror(path: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Chain-ratchet writer half. "Opened" = the command argument string contains a
 * `<skill>/SKILL.md` path that actually exists on disk (never the model's prose —
 * see tools/codex-probe/probes/skill-chain-load/judgment.ts's skillFileWasOpened
 * for the concept this mirrors, though the logic isn't shared: that file is
 * probe-owned, this is the runtime path). "Expected" = a `$name` sigil in that
 * file's body whose name matches a sibling directory (of the opened skill's own
 * directory) that itself contains a SKILL.md — the sibling-existence check is
 * what rejects incidental sigils like `$HOME` without a hardcoded word list.
 */
function recordSkillChain(input: Record<string, unknown>, sessionId: string): void {
	const command = commandOf(input["tool_input"]);
	if (!command) return;
	const cwd = cwdOf(input);
	// Resolve a relative SKILL.md match against the COMMAND'S OWN working
	// directory (tool_input.workdir ?? tool_input.cwd), not the top-level hook
	// `cwd` — mirroring the sibling extractor tool-paths.ts:44-46 and the shell
	// guard's workdir carve-out (codex-write-guard.sh:495-503). A payload that
	// runs the command in a different workdir than the top-level cwd otherwise
	// fails existsSync below and the opened skill is silently dropped. Scope:
	// only this match-resolution base — resolveOmtDir (below, and at :90/:180)
	// keeps reading the top-level `cwd` so the mirror file path never splits
	// between writer and reader.
	const commandCwd = commandCwdOf(input["tool_input"], cwd);
	const matches = command.match(/[^\s'"]+\/SKILL\.md/g);
	if (!matches) return;

	const newlyOpened = new Set<string>();
	const newlyExpected = new Set<string>();

	for (const rawPath of matches) {
		const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(commandCwd, rawPath);
		if (!existsSync(resolvedPath)) continue;
		const skillDir = dirname(resolvedPath);
		const skillName = basename(skillDir);
		const skillsRoot = dirname(skillDir);
		newlyOpened.add(skillName);

		let content: string;
		try {
			content = readFileSync(resolvedPath, "utf8");
		} catch {
			continue;
		}
		for (const sigil of content.match(/\$([A-Za-z][A-Za-z0-9_-]*)/g) ?? []) {
			const name = sigil.slice(1);
			if (name === skillName) continue;
			if (existsSync(join(skillsRoot, name, "SKILL.md"))) newlyExpected.add(name);
		}
	}
	if (newlyOpened.size === 0) return;

	const omtDir = resolveOmtDir(cwd);
	mkdirSync(omtDir, { recursive: true });
	const path = mirrorPath(omtDir, sessionId);
	const mirror = readMirror(path);
	const openedSkills = new Set(stringArray(mirror["openedSkills"]));
	const expectedSkills = new Set(stringArray(mirror["expectedSkills"]));
	for (const s of newlyOpened) openedSkills.add(s);
	for (const s of newlyExpected) expectedSkills.add(s);

	writeFileSync(
		path,
		JSON.stringify({ ...mirror, openedSkills: [...openedSkills], expectedSkills: [...expectedSkills] }),
	);
}

/** Shell/exec tool_input carries the command under `command` or `cmd`. */
function commandOf(toolInput: unknown): string | undefined {
	if (!isRecord(toolInput)) return undefined;
	const command = toolInput["command"] ?? toolInput["cmd"];
	return typeof command === "string" && command.length > 0 ? command : undefined;
}

/**
 * The command's own working directory: `tool_input.workdir ?? tool_input.cwd`
 * (empty string/non-string treated as absent), itself resolved against the
 * top-level `cwd` when relative. Falls back to `cwd` when neither key is set.
 */
function commandCwdOf(toolInput: unknown, cwd: string): string {
	if (!isRecord(toolInput)) return cwd;
	const raw = toolInput["workdir"] ?? toolInput["cwd"];
	if (typeof raw !== "string" || raw.length === 0) return cwd;
	return isAbsolute(raw) ? raw : resolve(cwd, raw);
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

	// Mirror read: absent/unreadable/malformed all collapse to 0/[] (no early
	// return) so makeDecision is always reached — awaiting-user and
	// deep-interview done-tokens must be checked regardless of todo/chain state.
	let incompleteTodoCount = 0;
	let pendingSkillChainSkills: string[] = [];
	try {
		const raw = readFileSync(mirrorPath(omtDir, sessionId), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed)) {
			const n = parsed["incomplete"];
			if (typeof n === "number" && Number.isFinite(n) && n > 0) incompleteTodoCount = n;
			const opened = stringArray(parsed["openedSkills"]);
			const expected = stringArray(parsed["expectedSkills"]);
			pendingSkillChainSkills = expected.filter((name) => !opened.includes(name));
		}
	} catch {
		// absent/unreadable/malformed mirror file → 0/[]
	}

	// `last_assistant_message`는 codex-rs 새 hooks 시스템 Stop payload의 확정 snake_case 키
	// (codex-rs/hooks/schema/generated/stop.command.input.schema.json의 required 필드, StopCommandInput).
	// Stop/SubagentStop 이벤트만 이 필드를 실음. 부재 시 null fail-open(토큰 미발화).
	const lam = input["last_assistant_message"];
	const context: DecisionContext = {
		sessionId,
		lastAssistantMessage: typeof lam === "string" ? lam : null,
		projectRoot: cwd,
		incompleteTodoCount,
		activeSubagentCount: 0,
		pendingSkillChainSkills,
		// Codex's real AskUserQuestion analog (rewrite rule 14 in
		// tools/lib/rewrite-rules.ts) — see DecisionContext.askToolName's doc
		// comment. Claude's hooks/persistent-mode/index.ts never sets this
		// field, so makeDecision's own "AskUserQuestion" default applies there.
		askToolName: "request_user_input",
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

/** Narrows an unknown mirror field to a string array; anything else → []. */
function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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

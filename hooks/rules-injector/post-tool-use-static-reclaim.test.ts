/**
 * Task1 — PostToolUse static reclaim (Option C, one-shot). See D-1/D-2/D-3 in
 * plans/rules-injector-improvements.md.
 *
 * The first post-compaction PostToolUse restores always-apply (static) rules via a
 * directive-only (pointer) recovery, completing the static channel in ONE turn
 * (Option C — no recovering-hold, lease freed). A budget-overflow tail stays
 * un-marked in staticDedup and self-heals via the next UserPromptSubmit's existing
 * normal static path (no new drain mechanism).
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	CodexPostCompactInput,
	CodexPostToolUseInput,
	CodexRulesHookOptions,
	CodexSessionStartInput,
	CodexUserPromptSubmitInput,
} from "./codex-hook.js";
import { runPostCompactHook, runPostToolUseHook, runSessionStartHook, runUserPromptSubmitHook } from "./codex-hook.js";
import { sessionCachePath } from "./persistent-cache.js";

let scratchDir = "";
let pluginDataRoot = "";
let projectDir = "";

beforeEach(() => {
	scratchDir = mkdtempSync(join(tmpdir(), "pt-reclaim-"));
	pluginDataRoot = join(scratchDir, "data");
	projectDir = join(scratchDir, "project");
	mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });
	mkdirSync(join(projectDir, "src"), { recursive: true });
	writeFileSync(join(projectDir, "package.json"), '{"name":"pt-reclaim"}\n');
});

afterEach(() => {
	if (scratchDir.length > 0) rmSync(scratchDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeRule(fileName: string, frontmatter: string, body: string): string {
	const rulePath = join(projectDir, ".claude", "rules", fileName);
	writeFileSync(rulePath, `---\n${frontmatter}\n---\n${body}\n`);
	return rulePath;
}

function writeTarget(): void {
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");
}

function sessionStartInput(sessionId: string, overrides: Partial<CodexSessionStartInput> = {}): CodexSessionStartInput {
	return {
		session_id: sessionId,
		transcript_path: null,
		cwd: projectDir,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
		...overrides,
	};
}

function postCompactInput(sessionId: string, overrides: Partial<CodexPostCompactInput> = {}): CodexPostCompactInput {
	return {
		session_id: sessionId,
		turn_id: "compact-1",
		transcript_path: null,
		cwd: projectDir,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "manual",
		...overrides,
	};
}

function postToolUseInput(sessionId: string, overrides: Partial<CodexPostToolUseInput> = {}): CodexPostToolUseInput {
	return {
		session_id: sessionId,
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_input: { command: "cat src/x.ts" },
		tool_response: {},
		tool_use_id: "u1",
		...overrides,
	};
}

function userPromptInput(
	sessionId: string,
	prompt: string,
	overrides: Partial<CodexUserPromptSubmitInput> = {},
): CodexUserPromptSubmitInput {
	return {
		session_id: sessionId,
		turn_id: "up-1",
		transcript_path: null,
		cwd: projectDir,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt,
		...overrides,
	};
}

function parseContext(output: string): string {
	if (output.trim().length === 0) return "";
	const parsed = JSON.parse(output) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function dataOptions(env?: Record<string, string>): CodexRulesHookOptions {
	return env === undefined ? { pluginDataRoot } : { pluginDataRoot, env };
}

// ---------------------------------------------------------------------------
// T1-AC1 — first post-compact PostToolUse emits static directive
// ---------------------------------------------------------------------------

test("first PostToolUse emits static recovery", async () => {
	const sessionId = "ac1-session";
	const rulePath = writeRule("ac1-rule.md", "alwaysApply: true", "AC1_BOULDER: recovered via PostToolUse.");
	writeTarget();

	const first = await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	expect(first).toContain("AC1_BOULDER");

	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	const result = await runPostToolUseHook(postToolUseInput(sessionId), dataOptions());
	const ctx = parseContext(result);
	expect(ctx).toContain("POST-COMPACTION RULE RECOVERY");
	expect(ctx).toContain(rulePath);

	// Option C: the static channel completes THIS turn — recovering cleared, no
	// held lease across turns.
	const cachePath = sessionCachePath(sessionId, pluginDataRoot);
	const state = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
	const recovering = state["postCompactRecovering"] as Record<string, unknown> | undefined;
	expect(recovering?.["static"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// T1-AC2 — overflow tail re-emitted by next UserPromptSubmit
// ---------------------------------------------------------------------------

test("overflow tail re-emitted on next UserPromptSubmit", async () => {
	const sessionId = "ac2-session";
	const rule1Path = writeRule("ac2-a-rule1.md", "alwaysApply: true", "AC2_RULE1_BODY: recovered directly.");
	writeRule("ac2-b-rule2.md", "alwaysApply: true", "AC2_RULE2_BODY: overflow tail.");
	writeTarget();

	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	// Extremely tight post-compact budget: the buildPostCompactReadDirective
	// implementation always admits the FIRST path regardless of budget (the
	// lines.length===0 bypass) but rejects every subsequent one — deterministic
	// regardless of temp-dir path length.
	const reclaim = await runPostToolUseHook(
		postToolUseInput(sessionId),
		dataOptions({ CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS: "1" }),
	);
	const reclaimCtx = parseContext(reclaim);
	expect(reclaimCtx).toContain(rule1Path);
	expect(reclaimCtx).not.toContain("AC2_RULE2_BODY");

	// Next UserPromptSubmit (open budget): the overflow tail (rule2) self-heals via
	// the existing normal static path — no drain mechanism on PostToolUse itself.
	const ups = await runUserPromptSubmitHook(userPromptInput(sessionId, "continue"), dataOptions());
	const upsCtx = parseContext(ups);
	expect(upsCtx).toContain("AC2_RULE2_BODY");
	// rule1 was already recovered+marked — must not be re-emitted.
	expect(upsCtx).not.toContain("AC2_RULE1_BODY");
});

// ---------------------------------------------------------------------------
// T1-AC3a — reclaim output has no dynamic body
// ---------------------------------------------------------------------------

test("static reclaim excludes dynamic body", async () => {
	const sessionId = "ac3a-session";
	const rulePath = writeRule("ac3a-rule.md", "alwaysApply: true", "AC3A_STATIC_BODY: pointer only.");

	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	// No target path: dynamic injection never runs (see T1-AC7), isolating the
	// static reclaim's own contribution. NOTE: an alwaysApply rule also matches the
	// DYNAMIC loader (matcher.ts) for any target, so a target-present call would let
	// the dynamic path re-emit this rule's full body independently of the reclaim —
	// the no-target call is what actually isolates "reclaim output has no dynamic
	// body" as a property of the reclaim itself.
	const result = await runPostToolUseHook(
		postToolUseInput(sessionId, { tool_input: { command: "echo hello" } }),
		dataOptions(),
	);
	const ctx = parseContext(result);

	expect(ctx).toContain("POST-COMPACTION RULE RECOVERY");
	expect(ctx).toContain(rulePath);
	// Directive-only: no dynamic block header, and no full rule BODY (only the path
	// pointer — the body itself is never emitted by the directive-only recovery for
	// a non-never-truncated rule).
	expect(ctx).not.toContain("Additional project instructions matched for");
	expect(ctx).not.toContain("AC3A_STATIC_BODY");
});

// ---------------------------------------------------------------------------
// T1-AC3b — path-matched file still gets dynamic injection same call
// ---------------------------------------------------------------------------

test("dynamic injection still fires alongside static directive", async () => {
	const sessionId = "ac3b-session";
	const staticRulePath = writeRule("ac3b-static.md", "alwaysApply: true", "AC3B_STATIC_BODY: recovered pointer.");
	writeRule("ac3b-dynamic.md", 'globs: ["**/*.ts"]', "AC3B_DYNAMIC_MARKER: matched target file.");
	writeTarget();

	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	const result = await runPostToolUseHook(postToolUseInput(sessionId), dataOptions());
	const ctx = parseContext(result);

	// Static reclaim directive present ...
	expect(ctx).toContain("POST-COMPACTION RULE RECOVERY");
	expect(ctx).toContain(staticRulePath);
	// ... AND the dynamic glob rule matched by the same tool call still injects, in
	// the SAME hook return (single merged envelope, static directive first).
	expect(ctx).toContain("AC3B_DYNAMIC_MARKER");
	expect(ctx.indexOf("POST-COMPACTION RULE RECOVERY")).toBeLessThan(ctx.indexOf("AC3B_DYNAMIC_MARKER"));
});

// ---------------------------------------------------------------------------
// T1-AC4 — no double static recovery under a UPS race
// ---------------------------------------------------------------------------

test("no double static recovery under race", async () => {
	const sessionId = "ac4-session";
	writeRule("ac4-rule.md", "alwaysApply: true", "AC4_BOULDER: must not double-recover.");

	// Simulate a PostToolUse recovery already IN FLIGHT (the state a real PostToolUse
	// would have written right after claimPostCompactPending("static") succeeded):
	// static moved pending -> recovering, with a fresh lease owned by this process.
	const cachePath = sessionCachePath(sessionId, pluginDataRoot);
	mkdirSync(dirname(cachePath), { recursive: true });
	writeFileSync(
		cachePath,
		`${JSON.stringify({
			version: 1,
			staticDedup: [],
			dynamicDedup: {},
			postCompactRecovering: { static: true },
			recoveryLease: { static: { ownerPid: process.pid, startedAt: Date.now(), leaseTTL: 60_000 } },
		})}\n`,
	);

	// A UserPromptSubmit racing against that in-flight recovery must be suppressed
	// by the existing (untouched) lease/contended guard — no double recovery, and no
	// silent regression to the untouched UPS caller (the exact hazard that refuted
	// Option A in D-1).
	const result = await runUserPromptSubmitHook(userPromptInput(sessionId, "continue"), dataOptions());
	expect(parseContext(result)).toBe("");
});

// ---------------------------------------------------------------------------
// T1-AC6 — steady-state no-op (lock-free gated)
// ---------------------------------------------------------------------------

test("no static when not post-compact", async () => {
	const sessionId = "ac6-session";
	writeRule("ac6-rule.md", "alwaysApply: true", "AC6_BOULDER: never appears without compaction.");
	writeTarget();

	// Normal SessionStart, no compaction ever happened for this session.
	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());

	const result = await runPostToolUseHook(postToolUseInput(sessionId), dataOptions());
	const ctx = parseContext(result);

	expect(ctx).not.toContain("POST-COMPACTION RULE RECOVERY");
});

// ---------------------------------------------------------------------------
// T1-AC7 — no-target PostToolUse still emits the one-shot reclaim
// ---------------------------------------------------------------------------

test("reclaim fires when PostToolUse has no path", async () => {
	const sessionId = "ac7-session";
	const rulePath = writeRule("ac7-rule.md", "alwaysApply: true", "AC7_BOULDER: no-target still reclaims.");

	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	// "echo hello" resolves to zero target paths: neither token is an existing file,
	// and addCommandPaths requires mustExist for Bash-tool tokens.
	const result = await runPostToolUseHook(
		postToolUseInput(sessionId, { tool_input: { command: "echo hello" } }),
		dataOptions(),
	);
	const ctx = parseContext(result);

	expect(ctx).toContain("POST-COMPACTION RULE RECOVERY");
	expect(ctx).toContain(rulePath);
});

// ---------------------------------------------------------------------------
// T1-AC8 — reclaim honors the disabled kill-switch
// ---------------------------------------------------------------------------

test("no reclaim when disabled", async () => {
	const sessionId = "ac8-session";
	writeRule("ac8-rule.md", "alwaysApply: true", "AC8_BOULDER: must not leak under kill-switch.");
	writeTarget();

	await runSessionStartHook(sessionStartInput(sessionId), dataOptions());
	await runPostCompactHook(postCompactInput(sessionId), dataOptions());

	const disabledResult = await runPostToolUseHook(
		postToolUseInput(sessionId),
		dataOptions({ CODEX_RULES_DISABLED: "1" }),
	);
	expect(disabledResult).toBe("");

	// The disabled run must not have consumed the pending state: re-enabling later
	// still sees it pending (mirrors the existing C2 SessionStart guarantee).
	const reenabled = await runPostToolUseHook(postToolUseInput(sessionId), dataOptions());
	const ctx = parseContext(reenabled);
	expect(ctx).toContain("POST-COMPACTION RULE RECOVERY");
});

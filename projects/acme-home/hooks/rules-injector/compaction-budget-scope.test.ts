import { test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_AUTO_DISABLED_SOURCES } from "./rules/index.js";

// Absolute path to the hook CLI entry. Resolved from this test's own location so
// the suite is location-independent.
const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "cli.ts");

// HERMETIC HOME: every test runs under a fresh $HOME so the session-state store
// ($HOME/.omt/rules-injector/<sid>.json) and the error sink
// ($HOME/.omt/rules-injector/error.log) are fully sandboxed. No real ~/.omt or
// ~/.claude is ever read or written.
let tempHome = "";
let realHome: string | undefined;
const scratchDirs: string[] = [];

beforeEach(() => {
	realHome = process.env["HOME"];
	tempHome = mkdtempSync(join(tmpdir(), "rules-injector-home-"));
	process.env["HOME"] = tempHome;
});

afterEach(() => {
	if (realHome === undefined) {
		delete process.env["HOME"];
	} else {
		process.env["HOME"] = realHome;
	}
	for (const dir of [tempHome, ...scratchDirs]) {
		if (dir.length > 0) rmSync(dir, { recursive: true, force: true });
	}
	scratchDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

/**
 * Build a temp project that findProjectRoot will anchor on (package.json marker)
 * and seed an always-apply static rule under .claude/rules/. Returns the project
 * root, the absolute rule path, and the rule body.
 */
function makeProjectWithStaticRule(
	ruleName: string,
	ruleBody: string,
): { projectRoot: string; rulePath: string; ruleBody: string } {
	const projectRoot = makeScratchDir("rules-injector-proj-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });
	const rulePath = join(rulesDir, ruleName);
	writeFileSync(rulePath, `---\nalwaysApply: true\n---\n${ruleBody}\n`);
	return { projectRoot, rulePath, ruleBody };
}

interface SpawnResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Spawn one hook run through cli.ts under the hermetic $HOME. Reuse the same
 * session_id + tempHome across calls to exercise persistent session state.
 */
function runHook(
	sub: "session-start" | "user-prompt-submit" | "post-tool-use" | "post-compact",
	payload: Record<string, unknown>,
	extraEnv: Record<string, string> = {},
): SpawnResult {
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", sub], {
		input: JSON.stringify(payload),
		env: { ...process.env, HOME: tempHome, ...extraEnv },
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Parse the additionalContext emitted by a hook run; "" when nothing emitted. */
function additionalContext(stdout: string): string {
	if (stdout.trim().length === 0) return "";
	const parsed = JSON.parse(stdout) as {
		hookSpecificOutput?: { additionalContext?: string };
	};
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function sessionStartPayload(
	sessionId: string,
	cwd: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		hook_event_name: "SessionStart",
		session_id: sessionId,
		transcript_path: null,
		cwd,
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
		...overrides,
	};
}

function postCompactPayload(sessionId: string, cwd: string): Record<string, unknown> {
	return {
		hook_event_name: "PostCompact",
		session_id: sessionId,
		turn_id: "turn-compact",
		transcript_path: null,
		cwd,
		model: "gpt-5.5",
		trigger: "manual",
	};
}

function userPromptPayload(
	sessionId: string,
	cwd: string,
	prompt: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		hook_event_name: "UserPromptSubmit",
		session_id: sessionId,
		turn_id: "turn-1",
		transcript_path: null,
		cwd,
		model: "gpt-5.5",
		permission_mode: "default",
		prompt,
		...overrides,
	};
}

function errorLogPath(): string {
	return join(tempHome, ".omt", "rules-injector", "error.log");
}

// ===========================================================================
// D1 — PostCompact wipes staticDedup + arms recovery; next static hook recovers
// ===========================================================================

test("D1: post-compact arms recovery so the next SessionStart re-injects the dropped rule", () => {
	const sessionId = "d1-session";
	const { projectRoot, rulePath } = makeProjectWithStaticRule(
		"d1-rule.md",
		"D1 BOULDER: never let the rock rest at the bottom of the hill.",
	);

	// 1. First SessionStart injects the rule and records it in staticDedup.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toContain("D1 BOULDER");

	// 2. PostCompact wipes staticDedup and arms the recovery directive.
	const compact = runHook("post-compact", postCompactPayload(sessionId, projectRoot));
	expect(compact.status).toBe(0);
	expect(compact.stdout.trim()).toBe("");

	// 3. The next SessionStart re-injects: the rule the compaction dropped is
	//    surfaced again through the post-compact recovery directive.
	const recovery = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);
	expect(recovered).toContain("POST-COMPACTION RULE RECOVERY");
	expect(recovered).toContain(rulePath);
});

// ===========================================================================
// D2 — transcript backstop: a rule already in the transcript is skipped
// ===========================================================================

test("D2: recovery skips a rule whose body is already present in the transcript", () => {
	const sessionId = "d2-session";
	const { projectRoot, rulePath, ruleBody } = makeProjectWithStaticRule(
		"d2-rule.md",
		"D2 BOULDER: the transcript already remembers this directive end to end.",
	);

	runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId, projectRoot));

	// Transcript carries both the rule body needle AND an "Instructions from:"
	// marker keyed on the rule's path — the backstop's recognition signature.
	const transcriptPath = join(projectRoot, "transcript.txt");
	writeFileSync(transcriptPath, `Instructions from: ${rulePath}\n\n${ruleBody}\n`);

	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId, projectRoot, { transcript_path: transcriptPath }),
	);
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);
	// The rule is excluded: no recovery directive, no rule reference emitted.
	expect(recovered).toBe("");
});

// ===========================================================================
// D3 — context-pressure suppression on UserPromptSubmit
// ===========================================================================

test("D3: a context_length_exceeded marker in the prompt suppresses all injection that turn", () => {
	const sessionId = "d3-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"d3-rule.md",
		"D3 BOULDER: this body must NOT appear when context is under pressure.",
	);

	const suppressed = runHook(
		"user-prompt-submit",
		userPromptPayload(sessionId, projectRoot, "the model reported context_length_exceeded mid-turn"),
	);
	expect(suppressed.status).toBe(0);
	expect(suppressed.stdout.trim()).toBe("");
	expect(additionalContext(suppressed.stdout)).toBe("");
});

// ===========================================================================
// E1a / E1b — output budget cap (<= 32K) and read-pointer survival
// ===========================================================================

test("E1a: an over-budget rule set is capped to <= 32K bytes of additionalContext", () => {
	const sessionId = "e1a-session";
	// 50K body; raise the per-rule/result budgets above the body so the formatter
	// does NOT pre-shrink it — the hardcoded 32K hook-output cap is what enforces
	// the ceiling. ASCII body => byte length == char length.
	const { projectRoot } = makeProjectWithStaticRule("e1a-rule.md", "X".repeat(50_000));

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		CODEX_RULES_MAX_RULE_CHARS: "60000",
		CODEX_RULES_MAX_RESULT_CHARS: "60000",
	});
	expect(result.status).toBe(0);
	const emitted = additionalContext(result.stdout);
	expect(emitted.length).toBeGreaterThan(0);
	expect(Buffer.byteLength(emitted, "utf8")).toBeLessThanOrEqual(32_000);
});

test("E1b: the truncated output still carries the rule file path as a read pointer", () => {
	const sessionId = "e1b-session";
	const { projectRoot, rulePath } = makeProjectWithStaticRule("e1b-rule.md", "X".repeat(50_000));

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		CODEX_RULES_MAX_RULE_CHARS: "60000",
		CODEX_RULES_MAX_RESULT_CHARS: "60000",
	});
	expect(result.status).toBe(0);
	const emitted = additionalContext(result.stdout);
	// The "Instructions from: <path>" header sits at the very top of the block,
	// so it survives the head slice and points the reader at the full rule file.
	expect(emitted).toContain(rulePath);
});

// ===========================================================================
// E2 — per-session dedup across two spawned runs (persisted at <sid>.json)
// ===========================================================================

test("E2: the same rule is omitted on the second hook run of the same session", () => {
	const sessionId = "e2-session";
	const ruleBody = "E2 BOULDER: inject me exactly once per session.";
	const { projectRoot } = makeProjectWithStaticRule("e2-rule.md", ruleBody);

	// Run 1: SessionStart injects the rule and persists the dedup mark.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toContain(ruleBody);

	// The persisted session state lives under the hermetic $HOME.
	const statePath = join(tempHome, ".omt", "rules-injector", `${sessionId}.json`);
	expect(existsSync(statePath)).toBe(true);

	// Run 2: a later turn (UserPromptSubmit) hydrates that state, sees the rule's
	// realPath+contentHash already injected, and omits it.
	const second = runHook("user-prompt-submit", userPromptPayload(sessionId, projectRoot, "continue"));
	expect(second.status).toBe(0);
	expect(second.stdout.trim()).toBe("");
	expect(additionalContext(second.stdout)).not.toContain(ruleBody);
});

// ===========================================================================
// F2 — source exclusion default set
// ===========================================================================

test("F2: DEFAULT_AUTO_DISABLED_SOURCES excludes AGENTS.md", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("AGENTS.md");
});

test("F2: DEFAULT_AUTO_DISABLED_SOURCES excludes ~/.claude/rules", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("~/.claude/rules");
});

test("F2: DEFAULT_AUTO_DISABLED_SOURCES excludes ~/.claude/CLAUDE.md", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("~/.claude/CLAUDE.md");
});

// ===========================================================================
// F4 — advisory exit-0 breadcrumb on a forced uncaught throw
// ===========================================================================

test("F4: a forced uncaught throw is swallowed (exit 0) and leaves an error.log breadcrumb", () => {
	// HOW THE THROW IS TRIGGERED (deterministic, HOME stays writable):
	// Pre-create the session-state path $HOME/.omt/rules-injector/<sid>.json as a
	// DIRECTORY rather than a file. A SessionStart (source "startup", no pending)
	// calls clearSessionState() -> rmSync(cachePath, { force: true }) with NO
	// recursive flag. rmSync on a directory throws (force only suppresses ENOENT,
	// not the directory error). The throw is uncaught through runStaticInjection /
	// runHook and reaches cli.ts's runHookCli catch, which calls
	// writeErrorBreadcrumb and leaves process.exitCode at 0.
	// The breadcrumb sink ($HOME/.omt/rules-injector/error.log) shares the parent
	// dir, which remains a normal writable directory, so the breadcrumb succeeds.
	const sessionId = "f4-session";
	const { projectRoot } = makeProjectWithStaticRule("f4-rule.md", "F4 BOULDER body");

	const stateDir = join(tempHome, ".omt", "rules-injector");
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(join(stateDir, `${sessionId}.json`), { recursive: true });

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot));

	expect(result.status).toBe(0);
	const log = errorLogPath();
	expect(existsSync(log)).toBe(true);
	const lines = readFileSync(log, "utf8").split("\n").filter((line) => line.trim().length > 0);
	expect(lines.length).toBeGreaterThanOrEqual(1);
});

// ===========================================================================
// C2 — CODEX_RULES_DISABLED=1 must not consume the PostCompact pending state
// ===========================================================================

test("C2: disabled SessionStart does not consume recovering state, which is emitted after re-enable", () => {
	// Proves: when config.disabled=true, static-injection.ts must NOT call
	// completePostCompactRecovery — if it did, the recovery directive would be
	// permanently lost. Reverting the guard in static-injection.ts (removing the
	// completedPostCompactChannel check before the disabled early-return) makes
	// this test RED.
	const sessionId = "c2-session";
	const { projectRoot, rulePath } = makeProjectWithStaticRule(
		"c2-rule.md",
		"C2 BOULDER: recovery must survive a disabled run.",
	);
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");

	// 1. Normal SessionStart — rule injected, dedup recorded.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
	});
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toContain("C2 BOULDER");

	// 2. PostCompact — arms the recovery pending state.
	const compact = runHook("post-compact", postCompactPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
	});
	expect(compact.status).toBe(0);
	expect(compact.stdout.trim()).toBe("");

	// 3. SessionStart with kill-switch ON — must emit nothing AND must not consume
	//    the recovering state.
	const disabledRun = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
		CODEX_RULES_DISABLED: "1",
	});
	expect(disabledRun.status).toBe(0);
	expect(disabledRun.stdout.trim()).toBe("");

	// 4. SessionStart with kill-switch OFF again — recovery directive must still
	//    fire, proving the disabled run did not consume the pending state.
	const recovery = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
	});
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);
	expect(recovered).toContain("POST-COMPACTION RULE RECOVERY");
	expect(recovered).toContain(rulePath);
});

// ===========================================================================
// C10-D2 positive control — D2 skip is non-vacuous
// ===========================================================================

test("C10-D2: recovery fires without transcript, then is suppressed when transcript carries the body", () => {
	// Without this positive control, the D2 test assertion (expect("") vacuously
	// passes even if recovery was never armed. This test shows recovery IS armed
	// (emits directive without transcript) before it is suppressed with transcript.
	// Removing the transcript-backstop check in static-injection.ts would make the
	// with-transcript branch still emit, catching the suppression regression.
	const sessionId = "c10d2-session";
	const { projectRoot, rulePath, ruleBody } = makeProjectWithStaticRule(
		"c10d2-rule.md",
		"C10-D2 BOULDER: positive control for D2 transcript backstop.",
	);

	// Arm the recovery pending state (same as D2 setup).
	runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId, projectRoot));

	// Positive control: no transcript → recovery directive IS emitted.
	const withoutTranscript = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(withoutTranscript.status).toBe(0);
	expect(additionalContext(withoutTranscript.stdout)).toContain("POST-COMPACTION RULE RECOVERY");

	// Re-arm for the suppression branch (a second session).
	const sessionId2 = "c10d2-session2";
	runHook("session-start", sessionStartPayload(sessionId2, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId2, projectRoot));

	// Suppression: transcript carries both the rule body and path marker → "".
	const transcriptPath = join(projectRoot, "transcript-c10d2.txt");
	writeFileSync(transcriptPath, `Instructions from: ${rulePath}\n\n${ruleBody}\n`);
	const withTranscript = runHook(
		"session-start",
		sessionStartPayload(sessionId2, projectRoot, { transcript_path: transcriptPath }),
	);
	expect(withTranscript.status).toBe(0);
	expect(additionalContext(withTranscript.stdout)).toBe("");
});

// ===========================================================================
// C10-D3 baseline — D3 suppression is non-vacuous
// ===========================================================================

test("C10-D3: UPS injects without pressure marker (baseline), then is suppressed with marker", () => {
	// The existing D3 test only checks the suppressed branch; without this
	// baseline the test would vacuously pass even if UPS never injects at all.
	// Removing the hasContextPressureMarker check in codex-hook.ts would cause
	// the suppressed branch to emit, making D3 RED while this baseline stays GREEN.
	const sessionId = "c10d3-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"c10d3-rule.md",
		"C10-D3 BOULDER: must appear in UPS without pressure, and be absent with pressure.",
	);

	// Baseline: a UPS without the pressure marker DOES inject.
	const baselineRun = runHook(
		"user-prompt-submit",
		userPromptPayload(sessionId, projectRoot, "continue working on the feature"),
	);
	expect(baselineRun.status).toBe(0);
	expect(additionalContext(baselineRun.stdout)).toContain("C10-D3 BOULDER");

	// Suppression: same UPS but prompt contains the pressure marker → empty.
	// Use a different session so dedup doesn't interfere.
	const sessionId2 = "c10d3-session2";
	const suppressedRun = runHook(
		"user-prompt-submit",
		userPromptPayload(sessionId2, projectRoot, "the model reported context_length_exceeded mid-turn"),
	);
	expect(suppressedRun.status).toBe(0);
	expect(additionalContext(suppressedRun.stdout)).toBe("");
});

// ===========================================================================
// P9 — spawn env is hermetic: PLUGIN_DATA is pinned to the hermetic data root
// ===========================================================================

test("P9: spawn env pins PLUGIN_DATA to the hermetic data root so external env cannot redirect state", () => {
	// The runHook helper spreads ...process.env before HOME and extraEnv.
	// If a parent process has PLUGIN_DATA set, it leaks into spawned hooks and
	// redirects where session state is read/written, breaking hermeticity.
	// This test verifies that passing PLUGIN_DATA in extraEnv correctly pins the
	// state root: the session-state file lands under hermDataRoot, not elsewhere.
	const sessionId = "p9-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"p9-rule.md",
		"P9 BOULDER: state must land in hermetic data root.",
	);
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");

	// Run hook with explicitly hermetic PLUGIN_DATA.
	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
	});
	expect(result.status).toBe(0);
	expect(additionalContext(result.stdout)).toContain("P9 BOULDER");

	// Session state must be written under hermDataRoot, not under any external path.
	const statePath = join(hermDataRoot, `${sessionId}.json`);
	expect(existsSync(statePath)).toBe(true);

	// The state file must be valid JSON — confirming it is a real cache entry,
	// not an accidental directory or empty file at the hermetic path.
	expect(() => JSON.parse(readFileSync(statePath, "utf8"))).not.toThrow();
});

// ===========================================================================
// F11 — ~/.claude/rules is excluded by DEFAULT_AUTO_DISABLED_SOURCES (behavioral)
// ===========================================================================

test("F11: a rule planted under ~/.claude/rules is not injected by session-start", () => {
	// Proves the behavioral effect of DEFAULT_AUTO_DISABLED_SOURCES excluding
	// "~/.claude/rules": even if the file exists and has alwaysApply:true, its
	// body must not appear in additionalContext. Removing "~/.claude/rules" from
	// DEFAULT_AUTO_DISABLED_SOURCES would make this test RED.
	const sessionId = "f11-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"f11-proj-rule.md",
		"F11 PROJ BOULDER: project rule must appear.",
	);

	// Plant a rule under the hermetic HOME's ~/.claude/rules directory.
	const claudeRulesDir = join(tempHome, ".claude", "rules");
	mkdirSync(claudeRulesDir, { recursive: true });
	writeFileSync(
		join(claudeRulesDir, "f11-home-rule.md"),
		"---\nalwaysApply: true\n---\nF11 HOME BOULDER: this must NOT appear in additionalContext.\n",
	);

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(result.status).toBe(0);
	const context = additionalContext(result.stdout);

	// Project rule IS injected (positive control — confirms injection works).
	expect(context).toContain("F11 PROJ BOULDER");
	// Home rule is excluded due to DEFAULT_AUTO_DISABLED_SOURCES.
	expect(context).not.toContain("F11 HOME BOULDER");
});

// ===========================================================================
// AC1 — header bytes must be in budget: all-bodies-dropped => no header-only block
// ===========================================================================

// Import the formatter directly for unit-level assertions (no CLI spawn needed).
// These tests prove the D-5/D-6 contract: per-rule/block header bytes are charged
// to the budget before bodies. When no body survives, the block emits nothing.
import { formatStaticBlock, formatDynamicBlock } from "./rules/formatter.js";
import { transcriptHasContextPressureMarker } from "./context-pressure.js";
import type { LoadedRule } from "./rules/types.js";

/** Minimal LoadedRule fixture for formatter unit tests. */
function makeRule(overrides: { path?: string; relativePath?: string; body?: string }): LoadedRule {
	return {
		path: overrides.path ?? "/proj/.claude/rules/test.md",
		realPath: overrides.path ?? "/proj/.claude/rules/test.md",
		relativePath: overrides.relativePath ?? ".claude/rules/test.md",
		body: overrides.body ?? "rule body content",
		source: ".claude/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		contentHash: "abc123",
		matchReason: "alwaysApply",
		frontmatter: { alwaysApply: true },
	};
}

test("AC1-static: when budget fits header but not body, formatStaticBlock emits nothing and emittedRules is empty", () => {
	// Rule body = 200 chars. Header = "Instructions from: /p/r.md\n\n" = 28 chars.
	// Truncation notice for "r.md" = "\n\n[Truncated. Full: r.md]" = 26 chars.
	// Budget = 50: header overhead (28) leaves bodyOnlyBudget = 22.
	// truncateBudget: remaining(22) <= notice(26) => break => body is completely dropped.
	// Under the old code, truncateBudget never saw the header, so the 50-char budget
	// fit partial body — the header was added on top, producing a ghost block.
	// Under the new contract, header is charged first: all-bodies-dropped => nothing emits.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatStaticBlock([rule], { maxRuleChars: 200, maxResultChars: 50 });
	// Under the new contract, result is { text: string; emittedRules: LoadedRule[] }
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

test("AC1-dynamic: when budget fits header but not body, formatDynamicBlock emits nothing and emittedRules is empty", () => {
	// Same budget arithmetic as AC1-static: budget=50, header=28, bodyOnlyBudget=22 <= notice(26).
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatDynamicBlock([rule], "src/x.ts", { maxRuleChars: 200, maxResultChars: 50 });
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

// ===========================================================================
// AC2 — emittedRules only contains rules whose body is in the output
// ===========================================================================

test("AC2-static: emittedRules contains only rules that survived budget (not all input rules)", () => {
	// Two rules. Headers: r1.md=29, r2.md=29 => totalHeaderOverhead=58.
	// Budget=110: bodyOnlyBudget=52. rule1 body="A"*50 fits (remaining=2 after).
	// rule2 body: perRuleResultChars=55, truncateRule("B"*300,55)="B"*28+notice(27)=55 chars.
	// truncateBudget: remaining=2 <= notice(27) => break => rule2 body completely dropped.
	// emittedRules must contain only rule1, not rule2.
	const rule1 = makeRule({ path: "/p/r1.md", relativePath: "r1.md", body: "A".repeat(50) });
	const rule2 = makeRule({ path: "/p/r2.md", relativePath: "r2.md", body: "B".repeat(300) });
	const result = formatStaticBlock([rule1, rule2], { maxRuleChars: 300, maxResultChars: 110 });
	expect(result.emittedRules).toHaveLength(1);
	expect(result.emittedRules[0]?.path).toBe("/p/r1.md");
	expect(result.text).toContain("A".repeat(50));
	// rule2 body is entirely absent (not even a truncated fragment).
	expect(result.text).not.toContain("B");
});

test("AC2-dynamic: emittedRules contains only rules that survived budget", () => {
	// Same budget arithmetic as AC2-static.
	const rule1 = makeRule({ path: "/p/r1.md", relativePath: "r1.md", body: "A".repeat(50) });
	const rule2 = makeRule({ path: "/p/r2.md", relativePath: "r2.md", body: "B".repeat(300) });
	const result = formatDynamicBlock([rule1, rule2], "src/x.ts", { maxRuleChars: 300, maxResultChars: 110 });
	expect(result.emittedRules).toHaveLength(1);
	expect(result.emittedRules[0]?.path).toBe("/p/r1.md");
});

test("AC2-static: emittedRules is empty when all rules fit but no rules supplied", () => {
	const result = formatStaticBlock([], { maxRuleChars: 1000, maxResultChars: 1000 });
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

test("AC2-static: emittedRules contains rule even when its body is truncated (partial body is still emitted)", () => {
	// A rule whose body is truncated (partial) still appears in emittedRules — it was partially emitted.
	// Only fully-dropped (zero body) rules are excluded.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "C".repeat(500) });
	// Budget enough to emit partial body (truncation notice will be appended).
	// Header ~28 chars + some body chars + truncation notice.
	const result = formatStaticBlock([rule], { maxRuleChars: 200, maxResultChars: 300 });
	// Body is partially emitted (truncated). Rule should appear in emittedRules.
	expect(result.emittedRules).toHaveLength(1);
	expect(result.emittedRules[0]?.path).toBe("/p/r.md");
	expect(result.text).toContain("C"); // some body content present
});

// ===========================================================================
// C4-CJK — byte cap enforced for multi-byte (UTF-8) content
// ===========================================================================

test("C4-CJK: over-budget CJK rule body is capped to <= 32K bytes (not chars)", () => {
	// "가" is 3 UTF-8 bytes. 20_000 repetitions = 20_000 chars but 60_000 bytes.
	// A char-based cap (e.g. <= 32_000 chars) would pass this through uncapped,
	// but hook-output.ts uses Buffer.byteLength. Reverting to char-based slicing
	// would emit ~60K bytes of UTF-8 and make this test RED.
	const sessionId = "c4-cjk-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"c4-cjk-rule.md",
		// 20K Korean chars = 60K UTF-8 bytes — char count is well under 32K but
		// byte count is well over. The byte cap is the only guard that fires here.
		"가".repeat(20_000),
	);

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		CODEX_RULES_MAX_RULE_CHARS: "60000",
		CODEX_RULES_MAX_RESULT_CHARS: "60000",
	});
	expect(result.status).toBe(0);
	const emitted = additionalContext(result.stdout);
	expect(emitted.length).toBeGreaterThan(0);

	// The critical assertion: UTF-8 byte length must be within the 32K cap.
	// This would fail if sliceToUtf8Bytes were replaced with a plain char slice.
	expect(Buffer.byteLength(emitted, "utf8")).toBeLessThanOrEqual(32_000);
});

// ===========================================================================
// AC1 — C-5: budget-dropped rules must not be permanently suppressed
// ===========================================================================

test("AC1-C5: a rule dropped by budget on SessionStart is re-injected on the subsequent UserPromptSubmit (not permanently suppressed)", () => {
	// Scenario: one large rule, SessionStart budget so tight the body is dropped (body-zero).
	// Under the bug (engine.formatStatic returns string + marks all input rules as injected):
	//   the rule gets marked injected even though nothing was emitted → permanent suppression.
	// Fix: call formatStaticBlock and mark only emittedRules (empty when body is dropped).
	//
	// Why UPS instead of a second SessionStart?
	//   source="startup" triggers clearSessionState on every startup run, which wipes the
	//   injected marks before the bug's suppression can take effect. UPS (UserPromptSubmit)
	//   hydrates the persisted state directly — so the bug's spurious mark IS observable.
	//
	// Budget arithmetic: maxResultChars=10, one rule, any temp path.
	//   bodyOnlyBudget = max(0, 10 - ruleHeaderLength(path)) = 0 (header >> 10).
	//   truncateBudget(maxResultChars=0): remainingBudget=0 ≤ notice → break → rule dropped.
	//   emittedRules = [] → bug marks all input rules; fix marks nothing.
	const sessionId = "ac1-c5-session";

	const projectRoot = makeScratchDir("r-"); // short prefix to minimize path variance
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });
	const ruleBody = "AC1-C5-RULE-BODY: " + "Y".repeat(1000);
	writeFileSync(join(rulesDir, "ac1rule.md"), `---\nalwaysApply: true\n---\n${ruleBody}\n`);

	// Tight budget: header alone exhausts the budget → rule body is zero → rule dropped.
	const tightEnv = {
		CODEX_RULES_MAX_RULE_CHARS: "5000",
		CODEX_RULES_MAX_RESULT_CHARS: "10",
	};

	// SessionStart (source="startup") with tight budget → rule budget-dropped.
	// additionalContext is empty. Under the bug: rule marked as injected in persisted state.
	// Under the fix: emittedRules=[] → nothing marked → rule absent from persisted state.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot), tightEnv);
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toBe("");

	// UserPromptSubmit (open budget): hydrates persisted state.
	// Under the bug: rule is already marked → filtered out → empty output.
	// Under the fix: rule not marked → injected here.
	const second = runHook(
		"user-prompt-submit",
		userPromptPayload(sessionId, projectRoot, "continue", {}),
		{
			CODEX_RULES_MAX_RULE_CHARS: "5000",
			CODEX_RULES_MAX_RESULT_CHARS: "50000",
		},
	);
	expect(second.status).toBe(0);
	expect(additionalContext(second.stdout)).toContain("AC1-C5-RULE-BODY");
});

// ===========================================================================
// AC3 — C-4: post-compact body block + directive share one budget
// ===========================================================================

test("AC3-C4: post-compact body block + directive share the budget (no double-charge)", () => {
	// Scenario: one never-truncated rule (hephaestus.md → goes into bodyBlock) and TWO
	// regular listed rules (go into directive path list). Budget is set so that:
	//   - hephaestus body block consumes ~500 chars of maxResultChars=600
	//   - remaining for directive = 100 chars
	//   - The MANDATORY directive header+footer alone = ~373 chars.
	//   - path1 is always added (lines.length===0 check bypasses budget).
	//   - path2: under shared budget (remaining=100), usedChars already >> 100 → omitted.
	//   - path2: under double-charge bug (directive gets full 600), 373+path1+path2 ≈ 560 < 600 → included.
	//
	// Verification: path2 appears under bug but NOT under fix.
	//
	// Constants:
	//   DIRECTIVE_HEADER = 329 chars, DIRECTIVE_FOOTER = 130 chars, usedChars_init = 459
	//   Each listed rule path ≈ 90 chars (temp path), line ≈ 92 chars.
	//   After path1: usedChars ≈ 459+92+1 = 552.
	//   Bug: maxChars=700, 552+92+1=645 < 700 → path2 included.
	//   Fix: maxChars=700-bodyBlockLen≈190; 552 >> 190 → path2 omitted.
	const sessionId = "ac3-c4-session";

	const projectRoot = makeScratchDir("ac3c4-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });

	// hephaestus.md: never-truncated, body consumes most of the budget.
	// Body 400 chars. Block = "## Project Instructions\n\nInstructions from: <path>\n\n<body>" ≈ 500 chars.
	const hephBody = "HEPHAESTUS-BODY: " + "H".repeat(383);
	writeFileSync(join(rulesDir, "hephaestus.md"), `---\nalwaysApply: true\n---\n${hephBody}\n`);

	// Two regular listed rules (not never-truncated) → go into directive path list.
	writeFileSync(join(rulesDir, "listed1.md"), "---\nalwaysApply: true\n---\nLISTED1 RULE BODY\n");
	writeFileSync(join(rulesDir, "listed2.md"), "---\nalwaysApply: true\n---\nLISTED2 RULE BODY\n");

	const listed2Path = join(rulesDir, "listed2.md");

	// First SessionStart: all three rules injected and marked.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);

	// PostCompact: clears dedup, arms recovery.
	const compact = runHook("post-compact", postCompactPayload(sessionId, projectRoot));
	expect(compact.status).toBe(0);

	// Recovery with maxResultChars=700: hephaestus body block ≈ 510 chars.
	// Under the fix: remaining for directive = 700-510 = 190 → path2 omitted (usedChars ~552 > 190).
	// Under the bug: directive gets full 700 → usedChars ~552 + path2(~92) = 644 < 700 → path2 included.
	const recovery = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS: "5000",
		CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS: "700",
	});
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);

	// Hephaestus body appears in the body block.
	expect(recovered).toContain("HEPHAESTUS-BODY");

	// path2 (listed2.md) must NOT appear in the directive: shared budget is exhausted
	// by the body block, leaving too little for path2.
	// Under the double-charge bug, path2 WOULD appear since directive gets full 600 chars.
	expect(recovered).not.toContain(listed2Path);
});

// ===========================================================================
// AC11 — C-7: dynamic recovery uses body-needle, not path-presence
// ===========================================================================

// ===========================================================================
// B-11 — stale compaction marker must not suppress current-turn injection
// ===========================================================================

test("B-11: a stale 'context compacted' marker followed by new activity does not suppress injection", () => {
	// Bug: transcriptHasContextPressureMarker scans the full transcript, so an old
	// "context compacted" marker from a historical compaction event returns true and
	// suppresses the current turn — even though new turns have occurred since then.
	// Fix: scope detection to the latest compaction; if content follows the last
	// marker, the marker is stale and must not suppress injection.
	const { projectRoot } = makeProjectWithStaticRule(
		"b11-rule.md",
		"B-11 BOULDER: must appear when compaction marker is historical.",
	);

	// Transcript: old compaction at the top, followed by several new conversation turns.
	const transcriptPath = join(projectRoot, "transcript-b11.txt");
	writeFileSync(
		transcriptPath,
		[
			"[context compacted to fit the context window]",
			"",
			"Human: continue working on the feature",
			"",
			"Assistant: Sure, let me proceed.",
			"",
			"Human: now add the next step",
			"",
			"Assistant: Done, here is what I changed.",
		].join("\n"),
	);

	// transcriptHasContextPressureMarker should return false: the compaction marker
	// is stale (new turns follow it), so there is no current context pressure.
	expect(transcriptHasContextPressureMarker(transcriptPath)).toBe(false);
});

test("B-11-baseline: a compaction marker at the end of the transcript IS current pressure (suppresses injection)", () => {
	// Positive control: if the compaction marker is the last meaningful content,
	// the compaction is current and should suppress injection.
	const { projectRoot } = makeProjectWithStaticRule(
		"b11b-rule.md",
		"B-11 BASELINE BOULDER: compaction at the end is current pressure.",
	);

	const transcriptPath = join(projectRoot, "transcript-b11b.txt");
	writeFileSync(
		transcriptPath,
		[
			"Human: do something",
			"",
			"Assistant: here is the result.",
			"",
			"[context compacted to fit the context window]",
		].join("\n"),
	);

	// The marker is at the end (no subsequent activity) → current pressure → true.
	expect(transcriptHasContextPressureMarker(transcriptPath)).toBe(true);
});

test("AC11-C7: dynamic recovery re-injects a rule whose path is in transcript but body is not", () => {
	// Scenario: dynamic rule was injected in a previous turn. Post-compact fires.
	// Transcript contains the rule's "Instructions from: <path>" marker BUT NOT the body.
	// Under the path-presence bug (transcriptText.includes(rulePath)), the path mention
	// means "already in context" → rule is skipped → permanent loss.
	// Under body-needle fix, body absent → rule path included in recovery directive.
	//
	// We seed the session state directly (via JSON file) to simulate that a dynamic rule
	// was previously injected — bypassing CLI round-trips that require globs matching.
	// The session state has:
	//   - dynamicDedup: { "__pi-rules-session__": ["<rulePath>::<hash>"] }
	//   - postCompactPending: { static: "pending" } (so recovery runs on next SessionStart)
	//
	// Transcript carries "Instructions from: <rulePath>" but NOT the rule body.
	//
	// Bug: transcriptText.includes(rulePath) = true → dynamic rule skipped from directive.
	// Fix: isDynamicRuleBodyInTranscript checks body presence → body absent → included.
	const sessionId = "ac11-c7-session";
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");

	const projectRoot = makeScratchDir("ac11c7-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });

	// Static rule: needed so SessionStart has at least one rule, triggering recovery path.
	writeFileSync(join(rulesDir, "static.md"), "---\nalwaysApply: true\n---\nSTATIC RULE BODY\n");

	// The dynamic rule whose body was dropped from the compacted transcript.
	const dynamicRulePath = join(rulesDir, "dynamic.md");
	const dynamicRuleBody = "DYNAMIC-RULE-BODY: special instructions for TypeScript files.";
	writeFileSync(dynamicRulePath, `---\nglobs: "**/*.ts"\n---\n${dynamicRuleBody}\n`);

	// Seed the session state JSON directly.
	// Format: { version: 1, staticDedup: [], dynamicDedup: { "__pi-rules-session__": ["<path>::<hash>"] },
	//           postCompactPending: { static: "pending" } }
	// The hash can be any non-empty string; recoverDynamicRulePaths only parses the path from the key.
	mkdirSync(hermDataRoot, { recursive: true });
	const cachePath = join(hermDataRoot, `${sessionId}.json`);
	writeFileSync(
		cachePath,
		JSON.stringify({
			version: 1,
			staticDedup: [],
			dynamicDedup: {
				"__pi-rules-session__": [`${dynamicRulePath}::deadbeef`],
			},
			postCompactPending: { static: true, dynamic: true },
		}) + "\n",
	);

	// Create a transcript that contains the "Instructions from: <rulePath>" marker
	// BUT NOT the rule body — simulating a compacted summary that referenced the path
	// header but dropped the body.
	// Under path-presence bug: transcriptText.includes(rulePath) is true → skip.
	// Under body-needle fix: body not in transcript → include in directive.
	const transcriptPath = join(projectRoot, "transcript-c7.txt");
	writeFileSync(
		transcriptPath,
		`Instructions from: ${dynamicRulePath}\n\n[body was here but compaction dropped it]\n`,
	);

	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId, projectRoot, { transcript_path: transcriptPath }),
		{ PLUGIN_DATA: hermDataRoot },
	);
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);

	// The dynamic rule path must appear in the directive because the body is absent
	// from the transcript (body-needle check fails → rule must be re-injected).
	expect(recovered).toContain(dynamicRulePath);
});

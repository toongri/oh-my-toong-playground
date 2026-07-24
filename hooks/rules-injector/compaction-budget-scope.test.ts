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
	const rulesDir = join(projectRoot, ".codex", "rules");
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
	// F-1: pin PLUGIN_DATA to the hermetic data root by default so spawned hooks
	// cannot inherit an ambient PLUGIN_DATA from the parent process and redirect
	// session-state reads/writes outside the hermetic tempHome. extraEnv overrides
	// if a test wants to supply its own hermDataRoot (e.g. C2, B-2, P9).
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", sub], {
		input: JSON.stringify(payload),
		env: { ...process.env, HOME: tempHome, PLUGIN_DATA: hermDataRoot, ...extraEnv },
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
	const { projectRoot, ruleBody } = makeProjectWithStaticRule(
		"d2-rule.md",
		"D2 BOULDER: the transcript already remembers this directive end to end.",
	);

	runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId, projectRoot));

	// Transcript carries both the rule body needle AND the new XML open tag for
	// this rule — the backstop's recognition signature.
	const transcriptPath = join(projectRoot, "transcript.txt");
	writeFileSync(transcriptPath, `<rules name="d2-rule">\n${ruleBody}\n</rules>\n`);

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
		userPromptPayload(
			sessionId,
			projectRoot,
			"the model reported context_length_exceeded mid-turn",
		),
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

test("E1b: the truncated output still carries the rule name as a read pointer", () => {
	const sessionId = "e1b-session";
	const { projectRoot } = makeProjectWithStaticRule("e1b-rule.md", "X".repeat(50_000));

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot), {
		CODEX_RULES_MAX_RULE_CHARS: "60000",
		CODEX_RULES_MAX_RESULT_CHARS: "60000",
	});
	expect(result.status).toBe(0);
	const emitted = additionalContext(result.stdout);
	// The XML open tag `<rules name="e1b-rule">` sits at the very top of the rule's
	// section and survives the 32K byte head slice, identifying the rule to the reader.
	expect(emitted).toContain('<rules name="e1b-rule">');
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
	const second = runHook(
		"user-prompt-submit",
		userPromptPayload(sessionId, projectRoot, "continue"),
	);
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

test("F2: DEFAULT_AUTO_DISABLED_SOURCES does NOT exclude ~/.claude/rules (the conditional supersede lives in finder.ts, not this static list)", () => {
	// Codex has a native rules sync category, so a de-Claude-ified counterpart
	// USUALLY lands at ~/.codex/rules — but not always: a project that never ran
	// OMT's sync has no ~/.codex/rules at all. Unconditionally excluding
	// ~/.claude/rules here would lose rules entirely on such a project, so this
	// list no longer carries that decision. findRuleCandidates (finder.ts) drops
	// ~/.claude/rules ONLY when ~/.codex/rules is ALSO present — see F11 below,
	// which confirms that conditional behavior end-to-end.
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain("~/.claude/rules");
});

test("F2: DEFAULT_AUTO_DISABLED_SOURCES does NOT exclude ~/.codex/rules (the codex-native replacement)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain("~/.codex/rules");
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
	const lines = readFileSync(log, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
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
// B-2 — disabled kill-switch pre-gates PostCompact: no session-state write
// ===========================================================================

test("B-2: a disabled PostCompact does not write session state (no-op exit 0)", () => {
	// SessionStart and UserPromptSubmit both early-return on config.disabled BEFORE
	// touching session state. PostCompact omitted this guard: runPostCompactHook called
	// markSessionCompacted unconditionally, which writes <sid>.json (arming recovery,
	// wiping staticDedup) even when the kill-switch is on. With the rules engine disabled
	// nothing will ever consume that armed state, so the write is pure pollution.
	// Fix: pre-gate runPostCompactHook on config.disabled and return "" without writing.
	const sessionId = "b2-disabled-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"b2-rule.md",
		"B-2 BOULDER: disabled post-compact must not write.",
	);
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");
	const statePath = join(hermDataRoot, `${sessionId}.json`);

	const compact = runHook("post-compact", postCompactPayload(sessionId, projectRoot), {
		PLUGIN_DATA: hermDataRoot,
		CODEX_RULES_DISABLED: "1",
	});
	expect(compact.status).toBe(0);
	expect(compact.stdout.trim()).toBe("");

	// Under the bug, markSessionCompacted creates the session-state file. Under the fix,
	// the disabled pre-gate returns before any write, so no file exists.
	expect(existsSync(statePath)).toBe(false);
});

// ===========================================================================
// F-8 — PostToolUse (dynamic lane) is no-op under CODEX_RULES_DISABLED
// ===========================================================================

test("F-8: PostToolUse emits nothing under CODEX_RULES_DISABLED=1 (dynamic lane disabled-gate)", () => {
	// Proves: codex-hook.ts runPostToolUseHook pre-gates on config.disabled and
	// returns "" before any path extraction or state write. Removing the
	// disabled-check in runPostToolUseHook would cause the hook to proceed to path
	// extraction and potentially inject rules, making this test RED.
	const sessionId = "f8-session";
	const statePath = join(tempHome, ".omt", "rules-injector", `${sessionId}.json`);
	const projectRoot = makeScratchDir("f8-proj-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".codex", "rules");
	mkdirSync(rulesDir, { recursive: true });
	// A glob rule that would fire on src/x.ts if the kill-switch were absent.
	writeFileSync(
		join(rulesDir, "f8-dynamic.md"),
		`---\nglobs: ["**/*.ts"]\n---\nF-8 DYNAMIC BOULDER: must not appear under kill-switch.\n`,
	);
	const srcDir = join(projectRoot, "src");
	mkdirSync(srcDir, { recursive: true });
	writeFileSync(join(srcDir, "x.ts"), "export const x = 1;\n");

	const result = runHook(
		"post-tool-use",
		{
			hook_event_name: "PostToolUse",
			session_id: sessionId,
			turn_id: "t1",
			transcript_path: null,
			cwd: projectRoot,
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "Bash",
			tool_use_id: "u-f8",
			tool_input: { command: "cat src/x.ts" },
			tool_response: {},
		},
		{ CODEX_RULES_DISABLED: "1" },
	);

	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe("");
	expect(additionalContext(result.stdout)).toBe("");
	// No-state-mutation guard: the disabled pre-gate must return before any state
	// write. Removing the disabled check would allow sessionCachePath to be written.
	// Mirrors the B-2 pattern (compaction-budget-scope.test.ts:421).
	expect(existsSync(statePath)).toBe(false);
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
	const { projectRoot, ruleBody } = makeProjectWithStaticRule(
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

	// Suppression: transcript carries both the rule body and the XML open tag → "".
	const transcriptPath = join(projectRoot, "transcript-c10d2.txt");
	writeFileSync(transcriptPath, `<rules name="c10d2-rule">\n${ruleBody}\n</rules>\n`);
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
		userPromptPayload(
			sessionId2,
			projectRoot,
			"the model reported context_length_exceeded mid-turn",
		),
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
// F11 — ~/.claude/rules is superseded by ~/.codex/rules when both are present
// (finder.ts's existence-conditional supersede, not a static disabled list)
// ===========================================================================

test("F11: a rule planted under ~/.claude/rules is NOT injected, but the same rule under ~/.codex/rules IS", () => {
	// rules is now a supported codex sync category: the de-Claude-ified
	// counterpart of a global rule lands at ~/.codex/rules. When BOTH
	// ~/.claude/rules and ~/.codex/rules exist, findRuleCandidates (finder.ts)
	// drops the raw ~/.claude/rules candidate in favor of its codex-native
	// counterpart — reading it directly would leak unrewritten Claude
	// vocabulary into Codex sessions. Restoring ~/.claude/rules discovery
	// (or dropping the codex counterpart below) would make the first
	// assertion below RED.
	const sessionId = "f11-session";
	const { projectRoot } = makeProjectWithStaticRule(
		"f11-proj-rule.md",
		"F11 PROJ BOULDER: project rule must appear.",
	);

	// Plant a rule under the hermetic HOME's ~/.claude/rules directory — must NOT surface.
	const claudeRulesDir = join(tempHome, ".claude", "rules");
	mkdirSync(claudeRulesDir, { recursive: true });
	writeFileSync(
		join(claudeRulesDir, "f11-home-rule.md"),
		"---\nalwaysApply: true\n---\nF11 HOME BOULDER: raw Claude source must NOT appear.\n",
	);

	// Plant the de-Claude-ified counterpart under ~/.codex/rules — must surface.
	const codexRulesDir = join(tempHome, ".codex", "rules");
	mkdirSync(codexRulesDir, { recursive: true });
	writeFileSync(
		join(codexRulesDir, "f11-home-rule.md"),
		"---\nalwaysApply: true\n---\nF11 HOME CODEX BOULDER: this MUST appear in additionalContext.\n",
	);

	const result = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(result.status).toBe(0);
	const context = additionalContext(result.stdout);

	// Project rule IS injected (positive control — confirms injection works).
	expect(context).toContain("F11 PROJ BOULDER");
	// Raw Claude home source is disabled by default — no longer injected.
	expect(context).not.toContain("F11 HOME BOULDER");
	// Codex-native home source replaces it.
	expect(context).toContain("F11 HOME CODEX BOULDER");
});

// ===========================================================================
// AC1 — header bytes must be in budget: all-bodies-dropped => no header-only block
// ===========================================================================

// Import the formatter directly for unit-level assertions (no CLI spawn needed).
// These tests prove the D-5/D-6 contract: per-rule/block header bytes are charged
// to the budget before bodies. When no body survives, the block emits nothing.
import { formatStaticBlock, formatDynamicBlock } from "./rules/formatter.js";
import { transcriptHasContextPressureMarker } from "./context-pressure.js";
import { filterRulesNotInTranscriptText } from "./transcript-rule-filter.js";
import type { LoadedRule } from "./rules/types.js";

/** Minimal LoadedRule fixture for formatter unit tests. */
function makeRule(overrides: {
	path?: string;
	relativePath?: string;
	body?: string;
	contentHash?: string;
}): LoadedRule {
	return {
		path: overrides.path ?? "/proj/.claude/rules/test.md",
		realPath: overrides.path ?? "/proj/.claude/rules/test.md",
		relativePath: overrides.relativePath ?? ".claude/rules/test.md",
		body: overrides.body ?? "rule body content",
		source: ".claude/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		contentHash: overrides.contentHash ?? "abc123",
		matchReason: "alwaysApply",
		frontmatter: { alwaysApply: true },
	};
}

test("AC1-static: when budget fits header but not body, formatStaticBlock emits nothing and emittedRules is empty", () => {
	// Rule body = 200 chars. Path "/p/r.md" → name "r".
	// XML header overhead: "<rules name=\"r\">\n\n</rules>" = 26 chars.
	// Truncation notice for "r.md" = "\n\n[Truncated. Full: r.md]" = 26 chars.
	// Budget = 50: header overhead (26) leaves bodyOnlyBudget = 24.
	// truncateBudget: remaining(24) <= notice(26) => break => body is completely dropped.
	// Under the new contract, header is charged first: all-bodies-dropped => nothing emits.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatStaticBlock([rule], { maxRuleChars: 200, maxResultChars: 50 });
	// Under the new contract, result is { text: string; emittedRules: LoadedRule[] }
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

test("AC1-dynamic: when budget fits header but not body, formatDynamicBlock emits nothing and emittedRules is empty", () => {
	// Same budget arithmetic as AC1-static: budget=50, header=26, bodyOnlyBudget=24 <= notice(26).
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatDynamicBlock([rule], "src/x.ts", { maxRuleChars: 200, maxResultChars: 50 });
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

// ===========================================================================
// AC2 — emittedRules only contains rules whose body is in the output
// ===========================================================================

test("AC2-static: emittedRules contains only rules that survived budget (not all input rules)", () => {
	// Two rules. XML header overhead per rule: "<rules name=\"rN\">\n\n</rules>" = 27 chars each.
	// Budget=110. Rule1 body="A"*50: bodyBudget = 110-27 = 83. 50 < 83 → fits. remaining = 33.
	// Rule2: bodyBudget = 33-27 = 6. Truncation notice for "r2.md" = ~27 chars. 6 < 27 → dropped.
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
	const result = formatDynamicBlock([rule1, rule2], "src/x.ts", {
		maxRuleChars: 300,
		maxResultChars: 110,
	});
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
// C12 — header overhead exceeds budget → rule dropped (no ghost block)
// ===========================================================================

test("C12: a rule whose XML header overhead alone exceeds the budget is dropped (not emitted over-cap)", () => {
	// Fixture: path "/proj/.claude/rules/some-rule.md", body "X".
	// XML header overhead: ruleHeaderLength = "<rules name=\"some-rule\">\n\n</rules>".length = 34.
	// maxResultChars=20: budget(20) < headerLen(34) → bodyBudget ≤ 0 → rule dropped.
	// This verifies that the full XML overhead is charged before the body, so a rule that
	// cannot fit its header is entirely dropped (no open-tag-only ghost block).
	const rule = makeRule({
		path: "/proj/.claude/rules/some-rule.md",
		relativePath: ".claude/rules/some-rule.md",
		body: "X",
	});
	const result = formatStaticBlock([rule], { maxRuleChars: 100, maxResultChars: 20 });
	expect(result.emittedRules).toHaveLength(0);
	expect(result.text).toBe("");
	expect(result.text.length).toBeLessThanOrEqual(20);
});

// ===========================================================================
// C5 — first-rule guard: pre-sum starvation must not suppress rule[0] that fits
// ===========================================================================

test("C5: when pre-summed headers would zero the body budget, the first rule still emits if its own body fits", () => {
	// Per-rule XML header `<rules name="rule-N">\n\n</rules>` = 31 chars (basename-derived; hash plays no role).
	// 8 rules → pre-sum = 248. maxResultChars=500: incremental charge → rule[0] sees 500-31=469 body budget → 40-char body fits.
	const rules = Array.from({ length: 8 }, (_, i) =>
		makeRule({
			path: `/proj/.claude/rules/rule-${i}.md`,
			relativePath: `.claude/rules/rule-${i}.md`,
			body: "B".repeat(40),
		}),
	);
	const result = formatStaticBlock(rules, { maxRuleChars: 4000, maxResultChars: 500 });
	expect(result.emittedRules.length).toBeGreaterThanOrEqual(1);
	expect(result.text).toContain("B".repeat(40));
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
	// Boundary-safety: a naive buf.subarray(0, maxBytes).toString("utf8") sliced
	// mid-codepoint would emit U+FFFD replacement chars. Pin the contract.
	expect(emitted).not.toContain("�");
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
	const rulesDir = join(projectRoot, ".codex", "rules");
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
// B-5 — dynamic-lane budget-dropped rule must not be permanently suppressed
// ===========================================================================

test("B-5: a dynamic rule dropped by budget on PostToolUse is re-injected on the next PostToolUse (not permanently suppressed)", () => {
	// Dynamic-lane analogue of AC1-C5. A glob rule matched by a Bash cat command is
	// budget-dropped (body zero) on the first PostToolUse, so nothing is emitted.
	// Under the bug, codex-hook marks ALL loaded rules dynamic-injected (formatDynamic
	// returns a string and the marking loop iterates the full rules array), so the
	// persisted dynamicDedup permanently suppresses the rule. A second PostToolUse with
	// an open budget would then emit nothing.
	// Fix: consume formatDynamicBlock's emittedRules and mark only those. A budget-dropped
	// rule (emittedRules=[]) is not marked, so the open-budget run re-injects it.
	const sessionId = "b5-session";

	const projectRoot = makeScratchDir("b5-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".codex", "rules");
	mkdirSync(rulesDir, { recursive: true });
	const ruleBody = "B5-DYNAMIC-RULE-BODY: " + "Z".repeat(1000);
	writeFileSync(join(rulesDir, "b5rule.md"), `---\nglobs: ["**/*.ts"]\n---\n${ruleBody}\n`);
	mkdirSync(join(projectRoot, "src"), { recursive: true });
	writeFileSync(join(projectRoot, "src", "x.ts"), "export const x = 1;\n");

	const postToolPayload = (
		env: Record<string, string>,
	): { payload: Record<string, unknown>; env: Record<string, string> } => ({
		payload: {
			hook_event_name: "PostToolUse",
			session_id: sessionId,
			turn_id: "t1",
			transcript_path: null,
			cwd: projectRoot,
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "Bash",
			tool_use_id: "u-b5",
			tool_input: { command: "cat src/x.ts" },
			tool_response: {},
		},
		env,
	});

	// First PostToolUse: dynamic budget so tight the header alone exhausts it → body
	// dropped → nothing emitted. Under the bug the rule is marked injected anyway.
	const tight = postToolPayload({ CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS: "10" });
	const first = runHook("post-tool-use", tight.payload, tight.env);
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toBe("");

	// Second PostToolUse (open budget): under the fix the rule was never marked, so it
	// is injected here. Under the bug it stays suppressed → empty output.
	const open = postToolPayload({ CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS: "50000" });
	const second = runHook("post-tool-use", open.payload, open.env);
	expect(second.status).toBe(0);
	expect(additionalContext(second.stdout)).toContain("B5-DYNAMIC-RULE-BODY");
});

// ===========================================================================
// B-6 — dynamic byte-clamp survivor: rule whose marker falls past 32K clamp
//        must NOT be marked injected (no permanent suppression)
// ===========================================================================

test("B-6: a dynamic rule whose marker falls past the 32K byte clamp is not marked injected and re-injects on the next PostToolUse", () => {
	// Two CJK glob rules matched by a Bash command. The char-budget (maxRuleChars /
	// maxResultChars) is generous enough for both rules to be included by the formatter.
	// Rule1 body is large enough (CJK chars = 3 UTF-8 bytes each) that rule1's section
	// alone nearly fills the 32K byte cap. Rule2's marker line therefore falls past the
	// 32K byte cut and is truncated by limitAdditionalContextText.
	//
	// Under the bug: codex-hook marks ALL emittedRules dynamic-injected before computing
	// what survives the byte clamp. Rule2 gets permanently suppressed even though its
	// marker was never actually emitted to Codex.
	//
	// Under the fix (mirrors static-injection.ts P2 guard):
	//   1. Compute the clamped output via limitAdditionalContextText(normalized block).
	//   2. Mark only rules whose ruleMarkerLine survives in that clamped string.
	//   Rule2's marker is absent from the clamped output → not marked → re-injects next turn.
	//
	// Byte arithmetic:
	//   "가" = 3 UTF-8 bytes. Rule1 body = 14 + 10_650×3 = 14 + 31_950 = 31_964 bytes.
	//   Block header ≈ 57 bytes. Rule1 section = 23 (open tag+\n) + 31_964 + 9 (\n</rules>) = 31_996.
	//   Total through rule1 = 57 + 31_996 = 32_053 bytes → past the 32K clamp.
	//   Rule2 open tag `<rules name="b6rule2">` starts at 32_055 → clipped → not marked.
	const sessionId = "b6-session";

	const projectRoot = makeScratchDir("b6-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".codex", "rules");
	mkdirSync(rulesDir, { recursive: true });
	mkdirSync(join(projectRoot, "src"), { recursive: true });
	writeFileSync(join(projectRoot, "src", "y.ts"), "export const y = 2;\n");

	// Rule1: large CJK body — fills the entire 32K byte cap.
	// Body: "B6-RULE1-HEAD: " (14 bytes) + 10_650 "가" (31_950 bytes) = 31_964 bytes.
	// Rule1 section: "<rules name=\"b6rule1\">\n" (23) + body (31_964) + "\n</rules>" (9) = 31_996 bytes.
	// With block header ("Additional project instructions ... src/y.ts:\n\n" ≈ 57 bytes):
	// total through rule1 = 57 + 31_996 = 32_053 bytes — past the 32K clamp.
	// Rule2 open tag (`<rules name="b6rule2">`) starts at 32_055 bytes → clipped → not marked.
	const rule1Body = "B6-RULE1-HEAD: " + "가".repeat(10_650);
	writeFileSync(join(rulesDir, "b6rule1.md"), `---\nglobs: ["**/*.ts"]\n---\n${rule1Body}\n`);

	// Rule2: short ASCII body — its marker lands past the 32K cap after rule1 fills it.
	const rule2Body = "B6-RULE2-BODY: must-re-inject";
	writeFileSync(join(rulesDir, "b6rule2.md"), `---\nglobs: ["**/*.ts"]\n---\n${rule2Body}\n`);

	const postToolPayload = (
		extraEnv: Record<string, string> = {},
	): { payload: Record<string, unknown>; env: Record<string, string> } => ({
		payload: {
			hook_event_name: "PostToolUse",
			session_id: sessionId,
			turn_id: "t1",
			transcript_path: null,
			cwd: projectRoot,
			model: "gpt-5.5",
			permission_mode: "default",
			tool_name: "Bash",
			tool_use_id: "u-b6",
			tool_input: { command: "cat src/y.ts" },
			tool_response: {},
		},
		env: {
			// Generous char budget: both rules fit without formatter truncation.
			// The only truncation is the 32K UTF-8 byte clamp in hook-output.ts.
			CODEX_RULES_DYNAMIC_MAX_RULE_CHARS: "50000",
			CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS: "100000",
			...extraEnv,
		},
	});

	// First PostToolUse: both rules are formatter-included, but rule2's marker is
	// truncated by the 32K byte clamp. Under the bug, both are marked injected.
	// Under the fix, only rule1 (whose marker survives the clamp) is marked.
	const first = postToolPayload();
	const firstResult = runHook("post-tool-use", first.payload, first.env);
	expect(firstResult.status).toBe(0);
	const firstCtx = additionalContext(firstResult.stdout);
	// The byte cap is enforced: output must not exceed 32K UTF-8 bytes.
	expect(Buffer.byteLength(firstCtx, "utf8")).toBeLessThanOrEqual(32_000);
	// Rule1's body is large enough to dominate the output.
	expect(firstCtx).toContain("B6-RULE1-HEAD");
	// Rule2's body (short ASCII) must NOT appear — the 32K clamp cuts before it.
	expect(firstCtx).not.toContain("B6-RULE2-BODY");

	// Second PostToolUse (same budget, new turn_id to avoid transcript dedup):
	// Under the fix: rule2 was never marked (marker absent from clamped output) → emitted here.
	// Under the bug: rule2 is already marked → permanently suppressed → empty for rule2.
	const second = postToolPayload({ CODEX_RULES_DYNAMIC_TURN_ID: "t2" });
	// turn_id override via env is not supported — pass it in payload overrides instead.
	const secondPayload = { ...second.payload, turn_id: "t2" };
	const secondResult = runHook("post-tool-use", secondPayload, second.env);
	expect(secondResult.status).toBe(0);
	const secondCtx = additionalContext(secondResult.stdout);
	// Rule2 must appear on the second run (it was not validly marked on the first).
	expect(secondCtx).toContain("B6-RULE2-BODY");
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
	const rulesDir = join(projectRoot, ".codex", "rules");
	mkdirSync(rulesDir, { recursive: true });

	// hephaestus.md: never-truncated, body consumes most of the budget.
	// Body 400 chars. Block = "## Project Instructions\n\n<rules name=\"hephaestus\">\n<body>\n</rules>" ≈ 480 chars.
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
	const rulesDir = join(projectRoot, ".codex", "rules");
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

// ===========================================================================
// A1 — notice-only rule (real body 0 bytes) must not be emitted or marked
// ===========================================================================

test("A1-static: a rule whose per-rule cap is below the truncation notice emits no body and is absent from emittedRules", () => {
	// Bug: when the per-rule result budget is smaller than the truncation notice
	// (~25 chars), truncateRule returns the notice string alone — zero real body.
	// Its length is > 0, so it slips past the `budgetedRule.body.length === 0`
	// drop in truncateRules and is appended to emittedRules. The caller then marks
	// it injected, persisting a dedup key that permanently suppresses the rule even
	// when the budget later grows.
	//
	// Budget arithmetic (one rule, path "/p/r.md", relativePath "r.md"):
	//   perRuleResultChars = floor(maxResultChars / 1) = 200.
	//   maxRuleChars = 20 → min(20, 200) = 20 < notice(25) → truncateRule returns
	//     the 25-char notice only (no real body bytes).
	//   XML header overhead for "/p/r.md" (name "r"): "<rules name=\"r\">\n\n</rules>" = 26 chars.
	//   bodyOnlyBudget = 200-26 = 174. truncateBudget: remaining(174) >= body(25) → notice passes through.
	//   Under the bug: body.length(25) !== 0 → rule emitted + added to emittedRules.
	//   Under the fix: notice-only (zero real body) is identified and dropped.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatStaticBlock([rule], { maxRuleChars: 20, maxResultChars: 200 });
	// (a) No body content appears in the output — not even the notice as a ghost block.
	expect(result.text).not.toContain("[Truncated. Full:");
	expect(result.text).toBe("");
	// (b) The rule is absent from emittedRules → caller never marks it injected →
	//     no permanent suppression.
	expect(result.emittedRules).toHaveLength(0);
});

test("A1-dynamic: a notice-only dynamic rule emits no body and is absent from emittedRules", () => {
	// Same budget arithmetic as A1-static, exercised through the dynamic block.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "B".repeat(200) });
	const result = formatDynamicBlock([rule], "src/x.ts", { maxRuleChars: 20, maxResultChars: 200 });
	expect(result.text).not.toContain("[Truncated. Full:");
	expect(result.text).toBe("");
	expect(result.emittedRules).toHaveLength(0);
});

test("A1-static: a normally-truncated rule (partial body + notice) is still emitted", () => {
	// Guardrail: the fix must NOT change normal truncation. With a per-rule cap of
	// 80 (>= notice 25), truncateRule yields ~55 real body bytes + the notice.
	// That rule has real content and must remain emitted.
	const rule = makeRule({ path: "/p/r.md", relativePath: "r.md", body: "C".repeat(500) });
	const result = formatStaticBlock([rule], { maxRuleChars: 80, maxResultChars: 200 });
	expect(result.emittedRules).toHaveLength(1);
	expect(result.text).toContain("C"); // real body fragment present
	expect(result.text).toContain("[Truncated. Full:"); // notice appended after the fragment
});

// ===========================================================================
// A3 — recovery presence is decided by the transcript, not session staticDedup
// ===========================================================================

test("A3: arrival-order inversion (SessionStart source=compact before PostCompact) still recovers a rule that staticDedup already marks injected", () => {
	// Inversion path: a SessionStart with source="compact" can arrive BEFORE the
	// matching PostCompact. In that window markSessionCompacted (the staticDedup
	// wipe) has NOT run yet, so staticDedup still carries the rule injected by the
	// earlier startup SessionStart. The compact SessionStart takes the "not-pending
	// + source=compact" inversion fallback and enters recovery anyway.
	//
	// Bug: runPostCompactRecovery pre-filters loaded.rules with
	//   `loaded.rules.filter((rule) => !engine.isStaticInjected(rule))`
	// BEFORE the transcript-presence check. With staticDedup still populated the
	// rule is filtered out → missingRules empty → empty directive → the rule the
	// compaction is about to drop is never recovered.
	//
	// Fix: drop the staticDedup pre-filter in the recovery path; let the transcript
	// (here: none) decide. With no transcript the rule must surface in the directive.
	const sessionId = "a3-inversion-session";
	const { projectRoot, rulePath } = makeProjectWithStaticRule(
		"a3-rule.md",
		"A3 BOULDER: the inversion window must not swallow this rule.",
	);

	// 1. Normal startup SessionStart injects the rule and records it in staticDedup.
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);
	expect(additionalContext(first.stdout)).toContain("A3 BOULDER");

	// 2. SessionStart source="compact" BEFORE any PostCompact: staticDedup is still
	//    populated (no markSessionCompacted ran). Recovery must still surface the rule.
	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId, projectRoot, { source: "compact" }),
	);
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);
	expect(recovered).toContain("POST-COMPACTION RULE RECOVERY");
	expect(recovered).toContain(rulePath);
});

// ===========================================================================
// A4 — dynamic recovery body-needle uses the parsed (frontmatter-stripped) body
// ===========================================================================

test("A4: dynamic recovery does NOT re-inject a rule whose frontmatter-stripped body is already present in the transcript", () => {
	// Bug: isDynamicRuleBodyInTranscript builds its body needle from the RAW file
	// (frontmatter included). The emitted body has the frontmatter stripped, so the
	// raw needle (`---\nglobs: ...\n---\n...`) never appears in the transcript →
	// includes() is always false → the rule is treated as absent and re-injected on
	// every recovery, even though its body is fully present in context.
	//
	// Fix: build the needle from the PARSED body (frontmatter stripped), matching the
	// body that was actually emitted. Present body → skip re-injection.
	const sessionId = "a4-session";
	const hermDataRoot = join(tempHome, ".omt", "rules-injector");

	const projectRoot = makeScratchDir("a4-");
	writeFileSync(join(projectRoot, "package.json"), "{}\n");
	const rulesDir = join(projectRoot, ".codex", "rules");
	mkdirSync(rulesDir, { recursive: true });

	// Static rule so SessionStart has at least one rule and runs the recovery path.
	writeFileSync(join(rulesDir, "static.md"), "---\nalwaysApply: true\n---\nSTATIC RULE BODY\n");

	// The dynamic rule. Its frontmatter is `---\nglobs: "**/*.ts"\n---\n`.
	const dynamicRulePath = join(rulesDir, "dynamic.md");
	const dynamicRuleBody = "A4-DYNAMIC-BODY: parsed-body presence must suppress re-injection.";
	writeFileSync(dynamicRulePath, `---\nglobs: "**/*.ts"\n---\n${dynamicRuleBody}\n`);

	// Seed session state: the dynamic rule was previously injected; recovery is armed.
	mkdirSync(hermDataRoot, { recursive: true });
	const cachePath = join(hermDataRoot, `${sessionId}.json`);
	writeFileSync(
		cachePath,
		JSON.stringify({
			version: 1,
			staticDedup: [],
			dynamicDedup: { "__pi-rules-session__": [`${dynamicRulePath}::deadbeef`] },
			postCompactPending: { static: true, dynamic: true },
		}) + "\n",
	);

	// Transcript carries the XML open tag for "dynamic" AND the PARSED body (exactly
	// what would have been emitted — no frontmatter). Under the fix this body-needle
	// and open tag match → rule present → NOT re-injected. Under the bug (raw needle
	// with frontmatter) the body include() misses → rule re-injected.
	const transcriptPath = join(projectRoot, "transcript-a4.txt");
	writeFileSync(transcriptPath, `<rules name="dynamic">\n${dynamicRuleBody}\n</rules>\n`);

	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId, projectRoot, { transcript_path: transcriptPath }),
		{ PLUGIN_DATA: hermDataRoot },
	);
	expect(recovery.status).toBe(0);
	const recovered = additionalContext(recovery.stdout);
	// The dynamic rule must NOT be re-injected: its body is already present.
	expect(recovered).not.toContain(dynamicRulePath);
});

// ===========================================================================
// A13 — presence is anchored to the content version, not a 2000-char prefix
// ===========================================================================

test("A13: a rule edited only in its tail is treated as present if its name tag is in the transcript (name-based dedup, no version granularity)", () => {
	// lazy: the XML-tag format uses name-based presence detection only (no hash anchor).
	// Accepted consequence: a rule edited only in its tail is NOT re-injected across
	// compaction boundaries if its `<rules name="...">` tag is already in the transcript —
	// the changed content is not recognized as a "new version." This is intentional.
	//
	// This test documents the current behaviour: the emitted block (which carries
	// `<rules name="a13-rule">`) is recognized as present even after a tail edit.
	const sessionId = "a13-session";
	const head = "A13-HEAD: " + "P".repeat(2_500); // > 2000-char identical prefix
	const originalBody = `${head}\nA13-TAIL-ORIGINAL`;
	const { projectRoot, rulePath } = makeProjectWithStaticRule("a13-rule.md", originalBody);

	// 1. First SessionStart emits the rule. Capture the real producer output as the
	//    transcript — this is the exact emitted block (XML tag + body).
	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);
	const emittedBlock = additionalContext(first.stdout);
	expect(emittedBlock).toContain("A13-HEAD");
	expect(emittedBlock).toContain('<rules name="a13-rule">');

	const transcriptPath = join(projectRoot, "transcript-a13.txt");
	writeFileSync(transcriptPath, emittedBlock + "\n");

	// 2. Edit ONLY the tail — the 2000-char prefix is byte-identical, the content is not.
	writeFileSync(rulePath, `---\nalwaysApply: true\n---\n${head}\nA13-TAIL-EDITED\n`);

	// 3. Arm recovery (a fresh session so prior staticDedup doesn't interfere).
	const sessionId2 = "a13-session2";
	runHook("session-start", sessionStartPayload(sessionId2, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId2, projectRoot));

	// 4. Recovery sees the OLD emitted block (which carries `<rules name="a13-rule">`)
	//    in the transcript. With name-based detection the tag matches → rule treated as
	//    present → NOT re-injected (no recovery directive). This is the accepted trade-off:
	//    version granularity is intentionally absent in the name-based format.
	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId2, projectRoot, { transcript_path: transcriptPath }),
	);
	expect(recovery.status).toBe(0);
	// Name-based presence: open tag matches → rule is NOT recovered (no directive).
	expect(additionalContext(recovery.stdout)).toBe("");
});

test("A13: an unedited rule whose emitted block is in the transcript is NOT re-injected (guardrail)", () => {
	// Guardrail companion to the tail-edit test: when the content version is
	// unchanged, the emitted block in the transcript must still suppress recovery.
	// This proves the content-version anchor stays GREEN for the present case and
	// does not regress D2 into "always re-inject".
	const sessionId = "a13-noedit-session";
	const head = "A13-NOEDIT-HEAD: " + "Q".repeat(2_500);
	const body = `${head}\nA13-NOEDIT-TAIL`;
	const { projectRoot } = makeProjectWithStaticRule("a13-noedit-rule.md", body);

	const first = runHook("session-start", sessionStartPayload(sessionId, projectRoot));
	expect(first.status).toBe(0);
	const emittedBlock = additionalContext(first.stdout);
	expect(emittedBlock).toContain("A13-NOEDIT-HEAD");

	const transcriptPath = join(projectRoot, "transcript-a13-noedit.txt");
	writeFileSync(transcriptPath, emittedBlock + "\n");

	// Fresh session, arm recovery, no edit to the rule file.
	const sessionId2 = "a13-noedit-session2";
	runHook("session-start", sessionStartPayload(sessionId2, projectRoot));
	runHook("post-compact", postCompactPayload(sessionId2, projectRoot));

	const recovery = runHook(
		"session-start",
		sessionStartPayload(sessionId2, projectRoot, { transcript_path: transcriptPath }),
	);
	expect(recovery.status).toBe(0);
	// Body present + content version unchanged → no recovery directive emitted.
	expect(additionalContext(recovery.stdout)).toBe("");
});

test("A13: producer↔consumer marker parity — formatStaticBlock output is recognized as present by the static transcript filter", () => {
	// Producer/consumer contract: the marker the formatter EMITS and the marker the
	// transcript filter SEEKS must agree. If the emit gains a content-version anchor
	// but the check looks for a different one (or vice versa), presence detection
	// silently fails and every rule is re-injected forever. This asserts the round
	// trip: emit a rule's block, feed it back as transcript text, and the filter must
	// mark it injected (zero rules pending).
	const rule = makeRule({
		path: "/proj/.claude/rules/parity.md",
		relativePath: ".claude/rules/parity.md",
		body: "A13-PARITY-BODY: emit and check must use the same anchor.",
	});
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5_000, maxResultChars: 5_000 });
	expect(text).toContain("A13-PARITY-BODY");

	const marked: string[] = [];
	const pending = filterRulesNotInTranscriptText([rule], text, (r) => marked.push(r.path));
	// The emitted block is recognized as present: rule is marked, none left pending.
	expect(pending).toHaveLength(0);
	expect(marked).toEqual([rule.path]);
});

test("A13: name-based parity — edited rule IS suppressed if its name tag is in the transcript (accepted trade-off)", () => {
	// lazy: with name-based presence detection (no hash/version anchor), a transcript
	// carrying the OLD block for "parity2" suppresses the EDITED rule too — same
	// `<rules name="parity2">` tag → seen as present. This is the intentional trade-off.
	//
	// Contrast with hash-anchored detection (removed): the old hash-anchored marker
	// would detect a version mismatch and re-inject. Name-based detection does not.
	const head = "A13-PARITY2-HEAD: " + "R".repeat(2_500);
	const oldRule = makeRule({
		path: "/proj/.claude/rules/parity2.md",
		relativePath: ".claude/rules/parity2.md",
		body: `${head}\nPARITY2-TAIL-OLD`,
	});
	const { text: oldBlock } = formatStaticBlock([oldRule], {
		maxRuleChars: 10_000,
		maxResultChars: 10_000,
	});

	// Same path (same basename → same tag), different tail → still suppressed by tag match.
	const newRule = makeRule({
		path: "/proj/.claude/rules/parity2.md",
		relativePath: ".claude/rules/parity2.md",
		body: `${head}\nPARITY2-TAIL-NEW`,
		contentHash: "newversionhash",
	});
	const pending = filterRulesNotInTranscriptText([newRule], oldBlock, () => {});
	// Name-based parity: `<rules name="parity2">` is in the old block → new rule suppressed.
	// (Accepted trade-off: no version granularity with name-based format.)
	expect(pending).toHaveLength(0);
});

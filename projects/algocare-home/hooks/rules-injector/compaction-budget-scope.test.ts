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

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

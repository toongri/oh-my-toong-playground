import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

const CLI_PATH = join(import.meta.dir, "cli.ts");

let originalHome: string | undefined;
let tempHome = "";
const projectDirs: string[] = [];
let sessionCounter = 0;

beforeEach(() => {
	originalHome = process.env.HOME;
	tempHome = mkdtempSync(join(tmpdir(), "ri-home-"));
	process.env.HOME = tempHome;
});

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	rmSync(tempHome, { recursive: true, force: true });
	while (projectDirs.length > 0) {
		const dir = projectDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

function makeProject(): string {
	const projectDir = mkdtempSync(join(tmpdir(), "ri-proj-"));
	projectDirs.push(projectDir);
	mkdirSync(join(projectDir, ".codex", "rules"), { recursive: true });
	mkdirSync(join(projectDir, "src"), { recursive: true });
	writeFileSync(join(projectDir, "package.json"), '{"name":"ri-fixture"}\n');
	return projectDir;
}

function writeRule(projectDir: string, fileName: string, frontmatter: string, body: string): void {
	writeFileSync(
		join(projectDir, ".codex", "rules", fileName),
		`---\n${frontmatter}\n---\n${body}\n`,
	);
}

function freshSessionId(prefix: string): string {
	sessionCounter += 1;
	return `${prefix}-${sessionCounter}`;
}

function runHook(
	subcommand: "session-start" | "post-tool-use",
	payload: Record<string, unknown>,
): string {
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", subcommand], {
		input: JSON.stringify(payload),
		env: {
			...process.env,
			HOME: tempHome,
			PI_RULES_DISABLE_BUNDLED: "1",
			PLUGIN_DATA: join(tempHome, ".omt"),
		},
		encoding: "utf8",
	});
	const stdout = result.stdout.trim();
	if (stdout.length === 0) {
		return "";
	}
	const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

// ── C7: shell unwrap scans tokens[1..n-2] for -[A-Za-z]*c flag ───────────────

// C7-a: bash --noprofile --norc -lc "inner" — the -c flag is at tokens[3], not tokens[1].
// Before the fix, tokens[1]="--noprofile" fails !endsWith("c") → no unwrap → shell binary
// paths extracted instead of inner command path → TS rule does NOT inject.
// After the fix, scanner finds -lc at the right position → inner extracted → TS rule injects.
test("C7-a bash --noprofile --norc -lc unwraps inner path: TS rule injects, shell-binary rule does not", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeRule(projectDir, "shell.md", 'globs: ["**/bash"]', "SHELL_BINARY_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c7a"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-c7a",
		tool_input: { command: '/bin/bash --noprofile --norc -lc "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
	expect(additionalContext).not.toContain("SHELL_BINARY_RULE_MARKER");
});

// C7-b: bash --norc -c "inner" — before the fix, tokens[1]="--norc" ends in 'c' and
// starts with '-', so the guard passes but returns tokens[2]="-c" (garbage inner).
// After the fix, /^-[A-Za-z]*c$/ rejects "--norc" (long-form, two leading dashes)
// and finds -c at tokens[2] → returns tokens[3] (the real inner) → TS rule injects.
test("C7-b bash --norc -c unwraps inner path correctly (--norc is not a -c flag)", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c7b"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-c7b",
		tool_input: { command: '/bin/bash --norc -c "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// C7-c: regression — plain bash -c must still work after the refactor.
test("C7-c regression bash -c still unwraps correctly", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c7c"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-c7c",
		tool_input: { command: '/bin/bash -c "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// ── C11: unwrapShellWrapper must preserve positional args after -c '<script>' ─────

// bash -c 'sed -n 1,20p "$1"' _ src/x.ts
// tokens: [bash, -c, 'sed -n 1,20p "$1"', _, src/x.ts]
// Before fix: returns only tokens[flagIndex+1] = 'sed -n 1,20p "$1"' → src/x.ts dropped
// After fix: returns 'sed -n 1,20p "$1" _ src/x.ts' → src/x.ts extracted by addCommandPaths
test("C11 bash -c '<script>' _ src/x.ts: positional arg src/x.ts is NOT dropped", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c11"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-c11",
		tool_input: { command: "bash -c 'sed -n 1,20p \"$1\"' _ src/x.ts" },
		tool_response: {},
	});

	// src/x.ts must be resolved and matched → TS rule injects
	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// ── P1: dynamic block header derived from emittedRules[0], not pre-budget rules[0] ──

// Setup: two targets, two rules. Rule A (priority=2, large body) matches target-a.ts
// and is the top priority candidate (rules[0]). Rule B (priority=1, small body) matches
// target-b.ts. We set a tight maxResultChars budget so rule A is dropped and only rule B
// survives in emittedRules.
//
// Before the fix: headerTarget = rules[0].matchedTarget = target-a.ts → header says
// "…matched for …/target-a.ts" while the emitted rule is actually for target-b.ts.
// After the fix: headerTarget = emittedRules[0].matchedTarget = target-b.ts → correct.
//
// We force the budget drop via the CODEX_RULES_MAX_RESULT_CHARS env var so rule A's
// body (padded to exceed the budget) gets dropped while rule B's 5-char body fits.
test("P1 dynamic block header matches the surviving emitted rule's target after rules[0] budget-drop", () => {
	const projectDir = makeProject();
	mkdirSync(join(projectDir, "src", "sub"), { recursive: true });

	// Rule A: high priority, very large body (exceeds tiny budget), matches target-a.ts.
	// priority:2 sorts it to rules[0] (higher priority = emitted first by sortCandidates).
	const largeBody = "A".repeat(200);
	writeRule(
		projectDir,
		"rule-a.md",
		'globs: ["**/target-a.ts"]\npriority: 2',
		`RULE_A_MARKER\n${largeBody}`,
	);

	// Rule B: lower priority, tiny body, matches target-b.ts.
	writeRule(projectDir, "rule-b.md", 'globs: ["**/target-b.ts"]\npriority: 1', "RULE_B_MARKER");

	// Physical files so extractCodexToolPaths can resolve them via mustExist.
	writeFileSync(join(projectDir, "src", "target-a.ts"), "const a = 1;\n");
	writeFileSync(join(projectDir, "src", "target-b.ts"), "const b = 1;\n");

	// Budget of 75 chars: with 2 rules, perRuleResultChars = floor(75/2) = 37.
	// Rule A's per-rule cap is min(4000, 37) = 37 chars, but the truncation notice
	// (~46 chars) is longer than 37 → truncateRule returns "" for rule A.
	// Rule A's XML header = "<rules name=\"rule-a\">\n\n</rules>" = 31 chars.
	// bodyBudget for A = 75 - 31 = 44; truncateBudget([{body:""}], 44) → dropped.
	// Rule B's body ("RULE_B_MARKER", 13 chars) fits in the remaining budget. ✓
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", "post-tool-use"], {
		input: JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: freshSessionId("p1"),
			turn_id: "t1",
			transcript_path: null,
			cwd: projectDir,
			model: "gpt-5",
			permission_mode: "default",
			tool_name: "Bash",
			tool_use_id: "u-p1",
			tool_input: { command: "cat src/target-a.ts src/target-b.ts" },
			tool_response: {},
		}),
		env: {
			...process.env,
			HOME: tempHome,
			PI_RULES_DISABLE_BUNDLED: "1",
			PLUGIN_DATA: join(tempHome, ".omt"),
			// budget=75: drops rule A (per-rule cap < truncation notice),
			// but leaves enough for rule B's 13-char body.
			CODEX_RULES_MAX_RESULT_CHARS: "75",
		},
		encoding: "utf8",
	});

	const stdout = result.stdout.trim();
	const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	const additionalContext = parsed.hookSpecificOutput?.additionalContext ?? "";

	// Rule B survived; rule A was dropped by budget.
	expect(additionalContext).toContain("RULE_B_MARKER");
	expect(additionalContext).not.toContain("RULE_A_MARKER");

	// The header line must reference target-b.ts (the emitted rule's target),
	// NOT target-a.ts (rules[0]'s target which was budget-dropped).
	expect(additionalContext).toContain("target-b.ts");
	expect(additionalContext).not.toMatch(/matched for [^\n]*target-a\.ts/);
});

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { findProjectRoot, matchRule, pathBasesForTarget, scanRuleFiles } from "./rules/index.js";
import { parseYamlFrontmatter } from "./rules/parser-yaml.js";

const CLI_PATH = join(import.meta.dir, "cli.ts");

// Isolated HOME so no test touches the real ~/.omt or ~/.claude. The dynamic
// injection lane dedups per session under $HOME/.omt/rules-injector/<sid>.json,
// so a fresh HOME per test plus a unique session id per spawn guarantees no
// dedup carries across tests.
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

/** Create a temp project dir with a package.json marker so findProjectRoot stops here. */
function makeProject(): string {
	const projectDir = mkdtempSync(join(tmpdir(), "ri-proj-"));
	projectDirs.push(projectDir);
	mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });
	mkdirSync(join(projectDir, "src"), { recursive: true });
	writeFileSync(join(projectDir, "package.json"), '{"name":"ri-fixture"}\n');
	return projectDir;
}

function writeRule(projectDir: string, fileName: string, frontmatter: string, body: string): void {
	writeFileSync(
		join(projectDir, ".claude", "rules", fileName),
		`---\n${frontmatter}\n---\n${body}\n`,
	);
}

function freshSessionId(prefix: string): string {
	sessionCounter += 1;
	return `${prefix}-${sessionCounter}`;
}

/** Spawn the CLI hook under the isolated HOME and return parsed additionalContext (or ""). */
function runHook(
	subcommand: "session-start" | "post-tool-use",
	payload: Record<string, unknown>,
): string {
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", subcommand], {
		input: JSON.stringify(payload),
		// P9: pin PLUGIN_DATA to the hermetic temp dir so external env cannot override the
		// session-state data root.  Delete any inherited PLUGIN_DATA first, then set our own.
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

/** Raw spawn variant that returns the full SpawnSyncReturns without parsing stdout as JSON.
 * Used for tests that assert on side-effects (breadcrumb file, exit code) rather than hook output. */
function runHookRaw(
	subcommand: "session-start" | "post-tool-use",
	stdinPayload: string,
): ReturnType<typeof spawnSync> {
	return spawnSync("bun", ["run", CLI_PATH, "hook", subcommand], {
		input: stdinPayload,
		env: {
			...process.env,
			HOME: tempHome,
			PI_RULES_DISABLE_BUNDLED: "1",
			PLUGIN_DATA: join(tempHome, ".omt"),
		},
		encoding: "utf8",
	});
}

function pathBases(relative: string): { projectRelative: string; basename: string } {
	const segments = relative.split("/");
	return { projectRelative: relative, basename: segments[segments.length - 1] ?? relative };
}

function matched(globs: string[], relative: string): boolean {
	return matchRule({ frontmatter: { globs }, isSingleFile: false, pathBases: pathBases(relative) })
		.matched;
}

// --- A3: glob fidelity via matchRule (no spawn) ---

test("A3 globstar zero-dir: **/*.ts matches foo.ts", () => {
	expect(matched(["**/*.ts"], "foo.ts")).toBe(true);
});

test("A3 brace expansion: *.{ts,js} matches both a.ts and a.js", () => {
	expect(matched(["*.{ts,js}"], "a.ts")).toBe(true);
	expect(matched(["*.{ts,js}"], "a.js")).toBe(true);
});

test("A3 negation: !**/*.test.ts excludes a.test.ts while **/*.ts includes a.ts", () => {
	expect(matched(["**/*.ts", "!**/*.test.ts"], "a.ts")).toBe(true);
	expect(matched(["**/*.ts", "!**/*.test.ts"], "a.test.ts")).toBe(false);
});

test("A3 character class: file[0-9].ts matches file3.ts", () => {
	expect(matched(["file[0-9].ts"], "file3.ts")).toBe(true);
});

test("A3 extglob: *.+(ts|tsx) matches a.tsx", () => {
	expect(matched(["*.+(ts|tsx)"], "a.tsx")).toBe(true);
});

// --- B1: SessionStart static lane (alwaysApply) ---

test("B1 SessionStart injects alwaysApply rule body and mutates no project file", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "always.md", "alwaysApply: true", "ALWAYS_RULE_BODY_MARKER");

	const before = JSON.stringify(snapshotTree(projectDir));
	const additionalContext = runHook("session-start", {
		hook_event_name: "SessionStart",
		session_id: freshSessionId("b1"),
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		source: "startup",
	});
	const after = JSON.stringify(snapshotTree(projectDir));

	expect(additionalContext).toContain("ALWAYS_RULE_BODY_MARKER");
	expect(after).toBe(before);
});

/**
 * Recursively snapshot project files as "relative:sha256:bytes" strings.
 * The sha256 + byte size detect in-place content mutations that name-only
 * snapshots would miss (F16 hardening).
 */
function snapshotTree(dir: string, prefix = ""): string[] {
	const entries: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			entries.push(...snapshotTree(fullPath, relative));
		} else {
			const content = readFileSync(fullPath);
			const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
			const size = statSync(fullPath).size;
			entries.push(`${relative}:${hash}:${size}`);
		}
	}
	return entries;
}

// --- C1: apply_patch new-file dynamic lane ---

test("C1 apply_patch Add File injects the **/*.ts rule for the new path", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c1"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "apply_patch",
		tool_use_id: "u1",
		tool_input: {
			input: "*** Begin Patch\n*** Add File: src/x.ts\n+export const x = 1;\n*** End Patch",
		},
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// --- C2: Bash shell-exec dynamic lane (tool_name "Bash" lowercased natively) ---

test("C2 Bash cat injects the **/*.ts rule for the referenced existing path", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c2"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u2",
		tool_input: { command: "cat src/x.ts" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// --- H1: per-shell wrapper unwrap (sh / bash / zsh) ---

// Each case wraps `cat src/x.ts` in a different shell invocation. After the
// codex-hook unwrap peels the wrapper, the INNER path src/x.ts is what feeds the
// matcher: the **/*.ts rule injects, and the shell-binary rule (which would
// match /bin/<shell> if the wrapper leaked through) does NOT.
const shellCases: ReadonlyArray<{ name: string; command: string }> = [
	{ name: "sh -c", command: '/bin/sh -c "cat src/x.ts"' },
	{ name: "bash -c", command: '/bin/bash -c "cat src/x.ts"' },
	{ name: "zsh -lc", command: '/bin/zsh -lc "cat src/x.ts"' },
];

for (const shellCase of shellCases) {
	test(`H1 ${shellCase.name} unwraps to inner path: src/x.ts rule injects, shell-binary rule does not`, () => {
		const projectDir = makeProject();
		writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
		writeRule(
			projectDir,
			"shell.md",
			'globs: ["**/sh", "**/bash", "**/zsh"]',
			"SHELL_BINARY_RULE_MARKER",
		);
		writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

		const additionalContext = runHook("post-tool-use", {
			hook_event_name: "PostToolUse",
			session_id: freshSessionId("h1"),
			turn_id: "t1",
			transcript_path: null,
			cwd: projectDir,
			model: "gpt-5",
			permission_mode: "default",
			tool_name: "Bash",
			tool_use_id: "u3",
			tool_input: { command: shellCase.command },
			tool_response: {},
		});

		expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
		expect(additionalContext).toContain("src/x.ts");
		expect(additionalContext).not.toContain("SHELL_BINARY_RULE_MARKER");
	});
}

// --- C1: parse failure breadcrumb ---

test("C1 non-JSON stdin writes breadcrumb and exits 0", () => {
	// cli.ts outer catch in runHookCli calls writeErrorBreadcrumb which writes to
	// $HOME/.omt/rules-injector/error.log. A non-JSON stdin triggers JSON.parse to
	// throw, propagating up to the catch block.
	const result = runHookRaw("session-start", "not json{{{");

	// Exit code must be 0: hook failures are advisory, must never block the turn.
	expect(result.status).toBe(0);

	// Breadcrumb file must exist with non-empty content.
	const breadcrumb = join(tempHome, ".omt", "rules-injector", "error.log");
	expect(existsSync(breadcrumb)).toBe(true);
	const content = readFileSync(breadcrumb, "utf8");
	expect(content.length).toBeGreaterThan(0);
});

// --- A5: escaped-quote unwrap (space-in-path via backslash-escaped quotes) ---

test("A5 zsh -lc with escaped-quote path: space-containing file is one token and its rule injects", () => {
	const projectDir = makeProject();
	// Rule matches any .ts file anywhere in the project.
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	// File whose name contains a space — path requires quoting in the shell command.
	writeFileSync(join(projectDir, "src", "a b.ts"), "export const ab = 1;\n");

	// The tool_input command is what Codex would produce: the inner command uses
	// backslash-escaped double-quotes so the space-containing path is one shell token.
	// codex-hook.ts tokenize() handles \" via the escaped flag.
	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("a5"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u5",
		tool_input: { command: '/bin/zsh -lc "cat \\"src/a b.ts\\""' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	// The display path header in the injection block references the file.
	expect(additionalContext).toContain("a b.ts");
});

// --- B-8: single-quoted shell wrapper preserves literal backslash (POSIX) ---

test("B-8 bash -c single-quoted inner: backslash is literal so the escaped-space path stays one token and its rule injects", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	// File with a space in its name. The inner shell script escapes that space with a
	// backslash; the wrapper delimits the inner script with SINGLE quotes.
	writeFileSync(join(projectDir, "src", "a b.ts"), "export const ab = 1;\n");

	// Codex wraps the model's script in `bash -c '<script>'`. The single quotes are the
	// wrapper's -c delimiter; inside them POSIX treats backslash as a LITERAL character.
	// So the wrapper-peel must hand the inner script `cat src/a\ b.ts` through verbatim
	// (backslash preserved). tool-paths.ts then re-tokenizes that inner script with its
	// OWN shell semantics, where `a\ b.ts` is the escaped-space path `a b.ts` — one token.
	//
	// Under the bug, codex-hook tokenize() unescapes the backslash even inside the single
	// quotes, peeling `cat src/a b.ts` (backslash gone). tool-paths.ts then splits on the
	// raw space into `src/a` and `b.ts`, neither of which exists → no path → no injection.
	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("b8"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u8",
		tool_input: { command: "/bin/bash -c 'cat src/a\\ b.ts'" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("a b.ts");
});

// --- M1: multi-target header names the actually-matched target, not targetPaths[0] ---

test("M1 multi-target PostToolUse: injection header names the matched target (src/x.ts), not the first target (README.md)", () => {
	const projectDir = makeProject();
	// Rule matches only .ts files. README.md (the FIRST extracted target) does NOT match;
	// src/x.ts (a LATER target) does.
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "README.md"), "# readme\n");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	// `cat README.md src/x.ts` extracts both paths; README.md is targetPaths[0] but only
	// src/x.ts matches the rule. The header must attribute the injection to src/x.ts.
	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("m1"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-m1",
		tool_input: { command: "cat README.md src/x.ts" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	// The header line names the matched target, not the unmatched first target.
	expect(additionalContext).toContain("matched for src/x.ts");
	expect(additionalContext).not.toContain("matched for README.md");
});

// --- C9: A3 glob round-trip via real parser (runHook, not matchRule direct call) ---

test('C9 A3 round-trip via parser: JSON-array inline glob globs:["*.{ts,js}"] matches src/x.ts', () => {
	const projectDir = makeProject();
	// JSON-array inline form — parseInlineArray path in parser-yaml.ts, no comma-split bug.
	writeRule(projectDir, "ts-js.md", 'globs: ["*.{ts,js}"]', "TS_JS_GLOB_ROUND_TRIP_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c9"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u9",
		tool_input: { command: "cat src/x.ts" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_JS_GLOB_ROUND_TRIP_MARKER");
});

// C9: unquoted brace glob — parser-yaml now tracks brace depth in the unquoted scalar path
// so `globs: *.{ts,js}` is no longer split on the comma inside {}.
test("C9: unquoted scalar brace glob globs: *.{ts,js} matches .ts files", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts-js-unquoted.md", "globs: *.{ts,js}", "UNQUOTED_BRACE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("c9skip"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u9s",
		tool_input: { command: "cat src/x.ts" },
		tool_response: {},
	});

	expect(additionalContext).toContain("UNQUOTED_BRACE_MARKER");
});

// --- F17: grep command — tokenizer drops PATTERN, extracts file path ---

test("F17 Bash grep: PATTERN token is dropped, file path token feeds rule matching", () => {
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	// tool-paths.ts tokenizeShell skips tokens starting with '-', but PATTERN (no dash)
	// would be treated as a path candidate. addCommandPaths filters it out via mustExist=true
	// since "PATTERN" does not exist as a file. Only src/x.ts (which exists) passes.
	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("f17"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u17",
		tool_input: { command: "grep PATTERN src/x.ts" },
		tool_response: {},
	});

	// The ts rule must fire because src/x.ts was extracted.
	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// --- D-4: negative glob checked against all pathBases ---

test("D-4 negative glob excludes match even when positive hits a different pathBase", () => {
	// globs: ["foo.ts", "!src/**"]
	// pathBases: projectRelative="src/foo.ts", basename="foo.ts"
	// positive "foo.ts" hits basename, negative "!src/**" hits projectRelative
	// Expected: NOT matched (negative must be checked against ALL pathBases, not just the one that hit)
	const result = matchRule({
		frontmatter: { globs: ["foo.ts", "!src/**"] },
		isSingleFile: false,
		pathBases: { projectRelative: "src/foo.ts", basename: "foo.ts" },
	});
	expect(result.matched).toBe(false);
});

// --- D-2: trailing whitespace in multiline list items trimmed ---

test("D-2 multiline glob list item with trailing whitespace matches correctly", () => {
	// YAML frontmatter with multiline list where items have trailing spaces after comment stripping
	const yaml = "globs:\n  - **/*.ts  \n";
	const frontmatter = parseYamlFrontmatter(yaml);
	// The glob must match src/x.ts — trailing whitespace must be stripped from "**/*.ts  "
	const result = matchRule({
		frontmatter,
		isSingleFile: false,
		pathBases: { projectRelative: "src/x.ts", basename: "x.ts" },
	});
	expect(result.matched).toBe(true);
});

// --- E-1: scope directory uses lastIndexOf to avoid prefix collision ---

test("E-1 scopeDirectoryForCandidate uses lastIndexOf not indexOf", () => {
	// candidate.relativePath = ".claude/rules-archive/.claude/rules/rule.md"
	// candidate.source = ".claude/rules"
	// With indexOf: sourceIndex=0 (finds ".claude/rules" in ".claude/rules-archive" prefix)
	//   → scopeDirectory = projectRoot → scopeRelative = same as projectRelative (WRONG)
	// With lastIndexOf: sourceIndex=22 (finds the real ".claude/rules/" dir)
	//   → scopeDirectory = join(projectRoot, ".claude/rules-archive/.claude") → correct scoping
	const projectRoot = "/project";
	const targetFile = "/project/src/main.ts";
	const candidate = {
		path: "/project/.claude/rules-archive/.claude/rules/rule.md",
		realPath: "/project/.claude/rules-archive/.claude/rules/rule.md",
		source: ".claude/rules" as const,
		distance: 1,
		isGlobal: false,
		isSingleFile: false,
		relativePath: ".claude/rules-archive/.claude/rules/rule.md",
	};
	const bases = pathBasesForTarget(projectRoot, targetFile, candidate);
	// With indexOf (wrong): scopeDirectory = projectRoot, scopeRelative = "src/main.ts"
	// With lastIndexOf (correct): scopeDirectory = "/project/.claude/rules-archive/.claude"
	//   → scopeRelative = relative("/project/.claude/rules-archive/.claude", "/project/src/main.ts")
	//   = "../../src/main.ts" (not "src/main.ts")
	// The key property: scopeRelative must NOT equal projectRelative when there's a prefix collision
	expect(bases.scopeRelative).not.toBe(bases.projectRelative);
});

// --- E-3: symlinked parent dedup — same physical rule file via two symlinked parent dirs injected only once ---

test("E-3 same physical rule file reached via two symlinked parent dirs is deduplicated", () => {
	// Construct a fixture entirely inside mktemp-created dirs:
	//   physicalProject/  ← real project root with .claude/rules/rule.md
	//   link1/ → physicalProject  (symlink)
	//   link2/ → physicalProject  (symlink)
	// Scanning .claude/rules via link1 and link2 should yield the same physical file
	// and the scanner must return it exactly once.
	const base = mkdtempSync(join(tmpdir(), "ri-e3-"));
	const physicalProject = join(base, "real");
	mkdirSync(join(physicalProject, ".claude", "rules"), { recursive: true });
	writeFileSync(
		join(physicalProject, ".claude", "rules", "rule.md"),
		"---\nalwaysApply: true\n---\nE3_RULE_BODY\n",
	);

	const link1 = join(base, "link1");
	const link2 = join(base, "link2");
	symlinkSync(physicalProject, link1);
	symlinkSync(physicalProject, link2);

	// Scan via link1 rules dir
	const files1 = scanRuleFiles({ rootDir: join(link1, ".claude", "rules") });
	// Scan via link2 rules dir
	const files2 = scanRuleFiles({ rootDir: join(link2, ".claude", "rules") });
	const allFiles = [...files1, ...files2];

	// All realPaths must point to the same physical file
	const realPaths = allFiles.map((f) => f.realPath);
	const uniqueRealPaths = new Set(realPaths);

	// Without the fix: uniqueRealPaths.size === 2 (link1/...md and link2/...md both returned as realPath)
	// With the fix: uniqueRealPaths.size === 1 (both resolve to the same physicalProject/.claude/rules/rule.md)
	expect(uniqueRealPaths.size).toBe(1);

	rmSync(base, { recursive: true, force: true });
});

// --- F-7: shell-unwrap for exec_command / shell_command tool names and cmd field ---

// SHELL_COMMAND_TOOL_NAMES = ["bash", "shell_command", "exec_command"] (codex-hook.ts:252).
// Command-field resolution: "command" key first, "cmd" key as fallback (codex-hook.ts:265).
// H1 above only exercises tool_name="Bash" with a "command" field.
// These tests cover the two additional tool names and the "cmd" fallback field.

test("F-7 exec_command with command field: shell wrapper is unwrapped, inner path injects rule", () => {
	// tool_name "exec_command" (lowercased) is in SHELL_COMMAND_TOOL_NAMES.
	// The wrapper `/bin/sh -c "cat src/x.ts"` must be peeled so src/x.ts feeds matching.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("f7-exec"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "exec_command",
		tool_use_id: "u-f7-exec",
		tool_input: { command: '/bin/sh -c "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

test("F-7 shell_command with command field: shell wrapper is unwrapped, inner path injects rule", () => {
	// tool_name "shell_command" (already lowercase) is in SHELL_COMMAND_TOOL_NAMES.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("f7-shell"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "shell_command",
		tool_use_id: "u-f7-shell",
		tool_input: { command: '/bin/bash -c "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

test("F-7 exec_command with cmd field: shell wrapper unwrap reads cmd not command", () => {
	// codex-hook.ts:265 falls back to "cmd" when "command" is absent.
	// Verifies that exec_command with tool_input.cmd (not .command) still unwraps
	// and the inner path feeds rule matching. Without the cmd-key fallback the hook
	// would return the input unchanged, treating "/bin/sh" as the target path.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("f7-cmd"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "exec_command",
		tool_use_id: "u-f7-cmd",
		tool_input: { cmd: '/bin/sh -c "cat src/x.ts"' },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/x.ts");
});

// --- D-8: monorepo subdir cwd — findProjectRoot walks past nested package.json to workspace root ---

test("A6 글로브 값 안의 # 가 주석으로 오인돼 절단되지 않아야 한다", () => {
	// YAML 스펙상 '#'은 앞이 공백/탭이거나 줄의 시작일 때만 주석이다.
	// 'src/#fixtures/**/*.ts' 같이 경로 안에 포함된 '#'은 그대로 보존돼야 한다.
	const yaml = `globs: src/#fixtures/**/*.ts\ndescription: test`;
	const result = parseYamlFrontmatter(yaml);
	expect(result.globs).toBe("src/#fixtures/**/*.ts");
});

test("A6 trailing 주석(앞에 공백)은 여전히 제거돼야 한다", () => {
	// 'value  # note' 처럼 앞에 공백이 있는 '#'은 주석으로 처리해 절단.
	const yaml = `globs: src/app/**/*.ts  # 런타임 소스만\ndescription: test`;
	const result = parseYamlFrontmatter(yaml);
	expect(result.globs).toBe("src/app/**/*.ts");
});

test("D-8 findProjectRoot from monorepo package subdir reaches workspace root not nested package", () => {
	// Construct a fixture:
	//   workspaceRoot/
	//     pnpm-workspace.yaml       ← workspace marker
	//     package.json              ← root package.json (optional, does not stop here alone)
	//     apps/
	//       mobile/
	//         package.json          ← nested package — OLD behavior stops HERE
	// Expected: findProjectRoot("apps/mobile") returns workspaceRoot, not apps/mobile
	const base = mkdtempSync(join(tmpdir(), "ri-d8-"));
	const workspaceRoot = join(base, "workspace");
	const appDir = join(workspaceRoot, "apps", "mobile");
	mkdirSync(appDir, { recursive: true });

	// Workspace root markers
	writeFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
	writeFileSync(join(workspaceRoot, "package.json"), '{"name":"workspace-root"}\n');

	// Nested package (was stopping point before fix)
	writeFileSync(join(appDir, "package.json"), '{"name":"mobile"}\n');

	const result = findProjectRoot(appDir);

	// With the fix: should reach workspaceRoot (has pnpm-workspace.yaml)
	// Without the fix: would return appDir (stopped at nested package.json)
	expect(result).toBe(workspaceRoot);

	rmSync(base, { recursive: true, force: true });
});

// --- A10: isFailedToolResponse — exit_code/string-error 실패 신호 ---

test("A10 tool_response에 exit_code:1이 있으면 경로를 추출하지 않아 룰이 주입되지 않는다", () => {
	// exit_code !== 0 형태의 실패 응답은 isFailedToolResponse가 실패로 판정해야 한다.
	// 주입이 없으면 additionalContext는 빈 문자열이어야 한다.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("a10-exit"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-a10-exit",
		tool_input: { command: "cat src/x.ts" },
		tool_response: { exit_code: 1, output: "command failed" },
	});

	expect(additionalContext).not.toContain("TS_GLOB_RULE_MARKER");
	// A swallowed crash writes error.log breadcrumb; clean no-op must not.
	expect(existsSync(join(tempHome, ".omt", "rules-injector", "error.log"))).toBe(false);
});

test("A10 tool_response에 error가 비어있지 않은 string이면 경로를 추출하지 않아 룰이 주입되지 않는다", () => {
	// error: "some message" 형태의 string 실패 응답도 isFailedToolResponse가 실패로 판정해야 한다.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("a10-errmsg"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-a10-errmsg",
		tool_input: { command: "cat src/x.ts" },
		tool_response: { error: "permission denied" },
	});

	expect(additionalContext).not.toContain("TS_GLOB_RULE_MARKER");
	// A swallowed crash writes error.log breadcrumb; clean no-op must not.
	expect(existsSync(join(tempHome, ".omt", "rules-injector", "error.log"))).toBe(false);
});

test("A10 tool_response가 정상 성공({})이면 경로를 추출해 룰이 주입된다", () => {
	// 기존 boolean 성공 케이스 회귀 방지: {} 는 실패로 판정되면 안 된다.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");
	writeFileSync(join(projectDir, "src", "x.ts"), "export const x = 1;\n");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("a10-ok"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "Bash",
		tool_use_id: "u-a10-ok",
		tool_input: { command: "cat src/x.ts" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
});

// --- A11: addPatchHeaderPaths — *** Delete File: 헤더 누락 ---

test("A11 apply_patch *** Delete File: 헤더가 있으면 해당 경로가 추출돼 룰이 주입된다", () => {
	// addPatchHeaderPaths는 Add File / Update File / Move to 만 파싱하고
	// Delete File 을 누락했다. 이 테스트는 그 누락이 수정됐음을 검증한다.
	// Delete File 대상이 **/*.ts 룰에 매칭되면 룰이 주입돼야 한다.
	const projectDir = makeProject();
	writeRule(projectDir, "ts.md", 'globs: ["**/*.ts"]', "TS_GLOB_RULE_MARKER");

	const additionalContext = runHook("post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: freshSessionId("a11-del"),
		turn_id: "t1",
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5",
		permission_mode: "default",
		tool_name: "apply_patch",
		tool_use_id: "u-a11-del",
		tool_input: { input: "*** Begin Patch\n*** Delete File: src/foo.ts\n*** End Patch" },
		tool_response: {},
	});

	expect(additionalContext).toContain("TS_GLOB_RULE_MARKER");
	expect(additionalContext).toContain("src/foo.ts");
});

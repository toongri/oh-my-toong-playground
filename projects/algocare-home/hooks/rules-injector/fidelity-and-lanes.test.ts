import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { matchRule, pathBasesForTarget } from "./rules/index.js";
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
	writeFileSync(join(projectDir, ".claude", "rules", fileName), `---\n${frontmatter}\n---\n${body}\n`);
}

function freshSessionId(prefix: string): string {
	sessionCounter += 1;
	return `${prefix}-${sessionCounter}`;
}

/** Spawn the CLI hook under the isolated HOME and return parsed additionalContext (or ""). */
function runHook(subcommand: "session-start" | "post-tool-use", payload: Record<string, unknown>): string {
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", subcommand], {
		input: JSON.stringify(payload),
		// P9: pin PLUGIN_DATA to the hermetic temp dir so external env cannot override the
		// session-state data root.  Delete any inherited PLUGIN_DATA first, then set our own.
		env: { ...process.env, HOME: tempHome, PI_RULES_DISABLE_BUNDLED: "1", PLUGIN_DATA: join(tempHome, ".omt") },
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
function runHookRaw(subcommand: "session-start" | "post-tool-use", stdinPayload: string): ReturnType<typeof spawnSync> {
	return spawnSync("bun", ["run", CLI_PATH, "hook", subcommand], {
		input: stdinPayload,
		env: { ...process.env, HOME: tempHome, PI_RULES_DISABLE_BUNDLED: "1", PLUGIN_DATA: join(tempHome, ".omt") },
		encoding: "utf8",
	});
}

function pathBases(relative: string): { projectRelative: string; basename: string } {
	const segments = relative.split("/");
	return { projectRelative: relative, basename: segments[segments.length - 1] ?? relative };
}

function matched(globs: string[], relative: string): boolean {
	return matchRule({ frontmatter: { globs }, isSingleFile: false, pathBases: pathBases(relative) }).matched;
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
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
		tool_input: { input: "*** Begin Patch\n*** Add File: src/x.ts\n+export const x = 1;\n*** End Patch" },
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
		writeRule(projectDir, "shell.md", 'globs: ["**/sh", "**/bash", "**/zsh"]', "SHELL_BINARY_RULE_MARKER");
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

// --- C9: A3 glob round-trip via real parser (runHook, not matchRule direct call) ---

test("C9 A3 round-trip via parser: JSON-array inline glob globs:[\"*.{ts,js}\"] matches src/x.ts", () => {
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

// unquoted brace glob mis-split by parser-yaml comma-split — upstream bug, defer to re-vendor.
// parser-yaml.ts parseGlobValue: `globs: *.{ts,js}` hits the unquoted scalar path which splits
// on commas, producing ["*.{ts", "js}"] — neither token matches a valid .ts file.
test.skip("C9 SKIP upstream-bug: unquoted scalar brace glob globs: *.{ts,js} mis-splits on comma", () => {
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

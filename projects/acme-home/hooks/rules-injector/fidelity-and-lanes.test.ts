import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { matchRule } from "./rules/index.js";

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
		env: { ...process.env, HOME: tempHome, PI_RULES_DISABLE_BUNDLED: "1" },
		encoding: "utf8",
	});
	const stdout = result.stdout.trim();
	if (stdout.length === 0) {
		return "";
	}
	const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
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

/** Recursively list project file names (relative) for a mutation snapshot. */
function snapshotTree(dir: string, prefix = ""): string[] {
	const entries: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			entries.push(...snapshotTree(join(dir, entry.name), relative));
		} else {
			entries.push(relative);
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

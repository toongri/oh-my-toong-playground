import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

// ── D-22: file-based opt-out via .codex/rules-injector.local.off ─────────────
//
// If <workspaceRoot>/.codex/rules-injector.local.off exists, every hook handler
// must no-op (emit "") — identical to CODEX_RULES_DISABLED=1 — regardless of
// whether the env-var disable is set.

const CLI_PATH = join(import.meta.dir, "cli.ts");

let originalHome: string | undefined;
let tempHome = "";
const projectDirs: string[] = [];
let sessionCounter = 0;

beforeEach(() => {
	originalHome = process.env.HOME;
	tempHome = mkdtempSync(join(tmpdir(), "ri-off-home-"));
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
	const projectDir = mkdtempSync(join(tmpdir(), "ri-off-proj-"));
	projectDirs.push(projectDir);
	mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });
	writeFileSync(join(projectDir, "package.json"), '{"name":"ri-fixture"}\n');
	return projectDir;
}

function freshSessionId(prefix: string): string {
	sessionCounter += 1;
	return `${prefix}-${sessionCounter}`;
}

function runSessionStart(projectDir: string, extraEnv?: Record<string, string>): string {
	const result = spawnSync("bun", ["run", CLI_PATH, "hook", "session-start"], {
		input: JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: freshSessionId("off"),
			transcript_path: null,
			cwd: projectDir,
			model: "gpt-5",
			permission_mode: "default",
			source: "startup",
		}),
		env: {
			...process.env,
			HOME: tempHome,
			PI_RULES_DISABLE_BUNDLED: "1",
			PLUGIN_DATA: join(tempHome, ".omt"),
			...extraEnv,
		},
		encoding: "utf8",
	});
	const stdout = result.stdout.trim();
	if (stdout.length === 0) return "";
	const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

// Baseline: without the off-file, an alwaysApply rule must inject.
test("D-22 off-file absent: session-start injects alwaysApply rule", () => {
	const projectDir = makeProject();
	writeFileSync(
		join(projectDir, ".claude", "rules", "always.md"),
		"---\nalwaysApply: true\n---\nALWAYS_APPLY_MARKER\n",
	);
	const output = runSessionStart(projectDir);
	expect(output).toContain("ALWAYS_APPLY_MARKER");
});

// Key: with the sentinel file present at the resolved workspace root, the engine
// must emit "" — no injection — for every handler event.
test("D-22 off-file present at workspace root: session-start emits nothing", () => {
	const projectDir = makeProject();
	writeFileSync(
		join(projectDir, ".claude", "rules", "always.md"),
		"---\nalwaysApply: true\n---\nALWAYS_APPLY_MARKER\n",
	);
	// Place the sentinel: <workspaceRoot>/.codex/rules-injector.local.off
	mkdirSync(join(projectDir, ".codex"), { recursive: true });
	writeFileSync(join(projectDir, ".codex", "rules-injector.local.off"), "");
	const output = runSessionStart(projectDir);
	expect(output).toBe("");
});

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

// ── End-to-end AC suite for the module-local rules-injector exclude
// config (config.yaml / config.local.yaml, read from the directory pointed to
// by CODEX_RULES_CONFIG_DIR — see local-config.ts resolveConfigDir). Every
// subprocess spawn below sets CODEX_RULES_CONFIG_DIR to a per-test temp dir so
// the real, committed hooks/rules-injector/config.yaml (which excludes
// ai-collaboration.md) never leaks into these fixtures. Spawns the real
// cli.ts subprocess (consumer boundary) so the full hydration →
// configFromEnvironment → findRuleCandidates chain is exercised, not just
// individual units. AC11a/AC11b (symlink path≠realPath OR-match) are
// finder-unit concerns already covered in rules/finder.test.ts and are
// deliberately NOT duplicated here.

const CLI_PATH = join(import.meta.dir, "cli.ts");

let originalHome: string | undefined;
let tempHome = "";
const projectDirs: string[] = [];
const configDirs: string[] = [];
let sessionCounter = 0;

beforeEach(() => {
	originalHome = process.env.HOME;
	tempHome = mkdtempSync(join(tmpdir(), "ri-exclude-home-"));
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
	while (configDirs.length > 0) {
		const dir = configDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

function makeProject(): string {
	const projectDir = mkdtempSync(join(tmpdir(), "ri-exclude-proj-"));
	projectDirs.push(projectDir);
	mkdirSync(join(projectDir, ".codex", "rules"), { recursive: true });
	writeFileSync(join(projectDir, "package.json"), '{"name":"ri-fixture"}\n');
	return projectDir;
}

function writeRule(projectDir: string, fileName: string, frontmatter: string, body: string): void {
	writeFileSync(
		join(projectDir, ".codex", "rules", fileName),
		`---\n${frontmatter}\n---\n${body}\n`,
	);
}

/** Fresh, empty per-test config dir — the CODEX_RULES_CONFIG_DIR seam. Empty
 * means the loader finds neither config.yaml nor config.local.yaml, matching
 * the old "no yaml file present" behavior. */
function makeConfigDir(): string {
	const configDir = mkdtempSync(join(tmpdir(), "ri-exclude-config-"));
	configDirs.push(configDir);
	return configDir;
}

function writeConfigYaml(configDir: string, yaml: string): void {
	writeFileSync(join(configDir, "config.yaml"), yaml);
}

function freshSessionId(prefix: string): string {
	sessionCounter += 1;
	return `${prefix}-${sessionCounter}`;
}

/** error.log breadcrumb sink resolved from PLUGIN_DATA (see debug-log.ts resolveErrorLogSink). */
function breadcrumbPath(): string {
	return join(tempHome, ".omt", "rules-injector", "error.log");
}

function spawnSessionStart(
	projectDir: string,
	configDir: string,
	prefix: string,
	extraEnv?: Record<string, string>,
): ReturnType<typeof spawnSync> {
	return spawnSync("bun", ["run", CLI_PATH, "hook", "session-start"], {
		input: JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: freshSessionId(prefix),
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
			PLUGIN_DATA: join(tempHome, ".omt", "rules-injector"),
			CODEX_RULES_CONFIG_DIR: configDir,
			...extraEnv,
		},
		encoding: "utf8",
	});
}

function additionalContextFromRaw(result: ReturnType<typeof spawnSync>): string {
	const stdout = (result.stdout ?? "").toString().trim();
	if (stdout.length === 0) return "";
	const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

/** Spawn session-start and return the parsed additionalContext (or ""). */
function runSessionStart(
	projectDir: string,
	configDir: string,
	extraEnv?: Record<string, string>,
): string {
	return additionalContextFromRaw(spawnSessionStart(projectDir, configDir, "e2e", extraEnv));
}

// --- AC1: absolute-anchored exclude drops a project rule; non-matching glob is a control ---

test("AC1 yaml exclude removes rule end to end via absolute-anchored glob; non-matching glob leaves it present (control)", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "ai.md", "alwaysApply: true", "AC1_TARGET_MARKER");

	// Absolute-anchored glob (leading "/") — discriminates against relativePath,
	// which is NOT what excludeGlobs matches against (path/realPath only).
	writeConfigYaml(configDir, 'exclude:\n  - "/**/ai.md"\n');
	const excluded = runSessionStart(projectDir, configDir);
	expect(excluded).not.toContain("AC1_TARGET_MARKER");

	writeConfigYaml(configDir, 'exclude:\n  - "/**/nonexistent-file.md"\n');
	const control = runSessionStart(projectDir, configDir);
	expect(control).toContain("AC1_TARGET_MARKER");
});

// --- AC2: user-home ~/.codex/rules exclusion, including the .codex dot segment ---

test("AC2 yaml exclude drops a user-home ~/.codex/rules rule including the .codex dot segment", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	mkdirSync(join(tempHome, ".codex", "rules"), { recursive: true });
	writeFileSync(
		join(tempHome, ".codex", "rules", "personal.md"),
		"---\nalwaysApply: true\n---\nAC2_USER_HOME_MARKER\n",
	);

	// Baseline: without exclude config, the user-home rule injects (auto mode
	// does not disable ~/.codex/rules — see sources.ts DEFAULT_AUTO_DISABLED_SOURCES;
	// the raw ~/.claude/rules counterpart IS disabled by default, superseded by this
	// de-Claude-ified codex-native source).
	const baseline = runSessionStart(projectDir, configDir);
	expect(baseline).toContain("AC2_USER_HOME_MARKER");

	// dot:true is required for "**/x" to match the ".codex" dot-segment path.
	writeConfigYaml(configDir, 'exclude:\n  - "**/.codex/rules/**"\n');
	const excluded = runSessionStart(projectDir, configDir);
	expect(excluded).not.toContain("AC2_USER_HOME_MARKER");
});

// --- AC3: disabled:true is a whole-engine no-op ---

test("AC3 yaml disabled:true makes the engine a no-op: nothing injected", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC3_ALWAYS_MARKER");
	writeConfigYaml(configDir, "disabled: true\n");

	const output = runSessionStart(projectDir, configDir);
	expect(output).toBe("");
});

// --- AC4: the .off sentinel regression — must coexist with the config ---

test("AC4 .codex/rules-injector.local.off sentinel still disables even with a config present (regression)", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC4_ALWAYS_MARKER");
	writeConfigYaml(configDir, "disabled: false\n");

	// The .off sentinel is a SEPARATE, still project-relative mechanism
	// (isOffFilePresentSync) — unrelated to CODEX_RULES_CONFIG_DIR.
	mkdirSync(join(projectDir, ".codex"), { recursive: true });
	writeFileSync(join(projectDir, ".codex", "rules-injector.local.off"), "");

	const output = runSessionStart(projectDir, configDir);
	expect(output).toBe("");
});

// --- AC5: a real env var overrides the yaml disabled value ---

test("AC5 a real env var overrides yaml disabled:false and forces disable", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC5_ALWAYS_MARKER");
	writeConfigYaml(configDir, "disabled: false\n");

	const withoutEnvOverride = runSessionStart(projectDir, configDir);
	expect(withoutEnvOverride).toContain("AC5_ALWAYS_MARKER");

	// `{ ...yamlEnv, ...env }` — a real env var always wins over the yaml value.
	const withEnvOverride = runSessionStart(projectDir, configDir, { CODEX_RULES_DISABLED: "1" });
	expect(withEnvOverride).toBe("");
});

// --- AC6: config-absent parity — additive, no regression, no breadcrumb ---

test("AC6 absent config unchanged: injection byte-identical to baseline, no breadcrumb written", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC6_ALWAYS_MARKER");

	const first = runSessionStart(projectDir, configDir);
	expect(first).toContain("AC6_ALWAYS_MARKER");

	// A second run (fresh session id, same fixture) must be byte-identical —
	// absent config never introduces run-to-run drift.
	const second = runSessionStart(projectDir, configDir);
	expect(second).toBe(first);

	// Missing config file is the NORMAL state — silent no-op, no breadcrumb.
	expect(existsSync(breadcrumbPath())).toBe(false);
});

// --- AC7a: malformed yaml never throws ---

test("AC7a malformed config never throws: exit 0, rules inject normally, breadcrumb written", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC7A_ALWAYS_MARKER");
	// Unterminated flow sequence — invalid YAML syntax, fails at Bun.YAML.parse.
	writeConfigYaml(configDir, "exclude: [1, 2\n");

	const result = spawnSessionStart(projectDir, configDir, "ac7a");
	expect(result.status).toBe(0);

	const additionalContext = additionalContextFromRaw(result);
	expect(additionalContext).toContain("AC7A_ALWAYS_MARKER");

	// A present-but-broken file is diagnosable: breadcrumb written.
	expect(existsSync(breadcrumbPath())).toBe(true);
});

// --- AC7b: wrong-typed exclude never throws, and IS diagnosed via breadcrumb ---

test("AC7b wrong-typed exclude:42 never throws: exit 0, breadcrumb written, rules inject normally", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "always.md", "alwaysApply: true", "AC7B_ALWAYS_MARKER");
	// Valid YAML, wrong-typed value: exclude must be a string or string[].
	writeConfigYaml(configDir, "exclude: 42\n");

	const result = spawnSessionStart(projectDir, configDir, "ac7b");
	expect(result.status).toBe(0);

	const additionalContext = additionalContextFromRaw(result);
	expect(additionalContext).toContain("AC7B_ALWAYS_MARKER");

	// PRESENT-but-broken file DOES write a breadcrumb (unlike config-absent).
	expect(existsSync(breadcrumbPath())).toBe(true);
});

// --- AC8: maxRuleChars from yaml truncates an oversized rule body ---

test("AC8 yaml maxRuleChars truncates an oversized rule body", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	const body = `AC8_HEAD_MARKER${"x".repeat(2000)}AC8_TAIL_MARKER_SHOULD_BE_GONE`;
	writeRule(projectDir, "big.md", "alwaysApply: true", body);
	writeConfigYaml(configDir, "maxRuleChars: 200\n");

	const output = runSessionStart(projectDir, configDir);
	expect(output).toContain("AC8_HEAD_MARKER");
	expect(output).not.toContain("AC8_TAIL_MARKER_SHOULD_BE_GONE");
	expect(output).toContain("[Truncated");
});

// --- AC9: maxResultChars (unenumerated knob) proves the generic overlay ---

test("AC9 yaml maxResultChars (unenumerated knob) truncates across multiple rules", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	const body1 = `AC9_HEAD_1${"a".repeat(3000)}AC9_TAIL_1_SHOULD_BE_GONE`;
	const body2 = `AC9_HEAD_2${"b".repeat(3000)}AC9_TAIL_2_SHOULD_BE_GONE`;
	writeRule(projectDir, "big1.md", "alwaysApply: true", body1);
	writeRule(projectDir, "big2.md", "alwaysApply: true", body2);

	// Baseline: both bodies (~3KB) fit comfortably under the default 12000/40000
	// caps, so both tail markers survive untruncated.
	const baseline = runSessionStart(projectDir, configDir);
	expect(baseline).toContain("AC9_TAIL_1_SHOULD_BE_GONE");
	expect(baseline).toContain("AC9_TAIL_2_SHOULD_BE_GONE");

	// maxResultChars is not special-cased in local-config.ts (unlike exclude) —
	// it hydrates purely through the generic key -> CODEX_RULES_<KEY> overlay.
	writeConfigYaml(configDir, "maxResultChars: 3000\n");
	const truncated = runSessionStart(projectDir, configDir);
	expect(truncated).toContain("AC9_HEAD_1");
	expect(truncated).toContain("AC9_HEAD_2");
	expect(truncated).not.toContain("AC9_TAIL_1_SHOULD_BE_GONE");
	expect(truncated).not.toContain("AC9_TAIL_2_SHOULD_BE_GONE");
});

// --- AC10: raw PI_RULES_EXCLUDE newline-separated env alias, no yaml file ---

test("AC10 raw PI_RULES_EXCLUDE newline-separated env alias excludes without any yaml file", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "ai.md", "alwaysApply: true", "AC10_TARGET_MARKER");
	writeRule(projectDir, "keep.md", "alwaysApply: true", "AC10_KEEP_MARKER");

	// No config.yaml is ever written in this test (configDir stays empty) —
	// the raw env var alias must work standalone through configFromEnvironment.
	const output = runSessionStart(projectDir, configDir, {
		PI_RULES_EXCLUDE: "/**/ai.md\n/**/nonexistent-decoy.md",
	});
	expect(output).not.toContain("AC10_TARGET_MARKER");
	expect(output).toContain("AC10_KEEP_MARKER");
});

// --- AC12: scalar-string exclude (single glob, not an array) is coerced and applied ---

test("AC12 scalar-string yaml exclude (single glob, not an array) is coerced and applied", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "ai.md", "alwaysApply: true", "AC12_TARGET_MARKER");
	// `exclude: "<glob>"` — a bare YAML scalar, not a `- <glob>` list.
	writeConfigYaml(configDir, 'exclude: "/**/ai.md"\n');

	const output = runSessionStart(projectDir, configDir);
	expect(output).not.toContain("AC12_TARGET_MARKER");
});

// --- AC13: brace-comma glob survives the newline separator (Option B) ---

test("AC13 brace-comma glob survives newline separator: excludes both .spec.md and .test.md rules", () => {
	const projectDir = makeProject();
	const configDir = makeConfigDir();
	writeRule(projectDir, "foo.spec.md", "alwaysApply: true", "AC13_SPEC_MARKER");
	writeRule(projectDir, "foo.test.md", "alwaysApply: true", "AC13_TEST_MARKER");
	writeRule(projectDir, "keep.md", "alwaysApply: true", "AC13_KEEP_MARKER");
	// Two-item array so the join separator is actually exercised: a wrongful
	// comma-join would merge the brace-comma glob with the second entry into
	// one broken pattern that matches neither file.
	writeConfigYaml(
		configDir,
		'exclude:\n  - "**/*.{spec,test}.md"\n  - "**/nonexistent-decoy.md"\n',
	);

	const output = runSessionStart(projectDir, configDir);
	expect(output).not.toContain("AC13_SPEC_MARKER");
	expect(output).not.toContain("AC13_TEST_MARKER");
	expect(output).toContain("AC13_KEEP_MARKER");
});

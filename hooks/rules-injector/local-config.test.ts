import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configFromEnvironment } from "./config.js";
import { hydrateEnvFromLocalConfig } from "./local-config.js";

// HERMETIC BREADCRUMB SINK: writeErrorBreadcrumb (debug-log.ts) reads
// process.env["PLUGIN_DATA"] directly at call time (no homedir()-style
// caching), so pointing it at a fresh temp dir per test is enough to isolate
// the breadcrumb sink without a subprocess spawn.
let breadcrumbDir = "";
const configDirs: string[] = [];
let originalPluginData: string | undefined;

afterEach(() => {
	if (originalPluginData === undefined) {
		delete process.env.PLUGIN_DATA;
	} else {
		process.env.PLUGIN_DATA = originalPluginData;
	}
	if (breadcrumbDir.length > 0) {
		rmSync(breadcrumbDir, { recursive: true, force: true });
		breadcrumbDir = "";
	}
	while (configDirs.length > 0) {
		const dir = configDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

// Makes a fresh, empty config dir. Never the real module dir — after a
// sibling task lands, `hooks/rules-injector/config.yaml` will carry a real
// `exclude` value that would bleed into fixtures if a test ever fell back to
// the default param (which resolves to this module's own directory).
function makeConfigDir(): string {
	const configDir = mkdtempSync(join(tmpdir(), "ri-local-config-"));
	configDirs.push(configDir);
	return configDir;
}

function writeBaseConfig(configDir: string, contents: string): void {
	writeFileSync(join(configDir, "config.yaml"), contents);
}

function writeLocalOverride(configDir: string, contents: string): void {
	writeFileSync(join(configDir, "config.local.yaml"), contents);
}

function useBreadcrumbSink(): void {
	originalPluginData = process.env.PLUGIN_DATA;
	breadcrumbDir = mkdtempSync(join(tmpdir(), "ri-local-config-breadcrumb-"));
	process.env.PLUGIN_DATA = breadcrumbDir;
}

function breadcrumbWritten(): boolean {
	return existsSync(join(breadcrumbDir, "error.log"));
}

test("hydrates knob and env overrides yaml", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "maxRuleChars: 1234\n");

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("1234");

	const withRealEnv = hydrateEnvFromLocalConfig({ CODEX_RULES_MAX_RULE_CHARS: "9" }, configDir);
	expect(withRealEnv.CODEX_RULES_MAX_RULE_CHARS).toBe("9");
});

test("real legacy PI_RULES_ env wins over yaml (not shadowed by canonical write)", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "disabled: false\n");

	const hydrated = hydrateEnvFromLocalConfig({ PI_RULES_DISABLED: "1" }, configDir);

	expect(hydrated.PI_RULES_DISABLED).toBe("1");
	expect(hydrated.CODEX_RULES_DISABLED).toBeUndefined();
});

test("blank legacy PI_RULES_ env does NOT suppress yaml (matches firstEnv's presence rule)", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "maxRuleChars: 1234\n");

	const hydrated = hydrateEnvFromLocalConfig({ PI_RULES_MAX_RULE_CHARS: "" }, configDir);

	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("1234");
});

test("present legacy PI_RULES_ env still wins over yaml", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "maxRuleChars: 1234\n");

	const hydrated = hydrateEnvFromLocalConfig({ PI_RULES_MAX_RULE_CHARS: "9" }, configDir);

	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBeUndefined();
	expect(hydrated.PI_RULES_MAX_RULE_CHARS).toBe("9");
});

test("blank canonical CODEX_RULES_MAX_RULE_CHARS does NOT suppress yaml (matches firstEnv's presence rule)", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "maxRuleChars: 1234\n");

	const hydrated = hydrateEnvFromLocalConfig({ CODEX_RULES_MAX_RULE_CHARS: "" }, configDir);

	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("1234");
	expect(configFromEnvironment(hydrated).maxRuleChars).toBe(1234);
});

test("blank canonical CODEX_RULES_DISABLED does NOT suppress yaml (matches firstEnv's presence rule)", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "disabled: true\n");

	const hydrated = hydrateEnvFromLocalConfig({ CODEX_RULES_DISABLED: "" }, configDir);

	expect(hydrated.CODEX_RULES_DISABLED).toBe("true");
	expect(configFromEnvironment(hydrated).disabled).toBe(true);
});

test("exclude key joins with newline, not comma", () => {
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "exclude:\n  - '**/a.md'\n  - '**/{b,c}.md'\n");

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_EXCLUDE).toBe("**/a.md\n**/{b,c}.md");
});

test("scalar-string exclude is applied as-is, without a breadcrumb", () => {
	useBreadcrumbSink();
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, 'exclude: "**/x.md"\n');

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_EXCLUDE).toBe("**/x.md");
	expect(breadcrumbWritten()).toBe(false);
});

test("non-string scalar exclude writes a breadcrumb and leaves env unchanged", () => {
	useBreadcrumbSink();
	const inputEnv = { FOO: "bar" };
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "exclude: 42\n");

	const hydrated = hydrateEnvFromLocalConfig(inputEnv, configDir);
	expect(hydrated).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(true);
});

test("non-string element in exclude array writes a breadcrumb and leaves env unchanged", () => {
	useBreadcrumbSink();
	const inputEnv = { FOO: "bar" };
	const configDir = makeConfigDir();
	writeLocalOverride(configDir, "exclude:\n  - '**/a.md'\n  - 42\n");

	const hydrated = hydrateEnvFromLocalConfig(inputEnv, configDir);
	expect(hydrated).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(true);
});

test("never throws on bad input", () => {
	useBreadcrumbSink();
	const inputEnv = { FOO: "bar" };

	// (a) malformed YAML — unbalanced flow sequence. File is PRESENT but
	// broken, so this is the diagnosable case: breadcrumb must be written.
	const malformedDir = makeConfigDir();
	writeLocalOverride(malformedDir, "foo: [1, 2\nbar: baz\n");
	expect(() => hydrateEnvFromLocalConfig(inputEnv, malformedDir)).not.toThrow();
	expect(hydrateEnvFromLocalConfig(inputEnv, malformedDir)).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(true);

	// (b) wrong-typed `exclude` (scalar instead of array) — serialization
	// TypeError. File is PRESENT but broken: breadcrumb must be written.
	rmSync(breadcrumbDir, { recursive: true, force: true });
	mkdirSync(breadcrumbDir, { recursive: true });
	const wrongTypeDir = makeConfigDir();
	writeLocalOverride(wrongTypeDir, "exclude: 42\n");
	expect(() => hydrateEnvFromLocalConfig(inputEnv, wrongTypeDir)).not.toThrow();
	expect(hydrateEnvFromLocalConfig(inputEnv, wrongTypeDir)).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(true);

	// (c) config dir absent entirely — not a diagnosable config problem:
	// silent no-op, no breadcrumb (mirrors the file-absent case below).
	rmSync(breadcrumbDir, { recursive: true, force: true });
	mkdirSync(breadcrumbDir, { recursive: true });
	const missingDir = join(tmpdir(), "ri-local-config-does-not-exist");
	expect(() => hydrateEnvFromLocalConfig(inputEnv, missingDir)).not.toThrow();
	expect(hydrateEnvFromLocalConfig(inputEnv, missingDir)).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(false);

	// (d) config files absent — the normal state for nearly every repo (the
	// local override is opt-in and gitignored). Must be byte-identical to
	// today: no breadcrumb, mirroring `isOffFilePresentSync` (config.ts) which
	// treats any filesystem error as "file absent" silently.
	rmSync(breadcrumbDir, { recursive: true, force: true });
	mkdirSync(breadcrumbDir, { recursive: true });
	const absentDir = makeConfigDir();
	expect(() => hydrateEnvFromLocalConfig(inputEnv, absentDir)).not.toThrow();
	expect(hydrateEnvFromLocalConfig(inputEnv, absentDir)).toEqual(inputEnv);
	expect(breadcrumbWritten()).toBe(false);
});

test("base-only: config.yaml alone hydrates the knob", () => {
	const configDir = makeConfigDir();
	writeBaseConfig(configDir, "maxRuleChars: 100\n");

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("100");
});

test("config.local.yaml overrides config.yaml for the same key", () => {
	const configDir = makeConfigDir();
	writeBaseConfig(configDir, "maxRuleChars: 100\n");
	writeLocalOverride(configDir, "maxRuleChars: 200\n");

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("200");
});

test("config.yaml and config.local.yaml union disjoint keys", () => {
	const configDir = makeConfigDir();
	writeBaseConfig(configDir, "maxRuleChars: 100\n");
	writeLocalOverride(configDir, 'exclude: "**/x.md"\n');

	const hydrated = hydrateEnvFromLocalConfig({}, configDir);
	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("100");
	expect(hydrated.CODEX_RULES_EXCLUDE).toBe("**/x.md");
});

test("real env still wins over the merged local+base value", () => {
	const configDir = makeConfigDir();
	writeBaseConfig(configDir, "maxRuleChars: 100\n");
	writeLocalOverride(configDir, "maxRuleChars: 200\n");

	const hydrated = hydrateEnvFromLocalConfig({ CODEX_RULES_MAX_RULE_CHARS: "9" }, configDir);
	expect(hydrated.CODEX_RULES_MAX_RULE_CHARS).toBe("9");
});

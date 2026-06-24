import { expect, test } from "bun:test";

import { configFromEnvironment } from "./config.js";

// ── P8: parsePositiveInteger strict rejection ────────────────────────────────

test("parsePositiveInteger: pure digits are accepted", () => {
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "32000" });
	expect(config.maxRuleChars).toBe(32000);
});

test("parsePositiveInteger: '32k' is rejected, falls back to default", () => {
	// "32k" → parseInt("32k") = 32 (silent partial parse). Strict check must reject.
	const defaultConfig = configFromEnvironment({});
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "32k" });
	expect(config.maxRuleChars).toBe(defaultConfig.maxRuleChars);
});

test("parsePositiveInteger: '10abc' is rejected, falls back to default", () => {
	const defaultConfig = configFromEnvironment({});
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "10abc" });
	expect(config.maxRuleChars).toBe(defaultConfig.maxRuleChars);
});

test("parsePositiveInteger: '1e4' is rejected, falls back to default", () => {
	const defaultConfig = configFromEnvironment({});
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "1e4" });
	expect(config.maxRuleChars).toBe(defaultConfig.maxRuleChars);
});

test("parsePositiveInteger: '0' is rejected, falls back to default", () => {
	const defaultConfig = configFromEnvironment({});
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "0" });
	expect(config.maxRuleChars).toBe(defaultConfig.maxRuleChars);
});

test("parsePositiveInteger: '-5' is rejected, falls back to default", () => {
	const defaultConfig = configFromEnvironment({});
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: "-5" });
	expect(config.maxRuleChars).toBe(defaultConfig.maxRuleChars);
});

test("parsePositiveInteger: ' 12 ' (whitespace-padded) is accepted", () => {
	const config = configFromEnvironment({ CODEX_RULES_MAX_RULE_CHARS: " 12 " });
	expect(config.maxRuleChars).toBe(12);
});

// ── C6: DISABLE_BUNDLED=1 must not re-enable auto-disabled ~/.claude/rules ───

test("C6: DISABLE_BUNDLED=1 with auto mode does not enable ~/.claude/rules", () => {
	const config = configFromEnvironment({ CODEX_RULES_DISABLE_BUNDLED: "1" });
	// enabledSources must be a concrete list (not "auto") and must NOT include ~/.claude/rules
	expect(config.enabledSources).not.toBe("auto");
	const list = config.enabledSources as string[];
	expect(list).not.toContain("~/.claude/rules");
});

test("C6: DISABLE_BUNDLED=1 with auto mode does not include plugin-bundled", () => {
	const config = configFromEnvironment({ CODEX_RULES_DISABLE_BUNDLED: "1" });
	const list = config.enabledSources as string[];
	expect(list).not.toContain("plugin-bundled");
});

test("C6: DISABLE_BUNDLED=0 (unset) keeps enabledSources as auto", () => {
	const config = configFromEnvironment({});
	expect(config.enabledSources).toBe("auto");
});

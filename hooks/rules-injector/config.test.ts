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

// ── C6: DISABLE_BUNDLED=1 enables ~/.claude/rules (Patch A: no longer auto-disabled) ─

test("C6: DISABLE_BUNDLED=1 with auto mode INCLUDES ~/.claude/rules (Patch A: source enabled)", () => {
	// Patch A removes "~/.claude/rules" from DEFAULT_AUTO_DISABLED_SOURCES.
	// sourcesWithoutBundledRules() excludes plugin-bundled + DEFAULT_AUTO_DISABLED_SOURCES,
	// but now ~/.claude/rules is NOT in that exclusion set, so it appears in the list.
	const config = configFromEnvironment({ CODEX_RULES_DISABLE_BUNDLED: "1" });
	expect(config.enabledSources).not.toBe("auto");
	const list = config.enabledSources as string[];
	expect(list).toContain("~/.claude/rules");
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

// ── D-7: sessionStateTtlDays / errorLogMaxBytes defaults + env override ─────

test("session-state TTL and error-log cap defaults + override", () => {
	const defaults = configFromEnvironment({});
	expect(defaults.sessionStateTtlDays).toBe(7);
	expect(defaults.errorLogMaxBytes).toBe(5_242_880);

	const ttlOverride = configFromEnvironment({ CODEX_RULES_SESSION_STATE_TTL_DAYS: "3" });
	expect(ttlOverride.sessionStateTtlDays).toBe(3);

	const errorLogOverride = configFromEnvironment({ PI_RULES_ERROR_LOG_MAX_BYTES: "1000" });
	expect(errorLogOverride.errorLogMaxBytes).toBe(1000);

	const invalidFallback = configFromEnvironment({ CODEX_RULES_SESSION_STATE_TTL_DAYS: "abc" });
	expect(invalidFallback.sessionStateTtlDays).toBe(7);
});

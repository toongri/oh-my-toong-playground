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

// ── C6: DISABLE_BUNDLED=1 excludes plugin-bundled; ~/.claude/rules stays listed ──

test("C6: DISABLE_BUNDLED=1 with auto mode lists BOTH ~/.claude/rules and ~/.codex/rules (the conditional supersede is finder.ts's job, not this static list's)", () => {
	// ~/.claude/rules is deliberately NOT in DEFAULT_AUTO_DISABLED_SOURCES anymore:
	// unconditionally excluding it here would lose rules entirely on a project
	// that never ran OMT's sync and so has no ~/.codex/rules at all.
	// sourcesWithoutBundledRules() only strips plugin-bundled + the (now-shorter)
	// DEFAULT_AUTO_DISABLED_SOURCES, so ~/.claude/rules stays in this explicit
	// enabledSources list — the actual leak protection happens later, in
	// findRuleCandidates (finder.ts), which drops ~/.claude/rules only when
	// ~/.codex/rules is ALSO present in the same scope.
	const config = configFromEnvironment({ CODEX_RULES_DISABLE_BUNDLED: "1" });
	expect(config.enabledSources).not.toBe("auto");
	const list = config.enabledSources as string[];
	expect(list).toContain("~/.claude/rules");
	expect(list).toContain("~/.codex/rules");
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

test("session-state TTL: PI_RULES_ alias also overrides", () => {
	const ttlOverride = configFromEnvironment({ PI_RULES_SESSION_STATE_TTL_DAYS: "4" });
	expect(ttlOverride.sessionStateTtlDays).toBe(4);
});

test("error-log cap: CODEX_RULES_ alias also overrides", () => {
	const errorLogOverride = configFromEnvironment({ CODEX_RULES_ERROR_LOG_MAX_BYTES: "2000" });
	expect(errorLogOverride.errorLogMaxBytes).toBe(2000);
});

test("session-state TTL: CODEX_RULES_ takes precedence over PI_RULES_ when both set", () => {
	const config = configFromEnvironment({
		CODEX_RULES_SESSION_STATE_TTL_DAYS: "5",
		PI_RULES_SESSION_STATE_TTL_DAYS: "9",
	});
	expect(config.sessionStateTtlDays).toBe(5);
});

test("error-log cap: CODEX_RULES_ takes precedence over PI_RULES_ when both set", () => {
	const config = configFromEnvironment({
		CODEX_RULES_ERROR_LOG_MAX_BYTES: "3000",
		PI_RULES_ERROR_LOG_MAX_BYTES: "6000",
	});
	expect(config.errorLogMaxBytes).toBe(3000);
});

// ── excludeGlobs: newline-separated CODEX_RULES_EXCLUDE / PI_RULES_EXCLUDE parse ──

test("parses excludeGlobs from newline env", () => {
	const config = configFromEnvironment({ CODEX_RULES_EXCLUDE: "**/a.md\n**/b.md" });
	expect(config.excludeGlobs).toEqual(["**/a.md", "**/b.md"]);
});

test("excludeGlobs defaults empty", () => {
	const config = configFromEnvironment({});
	expect(config.excludeGlobs).toEqual([]);
});

test("excludeGlobs honors PI_ alias", () => {
	const config = configFromEnvironment({ PI_RULES_EXCLUDE: "**/c.md\n**/d.md" });
	expect(config.excludeGlobs).toEqual(["**/c.md", "**/d.md"]);
});

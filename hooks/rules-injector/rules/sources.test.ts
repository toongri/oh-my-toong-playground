/**
 * Tests for DEFAULT_AUTO_DISABLED_SOURCES and disabledSourcesFromConfig() in sources.ts.
 *
 * Covers Patch A: ~/.claude/rules removed from DEFAULT_AUTO_DISABLED_SOURCES so that
 * in auto mode the user-home Claude rules source is discoverable (Codex does NOT read
 * ~/.claude/rules natively, so disabling it was over-conservative).
 */
import { expect, test } from "bun:test";
import { DEFAULT_AUTO_DISABLED_SOURCES, disabledSourcesFromConfig } from "./sources.js";
import type { PiRulesConfig } from "./types.js";

function autoConfig(): PiRulesConfig {
	return {
		disabled: false,
		maxRuleChars: 12000,
		maxResultChars: 40000,
		postCompactMaxRuleChars: 3500,
		postCompactMaxResultChars: 4000,
		dynamicMaxRuleChars: 4000,
		dynamicMaxResultChars: 10000,
		promptMaxRuleChars: 6000,
		promptMaxResultChars: 16000,
		enabledSources: "auto",
		sessionStateTtlDays: 7,
		errorLogMaxBytes: 5_242_880,
	};
}

// ── Patch A: ~/.claude/rules NOT in auto-disabled set ───────────────────────

test("`DEFAULT_AUTO_DISABLED_SOURCES`: does NOT contain ~/.claude/rules (Patch A)", () => {
	// Patch A removes this entry. Before the patch this assertion fails.
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain("~/.claude/rules");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: still contains AGENTS.md (unchanged)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("AGENTS.md");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: still contains ~/.claude/CLAUDE.md (unchanged)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("~/.claude/CLAUDE.md");
});

// ── 동작 검증: auto 모드에서 ~/.claude/rules가 disabled set에 없음 ────────────

test("`disabledSourcesFromConfig`: auto mode does NOT disable ~/.claude/rules (Patch A)", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled).toBeDefined();
	expect(disabled!.has("~/.claude/rules")).toBe(false);
});

test("`disabledSourcesFromConfig`: auto mode still disables AGENTS.md", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled!.has("AGENTS.md")).toBe(true);
});

test("`disabledSourcesFromConfig`: auto mode still disables ~/.claude/CLAUDE.md", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled!.has("~/.claude/CLAUDE.md")).toBe(true);
});

// ── omo 제외: auto 모드 리졸버가 omo 소스를 disabled로 내는지 ───────────────

test("`disabledSourcesFromConfig`: auto mode disables .omo/rules and ~/.omo/rules", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled!.has(".omo/rules")).toBe(true);
	expect(disabled!.has("~/.omo/rules")).toBe(true);
});

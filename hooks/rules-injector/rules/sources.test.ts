/**
 * Tests for DEFAULT_AUTO_DISABLED_SOURCES and disabledSourcesFromConfig() in sources.ts.
 *
 * `.claude/rules` / `~/.claude/rules` are deliberately NOT in this unconditional
 * list. Codex has a native rules sync category (`SUPPORTED_CATEGORIES.codex`), so a
 * de-Claude-ified counterpart of every rule USUALLY lands at `.codex/rules` /
 * `~/.codex/rules` — but not always: a project that never ran OMT's sync has no
 * `.codex/rules` at all. Unconditionally disabling `.claude/rules` here would trade
 * the Claude-vocabulary leak for a worse outcome — losing rules entirely on every
 * such project. Instead, `findRuleCandidates` (finder.ts) drops a `.claude/rules`
 * (`~/.claude/rules`) candidate ONLY when a `.codex/rules` (`~/.codex/rules`)
 * candidate is ALSO present in the same scope — see finder.test.ts's
 * "conditional supersede by .codex/rules" suite for that behavior.
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
		excludeGlobs: [],
	};
}

// ── .claude/rules / ~/.claude/rules are NOT unconditionally disabled;
// the conditional supersede is finder.ts's job, not this static list's ───────

test("`DEFAULT_AUTO_DISABLED_SOURCES`: does NOT contain .claude/rules (conditional supersede lives in finder.ts)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain(".claude/rules");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: does NOT contain ~/.claude/rules (conditional supersede lives in finder.ts)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain("~/.claude/rules");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: does NOT contain .codex/rules (the codex-native replacement stays enabled)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain(".codex/rules");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: does NOT contain ~/.codex/rules (the codex-native replacement stays enabled)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).not.toContain("~/.codex/rules");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: still contains AGENTS.md (unchanged)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("AGENTS.md");
});

test("`DEFAULT_AUTO_DISABLED_SOURCES`: still contains ~/.claude/CLAUDE.md (unchanged)", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain("~/.claude/CLAUDE.md");
});

// ── 동작 검증: auto 모드에서 .claude/rules류는 static list로 disabled되지 않는다
// (finder.ts의 존재-조건부 supersede가 대신 처리) ─────────────────────────────

test("`disabledSourcesFromConfig`: auto mode does NOT disable .claude/rules or ~/.claude/rules (finder.ts supersedes conditionally instead)", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled).toBeDefined();
	expect(disabled!.has(".claude/rules")).toBe(false);
	expect(disabled!.has("~/.claude/rules")).toBe(false);
});

test("`disabledSourcesFromConfig`: auto mode does NOT disable .codex/rules or ~/.codex/rules", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled!.has(".codex/rules")).toBe(false);
	expect(disabled!.has("~/.codex/rules")).toBe(false);
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

// ── cursor 제외: codex는 cursor 룰을 쓰지 않으므로 auto에서 제외 ────────────

test("`DEFAULT_AUTO_DISABLED_SOURCES`: contains .cursor/rules", () => {
	expect(DEFAULT_AUTO_DISABLED_SOURCES).toContain(".cursor/rules");
});

test("`disabledSourcesFromConfig`: auto mode disables .cursor/rules", () => {
	const disabled = disabledSourcesFromConfig(autoConfig());
	expect(disabled!.has(".cursor/rules")).toBe(true);
});

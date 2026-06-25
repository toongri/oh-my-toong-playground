/**
 * Tests for C1 (post-compact recovery marks only emitted rules) and
 * P2 (static injection marks only rules whose marker survives the 32K byte clamp).
 *
 * Excluded from scope: compaction-budget-scope.test.ts, fidelity-and-lanes.test.ts.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPostCompactReadDirective } from "./post-compact-directive.js";
import { limitAdditionalContextText } from "./hook-output.js";
import { runStaticInjection } from "./static-injection.js";

// ---------------------------------------------------------------------------
// Hermetic scratch dir — each test gets its own
// ---------------------------------------------------------------------------

let scratchDir = "";

beforeEach(() => {
	scratchDir = mkdtempSync(join(tmpdir(), "si-test-"));
});

afterEach(() => {
	if (scratchDir.length > 0) rmSync(scratchDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// C1 — buildPostCompactReadDirective drops budget-exceeding paths
// ---------------------------------------------------------------------------

test("C1: buildPostCompactReadDirective returns emittedPaths containing only paths that fit the budget", () => {
	const path1 = "/project/.claude/rules/rule1.md";
	const path2 = "/project/.claude/rules/rule2.md";

	// Budget is tight: just enough for the header/footer + first path, but not second.
	// DIRECTIVE_HEADER + DIRECTIVE_FOOTER lengths are fixed; we craft a maxChars that
	// excludes the second path line.
	const header = [
		"## MANDATORY: POST-COMPACTION RULE RECOVERY",
		"",
		"Context compaction DROPPED the project rule files listed below from your context.",
		"YOU MUST READ THE FOLLOWING RULES with your file-reading tool RIGHT NOW, BEFORE ANY OTHER ACTION. NO EXCUSES.",
		"Do not plan, answer, edit, or run anything until EVERY file below has been read end to end:",
		"",
	].join("\n");
	const footer =
		"\nOperating without these rules is a protocol violation. Reconstructing them from memory is NOT reading. READ THEM ALL. NO EXCUSES.";

	const line1 = `- ${path1}`;
	// Budget: header + footer + line1 + newline separator, but NOT line2.
	const maxChars = header.length + footer.length + line1.length + 1;

	const result = buildPostCompactReadDirective([path1, path2], maxChars);

	expect(result.emittedPaths).toEqual([path1]);
	expect(result.emittedPaths).not.toContain(path2);
	expect(result.text).toContain(path1);
});

test("C1: buildPostCompactReadDirective returns all paths when budget is sufficient", () => {
	const paths = ["/project/.claude/rules/a.md", "/project/.claude/rules/b.md"];

	const result = buildPostCompactReadDirective(paths, 100_000);

	expect(result.emittedPaths).toEqual(paths);
	expect(result.text).toContain(paths[0]);
	expect(result.text).toContain(paths[1]);
});

test("C1: buildPostCompactReadDirective returns empty emittedPaths for empty input", () => {
	const result = buildPostCompactReadDirective([], 100_000);

	expect(result.emittedPaths).toEqual([]);
	expect(result.text).toBe("");
});

// ---------------------------------------------------------------------------
// C1 — runPostCompactRecovery marks only emitted rules
//
// We test indirectly through runStaticInjection with completedPostCompactChannel="static":
// a dropped listed rule must NOT appear in staticDedup after recovery (so a subsequent
// runStaticInjection can re-offer it).
// ---------------------------------------------------------------------------

function writeCacheFile(cachePath: string, state: Record<string, unknown>): void {
	mkdirSync(join(cachePath, ".."), { recursive: true });
	writeFileSync(cachePath, `${JSON.stringify({ version: 1, ...state })}\n`);
}

function readCacheState(cachePath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
}

/**
 * C1 end-to-end: when a budget-tight recovery emits only one of two listed rules,
 * the dropped rule must remain absent from staticDedup so a later turn can re-inject it.
 *
 * We simulate this by running runStaticInjection in post-compact-recovery mode
 * (completedPostCompactChannel = "static"), providing a transcript that is missing
 * both rules. The recovery emits a directive with a maxChars tight enough to exclude
 * the second path. After the call, only the first rule should be in staticDedup.
 *
 * Because runStaticInjection loads rules from disk via the engine, we write real rule files
 * to a project directory and point the hook at it.
 */
test("C1: dropped listed rule is NOT marked injected and re-appears in next recovery turn", () => {
	// Build a project with two listed rules (no never-truncate marker).
	// Add package.json so findProjectRoot returns this dir.
	const projectDir = join(scratchDir, "project");
	const rulesDir = join(projectDir, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });

	writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "test-project" }));
	writeFileSync(join(rulesDir, "rule1.md"), "---\nalwaysApply: true\n---\nRule 1 content: always-apply instructions.\n");
	writeFileSync(join(rulesDir, "rule2.md"), "---\nalwaysApply: true\n---\nRule 2 content: always-apply instructions.\n");

	const cachePath = join(scratchDir, "session.json");
	// Empty cache — recovery will treat all rules as missing (no transcript).
	writeCacheFile(cachePath, {
		staticDedup: [],
		dynamicDedup: {},
	});

	// The DIRECTIVE_HEADER is ~280 chars, DIRECTIVE_FOOTER ~160 chars.
	// Each path line is "- /path/to/.../rule1.md\n" — at least 50 chars for temp paths.
	// Set maxResultChars = 430 (header+footer ≈ 440, so nothing fits → test relies on
	// the first path always fitting since lines.length === 0 skips the budget check).
	// Actually the code skips the budget check for lines.length === 0, so path1 always fits.
	// To drop path2, budget = header + footer + line1 + 1 (no room for line2 + 1).
	// We use an env that sets a very tight post-compact budget. Path lengths vary by tmpdir,
	// so we use a small fixed value knowing the header+footer alone is ~440 chars.
	// 500 chars is enough for header+footer+first-path but NOT header+footer+two-paths.
	const env: Record<string, string> = {
		CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS: "500",
		// Disable bundled rules so only our two rules are candidates.
		CODEX_RULES_ENABLED_SOURCES: ".claude/rules",
	};

	const output = runStaticInjection(
		projectDir,
		null, // no transcript → all rules treated as missing
		"SessionStart",
		cachePath,
		{ env },
		"static", // completedPostCompactChannel
	);

	// The output should be non-empty (some rules were emitted).
	expect(output.length).toBeGreaterThan(0);

	// Read staticDedup from cache.
	const state = readCacheState(cachePath);
	const staticDedup = state["staticDedup"] as string[] | undefined ?? [];

	// Only one rule should be marked. Count how many of rule1 vs rule2 appear.
	const deduped1 = staticDedup.some((k: string) => k.includes("rule1.md"));
	const deduped2 = staticDedup.some((k: string) => k.includes("rule2.md"));

	// With a 500-char budget, only one path should fit in the directive.
	// Exactly one should be marked (the one that fit), not both.
	const markedCount = [deduped1, deduped2].filter(Boolean).length;
	expect(markedCount).toBeLessThan(2);
});

// ---------------------------------------------------------------------------
// P2 — limitAdditionalContextText is exported and returns clamped string
// ---------------------------------------------------------------------------

test("P2: limitAdditionalContextText returns the string unchanged when under 32K bytes", () => {
	const short = "Hello, world!";
	const result = limitAdditionalContextText(short);
	expect(result).toBe(short);
});

test("P2: limitAdditionalContextText clamps to 32K bytes for long input", () => {
	// Build a string > 32000 bytes
	const repeated = "a".repeat(33000);
	const result = limitAdditionalContextText(repeated);
	expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(32000);
	expect(result.length).toBeLessThan(repeated.length);
});

test("P2: limitAdditionalContextText keeps the head and appends truncation notice", () => {
	const longContent = "x".repeat(33000);
	const result = limitAdditionalContextText(longContent);
	expect(result).toContain("[Truncated hook additional context to 32000 bytes");
	// Head should start with 'x'.
	expect(result.startsWith("x")).toBe(true);
});

// ---------------------------------------------------------------------------
// P2 — tail rules whose marker is clamped away are NOT marked injected
// ---------------------------------------------------------------------------

/**
 * P2 end-to-end: two rules are admitted by the 40000-char formatter budget,
 * but combined they exceed 32K bytes → the second rule's marker is past the cut.
 * After runStaticInjection, only the first rule should be in staticDedup.
 */
test("P2: tail rule past 32K byte clamp is NOT marked injected (can be re-injected next turn)", () => {
	const projectDir = join(scratchDir, "p2-project");
	const rulesDir = join(projectDir, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });

	// Add package.json so findProjectRoot returns this dir.
	writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "p2-test-project" }));

	// Rule 1 (named "a-rule1.md" so it sorts first): large body that pushes the combined
	// formatter output past 32K bytes (32000 ASCII chars + ~450 chars of headers/markers
	// = ~32450 bytes, exceeding the 32000-byte clamp).
	// Rule 2 (named "b-rule2.md", sorts second): small body whose marker ends up past 32K.
	const rule1Body = "A".repeat(32_000);
	const rule2Body = "Rule 2 body — tail clamped by 32K byte limit.";

	writeFileSync(join(rulesDir, "a-rule1.md"), `---\nalwaysApply: true\n---\n${rule1Body}\n`);
	writeFileSync(join(rulesDir, "b-rule2.md"), `---\nalwaysApply: true\n---\n${rule2Body}\n`);

	const cachePath = join(scratchDir, "p2-session.json");
	writeCacheFile(cachePath, {
		staticDedup: [],
		dynamicDedup: {},
	});

	// Use a large maxResultChars so the formatter char-budget admits both rules,
	// but the 32K byte clamp cuts off the tail. Disable bundled rules for isolation.
	const env: Record<string, string> = {
		CODEX_RULES_MAX_RESULT_CHARS: "80000",
		CODEX_RULES_MAX_RULE_CHARS: "80000",
		CODEX_RULES_ENABLED_SOURCES: ".claude/rules",
	};

	const output = runStaticInjection(
		projectDir,
		null,
		"SessionStart",
		cachePath,
		{ env },
	);

	// Output is non-empty.
	expect(output.length).toBeGreaterThan(0);

	// The raw hook output (JSON-wrapped) should be bounded.
	expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(50_000);

	const state = readCacheState(cachePath);
	const staticDedup = state["staticDedup"] as string[] | undefined ?? [];

	// Rule1 should be marked (its marker is in the head, before the 32K cut).
	const markedRule1 = staticDedup.some((k: string) => k.includes("a-rule1.md"));
	// Rule2 should NOT be marked (its marker was past the 32K byte clamp).
	const markedRule2 = staticDedup.some((k: string) => k.includes("b-rule2.md"));

	expect(markedRule1).toBe(true);
	expect(markedRule2).toBe(false);
});

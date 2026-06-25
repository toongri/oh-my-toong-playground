/**
 * Tests for staticMatchReason() in engine-loader.ts.
 *
 * Covers:
 *   - alwaysApply: true → "alwaysApply" (existing, unchanged)
 *   - isSingleFile → "single-file" (existing, unchanged)
 *   - alwaysApply: false, no globs → null (explicit opt-out preserved)
 *   - globs present, no alwaysApply → null (stays dynamic-only)
 *   - no frontmatter (alwaysApply absent, no globs) → "alwaysApply" (Patch B: new)
 */
import { expect, test } from "bun:test";
import { staticMatchReason } from "./engine-loader.js";
import type { LoadedRule } from "./types.js";

/** Minimal LoadedRule fixture. isSingleFile defaults to false. */
function makeRule(overrides: Partial<LoadedRule>): LoadedRule {
	return {
		path: "/proj/.claude/rules/test.md",
		realPath: "/proj/.claude/rules/test.md",
		relativePath: ".claude/rules/test.md",
		source: ".claude/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		body: "rule body",
		contentHash: "abc123",
		matchReason: { kind: "no-match" },
		frontmatter: {},
		...overrides,
	};
}

// ── 기존 동작: alwaysApply: true ────────────────────────────────────────────

test("`staticMatchReason`: alwaysApply:true → \"alwaysApply\"", () => {
	const rule = makeRule({ frontmatter: { alwaysApply: true } });
	expect(staticMatchReason(rule)).toBe("alwaysApply");
});

// ── 기존 동작: isSingleFile ──────────────────────────────────────────────────

test("`staticMatchReason`: isSingleFile:true → \"single-file\"", () => {
	const rule = makeRule({ isSingleFile: true, frontmatter: {} });
	expect(staticMatchReason(rule)).toBe("single-file");
});

// ── 기존 동작: alwaysApply:false (명시적 비활성화) → null ────────────────────

test("`staticMatchReason`: alwaysApply:false, no globs → null (explicit opt-out preserved)", () => {
	const rule = makeRule({ frontmatter: { alwaysApply: false } });
	expect(staticMatchReason(rule)).toBeNull();
});

// ── 기존 동작: globs 있음, alwaysApply 없음 → null (dynamic-only) ────────────

test("`staticMatchReason`: globs present, alwaysApply absent → null (dynamic-only, unchanged)", () => {
	const rule = makeRule({ frontmatter: { globs: "**/*.ts" } });
	expect(staticMatchReason(rule)).toBeNull();
});

test("`staticMatchReason`: paths present, alwaysApply absent → null (dynamic-only, unchanged)", () => {
	const rule = makeRule({ frontmatter: { paths: ["src/**"] } });
	expect(staticMatchReason(rule)).toBeNull();
});

// ── Patch B: frontmatter 없음 (alwaysApply absent, glob 없음) → "alwaysApply" ─

test("`staticMatchReason`: no frontmatter (empty object) → \"alwaysApply\" (no-frontmatter always-on)", () => {
	// A .claude/rules/*.md file with NO YAML frontmatter parses as empty frontmatter.
	// Claude Code's native behavior: no paths: = always-on. Patch B must match.
	const rule = makeRule({ frontmatter: {} });
	expect(staticMatchReason(rule)).toBe("alwaysApply");
});

test("`staticMatchReason`: description only (no globs, no alwaysApply) → \"alwaysApply\"", () => {
	// description: is purely informational and must not suppress always-on semantics.
	const rule = makeRule({ frontmatter: { description: "my rule" } });
	expect(staticMatchReason(rule)).toBe("alwaysApply");
});

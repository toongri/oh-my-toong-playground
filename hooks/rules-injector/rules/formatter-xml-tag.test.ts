/**
 * Focused tests for the XML-tag marker format introduced to replace the
 * "Instructions from: <path> [hash:<hash>]" line.
 *
 * Format contract:
 *   open tag : <rules name="${basenameNoExt(path)}">
 *   full rule: <rules name="${basenameNoExt(path)}">\n${body}\n</rules>
 *   transcript presence: transcript includes the open tag string
 *
 * lazy: no version/hash granularity — an edited rule is skipped if the
 * open tag already appears in the transcript. Two rules with the same
 * basename in different dirs collide on `name`; per-session path-keyed
 * staticDedup prevents actual double-injection within a session.
 */
import { test, expect } from "bun:test";
import {
	formatStaticBlock,
	formatDynamicBlock,
	ruleMarkerLine,
	transcriptHasRuleMarker,
} from "./formatter.js";
import { filterRulesNotInTranscriptText } from "../transcript-rule-filter.js";
import type { LoadedRule } from "./types.js";

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<LoadedRule> = {}): LoadedRule {
	return {
		path: "/repo/.claude/rules/coding-discipline.md",
		realPath: "/repo/.claude/rules/coding-discipline.md",
		relativePath: ".claude/rules/coding-discipline.md",
		source: ".claude/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		frontmatter: { alwaysApply: true },
		body: "# Coding Discipline\n\nDo not touch anything you must not touch.",
		contentHash: "abc123",
		matchReason: "alwaysApply",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// (a) ruleMarkerLine produces the XML open tag
// ---------------------------------------------------------------------------

test('ruleMarkerLine: 코딩규율 파일 → `<rules name="coding-discipline">`', () => {
	const result = ruleMarkerLine("/repo/.claude/rules/coding-discipline.md");
	expect(result).toBe('<rules name="coding-discipline">');
});

test('ruleMarkerLine: `work-principles.md` → `<rules name="work-principles">`', () => {
	const result = ruleMarkerLine("/Users/toong/.claude/rules/work-principles.md");
	expect(result).toBe('<rules name="work-principles">');
});

test('ruleMarkerLine: double extension `foo.test.md` strips only last extension → `<rules name="foo.test">`', () => {
	const result = ruleMarkerLine("/path/to/foo.test.md");
	expect(result).toBe('<rules name="foo.test">');
});

test('ruleMarkerLine: no extension `CLAUDE` → `<rules name="CLAUDE">`', () => {
	const result = ruleMarkerLine("/path/to/CLAUDE");
	expect(result).toBe('<rules name="CLAUDE">');
});

// ---------------------------------------------------------------------------
// (b) name derivation: basename minus last extension
// ---------------------------------------------------------------------------

test("이름 추출: `coding-discipline.md` → `coding-discipline`", () => {
	expect(ruleMarkerLine("/a/b/coding-discipline.md")).toBe('<rules name="coding-discipline">');
});

test("이름 추출: basename without parent path", () => {
	expect(ruleMarkerLine("just-a-rule.md")).toBe('<rules name="just-a-rule">');
});

// ---------------------------------------------------------------------------
// (c) formatRule / formatStaticBlock: wraps in XML tags
// ---------------------------------------------------------------------------

test('formatStaticBlock: rule body wrapped in `<rules name="...">` ... `</rules>`', () => {
	const rule = makeRule();
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5000, maxResultChars: 5000 });
	const openTag = '<rules name="coding-discipline">';
	expect(text).toContain(openTag);
	expect(text).toContain("</rules>");
	// The open tag must appear before the body, closing tag after.
	const openIdx = text.indexOf(openTag);
	const bodyIdx = text.indexOf("# Coding Discipline");
	const closeIdx = text.indexOf("</rules>");
	expect(openIdx).toBeLessThan(bodyIdx);
	expect(bodyIdx).toBeLessThan(closeIdx);
});

test('formatStaticBlock: XML 구조 — `<rules name="coding-discipline">\\n{body}\\n</rules>`', () => {
	const rule = makeRule({ body: "body text here." });
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5000, maxResultChars: 5000 });
	expect(text).toContain('<rules name="coding-discipline">\nbody text here.\n</rules>');
});

test("formatDynamicBlock: 동적 블록도 XML 태그로 래핑됨", () => {
	const rule = makeRule({ body: "dynamic body." });
	const { text } = formatDynamicBlock([rule], "src/index.ts", {
		maxRuleChars: 5000,
		maxResultChars: 5000,
	});
	expect(text).toContain('<rules name="coding-discipline">\ndynamic body.\n</rules>');
});

test("formatStaticBlock: old 'Instructions from:' format is NOT emitted", () => {
	const rule = makeRule();
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5000, maxResultChars: 5000 });
	expect(text).not.toContain("Instructions from:");
});

test("formatStaticBlock: old '[hash:]' format is NOT emitted", () => {
	const rule = makeRule();
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5000, maxResultChars: 5000 });
	expect(text).not.toContain("[hash:");
});

// ---------------------------------------------------------------------------
// (d) transcriptHasRuleMarker: name-based presence detection
// ---------------------------------------------------------------------------

test("transcriptHasRuleMarker: open tag present → true (skip re-inject)", () => {
	const openTag = '<rules name="coding-discipline">';
	const transcript = `${openTag}\n# Coding Discipline\n\nsome body.\n</rules>`;
	const result = transcriptHasRuleMarker(transcript, ["/repo/.claude/rules/coding-discipline.md"]);
	expect(result).toBe(true);
});

test("transcriptHasRuleMarker: open tag absent → false (inject)", () => {
	const transcript = "Some unrelated content. No rules here.";
	const result = transcriptHasRuleMarker(transcript, ["/repo/.claude/rules/coding-discipline.md"]);
	expect(result).toBe(false);
});

test("transcriptHasRuleMarker: different rule name not confused", () => {
	const transcript = '<rules name="other-rule">\nsome content\n</rules>';
	const result = transcriptHasRuleMarker(transcript, ["/repo/.claude/rules/coding-discipline.md"]);
	expect(result).toBe(false);
});

test("transcriptHasRuleMarker: checks any of the provided paths (path OR realPath)", () => {
	const openTag = '<rules name="coding-discipline">';
	const transcript = `${openTag}\nbody.\n</rules>`;
	// realPath spelling also resolves to "coding-discipline"
	const result = transcriptHasRuleMarker(transcript, [
		"/original/path/coding-discipline.md",
		"/real/path/coding-discipline.md",
	]);
	expect(result).toBe(true);
});

// ---------------------------------------------------------------------------
// (d) producer↔consumer parity: emitted block recognized as present
// ---------------------------------------------------------------------------

test("파리티: formatStaticBlock 출력은 filterRulesNotInTranscriptText로 탐지됨", () => {
	const rule = makeRule();
	const { text } = formatStaticBlock([rule], { maxRuleChars: 5000, maxResultChars: 5000 });
	expect(text).toContain("# Coding Discipline");

	const marked: string[] = [];
	const pending = filterRulesNotInTranscriptText([rule], text, (r) => marked.push(r.path));
	// The emitted block is recognized as present → rule marked, none pending.
	expect(pending).toHaveLength(0);
	expect(marked).toEqual([rule.path]);
});

test("파리티: 같은 바디, 다른 이름 → 탐지 안 됨 (name-based seek)", () => {
	const rule = makeRule();
	// Transcript contains a DIFFERENT rule's open tag with same body
	const otherOpenTag = '<rules name="different-rule">';
	const transcript = `${otherOpenTag}\n${rule.body}\n</rules>`;

	const marked: string[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcript, (r) => marked.push(r.path));
	// Body is present but open tag for "coding-discipline" is missing → still pending.
	expect(pending).toHaveLength(1);
	expect(marked).toHaveLength(0);
});

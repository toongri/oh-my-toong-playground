import { describe, expect, test } from "bun:test";
import { parseYamlFrontmatter } from "./parser-yaml.js";

// C8: apostrophe inside unquoted scalar must NOT toggle quote mode
describe("C8 — apostrophe in unquoted scalar", () => {
	test("stripComment: apostrophe in unquoted glob does not absorb trailing comment", () => {
		const result = parseYamlFrontmatter("globs: src/it's.ts # comment");
		expect(result.globs).toBe("src/it's.ts");
	});

	test("findClosingBracket: inline array with apostrophe-in-unquoted element does not throw", () => {
		const result = parseYamlFrontmatter("globs: [src/it's.ts]");
		expect(result.globs).toBe("src/it's.ts");
	});

	test("splitCommaSeparated: comma-separated list with apostrophe in unquoted element splits correctly", () => {
		const result = parseYamlFrontmatter("globs: [src/it's.ts, src/other.ts]");
		expect(result.globs).toEqual(["src/it's.ts", "src/other.ts"]);
	});
});

// P10: single-quoted scalar with '' escape must decode to single '
describe("P10 — single-quoted scalar '' de-escape", () => {
	test("scalar: single-quoted value with '' decodes to single apostrophe", () => {
		const result = parseYamlFrontmatter("globs: 'src/it''s.ts'");
		expect(result.globs).toBe("src/it's.ts");
	});

	test("inline array: single-quoted element with '' decodes correctly (depends on C8 fix)", () => {
		const result = parseYamlFrontmatter("globs: ['src/it''s.ts']");
		expect(result.globs).toBe("src/it's.ts");
	});
});

// Regression: existing correct behaviours must not break
describe("regression — existing behaviours preserved", () => {
	test("plain glob with no quotes parses normally", () => {
		const result = parseYamlFrontmatter("globs: src/app/**/*.ts");
		expect(result.globs).toBe("src/app/**/*.ts");
	});

	test("trailing comment on plain glob is stripped", () => {
		const result = parseYamlFrontmatter("globs: src/app/**/*.ts  # note");
		expect(result.globs).toBe("src/app/**/*.ts");
	});

	test("hash inside unquoted glob path is preserved (2dc42ffb regression)", () => {
		const result = parseYamlFrontmatter("globs: src/#fixtures/**/*.ts");
		expect(result.globs).toBe("src/#fixtures/**/*.ts");
	});

	test("double-quoted glob parses correctly", () => {
		const result = parseYamlFrontmatter('globs: "src/app/**/*.ts"');
		expect(result.globs).toBe("src/app/**/*.ts");
	});

	test("single-quoted glob without escape parses correctly", () => {
		const result = parseYamlFrontmatter("globs: 'src/app/**'");
		expect(result.globs).toBe("src/app/**");
	});

	test("inline array with quoted element parses correctly", () => {
		const result = parseYamlFrontmatter("globs: ['src/a.ts', 'src/b.ts']");
		expect(result.globs).toEqual(["src/a.ts", "src/b.ts"]);
	});
});

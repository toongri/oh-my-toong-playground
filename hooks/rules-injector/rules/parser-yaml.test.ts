import { describe, expect, test } from "bun:test";
import { parseRule } from "./parser.js";
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

// Bug #3: char-class and brace globs must not be mis-split
describe("Bug #3 — char-class and brace globs in inline arrays and scalars", () => {
	test("findClosingBracket: POSIX char-class in inline array does not stop at inner ]", () => {
		// [file[0-9].ts] — inner ] must not terminate the outer array bracket
		const result = parseYamlFrontmatter("globs: [file[0-9].ts]");
		expect(result.globs).toBe("file[0-9].ts");
	});

	test("findClosingBracket: multiple POSIX char-class elements in inline array", () => {
		const result = parseYamlFrontmatter("globs: [file[0-9].ts, src/[a-z].ts]");
		expect(result.globs).toEqual(["file[0-9].ts", "src/[a-z].ts"]);
	});

	test("splitCommaSeparated: brace expansion in inline array does not mis-split on inner comma", () => {
		// [*.{ts,js}] — comma inside {} must NOT split
		const result = parseYamlFrontmatter("globs: [*.{ts,js}]");
		expect(result.globs).toBe("*.{ts,js}");
	});

	test("parseGlobValue scalar: unquoted brace glob does not split on comma inside braces", () => {
		// globs: *.{ts,js} — unquoted scalar path also comma-splits, must not
		const result = parseYamlFrontmatter("globs: *.{ts,js}");
		expect(result.globs).toBe("*.{ts,js}");
	});

	test("splitCommaSeparated: brace expansion with multiple elements in inline array", () => {
		const result = parseYamlFrontmatter("globs: [*.{ts,js}, src/index.{tsx,jsx}]");
		expect(result.globs).toEqual(["*.{ts,js}", "src/index.{tsx,jsx}"]);
	});
});

// Bug #5: trailing whitespace on --- delimiters must not cause silent frontmatter loss
describe("Bug #5 — trailing whitespace on --- delimiters", () => {
	test("trailing space on opening --- is ignored (frontmatter still parsed)", () => {
		const result = parseRule("---  \nglobs: src/**/*.ts\n---\nbody");
		expect(result.frontmatter.globs).toBe("src/**/*.ts");
	});

	test("trailing tab on opening --- is ignored (frontmatter still parsed)", () => {
		const result = parseRule("---\t\nalwaysApply: true\n---\nbody");
		expect(result.frontmatter.alwaysApply).toBe(true);
	});

	test("trailing space on closing --- is ignored (frontmatter still parsed)", () => {
		const result = parseRule("---\nglobs: src/**/*.ts\n---  \nbody");
		expect(result.frontmatter.globs).toBe("src/**/*.ts");
	});

	test("trailing tab on closing --- is ignored (frontmatter still parsed)", () => {
		const result = parseRule("---\nglobs: src/**/*.ts\n---\t\nbody");
		expect(result.frontmatter.globs).toBe("src/**/*.ts");
	});

	test("CRLF opening delimiter with trailing space is handled", () => {
		const result = parseRule("---  \r\nglobs: src/**/*.ts\n---\nbody");
		expect(result.frontmatter.globs).toBe("src/**/*.ts");
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

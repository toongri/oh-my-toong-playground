import { describe, expect, test } from "bun:test";
import { hashContent, normalizeRuleContentForHash } from "./matcher.js";

describe("normalizeRuleContentForHash", () => {
	test("CRLF and LF contents produce the same hash", () => {
		const lf = "---\nalwaysApply: true\n---\nRule body here.";
		const crlf = lf.replace(/\n/g, "\r\n");

		expect(hashContent(normalizeRuleContentForHash(crlf))).toBe(
			hashContent(normalizeRuleContentForHash(lf)),
		);
	});

	test("trailing whitespace differences produce the same hash", () => {
		const base = "---\nalwaysApply: true\n---\nRule body here.";
		const withTrailing = base + "   \n  ";

		expect(hashContent(normalizeRuleContentForHash(withTrailing))).toBe(
			hashContent(normalizeRuleContentForHash(base)),
		);
	});

	test("a frontmatter-only change produces a different hash", () => {
		const v1 = "---\nalwaysApply: true\n---\nRule body here.";
		const v2 = "---\nalwaysApply: false\n---\nRule body here.";

		expect(hashContent(normalizeRuleContentForHash(v1))).not.toBe(
			hashContent(normalizeRuleContentForHash(v2)),
		);
	});

	test("a body change produces a different hash", () => {
		const v1 = "---\nalwaysApply: true\n---\nOriginal body.";
		const v2 = "---\nalwaysApply: true\n---\nModified body.";

		expect(hashContent(normalizeRuleContentForHash(v1))).not.toBe(
			hashContent(normalizeRuleContentForHash(v2)),
		);
	});

	test("bare CR is normalized the same as LF", () => {
		const lf = "---\nalwaysApply: true\n---\nLine one.\nLine two.";
		const cr = lf.replace(/\n/g, "\r");

		expect(hashContent(normalizeRuleContentForHash(cr))).toBe(
			hashContent(normalizeRuleContentForHash(lf)),
		);
	});
});

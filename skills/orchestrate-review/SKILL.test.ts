import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skillText = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

function excerptBetween(startMarker: string, endMarker: string): string {
	const start = skillText.indexOf(startMarker);
	const end = skillText.indexOf(endMarker, start + startMarker.length);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return skillText.slice(start, end);
}

describe("호출자 비의존 오케스트레이션 문서 계약", () => {
	test("role declaration keeps conductor boundaries without a named caller", () => {
		const roleDeclaration = excerptBetween(
			"## Role Declaration",
			"## Global Static-Review Invariant",
		);

		expect(roleDeclaration).not.toContain("`code-review`");
		expect(roleDeclaration).toMatch(/conductor, not a reviewer/);
		expect(roleDeclaration).toMatch(/do not assign severity/);
		expect(roleDeclaration).toMatch(/un-judged candidate set/);
	});

	test("hard constraint four keeps upstream verdict handoff without a named caller", () => {
		const hardConstraintFour = excerptBetween(
			"4. **MUST NOT assign severity, priority, or P-levels.",
			"5. **MUST NOT compute a verdict or merge recommendation.",
		);

		expect(hardConstraintFour).not.toContain("`code-review`");
		expect(hardConstraintFour).toMatch(
			/MUST NOT assign severity, priority, or P-levels/,
		);
		expect(hardConstraintFour).toMatch(/Finders do not emit them/);
		expect(hardConstraintFour).toMatch(/Verdict assignment happens upstream/);
	});
});

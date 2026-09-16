import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const diagramGuide = readFileSync(join(import.meta.dir, "diagram-guide.md"), "utf8");
const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const reviewPipeline = readFileSync(join(import.meta.dir, "review-pipeline.md"), "utf8");
const metisMd = readFileSync(join(import.meta.dir, "..", "..", "agents", "metis.md"), "utf8");

function extractCoverageTableNote(markdown: string): string {
	const start = markdown.indexOf("Note: this coverage table");
	const end = markdown.indexOf("## 1. Diagram Types", start + 1);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return markdown.slice(start, end);
}

describe("다이어그램 커버리지 표 호출자 중립성 문서 계약", () => {
	test("`coverage-table note` omits caller names while preserving lens composition", () => {
		const note = extractCoverageTableNote(diagramGuide);

		expect(note).not.toContain("prometheus");
		expect(note).not.toContain("deep-interview");
		expect(note).toContain("coverage table");
		expect(note).toMatch(/includes[\s\S]*`classDiagram`/);
		expect(note).toMatch(/excludes[\s\S]*`erDiagram`/);
	});
});

// ---------------------------------------------------------------------------
// non-goal-existence-gate: any bounded plan excludes something, so a plan must
// carry >=1 decider-bearing non-goal, co-confirmed with the user before Metis.
// The gate is deterministic at the Metis B2 axis (Metis runs only for Scoped+,
// so the tier falls out of the architecture) and generated cheaply by the
// risk-domain confirmation pass. Existence only, never precision -- grading
// precision would turn a mechanical gate into an interpretation dispute.
// (must FAIL before the corresponding SKILL.md / review-pipeline.md / metis.md
//  edits -- RED)
// ---------------------------------------------------------------------------

describe("non-goal-existence-gate: AC contract requires a co-confirmed Non-Goals section (Scoped+ >=1, Trivial light)", () => {
	const start = skillMd.indexOf("### Non-Goals (co-confirmed with the user)");
	const end = skillMd.indexOf("### AC Format", start === -1 ? 0 : start);
	const region = start === -1 ? "" : skillMd.slice(start, end === -1 ? undefined : end);

	test('"### Non-Goals (co-confirmed with the user)" heading is present inside the AC contract', () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("Scoped+ requires >=1 decider-bearing non-goal", () => {
		expect(region).toContain("≥1 decider-bearing non-goal is REQUIRED for Scoped+");
	});

	test("the non-goal carries the same decider shape deep-interview / ultragoal use", () => {
		expect(region).toContain("| decider:");
	});

	test("Trivial gets the light one-line boundary, no decider ceremony", () => {
		expect(region).toContain("Trivial");
		expect(region).toContain("one-line boundary");
	});

	test("existence is gated, precision is not (mechanical, not an interpretation dispute)", () => {
		expect(region).toContain("Existence is mandatory");
	});
});

describe("non-goal-existence-gate: risk-domain assessment is user-confirmed and each not-applicable N becomes a non-goal", () => {
	// Anchor on the newline-delimited headings so the backtick REFERENCES to
	// these section names elsewhere in the doc are not matched instead.
	const start = skillMd.indexOf("\n### Risk-Domain Assessment\n");
	const end = skillMd.indexOf("\n### Risk-Domain Pre-Mortem\n", start === -1 ? 0 : start);
	const region = start === -1 ? "" : skillMd.slice(start, end === -1 ? undefined : end);

	test("Risk-Domain Assessment section exists (sanity)", () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("the Y/N assessment is surfaced to the user for confirmation in a single pass", () => {
		expect(region).toContain(
			"surfaces the full Y/N assessment with a one-line basis per category to the user for confirmation",
		);
	});

	test("each user-confirmed N (not-applicable) is recorded as a non-goal-with-decider", () => {
		expect(region).toContain(
			"Each N the user confirms as not-applicable is recorded as a non-goal-with-decider",
		);
	});
});

describe("non-goal-existence-gate: Metis SCOPE template requires >=1 OUT-of-scope item", () => {
	test("the Metis 3-Section SCOPE template states >=1 OUT-of-scope item is required", () => {
		expect(reviewPipeline).toContain("≥1 OUT-of-scope item is REQUIRED");
	});
});

describe("non-goal-existence-gate: Metis B2 rejects an empty OUT-of-scope list (deterministic Scoped+ gate)", () => {
	test("B2 fires on an empty / zero-decider OUT-of-scope list, not only on a missing scope section", () => {
		expect(metisMd).toContain(
			"the OUT-of-scope list is empty or carries zero decider-bearing items",
		);
	});

	test("the Scope analysis-framework row requires >=1 decider-bearing OUT item", () => {
		expect(metisMd).toContain("OUT carries ≥1 decider-bearing item");
	});
});

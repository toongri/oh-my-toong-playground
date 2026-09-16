import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const diagramGuide = readFileSync(join(import.meta.dir, "diagram-guide.md"), "utf8");
const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const reviewPipeline = readFileSync(join(import.meta.dir, "review-pipeline.md"), "utf8");
const planTemplate = readFileSync(join(import.meta.dir, "plan-template.md"), "utf8");
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
// so the tier falls out of the architecture), satisfied by the work's own
// genuine exclusions -- never a manufactured per-domain record. Existence
// only, never precision -- grading precision would turn a mechanical gate
// into an interpretation dispute.
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
		expect(region).toContain("- {excluded item} | decider: {membership test}");
	});

	test("existence is gated, precision is not (mechanical, not an interpretation dispute)", () => {
		expect(region).toContain("Existence is mandatory");
	});
});

describe("risk-domain-consideration: no-safe-default domains are actively considered; deliberate exclusion becomes a non-goal, never-in-play stays absent", () => {
	// Anchor on the newline-delimited headings so the backtick REFERENCES to
	// these section names elsewhere in the doc are not matched instead.
	const start = skillMd.indexOf("\n### Risk-Domain Assessment\n");
	const end = skillMd.indexOf("\n### Risk-Domain Pre-Mortem\n", start === -1 ? 0 : start);
	const region = start === -1 ? "" : skillMd.slice(start, end === -1 ? undefined : end);

	test("Risk-Domain Assessment section exists (sanity)", () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("the planner judges which domains are in play (not a per-plan checklist)", () => {
		expect(region).toContain("Judge which no-safe-default domains");
		expect(region).toContain("active judgment, not a per-plan checklist");
	});

	test("a never-in-play domain stays absent (absence is not an entry)", () => {
		expect(region).toContain("Absence is not an entry.");
	});

	test("only a deliberately-excluded domain is recorded as a non-goal-with-decider", () => {
		expect(region).toContain("record each deliberately-excluded one as a non-goal-with-decider");
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

describe("canonical non-goal handoff contract", () => {
	test("the canonical non-goal handoff applies to Trivial plans too", () => {
		const planStructure = skillMd.slice(skillMd.indexOf("## Plan Structure (Mandatory Contract)"));

		expect(planStructure).toContain("The Non-Goals handoff remains mandatory for every intent");
		expect(planStructure).toContain("Trivial is not exempt from the canonical Non-Goals handoff");
	});

	test("S1 persists before any downstream artifact and S3 copies every intent's stored value", () => {
		expect(skillMd).toContain(
			"S1 persists that exact value as `state.non_goals` before creating any downstream artifact",
		);
		expect(skillMd).toContain(
			"S3 plan generation copies the same stored lines verbatim for every intent",
		);
	});

	test("P1 persists non-goals before Metis and uses state.non_goals through S3", () => {
		expect(skillMd).toContain(
			"After the user confirms the AC and non-goals, S1 persists that exact value as `state.non_goals` before creating any downstream artifact",
		);
		expect(reviewPipeline).toContain("verbatim canonical lines from `Prometheus state.non_goals`");
		expect(reviewPipeline).toContain("S3 plan generation later copies the same stored value");
	});

	test("S1 stores canonical non-goals in a separate state invocation from AC stdin", () => {
		expect(skillMd).toContain(
			'prometheus-state.ts" set --phase S1 --record-non-goals -',
		);
		expect(skillMd).toMatch(/separate invocation[\s\S]*record-non-goals/);
	});

	test("the plan template requires verbatim stored non-goal lines under Work Objectives", () => {
		expect(planTemplate).toMatch(
		/## Work Objectives[\s\S]*### Non-Goals[\s\S]*- \{excluded item\} \| decider: \{membership test\}/,
		);
		const planStructure = skillMd.slice(skillMd.indexOf("## Plan Structure (Mandatory Contract)"));
		expect(planStructure).toMatch(/### Non-Goals[\s\S]*verbatim from the stored Prometheus state/);
	});

	test("Metis receives canonical state lines and S8 forwards stored value to Ultragoal", () => {
		expect(reviewPipeline).toMatch(
			/OUT of Scope[\s\S]*verbatim canonical lines from `Prometheus state\.non_goals`[\s\S]*transient brief/,
		);
		expect(skillMd).toMatch(
			/S8[\s\S]*stored canonical[\s\S]*--non-goals[\s\S]*presence-based alternate path/,
		);
	});

	test("the operative Option 1 handler forwards state.non_goals through Ultragoal's existing slot", () => {
		expect(skillMd).toContain(
			'On selection: Option 1 → `Skill(skill: "ultragoal")` with the plan path and the stored `state.non_goals` value in Ultragoal\'s existing `--non-goals` slot.',
		);
	});

	test("the Risk-Domain Assessment example starts with the canonical list prefix", () => {
		expect(skillMd).toContain(
			"- 동시성 처리 안 함 | decider: 락/레이스/트랜잭션 finding은 out — 실행모델이 순차적",
		);
	});

	test("Ultragoal planning names Prometheus as the upstream producer of the existing slot and validator", () => {
		expect(readFileSync(join(import.meta.dir, "..", "ultragoal", "references", "planning.md"), "utf8")).toMatch(
			/Prometheus[\s\S]*upstream producer[\s\S]*stored canonical value[\s\S]*existing `--non-goals` slot[\s\S]*validator/,
		);
	});
});

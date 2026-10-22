import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const reviewPipeline = readFileSync(join(import.meta.dir, "review-pipeline.md"), "utf8");
const planTemplate = readFileSync(join(import.meta.dir, "plan-template.md"), "utf8");
const metisMd = readFileSync(join(import.meta.dir, "..", "..", "agents", "metis.md"), "utf8");
const explainDiff = readFileSync(join(import.meta.dir, "../explain-diff/SKILL.md"), "utf8");

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
	test("P1 persists non-goals before Metis and uses state.non_goals through S3", () => {
		expect(reviewPipeline).toContain("verbatim canonical lines from `Prometheus state.non_goals`");
		expect(reviewPipeline).toContain("S3 plan generation later copies the same stored value");
	});

	test("the plan template requires verbatim stored non-goal lines under Work Objectives", () => {
		expect(planTemplate).toMatch(
		/## Work Objectives[\s\S]*### Non-Goals[\s\S]*- \{excluded item\} \| decider: \{membership test\}/,
		);
	});

	test("Metis receives canonical state lines and S8 forwards stored value to Ultragoal", () => {
		expect(reviewPipeline).toMatch(
			/OUT of Scope[\s\S]*verbatim canonical lines from `Prometheus state\.non_goals`[\s\S]*transient brief/,
		);
	});

	test("Ultragoal planning names Prometheus as the upstream producer of the existing slot and validator", () => {
		expect(readFileSync(join(import.meta.dir, "..", "ultragoal", "references", "planning.md"), "utf8")).toMatch(
			/Prometheus[\s\S]*upstream producer[\s\S]*stored canonical value[\s\S]*existing `--non-goals` slot[\s\S]*validator/,
		);
	});
});

// 쓰기 전에 소개 — 무맥락 독자가 생소한 1급 엔티티를 첫 등장에서 이해하도록, presentation
// 저작 계약(review-pipeline.md)이 kind→depth 리시피를, 다이어그램 self-audit(review-pipeline.md 의 Post-Draw Self-Audit)이
// 요소 각주(gloss) 점검을 규정하는지 by-eye 대신 그린 테스트로 고정한다.
describe("쓰기 전에 소개 문서 계약", () => {
	test("review-pipeline.md carries the introduce-before-you-use recipe with a kind→depth table", () => {
		expect(reviewPipeline).toContain("쓰기 전에 소개");
	});

	test("review-pipeline.md Post-Draw self-audit checks each code-name element is introduced", () => {
		const audit = reviewPipeline.slice(reviewPipeline.indexOf("#### Post-Draw Self-Audit"));
		expect(audit).toContain("쓰기 전에 소개");
	});
});

describe("발표 리뷰어 source-bundle 및 결과 라우팅 계약", () => {
	test("Prometheus와 explain-diff callers bound sources and route every reviewer result", () => {
		for (const caller of [reviewPipeline, explainDiff]) {
			expect(caller).toContain("APPROVE/COMMENT");
			expect(caller).toContain("REQUEST_CHANGES");
			expect(caller).toContain("INCONCLUSIVE");
			expect(caller).toContain("missing/malformed verdict");
			expect(caller).toContain("repairs and re-reviews");
		}
		expect(reviewPipeline).toContain("Stage B recommendation and Pipeline State session-state artifacts");
		expect(explainDiff).toContain("bounded unchanged code context");
		expect(explainDiff).toContain("repository-relative path and base/head revision");
		expect(explainDiff).toMatch(
			/actual diff[\s\S]*Step 1[\s\S]*### 원천[\s\S]*(?:plan|issue|ticket|docs)[\s\S]*bounded unchanged code context/,
		);
	});
});

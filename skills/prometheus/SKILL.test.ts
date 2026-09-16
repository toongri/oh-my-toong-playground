import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const diagramGuide = readFileSync(join(import.meta.dir, "diagram-guide.md"), "utf8");
const reviewPipeline = readFileSync(join(import.meta.dir, "review-pipeline.md"), "utf8");
const explainDiff = readFileSync(join(import.meta.dir, "../explain-diff/SKILL.md"), "utf8");

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

// 쓰기 전에 소개 — 무맥락 독자가 생소한 1급 엔티티를 첫 등장에서 이해하도록, presentation
// 저작 계약(review-pipeline.md)이 kind→depth 리시피를, 다이어그램 self-audit(diagram-guide.md)이
// 요소 각주(gloss) 점검을 규정하는지 by-eye 대신 그린 테스트로 고정한다.
describe("쓰기 전에 소개 문서 계약", () => {
	test("review-pipeline.md carries the introduce-before-you-use recipe with a kind→depth table", () => {
		expect(reviewPipeline).toContain("쓰기 전에 소개");
		for (const kind of ["용어", "함수", "모듈", "도메인", "기능"]) {
			expect(reviewPipeline).toContain(kind);
		}
		expect(reviewPipeline).toContain('<ul class="gloss">');
	});

	test("diagram-guide.md Post-Draw self-audit checks each code-name element is introduced", () => {
		expect(diagramGuide).toContain("쓰기 전에 소개");
		expect(diagramGuide).toContain('<ul class="gloss">');
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

import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Stage A 발표 계약: 모델이 html-report 가이드를 따라 plans/presentation/{name}.html 을
// 직접 저작한다. 중간 Markdown 과 렌더 스크립트 경로는 제거되었고, 이 파일은 지침이
// html-report 와 제출 명령을 가리키는지, 제거된 경로가 다시 살아나지 않았는지,
// 6-lens 커버리지 표·edge ledger 계약이 review-pipeline.md 안에 남아 있는지를 고정한다.
// 파일 경로를 고정해서 읽는다(디렉터리 스캔 없음).
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, "..", "SKILL.md");
const skillContent = readFileSync(skillPath, "utf8");

const reviewPipelinePath = join(import.meta.dir, "..", "review-pipeline.md");
const reviewPipelineContent = readFileSync(reviewPipelinePath, "utf8");

const templatePath = join(import.meta.dir, "..", "templates", "plan-presentation.html");
const removedPaths = [
	join(import.meta.dir, "..", "diagram-guide.md"),
	join(import.meta.dir, "render.ts"),
	join(import.meta.dir, "render.test.ts"),
];
const htmlReportDir = join(import.meta.dir, "..", "..", "html-report");

function sectionOrderSlice(): string {
	const sectionStart = reviewPipelineContent.indexOf("### Presentation Section Order");
	expect(sectionStart).not.toBe(-1);
	const nextH3 = reviewPipelineContent.indexOf("\n### ", sectionStart + 1);
	const nextH2 = reviewPipelineContent.indexOf("\n## ", sectionStart + 1);
	const candidates = [nextH3, nextH2].filter((index) => index !== -1);
	const sectionEnd = candidates.length > 0 ? Math.min(...candidates) : reviewPipelineContent.length;
	return reviewPipelineContent.slice(sectionStart, sectionEnd);
}

describe("발표 계약 — 제거된 경로와 HTML 제출", () => {
	it("A1: 옛 HTML 템플릿 파일이 없다", () => {
		expect(existsSync(templatePath)).toBe(false);
	});

	it("A2: HTML 제출은 필수이며 제거한 템플릿은 참조하지 않는다", () => {
		expect(skillContent).toContain("[review-pipeline.md](review-pipeline.md)");
		expect(skillContent).not.toContain("templates/plan-presentation.html");
	});

	it("A3: review-pipeline.md 가 html-report 가이드와 capture/lint 루프를 가리킨다", () => {
		expect(reviewPipelineContent).toContain("${CLAUDE_SKILL_DIR}/../html-report/SKILL.md");
		expect(reviewPipelineContent).toContain("${CLAUDE_SKILL_DIR}/../html-report/scripts/capture.sh");
		expect(reviewPipelineContent).toContain("${CLAUDE_SKILL_DIR}/../html-report/scripts/lint.sh");
		expect(reviewPipelineContent).toContain("--source $OMT_DIR/plans/{name}.md");
	});

	it("A3b: 가리키는 html-report 가이드와 두 스크립트가 실제로 존재한다", () => {
		expect(existsSync(join(htmlReportDir, "SKILL.md"))).toBe(true);
		expect(existsSync(join(htmlReportDir, "scripts", "capture.sh"))).toBe(true);
		expect(existsSync(join(htmlReportDir, "scripts", "lint.sh"))).toBe(true);
	});

	it("A4: 제거된 파일이 없고 두 문서가 제거된 경로를 다시 참조하지 않는다", () => {
		for (const path of removedPaths) {
			expect(existsSync(path)).toBe(false);
		}
		for (const doc of [skillContent, reviewPipelineContent]) {
			expect(doc).not.toContain("render.ts");
			expect(doc).not.toContain("diagram-guide");
			expect(doc.toLowerCase()).not.toContain("mermaid");
		}
		// SKILL.md 는 AC 제약 설명에 일반 형용사 "self-contained" 를 쓰므로 발표 지침 문서만 본다.
		expect(reviewPipelineContent).not.toContain("self-contained");
	});

	it("A5: review-pipeline.md no longer carries Rule 6 — Parser-resilient", () => {
		expect(reviewPipelineContent).not.toContain("Rule 6 — Parser-resilient");
	});

	it("A6: review-pipeline.md no longer carries Rule 7 — Active-placeholder", () => {
		expect(reviewPipelineContent).not.toContain("Rule 7 — Active-placeholder");
	});

	it("A7: review-pipeline.md no longer carries the Template Reference section", () => {
		expect(reviewPipelineContent).not.toContain("### Template Reference");
	});

	it("A8: SKILL.md no longer names HTML Render", () => {
		expect(skillContent).not.toContain("HTML Render");
	});
});

describe("존재 계약 — 섹션 순서, 커버리지 표, edge ledger", () => {
	it("P2: 섹션 순서 구간에 6개 구성요소가 정해진 순서로 나온다", () => {
		const section = sectionOrderSlice();
		const labels = [
			"H1 + meta table",
			"Execution Recommendation",
			"Pipeline State",
			"Bird's-Eye View",
			"Review Digest",
			"plan body",
		];
		const indices = labels.map((label) => section.indexOf(label));
		indices.forEach((index, i) => {
			expect(index).not.toBe(-1);
			if (i > 0) {
				expect(index).toBeGreaterThan(indices[i - 1]);
			}
		});
	});

	it("P2b: 섹션 순서 구간이 접힌 TODO 상세 컨테이너를 명시한다", () => {
		expect(sectionOrderSlice()).toContain("<details>");
	});

	it("P4: 커버리지 표의 정식 헤더가 review-pipeline.md 에 있다", () => {
		expect(reviewPipelineContent).toContain("| Lens | Trigger FACT | Status |");
	});

	it("P6: drawn 의 계수 단위는 <svg> 를 담은 <figure> 이다", () => {
		expect(reviewPipelineContent).toContain("the number of such figures in the presentation HTML");
		expect(reviewPipelineContent).toContain("`<figure>` element that contains an `<svg>`");
	});

	it("P9: ledger 줄에 결정 원문을 인용하는 슬롯이 있다", () => {
		expect(reviewPipelineContent).toContain(
			'<source> -> <target> : "<quoted plan.md text that decides this edge>"',
		);
	});

	it("P11: 인용할 수 없는 edge 는 조용한 삭제가 아니라 STOP 으로 간다", () => {
		expect(reviewPipelineContent).toContain("An edge with no quote is a plan gap");
	});

	it("P12: 토큰 조회로 통과되던 체크박스가 없다", () => {
		expect(reviewPipelineContent).not.toContain(
			"No signature, field, edge, or relationship in the diagram is absent",
		);
	});
});

// ---------------------------------------------------------------------------
// SURVIVAL assertions — over-deletion regression guard. The rewrite must not
// collaterally delete the Stage B / Stage C lookup headings.
// ---------------------------------------------------------------------------

describe("survival — Stage B / Stage C headings must remain", () => {
	it("S1: ## Stage B: Decision Matrix heading survives", () => {
		expect(reviewPipelineContent).toContain("## Stage B: Re-keyed Signal Table");
	});

	it("S2: ## Stage C: Execution Bridge heading survives", () => {
		expect(reviewPipelineContent).toContain("## Stage C: Execution Bridge");
	});
});

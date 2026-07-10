import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Render contract tokens: verbatim literals that MUST be present/absent after
// the remove-html-render-add-uml-markdown rewrite (plan TODO 2, RED-only —
// TODO 7/8/9 make this GREEN). Mirrors the adr-log-contract.test.ts /
// verify-lane-contract.test.ts both-halves pattern: HTML render machinery is
// asserted absent, the markdown + 6-lens coverage-table contract is asserted
// present, and the untouched Stage B / Stage C headings are asserted to
// survive the rewrite. All reads are file-pinned (no directory scan) — this
// file's own literals would otherwise self-match a directory scan of "html".
// Each expect() is a discrete per-token assertion.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, "..", "SKILL.md");
const skillContent = readFileSync(skillPath, "utf8");

const reviewPipelinePath = join(import.meta.dir, "..", "review-pipeline.md");
const reviewPipelineContent = readFileSync(reviewPipelinePath, "utf8");

const diagramGuidePath = join(import.meta.dir, "..", "diagram-guide.md");
const diagramGuideContent = readFileSync(diagramGuidePath, "utf8");

const templatePath = join(import.meta.dir, "..", "templates", "plan-presentation.html");

// ---------------------------------------------------------------------------
// ABSENCE assertions — HTML render machinery that MUST be gone after the
// rewrite.
// ---------------------------------------------------------------------------

describe("absence — HTML render machinery removed", () => {
	it("A1: templates/plan-presentation.html no longer exists", () => {
		expect(existsSync(templatePath)).toBe(false);
	});

	it("A2: SKILL.md carries no html literal (case-insensitive)", () => {
		expect(skillContent.toLowerCase()).not.toContain("html");
	});

	it("A3: review-pipeline.md carries no html literal (case-insensitive)", () => {
		expect(reviewPipelineContent.toLowerCase()).not.toContain("html");
	});

	it("A4: diagram-guide.md carries no html literal (case-insensitive)", () => {
		expect(diagramGuideContent.toLowerCase()).not.toContain("html");
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

// ---------------------------------------------------------------------------
// PRESENCE assertions — the markdown render + 6-lens coverage-table contract
// that MUST appear after the rewrite.
// ---------------------------------------------------------------------------

describe("presence — markdown render contract", () => {
	it("P1: review-pipeline.md prescribes Presentation Section Order", () => {
		expect(reviewPipelineContent).toContain("Presentation Section Order");
	});

	it("P2: the 6 components are named in canonical order inside the Presentation Section Order slice (H1 + meta table -> Execution Recommendation -> Pipeline State -> Bird's-Eye View -> Review Digest -> plan body)", () => {
		// Scope the search to the Presentation Section Order section itself —
		// several of these labels (Pipeline State, Bird's-Eye View, hero
		// header) also appear elsewhere in the file, so an unscoped indexOf
		// over the whole document could pass or fail on the wrong occurrence.
		const sectionStart = reviewPipelineContent.indexOf("### Presentation Section Order");
		expect(sectionStart).not.toBe(-1);

		const nextH3 = reviewPipelineContent.indexOf("\n### ", sectionStart + 1);
		const nextH2 = reviewPipelineContent.indexOf("\n## ", sectionStart + 1);
		const nextHeadingCandidates = [nextH3, nextH2].filter((index) => index !== -1);
		const sectionEnd =
			nextHeadingCandidates.length > 0
				? Math.min(...nextHeadingCandidates)
				: reviewPipelineContent.length;
		const section = reviewPipelineContent.slice(sectionStart, sectionEnd);

		const labels = [
			"H1 + meta table",
			"Execution Recommendation",
			"Pipeline State",
			"Bird's-Eye View",
			"Review Digest",
			"plan body",
		];
		const indices = labels.map((label) => section.indexOf(label));

		// Each label must actually be present — a missing label's indexOf(-1)
		// could otherwise let the strictly-increasing check below pass by
		// accident (a hole in the sequence is not the same as an ordered one).
		indices.forEach((index, i) => {
			expect(index).not.toBe(-1);
			if (i > 0) {
				expect(index).toBeGreaterThan(indices[i - 1]);
			}
		});
	});

	it("P2b: the section-order slice names the collapsed TODO detail container", () => {
		const sectionStart = reviewPipelineContent.indexOf("### Presentation Section Order");
		expect(sectionStart).not.toBe(-1);

		const nextH3 = reviewPipelineContent.indexOf("\n### ", sectionStart + 1);
		const nextH2 = reviewPipelineContent.indexOf("\n## ", sectionStart + 1);
		const nextHeadingCandidates = [nextH3, nextH2].filter((index) => index !== -1);
		const sectionEnd =
			nextHeadingCandidates.length > 0
				? Math.min(...nextHeadingCandidates)
				: reviewPipelineContent.length;
		const section = reviewPipelineContent.slice(sectionStart, sectionEnd);

		expect(section).toContain("<details>");
	});

	it("P3: Invariant 3 is authority-based (derived, non-authoritative)", () => {
		expect(reviewPipelineContent).toContain("derived, non-authoritative");
	});

	it("P4: diagram-guide.md carries the canonical coverage-table header", () => {
		expect(diagramGuideContent).toContain("| Lens | Trigger FACT | Status |");
	});

	it("P5: diagram-guide.md carries the drawn state literal", () => {
		expect(diagramGuideContent).toContain("drawn");
	});

	it("P6: diagram-guide.md carries the trigger FALSE: state literal", () => {
		expect(diagramGuideContent).toContain("trigger FALSE:");
	});

	it("P7: diagram-guide.md mentions the coverage-table rule", () => {
		expect(diagramGuideContent.toLowerCase()).toContain("coverage table");
	});
});

// ---------------------------------------------------------------------------
// SURVIVAL assertions — over-deletion regression guard. The rewrite must not
// collaterally delete the Stage B / Stage C lookup headings.
// ---------------------------------------------------------------------------

describe("survival — Stage B / Stage C headings must remain", () => {
	it("S1: ## Stage B: Decision Matrix heading survives", () => {
		expect(reviewPipelineContent).toContain("## Stage B: Decision Matrix");
	});

	it("S2: ## Stage C: Execution Bridge heading survives", () => {
		expect(reviewPipelineContent).toContain("## Stage C: Execution Bridge");
	});
});

import { describe, expect, it } from "bun:test";
import { deliverableRefusalBody } from "./deliverable-refusal.ts";

describe("deliverableRefusalBody", () => {
	const base = {
		deliverable: "Stage A presentation",
		problem: "the Stage A presentation is absent at plan.presentation.html",
		guideline: "review-pipeline.md (Stage A)",
		produce: "render the plan to plan.presentation.html",
		submit: "prometheus-state.ts set --phase S5 --submit-presentation <html>",
	};

	it("`names the missing deliverable and the specific problem`", () => {
		const body = deliverableRefusalBody(base);
		expect(body).toContain("Stage A presentation");
		expect(body).toContain("absent at plan.presentation.html");
	});

	it("`carries all three contract parts in order: study guideline -> produce -> submit`", () => {
		const body = deliverableRefusalBody(base);
		const studyIdx = body.indexOf("review-pipeline.md (Stage A)");
		const produceIdx = body.indexOf("render the plan to plan.presentation.html");
		const submitIdx = body.indexOf("prometheus-state.ts set --phase S5");
		expect(studyIdx).toBeGreaterThanOrEqual(0);
		expect(produceIdx).toBeGreaterThan(studyIdx);
		expect(submitIdx).toBeGreaterThan(produceIdx);
	});

	it("`the guideline part is a mandatory READ instruction, not an optional pointer`", () => {
		const body = deliverableRefusalBody(base);
		// English default must tell the agent to read/study the guideline doc.
		expect(body).toMatch(/\b(read|study)\b/i);
		expect(body).toContain("review-pipeline.md (Stage A)");
	});

	it("`renders Korean scaffolding when lang is ko (explain-diff family)`", () => {
		const body = deliverableRefusalBody({
			...base,
			deliverable: "필수 개념 퀴즈 통과",
			problem: "아직 통과하지 못한 필수 개념: retry-guard",
			guideline: "explain-diff SKILL.md (quiz 스텝)",
			produce: "남은 개념의 문항을 진행해 독자를 통과시켜라",
			submit: "explain-diff-state.ts grade",
			lang: "ko",
		});
		expect(body).toContain("지침");
		expect(body).toMatch(/(읽|숙지)/);
		expect(body).toContain("explain-diff SKILL.md (quiz 스텝)");
		expect(body).toContain("explain-diff-state.ts grade");
		// No English scaffolding leaks into a Korean message.
		expect(body).not.toMatch(/\bStudy the guideline\b/);
	});
});

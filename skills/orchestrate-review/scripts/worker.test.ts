#!/usr/bin/env bun

import { describe, it, expect } from "bun:test";
import fs from "fs";
import path from "path";
import { filterPromptSections } from "./worker.ts";

const TEMPLATE_PATH = path.join(import.meta.dirname, "chunk-reviewer-prompt.md");

/**
 * Build a realistic prompt.txt-equivalent fixture from the actual template file, with each
 * placeholder swapped for a unique sentinel string. Reading the real template (rather than a
 * hand-copied shadow fixture) means a template edit that moves/removes a marker breaks this
 * test too, instead of staying green against a stale copy.
 *
 * Sliced to the body above "## Field Reference", matching template-consistency.test.ts's own
 * finding that the Field Reference table is documentation about the body, not body content
 * itself — it never reaches the finder, so it is not part of what prompt.txt actually carries.
 */
function buildFixturePrompt(): string {
	const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
	const body = raw.split(/\n##\s+Field Reference/)[0];
	return body
		.replaceAll("{REQUIREMENTS}", "REQUIREMENTS_SENTINEL")
		.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
		.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
		.replaceAll("{EVIDENCE_RESULTS}", "EVIDENCE_RESULTS_SENTINEL")
		.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
		.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
		.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
		.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
		.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");
}

const ALL_MEMBERS = ["correctness", "regression", "cleanup", "requirement"];
const ALL_CONDITIONAL_SENTINELS = [
	"REQUIREMENTS_SENTINEL",
	"PROJECT_CONTEXT_SENTINEL",
	"NON_GOAL_SENTINEL",
	"EVIDENCE_RESULTS_SENTINEL",
	"COMMIT_HISTORY_SENTINEL",
];

describe("filterPromptSections", () => {
	const fixture = buildFixturePrompt();

	it("`correctness` 앵글은 조건부 섹션 5개를 모두 제거하고 공통 섹션은 남긴다", () => {
		const filtered = filterPromptSections(fixture, "correctness");
		for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
			expect(filtered).not.toContain(sentinel);
		}
		expect(filtered).toContain("FILE_LIST_SENTINEL");
		expect(filtered).toContain("DIFF_COMMAND_SENTINEL");
	});

	it("`regression` 앵글은 Commit History만 통과시키고 나머지 4개는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "regression");
		expect(filtered).toContain("COMMIT_HISTORY_SENTINEL");
		expect(filtered).not.toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("NON_GOAL_SENTINEL");
		expect(filtered).not.toContain("EVIDENCE_RESULTS_SENTINEL");
	});

	it("`cleanup` 앵글은 Non-Goals만 통과시키고 나머지 4개는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "cleanup");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
		expect(filtered).not.toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("EVIDENCE_RESULTS_SENTINEL");
		expect(filtered).not.toContain("COMMIT_HISTORY_SENTINEL");
	});

	it("`requirement` 앵글은 Project Context를 제외한 조건부 섹션 4개를 모두 통과시킨다", () => {
		const filtered = filterPromptSections(fixture, "requirement");
		expect(filtered).toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
		expect(filtered).toContain("EVIDENCE_RESULTS_SENTINEL");
		expect(filtered).toContain("COMMIT_HISTORY_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
	});

	it("Project Context 섹션은 4개 앵글 전부에서 제거된다", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		}
	});

	it("필터링 후 최종 출력에 섹션 경계 마커가 하나도 남지 않는다", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("<!-- section:");
			expect(filtered).not.toContain("<!-- /section:");
		}
	});

	it("허용목록에 없는 미지의 멤버 이름은 모든 조건부 섹션을 통과시키되 마커는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "unknown-angle");
		for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
			expect(filtered).toContain(sentinel);
		}
		expect(filtered).not.toContain("<!-- section:");
		expect(filtered).not.toContain("<!-- /section:");
	});
});

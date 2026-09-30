import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prose contract for craft-tasks. The skill is a prompt contract, so the
// regression surface is the words and ordering that keep the input
// source-neutral and prevent duplicate or mis-shaped PM writes.
// ---------------------------------------------------------------------------

const craftTasks = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

function sectionBetween(content: string, startHeading: string, endHeading: string): string {
	const start = content.indexOf(startHeading);
	if (start === -1) throw new Error(`sectionBetween: missing start heading "${startHeading}"`);
	const end = content.indexOf(endHeading, start + startHeading.length);
	if (end === -1) throw new Error(`sectionBetween: missing end heading "${endHeading}"`);
	return content.slice(start, end);
}

test("sectionBetween requires both headings", () => {
	expect(() => sectionBetween("## Start", "## Missing", "## End")).toThrow("missing start heading");
	expect(() => sectionBetween("## Start", "## Start", "## Missing")).toThrow("missing end heading");
});

describe("입력은 출처와 무관하다", () => {
	const input = () => sectionBetween(craftTasks, "## Input", "## When NOT to use");

	test("분해 대상은 설계가 확정된 이슈다", () => {
		expect(input()).toContain("The issue to decompose");
		expect(input()).toContain("Its child tickets are the tasks");
	});

	test("설계는 어떤 출처든 받고 상위 식별자를 요구하지 않는다", () => {
		expect(input()).toContain("from any source");
		expect(input()).toContain("No particular upstream skill, artifact, or identifier is required");
	});

	test("상위 스킬의 식별 장치에 의존하지 않는다", () => {
		for (const removed of ["designAnchor", "design-anchor", "interview_id", "taskKey", "taskIdentities", "task-write-journal"])
			expect(craftTasks).not.toContain(removed);
		expect(craftTasks).not.toContain("../craft-issue/");
		expect(craftTasks).not.toContain('Skill(skill: "craft-issue")');
		expect(existsSync(join(import.meta.dir, "scripts", "task-write-journal.ts"))).toBe(false);
	});
});

describe("설계 확인 게이트", () => {
	const gate = () => sectionBetween(craftTasks, "## Design Confirmation Gate", "## The Inversion");

	test("네 항목을 추출해 사용자 확인 뒤에만 진행한다", () => {
		for (const item of ["**Intent**", "**Approach**", "**Invariants**", "**Boundary**"])
			expect(gate()).toContain(item);
		expect(gate()).toContain("proceed only after the user confirms");
	});

	test("빈 항목은 멈추고 다른 스킬은 제안으로만 안내한다", () => {
		expect(gate()).toContain("stop before decomposing");
		expect(gate()).toContain("suggestions, not prerequisites");
		expect(gate()).toContain("Never invent the missing design");
	});
});

describe("쓰기 흐름: 읽고, 계획하고, 확인받고, 쓴다", () => {
	const flow = () => sectionBetween(craftTasks, "## Write Flow", "### Task maintenance");

	test("단계 순서는 읽기 → 계획 → 확인 → 재확인이다", () => {
		const text = flow();
		const order = [
			"### 1. Read the issue's current children",
			"### 2. Build the task plan against what exists",
			"### 3. Confirm, then write",
			"### 4. Verify by re-reading",
		].map((heading) => text.indexOf(heading));
		for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	test("계획은 기존 자식과 대조한 네 가지 행으로 나뉜다", () => {
		for (const row of ["**Update**", "**Create**", "**Unchanged**", "**Outside the design**"])
			expect(flow()).toContain(row);
		expect(flow()).toContain("Never close or delete it");
		expect(flow()).toContain("A match is a proposal, not a fact");
	});

	test("중단된 실행은 다시 읽어 빠진 쓰기만 한다", () => {
		expect(flow()).toContain("start again at step 1");
		expect(flow()).toContain("only the missing writes");
		expect(flow()).toContain("Do not create a second ticket for a task that already has one");
	});

	test("선행 작업부터 만들어 blockedBy ID가 존재하게 한다", () => {
		expect(flow()).toContain("Write in dependency order");
		expect(flow()).toContain("`blockedBy`");
	});

	test("쓰기 바인딩과 휴머나이저 패스를 스스로 가진다", () => {
		expect(flow()).toContain("Skill(humanizer)");
		expect(flow()).toContain("`save_issue`");
		expect(flow()).toContain("`create_comment`");
		expect(flow()).toContain("`parentId` = the decomposed issue");
	});
});

describe("본문 형태", () => {
	test("본문은 세 절만 가지고 관계는 네이티브 필드에 둔다", () => {
		for (const section of ["**목적**", "**변경 대상**", "**완료 조건 (DoD)**"])
			expect(craftTasks).toContain(section);
		expect(craftTasks).toContain("native relation field, never body prose");
		expect(craftTasks).toContain("native parent relation");
	});

	test("완료 조건 기준을 자체적으로 정의한다", () => {
		expect(craftTasks).toContain("one observable result per item");
		expect(craftTasks).toContain("One item = one state change");
	});
});

describe("작업 최신화", () => {
	test("기존 작업은 본문을 최신화하고 다른 사람의 기록을 보존한다", () => {
		expect(craftTasks).toContain("Update in place per Task maintenance");
		expect(craftTasks).toContain("Preserve contributor notes, progress, and decisions");
	});
	test("의미 있는 변경은 세 항목의 경위 코멘트를 남긴다", () => {
		for (const text of ["계기", "판단과 근거", "변경과 영향", "meaningful change"])
			expect(craftTasks).toContain(text);
		expect(craftTasks).toContain("Typo or wording only");
		expect(craftTasks).toContain("No effective change");
	});
	test("미결정 사항은 사용자에게 묻고 확정된 작업으로 기록하지 않는다", () => {
		expect(craftTasks).toContain("Unresolved decision");
		expect(craftTasks).toContain("Ask the user to settle it");
	});
});

describe("Red Flags", () => {
	test("상위 기록을 요구하며 멈추는 행동을 경고한다", () => {
		expect(craftTasks).toContain("### STOP — you are demanding an upstream artifact");
		expect(craftTasks).toContain("no interview ID, spec file, or other upstream record");
	});
	test("기존 자식을 읽지 않고 만드는 행동을 경고한다", () => {
		expect(craftTasks).toContain("without reading the issue's existing children");
	});
});

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Design-handoff prose contract for craft-tasks and its deep-interview source.
// These are intentionally focused presence/order assertions: the skills are
// prompt contracts, so the regression surface is the words and sequencing
// that prevent an unsafe PM write.
// ---------------------------------------------------------------------------

const craftTasks = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const deepInterview = readFileSync(
	join(import.meta.dir, "..", "deep-interview", "SKILL.md"),
	"utf8",
);
const specTemplate = readFileSync(
	join(import.meta.dir, "..", "deep-interview", "deep-interview-spec-template.md"),
	"utf8",
);

const DESIGN_ANCHOR = "design-anchor: deep-interview:<state.interview_id>";

function lineOf(content: string, literal: string): number {
	return content.split("\n").findIndex((line) => line.includes(literal));
}

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

describe("design anchor: one immutable shared value", () => {
	test("the spec template declares the exact canonical metadata value", () => {
		expect(specTemplate).toContain(`- Design anchor: ${DESIGN_ANCHOR}`);
	});

	test("the template binds the anchor to persisted state and makes resume stability explicit", () => {
		const metadata = sectionBetween(specTemplate, "## Metadata", "## Clarity Breakdown");
		expect(metadata).toContain("persisted state.interview_id");
		expect(metadata).toContain("stable across resume");
		expect(metadata).toContain("never from title, slug, timestamp, or hash");
	});

	test("Phase 4 requires the same anchor to be read from persisted state", () => {
		const phase4 = sectionBetween(
			deepInterview,
			"## Phase 4: Crystallize Spec",
			"## Phase 5: Execution Bridge",
		);
		expect(phase4).toContain(DESIGN_ANCHOR);
		expect(phase4).toContain("persisted state.interview_id");
		expect(phase4).toContain("never from title, slug, timestamp, or hash");
	});
});

describe("deep-interview to craft-tasks handoff", () => {
	const phase5 = sectionBetween(deepInterview, "## Phase 5: Execution Bridge", "</Steps>");

	test("Phase 5 carries the exact designAnchor unchanged", () => {
		expect(phase5).toContain("exact `designAnchor`");
		expect(phase5).toContain(`designAnchor: "${DESIGN_ANCHOR}"`);
		expect(phase5).toContain("unchanged");
	});

	test("known parent identity is carried in the paired handoff block", () => {
		const handoffBlock = [
			`designAnchor: "${DESIGN_ANCHOR}"`,
			'parentId: "<known parent ID or URL, when available>"',
		].join("\n");
		expect(phase5).toContain(handoffBlock);
	});
});

describe("부모 처리 위임과 작업 최신화", () => {
	const parent = () =>
		sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
	test("부모 처리 정책은 craft-issue에 위임한다", () => {
		expect(parent()).toContain("REQUIRED SUB-SKILL: Use craft-issue");
		expect(parent()).toContain('Skill(skill: "craft-issue")');
		expect(parent()).toContain("returned `parentId`");
		expect(craftTasks).not.toContain("### Settled-parent record shape");
		expect(craftTasks).not.toContain("one append-only design-handoff comment");
		expect(craftTasks).not.toContain("parent-only search");
	});
	test("craft-issue handoff carries parent, exact anchor, and settled context", () => {
		expect(parent()).toContain('parentId: "<known parent ID or URL, when available>"');
		expect(parent()).toContain(`designAnchor: "${DESIGN_ANCHOR}"`);
		expect(parent()).toContain("settled design context");
	});
	test("부모 연결 검증 후에만 자식에 접근한다", () => {
		expect(craftTasks).toContain("missing or invalid anchor");
		expect(parent()).toContain("exact `designAnchor`");
		expect(parent()).toContain("ambiguity, mismatch, failure, or interruption");
		expect(lineOf(craftTasks, "### Parent-resolution gate")).toBeLessThan(
			lineOf(craftTasks, "### Existing-child / duplicate gate"),
		);
	});
	test("stable task identity survives mutable purpose and target changes", () => {
		expect(craftTasks).toContain("verified child ID or a stable task key");
		expect(craftTasks).toContain("purpose and changed target are mutable");
		expect(craftTasks).toContain("shared anchor");
		expect(craftTasks).toContain("a stable-key match remains the same task when either changes");
		expect(craftTasks).toContain("title alone is insufficient");
		expect(craftTasks).toContain("create only unmatched gaps");
	});
	test("legacy children without stable identity stop as ambiguous", () => {
		expect(craftTasks).toContain("If the stable key or verified child ID is absent for a legacy task, stop with ambiguity");
		expect(craftTasks).not.toContain("identity is the exact tuple: anchor + purpose + changed target");
	});
	test("기존 작업은 본문을 최신화하고 다른 사람의 기록을 보존한다", () => {
		expect(craftTasks).toContain("update the existing task body in place");
		expect(craftTasks).toContain("Preserve contributor notes, progress, and decisions");
		expect(craftTasks).not.toContain("never rewrite their bodies");
		expect(craftTasks).not.toContain("Existing ticket → append comment, never rewrite the body");
	});
	test("의미 있는 변경은 세 항목의 경위 코멘트를 남긴다", () => {
		for (const text of ["계기", "판단과 근거", "변경과 영향", "meaningful change"])
			expect(craftTasks).toContain(text);
		expect(craftTasks).toContain("Typo or wording only");
		expect(craftTasks).toContain("No effective change");
	});
	test("미결정 사항은 확정된 작업으로 기록하지 않는다", () => {
		expect(craftTasks).toContain("Unresolved decision");
		expect(craftTasks).toContain("deep-interview");
	});
	test("중단 후에는 본문과 코멘트 중 누락된 작업만 복구한다", () => {
		expect(craftTasks).toContain("body, relations, and required change comment");
		expect(craftTasks).toContain("complete only the missing writes");
	});
	test("작업용 쓰기 계약만 재사용하고 부모 위임의 검토는 막지 않는다", () => {
		expect(craftTasks).toContain("plain-language/humanizer");
		expect(craftTasks).toContain("abstract relation/label/write mechanics");
		expect(craftTasks).toContain("no automated task reviewer");
		expect(craftTasks).toContain(
			"craft-issue runs its own workflow for delegated issue/parent work",
		);
	});
	test("생성 의무는 모든 쓰기 게이트를 통과한 뒤 적용한다", () => {
		expect(craftTasks).not.toContain("After the precondition gate passes");
		expect(craftTasks).toContain("After all applicable gates pass");
	});

	test("외부 기록은 이식 가능한 근거를 사용한다", () => {
		expect(craftTasks).toContain("local spec path is input-only");
		expect(craftTasks).toContain("never `$OMT_DIR`, a machine-local path, or `file://`");
	});
});

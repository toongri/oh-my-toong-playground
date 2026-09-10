import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Design-handoff prose contract for craft-tasks and its deep-interview source.
// These are intentionally focused presence/order assertions: the skills are
// prompt contracts, so the regression surface is the words and sequencing
// that prevent an unsafe PM write.
// ---------------------------------------------------------------------------

const craftTasks = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const journalScript = join(import.meta.dir, "scripts", "task-write-journal.ts");
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

	test("Phase 5 carries prior per-child identities for later maintenance", () => {
		expect(phase5).toContain("optional `taskIdentities` collection");
		expect(phase5).toContain("taskKey");
		expect(phase5).toContain("childId");
		expect(phase5).toContain("preserving each immutable taskKey");
	});
});

describe("stable child task identity contract", () => {
	const identity = () =>
		sectionBetween(craftTasks, "### Existing-child / duplicate gate", "### Task maintenance");

	test("craft-tasks generates an opaque immutable key once for each new gap", () => {
		const text = identity();
		expect(text).toContain("non-empty opaque immutable `taskKey`");
		expect(text).toContain("generate the key once before creation");
		expect(text).toContain("never derive it from mutable fields or shared identities");
		for (const forbidden of ["designAnchor", "parentId", "title", "purpose", "changed target", "slug", "timestamp", "hash"])
			expect(text).toContain(forbidden);
	});

	test("task handoff requires existing taskKey and optional verified childId", () => {
		const text = identity();
		expect(text).toContain("taskKey: the existing immutable key for a known task");
		expect(text).toContain("required when updating an existing child");
		expect(text).toContain("childId: the verified PM child ID when known");
		expect(text).toContain("optional when the task key is available");
		expect(text).toContain("New gaps may omit taskKey only until craft-tasks generates it");
	});

	test("identity comment is canonical, append-only, portable, and verified after writes", () => {
		const text = identity();
		expect(text).toContain("Task identity");
		expect(text).toContain("taskKey");
		expect(text).toContain("append-only identity comment");
		expect(text).toContain("existing `create_comment` mechanism");
		expect(text).toContain("separate from reader-facing body sections and change comments");
		expect(text).toContain("missing or mismatched identity comment is not a successful create/update");
		expect(text).toContain("machine-local paths");
	});

	test("every write and recovery re-read returns taskIdentities and never replaces an uncertain child", () => {
		const text = identity();
		expect(text).toContain("After every create/update and on recovery, re-read the child and identity comment");
		expect(text).toContain("Return a `taskIdentities` result containing `taskKey` and `childId` for every child");
		expect(text).toContain("next handoff carries that result");
		expect(text).toContain("If identity is missing, inconsistent, or the re-read fails, stop without creating a replacement");
	});

	test("durable create intent is journaled in write order", () => {
		const text = identity();
		for (const field of ["createIntentId", "taskKey", "verified `parentId`", "exact `designAnchor`", "exact proposed creation payload", "state `prepared`"]) {
			expect(text).toContain(field);
		}
		expect(text).toContain("before `save_issue`");
		expect(text).toContain("After `save_issue` returns");
		expect(text).toContain("verified `childId`");
		expect(text).toContain("state `child-created`");
		expect(text).toContain("mark the intent `complete`");
		expect(text).toContain("fresh opaque `createIntentId` distinct from `taskKey`");
		expect(text).toContain("do not put identity metadata in the reader-facing body");
		expect(text.indexOf("before `save_issue`")).toBeLessThan(text.indexOf("After `save_issue` returns"));
		expect(text.indexOf("After `save_issue` returns")).toBeLessThan(text.indexOf("mark the intent `complete`"));
	});

	test("bundled journal CLI and executable create transitions are documented", () => {
		expect(existsSync(journalScript)).toBe(true);
		const text = identity();
		for (const command of ["create-prepare", "create-child", "create-complete", "manual-reconciliation"])
			expect(text).toContain(` ${command}`);
		for (const field of ["creationPayload", "body", "relations", "identityComment"])
			expect(text).toContain(`\`${field}\``);
		expect(text).toContain("CLAUDE_SKILL_DIR");
		expect(text).toContain("all required re-reads pass");
		expect(text.indexOf('task-write-journal.ts" create-prepare')).toBeLessThan(text.indexOf("After `save_issue`"));
		expect(text.indexOf("call `create-child`")).toBeGreaterThan(text.indexOf("After `save_issue` returns"));
		expect(text.indexOf("Call `create-complete`")).toBeGreaterThan(text.indexOf("call `create-child`"));
	});

	test("response loss re-reads identity and never discovers an uncertain child", () => {
		const text = identity();
		expect(text).toContain("re-read the canonical identity comment before `create-complete`");
		expect(text).toContain("never writes a duplicate");
		expect(text).toContain("child-tree rematching is allowed only for an existing verified identity");
		expect(text).toContain("never to discover an uncertain new child");
		expect(text).toContain("manual-reconciliation");
	});

	test("bundled journal CLI and executable update transitions are documented", () => {
		expect(existsSync(journalScript)).toBe(true);
		const text = sectionBetween(craftTasks, "### Durable update-intent protocol", "### Recovery and manual stop");
		for (const command of ["update-prepare", "update-mutation-written", "update-complete"])
			expect(text).toContain(` ${command}`);
		for (const field of ["before", "after", "changeComment", "body", "relations"])
			expect(text).toContain(`\`${field}\``);
		expect(text).toContain("before any meaningful body/relation mutation");
		expect(text).toContain("after the PM mutation");
		expect(text).toContain("body/relations/change-comment re-read");
		expect(text.indexOf("update-prepare")).toBeLessThan(text.indexOf("After the PM body/relation mutation"));
		expect(text.indexOf("update-mutation-written")).toBeLessThan(text.indexOf("body/relations/change-comment re-read"));
	});

	test("journal is orchestration state and ambiguous recovery is an explicit stop", () => {
		const text = identity();
		expect(text).toContain("local orchestration state");
		expect(text).toContain("no invented PM field or idempotency primitive");
		expect(text).toContain("manual-reconciliation-required");
		expect(text).toContain("no verified `childId`/result");
	});

	test("partial-create recovery is child-bound and stops safely without a result", () => {
		const text = identity();
		for (const phrase of [
			"exact canonical identity comment",
			"without duplicating the comment",
			"only a verified intent-to-child association",
			"verify its parent and exact anchor",
			"retry only missing identity/comment writes",
			"documented PM idempotency/client-request lookup",
			"manual-reconciliation-required",
			"unreadable/missing intent",
			"never derive or regenerate `taskKey`/`createIntentId` from `childId`",
			"Never create a replacement for an uncertain partial child",
		]) {
			expect(text).toContain(phrase);
		}
	});

	test("matching precedence is verified childId, then taskKey plus parent and exact anchor", () => {
		const text = identity();
		const childId = text.indexOf("supplied verified `childId` first");
		const taskKey = text.indexOf("then `taskKey` plus the verified shared `parentId` and exact `designAnchor`");
		expect(childId).toBeGreaterThanOrEqual(0);
		expect(taskKey).toBeGreaterThan(childId);
		for (const forbidden of ["title", "purpose", "changed target", "slug"])
			expect(text).toContain(`Never match by ${forbidden}`);
		expect(text).toContain("A different `taskKey` is a genuine gap");
	});

	test("legacy ambiguity and body shape are explicit", () => {
		const text = identity();
		expect(text).toContain("Legacy children with neither a verified childId nor taskKey stop as ambiguity");
		expect(text).toContain("task bodies contain only the three reader-facing sections");
		expect(text).toContain("identity metadata in body prose or machine-local paths in comments/handoffs");
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
		expect(craftTasks).toContain("A stable-key match remains the same task when either purpose or changed target changes");
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

describe("durable task-write runtime contract", () => {
	test("create-prepare requires nested creationPayload and strips orchestration metadata", () => {
		const text = sectionBetween(craftTasks, "#### Durable create-intent protocol", "#### Durable update-intent protocol");
		expect(text).toContain("`create-prepare` requires nested `creationPayload`");
		expect(text).toContain("strips orchestration-only `designAnchor` and `identityComment` from the PM payload");
		expect(text).toContain("injects the verified `parentId`");
		expect(text).toContain("Verify that `parentId` is injected");
	});

	test("terminal transitions compact intents and unlink an empty journal", () => {
		const text = sectionBetween(craftTasks, "#### Durable create-intent protocol", "#### Recovery and manual stop");
		expect(text).toContain("Terminal transitions compact terminal intents immediately");
		expect(text).toContain("unlink the journal when no intents remain");
	});

	test("task journals are protected from generic TTL cleanup", () => {
		const text = craftTasks;
		expect(text).toContain("excluded from generic `SESSION_ARTIFACT_PREFIXES` TTL deletion");
		expect(text).toContain("valid journal names are recognition-only to the state-liveness unclassified-file classifier");
		expect(text).toContain("pending or malformed journal content is preserved for explicit recovery");
	});

	test("lock acquisition publishes initialized owners and handles transient and unsafe locks", () => {
		const text = sectionBetween(craftTasks, "#### Durable create-intent protocol", "#### Durable update-intent protocol");
		expect(text).toContain("lock claim owner is fully initialized before atomic publication");
		expect(text).toContain("retry transient empty release");
		expect(text).toContain("stale empty legacy lock may be reclaimed");
		expect(text).toContain("Preserve malformed or live owner locks");
		expect(text).toContain("fail acquisition boundedly");
	});
});

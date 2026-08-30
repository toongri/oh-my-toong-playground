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
const deepInterview = readFileSync(join(import.meta.dir, "..", "deep-interview", "SKILL.md"), "utf8");
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
		const phase4 = sectionBetween(deepInterview, "## Phase 4: Crystallize Spec", "## Phase 5: Execution Bridge");
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

describe("craft-tasks parent-resolution safety gate", () => {
	const anchorStart = lineOf(craftTasks, "### Design-anchor gate");
	const parentStart = lineOf(craftTasks, "### Parent-resolution gate");
	const childStart = lineOf(craftTasks, "### Existing-child / duplicate gate");

	test("rejects a missing or invalid anchor before PM tree or child writes", () => {
		expect(craftTasks).toContain("missing or invalid anchor");
		expect(craftTasks).toContain("before any child-tree/create");
		expect(anchorStart).toBeGreaterThanOrEqual(0);
		expect(parentStart).toBeGreaterThan(anchorStart);
	});

	test("a known parent must match the exact anchor", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		expect(parent).toContain("match the exact anchor");
		expect(parent).toContain("exact `designAnchor`");
	});

	test("a legacy WHAT parent is enriched once, append-only, with the settled design handoff", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		expect(parent).toContain("one append-only design-handoff comment");
		for (const field of ["anchor", "settled goal", "approach", "invariants", "boundary", "canonical external design URL"]) {
			expect(parent).toContain(field);
		}
		expect(parent).toContain("never use a local session path");
	});

	test("a legacy parent is verified and enriched before the exact-anchor comparison", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		const legacy = parent.indexOf("verify that it is a real existing legacy WHAT parent with no `designAnchor`");
		const exactAnchor = parent.indexOf("For an existing parent with a non-empty `designAnchor`, apply the exact-anchor requirement");
		expect(legacy).toBeGreaterThanOrEqual(0);
		expect(exactAnchor).toBeGreaterThan(legacy);
		const legacyBranch = parent.slice(legacy, exactAnchor);
		expect(legacyBranch).toContain("enrich it once, append-only");
		expect(legacyBranch).toContain("re-read effective state");
		expect(legacyBranch).toContain("continue only after the exact anchor is present");
	});

	test("an existing non-empty different anchor remains a hard stop", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		expect(parent).toContain("existing parent with a non-empty different anchor remains a hard stop");
	});

	test("anchor search is parent-only before exactly-one cardinality", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		const search = parent.indexOf("parent-only search");
		const filter = parent.indexOf("Filter PM search results to verified parent records/parent role");
		const cardinality = parent.indexOf("applying the exactly-one cardinality rule");
		expect(search).toBeGreaterThanOrEqual(0);
		expect(filter).toBeGreaterThan(search);
		expect(cardinality).toBeGreaterThan(filter);
		expect(parent).toContain("Children sharing an anchor must never be adopted as a parent");
	});

	test("every parent branch uses one complete settled-parent record shape", () => {
		const record = sectionBetween(craftTasks, "### Settled-parent record shape", "### Parent-resolution gate");
		expect(record).toContain("supplied, found, enriched, and created");
		for (const field of [
			"exact `designAnchor`",
			"settled goal",
			"approach",
			"invariants",
			"boundary",
			"canonical external design URL",
		]) {
			expect(record).toContain(field);
		}
		expect(record).toContain("missing fields are completed append-only");
		expect(record).toContain("new parents persist the complete shape");
	});

	test("parent enrichment or creation is re-read and verified before child-tree access", () => {
		const parent = sectionBetween(craftTasks, "### Parent-resolution gate", "### Existing-child / duplicate gate");
		expect(parent).toContain("Re-read and verify effective state after append/create");
		expect(parent).toContain("resolved `parentId`");
		expect(childStart).toBeGreaterThan(parentStart);
		expect(lineOf(craftTasks, "read the verified parent's current child tree")).toBeGreaterThan(parentStart);
	});

	test("any unsafe parent handoff outcome stops before child creation", () => {
		expect(craftTasks).toContain(
		"Any ambiguity, mismatch, append failure, re-read failure, or interruption stops before child creation.",
	);
	});
});

describe("craft-tasks child identity and append-only writes", () => {
	test("new parent and every child persist the same anchor and parent relationship", () => {
		expect(craftTasks).toContain("A new parent persists the same anchor");
		expect(craftTasks).toContain("Every child carries the same anchor and `parentId`");
	});

	test("existing-child identity is the exact anchor-purpose-target tuple", () => {
		expect(craftTasks).toContain("identity is the exact tuple: anchor + purpose + changed target");
		expect(craftTasks).toContain("title alone is insufficient");
	});

	test("matched children are preserved and enriched append-only while only unmatched gaps are created", () => {
		expect(craftTasks).toContain("preserve/enrich matched tickets append-only");
		expect(craftTasks).toContain("create only unmatched gaps");
		expect(craftTasks).toContain("re-read and verify effective state after append/create");
	});
});

describe("craft-tasks v1 Stage 6 reuse boundary", () => {
	const writeTail = sectionBetween(craftTasks, "## Write Tail", "## Red Flags");

	test("reuses only the applicable craft-issue mechanics", () => {
		expect(writeTail).toContain("plain-language/humanizer");
		expect(writeTail).toContain("append-only");
		expect(writeTail).toContain("abstract relation/label/write mechanics");
		expect(writeTail).toContain("runtime binding");
	});

	test("excludes WHAT-only slicing and the mandatory issue-reviewer Checklist Review Gate", () => {
		expect(writeTail).toContain("WHAT-only slicing");
		expect(writeTail).toContain("mandatory issue-reviewer Checklist Review Gate");
		expect(writeTail).toContain("must not");
	});

	test("v1 has no automated task reviewer", () => {
		expect(writeTail).toContain("no automated task reviewer");
		expect(writeTail).not.toContain("dispatch the `issue-reviewer`");
	});

	test("the local spec path is input-only and written context stays portable", () => {
		expect(writeTail).toContain("local spec path is input-only");
		expect(writeTail).toContain("Any parent or child body or comment must contain portable inline context or a canonical external URL");
		expect(writeTail).toContain("never `$OMT_DIR`, a machine-local path, or `file://`");
	});
});

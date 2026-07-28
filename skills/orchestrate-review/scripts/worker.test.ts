#!/usr/bin/env bun

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { filterPromptSections, KNOWN_SECTION_NAMES } from "./worker.ts";

const TEMPLATE_PATH = path.join(import.meta.dirname, "chunk-reviewer-prompt.md");
const WORKER_PATH = path.join(import.meta.dirname, "worker.ts");

/**
 * Build a realistic prompt.txt-equivalent fixture from the actual template file, with each
 * placeholder swapped for a unique sentinel string. Reading the real template (rather than a
 * hand-copied shadow fixture) means a template edit that moves/removes a marker breaks this
 * test too, instead of staying green against a stale copy.
 *
 * Uses the full file, Field Reference table included: that table is now wrapped in its own
 * `<!-- section:field_reference -->` marker (listed in no angle's allowlist), so
 * filterPromptSections strips it for every named member on its own — no manual slicing needed,
 * and no manual slice can safely substitute for it either, since a cut that lands after the
 * marker's open tag but before its close tag would leave a dangling, unmatched open marker in
 * the fixture (verified: this literal marker text then survives filtering and fails the
 * no-marker-boundary-survives assertion below).
 */
function buildFixturePrompt(): string {
	const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
	return raw
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

	// Regression: the "## Field Reference" table used to sit outside any section marker, so a
	// full-file interpolation (the orchestrator fills placeholders across the whole file, not
	// just the body above the table) reproduced every placeholder's value a second time inside
	// the table's own cells — leaking a payload that every named member's allowlist should have
	// blocked, project_context included even though it is blocked for all four members. Wrapping
	// the table in its own `<!-- section:field_reference -->` marker (absent from every member's
	// allowlist) closes it. Pre-fix, this failed for every member below; confirmed by reverting
	// the chunk-reviewer-prompt.md wrap and re-running — see report.
	it("Field Reference 표는 어느 앵글에도 전달되지 않는다 (문서 표가 마커 밖에 있어 전체 페이로드가 새는 결함의 회귀 테스트)", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("## Field Reference");
			expect(filtered).not.toContain("| Field | Required | Source |");
			// The table's own cells reproduce every placeholder token, so it would leak
			// project_context specifically — the one field every member blocks — if the table
			// weren't marker-protected.
			expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		}
	});

	// Regression: SECTION_MARKER_RE's lazy body match (`[\s\S]*?`) used to stop at the FIRST
	// occurrence of a section's closing-marker string anywhere in the text, including one
	// reproduced inline inside an interpolated placeholder value (e.g. a quoted excerpt of this
	// very template, realistic when the template file itself is under review). Everything after
	// that inline reproduction — including a later, real conditional section that the member's
	// allowlist should have blocked — then passed through unfiltered. Anchoring the marker to
	// start/end of its own line (the shape a real marker always has in this template) closes it.
	// Pre-fix, this failed for `correctness` below; confirmed by reverting the SECTION_MARKER_RE
	// change and re-running — see report.
	// Regression: an interpolated value that reproduces the closing-marker string ALONE on its own
	// line (not inline mid-sentence, unlike the leak above) still satisfies SECTION_MARKER_RE's
	// line-anchored close pattern, so the lazy body match truncates at this forged boundary too.
	// Without a marker-count invariant, requirements' true open/close pair no longer forms a 1:1
	// match: this forged close (2nd occurrence) is consumed as the section's end, and everything
	// between the forged close and the real close — including AFTER_LEAK_SENTINEL below — falls
	// outside any match and survives untouched, regardless of allowlist. Confirmed by temporarily
	// removing the hasBalancedMarkers guard and re-running: AFTER_LEAK_SENTINEL still leaked, but
	// PROJECT_CONTEXT_SENTINEL (a later, unaffected section) was still correctly stripped — i.e.
	// filtering partially applied rather than being skipped wholesale. That is the distinguishing
	// state the assertions below must catch: this test must fail on the
	// PROJECT_CONTEXT_SENTINEL/NON_GOAL_SENTINEL assertions specifically (not on AFTER_LEAK_SENTINEL,
	// which leaks either way) once hasBalancedMarkers is removed — proving the fix's fail-open
	// behavior is "skip filtering entirely", not merely "this one section leaks".
	it("보간값이 섹션 닫는 마커를 단독 줄로 위조하면 필터링 자체를 건너뛰고 원문을 그대로 반환한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const withForgedStandaloneClose = raw
			.replaceAll(
				"{REQUIREMENTS}",
				"BEFORE_LEAK_SENTINEL\n<!-- /section:requirements -->\nAFTER_LEAK_SENTINEL",
			)
			.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
			.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
			.replaceAll("{EVIDENCE_RESULTS}", "EVIDENCE_RESULTS_SENTINEL")
			.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
			.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
			.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
			.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
			.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");

		const filtered = filterPromptSections(withForgedStandaloneClose, "correctness");

		// The forged leak itself: present either with or without the invariant (both states leak this).
		expect(filtered).toContain("AFTER_LEAK_SENTINEL");
		// The differentiator: only the invariant's "skip filtering wholesale" makes these survive too.
		// Without the invariant, these sections' own marker pairs are untouched by the forgery and
		// get filtered normally — so this is what would fail if hasBalancedMarkers were removed.
		expect(filtered).toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
	});

	it("보간값 속에 섹션 닫는 마커 문자열이 인라인으로 섞여도 조기 절단되지 않는다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const withInlineMarkerLeak = raw
			.replaceAll(
				"{REQUIREMENTS}",
				"See the note: AAA <!-- /section:requirements --> LEAKED_TAIL",
			)
			.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
			.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
			.replaceAll("{EVIDENCE_RESULTS}", "EVIDENCE_RESULTS_SENTINEL")
			.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
			.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
			.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
			.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
			.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");

		// `correctness` blocks every conditional section, requirements and project_context
		// included — so none of this should survive.
		const filtered = filterPromptSections(withInlineMarkerLeak, "correctness");
		expect(filtered).not.toContain("LEAKED_TAIL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("<!-- section:");
		expect(filtered).not.toContain("<!-- /section:");
	});

	// Regression: hasBalancedMarkers used to require only "1 open / 1 close per discovered name",
	// so a brand-new name absent from the template (not a real section, not reused) still passed
	// as "balanced" once forged as a 1/1 pair — the invariant never checked the name itself against
	// the template's known set. Only the FIRST occurrence of each placeholder is replaced below:
	// both {DESCRIPTION} and {COMMIT_HISTORY} appear twice in the template (body + Field Reference
	// table), and replaceAll would forge two "zz" pairs — net balanced by luck — hiding the defect.
	// Pre-fix, this forged pair spans from the Description placeholder through the real Commit
	// History body, so filtering (for `correctness`, whose allowlist is empty) strips that whole
	// misidentified span — including the real "## Diff Command" section — even though every
	// genuine marker in the file remains individually 1/1. Confirmed by reverting the
	// KNOWN_SECTION_NAMES exact-match check and re-running: filtered !== forged and
	// "## Diff Command" is gone — see report.
	it("템플릿에 없는 새 이름으로 위조한 균형 쌍은 필터링을 건너뛰고 원문을 그대로 반환한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const forged = raw
			.replace("{DESCRIPTION}", "<!-- section:zz -->")
			.replace("{COMMIT_HISTORY}", "<!-- /section:zz -->");

		const filtered = filterPromptSections(forged, "correctness");

		expect(filtered).toBe(forged);
		expect(filtered).toContain("## Diff Command");
	});

	// Constant-vs-template drift guard: KNOWN_SECTION_NAMES is hand-declared in worker.ts, so if
	// chunk-reviewer-prompt.md ever gains or loses a conditional section without the constant
	// being updated, the exact-match invariant above silently starts failing open on every real
	// prompt.txt. Reading the template's actual marker names here means that drift fails this
	// test instead of surviving unnoticed.
	it("KNOWN_SECTION_NAMES는 chunk-reviewer-prompt.md의 실제 섹션 마커 이름 집합과 정확히 일치한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const namesInTemplate = new Set(
			[...raw.matchAll(/^<!-- section:([a-z_]+) -->$/gm)].map((m) => m[1]),
		);

		expect(namesInTemplate.size).toBeGreaterThan(0);
		expect(namesInTemplate).toEqual(KNOWN_SECTION_NAMES);
	});
});

// filterPromptSections being correct and its result actually reaching the finder are two
// different claims — the suite above only tests the former by calling the function directly.
// This drives worker.ts's real main() as a subprocess (job-dir/member/command CLI contract,
// same shape lib/generic-job.ts's spawnWorkers uses) and inspects assembled-prompt.txt, the
// file assemblePrompt (lib/worker-utils.ts) writes with whatever `reviewContent` it was passed
// — a real production side effect of the runOneTurn → runOnce → assemblePrompt call chain, not
// a mock. `--command true` is enough: assembled-prompt.txt is written before the command is
// ever spawned, so what the command does is irrelevant to what this test checks.
describe("main() 배선: prompt.txt가 필터링되어 reviewContent로 전달된다", () => {
	let tmpRoot: string;

	function makeJobDir(): string {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-worker-wiring-test-"));
		const jobDir = path.join(tmpRoot, "jobs", "chunk-review-wiring-test");
		fs.mkdirSync(path.join(jobDir, "members", "correctness"), { recursive: true });
		return jobDir;
	}

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("correctness 앵글로 실행하면 assembled-prompt.txt에 공통 섹션은 남고 조건부 섹션은 전부 제거된다", () => {
		const jobDir = makeJobDir();
		fs.writeFileSync(path.join(jobDir, "prompt.txt"), buildFixturePrompt(), "utf8");

		execFileSync(
			process.execPath,
			[WORKER_PATH, "--job-dir", jobDir, "--member", "correctness", "--command", "true"],
			{ stdio: "pipe" },
		);

		const assembled = fs.readFileSync(
			path.join(jobDir, "members", "correctness", "assembled-prompt.txt"),
			"utf8",
		);

		// prompt.txt was actually read: a common section (no marker, always passes through) is present.
		expect(assembled).toContain("FILE_LIST_SENTINEL");
		// correctness blocks every conditional section — none of them may reach the finder.
		for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
			expect(assembled).not.toContain(sentinel);
		}
	});
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	dismissReviewFinding,
	readCodeReviewArtifact,
	readGoalState,
	requestComplete,
	setGoalState,
	setSingleStory,
	setVerdict,
} from "./ultragoal-state";

// ---------------------------------------------------------------------------
// V8: code-review artifact enum-contract preservation (redesign path)
//
// Guards the T1 EXTERNAL contract for the code-review completion lane:
//   - every verdict in {CONFIRMED, PLAUSIBLE}  (readCodeReviewArtifact rejects
//     the whole artifact on any enum violation — never-false-complete)
//   - every class in {correctness, cleanup, requirement-gap}
//   - zero serialized `confidence` in any finding  (readCodeReviewArtifact
//     ignores extra keys so it will NOT reject a leaked confidence; only this
//     raw-string scan catches that — ADR D-3, risk R1)
//
// T5 (44c7ae4f) pins `confidence` as inline-internal numeric 0.0-1.0, never
// serialized into the artifact.  This test enforces that property: if the
// redesign path ever leaks `confidence` into a finding's JSON, the raw-scan
// assertion fails.
//
// The REAL readCodeReviewArtifact is called directly (ultragoal-state.ts:735);
// the non-null assertion proves the real reader ACCEPTS the redesign-path
// artifact (R1 fail-closed gate).  readCodeReviewArtifact reads from
// resolveCodeReviewArtifactPath(sid) = ${getOmtDir()}/ultragoal-codereview-${sid}.json;
// getOmtDir() reads OMT_DIR at call time, so the hermetic temp-dir env setup
// makes the real reader read the fixture.
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;

/** Session id for tests in this file — isolated from the main ultragoal-state session. */
const SID = "v8-contract-test";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "ultragoal-codereview-contract-test-"));
	process.env.OMT_DIR = tmpDir;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) {
		process.env.OMT_DIR = originalOmtDir;
	} else {
		delete process.env.OMT_DIR;
	}
});

/**
 * Conventional artifact path — mirrors resolveCodeReviewArtifactPath (ultragoal-state.ts:720-722).
 * No path argument accepted: D-11 (a path arg would be a steerable gate input).
 */
function codeReviewArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/ultragoal-codereview-${sid}.json`;
}

function writeArtifact(sid: string, obj: object): void {
	writeFileSync(codeReviewArtifactPath(sid), JSON.stringify(obj), "utf8");
}

/**
 * Verdict-artifact path — mirrors resolveVerdictArtifactPath (ultragoal-state.ts:895-897,
 * unexported, so this test file constructs the same convention directly).
 */
function verdictArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/ultragoal-verdict-${sid}.json`;
}

/**
 * Minimal "objective lane green" fixture for the T7 requirement-gap tests below —
 * sets up state so ONLY the code-review lane in requestComplete (ultragoal-state.ts)
 * determines the outcome. Uses the setSingleStory carve-out (one auto-derived
 * confirmed story `S1`) so no manual Story object construction is needed.
 */
function buildObjectiveLaneGreenFixture(sid: string): void {
	setGoalState(sid, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
	setSingleStory(sid); // derives confirmed story S1
	setGoalState(sid, {
		phase: "pursuing",
		completion_evidence_paths: [`${process.env.OMT_DIR}/evidence.md`],
	});
	setVerdict(sid, "APPROVE");
	writeFileSync(
		verdictArtifactPath(sid),
		JSON.stringify({
			objective_verdict: "APPROVE",
			stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["evidence.md"] }],
			verifier: "orchestrator",
			at: "2026-06-26T10:00:00",
		}),
		"utf8",
	);
}

// Representative redesign-path finding set: inline + escalated, kept under the
// {CONFIRMED, PLAUSIBLE} enum.  REFUTED findings are dropped before serialization
// (they never appear in the artifact), so the set is a mix of both kept verdicts
// across both classes.
const REDESIGN_FINDINGS: Array<{ class: string; verdict: string; impact: string; ref: string }> = [
	// inline correctness judgment, high certainty -> CONFIRMED
	{
		class: "correctness",
		verdict: "CONFIRMED",
		impact: "MEDIUM",
		ref: "skills/code-review/SKILL.md:Phase2:inline",
	},
	// escalated correctness finding, uncertain -> PLAUSIBLE
	{ class: "correctness", verdict: "PLAUSIBLE", impact: "MEDIUM", ref: "tools/sync.ts:42" },
	// inline cleanup judgment, low severity -> PLAUSIBLE
	{
		class: "cleanup",
		verdict: "PLAUSIBLE",
		impact: "LOW",
		ref: "skills/code-review/SKILL.md:Phase2:escalated",
	},
	// escalated cleanup finding, architecture concern -> CONFIRMED
	{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "tools/adapters/claude.ts:88" },
];

describe("V8: code-review 아티팩트 열거형 계약 보존 (redesign 경로)", () => {
	// -------------------------------------------------------------------------
	// AC 1: real readCodeReviewArtifact returns non-null — R1 fail-closed gate
	// -------------------------------------------------------------------------
	test("유효한 스키마: `readCodeReviewArtifact`가 redesign 경로 아티팩트에 대해 null이 아닌 값 반환 (R1 fail-closed)", () => {
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: REDESIGN_FINDINGS,
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		const artifact = readCodeReviewArtifact(SID);
		expect(artifact).not.toBeNull();
	});

	// -------------------------------------------------------------------------
	// AC 2: every finding verdict in {CONFIRMED, PLAUSIBLE}
	// -------------------------------------------------------------------------
	test("모든 finding verdict가 {CONFIRMED, PLAUSIBLE}에 속함 — redesign 경로에서 열거형 계약 보존", () => {
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: REDESIGN_FINDINGS,
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		const artifact = readCodeReviewArtifact(SID)!;
		const VALID_VERDICTS = new Set(["CONFIRMED", "PLAUSIBLE"]);
		for (const finding of artifact.findings) {
			expect(VALID_VERDICTS.has(finding.verdict)).toBe(true);
		}
	});

	// -------------------------------------------------------------------------
	// AC 3: every finding class in {correctness, cleanup}
	// -------------------------------------------------------------------------
	test("모든 finding class가 {correctness, cleanup}에 속함 — redesign 경로에서 열거형 계약 보존", () => {
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: REDESIGN_FINDINGS,
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		const artifact = readCodeReviewArtifact(SID)!;
		const VALID_CLASSES = new Set(["correctness", "cleanup"]);
		for (const finding of artifact.findings) {
			expect(VALID_CLASSES.has(finding.class)).toBe(true);
		}
	});

	// -------------------------------------------------------------------------
	// AC 4 (CRITICAL): zero confidence in raw serialized finding strings
	//
	// readCodeReviewArtifact IGNORES extra keys (ultragoal-state.ts:754-759) so it
	// will NOT reject a leaked `confidence` field — the raw-string scan is the
	// ONLY guard.  T5 (44c7ae4f) pins confidence as inline-internal; this test
	// enforces that property: a confidence leak would brick every goal completion
	// silently if it collided with verdict/class enum validation downstream.
	//
	// readCodeReviewArtifact casts the full parsed object (TypeScript casts are
	// erased at runtime), so artifact.findings retains all original JSON keys —
	// serializing each finding catches a leaked `confidence` key exactly as the
	// raw-file scan did.
	// -------------------------------------------------------------------------
	test("CRITICAL: 직렬화된 finding 문자열에 confidence 없음 (`readCodeReviewArtifact`는 추가 키 무시 — raw 스캔이 유일한 보호, T5/ADR-D3/R1)", () => {
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: REDESIGN_FINDINGS,
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		const artifact = readCodeReviewArtifact(SID)!;

		// Scan each finding's own serialization independently — not just the top-level
		// JSON string — because a leaked confidence may appear only in a finding key.
		for (const finding of artifact.findings) {
			const serialized = JSON.stringify(finding);
			expect(serialized).not.toContain("confidence");
		}
	});
});

describe("T7: requirement-gap 클래스 커버리지 계약 (regression guard)", () => {
	// REGRESSION GUARD, not a fresh RED: `requirement-gap` is already listed in
	// VALID_CLASSES, and requestComplete blocks CONFIRMED findings in the
	// correctness and requirement-gap classes — so this test passes today. Its
	// job is to pin that pairing against a future regression that narrows either
	// the class enum or the blocking classes.
	test("REGRESSION GUARD: requirement-gap 클래스 CONFIRMED HIGH finding — 아티팩트 수락 + requestComplete refuse", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: [{ class: "requirement-gap", verdict: "CONFIRMED", impact: "HIGH", ref: "foo.ts:1" }],
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		// 수락: requirement-gap이 VALID_CLASSES에 속해 있어 isCodeReviewArtifact가 아티팩트를 거부하지 않음.
		expect(readCodeReviewArtifact(SID)).not.toBeNull();
		// refuse: CONFIRMED × HIGH는 대각선 판정식에서 BLOCK이므로 완료가 차단됨.
		expect(requestComplete(SID)).toBe(false);
	});

	// 진짜 판별 케이스: PLAUSIBLE × LOW는 NOTE(non-blocking)이므로 위 BLOCK 케이스와 대조된다.
	test("requirement-gap 클래스 PLAUSIBLE LOW finding — requestComplete refuse 안 함 (non-blocking 판별)", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeArtifact(SID, {
			status: "COMPLETE",
			findings: [{ class: "requirement-gap", verdict: "PLAUSIBLE", impact: "LOW", ref: "foo.ts:2" }],
			reviewer: "code-reviewer",
			at: "2026-06-26T10:00:00",
		});

		expect(requestComplete(SID)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// T8: user-authorized dismissal of a wrong code-review finding
//
// The completion lane has an escape hatch for "run the review once more"
// (approveReviewDispatchRenewal) but NONE for "this finding is wrong". A single
// false-positive CONFIRMED correctness finding therefore makes the objective
// permanently uncompletable: the only exits are editing correct code to satisfy
// a wrong review, or set-blocked. `dismissReviewFinding` is the missing lever,
// shaped after the renewal one it sits beside — user-authorized, recorded in
// state (never in the write-guarded artifact), and pinned to the exact artifact
// bytes the dismissal was issued against.
// ---------------------------------------------------------------------------

/** The blocking finding these tests dismiss — CONFIRMED × HIGH, a BLOCK-outcome cell that deadlocks. */
const FALSE_POSITIVE = {
	class: "correctness",
	verdict: "CONFIRMED",
	impact: "HIGH",
	ref: "src/auth.ts:142",
};

function writeBlockingArtifact(sid: string, findings: object[], at = "2026-06-26T10:00:00"): void {
	writeArtifact(sid, { status: "COMPLETE", findings, reviewer: "code-reviewer", at });
}

describe("T8: 사용자 승인 finding 무효화 (dismiss-review-finding)", () => {
	test("무효화 전에는 CONFIRMED correctness 1건이 완료를 차단한다 (기준선)", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);

		expect(requestComplete(SID)).toBe(false);
	});

	test("무효화하면 그 finding이 차단 집합에서 빠져 requestComplete가 통과한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);

		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: "142행 위 guard가 null을 이미 걸러내므로 NPE 경로가 도달 불가",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(true);
	});

	test("입도는 finding 단위 — 무효화하지 않은 나머지 CONFIRMED는 계속 완료를 막는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [
			FALSE_POSITIVE,
			{ class: "requirement-gap", verdict: "CONFIRMED", impact: "MEDIUM", ref: "src/pay.ts:20" },
		]);

		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: "142행 위 guard가 null을 이미 걸러냄",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(false);
	});

	test("SHA 핀: 아티팩트 바이트가 바뀌면 같은 ref/class가 재발해도 무효화가 이월되지 않는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);
		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: "142행 위 guard가 null을 이미 걸러냄",
			}),
		).toBe(true);

		// 다음 라운드: 코드가 바뀌어 같은 위치에 진짜 결함이 생긴 새 리뷰 아티팩트.
		// ref/class는 동일하지만 바이트가 다르므로 이전 무효화는 적용되면 안 된다.
		writeBlockingArtifact(SID, [FALSE_POSITIVE], "2026-06-27T09:00:00");

		expect(requestComplete(SID)).toBe(false);
	});

	test("현재 아티팩트에 매칭되는 CONFIRMED finding이 없으면 무효화를 거부한다 (선제 무효화 차단)", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);

		expect(
			dismissReviewFinding(SID, {
				ref: "src/nowhere.ts:1",
				class: "correctness",
				rationale: "아직 나오지도 않은 finding을 미리 무효화",
			}),
		).toBe(false);
		expect(requestComplete(SID)).toBe(false);
	});

	test("비차단 finding(CONFIRMED × LOW = FIX)은 무효화 대상이 아니다 — 완료를 막지 않음", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [
			{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "src/log.ts:8" },
		]);

		expect(
			dismissReviewFinding(SID, {
				ref: "src/log.ts:8",
				class: "cleanup",
				rationale: "무의미한 무효화",
			}),
		).toBe(false);
	});

	test("빈 rationale은 거부한다 — 무효화는 근거 없이 기록되지 않는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);

		expect(
			dismissReviewFinding(SID, { ref: FALSE_POSITIVE.ref, class: "correctness", rationale: "   " }),
		).toBe(false);
		expect(requestComplete(SID)).toBe(false);
	});

	// A dismissal is keyed by (artifact bytes, ref, class), so two DISTINCT confirmed
	// findings sharing a ref and class are indistinguishable to it — refuting one
	// would clear both and let a genuine defect complete. Refusing the ambiguous
	// dismissal is the fail-closed direction: the user loses the escape hatch for
	// that finding, never the block on the other one.
	test("같은 ref/class의 CONFIRMED가 2건이면 무효화를 거부한다 — 한 건만 무효화하려다 진짜 결함까지 지우는 false-complete 차단", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE, { ...FALSE_POSITIVE }]);

		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: "둘 중 하나만 오탐",
			}),
		).toBe(false);
		expect(requestComplete(SID)).toBe(false);
	});

	test("값 없는 --rationale은 거부한다 — parseArgs의 boolean true가 근거 \"true\"로 기록되면 안 됨", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);

		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: true as unknown as string,
			}),
		).toBe(false);
		expect(requestComplete(SID)).toBe(false);
	});

	test("ADR-3: 무효화는 네 번째 verdict carrier — re-plan 시 함께 비워진다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeBlockingArtifact(SID, [FALSE_POSITIVE]);
		expect(
			dismissReviewFinding(SID, {
				ref: FALSE_POSITIVE.ref,
				class: "correctness",
				rationale: "142행 위 guard가 null을 이미 걸러냄",
			}),
		).toBe(true);

		setGoalState(SID, { phase: "planning", outcome: "ship it v2", verification_surface: "v2" });

		expect(readGoalState(SID)?.dismissed_review_findings ?? []).toEqual([]);
	});
});

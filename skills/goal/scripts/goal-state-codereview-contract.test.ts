import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readCodeReviewArtifact } from "./goal-state";

// ---------------------------------------------------------------------------
// V8: code-review artifact enum-contract preservation (redesign path)
//
// Guards the T1 EXTERNAL contract for the code-review completion lane:
//   - every verdict in {CONFIRMED, PLAUSIBLE}  (readCodeReviewArtifact rejects
//     the whole artifact on any enum violation — never-false-complete)
//   - every class in {correctness, cleanup}
//   - zero serialized `confidence` in any finding  (readCodeReviewArtifact
//     ignores extra keys so it will NOT reject a leaked confidence; only this
//     raw-string scan catches that — ADR D-3, risk R1)
//
// T5 (44c7ae4f) pins `confidence` as inline-internal numeric 0.0-1.0, never
// serialized into the artifact.  This test enforces that property: if the
// redesign path ever leaks `confidence` into a finding's JSON, the raw-scan
// assertion fails.
//
// The REAL readCodeReviewArtifact is called directly (goal-state.ts:735);
// the non-null assertion proves the real reader ACCEPTS the redesign-path
// artifact (R1 fail-closed gate).  readCodeReviewArtifact reads from
// resolveCodeReviewArtifactPath(sid) = ${getOmtDir()}/goal-codereview-${sid}.json;
// getOmtDir() reads OMT_DIR at call time, so the hermetic temp-dir env setup
// makes the real reader read the fixture.
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;

/** Session id for tests in this file — isolated from the main goal-state session. */
const SID = "v8-contract-test";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "goal-codereview-contract-test-"));
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
 * Conventional artifact path — mirrors resolveCodeReviewArtifactPath (goal-state.ts:720-722).
 * No path argument accepted: D-11 (a path arg would be a steerable gate input).
 */
function codeReviewArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/goal-codereview-${sid}.json`;
}

function writeArtifact(sid: string, obj: object): void {
	writeFileSync(codeReviewArtifactPath(sid), JSON.stringify(obj), "utf8");
}

// Representative redesign-path finding set: inline + escalated, kept under the
// {CONFIRMED, PLAUSIBLE} enum.  REFUTED findings are dropped before serialization
// (they never appear in the artifact), so the set is a mix of both kept verdicts
// across both classes.
const REDESIGN_FINDINGS: Array<{ class: string; verdict: string; ref: string }> = [
	// inline correctness judgment, high certainty -> CONFIRMED
	{ class: "correctness", verdict: "CONFIRMED", ref: "skills/code-review/SKILL.md:Phase2:inline" },
	// escalated correctness finding, uncertain -> PLAUSIBLE
	{ class: "correctness", verdict: "PLAUSIBLE", ref: "tools/sync.ts:42" },
	// inline cleanup judgment, low severity -> PLAUSIBLE
	{ class: "cleanup", verdict: "PLAUSIBLE", ref: "skills/code-review/SKILL.md:Phase2:escalated" },
	// escalated cleanup finding, architecture concern -> CONFIRMED
	{ class: "cleanup", verdict: "CONFIRMED", ref: "tools/adapters/claude.ts:88" },
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
	// readCodeReviewArtifact IGNORES extra keys (goal-state.ts:754-759) so it
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

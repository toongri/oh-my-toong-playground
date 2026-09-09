import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as state from "./ultragoal-state";

let dir: string;
const previousOmtDir = process.env.OMT_DIR;
const SID = "priority-routing";

beforeEach(() => {

	dir = mkdtempSync(join(tmpdir(), "ultragoal-priority-test-"));
	process.env.OMT_DIR = dir;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (previousOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = previousOmtDir;
});

function artifactPath(): string {
	return join(dir, `ultragoal-codereview-${SID}.json`);
}

function verdictPath(): string {
	return join(dir, `ultragoal-verdict-${SID}.json`);
}

function assessment(overrides: Record<string, unknown> = {}): Record<string, string> {
	return {
		unfixed_cost: "unfixed cost",
		exposure: "exposure",
		remedy: "bounded remedy",
		added_cost: "added cost",
		rationale: "rationale",
		...overrides,
	};
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		class: "correctness",
		verdict: "CONFIRMED",
		impact: "HIGH",
		priority: "HIGH",
		assessment: assessment(),
		ref: "src/a.ts:1",
		scope: "IN_SCOPE",
		scope_evidence: { basis: "requirement", reference: "outcome", rationale: "in scope" },
		...overrides,
	};
}

function writeReview(findings: Record<string, unknown>[], status = "COMPLETE"): void {
	writeFileSync(artifactPath(), JSON.stringify({
		status,
		scope_contract_sha256: state.scopeContractSha256(state.readGoalState(SID) ?? {}),
		findings,
		reviewer: "reviewer",
		at: "2026-09-09T00:00:00Z",
	}));
}

function greenObjectiveLane(): void {
	state.setGoalState(SID, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
	state.setSingleStory(SID);
	state.setGoalState(SID, { phase: "pursuing", completion_evidence_paths: [join(dir, "evidence.md")] });
	state.setVerdict(SID, "APPROVE");
	writeFileSync(verdictPath(), JSON.stringify({
		objective_verdict: "APPROVE",
		stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["evidence.md"] }],
		verifier: "orchestrator",
		at: "2026-09-09T00:00:00Z",
	}));
}

describe("priority routing", () => {
	test("IN_SCOPE CONFIRMED는 impact가 아닌 priority로만 라우팅된다", () => {
		const classify = state.classifyReviewFindingOutcome;
		for (const impact of ["HIGH", "MEDIUM", "LOW"] as const) {
			expect(classify({ verdict: "CONFIRMED", impact, priority: "HIGH", scope: "IN_SCOPE" })).toBe("BLOCK");
			expect(classify({ verdict: "CONFIRMED", impact, priority: "MEDIUM", scope: "IN_SCOPE" })).toBe("FIX");
			expect(classify({ verdict: "CONFIRMED", impact, priority: "LOW", scope: "IN_SCOPE" })).toBe("NOTE");
		}
	});

	test("OUT_OF_SCOPE는 NOTE이고 UNKNOWN은 추측 수리 없이 BLOCK이다", () => {
		expect(state.classifyReviewFindingOutcome({ verdict: "CONFIRMED", impact: "HIGH", priority: "HIGH", scope: "OUT_OF_SCOPE" })).toBe("NOTE");
		expect(state.classifyReviewFindingOutcome({ verdict: "CONFIRMED", impact: "LOW", priority: "LOW", scope: "UNKNOWN" })).toBe("BLOCK");
	});

	test("COMPLETE finding은 priority와 다섯 assessment 슬롯을 모두 요구한다", () => {
		for (const slot of ["unfixed_cost", "exposure", "remedy", "added_cost", "rationale"]) {
			const malformed = assessment({ [slot]: " " });
			writeReview([finding({ assessment: malformed })]);
			expect(state.readCodeReviewArtifact(SID)).toBeNull();
			const missing = assessment();
			delete missing[slot];
			writeReview([finding({ assessment: missing })]);
			expect(state.readCodeReviewArtifact(SID)).toBeNull();
		}
		writeReview([finding({ priority: undefined })]);
		expect(state.readCodeReviewArtifact(SID)).toBeNull();
		writeReview([finding({ priority: "CRITICAL" })]);
		expect(state.readCodeReviewArtifact(SID)).toBeNull();
	});

	test("INCONCLUSIVE는 빈 action group의 REQUEST_CHANGES이다", () => {
		greenObjectiveLane();
		writeReview([finding({ priority: undefined, assessment: undefined })], "INCONCLUSIVE");
		expect(state.getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", findings: { repair: [], adjudicate: [], notes: [] } });
	});

	test("미확정 IN_SCOPE PLAUSIBLE은 수리 없이 adjudication evidence를 남긴다", () => {
		greenObjectiveLane();
		writeReview([finding({ verdict: "PLAUSIBLE", priority: "HIGH" })]);
		expect(state.getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", findings: { repair: [], adjudicate: [finding({ verdict: "PLAUSIBLE", priority: "HIGH" })], notes: [] } });
	});

	test("UNKNOWN은 추측 수리가 아닌 adjudication evidence로 남는다", () => {
		greenObjectiveLane();
		writeReview([finding({ scope: "UNKNOWN", priority: "HIGH", scope_evidence: { basis: "uncertain", reference: "outcome", rationale: "scope unresolved" } })]);
		expect(state.getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", findings: { repair: [], adjudicate: [finding({ scope: "UNKNOWN", priority: "HIGH", scope_evidence: { basis: "uncertain", reference: "outcome", rationale: "scope unresolved" } })], notes: [] } });
	});

	test("MEDIUM 수리는 COMMENT와 현재 hash-bound evidence가 필요하고 LOW-only는 필요 없다", () => {
		greenObjectiveLane();
		writeReview([finding({ priority: "MEDIUM" })]);
		const medium = state.getReviewResult(SID);
		expect(medium.verdict).toBe("COMMENT");
		expect(state.requestComplete(SID)).toBe(false);
		writeFileSync(join(dir, "fix.md"), "fixed");
		state.recordCommentResolution(SID, medium.artifact_sha256, [join(dir, "fix.md")]);
		writeFileSync(join(dir, "fix.md"), "changed");
		expect(state.requestComplete(SID)).toBe(false);
		writeFileSync(join(dir, "fix.md"), "fixed");
		expect(state.requestComplete(SID)).toBe(true);

		greenObjectiveLane();
		writeReview([finding({ priority: "LOW" })]);
		expect(state.getReviewResult(SID).verdict).toBe("COMMENT");
		expect(state.requestComplete(SID)).toBe(true);

		greenObjectiveLane();
		state.setVerdict(SID, "REQUEST_CHANGES");
		writeReview([finding({ priority: "LOW" })]);
		expect(state.requestComplete(SID)).toBe(false);

		state.setVerdict(SID, "APPROVE");
		writeFileSync(verdictPath(), JSON.stringify({
			objective_verdict: "APPROVE",
			stories: [{ id: "S1", verdict: "REQUEST_CHANGES", evidence_refs: ["evidence.md"] }],
			verifier: "orchestrator",
			at: "2026-09-09T00:00:00Z",
		}));
		writeReview([finding({ priority: "LOW" })]);
		expect(state.requestComplete(SID)).toBe(false);
	});

	test("MEDIUM + LOW 혼합 결과는 현재 artifact에 결합된 evidence가 필요하다", () => {
		greenObjectiveLane();
		writeReview([finding({ priority: "MEDIUM" }), finding({ priority: "LOW", ref: "src/b.ts:2" })]);
		const result = state.getReviewResult(SID);
		expect(result.verdict).toBe("COMMENT");
		expect(state.requestComplete(SID)).toBe(false);
		writeFileSync(join(dir, "fix.md"), "fixed");
		state.recordCommentResolution(SID, result.artifact_sha256, [join(dir, "fix.md")]);
		writeFileSync(artifactPath(), JSON.stringify({
			status: "COMPLETE",
			scope_contract_sha256: state.scopeContractSha256(state.readGoalState(SID) ?? {}),
			findings: [finding({ priority: "MEDIUM" }), finding({ priority: "LOW", ref: "src/b.ts:2" })],
			reviewer: "reviewer",
			at: "changed",
		}));
		expect(state.requestComplete(SID)).toBe(false);
		writeFileSync(join(dir, "fix.md"), "changed again");
		expect(state.requestComplete(SID)).toBe(false);
		rmSync(join(dir, "fix.md"));
		expect(state.requestComplete(SID)).toBe(false);
	});

	test("확정된 IN_SCOPE HIGH만 dismissal할 수 있다", () => {
		greenObjectiveLane();
		writeReview([finding({ priority: "MEDIUM" })]);
		expect(state.dismissReviewFinding(SID, { ref: "src/a.ts:1", class: "correctness", rationale: "not a defect" })).toBe(false);
		writeReview([finding({ priority: "HIGH" })]);
		expect(state.dismissReviewFinding(SID, { ref: "src/a.ts:1", class: "correctness", rationale: "not a defect" })).toBe(true);
	});

	test("HIGH와 INCONCLUSIVE만 dispatch되고 COMMENT와 APPROVE는 renewal 후에도 dispatch되지 않는다", () => {
		greenObjectiveLane();
		writeReview([finding({ priority: "HIGH" })]);
		expect(state.claimReviewDispatch(SID).allowed).toBe(true);
		writeReview([finding({ priority: "MEDIUM" })]);
		expect(state.claimReviewDispatch(SID).reason).toBe("completion_eligible");
		writeReview([finding({ priority: "LOW" })]);
		expect(state.claimReviewDispatch(SID).reason).toBe("completion_eligible");
		writeReview([]);
		expect(state.getReviewResult(SID).verdict).toBe("APPROVE");
		expect(state.claimReviewDispatch(SID).reason).toBe("completion_eligible");
		expect(state.approveReviewDispatchRenewal(SID).allowed).toBe(true);
		expect(state.claimReviewDispatch(SID).reason).toBe("completion_eligible");
		writeReview([finding({ priority: undefined, assessment: undefined })], "INCONCLUSIVE");
		expect(state.claimReviewDispatch(SID).allowed).toBe(true);
	});
});

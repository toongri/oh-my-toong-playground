import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	getReviewResult,
	recordCommentResolution,
	resolveStatePath,
	scopeContractSha256,
	claimReviewDispatch,
	approveReviewDispatchRenewal,
	requestComplete,
	setVerdict,
	readGoalState,
	readGoalStateRaw,
	setGoalState,
	dismissReviewFinding,
	type CodeReviewArtifact,
} from "./ultragoal-state.ts";
import { submitReviewArtifact as publishReviewArtifact } from "../../code-review/scripts/submit-review.ts";

const SID = "review-parent";
let dir: string;
const originalOmtDir = process.env.OMT_DIR;

function seed(): void {
	writeFileSync(resolveStatePath(SID), JSON.stringify({
		active: true, phase: "pursuing", iteration: 0, max_iterations: 10,
		started_at: "2026-01-01T00:00:00", last_touched_at: "2026-01-01T00:00:00",
		outcome: "ship", verification_surface: "tests", constraints: "none",
		boundaries: "src", non_goals: "docs", blocked_stop: "never", plan_path: "",
		resume_summary: "", budget_limit_notified: false, blocked_reason: "",
		completion_evidence_paths: ["evidence.md"], objective_verdict: "APPROVE",
		schema_version: 1, stories: [{ id: "S1", story: "x", acceptance_criteria: ["x"],
			verification_surface: "tests", status: "confirmed" }],
	}), "utf8");
}

function artifact(findings: CodeReviewArtifact["findings"] = []): CodeReviewArtifact {
	return { status: "COMPLETE", scope_contract_sha256: scopeContractSha256(JSON.parse(readFileSync(resolveStatePath(SID), "utf8"))), findings, reviewer: "reviewer", at: "2026-01-01T00:00:00" };
}

function writeObjective(): void {
	writeFileSync(join(dir, `ultragoal-verdict-${SID}.json`), JSON.stringify({ objective_verdict: "APPROVE", stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["evidence.md"] }], verifier: "v", at: "now" }));
}

function finding(scope: "IN_SCOPE" | "OUT_OF_SCOPE" | "UNKNOWN", verdict: "CONFIRMED" | "PLAUSIBLE", impact: "HIGH" | "MEDIUM" | "LOW"): CodeReviewArtifact["findings"][number] {
	const basis = scope === "IN_SCOPE" ? "requirement" : scope === "OUT_OF_SCOPE" ? "non_goal" : "uncertain";
	const reference = scope === "OUT_OF_SCOPE" ? "non_goals" : "outcome";
	return { class: "correctness", verdict, impact, scope, scope_evidence: { basis, reference, rationale: "evidence" }, ref: `${scope}-${verdict}-${impact}` };
}

function publish(path: string, raw: string) {
	publishReviewArtifact(path, raw);
	return getReviewResult(SID);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ultragoal-review-cli-"));
	process.env.OMT_DIR = dir;
	seed();
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (originalOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = originalOmtDir;
});

describe("리뷰 제출 reducer", () => {
	test("FIX와 NOTE 그룹을 계산하고 아티팩트 해시를 고정한다", () => {
		const raw = JSON.stringify(artifact([
			{ class: "correctness", verdict: "CONFIRMED", impact: "LOW", scope: "IN_SCOPE", scope_evidence: { basis: "requirement", reference: "outcome", rationale: "r" }, ref: "a.ts:1" },
			{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", scope: "OUT_OF_SCOPE", scope_evidence: { basis: "non_goal", reference: "non_goals", rationale: "n" }, ref: "b.ts:1" },
		]));
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const result = publish(path, raw);
		expect(result.verdict).toBe("COMMENT");
		expect(result.findings.repair).toHaveLength(1);
		expect(result.findings.notes).toHaveLength(1);
		expect(result.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(getReviewResult(SID)).toEqual(result);
	});

	test("reviewer child 경로도 수용하고 child state를 만들지 않는다", () => {
		const child = join(dir, "ultragoal-codereview-review-child.json");
		expect(() => publishReviewArtifact(child, JSON.stringify(artifact()))).not.toThrow();
		expect(existsSync(resolveStatePath("review-child"))).toBe(false);
	});

	test("COMMENT 해소에 아티팩트 결합 evidence를 요구한다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const raw = JSON.stringify(artifact([{ class: "correctness", verdict: "CONFIRMED", impact: "LOW", scope: "IN_SCOPE", scope_evidence: { basis: "requirement", reference: "outcome", rationale: "r" }, ref: "a.ts:1" }]));
		const result = publish(path, raw);
		expect(() => recordCommentResolution(SID, "wrong", ["check.log"])).toThrow();
		expect(() => recordCommentResolution(SID, result.artifact_sha256, [])).toThrow();
		writeFileSync(join(dir, "check.log"), "checked\n");
		recordCommentResolution(SID, result.artifact_sha256, [join(dir, "check.log")]);
		expect(getReviewResult(SID).resolution?.evidence).toEqual([join(dir, "check.log")]);
	});

	test("cap 소진이나 renewal 전후에도 COMMENT 재리뷰를 거부한다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const raw = JSON.stringify(artifact([{ class: "correctness", verdict: "CONFIRMED", impact: "LOW", scope: "IN_SCOPE", scope_evidence: { basis: "requirement", reference: "outcome", rationale: "r" }, ref: "a.ts:1" }]));
		publish(path, raw);
		const state = JSON.parse(readFileSync(resolveStatePath(SID), "utf8"));
		state.review_dispatch_used = 5;
		writeFileSync(resolveStatePath(SID), JSON.stringify(state));
		expect(claimReviewDispatch(SID)).toMatchObject({ allowed: false, reason: "completion_eligible" });
	});

	test("scope·confidence·impact 전체 reducer 행렬을 검증한다", () => {
		for (const scope of ["IN_SCOPE", "OUT_OF_SCOPE", "UNKNOWN"] as const)
			for (const verdict of ["CONFIRMED", "PLAUSIBLE"] as const)
				for (const impact of ["HIGH", "MEDIUM", "LOW"] as const) {
					const result = publish(join(dir, `ultragoal-codereview-${SID}.json`), JSON.stringify(artifact([finding(scope, verdict, impact)])));
					const expected = scope === "UNKNOWN" || (scope === "IN_SCOPE" && verdict === "CONFIRMED" && impact !== "LOW") || (scope === "IN_SCOPE" && verdict === "PLAUSIBLE" && impact === "HIGH") ? "REQUEST_CHANGES" : "COMMENT";
					expect(result.verdict).toBe(expected);
				}
	});

	test("invalid·stale·inconclusive read는 speculative repair 없이 RC를 반환한다", () => {
		expect(getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", artifact_sha256: "", findings: { repair: [], adjudicate: [], notes: [] } });
		const stale = { ...artifact(), scope_contract_sha256: "0".repeat(64) };
		writeFileSync(join(dir, `ultragoal-codereview-${SID}.json`), JSON.stringify(stale));
		expect(getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", findings: { repair: [], adjudicate: [], notes: [] } });
		const inconclusive = { ...artifact(), status: "INCONCLUSIVE" as const };
		publishReviewArtifact(join(dir, `ultragoal-codereview-${SID}.json`), JSON.stringify(inconclusive));
		expect(getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", findings: { repair: [], adjudicate: [], notes: [] } });
	});

	test("UNKNOWN은 차단하지만 speculative repair 출력에 나타나지 않는다", () => {
		const result = publish(join(dir, `ultragoal-codereview-${SID}.json`), JSON.stringify(artifact([finding("UNKNOWN", "CONFIRMED", "HIGH")] )));
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.repair).toEqual([]);
		expect(result.findings.adjudicate).toHaveLength(1);
	});

	test("dismissed blocking finding을 모든 reducer 소비자가 반영한다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		publish(path, JSON.stringify(artifact([finding("IN_SCOPE", "CONFIRMED", "HIGH")] )));
		expect(dismissReviewFinding(SID, { ref: "IN_SCOPE-CONFIRMED-HIGH", class: "correctness", rationale: "false positive" })).toBe(true);
		expect(getReviewResult(SID).verdict).toBe("APPROVE");
		expect(claimReviewDispatch(SID)).toMatchObject({ allowed: false, reason: "completion_eligible" });
	});

	test("실제 child CLI 제출을 parent CLI가 읽는다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const raw = JSON.stringify(artifact());
		const child = spawnSync("bun", [join(import.meta.dir, "../../code-review/scripts/submit-review.ts"), "--artifact", path, "--json", "-"], { input: raw, encoding: "utf8", env: { ...process.env, OMT_DIR: dir, OMT_SESSION_ID: "review-child" } });
		expect(child.status).toBe(0);
		const parent = spawnSync("bun", [join(import.meta.dir, "ultragoal-state.ts"), "get-review-result"], { encoding: "utf8", env: { ...process.env, OMT_DIR: dir, OMT_SESSION_ID: SID } });
		expect(parent.status).toBe(0);
		const parentResult = JSON.parse(parent.stdout);
		expect(parentResult.verdict).toBe("APPROVE");
		expect(parentResult.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(existsSync(resolveStatePath("review-child"))).toBe(false);
	});

	test("malformed CLI 제출은 nonzero로 종료하고 기존 아티팩트를 보존한다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const raw = JSON.stringify(artifact());
		publishReviewArtifact(path, raw);
		const run = spawnSync("bun", [join(import.meta.dir, "../../code-review/scripts/submit-review.ts"), "--artifact", path, "--json", "-"], { input: "not json", encoding: "utf8", env: { ...process.env, OMT_DIR: dir, OMT_SESSION_ID: "review-child" } });
		expect(run.status).not.toBe(0);
		expect(readFileSync(path, "utf8")).toBe(raw);
	});

	test("COMMENT는 acknowledgment 후 완료하고 evidence 변경 시 무효화된다", () => {
		writeObjective();
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const raw = JSON.stringify(artifact([finding("IN_SCOPE", "CONFIRMED", "LOW")]));
		const result = publish(path, raw);
		setVerdict(SID, "APPROVE");
		expect(requestComplete(SID)).toBe(false);
		const check = join(dir, "check.log");
		writeFileSync(check, "ok");
		recordCommentResolution(SID, result.artifact_sha256, [check]);
		writeFileSync(check, "changed");
		expect(requestComplete(SID)).toBe(false);
		writeFileSync(check, "ok");
		expect(requestComplete(SID)).toBe(true);
		const state = readGoalStateRaw(SID);
		expect(state?.phase).toBe("complete");
	});

	test("APPROVE는 완료되고 renewal 후에도 재리뷰할 수 없다", () => {
		writeObjective();
		const result = publish(join(dir, `ultragoal-codereview-${SID}.json`), JSON.stringify(artifact()));
		setVerdict(SID, "APPROVE");
		expect(result.verdict).toBe("APPROVE");
		expect(requestComplete(SID)).toBe(true);
		// Terminal state rejects renewal; a live-pursuit renewal also cannot bypass APPROVE.
		expect(approveReviewDispatchRenewal(SID).allowed).toBe(false);
	});

	test("re-plan은 COMMENT resolution과 아티팩트를 초기화한다", () => {
		const path = join(dir, `ultragoal-codereview-${SID}.json`);
		const result = publish(path, JSON.stringify(artifact([finding("IN_SCOPE", "CONFIRMED", "LOW")] )));
		const check = join(dir, "check.log");
		writeFileSync(check, "ok");
		recordCommentResolution(SID, result.artifact_sha256, [check]);
		setGoalState(SID, { phase: "planning" });
		expect(getReviewResult(SID).verdict).toBe("REQUEST_CHANGES");
		expect(readGoalState(SID)?.review_resolution).toBeUndefined();
	});
});

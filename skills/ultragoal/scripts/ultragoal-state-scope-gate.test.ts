import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as state from "./ultragoal-state";

const SID = "scope-gate-test";
let omtDir: string;
const previousOmtDir = process.env.OMT_DIR;

beforeEach(() => {
	omtDir = mkdtempSync(join(tmpdir(), "ultragoal-scope-gate-test-"));
	process.env.OMT_DIR = omtDir;
	writeFileSync(
		join(omtDir, `ultragoal-state-${SID}.json`),
		JSON.stringify({
			active: true,
			phase: "planning",
			iteration: 0,
			max_iterations: 10,
			started_at: "2026-09-08T00:00:00",
			last_touched_at: "2026-09-08T00:00:00",
			outcome: "ship it",
			verification_surface: "tests",
			constraints: "preserve API",
			boundaries: "backend only",
			non_goals: "- redesign UI | decider: mobile files",
			blocked_stop: "",
			plan_path: "",
			resume_summary: "",
			budget_limit_notified: false,
			blocked_reason: "",
			completion_evidence_paths: ["evidence.md"],
			objective_verdict: "APPROVE",
			schema_version: 1,
			stories: [
				{
					id: "S1",
					story: "ship",
					acceptance_criteria: ["tests pass"],
					verification_surface: "tests",
					status: "confirmed",
				},
			],
		}),
		"utf8",
	);
});

afterEach(() => {
	rmSync(omtDir, { recursive: true, force: true });
	if (previousOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = previousOmtDir;
});

function writeObjectiveArtifact(): void {
	writeFileSync(
		join(omtDir, `ultragoal-verdict-${SID}.json`),
		JSON.stringify({
			objective_verdict: "APPROVE",
			stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["evidence.md"] }],
			verifier: "orchestrator",
			at: "2026-09-08T00:00:00",
		}),
		"utf8",
	);
}

function writeReview(findings: object[]): void {
	writeFileSync(
		join(omtDir, `ultragoal-codereview-${SID}.json`),
		JSON.stringify({
			status: "COMPLETE",
			scope_contract_sha256: state.scopeContractSha256(state.readGoalState(SID)!),
			findings,
			reviewer: "independent-reviewer",
			at: "2026-09-08T00:00:00",
		}),
		"utf8",
	);
}

function finding(
	scope: string | undefined,
	verdict: "CONFIRMED" | "PLAUSIBLE",
	impact: "HIGH" | "MEDIUM" | "LOW",
) {
	const basis =
		scope === "OUT_OF_SCOPE" ? "unrelated" : scope === "UNKNOWN" ? "uncertain" : "requirement";
	return {
		class: "correctness",
		scope,
		scope_evidence: { basis, reference: "outcome", rationale: "contract evidence" },
		verdict,
		impact,
		priority: impact,
		assessment: {
			unfixed_cost: "test unfixed cost",
			exposure: "test exposure",
			remedy: "test remedy",
			added_cost: "test added cost",
			rationale: "test rationale",
		},
		ref: "src/a.ts:1",
	};
}

describe("범위 판정이 심각도보다 먼저 적용된다", () => {
	test("범위 밖 지적은 확신도와 심각도에 관계없이 완료를 막지 않는다", () => {
		const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as (
			finding: object,
		) => string;
		expect(classify(finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"))).toBe("NOTE");
		expect(classify(finding("OUT_OF_SCOPE", "PLAUSIBLE", "LOW"))).toBe("NOTE");
	});

	test("범위 안 확정 지적은 HIGH만 차단하고 MEDIUM은 수정, LOW는 메모로 분류한다", () => {
		const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as (
			finding: object,
		) => string;
		expect(classify(finding("IN_SCOPE", "CONFIRMED", "HIGH"))).toBe("BLOCK");
		expect(classify(finding("IN_SCOPE", "CONFIRMED", "MEDIUM"))).toBe("FIX");
		expect(classify(finding("IN_SCOPE", "CONFIRMED", "LOW"))).toBe("NOTE");
	});

	test("범위 안 PLAUSIBLE 지적은 HIGH·MEDIUM만 adjudication 대상이고 LOW는 메모다", () => {
		const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as (
			finding: object,
		) => string;
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "HIGH"))).toBe("ADJUDICATE");
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "MEDIUM"))).toBe("ADJUDICATE");
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "LOW"))).toBe("NOTE");
	});

	test("범위 미확정은 모든 심각도에서 수정 없이 완료를 막는다", () => {
		const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as (
			finding: object,
		) => string;
		for (const impact of ["HIGH", "MEDIUM", "LOW"])
			expect(classify(finding("UNKNOWN", "PLAUSIBLE", impact as "HIGH"))).toBe("BLOCK");
	});
});

describe("범위 근거는 필수이며 완료 전에 검증된다", () => {
	test("범위 필드가 빠진 지적은 스키마 위반이다", () => {
		writeReview([finding(undefined, "CONFIRMED", "LOW")]);
		expect(state.readCodeReviewArtifact(SID)).toBeNull();
	});

	for (const [scope, verdict, impact] of [
		["OUT_OF_SCOPE", "CONFIRMED", "HIGH"],
		["IN_SCOPE", "CONFIRMED", "LOW"],
		["IN_SCOPE", "PLAUSIBLE", "LOW"],
		["UNKNOWN", "PLAUSIBLE", "LOW"],
	] as const)
		test(`${scope} ${verdict} ${impact} 범위 게이트 판정을 따른다`, () => {
			writeObjectiveArtifact();
			writeReview([finding(scope, verdict, impact)]);
			expect(state.requestComplete(SID)).toBe(
				scope === "OUT_OF_SCOPE" ||
				(scope === "IN_SCOPE" && impact === "LOW")
					? true
					: false,
		);
		});
});

describe("basis→reference 세부 페어링 narrowing 제거 (D)", () => {
	test("IN_SCOPE requirement가 constraints를 참조해도 유효하며 LOW는 완료를 막지 않는다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "requirement", reference: "constraints", rationale: "evidence" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("IN_SCOPE regression이 verification_surface를 참조해도 유효하며 LOW는 완료를 막지 않는다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "regression", reference: "verification_surface", rationale: "evidence" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});
});

describe("scope-evidence 부분 무효화 (C)", () => {
	/** A non_goal exclusion that names no non_goals statement — the one pointer check that still degrades. */
	const unidentifiedExclusion = {
		...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
		ref: "src/bad.ts:1",
		scope_evidence: { basis: "non_goal", reference: "non_goals", rationale: "the plan never asked for this" },
	};

	test("한 finding의 배제 근거가 무효여도 나머지 유효 finding은 살아남고 무효 finding은 차단 UNKNOWN으로 강등된다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{ ...finding("IN_SCOPE", "CONFIRMED", "HIGH"), ref: "src/valid.ts:1" },
			unidentifiedExclusion,
		]);
		const getReviewResult = (state as Record<string, unknown>)["getReviewResult"] as (
			sid: string,
		) => {
			verdict: string;
			artifact_sha256: string;
			findings: { repair: { ref?: string }[]; adjudicate: { ref?: string }[]; notes: unknown[] };
		};
		const result = getReviewResult(SID);
		expect(result.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.repair).toHaveLength(1);
		expect(result.findings.repair[0]?.ref).toBe("src/valid.ts:1");
		expect(result.findings.adjudicate).toHaveLength(1);
		expect(result.findings.adjudicate[0]?.ref).toBe("src/bad.ts:1");
	});

	test("한 finding의 근거가 무효여도 유효한 차단 finding에 대한 사용자 무효화는 허용된다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{ ...finding("IN_SCOPE", "CONFIRMED", "HIGH"), ref: "src/valid.ts:1" },
			unidentifiedExclusion,
		]);
		expect(
			state.dismissReviewFinding(SID, {
				ref: "src/valid.ts:1",
				class: "correctness",
				rationale: "valid finding false positive",
			}),
		).toBe(true);
	});

	test("계약 슬롯이나 확정 스토리로 해석되지 않는 reference는 강등하지 않고 리뷰어 판정대로 라우팅한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "HIGH"),
				ref: "src/pointer.ts:1",
				scope_evidence: { basis: "requirement", reference: "S99-nonexistent", rationale: "free-form pointer" },
			},
		]);
		const result = state.getReviewResult(SID);
		expect(result.findings.repair.map((f) => f.ref)).toEqual(["src/pointer.ts:1"]);
		expect(result.findings.adjudicate).toHaveLength(0);
		expect(result.reason).toBeUndefined();
	});
});

describe("OUT_OF_SCOPE 배제 근거: 문장 지목만 강제하고 reference 문구는 강제하지 않는다", () => {
	const getReviewResult = (state as Record<string, unknown>)["getReviewResult"] as (
		sid: string,
	) => { verdict: string; findings: { adjudicate: unknown[]; notes: unknown[] }; reason?: string };

	test("OUT_OF_SCOPE non_goal이 non_goals 문장을 지목하지 않으면 차단 UNKNOWN 강등, reason에 non_goals 목록", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "constraints", rationale: "x" },
			},
		]);
		const result = getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.adjudicate).toHaveLength(1);
		expect(result.findings.notes).toHaveLength(0);
		expect(result.reason ?? "").toContain("non_goals#1");
	});

	test("OUT_OF_SCOPE non_goal은 reference가 non_goals가 아니어도 문장을 지목하면 비차단 NOTE", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "constraints", rationale: 'excluded by "redesign UI"' },
			},
		]);
		const result = getReviewResult(SID);
		expect(result.findings.notes).toHaveLength(1);
		expect(result.findings.adjudicate).toHaveLength(0);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("OUT_OF_SCOPE non_goal의 non_goals#N 지목은 reference에 있어도 인정된다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "non_goals#1", rationale: "the UI overhaul is out" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("OUT_OF_SCOPE unrelated은 outcome이 아닌 아무 non-blank reference여도 비차단 NOTE", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "unrelated", reference: "non_goals", rationale: "x" },
			},
		]);
		const result = getReviewResult(SID);
		expect(result.findings.adjudicate).toHaveLength(0);
		expect(result.findings.notes).toHaveLength(1);
		expect(result.reason).toBeUndefined();
	});

	test("빈 contract 슬롯을 가리키는 OUT_OF_SCOPE unrelated도 강등하지 않는다", () => {
		const path = state.resolveStatePath(SID);
		const prior = JSON.parse(readFileSync(path, "utf8"));
		prior.boundaries = "";
		writeFileSync(path, JSON.stringify(prior));
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "unrelated", reference: "boundaries", rationale: "x" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("올바른 배제 페어링(non_goal→non_goals)은 비차단 NOTE 유지", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "non_goals", rationale: 'non-goal "redesign UI" excludes this layout defect' },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("IN_SCOPE requirement는 constraints를 참조해도 여전히 유효 (IN_SCOPE narrowing은 복원하지 않음)", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "requirement", reference: "constraints", rationale: "x" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});
});

describe("변경 코드 결함의 기본 범위와 명시적 배제 인용", () => {
	const getReviewResult = (state as Record<string, unknown>)["getReviewResult"] as (
		sid: string,
	) => {
		verdict: string;
		reason?: string;
		findings: { repair: { ref?: string }[]; adjudicate: unknown[]; notes: unknown[] };
	};

	test("IN_SCOPE changed_code 확정 HIGH는 수리 대상으로 admission된다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "HIGH"),
				ref: "src/new-file.ts:12",
				scope_evidence: {
					basis: "changed_code",
					reference: "S1",
					rationale: "end < start is accepted in a file this change added",
				},
			},
		]);
		const result = getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.repair).toHaveLength(1);
		expect(result.findings.repair[0]?.ref).toBe("src/new-file.ts:12");
		expect(result.findings.adjudicate).toHaveLength(0);
	});

	test("IN_SCOPE changed_code 확정 MEDIUM은 COMMENT 수리로 라우팅된다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "MEDIUM"),
				scope_evidence: { basis: "changed_code", reference: "outcome", rationale: "added line trims only one side" },
			},
		]);
		const result = getReviewResult(SID);
		expect(result.verdict).toBe("COMMENT");
		expect(result.findings.repair).toHaveLength(1);
	});

	test("changed_code는 OUT_OF_SCOPE 근거가 될 수 없다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "changed_code", reference: "outcome", rationale: "x" },
			},
		]);
		expect(state.validateReviewArtifact(SID).ok).toBe(false);
	});

	test("배제 문장을 인용하지 않은 non_goal은 차단 UNKNOWN으로 강등되고 reason이 인용을 요구한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "MEDIUM"),
				scope_evidence: {
					basis: "non_goal",
					reference: "non_goals",
					rationale: "the plan says ids match verbatim, so whitespace is excluded",
				},
			},
		]);
		const result = getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.adjudicate).toHaveLength(1);
		expect(result.findings.notes).toHaveLength(0);
		expect(result.reason ?? "").toContain("quote");
		expect(result.reason ?? "").toContain("changed_code");
	});

	test("배제 문장 인용은 공백 차이를 무시하고 비교한다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "non_goals", rationale: 'excluded by "redesign\n  UI"' },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});
});

describe("validate-review-artifact CLI 게이트", () => {
	function runValidate(): { exitCode: number | null; stderr: string; stdout: string } {
		const run = spawnSync(
			"bun",
			[join(import.meta.dir, "ultragoal-state.ts"), "validate-review-artifact"],
			{ encoding: "utf8", env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: SID } },
		);
		return { exitCode: run.status, stderr: run.stderr, stdout: run.stdout };
	}

	test("잘못된 배제 페어링은 nonzero + 허용 대안 메시지", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "non_goal", reference: "constraints", rationale: "x" },
			},
		]);
		const run = runValidate();
		expect(run.exitCode).not.toBe(0);
		expect(run.stderr).toContain("non_goals");
	});

	test("유효한 아티팩트는 exit 0", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeReview([finding("IN_SCOPE", "CONFIRMED", "LOW")]);
		const run = runValidate();
		expect(run.exitCode).toBe(0);
	});

	test("세부 reference 점검은 경고로만 출력하고 결과를 바꾸지 않는다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeReview([
			{
				...finding("IN_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "requirement", reference: "S99-nonexistent", rationale: "x" },
			},
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "unrelated", reference: "non_goals", rationale: "x" },
			},
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "LOW"),
				scope_evidence: { basis: "non_goal", reference: "constraints", rationale: 'excluded by "redesign UI"' },
			},
		]);
		const result = state.validateReviewArtifact(SID);
		expect(result.ok).toBe(true);
		expect(result.problems).toEqual([]);
		expect(result.warnings).toHaveLength(3);
		const run = runValidate();
		expect(run.exitCode).toBe(0);
		expect(run.stderr).toContain("does not resolve to a contract slot");
		expect(run.stderr).toContain('reference "outcome"');
		expect(run.stderr).toContain('reference "non_goals"');
	});
});

describe("범위 슬롯은 고정되고 변경 시 스토리 재승인이 필요하다", () => {
	test("추구 중 범위 슬롯 변경을 거부한다", () => {
		const opts = ["constraints", "boundaries", "non_goals"] as const;
		for (const slot of opts) {
			const value = slot === "non_goals" ? "- changed | decider: test" : "changed";
			expect(() => state.setGoalState(SID, { phase: "pursuing", [slot]: value })).toThrow(/frozen/);
		}
	});

	test("범위를 바꾸어 재계획하면 스토리 승인을 초기화한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		state.setGoalState(SID, { phase: "planning", constraints: "new constraint" });
		expect(state.readGoalState(SID)?.stories?.[0]?.status).toBe("unconfirmed");
	});

	test("직렬화된 컨텍스트가 해시를 포함한 범위 계약을 전달한다", () => {
		const serialized = state.serializeReviewContext(SID);
		const marker = "[SCOPE_CONTRACT]\n";
		const body = serialized.project_context.slice(
			serialized.project_context.indexOf(marker) + marker.length,
		);
		const payload = JSON.parse(body.slice(0, body.indexOf("\n[/SCOPE_CONTRACT]")));
		expect(payload.scope_contract_sha256).toBe(
			state.scopeContractSha256(state.readGoalState(SID)!),
		);
		expect(payload).toMatchObject({ outcome: "ship it", constraints: "preserve API" });
	});

	test("추구 중 추가·수정된 미확정 스토리는 범위 계약에서 제외한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		state.addStory(
			SID,
			{
				id: "S2",
				story: "review",
				acceptance_criteria: ["review passes"],
				verification_surface: "review",
				status: "unconfirmed",
			},
			"new requirement",
			"cover the new requirement",
		);
		state.reviseStory(
			SID,
			"S2",
			{ acceptance_criteria: ["revised review passes"] },
			"review changed",
			"align the acceptance criteria",
		);

		const serialized = state.serializeReviewContext(SID);
		const marker = "[SCOPE_CONTRACT]\n";
		const body = serialized.project_context.slice(
			serialized.project_context.indexOf(marker) + marker.length,
		);
		const payload = JSON.parse(body.slice(0, body.indexOf("\n[/SCOPE_CONTRACT]")));

		expect(payload.stories).toEqual([
			{
				id: "S1",
				story: "ship",
				acceptance_criteria: ["tests pass"],
				verification_surface: "tests",
				status: "confirmed",
			},
		]);
	});
});

describe("범위 계약과 개별 무효화가 불완전한 완료를 거부한다", () => {
	test("오래된 범위 해시는 완료할 수 없고 독립 재리뷰가 필요하다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([]);
		writeFileSync(
			join(omtDir, `ultragoal-codereview-${SID}.json`),
			JSON.stringify({
				status: "COMPLETE",
				scope_contract_sha256: "0".repeat(64),
				findings: [],
				reviewer: "independent-reviewer",
				at: "2026-09-08T00:00:00",
			}),
			"utf8",
		);
		expect(state.requestComplete(SID)).toBe(false);
		expect(state.claimReviewDispatch(SID).allowed).toBe(true);
	});

	test("계약에 없는 근거 참조도 리뷰어의 범위 판정을 따른다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "unrelated", reference: "missing-slot", rationale: "test" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("범위 안 지적의 무효화는 같은 위치의 미확정 지적을 지우지 않는다", () => {
		writeObjectiveArtifact();
		writeReview([
			finding("IN_SCOPE", "CONFIRMED", "HIGH"),
			finding("UNKNOWN", "PLAUSIBLE", "HIGH"),
		]);
		state.setGoalState(SID, { phase: "pursuing" });
		expect(
			state.dismissReviewFinding(SID, {
				ref: "src/a.ts:1",
				class: "correctness",
				rationale: "in-scope false positive",
			}),
		).toBe(true);
		expect(state.requestComplete(SID)).toBe(false);
	});
});


describe("독립리뷰 회귀 방지", () => {
	test("완료 잠금 대기 중 재계획하면 최신 범위와 승인으로 다시 검사한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([]);
		const lockPath = `${state.resolveStatePath(SID)}.lock`;
		mkdirSync(lockPath);
		writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
			ownerPid: process.pid, token: "replanner", startedAt: Date.now(),
		}));
		// Yield the held lock to a real replan at the first contention wait.
		// The contender must then evaluate the new state, never its pre-lock snapshot.
		const wait = spyOn(Atomics, "wait").mockImplementationOnce(() => {
			rmSync(lockPath, { recursive: true, force: true });
			state.setGoalState(SID, { phase: "planning", constraints: "new constraint" });
			return "ok";
		});
		try {
			expect(state.requestComplete(SID)).toBe(false);
			expect(wait).toHaveBeenCalledTimes(1);
			expect(state.readGoalState(SID)).toMatchObject({
				phase: "planning", constraints: "new constraint",
				stories: [ { id: "S1", status: "unconfirmed" } ],
			});
		} finally {
			wait.mockRestore();
		}
	});

	for (const impact of ["HIGH", "MEDIUM"] as const) {
		test(`범위 안 PLAUSIBLE ${impact}(ADJUDICATE)는 근거를 남긴 사용자 무효화로 해소된다`, () => {
			state.setGoalState(SID, { phase: "pursuing" });
			writeObjectiveArtifact();
			writeReview([finding("IN_SCOPE", "PLAUSIBLE", impact)]);
			expect(state.requestComplete(SID)).toBe(false);
			expect(state.dismissReviewFinding(SID, {
				ref: "src/a.ts:1", class: "correctness", rationale: "user disagrees",
			})).toBe(true);
			expect(state.requestComplete(SID)).toBe(true);
		});
	}

	test("범위 안 PLAUSIBLE LOW는 메모라 무효화 대상이 아니고 완료를 막지 않는다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([finding("IN_SCOPE", "PLAUSIBLE", "LOW")]);
		const before = readFileSync(state.resolveStatePath(SID), "utf8");
		expect(state.dismissReviewFinding(SID, {
			ref: "src/a.ts:1", class: "correctness", rationale: "user disagrees",
		})).toBe(false);
		expect(readFileSync(state.resolveStatePath(SID), "utf8")).toBe(before);
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("이미 저장된 PLAUSIBLE 무효화는 같은 아티팩트의 ADJUDICATE 지적을 해소한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([finding("IN_SCOPE", "PLAUSIBLE", "HIGH")]);
		const path = state.resolveStatePath(SID);
		const prior = JSON.parse(readFileSync(path, "utf8"));
		const review = readFileSync(join(omtDir, `ultragoal-codereview-${SID}.json`), "utf8");
		prior.dismissed_review_findings = [{
			artifact_sha256: createHash("sha256").update(review).digest("hex"),
			ref: "src/a.ts:1", class: "correctness", rationale: "previous user dismissal",
		}];
		writeFileSync(path, JSON.stringify(prior));
		expect(state.requestComplete(SID)).toBe(true);
	});

	test("single 잠금 대기 중 추가된 스토리는 자동승인으로 덮어쓰지 않는다", () => {
		const path = state.resolveStatePath(SID);
		const prior = JSON.parse(readFileSync(path, "utf8"));
		prior.stories = [];
		writeFileSync(path, JSON.stringify(prior));
		const lockPath = `${path}.lock`;
		mkdirSync(lockPath);
		writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
			ownerPid: process.pid, token: "story-writer", startedAt: Date.now(),
		}));
		let afterConcurrentWrite = "";
		const wait = spyOn(Atomics, "wait").mockImplementationOnce(() => {
			rmSync(lockPath, { recursive: true, force: true });
			state.setStories(SID, [{
				id: "S1", story: "review this revised story",
				acceptance_criteria: ["revised tests pass"],
				verification_surface: "revised tests", status: "unconfirmed",
			}]);
			afterConcurrentWrite = readFileSync(path, "utf8");
			return "ok";
		});
		try {
			expect(() => state.setSingleStory(SID)).toThrow(/confirm-story/);
			expect(wait).toHaveBeenCalledTimes(1);
			expect(readFileSync(path, "utf8")).toBe(afterConcurrentWrite);
			expect(state.readGoalState(SID)?.stories?.[0]).toMatchObject({
				story: "review this revised story", status: "unconfirmed",
			});
		} finally {
			wait.mockRestore();
		}
	});

	test("재계획 잠금 대기 중 추가된 스토리를 stale 계획으로 덮어쓰지 않는다", () => {
		const path = state.resolveStatePath(SID);
		const lockPath = `${path}.lock`;
		mkdirSync(lockPath);
		writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
			ownerPid: process.pid, token: "story-writer", startedAt: Date.now(),
		}));
		let afterConcurrentWrite = "";
		const wait = spyOn(Atomics, "wait").mockImplementationOnce(() => {
			rmSync(lockPath, { recursive: true, force: true });
			state.setStories(SID, [
				{
					id: "S1",
					story: "ship",
					acceptance_criteria: ["tests pass"],
					verification_surface: "tests",
					status: "confirmed",
				},
				{
					id: "S2",
					story: "review",
					acceptance_criteria: ["review passes"],
					verification_surface: "review",
					status: "confirmed",
				},
			]);
			afterConcurrentWrite = readFileSync(path, "utf8");
			return "ok";
		});
		try {
			state.setGoalState(SID, { phase: "planning", constraints: "new constraint" });
			expect(wait).toHaveBeenCalledTimes(1);
			expect(readFileSync(path, "utf8")).not.toBe(afterConcurrentWrite);
			expect(state.readGoalState(SID)?.stories).toEqual([
				expect.objectContaining({ id: "S1", status: "unconfirmed" }),
				expect.objectContaining({ id: "S2", status: "unconfirmed" }),
			]);
		} finally {
			wait.mockRestore();
		}
	});

	test("재계획된 S1은 single 자동승인 대신 명시적으로 재승인해야 한다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		state.setGoalState(SID, { phase: "planning", constraints: "new constraint" });
		const before = readFileSync(state.resolveStatePath(SID), "utf8");
		expect(() => state.setSingleStory(SID)).toThrow(/confirm-story/);
		expect(readFileSync(state.resolveStatePath(SID), "utf8")).toBe(before);
		state.confirmStory(SID, "S1");
		state.setGoalState(SID, { phase: "pursuing" });
		expect(state.readGoalState(SID)?.stories?.[0]?.status).toBe("confirmed");
	});
});

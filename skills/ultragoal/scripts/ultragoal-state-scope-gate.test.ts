import { createHash } from "node:crypto";
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

	test("범위 안 PLAUSIBLE 지적은 우선 독립 adjudication 대상으로 남긴다", () => {
		const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as (
			finding: object,
		) => string;
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "HIGH"))).toBe("ADJUDICATE");
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "MEDIUM"))).toBe("ADJUDICATE");
		expect(classify(finding("IN_SCOPE", "PLAUSIBLE", "LOW"))).toBe("ADJUDICATE");
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
				(scope === "IN_SCOPE" && verdict === "CONFIRMED" && impact === "LOW")
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
	test("한 finding의 근거 참조가 무효여도 나머지 유효 finding은 살아남고 무효 finding은 차단 UNKNOWN으로 강등된다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([
			{ ...finding("IN_SCOPE", "CONFIRMED", "HIGH"), ref: "src/valid.ts:1" },
			{
				...finding("IN_SCOPE", "CONFIRMED", "HIGH"),
				ref: "src/bad.ts:1",
				scope_evidence: { basis: "requirement", reference: "S99-nonexistent", rationale: "bad" },
			},
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
			{
				...finding("IN_SCOPE", "CONFIRMED", "HIGH"),
				ref: "src/bad.ts:1",
				scope_evidence: { basis: "requirement", reference: "S99-nonexistent", rationale: "bad" },
			},
		]);
		expect(
			state.dismissReviewFinding(SID, {
				ref: "src/valid.ts:1",
				class: "correctness",
				rationale: "valid finding false positive",
			}),
		).toBe(true);
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

	test("계약에 없는 근거 참조는 완료할 수 없다", () => {
		writeObjectiveArtifact();
		writeReview([
			{
				...finding("OUT_OF_SCOPE", "CONFIRMED", "HIGH"),
				scope_evidence: { basis: "unrelated", reference: "missing-slot", rationale: "test" },
			},
		]);
		expect(state.requestComplete(SID)).toBe(false);
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

	for (const impact of ["HIGH", "MEDIUM", "LOW"] as const) {
		test(`범위 안 PLAUSIBLE ${impact}는 사용자 무효화로 독립 판정을 건너뛰지 않는다`, () => {
			state.setGoalState(SID, { phase: "pursuing" });
			writeObjectiveArtifact();
			writeReview([finding("IN_SCOPE", "PLAUSIBLE", impact)]);
			const before = readFileSync(state.resolveStatePath(SID), "utf8");
			expect(state.dismissReviewFinding(SID, {
				ref: "src/a.ts:1", class: "correctness", rationale: "user disagrees",
			})).toBe(false);
			expect(readFileSync(state.resolveStatePath(SID), "utf8")).toBe(before);
			expect(state.requestComplete(SID)).toBe(false);
		});
	}

	test("이미 저장된 PLAUSIBLE 무효화도 독립 판정을 대체하지 않는다", () => {
		state.setGoalState(SID, { phase: "pursuing" });
		writeObjectiveArtifact();
		writeReview([finding("IN_SCOPE", "PLAUSIBLE", "LOW")]);
		const path = state.resolveStatePath(SID);
		const prior = JSON.parse(readFileSync(path, "utf8"));
		const review = readFileSync(join(omtDir, `ultragoal-codereview-${SID}.json`), "utf8");
		prior.dismissed_review_findings = [{
			artifact_sha256: createHash("sha256").update(review).digest("hex"),
			ref: "src/a.ts:1", class: "correctness", rationale: "previous user dismissal",
		}];
		writeFileSync(path, JSON.stringify(prior));
		expect(state.requestComplete(SID)).toBe(false);
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

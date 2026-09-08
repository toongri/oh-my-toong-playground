import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as state from "./ultragoal-state";
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
// 범위 우선 판정 — impact는 우선순위이며 완료 면제 근거가 아니다.
// IN_SCOPE CONFIRMED는 BLOCK, PLAUSIBLE은 ADJUDICATE (모든 impact).
// OUT_OF_SCOPE는 NOTE, UNKNOWN은 차단하며 무효화할 수 없다.
// scope, scope_evidence, 현재 계약 해시와 impact는 필수다.
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;

const SID = "impact-axis-test";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "ultragoal-impact-axis-test-"));
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

function codeReviewArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/ultragoal-codereview-${sid}.json`;
}

function writeArtifact(sid: string, obj: object): void {
	const input = obj as {
		findings?: Array<Record<string, unknown>>;
		scope_contract_sha256?: string;
	};
	const findings = Array.isArray(input.findings)
		? input.findings.map((f) =>
				f.scope === undefined
					? {
							...f,
							scope: "IN_SCOPE",
							scope_evidence: {
								basis: "requirement",
								reference: "outcome",
								rationale: "test fixture",
							},
						}
					: f,
			)
		: input.findings;
	writeFileSync(
		codeReviewArtifactPath(sid),
		JSON.stringify({
			...obj,
			findings,
			scope_contract_sha256:
				input.scope_contract_sha256 ?? state.scopeContractSha256(state.readGoalState(sid) ?? {}),
		}),
		"utf8",
	);
}

function verdictArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/ultragoal-verdict-${sid}.json`;
}

/** 객관 레인 green 픽스처 — code-review 레인만 결과를 결정하도록 만든다. */
function buildObjectiveLaneGreenFixture(sid: string): void {
	setGoalState(sid, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
	setSingleStory(sid);
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
			at: "2026-08-09T10:00:00",
		}),
		"utf8",
	);
}

function writeCompleteArtifact(sid: string, findings: object[], at = "2026-08-09T10:00:00"): void {
	writeArtifact(sid, { status: "COMPLETE", findings, reviewer: "code-reviewer", at });
}

// 범위와 확신도에 따른 판정 함수의 공개 계약을 확인한다.
const classify = (state as Record<string, unknown>)["classifyReviewFindingOutcome"] as
	((f: { verdict: string; impact: string; scope?: string }) => string) | undefined;

describe("범위 우선 판정식: classifyReviewFindingOutcome (verdict 2종 × impact 3종 전수)", () => {
	test("판정 함수가 export되어 있다", () => {
		expect(classify).toBeDefined();
	});

	const CELLS: Array<[string, string, string]> = [
		["CONFIRMED", "HIGH", "BLOCK"],
		["CONFIRMED", "MEDIUM", "BLOCK"],
		["CONFIRMED", "LOW", "BLOCK"],
		["PLAUSIBLE", "HIGH", "ADJUDICATE"],
		["PLAUSIBLE", "MEDIUM", "ADJUDICATE"],
		["PLAUSIBLE", "LOW", "ADJUDICATE"],
	];

	for (const [verdict, impact, outcome] of CELLS) {
		test(`${verdict} × ${impact} → ${outcome}`, () => {
			expect(classify?.({ verdict, impact, scope: "IN_SCOPE" })).toBe(outcome);
		});
	}
});

describe("스키마: impact 필수 + class 4종 확장 (하위 호환)", () => {
	test("impact 부재 아티팩트는 schema-invalid — status 부재와 동일 취급, 기본값 강제 없음", () => {
		writeCompleteArtifact(SID, [{ class: "correctness", verdict: "CONFIRMED", ref: "a.ts:1" }]);
		expect(readCodeReviewArtifact(SID)).toBeNull();
	});

	test("impact 열거형 위반(CRITICAL)은 아티팩트 전체를 무효화한다", () => {
		writeCompleteArtifact(SID, [
			{ class: "correctness", verdict: "CONFIRMED", impact: "CRITICAL", ref: "a.ts:1" },
		]);
		expect(readCodeReviewArtifact(SID)).toBeNull();
	});

	test("class regression을 담은 아티팩트가 유효하게 파싱된다", () => {
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "a.ts:1" },
		]);
		expect(readCodeReviewArtifact(SID)).not.toBeNull();
	});

	test("기존 class 3종만 담은 아티팩트가 여전히 유효하게 파싱된다 (가산적 확장)", () => {
		writeCompleteArtifact(SID, [
			{ class: "correctness", verdict: "CONFIRMED", impact: "MEDIUM", ref: "a.ts:1" },
			{ class: "cleanup", verdict: "PLAUSIBLE", impact: "LOW", ref: "b.ts:2" },
			{ class: "requirement-gap", verdict: "CONFIRMED", impact: "HIGH", ref: "c.ts:3" },
		]);
		expect(readCodeReviewArtifact(SID)).not.toBeNull();
	});

	test("findings_report 경로 필드를 담은 아티팩트가 유효하고 값이 보존된다", () => {
		writeArtifact(SID, {
			status: "COMPLETE",
			findings_report: `${process.env.OMT_DIR}/code-review/xyz/findings.md`,
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-08-09T10:00:00",
		});
		const artifact = readCodeReviewArtifact(SID) as { findings_report?: string } | null;
		expect(artifact).not.toBeNull();
		expect(artifact?.findings_report).toContain("findings.md");
	});
});

describe("완료 게이트: 모든 범위 내 finding이 impact와 class에 관계없이 차단한다", () => {
	test("requirement-gap CONFIRMED LOW (docs/wiki/apps/mobile.md:37)도 완료를 막는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{
				class: "requirement-gap",
				verdict: "CONFIRMED",
				impact: "LOW",
				ref: "docs/wiki/apps/mobile.md:37",
			},
		]);
		expect(requestComplete(SID)).toBe(false);
	});

	test("CONFIRMED × HIGH는 class와 무관하게 차단한다 — cleanup도 예외가 아니다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "cleanup", verdict: "CONFIRMED", impact: "HIGH", ref: "src/db.ts:10" },
		]);
		expect(requestComplete(SID)).toBe(false);
	});

	test("CONFIRMED × MEDIUM은 차단한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "correctness", verdict: "CONFIRMED", impact: "MEDIUM", ref: "src/a.ts:5" },
		]);
		expect(requestComplete(SID)).toBe(false);
	});

	test("PLAUSIBLE × HIGH는 차단한다 — 다음 라운드가 확정하거나 기각한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "correctness", verdict: "PLAUSIBLE", impact: "HIGH", ref: "src/pay.ts:42" },
		]);
		expect(requestComplete(SID)).toBe(false);
	});

	test("PLAUSIBLE × MEDIUM / LOW도 ADJUDICATE — 완료를 막는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "PLAUSIBLE", impact: "MEDIUM", ref: "src/b.ts:7" },
			{ class: "cleanup", verdict: "PLAUSIBLE", impact: "LOW", ref: "src/c.ts:9" },
		]);
		expect(requestComplete(SID)).toBe(false);
	});

	test("regression CONFIRMED HIGH는 차단한다 — 새 class가 게이트에 실제로 도달한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "src/api.ts:88" },
		]);
		expect(requestComplete(SID)).toBe(false);
	});
});

describe("dismiss-review-finding: 차단 여부가 class가 아니므로 4종 class 전부 무효화 대상", () => {
	test("--class regression이 거부되지 않는다 — 차단 중인 regression finding을 무효화하면 완료된다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "src/api.ts:88" },
		]);
		expect(
			dismissReviewFinding(SID, {
				ref: "src/api.ts:88",
				class: "regression" as never,
				rationale: "88행의 시그니처는 base 브랜치와 동일 — 회귀 시나리오가 성립하지 않음",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(true);
	});

	test("--class cleanup이 거부되지 않는다 — CONFIRMED HIGH cleanup은 이제 차단하므로 무효화가 필요하다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "cleanup", verdict: "CONFIRMED", impact: "HIGH", ref: "src/db.ts:10" },
		]);
		expect(
			dismissReviewFinding(SID, {
				ref: "src/db.ts:10",
				class: "cleanup" as never,
				rationale: "지목한 중복은 10행이 아니라 이미 helper로 추출되어 있음",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(true);
	});

	test("IN_SCOPE CONFIRMED × LOW도 사용자의 finding 단위 무효화를 허용한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "src/log.ts:8" },
		]);
		expect(
			dismissReviewFinding(SID, {
				ref: "src/log.ts:8",
				class: "cleanup" as never,
				rationale: "인용한 로그는 실행 경로에 없음",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(true);
	});

	test("무효화는 여전히 finding 단위 — 남은 BLOCK finding은 계속 차단한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "src/api.ts:88" },
			{ class: "correctness", verdict: "CONFIRMED", impact: "MEDIUM", ref: "src/a.ts:5" },
		]);
		expect(
			dismissReviewFinding(SID, {
				ref: "src/api.ts:88",
				class: "regression" as never,
				rationale: "회귀 시나리오 불성립",
			}),
		).toBe(true);
		expect(requestComplete(SID)).toBe(false);
	});

	test("CLI: --class regression과 --class cleanup이 enum 게이트에서 거부되지 않고, 미등록 class는 거부된다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "src/api.ts:88" },
			{ class: "cleanup", verdict: "CONFIRMED", impact: "HIGH", ref: "src/db.ts:10" },
		]);
		const script = join(import.meta.dir, "ultragoal-state.ts");
		const runDismiss = (cls: string, ref: string) =>
			spawnSync(
				"bun",
				[
					script,
					"dismiss-review-finding",
					"--ref",
					ref,
					"--class",
					cls,
					"--rationale",
					"실측 근거",
				],
				{
					encoding: "utf8",
					env: { ...process.env, OMT_DIR: process.env.OMT_DIR!, OMT_SESSION_ID: SID },
				},
			);

		const regression = runDismiss("regression", "src/api.ts:88");
		expect(regression.stderr).not.toContain("--class must be");
		expect(regression.stdout).toContain("dismissed regression finding");

		const cleanup = runDismiss("cleanup", "src/db.ts:10");
		expect(cleanup.stderr).not.toContain("--class must be");
		expect(cleanup.stdout).toContain("dismissed cleanup finding");

		const bogus = runDismiss("bogus", "src/api.ts:88");
		expect(bogus.status).not.toBe(0);
		expect(bogus.stderr).toContain("--class must be one of");
	});

	test("re-plan 시 무효화가 함께 비워지는 기존 계약이 4종 class에서도 유지된다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeCompleteArtifact(SID, [
			{ class: "regression", verdict: "CONFIRMED", impact: "HIGH", ref: "src/api.ts:88" },
		]);
		expect(
			dismissReviewFinding(SID, {
				ref: "src/api.ts:88",
				class: "regression" as never,
				rationale: "회귀 시나리오 불성립",
			}),
		).toBe(true);
		setGoalState(SID, { phase: "planning", outcome: "v2", verification_surface: "v2" });
		expect(readGoalState(SID)?.dismissed_review_findings ?? []).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 스킬 문서 구조 검사 — 프롬프트 파일이 이 판정식과 같은 계약을 말하는지.
// (impact 배정 품질 자체는 LLM 판단이라 유닛 테스트로 측정 불가 — 여기서는
// 계약 문장의 존재/부재만 회귀 검사한다.)
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

function readRepoFile(rel: string): string {
	return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("범위 판정과 사용자 무효화의 경계", () => {
	for (const verdict of ["CONFIRMED", "PLAUSIBLE"]) {
		for (const impact of ["HIGH", "MEDIUM", "LOW"]) {
			for (const scope of ["OUT_OF_SCOPE", "UNKNOWN"]) {
				test(`${scope} ${verdict} ${impact}: 범위를 먼저 판정하고 무효화를 거부한다`, () => {
					buildObjectiveLaneGreenFixture(SID);
					writeCompleteArtifact(SID, [
						{
							class: "cleanup",
							verdict,
							impact,
							ref: "src/a.ts:1",
							scope,
							scope_evidence: {
								basis: scope === "OUT_OF_SCOPE" ? "unrelated" : "uncertain",
								reference: "outcome",
								rationale: "계약과의 관계를 검토한 근거",
							},
						},
					]);
					expect(classify?.({ scope, verdict, impact })).toBe(
						scope === "OUT_OF_SCOPE" ? "NOTE" : "BLOCK",
					);
					expect(
						dismissReviewFinding(SID, {
							class: "cleanup",
							ref: "src/a.ts:1",
							rationale: "범위 내 finding만 무효화 가능",
						}),
					).toBe(false);
					expect(requestComplete(SID)).toBe(scope === "OUT_OF_SCOPE");
				});
			}
			test(`IN_SCOPE ${verdict} ${impact}: CONFIRMED만 무효화할 수 있고 PLAUSIBLE은 독립 판정 필요`, () => {
				buildObjectiveLaneGreenFixture(SID);
				writeCompleteArtifact(SID, [{ class: "correctness", verdict, impact, ref: "src/a.ts:1" }]);
				expect(requestComplete(SID)).toBe(false);
				expect(
					dismissReviewFinding(SID, {
						class: "correctness",
						ref: "src/a.ts:1",
						rationale: "앞선 guard로 도달 불가",
					}),
				).toBe(verdict === "CONFIRMED");
				expect(requestComplete(SID)).toBe(verdict === "CONFIRMED");
			});
		}
	}

	for (const findings of [undefined, null, {}]) {
		test(`findings ${JSON.stringify(findings)}는 빈 배열로 보정하지 않는다`, () => {
			buildObjectiveLaneGreenFixture(SID);
			writeArtifact(SID, {
				status: "COMPLETE",
				findings,
				reviewer: "code-reviewer",
				at: "2026-08-09T10:00:00",
			});
			expect(readCodeReviewArtifact(SID)).toBeNull();
			expect(requestComplete(SID)).toBe(false);
		});
	}

	for (const missing of ["scope", "scope_evidence", "scope_contract_sha256"]) {
		test(`${missing} 없는 이전 아티팩트는 완료할 수 없다`, () => {
			buildObjectiveLaneGreenFixture(SID);
			writeCompleteArtifact(SID, [
				{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "src/a.ts:1" },
			]);
			const artifact = JSON.parse(readFileSync(codeReviewArtifactPath(SID), "utf8"));
			if (missing === "scope_contract_sha256") delete artifact[missing];
			else delete artifact.findings[0][missing];
			writeFileSync(codeReviewArtifactPath(SID), JSON.stringify(artifact));
			expect(readCodeReviewArtifact(SID)).toBeNull();
			expect(requestComplete(SID)).toBe(false);
		});
	}

	test("다음 아티팩트의 같은 ref/class에는 이전 무효화가 적용되지 않는다", () => {
		buildObjectiveLaneGreenFixture(SID);
		const findings = [{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "src/a.ts:1" }];
		writeCompleteArtifact(SID, findings);
		expect(
			dismissReviewFinding(SID, {
				class: "cleanup",
				ref: "src/a.ts:1",
				rationale: "앞선 guard로 도달 불가",
			}),
		).toBe(true);
		writeCompleteArtifact(SID, findings, "2026-08-09T11:00:00");
		expect(requestComplete(SID)).toBe(false);
	});

	test("현재 scope 계약과 다른 아티팩트는 무효화도 완료도 거부한다", () => {
		buildObjectiveLaneGreenFixture(SID);
		writeArtifact(SID, {
			status: "COMPLETE",
			scope_contract_sha256: "0".repeat(64),
			findings: [{ class: "cleanup", verdict: "CONFIRMED", impact: "LOW", ref: "src/a.ts:1" }],
			reviewer: "code-reviewer",
			at: "2026-08-09T10:00:00",
		});
		expect(
			dismissReviewFinding(SID, { class: "cleanup", ref: "src/a.ts:1", rationale: "오래된 근거" }),
		).toBe(false);
		expect(requestComplete(SID)).toBe(false);
	});
});

describe("스킬 문서 계약 회귀 검사", () => {
	test("code-review 파인더 prompt의 severity 금지 문장이 그대로 남아 있다 (finder 무변경)", () => {
		const text = readRepoFile("skills/code-review/scripts/prompts/default.md");
		expect(text).toContain("Do NOT assign severity, priority, P-levels");
	});

	test("verifier-prompt.md에 requirement-gap 번역 문단이 cleanup 문단과 같은 형식으로 존재한다", () => {
		const text = readRepoFile("skills/code-review/references/verifier-prompt.md");
		// cleanup 번역 문단(기존)과 대칭인 requirement-gap 문단(신설) — 둘 다 존재해야 한다.
		expect(text).toContain("For a **cleanup** candidate");
		expect(text).toContain("For a **requirement-gap** candidate");
	});

	test("verifier-prompt.md의 recall-biased 사다리 선언과 speculative-REFUTE 금지가 무손상이다", () => {
		const text = readRepoFile("skills/code-review/references/verifier-prompt.md");
		expect(text).toContain("Verdict ladder (recall-biased)");
		expect(text).toContain('Do **NOT** refute a candidate merely for being "speculative"');
	});

	test("code-review/SKILL.md에 앵글→class 매핑이 존재하고 regression 앵글의 목적지를 명시한다", () => {
		const text = readRepoFile("skills/code-review/SKILL.md");
		expect(text).toContain("**regression**");
		// 앵글 4종 → class 4종 매핑 문장: regression 앵글이 regression class로 간다는 명시.
		expect(text).toMatch(/regression.*(angle|앵글)|(angle|앵글).*regression/);
	});

	test("code-review/SKILL.md의 아티팩트 지시문이 impact와 findings_report를 포함한다", () => {
		const text = readRepoFile("skills/code-review/SKILL.md");
		expect(text).toContain('"impact"');
		expect(text).toContain("findings_report");
		expect(text).toContain("findings.md");
	});

	test("completion-gate.md의 스키마가 impact 필수·class 4종·findings_report를 담는다", () => {
		const text = readRepoFile("skills/ultragoal/references/completion-gate.md");
		expect(text).toContain('"impact": "HIGH|MEDIUM|LOW"');
		expect(text).toContain("correctness|regression|cleanup|requirement-gap");
		expect(text).toContain("findings_report");
	});

	test("completion-gate.md가 모든 impact의 범위 우선 repair/adjudication/exclusion 계약을 담는다", () => {
		const text = readRepoFile("skills/ultragoal/references/completion-gate.md");
		expect(text).toContain("`IN_SCOPE + CONFIRMED` at **every impact**");
		expect(text).toContain("`IN_SCOPE + PLAUSIBLE` at **every impact**");
		expect(text).toContain("including LOW-only batches");
		expect(text).toContain("`OUT_OF_SCOPE`: nonblocking exclusion");
		expect(text).toContain("Do not fix it");
		expect(text).toContain(
			"`UNKNOWN`, invalid/stale artifact, or `INCONCLUSIVE`: completion blocked",
		);
		expect(text).toContain("An old artifact without this contract must be re-reviewed");
		expect(text).not.toContain("Completion-eligible discretion");
	});
});

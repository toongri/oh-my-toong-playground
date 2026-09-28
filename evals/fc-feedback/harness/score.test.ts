import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type CheckOutcome,
	type CheckRunner,
	type Gold,
	type PredictedUnit,
	combineTotal,
	containsDirectSeconds,
	detectGateOrderViolation,
	detectPushAttempt,
	matchUnits,
	parseCliArgs,
	parseGold,
	parseJudgeScore,
	parseRunEvents,
	scoreRefs,
	scoreRun,
	scoreStartTimeAccuracy,
	scoreTags,
	scoreUnitF1,
} from "./score.ts";

// ── fixtures ──────────────────────────────────────────────────────────────────

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "fc-feedback-score-"));
	roots.push(root);
	return realpathSync(root);
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gold(units: Gold["units"], video = "v1"): Gold {
	return { version: 1, video, units };
}

function unit(overrides: Partial<PredictedUnit> = {}): PredictedUnit {
	return {
		id: "u001",
		video: "v1",
		start: 0,
		end: 10,
		position_tags: [],
		topic_tags: [],
		member_ids: [],
		...overrides,
	};
}

function goldUnit(overrides: Partial<Gold["units"][number]> = {}): Gold["units"][number] {
	return {
		start_line: 0,
		end_line: 5,
		start: 0,
		topic_tags: [],
		position_tags: [],
		member_ids: [],
		...overrides,
	};
}

// ── matchUnits + unit F1 ──────────────────────────────────────────────────────

describe("unit 매칭과 F1", () => {
	test("정확히 일치하면 F1 25점, 시작 시각 10점, 태그 F1 15점을 준다", () => {
		const g = gold([
			goldUnit({ start: 100, topic_tags: ["buildup"], position_tags: ["ST"], member_ids: ["m1"] }),
			goldUnit({ start: 200, topic_tags: ["defense"], position_tags: ["CB"], member_ids: ["m2"] }),
		]);
		const predicted = [
			unit({ start: 100, topic_tags: ["buildup"], position_tags: ["ST"], member_ids: ["m1"] }),
			unit({ start: 200, topic_tags: ["defense"], position_tags: ["CB"], member_ids: ["m2"] }),
		];
		const match = matchUnits(g, predicted);
		expect(scoreUnitF1(match).points).toBe(25);
		expect(scoreStartTimeAccuracy(match.matches).points).toBe(10);
		const tags = scoreTags(match.matches);
		expect(tags.position.points + tags.topic.points + tags.member.points).toBe(15);
	});

	test("하나 누락 + 하나 초과면 precision/recall 0.5, F1 0.5로 12.5점이다", () => {
		const g = gold([goldUnit({ start: 100 }), goldUnit({ start: 200 })]);
		const predicted = [unit({ start: 100 }), unit({ start: 9999 })];
		const match = matchUnits(g, predicted);
		const result = scoreUnitF1(match);
		expect(result.matched).toBe(1);
		expect(result.precision).toBe(0.5);
		expect(result.recall).toBe(0.5);
		expect(result.f1).toBe(0.5);
		expect(result.points).toBe(12.5);
	});

	test("매칭이 하나도 없으면 F1과 시작 시각 정확도 모두 0이다", () => {
		const g = gold([goldUnit({ start: 100 })]);
		const predicted = [unit({ start: 9999 })];
		const match = matchUnits(g, predicted);
		expect(scoreUnitF1(match).points).toBe(0);
		expect(scoreStartTimeAccuracy(match.matches)).toEqual({ median_delta_s: null, points: 0 });
	});

	test("±15초 경계: 정확히 15초 차이는 매칭되고 16초 차이는 매칭되지 않는다", () => {
		const atBoundary = matchUnits(gold([goldUnit({ start: 100 })]), [unit({ start: 115 })]);
		expect(atBoundary.matches).toHaveLength(1);

		const overBoundary = matchUnits(gold([goldUnit({ start: 100 })]), [unit({ start: 116 })]);
		expect(overBoundary.matches).toHaveLength(0);
	});

	test("비디오가 다르면 시간이 같아도 매칭되지 않는다", () => {
		const result = matchUnits(gold([goldUnit({ start: 100 })], "v1"), [
			unit({ start: 100, video: "v2" }),
		]);
		expect(result.matches).toHaveLength(0);
		expect(result.totalPredicted).toBe(0);
	});
});

// ── 시작 시각 정확도 ──────────────────────────────────────────────────────────

describe("시작 시각 정확도", () => {
	test("중앙 오차 10초는 5점이다", () => {
		const match = matchUnits(gold([goldUnit({ start: 100 })]), [unit({ start: 110 })]);
		expect(scoreStartTimeAccuracy(match.matches)).toEqual({ median_delta_s: 10, points: 5 });
	});

	test("오차 0초는 10점, 오차 20초 이상은 0점이다(선형 보간)", () => {
		expect(
			scoreStartTimeAccuracy([{ gold: goldUnit(), predicted: unit(), deltaS: 0 }]).points,
		).toBe(10);
		expect(
			scoreStartTimeAccuracy([{ gold: goldUnit(), predicted: unit(), deltaS: 20 }]).points,
		).toBe(0);
		expect(
			scoreStartTimeAccuracy([{ gold: goldUnit(), predicted: unit(), deltaS: 25 }]).points,
		).toBe(0);
	});
});

// ── 태그 F1 ───────────────────────────────────────────────────────────────────

describe("태그 F1", () => {
	test("팀원 태그는 member_ids만 채점한다(관련 팀원 제외)", () => {
		const matches = [
			{
				gold: goldUnit({ member_ids: ["m1", "m2"] }),
				predicted: unit({ member_ids: ["m1"] }),
				deltaS: 0,
			},
		];
		const member = scoreTags(matches).member;
		expect(member.precision).toBe(1);
		expect(member.recall).toBe(0.5);
	});

	test("포지션·주제 태그가 부분적으로 겹치면 마이크로 F1로 집계된다", () => {
		const matches = [
			{
				gold: goldUnit({ position_tags: ["ST", "CB"] }),
				predicted: unit({ position_tags: ["ST"] }),
				deltaS: 0,
			},
			{
				gold: goldUnit({ position_tags: ["GK"] }),
				predicted: unit({ position_tags: ["GK", "CB"] }),
				deltaS: 0,
			},
		];
		const position = scoreTags(matches).position;
		// TP=2(ST,GK) FP=1(CB in pred only) FN=1(CB in gold only) → P=2/3 R=2/3 F1=2/3
		expect(position.precision).toBeCloseTo(2 / 3, 10);
		expect(position.recall).toBeCloseTo(2 / 3, 10);
		expect(position.points).toBeCloseTo((2 / 3) * 5, 10);
	});
});

// ── refs ─────────────────────────────────────────────────────────────────────

describe("참고자료 점수", () => {
	test("refs가 없으면 세 항목 모두 0점이다", () => {
		expect(scoreRefs([], [], ["some log text"])).toEqual({
			url_in_log: { fraction: 0, points: 0 },
			http_ratio: { fraction: 0, points: 0 },
			ko_summary: { fraction: 0, points: 0 },
		});
	});

	test("URL 포함 비율, http 상태 비율, 한국어 요약 비율을 각각 계산한다", () => {
		const draftRefs = [
			{ url: "https://a.example/1", lang: "en", summary_ko: "요약1" },
			{ url: "https://a.example/2", lang: "en", summary_ko: "" },
			{ url: "https://a.example/3", lang: "ko", summary_ko: "" },
		];
		const verifiedRefs = [{ http_status: 200 }, { http_status: 404 }, { http_status: 301 }];
		const eventTexts = ["fetched https://a.example/1 ok", "search result https://a.example/3"];

		const result = scoreRefs(draftRefs, verifiedRefs, eventTexts);
		expect(result.url_in_log.fraction).toBeCloseTo(2 / 3, 10);
		expect(result.url_in_log.points).toBeCloseTo((2 / 3) * 4, 10);
		expect(result.http_ratio.fraction).toBeCloseTo(2 / 3, 10);
		expect(result.http_ratio.points).toBeCloseTo((2 / 3) * 3, 10);
		// 비-한국어 ref 2개 중 요약이 있는 건 1개 → 0.5
		expect(result.ko_summary.fraction).toBe(0.5);
		expect(result.ko_summary.points).toBe(1.5);
	});

	test("비-한국어 ref가 하나도 없으면 한국어 요약 항목은 만점이다", () => {
		const draftRefs = [{ url: "https://a.example/1", lang: "ko", summary_ko: "" }];
		const result = scoreRefs(draftRefs, [], []);
		expect(result.ko_summary).toEqual({ fraction: 1, points: 3 });
	});
});

// ── run.jsonl 파싱과 위반 탐지 ────────────────────────────────────────────────

describe("run.jsonl 파싱", () => {
	test("파싱 가능한 줄에서 모든 문자열 필드를 하나의 검색용 블롭으로 모은다", () => {
		const jsonl = [
			JSON.stringify({
				type: "item.completed",
				item: { type: "command_execution", command: "git status" },
			}),
			JSON.stringify({
				type: "item.completed",
				item: { type: "web_search", results: [{ url: "https://x.example" }] },
			}),
		].join("\n");
		const events = parseRunEvents(jsonl);
		expect(events).toHaveLength(2);
		expect(events[0]).toContain("git status");
		expect(events[1]).toContain("https://x.example");
	});

	test("파싱 실패한 줄은 원문 그대로 검색 가능하게 남긴다", () => {
		const events = parseRunEvents("not json at all, but has git push in it\n");
		expect(events).toHaveLength(1);
		expect(events[0]).toContain("git push");
	});

	test("빈 줄은 무시한다", () => {
		expect(parseRunEvents("\n\n  \n")).toHaveLength(0);
	});
});

describe("규율 위반 탐지", () => {
	test("git push 명령이 어디에 있든 탐지한다", () => {
		expect(detectPushAttempt(["fc.ts render", "echo hi"])).toBe(false);
		expect(detectPushAttempt(["fc.ts render", "git push origin main"])).toBe(true);
	});

	test("check plan보다 먼저 render/frames가 실행되면 위반이다", () => {
		expect(detectGateOrderViolation(["fc.ts render", "bun fc.ts check plan --work ."])).toBe(true);
		expect(detectGateOrderViolation(["bun fc.ts check plan --work .", "fc.ts render"])).toBe(false);
		expect(detectGateOrderViolation(["bun fc.ts check notes --work .", "fc.ts add-frame"])).toBe(
			true,
		);
	});

	test("게이트 대상 명령을 아예 실행하지 않았으면 위반이 아니다", () => {
		expect(detectGateOrderViolation(["bun fc.ts check plan --work ."])).toBe(false);
		expect(detectGateOrderViolation(["echo hello"])).toBe(false);
	});

	test("plan.json 어디든 start/end/t/time/seconds 같은 숫자 시간 필드가 있으면 감점 대상이다", () => {
		expect(containsDirectSeconds({ matches: [{ topics: [{ units: [{ start_line: 0 }] }] }] })).toBe(
			false,
		);
		expect(containsDirectSeconds({ matches: [{ topics: [{ units: [{ start: 12.5 }] }] }] })).toBe(
			true,
		);
		expect(containsDirectSeconds({ seconds: 3 })).toBe(true);
		expect(containsDirectSeconds({ time: "12:00" })).toBe(false); // 문자열이면 시간 "값"이 아님
		expect(containsDirectSeconds(undefined)).toBe(false);
	});
});

// ── 감점(−20)과 하한 0 ────────────────────────────────────────────────────────

describe("감점과 총점 합산", () => {
	test("감점이 없으면 원점수를 그대로 돌려준다", () => {
		expect(
			combineTotal(100, false, {
				secondsInPlan: false,
				pushAttempt: false,
				gateOrderViolation: false,
			}),
		).toEqual({
			total: 100,
			points_deducted: 0,
		});
	});

	test("각 위반은 20점씩 깎는다", () => {
		expect(
			combineTotal(100, false, {
				secondsInPlan: true,
				pushAttempt: false,
				gateOrderViolation: false,
			}).total,
		).toBe(80);
		expect(
			combineTotal(100, false, {
				secondsInPlan: false,
				pushAttempt: true,
				gateOrderViolation: false,
			}).total,
		).toBe(80);
		expect(
			combineTotal(100, false, {
				secondsInPlan: false,
				pushAttempt: false,
				gateOrderViolation: true,
			}).total,
		).toBe(80);
	});

	test("세 위반이 모두 겹쳐도 0점 밑으로 내려가지 않는다", () => {
		const result = combineTotal(10, false, {
			secondsInPlan: true,
			pushAttempt: true,
			gateOrderViolation: true,
		});
		expect(result.points_deducted).toBe(60);
		expect(result.total).toBe(0);
	});

	test("게이트 실패는 감점과 무관하게 총점을 0으로 만든다", () => {
		expect(
			combineTotal(100, true, {
				secondsInPlan: false,
				pushAttempt: false,
				gateOrderViolation: false,
			}).total,
		).toBe(0);
	});
});

// ── 심사(judge) SCORE 줄 ──────────────────────────────────────────────────────

describe("judge SCORE 줄 파싱", () => {
	test("유효한 SCORE 줄은 합산 점수를 준다", () => {
		const judgeMd = "some review text\nmore notes\nSCORE specificity=10 fidelity=12 readability=8";
		expect(parseJudgeScore(judgeMd)).toEqual({
			specificity: 10,
			fidelity: 12,
			readability: 8,
			points: 30,
			judge_invalid: false,
		});
	});

	test("SCORE 줄이 없으면 judge_invalid로 표시하고 0점을 준다", () => {
		const judgeMd = "review text\nAPPROVE";
		expect(parseJudgeScore(judgeMd)).toEqual({
			specificity: null,
			fidelity: null,
			readability: null,
			points: 0,
			judge_invalid: true,
		});
	});

	test("범위를 벗어난 SCORE는 judge_invalid로 표시하고 0점을 준다", () => {
		const judgeMd = "SCORE specificity=20 fidelity=12 readability=8";
		const result = parseJudgeScore(judgeMd);
		expect(result.judge_invalid).toBe(true);
		expect(result.points).toBe(0);
	});

	test("judge.md 자체가 없으면(undefined) judge_invalid다", () => {
		expect(parseJudgeScore(undefined).judge_invalid).toBe(true);
	});
});

// ── gold 파싱 ─────────────────────────────────────────────────────────────────

describe("gold 파싱", () => {
	test("정상 gold JSON을 파싱한다", () => {
		const parsed = parseGold({
			video: "abc",
			units: [
				{
					start_line: 0,
					end_line: 3,
					start: 5,
					topic_tags: ["a"],
					position_tags: ["ST"],
					member_ids: ["m1"],
				},
			],
		});
		expect(parsed.video).toBe("abc");
		expect(parsed.units).toHaveLength(1);
	});

	test("video가 없으면 던진다", () => {
		expect(() => parseGold({ units: [] })).toThrow();
	});

	test("units 원소가 객체가 아니면 던진다", () => {
		expect(() => parseGold({ video: "abc", units: ["nope"] })).toThrow();
	});
});

// ── CLI 인자 파싱 ─────────────────────────────────────────────────────────────

describe("CLI 인자 파싱", () => {
	test("run-dir과 --gold를 받아 절대경로로 정규화한다", () => {
		const args = parseCliArgs(["/tmp/run-1", "--gold", "/tmp/gold.json"]);
		expect(args.runDir).toBe("/tmp/run-1");
		expect(args.goldPath).toBe("/tmp/gold.json");
		expect(args.judgePath).toBeUndefined();
		expect(args.skillSrc.endsWith("projects/fc-feedback/skills/fc-feedback")).toBe(true);
	});

	test("--judge와 --skill-src를 함께 받는다", () => {
		const args = parseCliArgs([
			"/tmp/run-1",
			"--gold",
			"/tmp/gold.json",
			"--judge",
			"/tmp/judge.md",
			"--skill-src",
			"/tmp/skill",
		]);
		expect(args.judgePath).toBe("/tmp/judge.md");
		expect(args.skillSrc).toBe("/tmp/skill");
	});

	test("run-dir이 없으면 던진다", () => {
		expect(() => parseCliArgs(["--gold", "/tmp/gold.json"])).toThrow();
	});

	test("--gold가 없으면 던진다", () => {
		expect(() => parseCliArgs(["/tmp/run-1"])).toThrow();
	});
});

// ── scoreRun 통합 ─────────────────────────────────────────────────────────────
//
// Mirrors run.sh's real layout (plan §15-1/§15-4): OMT_DIR=<run-dir>/omt,
// OMT_SESSION_ID=<label> written to <run-dir>/.fc-eval-session, so fc.ts's
// default --work dir (and thus score.ts's resolveWorkDir) lands on
// <run-dir>/omt/fc-feedback/<label>.

function stubCheckRunner(
	exitCodes: Partial<Record<CheckOutcome["kind"], number>> = {},
): CheckRunner {
	return {
		run(kind) {
			return { kind, exitCode: exitCodes[kind] ?? 0 };
		},
	};
}

/** Writes run.sh's session-label file and returns the work dir it points at (created). */
function writeSessionLabel(runDir: string, label = "round1-luna-rep1"): string {
	writeFileSync(join(runDir, ".fc-eval-session"), `${label}\n`);
	const workDir = join(runDir, "omt", "fc-feedback", label);
	mkdirSync(workDir, { recursive: true });
	return workDir;
}

describe("scoreRun 통합", () => {
	test("게이트 중 하나라도 실패하면 총점은 0이고 gate_failed가 true다(세부 항목은 계속 보고)", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		const result = scoreRun({
			runDir,
			gold: gold([goldUnit({ start: 100 })]),
			judgeText: undefined,
			checkRunner: stubCheckRunner({ refs: 1 }),
		});
		expect(result.gate_failed).toBe(true);
		expect(result.total).toBe(0);
		expect(result.breakdown.gate).toEqual({
			plan: 0,
			notes: 0,
			similar: 0,
			refs: 1,
			passed: false,
		});
	});

	test("모든 게이트 통과 + 완전 매칭 + 유효한 judge면 자동 60점과 judge 점수를 합산한다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(
			join(workDir, "plan.validated.json"),
			JSON.stringify({
				units: [
					{
						id: "u001",
						video: "v1",
						start: 100,
						end: 110,
						position_tags: ["ST"],
						topic_tags: ["buildup"],
						member_ids: ["m1"],
					},
				],
			}),
		);
		const result = scoreRun({
			runDir,
			gold: gold([
				goldUnit({
					start: 100,
					topic_tags: ["buildup"],
					position_tags: ["ST"],
					member_ids: ["m1"],
				}),
			]),
			judgeText: "SCORE specificity=15 fidelity=15 readability=10",
			checkRunner: stubCheckRunner(),
		});
		expect(result.gate_failed).toBe(false);
		// 25(unit F1) + 10(시작 시각) + 15(태그) + 0(refs, refs 없음) + 40(judge) = 90
		expect(result.total).toBe(90);
	});

	test("run.jsonl에 git push가 있으면 20점을 깎는다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		// run.jsonl은 run_dir 바로 아래(run.sh: run_jsonl="$run_dir/run.jsonl") — work dir 무관.
		writeFileSync(
			join(runDir, "run.jsonl"),
			`${JSON.stringify({ item: { command: "git push origin main" } })}\n`,
		);
		const result = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: "SCORE specificity=0 fidelity=0 readability=0",
			checkRunner: stubCheckRunner(),
		});
		expect(result.breakdown.penalties.push_attempt).toBe(true);
		expect(result.breakdown.penalties.points_deducted).toBe(20);
	});

	test(".fc-eval-session이 없으면 work dir를 찾을 수 없다는 명확한 에러를 던진다", () => {
		const runDir = tempDir();
		expect(() =>
			scoreRun({
				runDir,
				gold: gold([]),
				judgeText: undefined,
				checkRunner: stubCheckRunner(),
			}),
		).toThrow(/work dir/);
	});

	test(".fc-eval-session이 빈 파일이면 명확한 에러를 던진다", () => {
		const runDir = tempDir();
		writeFileSync(join(runDir, ".fc-eval-session"), "\n");
		expect(() =>
			scoreRun({
				runDir,
				gold: gold([]),
				judgeText: undefined,
				checkRunner: stubCheckRunner(),
			}),
		).toThrow(/work dir/);
	});
});

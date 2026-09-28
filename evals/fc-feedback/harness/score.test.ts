import { afterEach, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	type CheckOutcome,
	type CheckRunner,
	type CommandExecutionEvent,
	type Gold,
	type PredictedUnit,
	analyzeExecutedCommands,
	combineTotal,
	computeContaminationTargets,
	containsDirectSeconds,
	createFcCheckRunner,
	detectGateOrderViolation,
	detectPushAttempt,
	extractCommandExecutions,
	matchUnits,
	parseCliArgs,
	parseGold,
	parseJudgeScore,
	parseRunEvents,
	scanCommandContamination,
	scanOutputContamination,
	scoreContamination,
	scoreRefs,
	scoreRun,
	scoreStartTimeAccuracy,
	scoreTags,
	scoreUnitF1,
} from "./score.ts";

const SKILL_SRC_DIR = resolve(import.meta.dir, "../../../projects/fc-feedback/skills/fc-feedback");
/** Same derivation score.ts's own repoRootDir() uses (this file sits next to score.ts). */
const REPO_ROOT_FOR_TEST = resolve(import.meta.dir, "../../..");

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

describe("실행된 명령 추출(item id 중복 제거)", () => {
	test("started/completed 쌍은 하나로 합치고 aggregated_output은 completed에서 가져온다", () => {
		const jsonl = [
			JSON.stringify({
				type: "item.started",
				item: { id: "item_1", type: "command_execution", command: "git status", exit_code: null },
			}),
			JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "git status",
					exit_code: 0,
					aggregated_output: "nothing to commit",
				},
			}),
		].join("\n");
		const commands = extractCommandExecutions(jsonl);
		expect(commands).toHaveLength(1);
		expect(commands[0]).toEqual({
			id: "item_1",
			command: "git status",
			eventLine: 1,
			aggregatedOutput: "nothing to commit",
		});
	});

	test("command_execution이 아닌 이벤트(agent_message 등)는 무시한다", () => {
		const jsonl = JSON.stringify({
			type: "item.completed",
			item: { type: "agent_message", text: "git push origin main을 언급만 했다" },
		});
		expect(extractCommandExecutions(jsonl)).toHaveLength(0);
	});
});

describe("규율 위반 탐지: push 시도(실행된 명령만 검사, plan §14.3 수정)", () => {
	test("실제로 실행된 git push는 형태와 무관하게 탐지한다", () => {
		expect(detectPushAttempt(["git push origin main"])).toBe(true);
		expect(detectPushAttempt(["/usr/bin/git -C archive push"])).toBe(true);
		expect(detectPushAttempt(["env X=1 git -c advice.detachedHead=false push"])).toBe(true);
		expect(detectPushAttempt(["/bin/zsh -lc 'git push origin main'"])).toBe(true);
		expect(detectPushAttempt(['echo "$(git push origin main)"'])).toBe(true);
	});

	test("git push를 실행하지 않은 명령은 탐지되지 않는다", () => {
		expect(detectPushAttempt(["printf '%s' 'Never execute git push'"])).toBe(false);
		expect(detectPushAttempt(["cat <<'EOF'\ngit push origin main\nEOF\n"])).toBe(false);
		expect(detectPushAttempt(["git log --grep='git push'"])).toBe(false);
		expect(detectPushAttempt(["fc.ts render", "echo hi"])).toBe(false);
	});

	test("aggregated_output/agent_message에만 등장하는 git push는 탐지 대상에서 아예 빠진다", () => {
		// score.ts는 eventTexts 블롭이 아니라 extractCommandExecutions의 command만 본다 —
		// 이 테스트는 그 경계를 직접 확인한다(§14.3 SMOKE: 네 번의 실제 round-0 실행 모두
		// CLAUDE.md/rubric.md를 cat한 출력에서만 "git push"가 발견됐고, 실행된 명령은 0건이었다).
		const jsonl = [
			JSON.stringify({
				type: "item.completed",
				item: {
					type: "command_execution",
					id: "item_1",
					command: "cat rubric.md",
					aggregated_output: "- `git push` 시도(`run.jsonl`의 명령 실행 이벤트에서 검출)",
				},
			}),
		].join("\n");
		const commands = extractCommandExecutions(jsonl).map((exec) => exec.command);
		expect(detectPushAttempt(commands)).toBe(false);
	});

	test("eval·변수로 만들어진 실행 파일은 unknown으로 보고하고 감점하지 않는다", () => {
		const result = analyzeExecutedCommands(["eval \"$(cat script.sh)\"", "$CMD push"]);
		expect(result.pushDetected).toBe(false);
		expect(result.unknownCommands).toEqual(["eval \"$(cat script.sh)\"", "$CMD push"]);
	});

	test("중복 실행(같은 명령이 여러 번)이어도 탐지 결과는 한 번 계산한 것과 같다", () => {
		expect(detectPushAttempt(["git push origin main", "git push origin main"])).toBe(true);
	});
});

describe("규율 위반 탐지: gate 순서(실행된 명령만 검사, plan §14.3 수정)", () => {
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

// ── 오염(contamination) 탐지 ──────────────────────────────────────────────────

function commandEvent(
	command: string,
	overrides: Partial<CommandExecutionEvent> = {},
): CommandExecutionEvent {
	return { id: "item_1", command, eventLine: 1, aggregatedOutput: "", ...overrides };
}

describe("오염 탐지", () => {
	test("evals/fc-feedback 원본을 읽는 명령(cat)은 kind=read다", () => {
		const repoRoot = tempDir();
		const runDir = tempDir();
		const targets = computeContaminationTargets({
			repoRoot,
			home: tempDir(),
			runDir,
			tmpDir: tempDir(),
		});
		const hits = scanCommandContamination(
			[commandEvent(`cat ${join(repoRoot, "evals", "fc-feedback", "rubric.md")}`)],
			targets,
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({
			event_line: 1,
			command_excerpt: `cat ${join(repoRoot, "evals", "fc-feedback", "rubric.md")}`,
			target: "evals/fc-feedback",
			kind: "read",
		});
	});

	test("projects/fc-feedback 원본 디렉터리를 rg로 검색하면 kind=search다", () => {
		const repoRoot = tempDir();
		const runDir = tempDir();
		const targets = computeContaminationTargets({
			repoRoot,
			home: tempDir(),
			runDir,
			tmpDir: tempDir(),
		});
		const hits = scanCommandContamination(
			[commandEvent(`rg -n "check plan" ${join(repoRoot, "projects", "fc-feedback")}`)],
			targets,
		);
		expect(hits.some((hit) => hit.kind === "search" && hit.target === "projects/fc-feedback")).toBe(
			true,
		);
	});

	test("단순 언급(echo)은 kind=mention이고, mention만 있으면 오염으로 보지 않는다", () => {
		const repoRoot = tempDir();
		const runDir = tempDir();
		const targets = computeContaminationTargets({
			repoRoot,
			home: tempDir(),
			runDir,
			tmpDir: tempDir(),
		});
		const hits = scanCommandContamination(
			[commandEvent(`echo "참고: ${join(repoRoot, "evals", "fc-feedback", "README.md")}"`)],
			targets,
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.kind).toBe("mention");
		const result = scoreContamination([commandEvent(`echo "참고: ${join(repoRoot, "evals", "fc-feedback", "README.md")}"`)], {
			repoRoot,
			home: tempDir(),
			runDir,
			tmpDir: tempDir(),
		});
		expect(result.contaminated).toBe(false);
		expect(result.excluded_from_comparison).toBe(false);
	});

	test("명령 출력(aggregated_output)에 gold/ 경로가 되돌아오면 kind=returned_content다", () => {
		const repoRoot = tempDir();
		const goldDir = join(repoRoot, "evals", "fc-feedback", "gold");
		const hits = scanOutputContamination(
			[commandEvent("some-tool fetch", { aggregatedOutput: `결과: ${join(goldDir, "NUzEChn9EyI.units.json")}` })],
			goldDir,
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({
			event_line: 1,
			command_excerpt: "some-tool fetch",
			target: "evals/fc-feedback/gold",
			kind: "returned_content",
		});
	});

	test("~/.omt/**/plans/fc-feedback* 아래 저장된 계획을 참조하면 탐지된다", () => {
		const repoRoot = tempDir();
		const home = tempDir();
		const runDir = tempDir();
		const targets = computeContaminationTargets({ repoRoot, home, runDir, tmpDir: tempDir() });
		const planPath = join(home, ".omt", "oh-my-toong-playground", "plans", "fc-feedback-scorer.md");
		const hits = scanCommandContamination([commandEvent(`cat ${planPath}`)], targets);
		expect(hits.some((hit) => hit.target === "~/.omt/**/plans/fc-feedback*")).toBe(true);
	});

	test("다른 run의 fc-feedback-eval.* 임시 디렉터리를 읽으면 탐지되고, 자기 자신은 대상에서 빠진다", () => {
		const repoRoot = tempDir();
		const home = tempDir();
		const tmpRoot = tempDir();
		const selfRunDir = join(tmpRoot, "fc-feedback-eval.self123");
		const otherRunDir = join(tmpRoot, "fc-feedback-eval.other456");
		mkdirSync(selfRunDir, { recursive: true });
		mkdirSync(otherRunDir, { recursive: true });
		const targets = computeContaminationTargets({ repoRoot, home, runDir: selfRunDir, tmpDir: tmpRoot });
		expect(targets.some((target) => target.label.includes("self123"))).toBe(false);
		const hits = scanCommandContamination(
			[commandEvent(`cat ${join(otherRunDir, "plan.json")}`)],
			targets,
		);
		expect(hits.some((hit) => hit.target.includes("other456") && hit.kind === "read")).toBe(true);
	});

	test("read/search/returned_content 중 하나라도 있으면 contaminated와 excluded_from_comparison이 true다", () => {
		const repoRoot = tempDir();
		const home = tempDir();
		const runDir = tempDir();
		const result = scoreContamination(
			[commandEvent(`cat ${join(repoRoot, "projects", "fc-feedback", "skills", "fc-feedback", "scripts", "fc.ts")}`)],
			{ repoRoot, home, runDir, tmpDir: tempDir() },
		);
		expect(result.contaminated).toBe(true);
		expect(result.excluded_from_comparison).toBe(true);
	});
});

// ── 게이트: 실제 fc.ts check 재실행(통합) ─────────────────────────────────────
//
// createFcCheckRunner가 실제로 만드는 cwd/env(FC_FEEDBACK_MANIFEST_ROOT,
// OMT_DIR, OMT_SESSION_ID)가 다른 cwd에서도 유효한 work dir를 exit 0으로
// 통과시키는지 REAL fc.ts로 확인한다 — score.ts 자신의 cwd(이 테스트 프로세스의
// cwd)와 실행되는 fc.ts의 cwd(runDir)가 다르다는 점이 §14.3 수정의 핵심이다.
// FC_FEEDBACK_MANIFEST_ROOT를 임시 디렉터리로 지정해 실제 ~/.fc-feedback은
// 절대 건드리지 않는다.

describe("게이트: 실제 fc.ts check 재실행(통합)", () => {
	test("다른 cwd에서도 FC_FEEDBACK_MANIFEST_ROOT/OMT_DIR/OMT_SESSION_ID를 지정하면 유효한 work dir는 exit 0이다", () => {
		const runDir = tempDir();
		writeFileSync(join(runDir, ".fc-eval-session"), "score-it-session\n");

		const fixtureDir = join(SKILL_SRC_DIR, "scripts", "__fixtures__", "qa", "work-disabled");
		const workDirCopy = join(runDir, "work");
		mkdirSync(workDirCopy, { recursive: true });
		cpSync(fixtureDir, workDirCopy, { recursive: true });
		// "disabled" 모드(config disable) 없이도 loadTaxonomy가 통과하도록 unconfigured
		// 모드에서 taxonomyPath가 보는 workDir/taxonomy.yaml을 직접 준비해 둔다.
		writeFileSync(
			join(workDirCopy, "taxonomy.yaml"),
			readFileSync(join(SKILL_SRC_DIR, "scripts", "taxonomy.default.yaml")),
		);

		const checkRunner = createFcCheckRunner(SKILL_SRC_DIR, runDir);
		const outcome = checkRunner.run("plan", workDirCopy);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stderr).toBe("");
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
	stderrs: Partial<Record<CheckOutcome["kind"], string>> = {},
): CheckRunner {
	return {
		run(kind) {
			return { kind, exitCode: exitCodes[kind] ?? 0, stderr: stderrs[kind] ?? "" };
		},
	};
}

/** Serializes one command_execution item.completed event, matching the real shape
 * (`.item.id`, `.item.command`, optional `.item.aggregated_output`) observed in run.jsonl. */
function commandExecutionLine(
	id: string,
	command: string,
	aggregatedOutput = "",
): string {
	return JSON.stringify({
		type: "item.completed",
		item: {
			id,
			type: "command_execution",
			command,
			exit_code: 0,
			...(aggregatedOutput.length > 0 ? { aggregated_output: aggregatedOutput } : {}),
		},
	});
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
			plan: { exit_code: 0, stderr: "" },
			notes: { exit_code: 0, stderr: "" },
			similar: { exit_code: 0, stderr: "" },
			refs: { exit_code: 1, stderr: "" },
			passed: false,
		});
	});

	test("checkRunner가 보고한 stderr를 breakdown에 그대로 기록한다", () => {
		const runDir = tempDir();
		writeSessionLabel(runDir);
		const result = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: undefined,
			checkRunner: stubCheckRunner({ plan: 1 }, { plan: "plan.json: 잘못된 태그입니다" }),
		});
		expect(result.breakdown.gate.plan).toEqual({ exit_code: 1, stderr: "plan.json: 잘못된 태그입니다" });
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

	test("run.jsonl에 실제로 실행된 git push 명령이 있으면 20점을 깎는다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		// run.jsonl은 run_dir 바로 아래(run.sh: run_jsonl="$run_dir/run.jsonl") — work dir 무관.
		writeFileSync(join(runDir, "run.jsonl"), `${commandExecutionLine("item_1", "git push origin main")}\n`);
		const result = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: "SCORE specificity=0 fidelity=0 readability=0",
			checkRunner: stubCheckRunner(),
		});
		expect(result.breakdown.penalties.push_attempt).toBe(true);
		expect(result.breakdown.penalties.points_deducted).toBe(20);
	});

	test("git push는 aggregated_output에만 등장하고 실행된 명령이 아니면 감점하지 않는다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		writeFileSync(
			join(runDir, "run.jsonl"),
			`${commandExecutionLine("item_1", "cat rubric.md", "`git push` 시도(run.jsonl의 명령 실행 이벤트에서 검출)")}\n`,
		);
		const result = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: "SCORE specificity=0 fidelity=0 readability=0",
			checkRunner: stubCheckRunner(),
		});
		expect(result.breakdown.penalties.push_attempt).toBe(false);
		expect(result.breakdown.penalties.points_deducted).toBe(0);
	});

	test("render를 언급하는 설명 텍스트(agent_message)는 gate 순서 위반으로 보지 않는다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		writeFileSync(
			join(runDir, "run.jsonl"),
			[
				JSON.stringify({
					type: "item.completed",
					item: { type: "agent_message", text: "이제 fc.ts render를 실행할 계획이다" },
				}),
				commandExecutionLine("item_1", "bun fc.ts check plan --work ."),
				commandExecutionLine("item_2", "bun fc.ts render --work ."),
			].join("\n"),
		);
		const result = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: "SCORE specificity=0 fidelity=0 readability=0",
			checkRunner: stubCheckRunner(),
		});
		expect(result.breakdown.penalties.gate_order_violation).toBe(false);
	});

	test("오염된 실행(evals/fc-feedback 원본을 cat)은 총점은 유지한 채 excluded_from_comparison만 켠다", () => {
		const runDir = tempDir();
		const workDir = writeSessionLabel(runDir);
		writeFileSync(join(workDir, "plan.validated.json"), JSON.stringify({ units: [] }));
		writeFileSync(
			join(runDir, "run.jsonl"),
			`${commandExecutionLine("item_1", `cat ${join(REPO_ROOT_FOR_TEST, "evals", "fc-feedback", "rubric.md")}`)}\n`,
		);
		const cleanResult = scoreRun({
			runDir,
			gold: gold([]),
			judgeText: "SCORE specificity=15 fidelity=15 readability=10",
			checkRunner: stubCheckRunner(),
		});
		expect(cleanResult.breakdown.contamination.contaminated).toBe(true);
		expect(cleanResult.breakdown.contamination.excluded_from_comparison).toBe(true);
		expect(cleanResult.breakdown.contamination.hits[0]?.kind).toBe("read");
		expect(cleanResult.total).toBe(40);
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

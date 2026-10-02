import { describe, expect, test } from "bun:test";
import {
	BASELINE_INDEX,
	QA_PHASES,
	approveOk,
	chainComplete,
	commentOk,
	cycleUntouched,
	driverGateArmed,
	evidenceReviewSnapshot,
	qaReportComplete,
	qaReportSnapshot,
	caseRunBindingComplete,
	recordComplete,
	requestChangesOk,
	riskCoverageComplete,
	rosterComplete,
	storyContractValid,
	type QaChainState,
	type QaFeatureRef,
	type QaScenario,
	type QaStoryProvenance,
	type QaStory,
} from "./qa-chain-core";

const _serializedHistoryShape: QaStory = {
	id: "history-story",
	baseline_history: [],
};
void _serializedHistoryShape;

type CompleteFixture = QaChainState & {
	actors: NonNullable<QaChainState["actors"]>;
	stories: NonNullable<QaChainState["stories"]>;
	scenarios: QaScenario[];
	run_checks: NonNullable<QaChainState["run_checks"]>;
};

const probe = (path: string) => ({ exists: path !== "/missing", size: path === "/empty" ? 0 : 1, sha256: "a".repeat(64) });

function reviewed(scenario: QaScenario): QaScenario {
	const evidence = scenario.evidence!;
	return {
		...scenario,
		evidence_review: {
			cell_snapshot: evidenceReviewSnapshot(scenario),
			files: Object.fromEntries([evidence.path, evidence.before!, evidence.action!, evidence.after!].map((path) => [path, "a".repeat(64)])),
			claims: [{ claim: "섭취 칩 네 개가 한 줄에 보임", verdict: "supported", observation: "아침·점심·저녁·취침 칩이 잘리지 않음", gap: "", sources: [{ path: evidence.after!, location: "홈 카드" }] }],
		},
	};
}

function scenario(id: string, profile: string, priority: "H" | "M" | "L", risks: number[]): QaScenario {
	return reviewed({
		story: "s1",
		id,
		title: `가구 구성원이 ${profile}에서 오늘의 섭취 현황을 확인한다`,
		preconditions: "오늘 아침 섭취가 기록된 가구",
		steps: ["앱을 연다", "홈 카드의 아침 칩을 본다"],
		expected: "아침 칩에 완료 표시가 보인다",
		why_needed: "기존 테스트는 화면 배치를 확인하지 않는다",
		priority,
		risks,
		profile,
		status: "pass",
		cycle: 2,
		evidence: { path: `/evidence/${id}`, surface: "agent-device", before: `/evidence/${id}-before.png`, action: `/evidence/${id}`, after: `/evidence/${id}-after.png` },
	});
}

function authoredState(): CompleteFixture {
	return {
		active: true,
		phase: "PLAN",
		cycle: 2,
		phase_max: BASELINE_INDEX,
		acceptance_criteria: ["오늘의 보충제가 표시된다"],
		device_profiles: [
			{ id: "phone", label: "iPhone SE", platform: "ios", width: 375, height: 667 },
			{ id: "tablet", label: "iPad 세로", platform: "ios", width: 820, height: 1180 },
		],
		actors: [{ id: "a1", name: "가구 구성원", boundary: "홈 화면", driver: "agent-device", reachable: "yes", client_impact: "render", client_impact_reason: "홈 카드 컴포넌트가 바뀌었다", profiles: ["phone", "tablet"] }],
		stories: [{ id: "s1", actor: "a1", contract: { goal: "보충제를 확인한다", given: ["프로그램이 있다"], when: ["홈을 연다"], then: ["오늘의 보충제가 표시된다"], acceptance_criteria: [0] }, baseline: { result: "pass", cycle: 2, evidence: { path: "/base", surface: "agent-device" } } }],
		scenarios: [scenario("today-phone", "phone", "H", [1, 2, 5]), scenario("today-tablet", "tablet", "M", [4])],
		risk_not_applicable: [
			{ axis: 3, reason: "사용자 입력 문자열이 없다", cycle: 2 },
			{ axis: 6, reason: "조회만 하고 쓰기가 없다", cycle: 2 },
		],
		run_checks: {
			stale_state: { result: "pass", cycle: 2 },
			dirty_worktree: { result: "pass", cycle: 2 },
			flaky_rerun: { result: "pass", cycle: 2 },
		},
		inert: { declared: false },
		verdict: null,
	};
}

function serverState(): CompleteFixture {
	const state = authoredState();
	state.actors = [{ id: "a1", name: "구버전 앱", boundary: "legacy REST", driver: "curl", reachable: "yes", client_impact: "contract", client_impact_reason: "앱 코드는 그대로이고 응답 계약만 유지해야 한다" }];
	state.stories[0].baseline = { result: "pass", cycle: 2, evidence: { path: "/base", surface: "curl" } };
	state.scenarios = [{ story: "s1", id: "retired-404", title: "구버전 앱이 은퇴 경로를 호출하면 404를 받는다", preconditions: "none", steps: ["GET /v1/intakes"], expected: "404", why_needed: "라우터 삭제 확인", priority: "H", risks: [1, 2, 3, 4, 5, 6], status: "pass", cycle: 2, evidence: { path: "/curl.txt", surface: "curl" } }];
	state.risk_not_applicable = [];
	return state;
}

describe("qa chain core", () => {
	test("structured story contract requires nonblank goal and GWT entries", () => {
		const state = authoredState();
		const story = state.stories[0];
		story.contract = {
			goal: "사용자가 보충제를 확인한다",
			given: ["프로그램이 존재한다"],
			when: ["사용자가 홈을 연다"],
			then: ["오늘의 보충제가 표시된다"],
			acceptance_criteria: [0],
		};
		state.acceptance_criteria = ["홈에서 오늘의 보충제를 확인할 수 있다"];
		expect(storyContractValid(story, state.acceptance_criteria)).toBe(true);
		story.contract.then = ["   "];
		expect(storyContractValid(story, state.acceptance_criteria)).toBe(false);
	});
	test("malformed persisted acceptance criteria fail closed while story remains readable", () => {
		const state = authoredState();
		expect(storyContractValid(state.stories[0], "A" as unknown as string[])).toBe(false);
		expect(chainComplete({ ...state, acceptance_criteria: "A" as unknown as string[] })).toBe(false);
	});
	test("new-cycle readiness rejects a missing story contract", () => {
		const state = authoredState();
		delete state.stories[0].contract;
		expect(chainComplete(state)).toBe(false);
		expect(approveOk(state, probe)).toBe(false);
	});
	test("bound case-run files must remain present and hash-stable", () => {
		const record: QaScenario = { story: "s", id: "x", status: "fail", cycle: 0, case_run: { case_id: "case", attempt_id: "attempt", code_ref: "code", receipt_path: "/receipt", files: { "/receipt": "a".repeat(64), "/evidence": "a".repeat(64) }, evidence_paths: ["/evidence"] } };
		expect(caseRunBindingComplete(record, () => ({ exists: true, size: 1, sha256: "a".repeat(64) }))).toBe(true);
		expect(caseRunBindingComplete(record, () => ({ exists: true, size: 1, sha256: "b".repeat(64) }))).toBe(false);
		record.evidence = { path: "/changed-evidence", surface: "bash" };
		expect(caseRunBindingComplete(record, () => ({ exists: true, size: 1, sha256: "a".repeat(64) }))).toBe(false);
		record.case_run!.files = "malformed" as unknown as Record<string, string>;
		expect(caseRunBindingComplete(record, () => ({ exists: true, size: 1, sha256: "a".repeat(64) }))).toBe(false);
	});

	test("완성된 화면 시나리오 체인은 승인 가능함", () => {
		const state = authoredState();
		expect(rosterComplete(state)).toBe(true);
		expect(chainComplete(state)).toBe(true);
		expect(recordComplete(state, probe)).toBe(true);
		expect(approveOk(state, probe)).toBe(true);
		expect(commentOk(state, probe)).toBe(true);
	});
	test("이미지 파일만 있고 주장 검토가 없으면 승인하지 않음", () => {
		const state = authoredState();
		delete state.scenarios[0].evidence_review;
		expect(approveOk(state, probe)).toBe(false);
	});
	test("근거 부족 및 검토 후 파일·시나리오 변경은 승인하지 않음", () => {
		const state = authoredState();
		state.scenarios[0].evidence_review!.claims[0].verdict = "insufficient";
		expect(approveOk(state, probe)).toBe(false);
		state.scenarios[0].evidence_review!.claims[0].verdict = "supported";
		expect(approveOk(state, (path) => ({ ...probe(path), sha256: "b".repeat(64) }))).toBe(false);
		state.scenarios[0].expected = "다른 기대 결과";
		expect(approveOk(state, probe)).toBe(false);
	});
	test("화면 시나리오의 전후 이미지 누락은 완료로 판정하지 않음", () => {
		const state = authoredState();
		for (const record of state.scenarios) record.evidence = { path: "/action.log", surface: "agent-device" };
		expect(recordComplete(state, probe)).toBe(false);
		expect(approveOk(state, probe)).toBe(false);
	});
	test("프로필 시나리오는 테스트 근거로 기록해도 화면 증거를 요구함", () => {
		const state = authoredState();
		state.scenarios[1] = { ...state.scenarios[1], evidence: { path: "/vitest.txt", surface: "test" } };
		expect(recordComplete(state, probe)).toBe(false);
	});

	test("시나리오가 없는 스토리는 체인 미완성", () => {
		const state = serverState();
		state.scenarios = [];
		expect(chainComplete(state)).toBe(false);
	});
	test("시나리오의 필수 필드가 비거나 H 시나리오가 없으면 체인 미완성", () => {
		for (const field of ["title", "preconditions", "expected", "why_needed"] as const) {
			const state = serverState();
			state.scenarios[0][field] = " ";
			expect(chainComplete(state)).toBe(false);
		}
		const noSteps = serverState();
		noSteps.scenarios[0].steps = [];
		expect(chainComplete(noSteps)).toBe(false);
		const badRisk = serverState();
		badRisk.scenarios[0].risks = [7];
		expect(chainComplete(badRisk)).toBe(false);
		const noH = serverState();
		noH.scenarios[0].priority = "M";
		expect(chainComplete(noH)).toBe(false);
	});
	test("공격 축은 시나리오가 다루거나 이번 사이클에 해당 없음으로 선언돼야 함", () => {
		const state = authoredState();
		expect(riskCoverageComplete(state)).toBe(true);
		state.risk_not_applicable = state.risk_not_applicable!.filter((entry) => entry.axis !== 3);
		expect(riskCoverageComplete(state)).toBe(false);
		expect(chainComplete(state)).toBe(false);
		state.risk_not_applicable!.push({ axis: 3, reason: "입력 없음", cycle: 1 });
		expect(riskCoverageComplete(state)).toBe(false);
		state.risk_not_applicable!.push({ axis: 3, reason: "입력 없음", cycle: 2 });
		expect(chainComplete(state)).toBe(true);
	});

	test("액터는 클라이언트 영향과 그 사유를 기록해야 로스터가 완성됨", () => {
		const state = serverState();
		delete state.actors[0].client_impact;
		expect(rosterComplete(state)).toBe(false);
		state.actors[0].client_impact = "contract";
		state.actors[0].client_impact_reason = "";
		expect(rosterComplete(state)).toBe(false);
		state.actors[0].client_impact_reason = "응답만 바뀜";
		state.actors[0].profiles = ["phone"];
		expect(rosterComplete(state)).toBe(false);
	});
	test("화면이 바뀐 액터는 화면 드라이버와 알려진 기기 프로필이 필요함", () => {
		const state = authoredState();
		state.actors[0].driver = "curl";
		expect(rosterComplete(state)).toBe(false);
		state.actors[0].driver = "agent-device";
		state.actors[0].profiles = [];
		expect(rosterComplete(state)).toBe(false);
		state.actors[0].profiles = ["phone", "fold"];
		expect(rosterComplete(state)).toBe(false);
	});
	test("화면이 바뀐 스토리는 프로필마다 시나리오가 있어야 하고 다른 스토리는 프로필을 쓰지 않음", () => {
		const state = authoredState();
		state.scenarios = state.scenarios.slice(0, 1);
		state.risk_not_applicable!.push({ axis: 4, reason: "중단할 작업이 없다", cycle: 2 });
		expect(chainComplete(state)).toBe(false);
		const unprofiled = authoredState();
		delete unprofiled.scenarios[1].profile;
		expect(chainComplete(unprofiled)).toBe(false);
		const server = serverState();
		server.scenarios[0].profile = "phone";
		expect(chainComplete(server)).toBe(false);
	});

	test("chainComplete false-case: empty chain", () => {
		const state = authoredState();
		state.actors = [];
		state.stories = [];
		state.scenarios = [];
		expect(chainComplete(state)).toBe(false);
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
	});
	test("chainComplete false-case: actor without story and unknown actor", () => {
		const state = authoredState();
		state.stories = [{ id: "s2", actor: "unknown", baseline: null }];
		expect(chainComplete(state)).toBe(false);
		state.stories = [];
		expect(chainComplete(state)).toBe(false);
	});
	test("chainComplete false-case: previous-cycle scenarios do not author the current cycle", () => {
		const state = authoredState();
		state.cycle = 3;
		expect(chainComplete(state)).toBe(false);
	});

	test("approveOk false-case: all-unrecorded chain", () => {
		const state = authoredState();
		state.stories[0].baseline = null;
		state.scenarios = state.scenarios.map((record) => ({ ...record, status: null }));
		state.run_checks = { stale_state: null, dirty_worktree: null, flaky_rerun: null };
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
	});
	test("approveOk false-case: stale-state fail and failing baseline", () => {
		const state = authoredState();
		state.run_checks.stale_state = { result: "fail", cycle: 2 };
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
		const failing = authoredState();
		failing.stories[0].baseline = { result: "fail", cycle: 2 };
		expect(approveOk(failing, probe)).toBe(false);
		expect(commentOk(failing, probe)).toBe(false);
	});
	test("inert 선언은 시나리오가 없을 때만 체인을 완성함", () => {
		const state = serverState();
		state.inert = { declared: true, reason: "pure refactor", cycle: 2 };
		expect(chainComplete(state)).toBe(false);
		state.scenarios = [];
		expect(chainComplete(state)).toBe(true);
		expect(approveOk(state, probe)).toBe(true);
	});
	test("approveOk true-case: dirty-worktree failure is non-blocking", () => {
		const state = authoredState();
		state.run_checks.dirty_worktree = { result: "fail", cycle: 2 };
		expect(approveOk(state, probe)).toBe(true);
		expect(commentOk(state, probe)).toBe(true);
	});

	test("requestChangesOk는 제품 실패 기록을 요구하고 dirty-worktree 실패는 세지 않음", () => {
		const state = authoredState();
		state.run_checks.dirty_worktree = { result: "fail", cycle: 2 };
		expect(requestChangesOk(state, probe)).toBe(false);
		state.scenarios[1] = reviewed({ ...state.scenarios[1], status: "fail" });
		expect(requestChangesOk(state, probe)).toBe(true);
	});
	test("requestChangesOk는 실패 뒤 실행을 멈춘 미기록 시나리오가 남아도 허용함", () => {
		const state = authoredState();
		state.stories[0].baseline = { result: "fail", cycle: 2 };
		state.scenarios = state.scenarios.map(({ status: _status, evidence: _evidence, evidence_review: _review, ...record }) => record);
		expect(recordComplete(state, probe)).toBe(false);
		expect(requestChangesOk(state, probe)).toBe(true);
	});
	test("blocked 시나리오는 시도 로그가 읽히고 시도 내역이 있을 때만 기록 완결로 인정되고 H여도 APPROVE를 막지 않음", () => {
		const state = serverState();
		const { evidence: _evidence, ...rest } = state.scenarios[0];
		state.scenarios[0] = { ...rest, status: "blocked", blocked: { obstacle: "페어링 코드 입력 필요", attempts: ["pairing → 코드 입력 대기"], deepest_reachable: "서비스 테스트", attempt_log: "/missing" } };
		expect(recordComplete(state, probe)).toBe(false);
		state.scenarios[0].blocked!.attempt_log = "/attempts.log";
		expect(recordComplete(state, probe)).toBe(true);
		expect(approveOk(state, probe)).toBe(true);
		state.scenarios[0].blocked!.attempts = [];
		expect(recordComplete(state, probe)).toBe(false);
	});
	test("commentOk allows M/L failures but not H failures", () => {
		const state = authoredState();
		state.scenarios[1] = reviewed({ ...state.scenarios[1], status: "fail" });
		expect(commentOk(state, probe)).toBe(true);
		expect(approveOk(state, probe)).toBe(false);
		state.scenarios[0] = reviewed({ ...state.scenarios[0], status: "fail" });
		expect(commentOk(state, probe)).toBe(false);
	});

	test("recordComplete false-case: missing run check, missing and empty evidence, surface mismatch", () => {
		const state = serverState();
		state.run_checks.flaky_rerun = null;
		expect(recordComplete(state, probe)).toBe(false);
		for (const path of ["/missing", "/empty"]) {
			const evidence = serverState();
			evidence.scenarios[0].evidence = { path, surface: "curl" };
			expect(recordComplete(evidence, probe)).toBe(false);
		}
		const surface = serverState();
		surface.scenarios[0].evidence = { path: "/evidence", surface: "bash" };
		expect(recordComplete(surface, probe)).toBe(false);
		expect(recordComplete(serverState(), probe)).toBe(true);
	});

	test("cycleUntouched and roster/driver predicates", () => {
		const state = authoredState();
		expect(cycleUntouched({ actors: [], stories: [], scenarios: [], run_checks: {} })).toBe(true);
		expect(cycleUntouched(state)).toBe(false);
		expect(driverGateArmed(state)).toBe(false);
		state.scenarios[0].title = "";
		expect(driverGateArmed(state)).toBe(true);
	});
	test("driver gate arms before roster and at baseline with incomplete chain", () => {
		const state = authoredState();
		const actors = state.actors;
		state.actors = [];
		expect(driverGateArmed(state)).toBe(true);
		state.actors = actors;
		state.phase_max = BASELINE_INDEX - 1;
		state.scenarios[0].title = "";
		expect(driverGateArmed(state)).toBe(false);
		state.phase_max = BASELINE_INDEX;
		expect(driverGateArmed(state)).toBe(true);
	});
	test("phase order preserves the eleven executable names", () => {
		expect(QA_PHASES).toEqual([
			"PRE-FLIGHT", "PLAN", "BASELINE", "ADVERSARIAL E2E", "CHECK", "DIAGNOSIS",
			"FIX", "RE-VERIFY", "EXIT", "CLEANUP", "STATE",
		]);
		expect(BASELINE_INDEX).toBe(2);
		expect(QA_PHASES).not.toContain("ROLLBACK");
	});
});

describe("QA 체인 코어: 스토리 provenance", () => {
	test("스토리 provenance 변경은 리포트 스냅샷을 무효화함", () => {
		const state = authoredState();
		state.report = {
			path: "/report.html",
			sha256: "a".repeat(64),
			state_snapshot: qaReportSnapshot(state),
			reviewed: true,
		};
		expect(qaReportComplete(state, probe)).toBe(true);

		const feature: QaFeatureRef = {
			id: "stock.view",
			revision: "b".repeat(64),
			entrypoints: ["push"],
			states: ["new-user"],
		};
		const provenance: QaStoryProvenance = {
			features: [feature],
			code_ref: "dirty-diff:abc;build:build-1",
			cycle: 2,
		};
		state.stories[0].provenance = provenance;
		expect(qaReportComplete(state, probe)).toBe(false);
	});

	test("provenance가 없는 기존 스토리는 리포트 완료 동작을 유지함", () => {
		const state = authoredState();
		state.report = {
			path: "/report.html",
			sha256: "a".repeat(64),
			state_snapshot: qaReportSnapshot(state),
			reviewed: true,
		};
		expect(qaReportComplete(state, probe)).toBe(true);
	});
});

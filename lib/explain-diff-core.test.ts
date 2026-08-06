import { describe, expect, test } from "bun:test";
import {
	AUTHORING_STEPS,
	REQUIRED_JUDGE_IDS,
	STEP_ORDER,
	computeDerived,
	nextStep,
	normalizeExplainDiffState,
	type ExplainDiffState,
} from "./explain-diff-core";

function state(partial: Partial<ExplainDiffState> = {}): ExplainDiffState {
	return {
		active: true,
		step: "evidence",
		passed: [],
		concepts: [],
		bank: [],
		awaiting_answer: false,
		no_progress: { key: "", count: 0, doc_digest: "" },
		last_failure: null,
		...partial,
	} as ExplainDiffState;
}

describe("스텝 순서", () => {
	test("`STEP_ORDER`는 6단계를 스펙이 정한 순서로 담는다", () => {
		expect(STEP_ORDER).toEqual(["evidence", "background", "intuition", "code", "render", "quiz"]);
	});

	test("`AUTHORING_STEPS`는 사람이 개입하지 않는 앞 4단계다", () => {
		expect(AUTHORING_STEPS).toEqual(["evidence", "background", "intuition", "code"]);
	});

	test("`nextStep`은 순서대로 진행하고 마지막 다음은 null이다", () => {
		expect(nextStep("evidence")).toBe("background");
		expect(nextStep("code")).toBe("render");
		expect(nextStep("quiz")).toBeNull();
	});
});

describe("필수 심사 ID 배정", () => {
	test("intuition은 R6, code는 R7을 요구하고 나머지 네 스텝은 아무 것도 요구하지 않는다", () => {
		expect(REQUIRED_JUDGE_IDS).toEqual({
			evidence: [],
			background: [],
			intuition: ["R6"],
			code: ["R7"],
			render: [],
			quiz: [],
		});
	});

	test("여섯 스텝 전부에 배정이 있다 — 빠진 스텝이 무자격 통과를 만들지 않는다", () => {
		for (const s of STEP_ORDER) expect(REQUIRED_JUDGE_IDS[s]).toBeDefined();
	});
});

describe("산출물 쓰기 허용", () => {
	test("직전 스텝이 모두 통과했으면 현재 스텝 저작을 허용한다", () => {
		const d = computeDerived(state({ step: "background", passed: ["evidence"] }));
		expect(d.artifact_write_allowed).toBe(true);
	});

	test("선행 스텝이 비어 있으면 거부하고 복귀 지점을 이름으로 담는다", () => {
		const d = computeDerived(state({ step: "code", passed: ["evidence"] }));
		expect(d.artifact_write_allowed).toBe(false);
		expect(d.block_reason).toContain("background");
	});

	test("첫 스텝은 선행이 없으므로 허용된다", () => {
		expect(computeDerived(state({ step: "evidence", passed: [] })).artifact_write_allowed).toBe(true);
	});

	test("비활성 상태는 허용하지 않는다", () => {
		expect(computeDerived(state({ active: false })).artifact_write_allowed).toBe(false);
	});

	test("직전 스텝 검사 실패가 기록돼 있으면 그 항목이 거부 사유에 그대로 실린다", () => {
		const d = computeDerived(
			state({
				step: "background",
				passed: [],
				last_failure: { step: "evidence", items: ["signal/noise 분류 사유 누락"] },
			}),
		);
		expect(d.artifact_write_allowed).toBe(false);
		expect(d.block_reason).toContain("signal/noise 분류 사유 누락");
		expect(d.block_reason).toContain("evidence");
	});
});

describe("퀴즈 통과", () => {
	test("필수 개념이 전부 통과해야 quiz_passed 다", () => {
		const s = state({
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [
				{ id: "c1", required: true, passed: true },
				{ id: "c2", required: true, passed: false },
			],
		});
		expect(computeDerived(s).quiz_passed).toBe(false);
		s.concepts[1]!.passed = true;
		expect(computeDerived(s).quiz_passed).toBe(true);
	});

	test("필수가 아닌 개념은 통과 판정을 막지 않는다", () => {
		const s = state({
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [
				{ id: "c1", required: true, passed: true },
				{ id: "c2", required: false, passed: false },
			],
		});
		expect(computeDerived(s).quiz_passed).toBe(true);
	});

	test("필수 개념이 하나도 없으면 통과가 아니다 — 빈 집합의 공허참을 막는다", () => {
		const s = state({
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [],
		});
		expect(computeDerived(s).quiz_passed).toBe(false);
	});

	test("퀴즈 스텝에 도달하지 못했으면 통과가 아니다", () => {
		const s = state({ step: "code", passed: ["evidence", "background", "intuition"], concepts: [] });
		expect(computeDerived(s).quiz_passed).toBe(false);
	});
});

describe("정지 허용", () => {
	test("퀴즈 미통과 상태에서는 정지를 막는다", () => {
		expect(computeDerived(state({ step: "quiz" })).stop_allowed).toBe(false);
	});

	test("사용자 답변 대기 중이면 정지를 허용한다 — 대기는 미완이 아니다", () => {
		expect(computeDerived(state({ step: "quiz", awaiting_answer: true })).stop_allowed).toBe(true);
	});

	test("무진전 소프트 정지 상태면 정지를 허용한다", () => {
		const s = state({ step: "quiz", stalled: true });
		expect(computeDerived(s).stop_allowed).toBe(true);
	});

	test("퀴즈를 통과했으면 정지를 허용한다", () => {
		const s = state({
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [{ id: "c1", required: true, passed: true }],
		});
		expect(computeDerived(s).stop_allowed).toBe(true);
	});

	test("비활성 상태면 정지를 허용한다", () => {
		expect(computeDerived(state({ active: false })).stop_allowed).toBe(true);
	});
});

describe("무진전 판정", () => {
	test("같은 항목 연속 2회 실패 + 문서 무변경이면 무진전이다", () => {
		const s = state({ no_progress: { key: "c1:R3", count: 2, doc_digest: "abc" } });
		expect(computeDerived(s).no_progress_tripped).toBe(true);
	});

	test("1회 실패는 무진전이 아니다", () => {
		const s = state({ no_progress: { key: "c1:R3", count: 1, doc_digest: "abc" } });
		expect(computeDerived(s).no_progress_tripped).toBe(false);
	});

	test("답변 대기 중의 정지는 무진전으로 세지 않는다", () => {
		const s = state({
			awaiting_answer: true,
			no_progress: { key: "c1:R3", count: 2, doc_digest: "abc" },
		});
		expect(computeDerived(s).no_progress_tripped).toBe(false);
	});
});

describe("normalizeExplainDiffState", () => {
	test("객체가 아닌 입력은 null 이다", () => {
		expect(normalizeExplainDiffState(null)).toBeNull();
		expect(normalizeExplainDiffState("x")).toBeNull();
		expect(normalizeExplainDiffState(42)).toBeNull();
	});

	test("빈 객체도 안전한 기본값으로 채워진다 — 잘린 상태 파일이 게이트를 터뜨리지 않는다", () => {
		const s = normalizeExplainDiffState({});
		expect(s).not.toBeNull();
		expect(s?.active).toBe(false);
		expect(s?.step).toBe("evidence");
		expect(s?.passed).toEqual([]);
		expect(s?.concepts).toEqual([]);
		expect(s?.no_progress).toEqual({ key: "", count: 0, doc_digest: "" });
		expect(s?.last_failure).toBeNull();
	});

	test("알 수 없는 스텝 이름은 버린다 — 손으로 고친 상태가 스텝 순서를 뚫지 못한다", () => {
		const s = normalizeExplainDiffState({ step: "wat", passed: ["evidence", "wat", "code"] });
		expect(s?.step).toBe("evidence");
		expect(s?.passed).toEqual(["evidence", "code"]);
	});

	test("개념 배열은 id 가 문자열인 항목만 남는다", () => {
		const s = normalizeExplainDiffState({
			concepts: [{ id: "c1", required: true, passed: true }, { required: true }, "c2"],
		});
		expect(s?.concepts).toEqual([{ id: "c1", required: true, passed: true }]);
	});

	test("정상 상태는 그대로 통과한다", () => {
		const s = normalizeExplainDiffState({
			active: true,
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [{ id: "c1", required: true, passed: false }],
			bank: [1, 2],
			awaiting_answer: true,
			stalled: true,
			no_progress: { key: "c1:R3", count: 1, doc_digest: "d" },
			last_failure: { step: "code", items: ["R5 추적성"] },
		});
		expect(s?.step).toBe("quiz");
		expect(s?.awaiting_answer).toBe(true);
		expect(s?.stalled).toBe(true);
		expect(s?.last_failure).toEqual({ step: "code", items: ["R5 추적성"] });
	});
});

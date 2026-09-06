import { describe, expect, test } from "bun:test";
import { parse, stringify } from "smol-toml";
import {
	planConfig,
	parseConfigState,
	serializeConfigState,
	type ConfigState,
} from "./codex-config-ownership";

const owned = (path: string[], value: unknown): ConfigState => ({
	version: 1,
	target: ".codex/config.toml",
	entries: [{ path, valueToml: stringify({ value }) }],
});

describe("Codex 키 소유권 계획", () => {
	test("빈 상태에서 누락된 리프만 생성하고 점이 있는 키를 분리하지 않는다", () => {
		const plan = planConfig({}, { "a.b": { enabled: true }, empty: {} });
		expect(plan.edits).toEqual([{ path: ["a.b", "enabled"], kind: "set", value: true }]);
		expect(plan.nextState.entries.map((e) => e.path)).toEqual([["a.b", "enabled"]]);
	});
	test("기존 비소유 키는 원하는 값과 같아도 명시적 인수가 필요하다", () => {
		const plan = planConfig({ model: "same" }, { model: "same" });
		expect(plan.edits).toEqual([]);
		expect(plan.conflicts[0].reason).toContain("adoption-required");
		expect(plan.nextState.entries).toEqual([]);
	});
	test("소유 값이 유지되면 갱신하고 원하는 값이면 편집하지 않는다", () => {
		const state = owned(["model"], "old");
		expect(planConfig({ model: "old" }, { model: "new" }, state).edits).toEqual([
			{ path: ["model"], kind: "set", value: "new" },
		]);
		const converged = planConfig({ model: "new" }, { model: "new" }, state);
		expect(converged.edits).toEqual([]);
		expect(parse(converged.nextState.entries[0].valueToml).value).toBe("new");
	});
	test("사용자 변경이나 제거는 비밀 값 없이 충돌로 보존한다", () => {
		const state = owned(["token"], "last-secret");
		for (const current of [{ token: "user-secret" }, {}]) {
			const plan = planConfig(current, { token: "desired-secret" }, state);
			expect(plan.edits).toEqual([]);
			expect(plan.conflicts).toHaveLength(1);
			expect(JSON.stringify(plan.conflicts)).not.toContain("secret");
			expect(plan.nextState).toEqual(state);
		}
	});
	test("생략은 유지하고 명시적 null만 변경되지 않은 소유 키를 삭제한다", () => {
		const state = owned(["model"], "old");
		expect(planConfig({ model: "old" }, {}, state).nextState).toEqual(state);
		const removed = planConfig({ model: "old" }, { model: null }, state);
		expect(removed.edits).toEqual([{ path: ["model"], kind: "delete" }]);
		expect(removed.nextState.entries).toEqual([]);
		expect(planConfig({}, { model: null }, state).nextState.entries).toEqual([]);
		expect(planConfig({ model: "drift" }, { model: null }, state).conflicts).toHaveLength(1);
		expect(planConfig({ model: "old" }, { model: null }).conflicts).toHaveLength(1);
		expect(planConfig({}, { model: null }).conflicts).toEqual([]);
	});
	test("배열은 원자적으로 소유하고 내부 객체 키 순서는 무시한다", () => {
		const previous = [{ a: 1, b: 2 }];
		const plan = planConfig(
			{ items: [{ b: 2, a: 1 }] },
			{ items: [3] },
			owned(["items"], previous),
		);
		expect(plan.edits).toEqual([{ path: ["items"], kind: "set", value: [3] }]);
	});
	test("TOML 날짜와 특수 숫자의 타입이 상태 왕복 후 유지된다", () => {
		const current = parse(
			"day = 2026-09-05\ntime = 12:30:00\ninstant = 2026-09-05T01:02:03Z\nlarge = 9223372036854775807\nvalue = nan",
			{ integersAsBigInt: "asNeeded" },
		);
		const state = planConfig({}, current).nextState;
		const restored = parseConfigState(serializeConfigState(state));
		expect(planConfig(current, current, restored).conflicts).toEqual([]);
		expect(planConfig(current, current, restored).edits).toEqual([]);
	});
	test("테이블과 스칼라 전환 및 상위 삭제는 사용자 하위 키를 덮어쓰지 않는다", () => {
		const state = owned(["group", "owned"], true);
		for (const desired of [{ group: null }, { group: "replacement" }]) {
			const plan = planConfig({ group: { owned: true, user: "keep" } }, desired, state);
			expect(plan.edits).toEqual([]);
			expect(plan.conflicts).toHaveLength(1);
		}
		const plan = planConfig({ group: 1 }, { group: { child: 2 } }, owned(["group"], 1));
		expect(plan.edits).toEqual([]);
		expect(plan.conflicts).toHaveLength(1);
	});
	test("드리프트로 생긴 테이블도 소유 스칼라 값으로 덮어쓰지 않는다", () => {
		expect(planConfig({ group: { user: true } }, { group: 2 }, owned(["group"], 1)).edits).toEqual(
			[],
		);
	});
});

describe("소유권 상태 코덱", () => {
	test("잘못된 형식과 중복 또는 겹치는 경로를 거부한다", () => {
		const state = owned(["model"], "old");
		const invalid: unknown[] = [
			null,
			{},
			{ ...state, version: 2 },
			{ ...state, target: "other" },
			{ ...state, entries: [...state.entries, ...state.entries] },
			{
				...state,
				entries: [...state.entries, { path: ["model", "child"], valueToml: "value = 1" }],
			},
			{ ...state, entries: [{ path: [], valueToml: "value = 1" }] },
			{ ...state, entries: [{ path: ["a"], valueToml: "extra = 1" }] },
			{ ...state, entries: [{ path: ["a"], valueToml: "value = 1\nextra = 2" }] },
			{ ...state, entries: [{ path: ["a"], valueToml: "invalid" }] },
		];
		for (const input of invalid) expect(() => parseConfigState(JSON.stringify(input))).toThrow();
		expect(() => parseConfigState("{broken")).toThrow();
	});
	test("직접 전달된 잘못된 상태도 거부하며 오류에 값을 포함하지 않는다", () => {
		const state = owned(["a"], "secret");
		state.entries[0].valueToml = "TOP_SECRET_INVALID";
		expect(() => planConfig({}, {}, state)).toThrow();
		try {
			parseConfigState(JSON.stringify(state));
		} catch (error) {
			expect(String(error)).not.toContain("TOP_SECRET");
		}
	});
});

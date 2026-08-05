import { describe, expect, test } from "bun:test";
import {
	BASELINE_INDEX,
	QA_PHASES,
	approveOk,
	chainComplete,
	commentOk,
	cycleUntouched,
	driverGateArmed,
	recordComplete,
	requiredCells,
	rosterComplete,
	type QaChainState,
} from "./qa-chain-core";

type CompleteFixture = QaChainState & {
	actors: NonNullable<QaChainState["actors"]>;
	stories: NonNullable<QaChainState["stories"]>;
	cells: NonNullable<QaChainState["cells"]>;
	run_checks: NonNullable<QaChainState["run_checks"]>;
};

const probe = (path: string) => ({ exists: path !== "/missing", size: path === "/empty" ? 0 : 1 });

function authoredState(): CompleteFixture {
	const state: CompleteFixture = {
		active: true,
		phase: "PLAN",
		cycle: 2,
		phase_max: BASELINE_INDEX,
		actors: [{ id: "a1", name: "Mobile", boundary: "device", driver: "agent-device", reachable: "yes" }],
		stories: [{ id: "s1", actor: "a1", baseline: { result: "pass", cycle: 2, evidence: { path: "/base", surface: "agent-device" } } }],
		cells: [],
		run_checks: {
			stale_state: { result: "pass", cycle: 2 },
			dirty_worktree: { result: "pass", cycle: 2 },
			flaky_rerun: { result: "pass", cycle: 2 },
		},
		waives: [],
		inert: { declared: false },
		verdict: null,
	};
	state.cells = requiredCells(state).map((cell, index) => ({
		...cell,
		attack_point: `attack ${index}`,
		priority: index === 0 ? "H" : "M",
		status: "pass",
		cycle: 2,
		evidence: { path: `/evidence/${index}`, surface: "agent-device" },
	}));
	return state;
}

describe("qa chain core", () => {
	test("derives eight required cells per story", () => {
		const state = authoredState();
		expect(requiredCells(state)).toHaveLength(8);
		expect(requiredCells(state).map((cell) => `${cell.cls}/${cell.sub ?? "bare"}`)).toEqual([
			"1/bare",
			"2/bare",
			"3/bare",
			"4/bare",
			"5/bare",
			"6/bare",
			"1/hang-timeout",
			"5/flaky-green",
		]);
	});

	test("chainComplete false-case: empty chain", () => {
		const state = authoredState();
		state.actors = [];
		state.stories = [];
		state.cells = [];
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

	test("chainComplete false-case: unauthored, empty attack point, missing priority, and no H", () => {
		const state = authoredState();
		state.cells[0].attack_point = "";
		expect(chainComplete(state)).toBe(false);
		state.cells[0].attack_point = "attack";
		state.cells[0].priority = undefined;
		expect(chainComplete(state)).toBe(false);
		state.cells = state.cells.map((cell) => ({ ...cell, priority: "L" }));
		expect(chainComplete(state)).toBe(false);
		state.cells = state.cells.slice(0, 7);
		expect(chainComplete(state)).toBe(false);
	});

	test("approveOk false-case: all-unrecorded chain", () => {
		const state = authoredState();
		state.stories[0].baseline = null;
		state.cells = state.cells.map((cell) => ({ ...cell, status: null, cycle: 2 }));
		state.run_checks = { stale_state: null, dirty_worktree: null, flaky_rerun: null };
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
	});

	test("approveOk false-case: stale-state fail", () => {
		const state = authoredState();
		state.run_checks.stale_state = { result: "fail", cycle: 2 };
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
	});

	test("approveOk false-case: H na without inert declaration", () => {
		const state = authoredState();
		state.cells[0].status = "na";
		state.cells[0].na_reason = "not reachable";
		expect(approveOk(state, probe)).toBe(false);
	});

	test("approveOk false-case: declared-inert mixed pass and H na", () => {
		const state = authoredState();
		state.inert = { declared: true, reason: "pure refactor", cycle: 2 };
		state.cells[0].status = "na";
		state.cells[0].na_reason = "inert";
		expect(approveOk(state, probe)).toBe(false);
	});

	test("approveOk false-case: failing baseline", () => {
		const state = authoredState();
		state.stories[0].baseline = { result: "fail", cycle: 2 };
		expect(approveOk(state, probe)).toBe(false);
		expect(commentOk(state, probe)).toBe(false);
	});

	test("approveOk true-case: declared-inert all-na chain", () => {
		const state = authoredState();
		state.inert = { declared: true, reason: "pure refactor", cycle: 2 };
		state.cells = state.cells.map((cell) => ({ ...cell, status: "na", na_reason: "inert" }));
		expect(approveOk(state, probe)).toBe(true);
		expect(commentOk(state, probe)).toBe(true);
	});

	test("approveOk true-case: dirty-worktree failure is non-blocking", () => {
		const state = authoredState();
		state.run_checks.dirty_worktree = { result: "fail", cycle: 2 };
		expect(approveOk(state, probe)).toBe(true);
		expect(commentOk(state, probe)).toBe(true);
	});

	test("commentOk allows M/L failures but not H failures", () => {
		const state = authoredState();
		state.cells[1].status = "fail";
		expect(commentOk(state, probe)).toBe(true);
		state.cells[0].status = "fail";
		expect(commentOk(state, probe)).toBe(false);
	});

	test("recordComplete false-case: stale cycle, missing run check, na reason, and invalid evidence", () => {
		const state = authoredState();
		state.cells[0].cycle = 1;
		expect(recordComplete(state, probe)).toBe(false);
		state.cells[0].cycle = 2;
		state.cells[1].status = "na";
		state.cells[1].na_reason = undefined;
		expect(recordComplete(state, probe)).toBe(false);
		state.cells[1].status = "pass";
		state.run_checks.flaky_rerun = null;
		expect(recordComplete(state, probe)).toBe(false);
	});

	test("probe false-case: missing and empty pass evidence", () => {
		const state = authoredState();
		state.cells[0].evidence = { path: "/missing", surface: "agent-device" };
		expect(recordComplete(state, probe)).toBe(false);
		state.cells[0].evidence = { path: "/empty", surface: "agent-device" };
		expect(recordComplete(state, probe)).toBe(false);
	});

	test("surface false-case: evidence driver mismatch", () => {
		const state = authoredState();
		state.cells[0].evidence = { path: "/evidence", surface: "curl" };
		expect(recordComplete(state, probe)).toBe(false);
	});

	test("cycleUntouched and roster/driver predicates", () => {
		const state = authoredState();
		expect(cycleUntouched({ actors: [], stories: [], cells: [], run_checks: {} })).toBe(true);
		expect(cycleUntouched(state)).toBe(false);
		expect(rosterComplete(state)).toBe(true);
		expect(driverGateArmed(state)).toBe(false);
		state.phase_max = BASELINE_INDEX;
		state.cells[0].attack_point = "";
		expect(driverGateArmed(state)).toBe(true);
	});

	test("driver gate arms before roster and at baseline with incomplete chain", () => {
		const state = authoredState();
		state.actors = [];
		expect(driverGateArmed(state)).toBe(true);
		state.actors = [{ id: "a1", name: "Mobile", boundary: "device", driver: "agent-device", reachable: "yes" }];
		state.phase_max = BASELINE_INDEX - 1;
		state.cells[0].attack_point = "";
		expect(driverGateArmed(state)).toBe(false);
		state.phase_max = BASELINE_INDEX;
		expect(driverGateArmed(state)).toBe(true);
	});

	test("phase order preserves all twelve names", () => {
		expect(QA_PHASES).toEqual([
			"PRE-FLIGHT", "PLAN", "BASELINE", "ADVERSARIAL E2E", "CHECK", "DIAGNOSIS",
			"FIX", "RE-VERIFY", "EXIT", "CLEANUP", "ROLLBACK", "STATE",
		]);
	});
});

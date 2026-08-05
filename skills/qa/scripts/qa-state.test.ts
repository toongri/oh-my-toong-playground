import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
	readQaState,
	setQaState,
	advancePhase,
	incCycle,
	noteFailure,
	recordFixHead,
	captureDirtySet,
	completeQa,
	setVerdict,
	resolveStatePath,
	type QaState,
} from "./qa-state.ts";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = "test-session";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "qa-state-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) {
		process.env.OMT_DIR = originalOmtDir;
	} else {
		delete process.env.OMT_DIR;
	}
	if (originalSessionId !== undefined) {
		process.env.OMT_SESSION_ID = originalSessionId;
	} else {
		delete process.env.OMT_SESSION_ID;
	}
});

function rawState(sid: string = S): any {
	return JSON.parse(readFileSync(resolveStatePath(sid), "utf8"));
}

describe("qa state: seed shape", () => {
	// Switch-exhaustiveness proxy: seeding via the CLI (any writer) must produce the
	// qa-specific seed shape — not a default/other-skill shape (goal's outcome/iteration,
	// or deep-interview's bare active/started_at/last_touched_at).
	test("seeding via a writer produces the qa-specific seed shape, not a default/other-skill shape", () => {
		const fresh = "fresh-qa-session";
		expect(existsSync(resolveStatePath(fresh))).toBe(false);
		setQaState(fresh, { phase: "PRE-FLIGHT" });
		const raw = rawState(fresh);
		expect(raw).toMatchObject({
			active: true,
			phase: "PRE-FLIGHT",
			cycle: 0,
			max_cycles: 5,
			same_failure_key: "",
			same_failure_count: 0,
			fix_head_before: "",
			user_dirty_set: [],
			target: "",
		});
		expect(raw).toHaveProperty("started_at");
		expect(raw).toHaveProperty("last_touched_at");
		// Not goal's shape
		expect(raw).not.toHaveProperty("outcome");
		expect(raw).not.toHaveProperty("iteration");
		// Not deep-interview's bare shape (would lack phase/cycle entirely if that arm fired)
		expect(raw).toHaveProperty("phase");
		expect(raw).toHaveProperty("cycle");
	});

	// (self-heal-qa) qa CLI seeds the pristine skeleton when the state file is absent —
	// mirrors goal-state.ts's ensureSeed self-heal pattern (slash-command hook-miss path).
	test("(self-heal-qa) setQaState seeds then succeeds when state file is absent", () => {
		const absentSid = "absent-qa-session";
		expect(existsSync(resolveStatePath(absentSid))).toBe(false);
		expect(() => setQaState(absentSid, { phase: "PRE-FLIGHT" })).not.toThrow();
		expect(existsSync(resolveStatePath(absentSid))).toBe(true);
		expect(readQaState(absentSid)!.phase).toBe("PRE-FLIGHT");
	});

	test("schema enumerates all required fields", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		const s = rawState();
		expect(s).toHaveProperty("active");
		expect(s).toHaveProperty("phase");
		expect(s).toHaveProperty("cycle");
		expect(s).toHaveProperty("max_cycles");
		expect(s).toHaveProperty("same_failure_key");
		expect(s).toHaveProperty("same_failure_count");
		expect(s).toHaveProperty("fix_head_before");
		expect(s).toHaveProperty("user_dirty_set");
		expect(s).toHaveProperty("target");
		expect(s).toHaveProperty("started_at");
		expect(s).toHaveProperty("last_touched_at");
	});
});

describe("qa state: phase/target round-trip", () => {
	test("set then get round-trips phase and target; cycle stays 0", () => {
		setQaState(S, { phase: "PLAN", target: "verify feature X" });
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("verify feature X");
		expect(state.cycle).toBe(0);
	});

	test("set preserves prior target when omitted; started_at seeded once", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Y" });
		const first = readQaState(S)!;
		setQaState(S, { phase: "PLAN" });
		const second = readQaState(S)!;
		expect(second.phase).toBe("PLAN");
		expect(second.target).toBe("feature Y");
		expect(second.started_at).toBe(first.started_at);
	});

	test("set rejects an out-of-enum phase", () => {
		expect(() => setQaState(S, { phase: "BOGUS-PHASE" })).toThrow();
	});

	test("advance-phase writes phase without touching target", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Z" });
		advancePhase(S, "PLAN");
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("feature Z");
	});

	test("advance-phase rejects an out-of-enum phase", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		expect(() => advancePhase(S, "NOT-A-PHASE")).toThrow();
	});
});

describe("qa state: cycle counting", () => {
	test("inc-cycle increments; terminate signaled at cycle===max_cycles(5)", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		let last: { cycle: number; terminate: boolean } | undefined;
		for (let i = 1; i <= 5; i++) {
			last = incCycle(S);
			expect(last.cycle).toBe(i);
			expect(last.terminate).toBe(i === 5);
		}
		expect(readQaState(S)!.cycle).toBe(5);
	});

	test("inc-cycle refuses to increment past max_cycles once terminate is reached", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		for (let i = 0; i < 5; i++) incCycle(S);
		expect(() => incCycle(S)).toThrow();
		// state unchanged at the cap
		expect(readQaState(S)!.cycle).toBe(5);
	});
});

describe("qa state: Same-Failure key semantics", () => {
	test("same key 3x accumulates count to 3 and signals terminate", () => {
		setQaState(S, { phase: "PLAN" });
		let r = noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		expect(r.same_failure_count).toBe(1);
		expect(r.terminate).toBe(false);
		r = noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		expect(r.same_failure_count).toBe(2);
		expect(r.terminate).toBe(false);
		r = noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		expect(r.same_failure_count).toBe(3);
		expect(r.terminate).toBe(true);
		expect(readQaState(S)!.same_failure_key).toBe("scenario-1:file.ts:rootCauseSymbol");
		expect(readQaState(S)!.same_failure_count).toBe(3);
	});

	// (P2 finding 2) noteFailure's terminate must be a latch (>=3), not an
	// equality check (===3): a resumed run can call note-failure again after
	// count already hit 3, landing on 4 — the 3x-exit must still fire.
	test("same key 4x (resumed run past the 3x boundary) still signals terminate", () => {
		setQaState(S, { phase: "PLAN" });
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		const r = noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		expect(r.same_failure_count).toBe(4);
		expect(r.terminate).toBe(true);
	});

	test("a different key resets count to 1 and updates same_failure_key", () => {
		setQaState(S, { phase: "PLAN" });
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		const r = noteFailure(S, "scenario-2:other.ts:differentSymbol");
		expect(r.same_failure_count).toBe(1);
		expect(r.terminate).toBe(false);
		const state = readQaState(S)!;
		expect(state.same_failure_key).toBe("scenario-2:other.ts:differentSymbol");
		expect(state.same_failure_count).toBe(1);
	});
});

describe("qa state: fix_head_before + user_dirty_set", () => {
	test("record-fix-head and capture-dirty-set persist and read back", () => {
		setQaState(S, { phase: "PLAN" });
		recordFixHead(S, "abc123deadbeef");
		captureDirtySet(S, ["src/foo.ts", "src/bar.ts"]);
		const state = readQaState(S)!;
		expect(state.fix_head_before).toBe("abc123deadbeef");
		expect(state.user_dirty_set).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	test("capture-dirty-set with empty array clears the set", () => {
		setQaState(S, { phase: "PLAN" });
		captureDirtySet(S, ["a.ts"]);
		captureDirtySet(S, []);
		expect(readQaState(S)!.user_dirty_set).toEqual([]);
	});
});

describe("qa state: terminal completion (P2 finding 1 — no active:false resurrection)", () => {
	test("completeQa marks active:false so readQaState no longer restores the session", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "PLAN");
		expect(readQaState(S)).not.toBeNull();
		setVerdict(S, "REQUEST_CHANGES");
		completeQa(S);
		expect(readQaState(S)).toBeNull();
		// but the underlying file still exists (inactive, not deleted)
		expect(existsSync(resolveStatePath(S))).toBe(true);
		expect(rawState().active).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// CLI end-to-end: proves parseArgs + subcommand wiring, not just the TS API.
// ---------------------------------------------------------------------------

describe("qa-state CLI wiring", () => {
	const script = join(import.meta.dir, "qa-state.ts");
	const run = (cmd: string) => execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
	const authorCompleteChain = () => {
		run("set --phase PLAN");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run('add-story --id story-1 --actor actor-1');
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`author-cell --story story-1 --cls ${cls}${suffix} --attack-point "attack ${cls} ${sub}" --priority ${cls === 1 ? "H" : "L"}`);
		}
	};

	test("CLI set/get/status round-trip", () => {
		run('set --phase PLAN --target "cli target"');
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().target).toBe("cli target");
		const out = run("get");
		const parsed = JSON.parse(out);
		expect(parsed.phase).toBe("PLAN");
		expect(parsed.target).toBe("cli target");
		const status = run("status").trim();
		expect(status).toBe("PLAN");
	});

	test("CLI inc-cycle prints cycle+terminate JSON", () => {
		run("set --phase PRE-FLIGHT");
		const out = run("inc-cycle");
		const parsed = JSON.parse(out);
		expect(parsed.cycle).toBe(1);
		expect(parsed.terminate).toBe(false);
	});

	test("CLI note-failure prints same_failure_count+terminate JSON", () => {
		run("set --phase PLAN");
		run('note-failure "k1"');
		const out = run('note-failure "k1"');
		const parsed = JSON.parse(out);
		expect(parsed.same_failure_count).toBe(2);
		expect(parsed.terminate).toBe(false);
	});

	test("CLI complete deactivates the session; get then reports absent", () => {
		run("set --phase PRE-FLIGHT");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		expect(rawState().active).toBe(false);
		const out = run("get").trim();
		expect(out).toBe("null");
	});

	test("set-verdict refuses APPROVE with a fail cell, then accepts after a waiver", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run("record-cell --story story-1 --cls 1 --status fail --na-reason ignored");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict APPROVE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run('waive --story story-1 --cls 1 --reason "not applicable"');
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("start resets a completed cycle and refuses to launder active work", () => {
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		run('start --target "second cycle"');
		const reset = rawState();
		expect(reset.active).toBe(true);
		expect(reset.derived.chain_complete).toBe(false);
		expect(reset.derived.driver_gate_armed).toBe(true);
		expect(reset.verdict).toBeNull();
		expect(reset.phase_max).toBe(0);
		expect(reset.cycle).toBe(0);
		expect(reset.same_failure_key).toBe("");
		expect(reset.same_failure_count).toBe(0);
		expect(reset.fix_head_before).toBe("");
		expect(reset.user_dirty_set).toEqual([]);
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run('start --target "launder"')).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("complete is gated and accepts the four normative arms", () => {
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		// Re-enter, author a complete but failing chain, and close with RC.
		run('start --target "recorded failure"');
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note broken");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status fail --na-reason failure`);
		}
		run("record-run-check --check stale-state --result fail --note stale");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result fail --note flaky");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		expect(rawState().active).toBe(false);
	});

	test("waive and declare-inert require reasons and are surfaced in get report", () => {
		authorCompleteChain();
		expect(() => run("waive --story story-1 --cls 1")).toThrow();
		run('waive --story story-1 --cls 1 --reason "user approved exception"');
		expect(() => run("declare-inert")).toThrow();
		run('declare-inert --reason "refactor has no reachable risk surface"');
		const view = JSON.parse(run("get"));
		expect(view.verdict_report.waives[0].reason).toBe("user approved exception");
		expect(view.verdict_report.inert.reason).toContain("no reachable");
	});

	test("declare-inert all-na arm permits APPROVE but mixed pass/H-na does not", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status na --na-reason "no risk surface"`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run('declare-inert --reason "nothing reachable"');
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
		run("complete");
		run('start --target "mixed inert"');
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			const status = cls === 2 && !sub ? "pass" : "na";
			const evidence = status === "pass" ? " --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash" : " --na-reason \"no risk surface\"";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status ${status}${evidence}`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run('declare-inert --reason "mixed should fail"');
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict APPROVE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("lock serializes concurrent waive and record-cell writes", () => {
		authorCompleteChain();
		const scriptPath = join(import.meta.dir, "qa-state.ts");
		execSync(
			`(bun ${scriptPath} waive --story story-1 --cls 1 --reason "parallel waiver" & bun ${scriptPath} record-cell --story story-1 --cls 2 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash & wait)`,
			{ encoding: "utf8", env: process.env, shell: "/bin/sh" },
		);
		const state = rawState();
		expect(state.waives).toEqual([expect.objectContaining({ story: "story-1", cls: 1, reason: "parallel waiver" })]);
		expect(state.cells.find((cell: any) => cell.story === "story-1" && cell.cls === 2).status).toBe("pass");
	});

	test("get separates prior-cycle cell records from the current-cycle view", () => {
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status na --na-reason first-cycle");
		run("inc-cycle");
		run("author-cell --story story-1 --cls 1 --attack-point corrected --priority H");
		const view = JSON.parse(run("get"));
		expect(view.cycle).toBe(1);
		expect(view.cells.some((cell: any) => cell.cls === 1 && cell.cycle === 1)).toBe(true);
		expect(view.prior_cycle_cells.some((cell: any) => cell.cls === 1 && cell.cycle === 0)).toBe(true);
	});

	test("byte-identical: unknown actor and invalid authoring are refused before write", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("add-story --id story-1 --actor missing")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const beforeCell = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("author-cell --story missing --cls 1 --attack-point x --priority H")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(beforeCell);
	});

	test("phase gate: both phase writers refuse BASELINE until the chain is complete", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("advance-phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		expect(() => run("set --phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		authorCompleteChain();
		expect(() => run("advance-phase BASELINE")).not.toThrow();
	});

	test("phase_max: high-water mark is not lowered by a backward set", () => {
		authorCompleteChain();
		run('advance-phase "ADVERSARIAL E2E"');
		expect(rawState().phase_max).toBe(3);
		run("set --phase PLAN");
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().phase_max).toBe(3);
	});

	test("re-record: current-cycle records replace while prior-cycle records remain", () => {
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status fail");
		run("record-cell --story story-1 --cls 1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		const firstCycle = rawState();
		const current = firstCycle.cells.find((cell: any) => cell.story === "story-1" && cell.cls === 1 && !cell.sub);
		expect(current.status).toBe("pass");
		run("inc-cycle");
		run("author-cell --story story-1 --cls 1 --attack-point corrected --priority H");
		run("record-cell --story story-1 --cls 1 --status fail");
		const second = rawState();
		const records = second.cells.filter((cell: any) => cell.story === "story-1" && cell.cls === 1 && !cell.sub);
		expect(records).toHaveLength(2);
		expect(records[0].cycle).toBe(0);
		expect(records[0].status).toBe("pass");
		expect(records[1].cycle).toBe(1);
		expect(records[1].status).toBe("fail");
	});

	test("derived: every successful chain write persists recomputed flags", () => {
		run("set --phase PLAN");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const afterActor = rawState();
		expect(afterActor.derived).toMatchObject({ chain_complete: false, driver_gate_armed: true });
		run('add-story --id story-1 --actor actor-1');
		expect(rawState()).toHaveProperty("derived.chain_complete");
	});

	test("funnel: exported phase writers share the BASELINE gate", () => {
		setQaState(S, { phase: "PLAN" });
		expect(() => advancePhase(S, "BASELINE")).toThrow();
		expect(() => setQaState(S, { phase: "BASELINE" })).toThrow();
	});

	test("(B2) CLI exits non-zero when no session identifier is available", () => {
		const env: NodeJS.ProcessEnv = { ...process.env, OMT_SESSION_ID: "" };
		delete env.CODEX_THREAD_ID;
		expect(() =>
			execSync(`bun ${script} set --phase PLAN`, { encoding: "utf8", env }),
		).toThrow();
		const defaultPath = `${tmpDir}/qa-state-default.json`;
		expect(existsSync(defaultPath)).toBe(false);
	});
});

// Type-only compile-time smoke: ensures QaState shape is exported and usable.
const _typeCheck: QaState = {
	active: true,
	phase: "PRE-FLIGHT",
	cycle: 0,
	max_cycles: 5,
	same_failure_key: "",
	same_failure_count: 0,
	fix_head_before: "",
	user_dirty_set: [],
	target: "",
	started_at: "2026-01-01T00:00:00",
	last_touched_at: "2026-01-01T00:00:00",
};
void _typeCheck;

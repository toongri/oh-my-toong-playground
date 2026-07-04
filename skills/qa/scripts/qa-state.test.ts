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
		advancePhase(S, "BASELINE");
		const state = readQaState(S)!;
		expect(state.phase).toBe("BASELINE");
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
		setQaState(S, { phase: "CHECK" });
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
		setQaState(S, { phase: "CHECK" });
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		const r = noteFailure(S, "scenario-1:file.ts:rootCauseSymbol");
		expect(r.same_failure_count).toBe(4);
		expect(r.terminate).toBe(true);
	});

	test("a different key resets count to 1 and updates same_failure_key", () => {
		setQaState(S, { phase: "CHECK" });
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
		setQaState(S, { phase: "FIX" });
		recordFixHead(S, "abc123deadbeef");
		captureDirtySet(S, ["src/foo.ts", "src/bar.ts"]);
		const state = readQaState(S)!;
		expect(state.fix_head_before).toBe("abc123deadbeef");
		expect(state.user_dirty_set).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	test("capture-dirty-set with empty array clears the set", () => {
		setQaState(S, { phase: "FIX" });
		captureDirtySet(S, ["a.ts"]);
		captureDirtySet(S, []);
		expect(readQaState(S)!.user_dirty_set).toEqual([]);
	});
});

describe("qa state: terminal completion (P2 finding 1 — no active:false resurrection)", () => {
	test("completeQa marks active:false so readQaState no longer restores the session", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "STATE");
		expect(readQaState(S)).not.toBeNull();
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
		run("set --phase CHECK");
		run('note-failure "k1"');
		const out = run('note-failure "k1"');
		const parsed = JSON.parse(out);
		expect(parsed.same_failure_count).toBe(2);
		expect(parsed.terminate).toBe(false);
	});

	test("CLI complete deactivates the session; get then reports absent", () => {
		run("set --phase PRE-FLIGHT");
		run("complete");
		expect(rawState().active).toBe(false);
		const out = run("get").trim();
		expect(out).toBe("null");
	});

	test("(B2) CLI exits non-zero when OMT_SESSION_ID is empty", () => {
		const env = { ...process.env, OMT_SESSION_ID: "" };
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

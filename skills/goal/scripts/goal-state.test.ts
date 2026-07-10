import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	readFileSync,
	writeFileSync,
	existsSync,
	renameSync,
	appendFileSync,
	unlinkSync,
} from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
	readGoalState,
	setGoalState,
	setBudgetLimited,
	setBlocked,
	requestComplete,
	setVerdict,
	deriveStatus,
	resolveStatePath,
	readGoalGet,
	setStories,
	setSingleStory,
	confirmStory,
	reviseStory,
	addStory,
	retireStory,
	serializeRequirements,
	readCodeReviewArtifact,
	type GoalPhase,
	type Story,
} from "./goal-state.ts";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = "test-session";

/** Seed the state file as the PreToolUse hook would (create-if-absent skeleton). */
function seedGoalFile(sessionId: string): void {
	const path = resolveStatePath(sessionId);
	if (!existsSync(path)) {
		writeFileSync(
			path,
			JSON.stringify({
				active: true,
				phase: "planning",
				iteration: 0,
				max_iterations: 10,
				started_at: new Date().toISOString().slice(0, 19),
				last_touched_at: new Date().toISOString().slice(0, 19),
				outcome: "",
				verification_surface: "",
				constraints: "",
				boundaries: "",
				blocked_stop: "",
				plan_path: "",
				resume_summary: "",
				budget_limit_notified: false,
				blocked_reason: "",
				completion_evidence_paths: [],
				objective_verdict: "absent",
				schema_version: 1,
			}),
			"utf8",
		);
	}
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "goal-state-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
	seedGoalFile(S);
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

function rawState(): any {
	return rawStateOf(S);
}

describe("goal state", () => {
	// AC #1
	test("merge-write preserves prior fields and never re-seeds started_at", () => {
		// First write: a full set of content/loop-control slots
		setGoalState(S, {
			phase: "planning",
			outcome: "ship feature X",
			verification_surface: "all tests green",
			constraints: "no new deps",
			boundaries: "do not touch billing",
			max_iterations: 7,
			blocked_stop: "when API key revoked",
			plan_path: `${tmpDir}/plans/goal-x.md`,
			resume_summary: "kicked off",
		});
		const first = readGoalState(S)!;
		const firstStartedAt = first.started_at;
		expect(firstStartedAt).toBeTruthy();

		// Second write: phase only, omitting every slot — prior fields must survive
		setGoalState(S, { phase: "pursuing" });
		const second = readGoalState(S)!;

		expect(second.phase).toBe("pursuing");
		expect(second.outcome).toBe("ship feature X");
		expect(second.verification_surface).toBe("all tests green");
		expect(second.constraints).toBe("no new deps");
		expect(second.boundaries).toBe("do not touch billing");
		expect(second.max_iterations).toBe(7);
		expect(second.blocked_stop).toBe("when API key revoked");
		expect(second.plan_path).toBe(`${tmpDir}/plans/goal-x.md`);
		expect(second.resume_summary).toBe("kicked off");
		// started_at seeded once, never re-seeded
		expect(second.started_at).toBe(firstStartedAt);
	});

	// AC #2 — each field on its OWN assertion so a missing field self-names
	test("schema enumerates all required fields", () => {
		setGoalState(S, { phase: "planning" });
		const s = rawState();
		// content slots
		expect(s).toHaveProperty("outcome");
		expect(s).toHaveProperty("verification_surface");
		expect(s).toHaveProperty("constraints");
		expect(s).toHaveProperty("boundaries");
		// loop-control slots
		expect(s).toHaveProperty("max_iterations");
		expect(s).toHaveProperty("blocked_stop");
		// FSM / control
		expect(s).toHaveProperty("phase");
		expect(s).toHaveProperty("iteration");
		expect(s).toHaveProperty("started_at");
		expect(s).toHaveProperty("active");
		expect(s).toHaveProperty("objective_verdict");
		expect(s).toHaveProperty("plan_path");
		expect(s).toHaveProperty("resume_summary");
		expect(s).toHaveProperty("budget_limit_notified");
		expect(s).toHaveProperty("blocked_reason");
		expect(s).toHaveProperty("completion_evidence_paths");
		expect(s).toHaveProperty("schema_version");
		expect(s).toHaveProperty("last_touched_at");
	});

	// AC #3 — name omits literal parens so bun's `-t` regex (the plan's exact
	// verification string `...max_iterations (default 10, override honored)`)
	// matches; bun treats `-t` as a regex, where `(...)` is a group, not literal.
	test("entry seeds phase planning and concrete max_iterations default 10, override honored", () => {
		// Default entry: no max_iterations supplied
		setGoalState(S, { phase: "planning" });
		const def = readGoalState(S)!;
		expect(def.phase).toBe("planning");
		expect(def.max_iterations).toBe(10);
		expect(Number.isFinite(def.max_iterations)).toBe(true);

		// Override honored on a fresh session
		const S2 = "override-session";
		seedGoalFile(S2);
		setGoalState(S2, { phase: "planning", max_iterations: 25 });
		const ovr = readGoalState(S2)!;
		expect(ovr.phase).toBe("planning");
		expect(ovr.max_iterations).toBe(25);
	});

	// AC #4 — structural narrow-gate
	test("complete only via request-complete; set-verdict is the only verdict writer; system-only sets budget_limited/blocked", () => {
		// (a) set() cannot produce phase=complete — it only accepts planning/pursuing
		setGoalState(S, { phase: "planning" });
		expect(() => setGoalState(S, { phase: "complete" as any })).toThrow();
		expect(readGoalState(S)!.phase).not.toBe("complete");

		// (b) set() does not write objective_verdict (no verdict param accepted)
		setVerdict(S, "REQUEST_CHANGES");
		setGoalState(S, { phase: "pursuing" });
		expect(readGoalState(S)!.objective_verdict).toBe("REQUEST_CHANGES");

		// (c) set-verdict is the verdict writer
		setVerdict(S, "APPROVE");
		expect(readGoalState(S)!.objective_verdict).toBe("APPROVE");

		// (d) request-complete is the ONLY path to phase=complete; gated on evidence
		const S2 = "gate-session";
		seedGoalFile(S2);
		setGoalState(S2, { phase: "planning", outcome: "gate test", verification_surface: "v" });
		setSingleStory(S2); // auto-confirms one story (D-7 carve-out)
		setGoalState(S2, { phase: "pursuing" });
		// no completion evidence yet -> gate refuses, stays non-complete
		expect(requestComplete(S2)).toBe(false);
		expect(readGoalState(S2)!.phase).not.toBe("complete");
		// supply evidence, then request-complete succeeds (with story artifact)
		setGoalState(S2, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/proof.txt`] });
		setVerdict(S2, "APPROVE");
		writeFileSync(
			`${tmpDir}/goal-verdict-${S2}.json`,
			JSON.stringify({
				objective_verdict: "APPROVE",
				stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["proof.txt"] }],
				verifier: "orchestrator",
				at: "2026-06-12T00:00:00",
			}),
			"utf8",
		);
		writeCodeReviewArtifact(S2, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S2)).toBe(true);
		// complete is terminal (active:false) so readGoalState returns null; assert on raw
		expect(rawStateOf(S2).phase).toBe("complete");
		expect(rawStateOf(S2).active).toBe(false);

		// (e) system-only setters drive their own terminal phases
		const S3 = "sys-session";
		seedGoalFile(S3);
		setGoalState(S3, { phase: "pursuing" });
		setBudgetLimited(S3);
		expect(readGoalState(S3)).toBeNull(); // active:false reads as null
		expect(rawStateOf(S3).phase).toBe("budget_limited");

		const S4 = "blk-session";
		seedGoalFile(S4);
		setGoalState(S4, { phase: "pursuing" });
		setBlocked(S4, "API key revoked");
		expect(rawStateOf(S4).phase).toBe("blocked");
		expect(rawStateOf(S4).blocked_reason).toBe("API key revoked");
	});

	// AC #5 — complete-wins
	test("request-complete wins over prior budget_limited when verdict APPROVE", () => {
		setGoalState(S, {
			phase: "planning",
			outcome: "complete-wins test",
			verification_surface: "v",
		});
		setSingleStory(S); // auto-confirms one story
		setGoalState(S, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/done.md`] });
		setVerdict(S, "APPROVE");
		writeFileSync(
			`${tmpDir}/goal-verdict-${S}.json`,
			JSON.stringify({
				objective_verdict: "APPROVE",
				stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["done.md"] }],
				verifier: "orchestrator",
				at: "2026-06-12T00:00:00",
			}),
			"utf8",
		);
		setBudgetLimited(S);
		expect(rawState().phase).toBe("budget_limited");

		// APPROVE-backed request-complete must win over the prior budget_limited
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
		expect(rawState().active).toBe(false);
	});

	// AC #6 — phase enum exhaustive, status 1:1
	test("phase enum exhaustive and status derives 1:1", () => {
		const phases: GoalPhase[] = ["planning", "pursuing", "budget_limited", "blocked", "complete"];
		for (const p of phases) {
			expect(deriveStatus({ phase: p })).toBe(p);
		}
		// status is exactly the phase token (1:1), nothing collapses
		const seen = new Set(phases.map((p) => deriveStatus({ phase: p })));
		expect(seen.size).toBe(phases.length);
	});

	// AC #7 — verdict round-trip; unset is absent
	test("objective verdict stored and read back; unset is absent", () => {
		setGoalState(S, { phase: "planning" });
		// unset reads absent
		expect(readGoalState(S)!.objective_verdict).toBe("absent");

		setVerdict(S, "COMMENT");
		expect(readGoalState(S)!.objective_verdict).toBe("COMMENT");
		setVerdict(S, "APPROVE");
		expect(readGoalState(S)!.objective_verdict).toBe("APPROVE");
		setVerdict(S, "absent");
		expect(readGoalState(S)!.objective_verdict).toBe("absent");
	});

	// AC #8 — planning resets verdict
	test("phase planning resets objective_verdict to absent", () => {
		setGoalState(S, { phase: "pursuing" });
		setVerdict(S, "APPROVE");
		expect(readGoalState(S)!.objective_verdict).toBe("APPROVE");

		// Re-plan: a stale APPROVE must not survive
		setGoalState(S, { phase: "planning" });
		expect(readGoalState(S)!.objective_verdict).toBe("absent");
	});

	// AC #9 — terminal phases set active false
	test("terminal phases set active false", () => {
		// complete
		const Sc = "c";
		seedGoalFile(Sc);
		setGoalState(Sc, { phase: "planning", outcome: "terminal test", verification_surface: "v" });
		setSingleStory(Sc);
		setGoalState(Sc, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/p`] });
		setVerdict(Sc, "APPROVE");
		writeFileSync(
			`${tmpDir}/goal-verdict-${Sc}.json`,
			JSON.stringify({
				objective_verdict: "APPROVE",
				stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["p"] }],
				verifier: "orchestrator",
				at: "2026-06-12T00:00:00",
			}),
			"utf8",
		);
		writeCodeReviewArtifact(Sc, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		requestComplete(Sc);
		expect(rawStateOf(Sc).active).toBe(false);

		// budget_limited
		const Sb = "b";
		seedGoalFile(Sb);
		setGoalState(Sb, { phase: "pursuing" });
		setBudgetLimited(Sb);
		expect(rawStateOf(Sb).active).toBe(false);

		// blocked
		const Sk = "k";
		seedGoalFile(Sk);
		setGoalState(Sk, { phase: "pursuing" });
		setBlocked(Sk, "no path");
		expect(rawStateOf(Sk).active).toBe(false);

		// non-terminal stays active
		const Sp = "p";
		seedGoalFile(Sp);
		setGoalState(Sp, { phase: "pursuing" });
		expect(rawStateOf(Sp).active).toBe(true);
	});

	// AC #10 — blocked never complete
	test("blocked transition never sets complete", () => {
		setGoalState(S, { phase: "pursuing" });
		setBlocked(S, "B1: no actionable story");
		expect(rawState().phase).toBe("blocked");
		expect(rawState().phase).not.toBe("complete");
	});

	// A1: request-complete refused when evidence present but verdict is not APPROVE
	test("request-complete refused when evidence present but verdict is not APPROVE", () => {
		setGoalState(S, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/a.md`] });
		// verdict intentionally left as 'absent' (default)
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
		expect(rawState().active).toBe(true);
	});

	// A1: request-complete refused when completion_evidence_paths is not an array
	test("request-complete refused when completion_evidence_paths is not an array", () => {
		// Manually write a state where completion_evidence_paths is a string (corrupted)
		writeFileSync(
			resolveStatePath(S),
			JSON.stringify({
				phase: "pursuing",
				active: true,
				objective_verdict: "APPROVE",
				completion_evidence_paths: "x",
				started_at: "2026-01-01T00:00:00",
				iteration: 0,
				max_iterations: 10,
				schema_version: 1,
				outcome: "",
				verification_surface: "",
				constraints: "",
				boundaries: "",
				blocked_stop: "",
				plan_path: "",
				resume_summary: "",
				budget_limit_notified: false,
				blocked_reason: "",
			}),
			"utf8",
		);
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
		expect(rawState().active).toBe(true);
	});

	// A1: request-complete succeeds with APPROVE and array evidence
	test("request-complete succeeds with APPROVE and array evidence", () => {
		setGoalState(S, { phase: "planning", outcome: "succeed test", verification_surface: "v" });
		setSingleStory(S);
		setGoalState(S, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/a.md`] });
		setVerdict(S, "APPROVE");
		writeFileSync(
			`${tmpDir}/goal-verdict-${S}.json`,
			JSON.stringify({
				objective_verdict: "APPROVE",
				stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["a.md"] }],
				verifier: "orchestrator",
				at: "2026-06-12T00:00:00",
			}),
			"utf8",
		);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
		expect(rawState().active).toBe(false);
	});

	// A3: set --max-iterations rejects non-numeric input
	test("set --max-iterations rejects non-numeric input", () => {
		setGoalState(S, { phase: "pursuing" });
		const prior = rawState().max_iterations;
		const script = join(import.meta.dir, "goal-state.ts");
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
		expect(() => run("set --phase pursuing --max-iterations ten")).toThrow();
		// state must be unchanged (prior max_iterations preserved)
		expect(rawState().max_iterations).toBe(prior);
	});

	// A3: set --max-iterations rejects zero / negative
	test("set --max-iterations rejects zero or negative", () => {
		setGoalState(S, { phase: "pursuing", max_iterations: 5 });
		const script = join(import.meta.dir, "goal-state.ts");
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
		expect(() => run("set --phase pursuing --max-iterations 0")).toThrow();
		expect(rawState().max_iterations).toBe(5);
		expect(() => run("set --phase pursuing --max-iterations -3")).toThrow();
		expect(rawState().max_iterations).toBe(5);
	});

	// A4: set-verdict rejects an out-of-enum verdict
	test("set-verdict rejects an out-of-enum verdict", () => {
		setGoalState(S, { phase: "pursuing" });
		const script = join(import.meta.dir, "goal-state.ts");
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
		expect(() => run("set-verdict --verdict APPROVED")).toThrow();
		// objective_verdict must remain 'absent' (not updated to invalid value)
		expect(rawState().objective_verdict).toBe("absent");
	});

	// CLI completion path — exercises the actual script end-to-end, proving the
	// `--completion-evidence` flag is wired so request-complete is reachable.
	test("CLI set --completion-evidence populates evidence so request-complete succeeds", () => {
		const script = join(import.meta.dir, "goal-state.ts");
		const p1 = `${tmpDir}/a.txt`;
		const p2 = `${tmpDir}/b.txt`;
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });

		// Seed a story so the gate can be satisfied
		run('set --phase planning --outcome "cli-evidence-test" --verification-surface "v"');
		run("set-stories --single");

		run(`set --phase pursuing --completion-evidence ${p1},${p2}`);
		expect(rawState().phase).toBe("pursuing");
		expect(rawState().completion_evidence_paths).toEqual([p1, p2]);

		run("set-verdict --verdict APPROVE");

		// Write the verdict artifact so the story gate passes
		writeFileSync(
			`${tmpDir}/goal-verdict-${S}.json`,
			JSON.stringify({
				objective_verdict: "APPROVE",
				stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: [p1] }],
				verifier: "orchestrator",
				at: "2026-06-12T00:00:00",
			}),
			"utf8",
		);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});

		// request-complete must exit 0 (no throw) now that evidence + story artifact present
		run("request-complete");
		expect(rawState().phase).toBe("complete");
		expect(rawState().active).toBe(false);
		expect(rawState().completion_evidence_paths).toEqual([p1, p2]);
	});

	// C1: a FRESH goal (planning over a terminal/inactive prior) resets the consumed
	// iteration budget — a new objective must never inherit the dead goal's iteration.
	test("C1: fresh goal over a terminal state resets iteration to 0", () => {
		// Seed a terminal (inactive) state with a fully-consumed iteration budget.
		writeFileSync(
			resolveStatePath(S),
			JSON.stringify({
				phase: "complete",
				active: false,
				objective_verdict: "APPROVE",
				completion_evidence_paths: [`${tmpDir}/a.md`],
				started_at: "2026-01-01T00:00:00",
				iteration: 10,
				max_iterations: 10,
				schema_version: 1,
				outcome: "",
				verification_surface: "",
				constraints: "",
				boundaries: "",
				blocked_stop: "",
				plan_path: "",
				resume_summary: "",
				budget_limit_notified: false,
				blocked_reason: "",
			}),
			"utf8",
		);
		// No active prior (active:false reads as null) => fresh goal.
		setGoalState(S, { phase: "planning", max_iterations: 10 });
		expect(rawState().iteration).toBe(0);
	});

	// C1: a FRESH goal must not inherit a prior objective's completion evidence —
	// evidence is only valid from the current pursuit's audit, so planning clears it.
	test("C1: fresh goal over a terminal state with prior evidence resets evidence to []", () => {
		writeFileSync(
			resolveStatePath(S),
			JSON.stringify({
				phase: "complete",
				active: false,
				objective_verdict: "APPROVE",
				completion_evidence_paths: [`${tmpDir}/a.md`],
				started_at: "2026-01-01T00:00:00",
				iteration: 3,
				max_iterations: 10,
				schema_version: 1,
				outcome: "",
				verification_surface: "",
				constraints: "",
				boundaries: "",
				blocked_stop: "",
				plan_path: "",
				resume_summary: "",
				budget_limit_notified: false,
				blocked_reason: "",
			}),
			"utf8",
		);
		setGoalState(S, { phase: "planning" });
		expect(rawState().completion_evidence_paths).toEqual([]);
	});

	// C1: a re-plan loop-back of the SAME active goal preserves the iteration budget —
	// budget accumulates across re-plans (active prior present => re-plan, not fresh).
	test("C1: re-plan over an active pursuing state preserves iteration", () => {
		setGoalState(S, { phase: "pursuing" });
		// Simulate the hook advancing the pursuit-block counter to 5 on an active goal.
		const cur = rawState();
		writeFileSync(resolveStatePath(S), JSON.stringify({ ...cur, iteration: 5 }), "utf8");
		expect(readGoalState(S)!.active).toBe(true); // active prior => re-plan
		setGoalState(S, { phase: "planning" });
		expect(rawState().iteration).toBe(5);
	});

	// V_flags: --max-iterations supplied with NO value (parsed as boolean true) must
	// exit non-zero and NOT collapse the budget to max_iterations:1.
	test("V_flags: set --max-iterations with no value exits non-zero and leaves state unchanged", () => {
		setGoalState(S, { phase: "pursuing", max_iterations: 8 });
		const priorMax = rawState().max_iterations;
		const script = join(import.meta.dir, "goal-state.ts");
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
		// --max-iterations is the last token, so parseArgs coerces it to boolean true.
		expect(() => run("set --phase pursuing --max-iterations")).toThrow();
		expect(rawState().max_iterations).toBe(priorMax);
		expect(rawState().max_iterations).not.toBe(1);
	});

	// V_flags: --completion-evidence supplied with NO value (parsed as boolean true)
	// must exit non-zero and NOT persist the bogus ["true"] evidence.
	test("V_flags: set --completion-evidence with no value exits non-zero and persists no evidence", () => {
		setGoalState(S, { phase: "pursuing" });
		const script = join(import.meta.dir, "goal-state.ts");
		const run = (cmd: string) =>
			execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
		expect(() => run("set --phase pursuing --completion-evidence")).toThrow();
		expect(rawState().completion_evidence_paths).not.toEqual(["true"]);
		expect(rawState().completion_evidence_paths).toEqual([]);
	});

	// C6: a corrupt on-disk max_iterations (non-number string) must be coerced to the
	// DEFAULT on the next merge-write rather than surviving uncoerced (it would defeat
	// the hook's iteration >= max_iterations comparison).
	test("C6: corrupt non-numeric prior max_iterations is coerced to DEFAULT on next write", () => {
		writeFileSync(
			resolveStatePath(S),
			JSON.stringify({
				phase: "pursuing",
				active: true,
				objective_verdict: "absent",
				completion_evidence_paths: [],
				started_at: "2026-01-01T00:00:00",
				iteration: 0,
				max_iterations: "not-a-number",
				schema_version: 1,
				outcome: "",
				verification_surface: "",
				constraints: "",
				boundaries: "",
				blocked_stop: "",
				plan_path: "",
				resume_summary: "",
				budget_limit_notified: false,
				blocked_reason: "",
			}),
			"utf8",
		);
		// set with no --max-iterations => candidate falls back to the corrupt prior.
		setGoalState(S, { phase: "pursuing" });
		expect(rawState().max_iterations).toBe(10);
	});
});

// A-4: readGoalState schema guard — mirrors readGoalStateRaw validation so the two
// readers can never disagree on whether a goal is active (finding A-4, 3rd /code-review).
describe("readGoalState schema guard", () => {
	function writeRaw(sessionId: string, obj: object): void {
		writeFileSync(resolveStatePath(sessionId), JSON.stringify(obj), "utf8");
	}

	const VALID_ACTIVE: object = {
		active: true,
		phase: "pursuing",
		iteration: 0,
		max_iterations: 10,
		started_at: "2026-01-01T00:00:00",
		outcome: "",
		verification_surface: "",
		constraints: "",
		boundaries: "",
		blocked_stop: "",
		plan_path: "",
		resume_summary: "",
		budget_limit_notified: false,
		blocked_reason: "",
		completion_evidence_paths: [],
		objective_verdict: "absent",
		schema_version: 1,
	};

	// A-4a: active is string "true" (truthy non-boolean) — must return null, not the object
	test('returns null when active is the string "true" (truthy non-boolean)', () => {
		writeRaw(S, { ...VALID_ACTIVE, active: "true" });
		expect(readGoalState(S)).toBeNull();
	});

	// A-4b: iteration is a non-numeric string — must return null
	test("returns null when iteration is a non-numeric string", () => {
		writeRaw(S, { ...VALID_ACTIVE, iteration: "bad" });
		expect(readGoalState(S)).toBeNull();
	});

	// A-4c: iteration is negative — must return null
	test("returns null when iteration is negative", () => {
		writeRaw(S, { ...VALID_ACTIVE, iteration: -1 });
		expect(readGoalState(S)).toBeNull();
	});

	// A-4d: max_iterations is 0 — must return null
	test("returns null when max_iterations is 0", () => {
		writeRaw(S, { ...VALID_ACTIVE, max_iterations: 0 });
		expect(readGoalState(S)).toBeNull();
	});

	// A-4e: phase is an unknown string typo — must return null
	test('returns null when phase is an unknown string ("pursuit" typo)', () => {
		writeRaw(S, { ...VALID_ACTIVE, phase: "pursuit" });
		expect(readGoalState(S)).toBeNull();
	});

	// A-4f regression: valid active state still returns the state
	test("regression: valid active state is returned normally", () => {
		writeRaw(S, VALID_ACTIVE);
		const state = readGoalState(S);
		expect(state).not.toBeNull();
		expect(state!.active).toBe(true);
		expect(state!.phase).toBe("pursuing");
	});

	// A-4g regression: valid inactive state still returns null (active-fold preserved)
	test("regression: valid inactive state returns null (active-fold preserved)", () => {
		writeRaw(S, { ...VALID_ACTIVE, active: false, phase: "complete" });
		expect(readGoalState(S)).toBeNull();
	});
});

// helper: read raw JSON for an arbitrary session id under the test OMT_DIR
function rawStateOf(sessionId: string): any {
	return JSON.parse(readFileSync(resolveStatePath(sessionId), "utf8"));
}

// --- New TODO-3 ACs ---

describe("goal-state hardening: heartbeat + no-create + hard-fail", () => {
	// (A5) goal-state refreshes last_touched_at on every write
	test("(A5) last_touched_at refreshed on every write, >= started_at", async () => {
		// S is already seeded in beforeEach
		setGoalState(S, { phase: "planning", outcome: "x" });
		const first = rawState();
		expect(first.last_touched_at).toBeTruthy();
		const firstLta: string = first.last_touched_at;
		// Wait 1 second to ensure timestamp advances
		await new Promise((r) => setTimeout(r, 1100));
		setGoalState(S, { phase: "pursuing" });
		const second = rawState();
		expect(second.last_touched_at > firstLta).toBe(true);
		expect(second.last_touched_at >= second.started_at).toBe(true);
	});

	// (self-heal-goal) goal CLI seeds the pristine skeleton when the hook never fired
	test("(self-heal-goal) setGoalState seeds then succeeds when state file is absent", () => {
		const absentSid = "absent-goal-session";
		expect(existsSync(resolveStatePath(absentSid))).toBe(false);
		expect(() => setGoalState(absentSid, { phase: "planning" })).not.toThrow();
		expect(existsSync(resolveStatePath(absentSid))).toBe(true);
		expect(readGoalState(absentSid)!.phase).toBe("planning");
	});

	// (B2) absent OMT_SESSION_ID via CLI → non-zero exit, no default file
	test("(B2) CLI exits non-zero when OMT_SESSION_ID is empty", () => {
		const script = join(import.meta.dir, "goal-state.ts");
		const env = { ...process.env, OMT_SESSION_ID: "" };
		expect(() =>
			execSync(
				`bun ${script} set --phase planning --outcome x --verification-surface y --constraints z --boundaries b --max-iterations 10 --blocked-stop s`,
				{ encoding: "utf8", env },
			),
		).toThrow();
		// No goal-state-default.json should have been created
		const defaultPath = `${tmpDir}/goal-state-default.json`;
		expect(existsSync(defaultPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const script = join(import.meta.dir, "goal-state.ts");

/** Returns a current-time ISO-8601 string with timezone offset (format used by state-core). */
function nowIso(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const tzOffset = -d.getTimezoneOffset();
	const tzSign = tzOffset >= 0 ? "+" : "-";
	const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
	const tzM = pad(Math.abs(tzOffset) % 60);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${tzSign}${tzH}:${tzM}`
	);
}

/** Build a live goal-state file for a given sid (active, recently touched, non-pristine). */
function writeLiveGoalState(sid: string, outcome: string): void {
	const path = `${tmpDir}/goal-state-${sid}.json`;
	const now = nowIso();
	writeFileSync(
		path,
		JSON.stringify({
			active: true,
			phase: "pursuing",
			iteration: 1,
			max_iterations: 10,
			outcome,
			verification_surface: "tests pass",
			constraints: "",
			boundaries: "",
			blocked_stop: "",
			plan_path: "",
			resume_summary: "",
			budget_limit_notified: false,
			blocked_reason: "",
			completion_evidence_paths: [],
			objective_verdict: "absent",
			schema_version: 1,
			started_at: now,
			last_touched_at: now,
		}),
		"utf8",
	);
}

/** Write a pristine goal-state seed for a given sid. */
function writePristineGoalState(sid: string): void {
	const path = `${tmpDir}/goal-state-${sid}.json`;
	const now = nowIso();
	writeFileSync(
		path,
		JSON.stringify({
			active: true,
			phase: "planning",
			iteration: 0,
			max_iterations: 10,
			outcome: "",
			verification_surface: "",
			constraints: "",
			boundaries: "",
			blocked_stop: "",
			plan_path: "",
			resume_summary: "",
			budget_limit_notified: false,
			blocked_reason: "",
			completion_evidence_paths: [],
			objective_verdict: "absent",
			schema_version: 1,
			started_at: now,
			last_touched_at: now,
		}),
		"utf8",
	);
}

function runCli(args: string, env?: Record<string, string>): string {
	return execSync(`bun ${script} ${args}`, {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

describe("adoption: list-others + adopt (goal CLI)", () => {
	// (F2-goal) list-others surfaces ACTIVE-live other-session candidate, excludes self
	test("F2-goal: list-others shows other-session A candidate (outcome as purpose), excludes self B", () => {
		writeLiveGoalState("A", "ship X");
		writePristineGoalState("B");
		const out = runCli("list-others", { OMT_SESSION_ID: "B" });
		// A must appear with its purpose "ship X"
		expect(out).toContain("A");
		expect(out).toContain("ship X");
		// Self (B) must not appear
		const lines = out.trim().split("\n").filter(Boolean);
		expect(lines.every((l) => !l.includes("goal-state-B"))).toBe(true);
		// B sid must not appear as a candidate
		expect(lines.some((l) => / B[ \t]|^B[ \t]|\tB\t/.test(l) || l.startsWith("B "))).toBe(false);
	});

	// (label) candidate line carries all 4 required fields: short-sid, purpose, started_at, idle seconds
	test("label: list-others output line for A has sid prefix + purpose + started_at + idle-seconds", () => {
		writeLiveGoalState("sidABC12345", "build feature Y");
		const out = runCli("list-others", { OMT_SESSION_ID: "otherSession" });
		// sid appears (first 8 chars minimum)
		expect(out).toContain("sidABC12");
		// purpose
		expect(out).toContain("build feature Y");
		// started_at (ISO date pattern)
		expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
		// idle seconds (integer)
		expect(out).toMatch(/\d+s/);
	});

	// (F3-cli) adopt re-keys: source A gone, target B holds A's content, exit 0
	test("F3-cli: adopt --src A re-keys A into B; A absent, B holds A content", () => {
		writeLiveGoalState("A", "purpose P");
		writePristineGoalState("B");
		runCli("adopt --src A", { OMT_SESSION_ID: "B" });
		// A must be gone
		expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
		// B must hold A's content (outcome = "purpose P")
		const b = JSON.parse(readFileSync(`${tmpDir}/goal-state-B.json`, "utf8"));
		expect(b.outcome).toBe("purpose P");
		// adoption.log must have one entry
		const log = readFileSync(`${tmpDir}/adoption.log`, "utf8");
		expect(log).toContain("goal");
		expect(log).toContain("A -> B");
	});

	// (F6-cli) adopt refused on ACTIVE non-pristine current; both files unchanged
	test("F6-cli: adopt refused when current B is ACTIVE non-pristine; both files unchanged", () => {
		writeLiveGoalState("A", "purpose A");
		writeLiveGoalState("B", "ongoing work"); // non-pristine active
		const aContent = readFileSync(`${tmpDir}/goal-state-A.json`, "utf8");
		const bContent = readFileSync(`${tmpDir}/goal-state-B.json`, "utf8");
		// adopt must fail (non-zero exit)
		expect(() => runCli("adopt --src A", { OMT_SESSION_ID: "B" })).toThrow();
		// Both files must be unchanged
		expect(readFileSync(`${tmpDir}/goal-state-A.json`, "utf8")).toBe(aContent);
		expect(readFileSync(`${tmpDir}/goal-state-B.json`, "utf8")).toBe(bContent);
	});

	// (dormancy-goal) adopted-away live source's old-sid write → non-zero, file still absent
	test("dormancy-goal: after adoption, session A write to goal-state-A.json is refused (no-create)", () => {
		writeLiveGoalState("A", "purpose dormancy");
		writePristineGoalState("B");
		// adopt A into B
		runCli("adopt --src A", { OMT_SESSION_ID: "B" });
		expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
		// Now session A tries to write — must fail non-zero (no-create semantics)
		expect(() => runCli("set --phase pursuing", { OMT_SESSION_ID: "A" })).toThrow();
		// File must still be absent
		expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// F2/F10: get subcommand pristine field (RED tests — must fail before implementation)
// ---------------------------------------------------------------------------

describe("get subcommand includes pristine field", () => {
	// (F2-get-pristine) A freshly seeded state (phase=planning, iteration=0, outcome='')
	// must report pristine:true in get output so the SKILL.md gate can distinguish its
	// own seed from a real in-flight pursuit.
	test("F2-get-pristine: get returns pristine:true for a freshly seeded state", () => {
		// S is seeded in beforeEach with phase=planning, iteration=0, outcome=''
		const result = readGoalGet(S);
		expect(result).not.toBeNull();
		expect(result!.pristine).toBe(true);
	});

	// (F2-get-not-pristine-outcome) Once the orchestrator writes a real outcome, the
	// seed is no longer pristine — get must report pristine:false.
	test("F2-get-not-pristine-outcome: get returns pristine:false after outcome is set", () => {
		setGoalState(S, { phase: "planning", outcome: "ship feature X" });
		const result = readGoalGet(S);
		expect(result).not.toBeNull();
		expect(result!.pristine).toBe(false);
	});

	// (F2-get-not-pristine-pursuing) Phase=pursuing is not pristine (iteration may be 0
	// but phase has advanced past planning).
	test("F2-get-not-pristine-pursuing: get returns pristine:false when phase is pursuing", () => {
		setGoalState(S, { phase: "pursuing" });
		const result = readGoalGet(S);
		expect(result).not.toBeNull();
		expect(result!.pristine).toBe(false);
	});

	// (F2-get-cli) CLI `get` subcommand JSON output contains pristine field.
	test("F2-get-cli: CLI get output JSON contains pristine field", () => {
		const out = runCli("get");
		const parsed = JSON.parse(out);
		expect(typeof parsed.pristine).toBe("boolean");
		expect(parsed.pristine).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// F10/ADR-7: writeFileNoCreate — no TOCTOU race in merge-write path
// ---------------------------------------------------------------------------

describe("mergeWrite uses writeFileNoCreate (no TOCTOU race)", () => {
	// (F10-no-create-after-adopt) After an adopt-away, the orphaned session's merge-write
	// must be refused, not silently recreate the file (split-brain). Two layers enforce it:
	// ensureSeed's adoption.log guard refuses to re-seed an adopted-away sid, and
	// writeFileNoCreate's single open('r+') throws ENOENT on a concurrent mid-write rename.
	// A faithful adopt-away leaves BOTH the rename and the adoption.log line (real adopt()
	// records the log), so we mirror both here.
	test("F10-no-create-after-adopt: merge-write refused after adopt-away (no resurrection)", () => {
		setGoalState(S, { phase: "planning", outcome: "test" });
		const src = resolveStatePath(S);
		renameSync(src, src + ".adopted");
		appendFileSync(
			`${tmpDir}/adoption.log`,
			`2026-06-16T12:00:00+09:00 goal ${S} -> OTHER\n`,
			"utf8",
		);
		// Now session S tries to write — must be refused, not silently recreated
		expect(() => setGoalState(S, { phase: "pursuing" })).toThrow();
		expect(existsSync(src)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// TODO 1: Story schema + ingestion (set-stories, --single) + mergeWrite whitelist
// ---------------------------------------------------------------------------

describe("story layer: set-stories", () => {
	/** A minimal valid story for use in tests. */
	const validStory: Story = {
		id: "S1",
		story: "ship feature X",
		acceptance_criteria: ["all tests green"],
		verification_surface: "CI pipeline passes",
		status: "unconfirmed",
	};

	/** Seed a state with a non-empty outcome so ingestion is not refused. */
	function seedWithOutcome(sid: string, outcome = "ship feature X"): void {
		setGoalState(sid, { phase: "planning", outcome });
	}

	// AC-1a: valid story set ingested via set-stories --json persists in get output
	test("story ingestion persists", () => {
		seedWithOutcome(S);
		const story2: Story = {
			id: "S2",
			story: "add observability",
			acceptance_criteria: ["dashboards visible", "alerts firing"],
			verification_surface: "Grafana dashboard",
			status: "unconfirmed",
		};
		setStories(S, [validStory, story2]);
		const state = readGoalGet(S)!;
		expect(state).not.toBeNull();
		expect(Array.isArray(state.stories)).toBe(true);
		expect(state.stories!.length).toBe(2);
		expect(state.stories![0].id).toBe("S1");
		expect(state.stories![0].status).toBe("unconfirmed");
		expect(state.stories![1].id).toBe("S2");
		expect(state.stories![1].status).toBe("unconfirmed");
	});

	// AC-1b-i: refuses empty story set
	test("ingestion rejects zero-stories", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		expect(() => setStories(S, [])).toThrow();
		// State file must be byte-identical
		const stateAfter = readFileSync(resolveStatePath(S), "utf8");
		expect(stateAfter).toBe(stateBefore);
	});

	// AC-1b-ii: refuses story with no acceptance criteria
	test("ingestion rejects story-without-AC", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const noAC = { ...validStory, acceptance_criteria: [] };
		expect(() => setStories(S, [noAC])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-1b-iii: refuses story missing verification_surface
	test("ingestion rejects missing-verification-surface", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const noSurface = { ...validStory, verification_surface: "" };
		expect(() => setStories(S, [noSurface])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-1b-iv: refuses when outcome is empty
	test("ingestion rejects empty-outcome", () => {
		// S is seeded with empty outcome by default
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		expect(() => setStories(S, [validStory])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-1b-v: refuses duplicate story ids
	test("ingestion rejects duplicate-ids", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const dup: Story = { ...validStory, id: "S1" };
		expect(() => setStories(S, [validStory, dup])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-3: set-stories --single derives exactly one story (text == outcome), status confirmed
	test("single-WHAT auto-derivation", () => {
		setGoalState(S, {
			phase: "planning",
			outcome: "deploy new service",
			verification_surface: "smoke tests pass in staging",
		});
		setSingleStory(S);
		const state = readGoalGet(S)!;
		expect(state.stories).toBeDefined();
		expect(state.stories!.length).toBe(1);
		const s = state.stories![0];
		expect(s.id).toBe("S1");
		expect(s.story).toBe("deploy new service");
		expect(s.acceptance_criteria).toEqual(["smoke tests pass in staging"]);
		expect(s.verification_surface).toBe("smoke tests pass in staging");
		expect(s.status).toBe("confirmed");
		// Must not require a separate confirm-story call — already pursuing-eligible
		setGoalState(S, { phase: "pursuing" });
		expect(readGoalGet(S)!.phase).toBe("pursuing");
	});

	// AC-10: stories-bearing state is not pristine and not in list-others candidates
	test("stories state is not pristine", () => {
		seedWithOutcome(S);
		setStories(S, [validStory]);
		const state = readGoalGet(S)!;
		expect(state.pristine).toBe(false);
		// adopt into S (ACTIVE non-pristine) must be refused (r3 destination fence)
		const other = "other-session";
		writeLiveGoalState(other, "other purpose");
		const sContentBefore = readFileSync(resolveStatePath(S), "utf8");
		expect(() => runCli("adopt --src " + other, { OMT_SESSION_ID: S })).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(sContentBefore);
	});

	// finding 8 — id 비-공백 검증: id 누락 스토리를 거부하고 상태 불변
	test("ingestion: id가 빈 문자열인 스토리를 거부하고 상태 불변", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const noId = { ...validStory, id: "" };
		expect(() => setStories(S, [noId])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// finding 8 — id 비-공백 검증: id 키가 아예 없는 스토리도 거부 (LLM JSON 오타 시나리오)
	test("ingestion: id 키가 없는 스토리를 거부하고 상태 불변", () => {
		seedWithOutcome(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const { id: _omit, ...noIdKey } = validStory;
		expect(() => setStories(S, [noIdKey as Story])).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// finding 7 — setSingleStory 빈 verification_surface: 미설정 상태에서 --single 거부 + 상태 불변
	test("setSingleStory: verification_surface가 비어 있으면 거부하고 상태 불변", () => {
		setGoalState(S, { phase: "planning", outcome: "deploy new service" });
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		expect(() => setSingleStory(S)).toThrow("set-stories --single: refused");
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-13: stories[] survives non-story writes (mergeWrite whitelist)
	test("stories survive non-story writes", () => {
		seedWithOutcome(S);
		setStories(S, [validStory]);
		// Non-story writes: set --resume-summary and set-verdict
		setGoalState(S, { phase: "planning", resume_summary: "updated summary" });
		setVerdict(S, "APPROVE");
		const state = readGoalGet(S)!;
		expect(Array.isArray(state.stories)).toBe(true);
		expect(state.stories!.length).toBe(1);
		expect(state.stories![0].id).toBe("S1");
		expect(state.stories![0].status).toBe("unconfirmed");
	});
});

// ---------------------------------------------------------------------------
// TODO 2: Confirmation + phase-transition gates
// ---------------------------------------------------------------------------

describe("story layer: confirmation and phase gates", () => {
	/** A minimal valid story for use in tests. */
	const validStory: Story = {
		id: "S1",
		story: "ship feature X",
		acceptance_criteria: ["all tests green"],
		verification_surface: "CI pipeline passes",
		status: "unconfirmed",
	};
	const validStory2: Story = {
		id: "S2",
		story: "add observability",
		acceptance_criteria: ["dashboards visible"],
		verification_surface: "Grafana dashboard",
		status: "unconfirmed",
	};

	function seedWithOutcome(sid: string, outcome = "ship feature X"): void {
		setGoalState(sid, { phase: "planning", outcome });
	}

	// AC-2a: pursuing refused while any story unconfirmed; succeeds after all confirmed
	test("pursuing refused while unconfirmed", () => {
		seedWithOutcome(S);
		setStories(S, [validStory, validStory2]);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		// Attempt pursuing while both stories unconfirmed — must throw naming S1 or S2
		let err: Error | undefined;
		try {
			setGoalState(S, { phase: "pursuing" });
		} catch (e) {
			err = e as Error;
		}
		expect(err).toBeDefined();
		// stderr message must name the offending story id
		expect(err!.message).toMatch(/S1|S2/);
		// State must be unchanged
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);

		// Confirm S1, still refused because S2 is unconfirmed
		confirmStory(S, "S1");
		let err2: Error | undefined;
		try {
			setGoalState(S, { phase: "pursuing" });
		} catch (e) {
			err2 = e as Error;
		}
		expect(err2).toBeDefined();
		expect(err2!.message).toMatch(/S2/);
		// S1 must NOT appear since it is confirmed
		expect(err2!.message).not.toMatch(/\bS1\b/);

		// Confirm S2 — now pursuing must succeed
		confirmStory(S, "S2");
		setGoalState(S, { phase: "pursuing" });
		expect(readGoalGet(S)!.phase).toBe("pursuing");
	});

	// AC-2b: confirm-story is the sole path unconfirmed → confirmed
	test("confirm-story flips status", () => {
		seedWithOutcome(S);
		setStories(S, [validStory]);
		// confirm-story flips the story to confirmed
		confirmStory(S, "S1");
		const afterConfirm = readGoalGet(S)!;
		expect(afterConfirm.stories![0].status).toBe("confirmed");

		// Re-ingest via set-stories --json always produces unconfirmed
		setStories(S, [{ ...validStory, status: "confirmed" as any }]);
		expect(readGoalGet(S)!.stories![0].status).toBe("unconfirmed");

		// set cannot produce confirmed
		seedWithOutcome(S);
		setStories(S, [validStory]);
		confirmStory(S, "S1");
		setGoalState(S, { phase: "planning", outcome: "new outcome" });
		// stories should survive; S1 remains confirmed after a non-story set write
		// (this also tests that set cannot flip status to anything)
		const afterSet = readGoalGet(S)!;
		expect(afterSet.stories![0].status).toBe("confirmed");

		// set-verdict cannot produce confirmed on a story
		setVerdict(S, "APPROVE");
		expect(readGoalGet(S)!.stories![0].status).toBe("confirmed"); // still confirmed, not changed by set-verdict

		// Confirm refused on unknown id
		let errUnknown: Error | undefined;
		try {
			confirmStory(S, "UNKNOWN_ID");
		} catch (e) {
			errUnknown = e as Error;
		}
		expect(errUnknown).toBeDefined();

		// Confirm refused on retired story — set up a retired story
		const S2 = "confirm-retired-session";
		seedGoalFile(S2);
		seedWithOutcome(S2);
		setStories(S2, [{ ...validStory, id: "R1" }]);
		// Manually write retired status
		const raw = JSON.parse(readFileSync(resolveStatePath(S2), "utf8"));
		raw.stories[0].status = "retired";
		writeFileSync(resolveStatePath(S2), JSON.stringify(raw, null, 2), "utf8");
		let errRetired: Error | undefined;
		try {
			confirmStory(S2, "R1");
		} catch (e) {
			errRetired = e as Error;
		}
		expect(errRetired).toBeDefined();
		// State unchanged after refusal
		expect(JSON.parse(readFileSync(resolveStatePath(S2), "utf8")).stories[0].status).toBe(
			"retired",
		);
	});

	// AC-5: re-plan preserves stories and statuses, resets verdict/evidence as today
	test("replan preserves stories", () => {
		seedWithOutcome(S);
		setStories(S, [validStory, validStory2]);
		// Confirm both stories so we can enter pursuing
		confirmStory(S, "S1");
		confirmStory(S, "S2");
		// Enter pursuing and set evidence and verdict (mimicking end of pursuit attempt)
		setGoalState(S, { phase: "pursuing", completion_evidence_paths: [`${tmpDir}/a.md`] });
		setVerdict(S, "APPROVE");
		expect(readGoalGet(S)!.objective_verdict).toBe("APPROVE");
		expect(readGoalGet(S)!.completion_evidence_paths).toEqual([`${tmpDir}/a.md`]);
		// Re-plan: goes back to planning
		setGoalState(S, { phase: "planning" });
		const state = readGoalGet(S)!;
		// verdict and evidence must be reset exactly as today (existing reset behaviour)
		expect(state.objective_verdict).toBe("absent");
		expect(state.completion_evidence_paths).toEqual([]);
		// stories and per-story statuses must be preserved (AC-5 new behaviour)
		expect(Array.isArray(state.stories)).toBe(true);
		expect(state.stories!.length).toBe(2);
		const s1 = state.stories!.find((s) => s.id === "S1")!;
		const s2 = state.stories!.find((s) => s.id === "S2")!;
		expect(s1.status).toBe("confirmed");
		expect(s2.status).toBe("confirmed");
	});

	// AC-12: set still cannot write complete or objective_verdict (regression with stories present)
	test("set cannot write complete or objective_verdict", () => {
		seedWithOutcome(S);
		setStories(S, [validStory]);
		// set cannot write phase=complete
		expect(() => setGoalState(S, { phase: "complete" as any })).toThrow();
		expect(readGoalGet(S)!.phase).not.toBe("complete");
		// set cannot write objective_verdict — even if stories are present
		// (SetGoalOpts has no objective_verdict field by design; compile-time fence)
		// At runtime: set --phase planning must not alter objective_verdict if it was set by set-verdict
		setVerdict(S, "REQUEST_CHANGES");
		setGoalState(S, { phase: "planning", outcome: "updated outcome" });
		// planning resets verdict to absent (existing behaviour), stories must remain
		expect(readGoalGet(S)!.objective_verdict).toBe("absent");
		expect(readGoalGet(S)!.stories!.length).toBe(1);
		// set --phase pursuing (after confirming) also must not write objective_verdict
		confirmStory(S, "S1");
		setGoalState(S, { phase: "pursuing" });
		expect(readGoalGet(S)!.objective_verdict).toBe("absent");
	});
});

// ---------------------------------------------------------------------------
// TODO 3: Mutation subcommands with anti-dodge fences
// ---------------------------------------------------------------------------

describe("story layer: mutations", () => {
	const baseStory: Story = {
		id: "S1",
		story: "ship feature X",
		acceptance_criteria: ["all tests green"],
		verification_surface: "CI pipeline passes",
		status: "unconfirmed",
	};
	const baseStory2: Story = {
		id: "S2",
		story: "add observability",
		acceptance_criteria: ["dashboards visible"],
		verification_surface: "Grafana dashboard",
		status: "unconfirmed",
	};

	function seedWithStories(
		sid: string,
		stories: Story[] = [baseStory],
		phase: "planning" | "pursuing" = "planning",
	): void {
		setGoalState(sid, { phase: "planning", outcome: "ship feature X" });
		setStories(sid, stories);
		if (phase === "pursuing") {
			// confirm all stories first so pursuing gate is satisfied
			for (const s of stories) {
				confirmStory(sid, s.id);
			}
			setGoalState(sid, { phase: "pursuing" });
		}
	}

	// AC-4a: revise/add/retire each mutate the targeted story (by id) as specified
	test("mutation subcommands", () => {
		seedWithStories(S, [baseStory, baseStory2], "pursuing");

		// revise-story: patches story fields and resets status to unconfirmed
		// S1 was confirmed before entering pursuing; revise must reset it
		reviseStory(
			S,
			"S1",
			{
				story: "ship feature X v2",
				acceptance_criteria: ["all tests green", "perf meets SLO"],
			},
			"e",
			"r",
		);
		const afterRevise = readGoalGet(S)!.stories!;
		const s1 = afterRevise.find((s) => s.id === "S1")!;
		expect(s1.story).toBe("ship feature X v2");
		expect(s1.acceptance_criteria).toEqual(["all tests green", "perf meets SLO"]);
		expect(s1.status).toBe("unconfirmed"); // revise ALWAYS resets to unconfirmed

		// add-story: appends a new unconfirmed story (allowed in pursuing)
		const newStory: Omit<Story, "status"> = {
			id: "S3",
			story: "add search",
			acceptance_criteria: ["search returns results"],
			verification_surface: "E2E search test",
		};
		addStory(S, newStory as Story, "e", "r");
		const afterAdd = readGoalGet(S)!.stories!;
		expect(afterAdd.length).toBe(3);
		const s3 = afterAdd.find((s) => s.id === "S3")!;
		expect(s3.status).toBe("unconfirmed");
		expect(s3.story).toBe("add search");

		// retire-story: sets retired (S2 was confirmed; we're in pursuing — but S2 is confirmed
		// so this should be refused. Let's use the unconfirmed S1 instead, since revise reset it)
		// S1 is now unconfirmed, S3 is unconfirmed — retire S3 (unconfirmed, pursuing => allowed)
		retireStory(S, "S3", "e", "r");
		const afterRetire = readGoalGet(S)!.stories!;
		const s3After = afterRetire.find((s) => s.id === "S3")!;
		expect(s3After.status).toBe("retired");
	});

	// AC-4b: no mutation subcommand can write a status outside the enum or write confirmed
	test("mutation fence rejects", () => {
		seedWithStories(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");

		// revise with an explicit confirmed status in the patch must be refused
		// (no mutation may produce confirmed)
		expect(() => reviseStory(S, "S1", { status: "confirmed" as any }, "e", "r")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);

		// revise with an out-of-enum status must be refused
		expect(() => reviseStory(S, "S1", { status: "achieved" as any }, "e", "r")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);

		// add-story with confirmed status must be refused
		const confirmedStory: Story = {
			id: "S2",
			story: "new story",
			acceptance_criteria: ["passes"],
			verification_surface: "manual test",
			status: "confirmed",
		};
		expect(() => addStory(S, confirmedStory, "e", "r")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);

		// add-story with out-of-enum status must be refused
		const badStatusStory: Story = {
			id: "S2",
			story: "new story",
			acceptance_criteria: ["passes"],
			verification_surface: "manual test",
			status: "open" as any,
		};
		expect(() => addStory(S, badStatusStory, "e", "r")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-4c: revise-story on a confirmed story resets to unconfirmed; on a retired story is refused
	test("revise resets confirmation", () => {
		seedWithStories(S);
		// Confirm S1
		confirmStory(S, "S1");
		expect(readGoalGet(S)!.stories![0].status).toBe("confirmed");

		// Revise S1 (confirmed) — must reset to unconfirmed
		reviseStory(S, "S1", { story: "ship feature X revised" }, "e", "r");
		const afterRevise = readGoalGet(S)!.stories![0];
		expect(afterRevise.story).toBe("ship feature X revised");
		expect(afterRevise.status).toBe("unconfirmed"); // reset from confirmed

		// Set S1 to retired via raw file write (to test retire-revise refusal)
		const raw = JSON.parse(readFileSync(resolveStatePath(S), "utf8"));
		raw.stories[0].status = "retired";
		writeFileSync(resolveStatePath(S), JSON.stringify(raw, null, 2), "utf8");
		expect(readGoalGet(S)!.stories![0].status).toBe("retired");

		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		// Revise S1 (retired) — must be refused
		expect(() => reviseStory(S, "S1", { story: "attempt resurrect" }, "e", "r")).toThrow();
		// State unchanged
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// AC-4d: retire-story on confirmed story refused while pursuing; allowed while planning;
	//        unconfirmed story retirable in any phase
	test("retire fence", () => {
		// Fixture 1: confirmed story + pursuing => exit 1 (retire-to-dodge fence)
		const Sp = "pursuing-confirmed";
		seedGoalFile(Sp);
		seedWithStories(Sp, [baseStory], "pursuing");
		// S1 is confirmed (confirmed before entering pursuing)
		expect(readGoalGet(Sp)!.stories![0].status).toBe("confirmed");
		expect(readGoalGet(Sp)!.phase).toBe("pursuing");
		const stateBeforeFence = readFileSync(resolveStatePath(Sp), "utf8");
		expect(() => retireStory(Sp, "S1", "e", "r")).toThrow(); // D-9 anti-dodge fence
		expect(readFileSync(resolveStatePath(Sp), "utf8")).toBe(stateBeforeFence);

		// Fixture 2: confirmed story + planning => allowed (retire is legal, not a dodge)
		const Spl = "planning-confirmed";
		seedGoalFile(Spl);
		setGoalState(Spl, { phase: "planning", outcome: "ship X" });
		setStories(Spl, [baseStory]);
		confirmStory(Spl, "S1");
		expect(readGoalGet(Spl)!.stories![0].status).toBe("confirmed");
		expect(readGoalGet(Spl)!.phase).toBe("planning");
		retireStory(Spl, "S1", "e", "r"); // must NOT throw
		expect(readGoalGet(Spl)!.stories![0].status).toBe("retired");

		// Fixture 3: unconfirmed story + pursuing => allowed (not a dodge — no confirmation to bypass)
		const Su = "pursuing-unconfirmed";
		seedGoalFile(Su);
		// Seed with one confirmed story so the pursuing gate passes, then add an unconfirmed one
		setGoalState(Su, { phase: "planning", outcome: "ship X" });
		setStories(Su, [baseStory, baseStory2]);
		confirmStory(Su, "S1");
		confirmStory(Su, "S2");
		setGoalState(Su, { phase: "pursuing" });
		// Now manually make S2 unconfirmed so we can test retire on unconfirmed-during-pursuing
		const raw = JSON.parse(readFileSync(resolveStatePath(Su), "utf8"));
		raw.stories[1].status = "unconfirmed";
		writeFileSync(resolveStatePath(Su), JSON.stringify(raw, null, 2), "utf8");
		expect(readGoalGet(Su)!.stories![1].status).toBe("unconfirmed");
		expect(readGoalGet(Su)!.phase).toBe("pursuing");
		retireStory(Su, "S2", "e", "r"); // must NOT throw (unconfirmed is retirable in any phase)
		expect(readGoalGet(Su)!.stories![1].status).toBe("retired");
	});

	// AC-11: a failed story write leaves state unchanged and never enables completion
	test("story write failure is benign", () => {
		seedWithStories(S);
		// Record the prior state before the attempted write
		const priorContent = readFileSync(resolveStatePath(S), "utf8");

		// Simulate write failure: remove the state file so writeFileNoCreate throws ENOENT
		unlinkSync(resolveStatePath(S));

		// All three mutation subcommands must fail nonzero when the file is absent
		// (the file was removed — writeFileNoCreate will throw ENOENT)
		expect(() => reviseStory(S, "S1", { story: "should fail" }, "e", "r")).toThrow();
		expect(() =>
			addStory(
				S,
				{
					id: "S2",
					story: "new",
					acceptance_criteria: ["ac"],
					verification_surface: "manual",
					status: "unconfirmed",
				},
				"e",
				"r",
			),
		).toThrow();
		expect(() => retireStory(S, "S1", "e", "r")).toThrow();

		// Restore prior state to verify it was not mutated during failed writes
		writeFileSync(resolveStatePath(S), priorContent, "utf8");
		const restoredContent = readFileSync(resolveStatePath(S), "utf8");
		const restored = JSON.parse(restoredContent);

		// No completion-enabling field was mutated:
		// phase must not be complete, objective_verdict must not be APPROVE (it was absent),
		// stories must be unchanged
		expect(restored.phase).not.toBe("complete");
		expect(restored.objective_verdict).toBe("absent");
		expect(restored.stories[0].status).toBe("unconfirmed");
		expect(restored.stories[0].story).toBe("ship feature X");
		expect(restored.active).toBe(true);
	});

	// finding 5 — revise-story id 충돌 가드
	test("revise-story: patch.id가 다른 스토리와 충돌하면 거부하고 상태 불변", () => {
		seedWithStories(S, [baseStory, baseStory2]);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");

		// S1을 patch해서 id를 S2(이미 존재)로 바꾸려는 시도 → 거부
		expect(() => reviseStory(S, "S1", { id: "S2" }, "e", "r")).toThrow(/revise-story: refused/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});

	// finding 6 — add-story: outcome 없는 상태에서 거부하고 상태 불변
	test("add-story: outcome이 비어 있으면 거부하고 상태 불변", () => {
		// seed 직후(outcome='') 상태 재현: setGoalState outcome 없이 phase=planning
		seedGoalFile(S);
		// outcome이 빈 채로 story 추가 시도
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		const newStory: Story = {
			id: "S1",
			story: "ship feature X",
			acceptance_criteria: ["all tests green"],
			verification_surface: "CI pipeline passes",
			status: "unconfirmed",
		};
		expect(() => addStory(S, newStory, "e", "r")).toThrow(/add-story: refused/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
	});
});

// ---------------------------------------------------------------------------
// TODO 4: Re-derived per-story verdict gate
// ---------------------------------------------------------------------------

/**
 * Helpers for the T4 gate tests.
 * Artifact lives at $OMT_DIR/goal-verdict-{sid}.json (mirrors state path convention).
 */
function verdictArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/goal-verdict-${sid}.json`;
}

function writeVerdictArtifact(sid: string, obj: object): void {
	writeFileSync(verdictArtifactPath(sid), JSON.stringify(obj), "utf8");
}

/** Code-review lane artifact path: $OMT_DIR/goal-codereview-{sid}.json (mirrors verdict path). */
function codeReviewArtifactPath(sid: string): string {
	return `${process.env.OMT_DIR}/goal-codereview-${sid}.json`;
}

function writeCodeReviewArtifact(sid: string, obj: object): void {
	writeFileSync(codeReviewArtifactPath(sid), JSON.stringify(obj), "utf8");
}

/** Build a fully-satisfied gate fixture for one session:
 *  - 2 confirmed stories (S1, S2)
 *  - evidence paths set
 *  - objective_verdict = APPROVE
 *  Returns the artifact that would pass the gate. */
function buildSatisfiedFixture(sid: string): object {
	// State
	setGoalState(sid, { phase: "planning", outcome: "ship it" });
	const s1: Story = {
		id: "S1",
		story: "ship",
		acceptance_criteria: ["ac1"],
		verification_surface: "v1",
		status: "unconfirmed",
	};
	const s2: Story = {
		id: "S2",
		story: "test",
		acceptance_criteria: ["ac2"],
		verification_surface: "v2",
		status: "unconfirmed",
	};
	setStories(sid, [s1, s2]);
	confirmStory(sid, "S1");
	confirmStory(sid, "S2");
	setGoalState(sid, {
		phase: "pursuing",
		completion_evidence_paths: [`${process.env.OMT_DIR}/evidence.md`],
	});
	setVerdict(sid, "APPROVE");
	// Code-review lane: a clean (no-findings) artifact so the second completion lane passes
	// by default. Callers asserting a BLOCK overwrite this with a CONFIRMED/invalid one.
	writeCodeReviewArtifact(sid, {
		status: "COMPLETE",
		findings: [],
		reviewer: "code-reviewer",
		at: "2026-06-12T00:00:00",
	});

	// Valid artifact
	return {
		objective_verdict: "APPROVE",
		stories: [
			{ id: "S1", verdict: "APPROVE", evidence_refs: ["evidence.md"] },
			{ id: "S2", verdict: "APPROVE", evidence_refs: ["evidence.md"] },
		],
		verifier: "orchestrator",
		at: "2026-06-12T10:00:00",
	};
}

describe("story layer: request-complete verdict gate (T4)", () => {
	// AC-6a: artifact schema validation — malformed and unknown-id both rejected
	test("artifact schema validation", () => {
		buildSatisfiedFixture(S);

		// Malformed: missing required fields (no `stories` array)
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");

		// Unknown story id in artifact
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: [] },
				{ id: "UNKNOWN", verdict: "APPROVE", evidence_refs: [] }, // unknown
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// AC-6b-i: gate refuses when the artifact is absent
	test("gate refuses artifact-absent", () => {
		buildSatisfiedFixture(S);
		// No artifact file written — must refuse
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// AC-6b-ii: gate refuses when exactly one story is non-APPROVE despite state APPROVE
	// Precedence rule (D-3): non-APPROVE story entry blocks regardless of objective_verdict
	test("gate refuses single-story-non-APPROVE", () => {
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE", // state also has APPROVE
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				{ id: "S2", verdict: "REQUEST_CHANGES", evidence_refs: [] }, // one non-APPROVE
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		// state objective_verdict === 'APPROVE' but one story entry is REQUEST_CHANGES
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
		expect(rawState().phase).toBe("pursuing");
	});

	// AC-6b-iii: gate refuses when dual gate is unmet
	test("gate refuses dual-gate-unmet", () => {
		// Set up stories but NO verdict set (stays 'absent')
		setGoalState(S, { phase: "planning", outcome: "obj" });
		const s1: Story = {
			id: "S1",
			story: "x",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		confirmStory(S, "S1");
		setGoalState(S, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/e.md`],
		});
		// objective_verdict stays 'absent' — dual gate unmet
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] }],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// AC-6b-iv: gate refuses when any non-retired story is unconfirmed
	// Scenario: story added mid-flight (add-story) without confirm, then request-complete attempted
	test("gate refuses unconfirmed-story", () => {
		// Start with a confirmed story so we can enter pursuing
		setGoalState(S, { phase: "planning", outcome: "obj" });
		const s1: Story = {
			id: "S1",
			story: "x",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		confirmStory(S, "S1");
		setGoalState(S, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/e.md`],
		});
		setVerdict(S, "APPROVE");
		// Add a new story mid-flight (born unconfirmed) — now an unconfirmed story exists
		addStory(
			S,
			{
				id: "S2",
				story: "new mid-flight story",
				acceptance_criteria: ["ac2"],
				verification_surface: "v2",
				status: "unconfirmed",
			},
			"e",
			"r",
		);
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				{ id: "S2", verdict: "APPROVE", evidence_refs: ["e.md"] },
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		// S2 is unconfirmed — gate must refuse
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// AC-6b-v: gate refuses when artifact omits an entry for a non-retired story;
	//          a fixture with an extra retired-story entry still passes (ignored)
	test("gate refuses missing-artifact-entry", () => {
		// Fixture A: artifact missing S2 entry
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				// S2 entry deliberately omitted
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");

		// Fixture B: state has S1 (confirmed) + S2 (retired); artifact has S1 entry + extra retired-S2 entry
		// Extra retired entry is ignored; S1 APPROVE => should pass
		const S2 = "gate-retired-extra";
		seedGoalFile(S2);
		setGoalState(S2, { phase: "planning", outcome: "obj2" });
		const sa: Story = {
			id: "S1",
			story: "x",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		const sb: Story = {
			id: "S2",
			story: "y",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		setStories(S2, [sa, sb]);
		confirmStory(S2, "S1");
		// Retire S2 while planning (allowed)
		retireStory(S2, "S2", "e", "r");
		setGoalState(S2, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/e.md`],
		});
		setVerdict(S2, "APPROVE");
		// Artifact has both entries (S2 retired entry is extra — should be ignored)
		writeVerdictArtifact(S2, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				{ id: "S2", verdict: "APPROVE", evidence_refs: [] }, // retired story — ignored
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		writeCodeReviewArtifact(S2, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S2)).toBe(true);
		expect(rawStateOf(S2).phase).toBe("complete");
	});

	// AC-6b-vi: all checks satisfied => phase=complete written
	test("gate completes when all satisfied", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
		expect(rawState().active).toBe(false);
	});

	// AC-6c: zero non-retired stories => refused even with dual gate satisfied
	test("gate refuses all-retired", () => {
		setGoalState(S, { phase: "planning", outcome: "obj" });
		const s1: Story = {
			id: "S1",
			story: "x",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		confirmStory(S, "S1");
		// Retire S1 while planning (allowed)
		retireStory(S, "S1", "e", "r");
		setGoalState(S, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/e.md`],
		});
		setVerdict(S, "APPROVE");
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [], // no entries for retired story (correct — retired is ignored)
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// 중복 story id 거부: [RC, APPROVE] 순서 — last-wins Map 방어
	test("아티팩트에 중복 story id가 있으면 거부한다 (RC→APPROVE 순서)", () => {
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "REQUEST_CHANGES", evidence_refs: [] }, // 첫 번째
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] }, // 중복 — 현재 last-wins
				{ id: "S2", verdict: "APPROVE", evidence_refs: ["e.md"] },
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// 중복 story id 거부: [APPROVE, RC] 순서 — 양방향 검증
	test("아티팩트에 중복 story id가 있으면 거부한다 (APPROVE→RC 순서)", () => {
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "APPROVE",
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] }, // 첫 번째
				{ id: "S1", verdict: "REQUEST_CHANGES", evidence_refs: [] }, // 중복
				{ id: "S2", verdict: "APPROVE", evidence_refs: ["e.md"] },
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// 아티팩트 objective_verdict 비-APPROVE 거부: REQUEST_CHANGES
	test("아티팩트 objective_verdict가 REQUEST_CHANGES면 스토리·state 전부 APPROVE여도 거부한다", () => {
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "REQUEST_CHANGES", // state는 APPROVE, 스토리도 전부 APPROVE
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				{ id: "S2", verdict: "APPROVE", evidence_refs: ["e.md"] },
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// 아티팩트 objective_verdict 비-APPROVE 거부: COMMENT
	test("아티팩트 objective_verdict가 COMMENT면 스토리·state 전부 APPROVE여도 거부한다", () => {
		buildSatisfiedFixture(S);
		writeVerdictArtifact(S, {
			objective_verdict: "COMMENT", // state는 APPROVE, 스토리도 전부 APPROVE
			stories: [
				{ id: "S1", verdict: "APPROVE", evidence_refs: ["e.md"] },
				{ id: "S2", verdict: "APPROVE", evidence_refs: ["e.md"] },
			],
			verifier: "orchestrator",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});
});

// ---------------------------------------------------------------------------
// TODO 1: code-review 완료 레인 (두 번째 독립 거부 레인)
// ---------------------------------------------------------------------------

describe("story layer: code-review completion lane (TODO 1)", () => {
	// AC1: a CONFIRMED finding (correctness OR cleanup) blocks completion even when
	// the objective lane is fully green. The gate keys ONLY on verdict===CONFIRMED.
	test("code-review CONFIRMED blocks completion (cleanup class)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact); // objective lane fully green
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "cleanup", verdict: "CONFIRMED", ref: "foo.ts:1" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	test("code-review CONFIRMED blocks completion (correctness class)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "correctness", verdict: "CONFIRMED", ref: "foo.ts:2" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	// AC2: a clean code-review (no findings / PLAUSIBLE-only) permits completion.
	test("code-review clean permits completion (empty findings)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
	});

	test("code-review clean permits completion (PLAUSIBLE only)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "cleanup", verdict: "PLAUSIBLE", ref: "foo.ts:3" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
	});

	// AC3: absent / corrupt / unknown-verdict / empty-reviewer each refuses (no throw),
	// phase unchanged (never-false-complete: degrade toward block).
	test("code-review invalid artifact refuses (absent)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		rmSync(codeReviewArtifactPath(S), { force: true }); // ensure the code-review artifact is absent
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	test("code-review invalid artifact refuses (corrupt json)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeFileSync(codeReviewArtifactPath(S), "{not json", "utf8");
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	test("code-review invalid artifact refuses (unknown verdict)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "correctness", verdict: "BOGUS", ref: "foo.ts:4" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	test("code-review invalid artifact refuses (empty reviewer)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	// AC8: re-plan unlinks the code-review artifact (ADR-3 stale-vector); a fresh objective
	// cannot false-complete on a prior objective's clean code-review.
	test("re-plan unlinks code-review artifact", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(existsSync(codeReviewArtifactPath(S))).toBe(true);

		// Re-plan (planning transition) must invalidate the code-review artifact.
		setGoalState(S, { phase: "planning", outcome: "새 목표" });
		expect(existsSync(codeReviewArtifactPath(S))).toBe(false);

		// New pursuit, all objective-side gates re-satisfied, but no fresh code-review artifact.
		const s1: Story = {
			id: "S1",
			story: "new",
			acceptance_criteria: ["ac1"],
			verification_surface: "v1",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		confirmStory(S, "S1");
		setGoalState(S, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/evidence.md`],
		});
		setVerdict(S, "APPROVE");
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});
});

// ---------------------------------------------------------------------------
// TODO 2: inconclusive-state (D1 = Option B, status required)
// ---------------------------------------------------------------------------

describe("story layer: code-review INCONCLUSIVE status (TODO 2)", () => {
	// RED: an artifact whose review itself did not finish (status=INCONCLUSIVE)
	// must block completion even when findings are empty and every other gate
	// (objective verdict, evidence, confirmed stories) is green. Distinct from
	// the CONFIRMED-finding block: here the review never rendered a verdict at all.
	test("code-review status INCONCLUSIVE blocks completion even with empty findings", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "INCONCLUSIVE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});

	// required-status fail-safe: a legacy/malformed artifact with no `status` key
	// at all must be schema-invalid (never default-coerced to COMPLETE) — the
	// reader must refuse it outright, degrading toward block (never-false-complete).
	test("code-review artifact missing status is schema-invalid (readCodeReviewArtifact null)", () => {
		writeCodeReviewArtifact(S, { findings: [], reviewer: "code-reviewer", at: "2026-06-12T00:00:00" });
		expect(readCodeReviewArtifact(S)).toBeNull();
	});

	// control (GREEN): status COMPLETE + empty findings + every other gate green -> true.
	test("code-review status COMPLETE with empty findings permits completion (control)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
	});

	// control (GREEN, existing behavior preserved): status COMPLETE + a CONFIRMED
	// finding still blocks completion — INCONCLUSIVE handling must not loosen this.
	test("code-review status COMPLETE with a CONFIRMED finding still blocks completion (control)", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "correctness", verdict: "CONFIRMED", ref: "foo.ts:9" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});
});

// ---------------------------------------------------------------------------
// TODO 6: requirement-gap class (Hop E) + serialize-requirements (Hop B)
// ---------------------------------------------------------------------------

describe("requirement-gap class: validator accepts and gate keys on verdict", () => {
	// AC18: requirement-gap must be in BOTH the class union AND VALID_CLASSES.
	// A PLAUSIBLE requirement-gap finding must NOT block completion — the gate
	// keys only on verdict===CONFIRMED, class is informational.
	// RED: currently VALID_CLASSES=['correctness','cleanup'] → artifact null → false (not true).
	test("PLAUSIBLE requirement-gap finding does not block completion", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "requirement-gap", verdict: "PLAUSIBLE", ref: "foo.ts:1" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(true);
		expect(rawState().phase).toBe("complete");
	});

	// A CONFIRMED requirement-gap finding must block completion (verdict gate).
	// Currently also false (wrong reason: class unknown → artifact null).
	// After fix: false for right reason (CONFIRMED verdict).
	test("CONFIRMED requirement-gap finding blocks completion", () => {
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		writeCodeReviewArtifact(S, {
			status: "COMPLETE",
			findings: [{ class: "requirement-gap", verdict: "CONFIRMED", ref: "foo.ts:2" }],
			reviewer: "code-reviewer",
			at: "2026-06-12T00:00:00",
		});
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).toBe("pursuing");
	});
});

describe("serialize-requirements subcommand", () => {
	// Exact format: [id] story — AC: a1; a2 — verify: surface, one line per story + trailing newline.
	// RED: serializeRequirements does not exist yet.
	test("exact output for a confirmed multi-AC story", () => {
		setGoalState(S, { phase: "planning", outcome: "ship it" });
		const story: Story = {
			id: "S1",
			story: "ship the feature",
			acceptance_criteria: ["the UI renders", "data persists"],
			verification_surface: "playwright e2e green",
			status: "unconfirmed",
		};
		setStories(S, [story]);
		confirmStory(S, "S1");
		const out = serializeRequirements(S);
		expect(out).toBe(
			"[S1] ship the feature — AC: the UI renders; data persists — verify: playwright e2e green\n",
		);
	});

	// Zero-confirmed / all-retired → empty string (empty block).
	test("empty output when all stories are retired", () => {
		setGoalState(S, { phase: "planning", outcome: "ship it" });
		const s1: Story = {
			id: "S1",
			story: "old story",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		retireStory(S, "S1", "e", "r");
		const out = serializeRequirements(S);
		expect(out).toBe("");
	});

	// Zero stories → empty string.
	test("empty output when no stories exist", () => {
		const out = serializeRequirements(S);
		expect(out).toBe("");
	});

	// CLI dispatch: serialize-requirements subcommand prints the confirmed story block.
	test("CLI dispatch prints confirmed story block", () => {
		setGoalState(S, { phase: "planning", outcome: "ship it" });
		const story: Story = {
			id: "S1",
			story: "ship the feature",
			acceptance_criteria: ["green", "deployed"],
			verification_surface: "smoke test",
			status: "unconfirmed",
		};
		setStories(S, [story]);
		confirmStory(S, "S1");
		const out = runCli("serialize-requirements");
		expect(out).toContain("[S1] ship the feature");
		expect(out).toContain("AC: green; deployed");
		expect(out).toContain("verify: smoke test");
	});
});

// ---------------------------------------------------------------------------
// TODO 5: re-plan 시 verdict 아티팩트 파일 무효화 (ADR-3)
// ---------------------------------------------------------------------------

describe("re-plan 시 verdict 아티팩트 무효화", () => {
	// AC: goal A 완료(아티팩트 존재) → re-plan(planning 전환) →
	//     새 evidence + state APPROVE 갖췄지만 새 아티팩트 없는 상태에서 requestComplete는 false
	test("re-plan 후 구 아티팩트가 없는 상태에서 requestComplete가 false를 반환한다", () => {
		// Phase 1 — goal A 완료까지 진행
		const artifact = buildSatisfiedFixture(S);
		writeVerdictArtifact(S, artifact);
		// 아티팩트 파일이 존재하는지 확인
		expect(existsSync(verdictArtifactPath(S))).toBe(true);

		// Phase 2 — re-plan (planning 전환)
		setGoalState(S, { phase: "planning", outcome: "새 목표" });
		// re-plan 후 아티팩트 파일이 삭제됐어야 함
		expect(existsSync(verdictArtifactPath(S))).toBe(false);

		// Phase 3 — 새 evidence + state APPROVE 갖추되 새 아티팩트는 작성하지 않음
		const s1: Story = {
			id: "S1",
			story: "new",
			acceptance_criteria: ["ac1"],
			verification_surface: "v1",
			status: "unconfirmed",
		};
		setStories(S, [s1]);
		confirmStory(S, "S1");
		setGoalState(S, {
			phase: "pursuing",
			completion_evidence_paths: [`${process.env.OMT_DIR}/evidence.md`],
		});
		setVerdict(S, "APPROVE");
		// 아티팩트 없이 requestComplete 호출 → false (구 아티팩트로 false-complete 불가)
		expect(requestComplete(S)).toBe(false);
		expect(rawState().phase).not.toBe("complete");
	});

	// AC: 아티팩트가 없는 최초 planning 전환에서도 ENOENT 무시 (정상 진행)
	test("아티팩트가 없는 상태에서 planning 전환이 정상 완료된다", () => {
		// 아티팩트 없이 planning → pursuing 전환
		setGoalState(S, { phase: "planning", outcome: "초기 목표" });
		// 에러 없이 진행됐는지 확인
		expect(rawState().phase).toBe("planning");
	});
});

// ---------------------------------------------------------------------------
// TODO 8: WHAT-freeze — outcome/verification_surface become structurally
// immutable once phase=pursuing (ADR D-6). set() must refuse to rewrite either
// slot while pursuing; planning remains a legitimate re-plan path for both.
// ---------------------------------------------------------------------------

describe("WHAT-freeze: outcome/verification_surface frozen during pursuing", () => {
	test("pursuing refuses frozen slots", () => {
		// Realistic sequence: outcome/verification_surface are decided during planning,
		// then the orchestrator transitions to pursuing WITHOUT re-supplying them.
		setGoalState(S, {
			phase: "planning",
			outcome: "A",
			verification_surface: "surface A",
		});
		setGoalState(S, { phase: "pursuing" });
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");

		// outcome is frozen: attempting to rewrite it while pursuing throws and
		// leaves the state file byte-identical.
		expect(() => setGoalState(S, { phase: "pursuing", outcome: "B" })).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
		expect(rawState().outcome).toBe("A");

		// verification_surface is frozen the same way.
		expect(() =>
			setGoalState(S, { phase: "pursuing", verification_surface: "surface B" }),
		).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
		expect(rawState().verification_surface).toBe("surface A");
	});

	test("planning writes outcome", () => {
		setGoalState(S, {
			phase: "planning",
			outcome: "A",
			verification_surface: "surface A",
		});
		setGoalState(S, { phase: "pursuing" });
		// planning is a legitimate re-plan path — both slots remain writable.
		setGoalState(S, {
			phase: "planning",
			outcome: "B",
			verification_surface: "surface B",
		});
		expect(rawState().outcome).toBe("B");
		expect(rawState().verification_surface).toBe("surface B");
	});

	// --completion-evidence must remain reachable while pursuing — the freeze guard
	// must not catch it, or request-complete could never record evidence again.
	test("CLI: pursuing --completion-evidence still succeeds with frozen outcome", () => {
		runCli('set --phase planning --outcome "A" --verification-surface "surface A"');
		runCli("set-stories --single");
		runCli(`set --phase pursuing --completion-evidence ${tmpDir}/a.txt`);
		expect(rawState().phase).toBe("pursuing");
		expect(rawState().completion_evidence_paths).toEqual([`${tmpDir}/a.txt`]);
	});

	// CLI-level: rewriting outcome mid-pursuit exits non-zero and leaves outcome unchanged.
	test("CLI: set --phase pursuing --outcome exits non-zero and outcome unchanged", () => {
		runCli('set --phase planning --outcome "A" --verification-surface "surface A"');
		runCli("set-stories --single");
		runCli("set --phase pursuing");
		expect(() => runCli('set --phase pursuing --outcome "B"')).toThrow();
		expect(rawState().outcome).toBe("A");
	});
});

// ---------------------------------------------------------------------------
// TODO 10: mid-flight steering mutations (add-story/revise-story/retire-story)
// require two separate reason fields — --evidence (what was observed) and
// --rationale (why this is the right response). Neither has a default; an
// omitted or whitespace-only value is a hard refusal (ADR D-4). Fixtures below
// deliberately avoid the confirmed+pursuing anti-dodge fence (D-9) so the ONLY
// source of refusal in the "requires" tests is the new steering guard.
// ---------------------------------------------------------------------------

describe("mid-flight steering: --evidence/--rationale required (TODO 10)", () => {
	/** phase=pursuing, outcome="A", one CONFIRMED story ("story-1"). The fence
	 * (D-9) only bites a confirmed+pursuing RETIRE, so add-story/revise-story
	 * against this fixture always have a clear (fence-free) path to success —
	 * any rejection observed here can only come from the new steering guard. */
	function seedConfirmedPursuing(sid: string): void {
		setGoalState(sid, { phase: "planning", outcome: "A", verification_surface: "surface A" });
		setStories(sid, [
			{
				id: "story-1",
				story: "s1",
				acceptance_criteria: ["ac"],
				verification_surface: "v",
				status: "unconfirmed",
			},
		]);
		confirmStory(sid, "story-1");
		setGoalState(sid, { phase: "pursuing" });
	}

	test("steering requires evidence and rationale", () => {
		seedConfirmedPursuing(S);

		// add-story: no phase gate at all — outcome is set, so the fence cannot fire.
		const newStoryJson = JSON.stringify({
			id: "story-2",
			story: "s2",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
		});
		expect(() => runCli(`add-story --json '${newStoryJson}'`)).toThrow();
		expect(
			JSON.parse(runCli("get")).stories.some((s: any) => s.id === "story-2"),
		).toBe(false);
		expect(() =>
			runCli(`add-story --json '${newStoryJson}' --evidence "   " --rationale "y"`),
		).toThrow();
		expect(
			JSON.parse(runCli("get")).stories.some((s: any) => s.id === "story-2"),
		).toBe(false);

		// revise-story: no phase gate at all.
		expect(() =>
			runCli(`revise-story story-1 --json '{"story":"s1 revised"}'`),
		).toThrow();
		expect(() =>
			runCli(
				`revise-story story-1 --json '{"story":"s1 revised"}' --evidence "e" --rationale "   "`,
			),
		).toThrow();
		expect(JSON.parse(runCli("get")).stories[0].story).toBe("s1");

		// retire-story: target the fence-safe UNCONFIRMED story (per fixture discipline —
		// a confirmed+pursuing target would let the pre-existing anti-dodge fence produce
		// the non-zero exit, proving nothing about the new guard).
		addStory(
			S,
			{
				id: "story-3",
				story: "s3",
				acceptance_criteria: ["ac"],
				verification_surface: "v",
				status: "unconfirmed",
			},
			"seed evidence",
			"seed rationale",
		);
		expect(() => runCli("retire-story story-3")).toThrow();
		expect(
			JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-3").status,
		).toBe("unconfirmed");
		expect(() =>
			runCli('retire-story story-3 --evidence "   " --rationale "y"'),
		).toThrow();
		expect(
			JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-3").status,
		).toBe("unconfirmed");
	});

	test("steering persists reason and freezes outcome", () => {
		seedConfirmedPursuing(S);

		addStory(
			S,
			{
				id: "story-2",
				story: "s2",
				acceptance_criteria: ["ac"],
				verification_surface: "v",
				status: "unconfirmed",
			},
			"observed X",
			"because Y",
		);
		const afterAdd = readGoalGet(S)!.stories!.find((s) => s.id === "story-2")!;
		expect(afterAdd.steering_evidence).toBe("observed X");
		expect(afterAdd.steering_rationale).toBe("because Y");
		expect(rawState().outcome).toBe("A");

		reviseStory(S, "story-2", { story: "s2 revised" }, "observed Z", "because W");
		const afterRevise = readGoalGet(S)!.stories!.find((s) => s.id === "story-2")!;
		expect(afterRevise.story).toBe("s2 revised");
		expect(afterRevise.steering_evidence).toBe("observed Z");
		expect(afterRevise.steering_rationale).toBe("because W");
		expect(rawState().outcome).toBe("A");

		retireStory(S, "story-2", "observed Q", "because R");
		const afterRetire = readGoalGet(S)!.stories!.find((s) => s.id === "story-2")!;
		expect(afterRetire.status).toBe("retired");
		expect(afterRetire.steering_evidence).toBe("observed Q");
		expect(afterRetire.steering_rationale).toBe("because R");
		expect(rawState().outcome).toBe("A");
	});

	// The anti-dodge fence (D-9) must survive the new contract untouched: supplying
	// BOTH required flags must not become a bypass route for a confirmed+pursuing retire.
	test("confirmed story cannot be retired during pursuit", () => {
		seedConfirmedPursuing(S);
		const stateBefore = readFileSync(resolveStatePath(S), "utf8");
		expect(() => retireStory(S, "story-1", "e", "r")).toThrow(/retire-story: refused/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(stateBefore);
		expect(readGoalGet(S)!.stories!.find((s) => s.id === "story-1")!.status).toBe(
			"confirmed",
		);
	});

	// D-13: the id must come from the parsed positional, not from a raw argv scan that
	// misreads the FIRST non-"--"-prefixed token — which, once --evidence/--rationale take
	// values, can be a flag's value rather than the id.
	test("story id is not taken from a flag value", () => {
		setGoalState(S, { phase: "planning", outcome: "A", verification_surface: "surface A" });
		addStory(
			S,
			{
				id: "story-9",
				story: "s9",
				acceptance_criteria: ["ac"],
				verification_surface: "v",
				status: "unconfirmed",
			},
			"seed evidence",
			"seed rationale",
		);
		// Flags precede the positional id; "obs" is NOT a story id — if the scan misreads
		// it as the id, retireStory would throw "unknown story id" and this would fail.
		runCli('retire-story --evidence "obs" --rationale "r" story-9');
		expect(
			JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-9").status,
		).toBe("retired");
	});

	// Regression guard: set-stories/set-single-story must NOT gain the new flags — bulk
	// replacement is re-planning, not steering, and the two flags are steering-specific.
	test("set-stories remains planning-only", () => {
		setGoalState(S, { phase: "planning", outcome: "A", verification_surface: "surface A" });
		setStories(S, [
			{
				id: "story-1",
				story: "s1",
				acceptance_criteria: ["ac"],
				verification_surface: "v",
				status: "unconfirmed",
			},
		]);
		confirmStory(S, "story-1");
		setGoalState(S, { phase: "pursuing" });
		// set-stories still refuses outside planning on the PRE-EXISTING phase gate — no
		// evidence/rationale flags are involved anywhere in this subcommand.
		expect(() =>
			runCli(
				`set-stories --json '[{"id":"story-2","story":"s2","acceptance_criteria":["ac"],"verification_surface":"v","status":"unconfirmed"}]'`,
			),
		).toThrow();
		expect(JSON.parse(runCli("get")).stories.length).toBe(1);
	});

	// A free-text --evidence/--rationale value that itself begins with "--" (e.g. quoting
	// a CLI flag in an observation) must not be coerced to boolean by parseArgs and then
	// misdiagnosed by requireSteeringReason as "missing".
	test("steering reason value may begin with dashes", () => {
		seedConfirmedPursuing(S);

		const newStoryJson = JSON.stringify({
			id: "story-4",
			story: "s4",
			acceptance_criteria: ["ac"],
			verification_surface: "v",
		});
		runCli(
			`add-story --json '${newStoryJson}' --evidence "--dry-run flag exposed a race" --rationale "fix needed"`,
		);
		const afterAdd = JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-4");
		expect(afterAdd.steering_evidence).toBe("--dry-run flag exposed a race");
		expect(afterAdd.status).toBe("unconfirmed");

		runCli(
			`revise-story story-4 --json '{"story":"s4 revised"}' --evidence "--weird" --rationale "--also weird"`,
		);
		const afterRevise = JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-4");
		expect(afterRevise.story).toBe("s4 revised");
		expect(afterRevise.steering_evidence).toBe("--weird");
		expect(afterRevise.steering_rationale).toBe("--also weird");

		// id must still resolve from the positional, not get swallowed as a flag value.
		runCli('retire-story story-4 --evidence "--weird" --rationale "r"');
		const afterRetire = JSON.parse(runCli("get")).stories.find((s: any) => s.id === "story-4");
		expect(afterRetire.status).toBe("retired");

		// A genuinely missing value (last token) must still be refused.
		expect(() => runCli("retire-story story-1 --evidence")).toThrow();
	});
});

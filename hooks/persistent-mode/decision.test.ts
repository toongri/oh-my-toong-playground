import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "fs";
import { makeDecision, DecisionContext } from "./decision.ts";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("makeDecision", () => {
	const testDir = join(tmpdir(), "persistent-mode-decision-test-" + Date.now());
	const projectRoot = join(testDir, "project");
	const omtDir = join(testDir, "omt");
	const stateDir = join(omtDir, "state");

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(stateDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		// Clean up state files between tests
		await rm(omtDir, { recursive: true, force: true });
		await mkdir(stateDir, { recursive: true });
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	const createContext = (overrides: Partial<DecisionContext> = {}): DecisionContext => ({
		projectRoot,
		sessionId: "test-session",
		lastAssistantMessage: null,
		incompleteTodoCount: 0,
		activeSubagentCount: 0,
		...overrides,
	});

	describe("no blocking conditions", () => {
		it("should return continue: true when no state files and no incomplete todos", () => {
			const context = createContext();

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("should return continue: true when all todos are completed", () => {
			const context = createContext({ incompleteTodoCount: 0 });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});
	});

	describe("Priority 2: Baseline todo-continuation", () => {
		it("should block and return todo-continuation message when incomplete todos exist", () => {
			const context = createContext({ incompleteTodoCount: 5 });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
			expect(result.reason).toContain("INCOMPLETE TASKS DETECTED - 5 remaining");
			expect(result.reason).toContain("Review your remaining tasks");
		});

		it("should create attempt files when blocking for baseline todos", async () => {
			const context = createContext({ incompleteTodoCount: 2 });

			makeDecision(context);

			const { existsSync } = await import("fs");
			const attemptFile = join(stateDir, "block-count-test-session");
			expect(existsSync(attemptFile)).toBe(true);
		});

		it("should allow stop after max continuation attempts (escape hatch)", async () => {
			// Set attempt count to max
			await writeFile(join(stateDir, "block-count-test-session"), "5");

			const context = createContext({ incompleteTodoCount: 3 });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("should cleanup attempt files when escape hatch triggers", async () => {
			// Set attempt count to max
			await writeFile(join(stateDir, "block-count-test-session"), "5");

			const context = createContext({ incompleteTodoCount: 3 });

			makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(join(stateDir, "block-count-test-session"))).toBe(false);
		});

		it("should allow stop when no incomplete todos", () => {
			const context = createContext({ incompleteTodoCount: 0 });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});
	});

	describe("priority ordering", () => {
		it("should use baseline todo-continuation when incomplete todos exist", () => {
			const context = createContext({ incompleteTodoCount: 3 });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});
	});

	describe("Priority 1.5: Deep Interview Protection", () => {
		it("makeDecision blocks with deep-interview-continuation when state active and no token", async () => {
			const deepInterviewState = {
				active: true,
				sessionId: "test-session",
				started_at: new Date().toISOString(),
				last_touched_at: new Date().toISOString(),
				state: { phase: "in_progress" },
			};
			await writeFile(
				join(omtDir, "deep-interview-active-state-test-session.json"),
				JSON.stringify(deepInterviewState),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("makeDecision cleans up deep-interview state when token present in lastAssistantMessage", async () => {
			const deepInterviewState = {
				active: true,
				sessionId: "test-session",
				started_at: new Date().toISOString(),
				last_touched_at: new Date().toISOString(),
				state: { phase: "in_progress" },
			};
			await writeFile(
				join(omtDir, "deep-interview-active-state-test-session.json"),
				JSON.stringify(deepInterviewState),
			);

			const context = createContext({
				lastAssistantMessage: "Interview complete. <deep-interview-done/>",
			});

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(join(omtDir, "deep-interview-active-state-test-session.json"))).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("makeDecision deletes active:false terminal marker via raw reader (no done-token required)", async () => {
			// Seed an active:false terminal marker — the normal readDeepInterviewState folds this to null,
			// so without the raw reader the delete branch never fires and the file orphans.
			const deepInterviewState = { active: false, sessionId: "test-session" };
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(markerPath, JSON.stringify(deepInterviewState));

			// No done-token in the message — the fix must use the raw reader to detect active:false.
			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("makeDecision preserves active:true marker and emits continuation (no done-token)", async () => {
			// An active interview with no done-token must still be blocked and the marker kept.
			const deepInterviewState = {
				active: true,
				sessionId: "test-session",
				started_at: new Date().toISOString(),
				last_touched_at: new Date().toISOString(),
				state: { phase: "in_progress" },
			};
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(markerPath, JSON.stringify(deepInterviewState));

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		// -------------------------------------------------------------------------
		// Pristine deep-interview state: seed-only file (no rich `state` object)
		// must be INERT — must NOT block session stop.
		// -------------------------------------------------------------------------

		it("pristine DI seed (no state key, active:true) does NOT block session stop", async () => {
			// Seed-only file: written by pre-tool-enforcer.sh before the skill prose runs.
			// If the skill call died (permission denial, ESC, crash) no rich `state` is ever
			// written — the seed orphans. A pristine state is INERT to all consumers.
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: "2025-01-01T00:00:00+00:00",
					last_touched_at: "2025-01-01T00:00:00+00:00",
					// no `state` key — this is the pristine definition per isPristine('deep-interview')
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			// A pristine seed must NOT produce a block.
			expect(result).toEqual({ continue: true });
		});

		it("non-pristine active DI state (has state key) still blocks session stop", async () => {
			// A DI state with a rich `state` object is non-pristine AND live (recent heartbeat) —
			// the interview is genuinely in progress and must continue blocking until the
			// done-token or active:false.
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: { phase: "in_progress", answers: {} },
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("stale (TTL-expired) non-pristine active DI does NOT block — GC reaps it", async () => {
			// active:true + non-pristine but idle past ACTIVE_IDLE_TTL (6h): the interview
			// process is effectively dead. session-start GC (is_state_live) already treats
			// it as reapable; the Stop hook is the second consumer and must agree, NOT
			// wedge the session on a corpse the GC will sweep.
			const stale = "2020-01-01T00:00:00+00:00";
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: stale,
					last_touched_at: stale,
					state: { phase: "in_progress", answers: {} },
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});
	});

	describe("Priority 1.5: Prometheus State Protection", () => {
		it("makeDecision blocks with prometheus-continuation when state active and no token", async () => {
			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<prometheus-continuation>");
		});

		it("makeDecision cleans up prometheus state when token present in lastAssistantMessage", async () => {
			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "Plan complete. <prometheus-done/>" });

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(join(omtDir, "prometheus-state-test-session.json"))).toBe(false);
			expect(result.reason ?? "").not.toContain("<prometheus-continuation>");
		});

		it("makeDecision allows stop after MAX_BLOCK_COUNT token-less blocks (bounded escape)", async () => {
			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "no token here" });

			// First call should block (prometheus active, no token, below ceiling)
			const firstResult = makeDecision(context);
			expect(firstResult.decision).toBe("block");

			// Drive blockCount to ceiling (MAX_BLOCK_COUNT = 5; first call already incremented to 1)
			for (let i = 1; i < 5; i++) {
				makeDecision(context);
			}
			// This call is at/past ceiling — must NOT block
			const escapedResult = makeDecision(context);
			expect(escapedResult.decision).not.toBe("block");
		});

		it("(regression) todo block-count pre-loaded to MAX does not shorten prometheus protection", async () => {
			// Seed the shared todo counter key (block-count-${attemptId}) to MAX_BLOCK_COUNT
			// so that if prometheus wrongly shares it, it would escape immediately.
			await writeFile(join(stateDir, "block-count-test-session"), "5");

			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "working on it, no done token" });

			const result = makeDecision(context);

			// Prometheus uses its own counter key so the pre-loaded todo counter must NOT trigger escape.
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<prometheus-continuation>");
		});

		it("(regression) prometheus-specific counter reaches MAX_BLOCK_COUNT → escape", async () => {
			// Pre-load prometheus-specific counter to MAX_BLOCK_COUNT
			await writeFile(join(stateDir, "block-count-prometheus-test-session"), "5");

			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "working on it, no done token" });

			const result = makeDecision(context);

			// Prometheus counter at ceiling → escape allowed
			expect(result.decision).not.toBe("block");
			expect(result).toEqual({ continue: true });
		});

		it("(regression) done-token cleanup also deletes prometheus-specific counter file", async () => {
			// Pre-load prometheus-specific counter to simulate in-progress session
			await writeFile(join(stateDir, "block-count-prometheus-test-session"), "3");

			const prometheusState = {
			active: true,
			sessionId: "test-session",
			started_at: new Date().toISOString(),
			last_touched_at: new Date().toISOString(),
		};
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify(prometheusState),
			);

			const context = createContext({ lastAssistantMessage: "All done. <prometheus-done/>" });

			makeDecision(context);

			const { existsSync } = await import("fs");
			// Prometheus state file deleted
			expect(existsSync(join(omtDir, "prometheus-state-test-session.json"))).toBe(false);
			// Prometheus-specific counter file also deleted
			expect(existsSync(join(stateDir, "block-count-prometheus-test-session"))).toBe(false);
		});

		it("stale (TTL-expired) active prometheus does NOT block — GC reaps it", async () => {
			// active:true but idle past ACTIVE_IDLE_TTL (6h): the planning process is
			// effectively dead. Consistent with session-start GC, the Stop hook must NOT
			// wedge the session on a corpse the GC will sweep.
			const stale = "2020-01-01T00:00:00+00:00";
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: stale,
					last_touched_at: stale,
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});
	});

	describe("Priority 1.4: Goal autonomous pursuit loop", () => {
		const goalPath = join(omtDir, "goal-state-test-session.json");

		const writeGoal = async (state: Record<string, unknown>) => {
			await writeFile(goalPath, JSON.stringify(state));
		};

		const readGoalFile = async (): Promise<Record<string, unknown>> => {
			const { readFileSync } = await import("fs");
			return JSON.parse(readFileSync(goalPath, "utf8"));
		};

		it("goal yields for any non-pursuing phase incl fresh entry", async () => {
			await writeGoal({
				active: true,
				phase: "planning",
				objective_verdict: "",
				iteration: 0,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result).toEqual({ continue: true });
			// No iteration++ for non-pursuing phase
			const after = await readGoalFile();
			expect(after.iteration).toBe(0);
		});

		it("goal blocks when objective unmet incl absent verdict during pursuit", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				// objective_verdict intentionally absent
				iteration: 2,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("[GOAL - ITERATION 3/10]");
			const after = await readGoalFile();
			expect(after.iteration).toBe(3);
		});

		it("APPROVE alone does not allow the stop", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 2,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			// APPROVE falls through to the normal block-and-increment path — only
			// request-complete's terminal state (active:false) allows the stop.
			const after = await readGoalFile();
			expect(after.iteration).toBe(3);
		});

		it("terminal complete still allows the stop", async () => {
			// This is the state request-complete (skills/goal/scripts/goal-state.ts) writes —
			// the only legitimate allow-stop path once APPROVE's shortcut is removed.
			await writeGoal({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 3,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result).toEqual({ continue: true });
		});

		it("budget exhaustion soft-stops without completing", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "REQUEST_CHANGES",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
			expect(after.budget_limit_notified).toBe(true);
			// No iteration++ on cap path
			expect(after.iteration).toBe(10);
		});

		it("cap reached with APPROVE coinciding → budget_limited soft-stop, not complete", async () => {
			// complete-wins (ADR-7) applies only when request-complete gate is called;
			// decision.ts must not write phase='complete' directly even when verdict=APPROVE.
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
				completion_evidence_paths: ["artifacts/report.md"],
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
			expect(after.budget_limit_notified).toBe(true);
		});

		it("goal pursuit ignores shared block-count hatch", async () => {
			// Block-count already at the baseline escape-hatch limit (5)
			await writeFile(join(stateDir, "block-count-test-session"), "5");
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 3,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

			// Goal still blocks even though shared block-count is maxed out
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("[GOAL - ITERATION 4/10]");
			const after = await readGoalFile();
			expect(after.iteration).toBe(4);
		});

		it("goal active suppresses baseline todo branch", async () => {
			await writeGoal({
				active: true,
				phase: "planning",
				objective_verdict: "",
				iteration: 0,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 5 }));

			// Yields without firing baseline todo-continuation
			expect(result).toEqual({ continue: true });
			expect(result.reason ?? "").not.toContain("<todo-continuation>");
		});

		it("goal pursuit fires when only goal-state exists on disk", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("[GOAL - ITERATION 2/10]");
		});

		it("continuation has untrusted_objective wrap", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "SENTINEL_OBJECTIVE_TEXT",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<untrusted_objective>");
			expect(result.reason).toContain("</untrusted_objective>");
			expect(result.reason).toContain("SENTINEL_OBJECTIVE_TEXT");
		});

		it("continuation has iteration and tokens-not-measured", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 4,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("[GOAL - ITERATION 5/10]");
			expect(result.reason!.toLowerCase()).toContain("not measured");
		});

		it("continuation is behavioral steering without audit rubric", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			// behavioral steering: next concrete action + proxy-signal refusal
			expect(reason.toLowerCase()).toContain("next");
			expect(reason.toLowerCase()).toContain("proxy");
			// NO audit rubric leaked into the continuation (ADR-5: rubric lives in the goal skill)
			expect(reason.toLowerCase()).not.toContain("prompt-to-artifact");
			expect(reason.toLowerCase()).not.toContain("verify-the-verifier");
		});

		it("continuation branch-A: next concrete action toward objective; proxy-signal completion rejected", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			// Branch A: asserts next concrete action
			expect(reason.toLowerCase()).toContain("next concrete action");
			// Branch A: proxy-signal refusal — named explicitly
			expect(reason).toContain("proxy signals");
			expect(reason).toContain("NOT objective completion");
		});

		it("continuation branch-B: claim-to-disprove framing for done belief", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			// Branch B: claim-to-disprove framing
			expect(reason).toMatch(/claim to disprove|not trusted until verified/i);
		});

		it("continuation branch-B: names both completion-gate lanes (objective self-check + code-review) and request-complete", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			// Branch B: redirects to completion gate naming BOTH lanes
			expect(reason.toLowerCase()).toContain("self-check");
			expect(reason.toLowerCase()).toContain("code-review");
			// Branch B: names request-complete
			expect(reason).toContain("request-complete");
		});

		it("continuation envelope is unchanged: GOAL-ITERATION header and untrusted_objective block preserved", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 2,
				max_iterations: 10,
				outcome: "SENTINEL_OBJECTIVE_TEXT",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			// Envelope: iteration header unchanged
			expect(reason).toContain("[GOAL - ITERATION 3/10]");
			// Envelope: untrusted_objective wrap unchanged
			expect(reason).toContain("<untrusted_objective>");
			expect(reason).toContain("</untrusted_objective>");
			expect(reason).toContain("SENTINEL_OBJECTIVE_TEXT");
		});

		it("continuation has complete-blocked gate", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!.toLowerCase();
			expect(reason).toContain("complete");
			expect(reason).toContain("blocked");
		});

		it("budget_limit message forbids new work and completion", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "REQUEST_CHANGES",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!.toLowerCase();
			// forbid starting new work
			expect(reason).toContain("new");
			// require a progress summary + next step
			expect(reason).toContain("summary");
			expect(reason).toContain("next");
			// explicitly do NOT complete
			expect(reason).toContain("not");
			expect(reason).toContain("complete");
		});

		// Oracle-mandated safety tests (beyond the plan's enumerated ACs)

		it("goal at cap with APPROVE but no evidence soft-stops not completes", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
				completion_evidence_paths: [], // APPROVE but NO evidence
			});

			const result = makeDecision(createContext());

			// M2: APPROVE without evidence at cap → budget_limited, NOT complete
			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
		});

		it("goal suppresses baseline todo for terminal goal-state", async () => {
			// Terminal goal-state file (active:false, complete) still present on disk
			await writeGoal({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 5,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 4 }));

			// M3: terminal goal-state owns lifecycle → yields, no todo-block
			expect(result).toEqual({ continue: true });
			expect(result.reason ?? "").not.toContain("<todo-continuation>");
		});

		// B2: a lingering/terminal goal-state must not strip an unrelated active
		// deep-interview's continuation loop.
		it("terminal goal-state does not suppress an active deep-interview", async () => {
			await writeGoal({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 5,
				max_iterations: 10,
				outcome: "goal objective text",
			});
			await writeFile(
				join(omtDir, "deep-interview-active-state-test-session.json"),
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: new Date().toISOString(),
					last_touched_at: new Date().toISOString(),
					state: { phase: "in_progress" },
				}),
			);

			const result = makeDecision(createContext({ lastAssistantMessage: "no done token" }));

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("non-pursuing active goal-state does not suppress an active deep-interview", async () => {
			await writeGoal({
				active: true,
				phase: "planning",
				objective_verdict: "",
				iteration: 0,
				max_iterations: 10,
				outcome: "goal objective text",
			});
			await writeFile(
				join(omtDir, "deep-interview-active-state-test-session.json"),
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: new Date().toISOString(),
					last_touched_at: new Date().toISOString(),
					state: { phase: "in_progress" },
				}),
			);

			const result = makeDecision(createContext({ lastAssistantMessage: "no done token" }));

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("corrupted completion_evidence_paths does not affect cap path — budget_limited regardless", async () => {
			// The cap path no longer inspects completion_evidence_paths at all; this confirms
			// corrupted state is harmless (budget_limited is the unconditional cap outcome).
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
				completion_evidence_paths: "x", // non-array (corrupted) — ignored by cap path
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
		});

		it("APPROVE + array evidence at cap still soft-stops — complete requires request-complete gate", async () => {
			// B5 non-array check is now irrelevant (shortcut removed); this test confirms
			// that even valid evidence does not bypass the gate.
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
				completion_evidence_paths: ["artifacts/report.md"],
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
		});

		// Regression: cap path must always merge into budget_limited — no shortcut to complete.
		it("cap reached with APPROVE + evidence → budget_limited block, decision.ts never writes complete", async () => {
			await writeGoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "APPROVE",
				iteration: 10,
				max_iterations: 10,
				outcome: "goal objective text",
				completion_evidence_paths: ["artifacts/report.md"],
			});

			const result = makeDecision(createContext());

			// complete is ONLY reachable via request-complete gate; cap path must soft-stop.
			expect(result.decision).toBe("block");
			const after = await readGoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
			expect(after.budget_limit_notified).toBe(true);
		});

		// Schema-guard regression tests

		it("malformed active goal-state does NOT suppress baseline-todo (fails schema guard)", async () => {
			// {active:true, phase:"pursuit"} fails the phase guard → readGoalStateRaw returns null
			// → goalRaw is null → goalSuppressesBaselineTodo stays false → todo branch fires.
			await writeGoal({
				active: true,
				phase: "pursuit", // typo'd — not a valid GoalPhase
				// max_iterations intentionally omitted to also fail that guard
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

			// Baseline-todo continuation FIRES (not suppressed by malformed goal)
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});

		it("VALID terminal goal-state (active:false, valid phase) still suppresses baseline-todo (M3 preserved)", async () => {
			// A well-formed terminal state passes the schema guard → readGoalStateRaw returns the
			// object → goalSuppressesBaselineTodo = true → baseline-todo does NOT fire (M3).
			await writeGoal({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 5,
				max_iterations: 10,
				outcome: "goal objective text",
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 4 }));

			// M3: terminal goal-state suppresses baseline-todo
			expect(result).toEqual({ continue: true });
			expect(result.reason ?? "").not.toContain("<todo-continuation>");
		});

		// B-4: a SUSTAINED updateGoalState write failure on the iteration++ block path
		// must not block the AI forever. The read path stays healthy (file readable) while
		// only the write fails, so the on-disk iteration never advances and the cap is
		// never reached. The block-count is reused as a write-failure escape.
		describe("write-failure escape on iteration++ block path", () => {
			it("escapes after MAX_BLOCK_COUNT turns when iteration write fails every turn, never completing", async () => {
				await writeGoal({
					active: true,
					phase: "pursuing",
					objective_verdict: "REQUEST_CHANGES", // not APPROVE → iteration++ block path
					iteration: 1,
					max_iterations: 100, // cap never reached
					outcome: "goal objective text",
				});
				// Force updateGoalState's openSync to throw a non-ENOENT error ONLY for the
				// goal-state file, so the on-disk iteration never advances while readGoalStateRaw
				// and the sibling block-count writes (which use writeFileSync) stay healthy.
				// updateGoalState now uses writeFileNoCreate (openSync r+ / ftruncateSync / writeSync)
				// rather than writeFileSync, so the mock must target openSync.
				// IMPORTANT: ENOENT must NOT be thrown here — updateGoalState swallows ENOENT as
				// its normal "race-deleted file" no-op, so decision.ts would never see writeOk=false.
				// A non-ENOENT error (e.g. EACCES / EIO) simulates a real write failure (disk full,
				// permissions) that updateGoalState re-throws and decision.ts catches as writeOk=false.
				// A mocked syscall is deterministic regardless of uid; chmod 0444 is silently bypassed
				// by root (common in CI containers), making chmod unreliable.
				const realOpenSync = fs.openSync;
				const openSpy = spyOn(fs, "openSync").mockImplementation(((path: any, ...rest: any[]) => {
					if (path === goalPath) {
						const err = new Error("simulated goal-state write failure") as NodeJS.ErrnoException;
						err.code = "EIO"; // non-ENOENT → re-thrown by updateGoalState → writeOk=false
						throw err;
					}
					return (realOpenSync as any)(path, ...rest);
				}) as any);

				try {
					// MAX_BLOCK_COUNT = 5: turns 1..5 block (incrementing the stuck-counter),
					// turn 6 sees blockCount >= 5 and escapes.
					for (let i = 0; i < 5; i++) {
						const blocked = makeDecision(createContext());
						expect(blocked.decision).toBe("block");
					}

					const escaped = makeDecision(createContext());
					expect(escaped).toEqual({ continue: true });
				} finally {
					openSpy.mockRestore();
				}

				// Never false-completed: phase stays pursuing, file untouched by the escape.
				const after = await readGoalFile();
				expect(after.phase).toBe("pursuing");
				expect(after.active).toBe(true);
				expect(after.iteration).toBe(1); // never advanced (write kept failing)
			});

			it("does NOT escape early when writes SUCCEED, no matter how many turns", async () => {
				await writeGoal({
					active: true,
					phase: "pursuing",
					objective_verdict: "REQUEST_CHANGES", // not APPROVE → iteration++ block path
					iteration: 1,
					max_iterations: 100, // cap never reached within the loop
					outcome: "goal objective text",
				});

				// Run well past MAX_BLOCK_COUNT (5) — 7 turns. Writes succeed each turn, so the
				// stuck-counter is reset every turn and the escape NEVER fires.
				for (let i = 0; i < 7; i++) {
					const result = makeDecision(createContext());
					expect(result.decision).toBe("block");
				}

				// iteration advanced once per turn; goal still pursuing (no spurious escape/complete).
				const after = await readGoalFile();
				expect(after.iteration).toBe(8); // 1 + 7 turns
				expect(after.phase).toBe("pursuing");
				expect(after.active).toBe(true);
			});
		});
	});

	// -------------------------------------------------------------------------
	// C2 witness: suppression read (ADR-8) refreshes last_touched_at
	// -------------------------------------------------------------------------
	describe("C2 (ADR-8): terminal goal suppression read refreshes heartbeat", () => {
		const goalPath = join(omtDir, "goal-state-test-session.json");
		const OLD_STAMP = "2020-01-01T00:00:00+00:00";

		it("(C2-witness) suppression path on a terminal goal advances last_touched_at", async () => {
			// Terminal goal (active=false) — this takes the suppression path (M3),
			// setting goalSuppressesBaselineTodo=true. ADR-8 requires updateGoalState({})
			// to be called after line 355 so the heartbeat refreshes.
			await writeFile(
				goalPath,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 3,
					max_iterations: 10,
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
					outcome: "shipped",
					completion_evidence_paths: ["a.md"],
				}),
			);

			// Run the decision path (no blocking state, no deep-interview, no incomplete todos)
			makeDecision(createContext());

			const content = await readFile(goalPath, "utf8");
			const after = JSON.parse(content);
			// last_touched_at must have advanced beyond the old stamp
			expect(after.last_touched_at).not.toBe(OLD_STAMP);
			expect(after.last_touched_at > OLD_STAMP).toBe(true);
		});

		it("(C2-absent) suppression path with no goal file creates nothing", () => {
			// No goal-state file — decision must still exit without creating a file
			makeDecision(createContext());

			expect(fs.existsSync(goalPath)).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Pristine goal-state: invisible to all consumers except the goal skill
	// A pristine seed (phase=planning, iteration=0, outcome="") must be INERT:
	//   - does NOT suppress baseline-todo continuation
	//   - does NOT refresh last_touched_at (no heartbeat write)
	// -------------------------------------------------------------------------
	describe("Pristine goal-state is inert to consumers", () => {
		const goalPath = join(omtDir, "goal-state-test-session.json");
		const OLD_STAMP = "2020-01-01T00:00:00+00:00";

		it("pristine active goal-state does NOT suppress baseline-todo", async () => {
			// Pristine seed: phase=planning, iteration=0, outcome="" — the Entry Gate
			// hasn't run yet; orphan if goal skill refused. Must NOT suppress todo block.
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					max_iterations: 10,
					outcome: "",
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
				}),
			);

			const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

			// Baseline-todo continuation MUST fire (pristine does NOT suppress)
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});

		it("pristine active goal-state does NOT refresh last_touched_at (heartbeat not kept alive)", async () => {
			// An orphan pristine seed must age toward ACTIVE TTL and be GC'd —
			// NOT be kept alive by a suppression-path heartbeat refresh.
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					max_iterations: 10,
					outcome: "",
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
				}),
			);

			makeDecision(createContext());

			// File content must be unchanged — no heartbeat write must have occurred
			const content = fs.readFileSync(goalPath, "utf8");
			const after = JSON.parse(content);
			expect(after.last_touched_at).toBe(OLD_STAMP);
		});

		it("non-pristine planning state (outcome set) still suppresses baseline-todo (regression guard)", async () => {
			// A planning state with a real outcome is NOT pristine — it is a real goal.
			// Suppression must still apply (regression guard for the pristine gate).
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					max_iterations: 10,
					outcome: "ship feature X",
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
				}),
			);

			const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

			// Non-pristine planning → suppress; baseline-todo must NOT fire
			expect(result).toEqual({ continue: true });
			expect(result.reason ?? "").not.toContain("<todo-continuation>");
		});

		it("non-pristine planning state (outcome set) refreshes heartbeat (regression guard)", async () => {
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					max_iterations: 10,
					outcome: "ship feature X",
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
				}),
			);

			makeDecision(createContext());

			const content = fs.readFileSync(goalPath, "utf8");
			const after = JSON.parse(content);
			// Non-pristine suppression path DOES refresh the heartbeat
			expect(after.last_touched_at).not.toBe(OLD_STAMP);
		});

		it("pristine with iteration absent (undefined) also treated as inert", async () => {
			// iteration absent from the seed file → isPristine treats it as 0
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					max_iterations: 10,
					outcome: "",
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
					// iteration intentionally absent
				}),
			);

			const result = makeDecision(createContext({ incompleteTodoCount: 2 }));

			// Must NOT suppress — iteration absent = pristine = inert
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});

		it("pristine with outcome absent (undefined) also treated as inert", async () => {
			// outcome absent from the seed file → isPristine treats it as ""
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					max_iterations: 10,
					last_touched_at: OLD_STAMP,
					started_at: OLD_STAMP,
					// outcome intentionally absent
				}),
			);

			const result = makeDecision(createContext({ incompleteTodoCount: 2 }));

			// Must NOT suppress — outcome absent = pristine = inert
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});
	});

	// -------------------------------------------------------------------------
	// Priority 1.45: Ultragoal autonomous pursuit loop
	// Mirrors the Priority 1.4 goal loop above (same message envelope shape,
	// same cap/write-failure/suppression semantics) but reads/writes the
	// separate ultragoal-state-<sid>.json prefix and is independent of goal —
	// neither loop's logic branches on the other's state.
	// -------------------------------------------------------------------------
	describe("Priority 1.45: Ultragoal autonomous pursuit loop", () => {
		const ultragoalPath = join(omtDir, "ultragoal-state-test-session.json");

		const writeUltragoal = async (state: Record<string, unknown>) => {
			await writeFile(ultragoalPath, JSON.stringify(state));
		};

		const readUltragoalFile = async (): Promise<Record<string, unknown>> => {
			const { readFileSync } = await import("fs");
			return JSON.parse(readFileSync(ultragoalPath, "utf8"));
		};

		it("ultragoal blocks with <ultragoal-continuation> and increments iteration when objective unmet during pursuit", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 2,
				max_iterations: 10,
				outcome: "ultragoal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<ultragoal-continuation>");
			expect(result.reason).toContain("[ULTRAGOAL - ITERATION 3/10]");
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(3);
		});

		it("terminal complete ultragoal-state still allows the stop", async () => {
			await writeUltragoal({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 3,
				max_iterations: 10,
				outcome: "ultragoal objective text",
			});

			const result = makeDecision(createContext());

			expect(result).toEqual({ continue: true });
		});

		it("ultragoal budget exhaustion soft-stops without completing", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "REQUEST_CHANGES",
				iteration: 10,
				max_iterations: 10,
				outcome: "ultragoal objective text",
			});

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const after = await readUltragoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
			expect(after.budget_limit_notified).toBe(true);
		});

		it("ultragoal active non-pursuing (planning) suppresses baseline todo branch", async () => {
			await writeUltragoal({
				active: true,
				phase: "planning",
				objective_verdict: "",
				iteration: 0,
				max_iterations: 10,
				outcome: "ultragoal objective text",
			});

			const result = makeDecision(createContext({ incompleteTodoCount: 5 }));

			expect(result).toEqual({ continue: true });
			expect(result.reason ?? "").not.toContain("<todo-continuation>");
		});

		it("ultragoal loop is independent of the goal loop — a live pursuing goal fires its own continuation, not ultragoal's", async () => {
			await writeFile(
				join(omtDir, "goal-state-test-session.json"),
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "",
					iteration: 1,
					max_iterations: 10,
					outcome: "goal objective text",
				}),
			);
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				objective_verdict: "",
				iteration: 1,
				max_iterations: 10,
				outcome: "ultragoal objective text",
			});

			const result = makeDecision(createContext());

			// Goal is checked first (Priority 1.4) and returns immediately — this
			// turn's block reason is goal's, not ultragoal's, and ultragoal's
			// on-disk iteration is untouched (proves no merged/shared branching).
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<goal-continuation>");
			expect(result.reason ?? "").not.toContain("<ultragoal-continuation>");
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Background-aware Stop hook guards
	// Guard 2: activeSubagentCount > 0 — must pass through immediately.
	// Non-subagent background tasks (shell/monitor/etc.) must NOT bypass enforcement.
	// -------------------------------------------------------------------------
	describe("background-aware Stop hook guards", () => {
		it("activeSubagentCount=1 with incompleteTodos yields continue (NOT block)", () => {
			const result = makeDecision(
				createContext({ activeSubagentCount: 1, incompleteTodoCount: 3 }),
			);
			expect(result).toEqual({ continue: true });
		});

		it("activeSubagentCount=0 with incompleteTodos still blocks (no subagent bypass)", () => {
			const result = makeDecision(
				createContext({ activeSubagentCount: 0, incompleteTodoCount: 3 }),
			);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});
	});
});

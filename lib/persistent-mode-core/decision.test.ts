import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "fs";
import { makeDecision, DecisionContext } from "./decision.ts";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

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

		// Regression: the todo escape hatch (blockCount >= MAX_BLOCK_COUNT) returns a
		// full stop-allow (continue), same as the no-blocking fallthrough that normally
		// resets the skill-chain namespace — but the escape route bypassed that
		// fallthrough entirely, leaking a leftover skill-chain block-count file past
		// this return. The next skill-chain ratchet would then read that stale count
		// and hit its own escape hatch earlier than a full MAX_BLOCK_COUNT budget.
		it("cleans up a leaked skill-chain block-count file when the todo escape hatch triggers", async () => {
			await writeFile(join(stateDir, "block-count-test-session"), "5");
			await writeFile(join(stateDir, "block-count-skill-chain-test-session"), "3");

			const context = createContext({ incompleteTodoCount: 3 });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			expect(fs.existsSync(join(stateDir, "block-count-skill-chain-test-session"))).toBe(false);
		});

		// Negative control: when the todo branch merely blocks (not escapes), the
		// skill-chain namespace is untouched — the escape-path fix must not reach into
		// the ordinary block path.
		it("(control) leaves the skill-chain block-count file alone on an ordinary todo block", async () => {
			await writeFile(join(stateDir, "block-count-skill-chain-test-session"), "3");

			const context = createContext({ incompleteTodoCount: 3 });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(fs.existsSync(join(stateDir, "block-count-skill-chain-test-session"))).toBe(true);
			expect(fs.readFileSync(join(stateDir, "block-count-skill-chain-test-session"), "utf-8")).toBe("3");
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

	describe("Priority 0.5: awaiting-user pause token", () => {
		it("CRITICAL: awaiting-user token allows stop even during an active+live deep interview, keeps state, resets block-count", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: fresh,
					last_touched_at: fresh,
					state: { phase: "in_progress", answers: {} },
				}),
			);
			await writeFile(join(stateDir, "block-count-test-session"), "3");

			const context = createContext({
				lastAssistantMessage: "Waiting on you to decide. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			// AC4: state is KEPT, not cleared — the interview marker still exists
			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			// Block-count is reset
			expect(existsSync(join(stateDir, "block-count-test-session"))).toBe(false);
		});

		it("AC3: awaiting-user allows stop during an active goal pursuit, leaving iteration untouched", async () => {
			const goalPath = join(omtDir, "goal-state-test-session.json");
			await writeFile(
				goalPath,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "",
					iteration: 2,
					max_iterations: 10,
					outcome: "goal objective text",
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Need your input. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			const { readFileSync } = await import("fs");
			const after = JSON.parse(readFileSync(goalPath, "utf8"));
			expect(after.iteration).toBe(2);
		});

		it("AC3: awaiting-user allows stop during an active ultragoal pursuit, leaving iteration untouched", async () => {
			const ultragoalPath = join(omtDir, "ultragoal-state-test-session.json");
			await writeFile(
				ultragoalPath,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "",
					iteration: 2,
					max_iterations: 10,
					outcome: "ultragoal objective text",
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Need your input. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			const { readFileSync } = await import("fs");
			const after = JSON.parse(readFileSync(ultragoalPath, "utf8"));
			expect(after.iteration).toBe(2);
		});

		it("AC3: awaiting-user allows stop during an active prometheus session, keeping state", async () => {
			const fresh = new Date().toISOString();
			const prometheusPath = join(omtDir, "prometheus-state-test-session.json");
			await writeFile(
				prometheusPath,
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: fresh,
					last_touched_at: fresh,
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Need your input. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			const { existsSync } = await import("fs");
			expect(existsSync(prometheusPath)).toBe(true);
		});

		it("AC3: awaiting-user allows stop when only incomplete todos are outstanding", () => {
			const context = createContext({
				incompleteTodoCount: 5,
				lastAssistantMessage: "Need your input. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("AC5: awaiting-user allows stop regardless of block-count value (distinct from MAX_BLOCK_COUNT escape)", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: fresh,
					last_touched_at: fresh,
					state: { phase: "in_progress", answers: {} },
				}),
			);
			// No block-count file pre-loaded — count is 0, far below MAX_BLOCK_COUNT (5).

			const context = createContext({
				lastAssistantMessage: "Waiting on you. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("resets the prometheus-namespaced block-count (not just the base counter) on awaiting-user", async () => {
			const fresh = new Date().toISOString();
			const prometheusPath = join(omtDir, "prometheus-state-test-session.json");
			await writeFile(
				prometheusPath,
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: fresh,
					last_touched_at: fresh,
				}),
			);
			await writeFile(join(stateDir, "block-count-prometheus-test-session"), "3");

			const context = createContext({
				lastAssistantMessage: "pausing. <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
			const { existsSync } = await import("fs");
			expect(existsSync(join(stateDir, "block-count-prometheus-test-session"))).toBe(false);
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
				state: {
					phase: "in_progress",
					non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
				},
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

		// -------------------------------------------------------------------------
		// UC10 (topology-floor-evolution Stage 5): a done-token alone is not proof of
		// genuine convergence — cross-validate against the code-enforced
		// state.current_ambiguity/state.threshold before honoring it.
		// -------------------------------------------------------------------------

		it("UC10: done-token with current_ambiguity > threshold still blocks (false-convergence guard)", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: { phase: "in_progress", current_ambiguity: 0.4, threshold: 0.15 },
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Interview complete. <deep-interview-done/>",
			});

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("UC10: done-token with current_ambiguity <= threshold cleans up normally", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.1,
						threshold: 0.15,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Interview complete. <deep-interview-done/>",
			});

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("UC10: done-token with high ambiguity but TTL-stale state still cleans up (no wedge on a corpse)", async () => {
			// Mirrors the no-token block branch's liveness fall-through: a TTL-stale
			// interview is effectively dead, so the ambiguity cross-check must not wedge
			// the session on it even when current_ambiguity > threshold.
			const stale = "2020-01-01T00:00:00+00:00";
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: stale,
					last_touched_at: stale,
					state: { phase: "in_progress", current_ambiguity: 0.4, threshold: 0.15 },
				}),
			);

			const context = createContext({
				lastAssistantMessage: "Interview complete. <deep-interview-done/>",
			});

			const result = makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		// -------------------------------------------------------------------------
		// UC11 — the Closure Guard is a COMPLETENESS rule ("an active component with any
		// unscored dimension means convergence cannot be declared"), but it was only
		// enforced arithmetically, via computeAmbiguityFloor's +0.05-per-unscored term.
		// Against the documented default threshold of 0.15 that term never wins for the
		// common shapes: 1 unscored component floors ambiguity at 0.05, 2 at 0.10 —
		// neither exceeds 0.15 — so a done-token sails through with NOTHING scored. (3
		// components land on 0.15000000000000002 and block only by IEEE-754
		// representation error: an accident, not a design.) A categorical rule needs a
		// categorical gate, independent of whichever threshold this run resolved.
		// -------------------------------------------------------------------------

		const SCORED_DIMS = {
			intent: 0.9,
			outcome: 0.9,
			scope: 0.9,
			constraints: 0.9,
			success: 0.9,
			context: 0.9,
		};
		const UNSCORED_DIMS = {
			intent: null,
			outcome: null,
			scope: null,
			constraints: null,
			success: null,
			context: null,
		};

		it("UC11: done-token blocks while an active component is unscored, even though ambiguity <= threshold", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						// The exact reading a single fully-unscored component produces: floor
						// 0.05 clamps a reported 0, and 0.05 <= 0.15 passes the magnitude check.
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: UNSCORED_DIMS },
							],
						},
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("UC11: done-token cleans up when every active component is fully scored", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("UC11: a DEFERRED unscored component does not block (mirrors computeAmbiguityFloor's active-only scope)", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
								{ id: "c2", name: "C2", status: "deferred", clarity_scores: UNSCORED_DIMS },
							],
						},
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("UC11: state carrying no topology falls open (legacy/foreign interview shape still cleans up)", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		// UC12 — the fail-open contract is about VALUE, not key presence. `init --threshold abc`
		// coerces to NaN, which JSON.stringify persists as `null`; `null !== undefined` passes
		// the presence test, then `ambiguity > null` coerces null to 0, so every positive
		// ambiguity compares as unconverged and the interview can never emit a done token.
		// A non-finite threshold is exactly the malformed shape the surrounding comment
		// promises to fall open on — the presence test alone does not deliver that promise.
		it("UC12: a null (NaN-serialized) threshold falls open rather than wedging the interview", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 1,
						threshold: null,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		// The mirror operand, pinned as a characterization test — NOT a defect reproduction:
		// it already passes, because `null > 0.15` happens to read false and lands on the
		// same fall-open outcome. That is coercion luck, not a decision the code made: the
		// comparison silently did not run. This test pins the outcome so the finite-value
		// guard below reaches it deliberately and keeps reaching it.
		it("UC12: a null current_ambiguity falls open through the value guard, not through a false comparison", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: null,
						threshold: 0.15,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("UC11: an unscored component in a TTL-stale state still cleans up (no wedge on a corpse)", async () => {
			const stale = "2020-01-01T00:00:00+00:00";
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: stale,
					last_touched_at: stale,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: UNSCORED_DIMS },
							],
						},
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		// -------------------------------------------------------------------------
		// UC13 (non-goal decider Closure Guard, SKILL.md:146) — a done-token cannot be
		// honored while zero non-goals carry a non-empty decider. Unlike the topology
		// check above (fail-OPEN on an absent field — Round 0 always sets it), this gate
		// is fail-CLOSED: an absent/empty `non_goals` counts as 0 deciders, the exact
		// state the categorical rule exists to block.
		// -------------------------------------------------------------------------

		it("UC13: done-token blocks when non_goals is absent, even with magnitude/topology converged", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						// non_goals intentionally absent.
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("UC13: done-token blocks when non_goals is an empty array", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						non_goals: [],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("UC13: done-token blocks when every non_goals entry has a blank decider (blank does not count)", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						non_goals: [
							{ item: "out-of-scope thing", decider: "" },
							{ item: "another thing", decider: "   " },
						],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		it("UC13: done-token cleans up when at least one non_goals entry has a non-empty decider", async () => {
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope in round 2" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
			expect(result.reason ?? "").not.toContain("<deep-interview-continuation>");
		});

		it("UC13: a pristine seed with no non_goals is unaffected — falls through before this gate (no wedge on seed-only state)", async () => {
			// Pristine seed: no `state` at all. Must fall through via the isPristine branch,
			// not get caught by the done-token cross-check block (which requires detectDeepInterviewDone
			// AND a live state — this exercises the no-token branch's own pristine fall-through).
			const fresh = new Date().toISOString();
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
				}),
			);

			const result = makeDecision(createContext({ lastAssistantMessage: "some message without done token" }));

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(true);
			expect(result).toEqual({ continue: true });
		});

		it("UC13: a TTL-stale state with no non_goals still cleans up on done-token (no wedge on a corpse)", async () => {
			const stale = "2020-01-01T00:00:00+00:00";
			const markerPath = join(omtDir, "deep-interview-active-state-test-session.json");
			await writeFile(
				markerPath,
				JSON.stringify({
					active: true,
					started_at: stale,
					last_touched_at: stale,
					state: {
						phase: "in_progress",
						current_ambiguity: 0.05,
						threshold: 0.15,
						topology: {
							components: [
								{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS },
							],
						},
						// non_goals absent — but staleness must still fall through to cleanup.
					},
				}),
			);

			const result = makeDecision(
				createContext({ lastAssistantMessage: "Interview complete. <deep-interview-done/>" }),
			);

			const { existsSync } = await import("fs");
			expect(existsSync(markerPath)).toBe(false);
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

	// -------------------------------------------------------------------------
	// TODO 4: the Stop-hook heartbeat (touchSessionStates) fires unconditionally
	// on entry to makeDecision, BEFORE Guard 2's activeSubagentCount > 0 check —
	// not scoped inside it — so every Stop call proves this session is alive and
	// refreshes its state files, whether or not a subagent is currently running.
	// Two windows this closes: (1) a session with many running subagents never
	// touched state below the guard while it fired, and its state aged past
	// ACTIVE_IDLE_TTL while still in use; (2) prometheus/deep-interview/qa have
	// no per-family idle-Stop updater of their own (unlike goal/ultragoal, which
	// self-refresh on every pursuing Stop call), so with the heartbeat scoped to
	// activeSubagentCount > 0, those three families' state also aged toward the
	// TTL on every ordinary (zero-subagent) Stop call.
	// -------------------------------------------------------------------------
	describe("session-state heartbeat fires before the subagent guard", () => {
		const isoAgo = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();
		const ageFile = (path: string, seconds: number): void => {
			const old = new Date(Date.now() - seconds * 1000);
			fs.utimesSync(path, old, old);
		};

		it("touches this session's state while a subagent is active, and still returns continue", async () => {
			const sid = "heartbeat-active-sub";
			const statePath = join(omtDir, `ultragoal-state-${sid}.json`);
			const old = isoAgo(7 * 3600);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					iteration: 1,
					outcome: "ship it",
					max_iterations: 10,
					started_at: old,
					last_touched_at: old,
				}),
			);
			ageFile(statePath, 7 * 3600);

			const result = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 1 }));

			expect(result).toEqual({ continue: true });
			const parsed = JSON.parse(await readFile(statePath, "utf8"));
			const touchedMs = Date.parse(parsed.last_touched_at);
			expect(Math.abs(Date.now() - touchedMs)).toBeLessThan(5000);
		});

		it("touches state without the guard ever reaching stateDir/ensureDir below it", async () => {
			// A dedicated OMT_DIR with no `state/` subdirectory pre-created — unlike
			// the shared beforeEach fixture above, which always mkdir's stateDir up
			// front. The heartbeat fires unconditionally on entry to makeDecision,
			// before Guard 2's activeSubagentCount > 0 check, so it touches this
			// session's state regardless of subagent activity. With a subagent active,
			// Guard 2's own early return still fires right after, before makeDecision
			// ever reaches the stateDir/ensureDir call further down — this test checks
			// both conditions hold together: state touched AND `$OMT_DIR/state/` never
			// created.
			const freshOmtDir = await mkdtemp(join(tmpdir(), "decision-hoist-test-"));
			const prevOmtDir = process.env.OMT_DIR;
			process.env.OMT_DIR = freshOmtDir;
			try {
				const sid = "heartbeat-no-statedir";
				const statePath = join(freshOmtDir, `goal-state-${sid}.json`);
				const old = isoAgo(7 * 3600);
				await writeFile(
					statePath,
					JSON.stringify({
						active: true,
						phase: "pursuing",
						iteration: 1,
						outcome: "ship it",
						max_iterations: 10,
						started_at: old,
						last_touched_at: old,
					}),
				);

				const result = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 1 }));

				expect(result).toEqual({ continue: true });
				expect(fs.existsSync(join(freshOmtDir, "state"))).toBe(false);
				const parsed = JSON.parse(await readFile(statePath, "utf8"));
				const touchedMs = Date.parse(parsed.last_touched_at);
				expect(Math.abs(Date.now() - touchedMs)).toBeLessThan(5000);
			} finally {
				if (prevOmtDir === undefined) delete process.env.OMT_DIR;
				else process.env.OMT_DIR = prevOmtDir;
				await rm(freshOmtDir, { recursive: true, force: true });
			}
		});

		it("preserves walk-away collectability: hooks/session-start.sh still reaps an abandoned session's state and releases its block", async () => {
			const walkedAwaySid = "heartbeat-walked-away";
			const controlSid = "heartbeat-walked-away-control";
			const currentSid = "heartbeat-fresh-caller";
			const walkedAwayPath = join(omtDir, `goal-state-${walkedAwaySid}.json`);
			const controlPath = join(omtDir, `goal-state-${controlSid}.json`);
			const old = isoAgo(7 * 3600);
			const pursuingState = {
				active: true,
				phase: "pursuing",
				iteration: 1,
				outcome: "abandoned work",
				max_iterations: 10,
				started_at: old,
				last_touched_at: old,
			};
			await writeFile(walkedAwayPath, JSON.stringify(pursuingState));
			ageFile(walkedAwayPath, 7 * 3600);
			// Control: an identical pursuing state, fresh, for a different sid —
			// demonstrates this shape blocks its own Stop call, without touching
			// (or aging) the walked-away fixture the GC step below depends on.
			await writeFile(controlPath, JSON.stringify(pursuingState));
			const controlDecision = makeDecision(
				createContext({ sessionId: controlSid, activeSubagentCount: 0 }),
			);
			expect(controlDecision.decision).toBe("block");
			expect(controlDecision.reason).toContain("<goal-continuation>");

			const repoRoot = join(import.meta.dir, "..", "..");
			const hookPath = join(repoRoot, "hooks", "session-start.sh");
			// session-start.sh:57 guards its exports with `[ -n "$CLAUDE_ENV_FILE" ]` —
			// only a genuinely ABSENT (not merely blank/empty-string) env var takes
			// that skip branch, so CLAUDE_ENV_FILE must be deleted from the child env
			// entirely, not set to "" or undefined. Left as `...process.env`, this
			// spawn would inherit the real ambient CLAUDE_ENV_FILE and the hook would
			// unconditionally overwrite the developer's live session env file with
			// this test's temp fixture path and sid.
			const { CLAUDE_ENV_FILE: _omittedClaudeEnvFile, ...envWithoutClaudeEnvFile } = process.env;
			execFileSync("bash", [hookPath], {
				input: JSON.stringify({ sessionId: currentSid, cwd: repoRoot }),
				env: { ...envWithoutClaudeEnvFile, OMT_DIR: omtDir },
				encoding: "utf8",
			});

			expect(fs.existsSync(walkedAwayPath)).toBe(false);
			const afterGc = makeDecision(createContext({ sessionId: walkedAwaySid, activeSubagentCount: 0 }));
			expect(afterGc).toEqual({ continue: true });
		});

		it("does not revive a 7-hour-old pristine state — the heartbeat skips it, and it is still collected afterward", async () => {
			const sid = "heartbeat-pristine-seed";
			const statePath = join(omtDir, `ultragoal-state-${sid}.json`);
			const old = isoAgo(7 * 3600);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "planning",
					iteration: 0,
					outcome: "",
					max_iterations: 10,
					started_at: old,
					last_touched_at: old,
				}),
			);
			ageFile(statePath, 7 * 3600);

			makeDecision(createContext({ sessionId: sid, activeSubagentCount: 1 }));

			const parsedAfter = JSON.parse(await readFile(statePath, "utf8"));
			expect(parsedAfter.last_touched_at).toBe(old);

			const repoRoot = join(import.meta.dir, "..", "..");
			const livenessLib = join(repoRoot, "hooks", "lib", "state-liveness.sh");
			execFileSync(
				"bash",
				[
					"-c",
					'source "$1" && reap_dead_state_files "$2" "$3" "$(date +%s)" 0',
					"_",
					livenessLib,
					omtDir,
					"heartbeat-pristine-collector",
				],
				{ encoding: "utf8" },
			);

			expect(fs.existsSync(statePath)).toBe(false);
		});

		// This assertion fails if the heartbeat call is ever moved back inside Guard
		// 2's activeSubagentCount > 0 block — that is the point of the test. qa and
		// prometheus are the two state families with no per-family idle-Stop updater
		// of their own anywhere else in makeDecision (unlike goal/ultragoal, which
		// self-refresh last_touched_at on every pursuing Stop call): the ONLY thing
		// that can move either family's last_touched_at at activeSubagentCount === 0
		// is touchSessionStates firing unconditionally on entry, ahead of the guard.
		it("activeSubagentCount === 0 still fires the heartbeat for families with no per-family idle updater (prometheus, qa)", async () => {
			const sid = "heartbeat-fires-when-idle";
			const old = isoAgo(7 * 3600);
			const prometheusPath = join(omtDir, `prometheus-state-${sid}.json`);
			const qaPath = join(omtDir, `qa-state-${sid}.json`);
			await writeFile(
				prometheusPath,
				JSON.stringify({
					active: true,
					sessionId: sid,
					started_at: old,
					last_touched_at: old,
				}),
			);
			await writeFile(
				qaPath,
				JSON.stringify({
					phase: "IN-PROGRESS",
					cycle: 1,
					target: "some target",
					last_touched_at: old,
				}),
			);
			ageFile(prometheusPath, 7 * 3600);
			ageFile(qaPath, 7 * 3600);

			makeDecision(
				createContext({ sessionId: sid, activeSubagentCount: 0, lastAssistantMessage: "still working" }),
			);

			const prometheusAfter = JSON.parse(await readFile(prometheusPath, "utf8"));
			const qaAfter = JSON.parse(await readFile(qaPath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(prometheusAfter.last_touched_at))).toBeLessThan(5000);
			expect(Math.abs(Date.now() - Date.parse(qaAfter.last_touched_at))).toBeLessThan(5000);
		});
	});

	// -------------------------------------------------------------------------
	// Wedge regression: touchSessionStates (above) revives last_touched_at on
	// EVERY family for a subagent-busy session, so a still-in-use state survives
	// SessionStart GC. But deep-interview and prometheus decide whether to BLOCK
	// using that same field (isStateLive) — so a heartbeat-revived TTL-stale
	// corpse used to wedge the session forever. decision.ts now judges blocking
	// via progress_touched_at (a wedge-axis signal a genuine producer write
	// stamps — mergeWithHeartbeat), falling back to last_touched_at only when
	// progress_touched_at is absent.
	//
	// That fallback is now SAFE — unlike an earlier attempt that fell back to
	// started_at instead (which broke a long-running-but-recently-active legacy
	// interview: session age, not idle time, decided liveness) — because
	// touchSessionStates (the only GC-only writer that overwrites last_touched_at
	// without also stamping progress_touched_at) now BACKFILLS progress_touched_at
	// from the pre-overwrite last_touched_at value the first time it touches a
	// legacy file. The resulting invariant: progress_touched_at absent ⟹ no
	// GC-only writer has ever touched this file ⟹ last_touched_at is still the
	// file's last genuine-activity timestamp — so falling back to it directly is
	// safe. (restampAfterAdopt is a separate, non-GC-only writer: adoption is a
	// genuine progress event, so it stamps progress_touched_at fresh rather than
	// backfilling it.)
	// -------------------------------------------------------------------------
	describe("wedge-axis liveness: progress_touched_at vs last_touched_at (heartbeat revival guard)", () => {
		const staleIso = new Date(Date.now() - 7 * 3600 * 1000).toISOString();

		it("deep-interview corpse revived by the heartbeat does not wedge the session", async () => {
			const sid = "wedge-di-corpse";
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: staleIso,
					last_touched_at: staleIso,
					progress_touched_at: staleIso,
					state: {
						phase: "in_progress",
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			// Heartbeat crossing: a Stop call while a subagent is active revives
			// last_touched_at (GC axis) but must not touch progress_touched_at.
			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.progress_touched_at).toBe(staleIso);

			// Now Stop with no subagents active — must NOT wedge on the revived corpse.
			const stopResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 0 }));
			expect(stopResult).toEqual({ continue: true });
		});

		it("prometheus corpse revived by the heartbeat does not wedge the session (before the MAX_BLOCK_COUNT escape is even reached)", async () => {
			const sid = "wedge-prometheus-corpse";
			const statePath = join(omtDir, `prometheus-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: staleIso,
					last_touched_at: staleIso,
					progress_touched_at: staleIso,
				}),
			);

			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.progress_touched_at).toBe(staleIso);

			// First Stop call after revival — must not block, well before MAX_BLOCK_COUNT (5).
			const stopResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 0 }));
			expect(stopResult).toEqual({ continue: true });
		});

		it("positive control: a genuinely in-progress deep interview (fresh progress_touched_at) still blocks", async () => {
			const sid = "wedge-di-genuine-progress";
			const fresh = new Date().toISOString();
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					progress_touched_at: fresh,
					state: {
						phase: "in_progress",
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ sessionId: sid, lastAssistantMessage: "still working, no done token" }),
			);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		// NOTE: despite the name below, this does NOT exercise isProgressLive's own
		// `?? parsed.last_touched_at` fallback branch (state-core.ts). makeDecision
		// calls touchSessionStates at its very top (decision.ts:394), which backfills
		// progress_touched_at from last_touched_at (decision.ts:684/691) BEFORE any
		// isProgressLive call is reached — so by the time isProgressLive runs here,
		// progress_touched_at is already present, and the fallback expression is
		// never evaluated. This test only verifies the post-backfill behavior
		// through makeDecision's full pipeline. The fallback expression itself is
		// covered directly in lib/state-core.test.ts, describe("isProgressLive —
		// legacy last_touched_at fallback").
		it("post-backfill: a state with no progress_touched_at field at all still blocks after touchSessionStates backfills it from a fresh last_touched_at", async () => {
			const sid = "wedge-di-legacy-fallback";
			const fresh = new Date().toISOString();
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: fresh,
					// no progress_touched_at — simulates a file written before this field existed
					state: {
						phase: "in_progress",
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ sessionId: sid, lastAssistantMessage: "still working, no done token" }),
			);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<deep-interview-continuation>");
		});

		// Regression: the legacy fallback above ("today's behavior preserved") reads
		// AS-IS from `last_touched_at`. Before the backfill fix, this field was
		// exactly what the heartbeat (touchSessionStates) revives on every Stop call
		// while a subagent is active, so a legacy corpse could never die. The fix:
		// touchSessionStates now backfills `progress_touched_at` from the
		// pre-overwrite `last_touched_at` value the FIRST time it touches a legacy
		// file (see the invariant note above the describe block). So after the
		// heartbeat crossing below, `progress_touched_at` is no longer absent — it
		// now holds the corpse's genuinely-stale timestamp — and THAT is what
		// isProgressLive reads, so the corpse still does not wedge.
		it("legacy corpse (no progress_touched_at at all) revived by the heartbeat does not wedge the session", async () => {
			const sid = "wedge-di-legacy-corpse-heartbeat";
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: staleIso,
					last_touched_at: staleIso,
					// no progress_touched_at — a state file written before this field existed
					state: {
						phase: "in_progress",
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			// Heartbeat crossing: revives last_touched_at (GC axis) to now, but
			// backfills progress_touched_at from the PRE-overwrite (stale) value —
			// that backfilled value is what must keep this corpse from reviving.
			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.started_at).toBe(staleIso);
			expect(revived.progress_touched_at).toBe(staleIso);

			// Now Stop with no subagents active — must NOT wedge on the revived corpse.
			const stopResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 0 }));
			expect(stopResult).toEqual({ continue: true });
		});

		it("prometheus legacy corpse (no progress_touched_at at all) revived by the heartbeat does not wedge the session", async () => {
			const sid = "wedge-prometheus-legacy-corpse-heartbeat";
			const statePath = join(omtDir, `prometheus-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: staleIso,
					last_touched_at: staleIso,
					// no progress_touched_at — a state file written before this field existed
				}),
			);

			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.started_at).toBe(staleIso);
			expect(revived.progress_touched_at).toBe(staleIso);

			const stopResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 0 }));
			expect(stopResult).toEqual({ continue: true });
		});

		// Corrected invariant (replaces a prior "legacy positive control" test that
		// asserted the OPPOSITE of what is correct here — it encoded a since-reverted
		// attempt that fell back to `started_at`). A legacy file that has never had a
		// GC-only writer touch it (progress_touched_at absent) must be judged by
		// `last_touched_at` alone. touchSessionStates now fires unconditionally on
		// every makeDecision call regardless of activeSubagentCount, so a heartbeat
		// crossing DOES happen even in this single-call test — but its effect here is
		// a backfill, not a corruption: progress_touched_at is set to the PRE-heartbeat
		// last_touched_at value (this test's stale value), never to the fresh stamp
		// that same call just wrote to last_touched_at. So the judgment is still
		// effectively "the pre-heartbeat last_touched_at, unchanged" — a fresh
		// `started_at` on an old, idle session must NOT resurrect it — session AGE is
		// not the liveness signal, IDLE TIME is.
		it("legacy file with a heartbeat crossing: a fresh started_at does NOT block a genuinely idle last_touched_at", async () => {
			const sid = "wedge-di-legacy-idle-last-touched";
			const fresh = new Date().toISOString();
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: fresh,
					last_touched_at: staleIso,
					// no progress_touched_at — legacy shape, never touched by any GC-only writer
					state: {
						phase: "in_progress",
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			const result = makeDecision(
				createContext({ sessionId: sid, lastAssistantMessage: "still working, no done token" }),
			);

			expect(result).toEqual({ continue: true });
		});

		// The exact case the started_at-fallback attempt broke: a long-running
		// session (started_at 7h ago) that was genuinely active 2 minutes ago
		// (last_touched_at), with no progress_touched_at yet (legacy shape) and an
		// unconverged topology. A heartbeat crossing (subagent active) must backfill
		// progress_touched_at from that genuinely-fresh last_touched_at — not from
		// started_at — so the very next Stop call (no subagents) still blocks.
		it("active legacy interview (fresh last_touched_at, old started_at) still blocks after a heartbeat crossing", async () => {
			const sid = "wedge-di-legacy-active-recent";
			const oldStartedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const recentTouch = new Date(Date.now() - 2 * 60 * 1000).toISOString();
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: oldStartedAt,
					last_touched_at: recentTouch,
					// no progress_touched_at — legacy shape
					state: {
						phase: "in_progress",
						current_ambiguity: 0.9,
						threshold: 0.15,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			// Heartbeat crossing: backfills progress_touched_at from the genuinely
			// recent last_touched_at (2 minutes ago) before bumping last_touched_at
			// itself to now.
			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(revived.progress_touched_at).toBe(recentTouch);

			// Next Stop call with no subagents active — must still block: the backfilled
			// progress_touched_at is fresh (2 minutes old), well under the 6h TTL.
			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeSubagentCount: 0, lastAssistantMessage: "still working" }),
			);
			expect(stopResult.decision).toBe("block");
			expect(stopResult.reason).toContain("<deep-interview-continuation>");
		});

		// Mirrors the test above for the prometheus family — isProgressLive is
		// shared code between the deep-interview and prometheus branches, so the
		// same started_at-fallback regression applied there too.
		it("active legacy prometheus session (fresh last_touched_at, old started_at) still blocks after a heartbeat crossing", async () => {
			const sid = "wedge-prometheus-legacy-active-recent";
			const oldStartedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const recentTouch = new Date(Date.now() - 2 * 60 * 1000).toISOString();
			const statePath = join(omtDir, `prometheus-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: oldStartedAt,
					last_touched_at: recentTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(revived.progress_touched_at).toBe(recentTouch);

			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeSubagentCount: 0, lastAssistantMessage: "still working" }),
			);
			expect(stopResult.decision).toBe("block");
			expect(stopResult.reason).toContain("<prometheus-continuation>");
		});

		// Mirrors the active-legacy-interview test above, but with a done-token in
		// the last assistant message: the state must NOT be deleted, since the
		// Closure Guard cross-check (magnitudeUnconverged) still requires the
		// interview to stay live before honoring the token, and it is (via the
		// backfilled progress_touched_at).
		it("active legacy interview + done-token: unconverged state is NOT deleted after a heartbeat crossing", async () => {
			const sid = "wedge-di-legacy-done-token-not-deleted";
			const oldStartedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const recentTouch = new Date(Date.now() - 2 * 60 * 1000).toISOString();
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					started_at: oldStartedAt,
					last_touched_at: recentTouch,
					// no progress_touched_at — legacy shape
					state: {
						phase: "in_progress",
						current_ambiguity: 0.9,
						threshold: 0.15,
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope" }],
					},
				}),
			);

			// Heartbeat crossing backfills progress_touched_at from recentTouch.
			const heartbeatResult = makeDecision(createContext({ sessionId: sid, activeSubagentCount: 2 }));
			expect(heartbeatResult).toEqual({ continue: true });

			const stopResult = makeDecision(
				createContext({
					sessionId: sid,
					activeSubagentCount: 0,
					lastAssistantMessage: "Interview complete. <deep-interview-done/>",
				}),
			);

			expect(stopResult.decision).toBe("block");
			expect(stopResult.reason).toContain("<deep-interview-continuation>");
			expect(fs.existsSync(statePath)).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Story 3: the shared continuation-contract skeleton (continuationContract())
	// must appear in every continuation builder's output, with per-family ask
	// posture: "preferred" (deep-interview/prometheus/todo) vs "exceptional"
	// (goal/ultragoal). Mirrors rules/continuation-contract.md (the SSOT).
	// -------------------------------------------------------------------------
	describe("continuation message skeleton", () => {
		const assertSharedSkeleton = (reason: string) => {
			expect(reason).toContain("always-on Continuation Contract rule");
			expect(reason).toContain("<awaiting-user/>");
			expect(reason).toContain("should I continue?");
			expect(reason).toContain("block-count escape");
			expect(reason).toContain("AskUserQuestion");
		};

		it("deep-interview continuation includes the shared skeleton (preferred posture)", async () => {
			const fresh = new Date().toISOString();
			await writeFile(
				join(omtDir, "deep-interview-active-state-test-session.json"),
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: fresh,
					last_touched_at: fresh,
					state: { phase: "in_progress", answers: {} },
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("Prefer this");
		});

		it("goal continuation includes the shared skeleton (exceptional posture)", async () => {
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

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("EXCEPTIONAL");
		});

		it("ultragoal continuation includes the shared skeleton (exceptional posture)", async () => {
			await writeFile(
				join(omtDir, "ultragoal-state-test-session.json"),
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "",
					iteration: 1,
					max_iterations: 10,
					outcome: "ultragoal objective text",
				}),
			);

			const result = makeDecision(createContext());

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("EXCEPTIONAL");
		});

		it("prometheus continuation includes the shared skeleton (preferred posture)", async () => {
			await writeFile(
				join(omtDir, "prometheus-state-test-session.json"),
				JSON.stringify({
					active: true,
					sessionId: "test-session",
					started_at: new Date().toISOString(),
					last_touched_at: new Date().toISOString(),
				}),
			);

			const context = createContext({ lastAssistantMessage: "some message without done token" });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("Prefer this");
		});

		it("todo continuation includes the shared skeleton (preferred posture)", () => {
			const context = createContext({ incompleteTodoCount: 5 });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("Prefer this");
		});

		it("skill-chain continuation includes the shared skeleton (preferred posture)", () => {
			const context = createContext({ pendingSkillChainSkills: ["chain-bravo"] });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			assertSharedSkeleton(reason);
			expect(reason).toContain("Prefer this");
		});
	});

	// -------------------------------------------------------------------------
	// runtime-leak fix: the continuation contract's ask-tool vocabulary is a
	// platform-supplied parameter (DecisionContext.askToolName), not a hardcoded
	// literal — the same "optional field, platform shim supplies it, undefined
	// for Claude" pattern pendingSkillChainSkills already uses. Codex's Stop
	// hook (hooks/codex-persistent-mode/cli.ts) passes askToolName:
	// "request_user_input" (its real AskUserQuestion analog); Claude's Stop hook
	// (hooks/persistent-mode/index.ts) never sets it, so it defaults to
	// "AskUserQuestion" there — exactly like every test above.
	// -------------------------------------------------------------------------
	describe("continuation contract ask-tool vocabulary (askToolName)", () => {
		it("defaults to AskUserQuestion when askToolName is omitted (Claude)", () => {
			const context = createContext({ incompleteTodoCount: 5 });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("AskUserQuestion");
		});

		it("uses the platform-supplied askToolName instead of AskUserQuestion when provided (Codex)", () => {
			const context = createContext({ incompleteTodoCount: 5, askToolName: "request_user_input" });
			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			expect(reason).toContain("request_user_input");
			expect(reason).not.toContain("AskUserQuestion");
		});

		it("applies the platform-supplied askToolName in the exceptional posture too (goal continuation)", async () => {
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

			const result = makeDecision(createContext({ askToolName: "request_user_input" }));

			expect(result.decision).toBe("block");
			const reason = result.reason!;
			expect(reason).toContain("request_user_input");
			expect(reason).not.toContain("AskUserQuestion");
		});
	});

	// Codex-only chain ratchet: the codex-persistent-mode Stop reader derives
	// pendingSkillChainSkills from opened-vs-expected SKILL.md loads (see
	// hooks/codex-persistent-mode/cli.ts). Claude's hooks/persistent-mode/index.ts
	// never populates this field, so it is undefined/empty for every Claude context
	// built by createContext() above — these tests exercise the field explicitly
	// without touching any other consumer's behavior.
	describe("Priority 2.5: Codex-only skill-chain ratchet", () => {
		it("blocks when a next-step skill has not been opened yet", () => {
			const context = createContext({ pendingSkillChainSkills: ["chain-bravo"] });

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<skill-chain-continuation>");
			expect(result.reason).toContain("chain-bravo");
		});

		it("allows stop when the pending list is empty (resolved chain)", () => {
			const context = createContext({ pendingSkillChainSkills: [] });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("allows stop when the field is absent (no chain in play — negative control)", () => {
			const context = createContext();

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("awaiting-user token takes priority over a pending skill chain", () => {
			const context = createContext({
				pendingSkillChainSkills: ["chain-bravo"],
				lastAssistantMessage: "wrapping up <awaiting-user/>",
			});

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("baseline todo-continuation takes priority over a pending skill chain", () => {
			const context = createContext({
				pendingSkillChainSkills: ["chain-bravo"],
				incompleteTodoCount: 2,
			});

			const result = makeDecision(context);

			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
			expect(result.reason).not.toContain("<skill-chain-continuation>");
		});

		it("allows stop after max continuation attempts (escape hatch) — the chain ratchet must not block forever", async () => {
			// Mirrors the sibling goal/ultragoal/prometheus/todo escape-hatch tests:
			// pre-seed the chain's OWN block-count file (namespaced under
			// skill-chain-<attemptId>, distinct from the baseline attemptId file)
			// at MAX_BLOCK_COUNT so the very next call must escape rather than block.
			await writeFile(join(stateDir, "block-count-skill-chain-test-session"), "5");

			const context = createContext({ pendingSkillChainSkills: ["chain-bravo"] });

			const result = makeDecision(context);

			expect(result).toEqual({ continue: true });
		});

		it("cleans up the chain's block-count file when the escape hatch triggers", async () => {
			await writeFile(join(stateDir, "block-count-skill-chain-test-session"), "5");

			const context = createContext({ pendingSkillChainSkills: ["chain-bravo"] });

			makeDecision(context);

			const { existsSync } = await import("fs");
			expect(existsSync(join(stateDir, "block-count-skill-chain-test-session"))).toBe(false);
		});

		// Regression: the sibling goal/ultragoal lanes reset their own block-count on
		// progress (cleanupBlockCountFiles at the iteration-advance branch), but the
		// skill-chain lane's resolution path (pendingSkillChainSkills going empty) never
		// got the same treatment — the counter it left behind leaked into whatever chain
		// started next, silently shrinking that chain's budget below MAX_BLOCK_COUNT.
		it("resolving a chain resets its block-count — a later, unrelated chain gets the FULL budget, not a leaked remainder", () => {
			const chainCountFile = join(stateDir, "block-count-skill-chain-test-session");

			// Chain A: blocked 3 times (never opened by the model).
			for (let i = 0; i < 3; i++) {
				const result = makeDecision(createContext({ pendingSkillChainSkills: ["chain-alpha"] }));
				expect(result.decision).toBe("block");
			}
			expect(fs.readFileSync(chainCountFile, "utf-8")).toBe("3");

			// Chain A resolves (the referenced skill got opened) — pendingSkillChainSkills
			// goes empty on the next two turns, no other blocking condition fires.
			expect(makeDecision(createContext({ pendingSkillChainSkills: [] }))).toEqual({ continue: true });
			expect(makeDecision(createContext())).toEqual({ continue: true });

			// The counter must be gone — NOT sitting at 3.
			expect(fs.existsSync(chainCountFile)).toBe(false);

			// Chain B starts fresh later in the same session. It must get the FULL
			// MAX_BLOCK_COUNT (5) budget of blocks before the escape hatch fires — not
			// 2 (5 - the leaked 3), which is what a leaked counter would produce.
			for (let i = 0; i < 5; i++) {
				const result = makeDecision(createContext({ pendingSkillChainSkills: ["chain-bravo"] }));
				expect(result.decision).toBe("block");
			}
			// 5 blocks reach MAX_BLOCK_COUNT (count=5); the 6th call is the escape.
			expect(makeDecision(createContext({ pendingSkillChainSkills: ["chain-bravo"] }))).toEqual({
				continue: true,
			});
		});

		it("<awaiting-user/> resets the skill-chain block-count alongside base and prometheus", () => {
			const chainCountFile = join(stateDir, "block-count-skill-chain-test-session");

			for (let i = 0; i < 3; i++) {
				makeDecision(createContext({ pendingSkillChainSkills: ["chain-alpha"] }));
			}
			expect(fs.readFileSync(chainCountFile, "utf-8")).toBe("3");

			const result = makeDecision(
				createContext({
					pendingSkillChainSkills: ["chain-alpha"],
					lastAssistantMessage: "wrapping up <awaiting-user/>",
				}),
			);
			expect(result).toEqual({ continue: true });
			expect(fs.existsSync(chainCountFile)).toBe(false);
		});
	});

	// Hole 1 (companion to the wedge-axis describe above): updateGoalState and
	// updateUltragoalState (lib/persistent-mode-core/state.ts) are GC-only writers
	// in the same sense as touchSessionStates whenever they are
	// called with an EMPTY partial — the non-pursuing-active suppression path
	// refreshes the heartbeat with no real work having happened (ADR-8: "every
	// suppression read IS a use"). Measured findings (two distinct, independently
	// confirmed defects — NOT the single symmetric defect a naive read of
	// touchSessionStates' own fix would suggest):
	//
	//  (a) Called through the ONLY current production path (makeDecision), the
	//      empty-partial case does NOT actually corrupt anything: touchSessionStates
	//      fires unconditionally, first, on every makeDecision call (see the "The
	//      heartbeat (touchSessionStates) fires HERE" comment above), and it already
	//      backfills progress_touched_at before updateGoalState/updateUltragoalState
	//      ever run — so by the time the empty-partial call reads the file, a legacy
	//      file's progress_touched_at is already present and gets carried through
	//      untouched by the plain object spread. The "backfills from touchSessionStates
	//      preceding it" tests below document and pin this already-correct behavior.
	//  (b) Called in ISOLATION — i.e. the function's own contract, independent of
	//      call order in its one current caller — the empty-partial path IS broken:
	//      it overwrites last_touched_at unconditionally with no backfill of its own,
	//      permanently losing the file's last genuine-activity timestamp the moment
	//      progress_touched_at is still absent. This is a real defect in the function
	//      itself (the documented state-core.ts invariant — "progress_touched_at
	//      absent ⟹ no GC-only writer has touched this file" — is a lie about this
	//      function read on its own), even though today's single caller happens to
	//      never trigger it. The "in isolation" tests below reproduce this directly.
	//  (c) A DIFFERENT, more serious defect than either (a) or (b) as originally
	//      hypothesized: once progress_touched_at IS backfilled (by touchSessionStates,
	//      case (a)), a SUBSEQUENT genuine, non-empty-partial write (e.g. the
	//      "pursuing" phase's per-Stop iteration++) does NOT advance it — the
	//      current code has no notion that a non-empty partial is real progress, so
	//      progress_touched_at freezes at whatever it was first backfilled to and
	//      never moves again, even while the goal/ultragoal loop keeps genuinely
	//      iterating. A goal actively pursued for hours would eventually read as
	//      progress-dead to listOthers/adopt despite continuous real work. The
	//      "genuine iteration advance" tests below reproduce this — it is the one
	//      actually reachable through the real makeDecision call path today.
	describe("goal/ultragoal progress_touched_at across the GC-only vs genuine-write split (hole 1)", () => {
		it("goal (in isolation): an empty-partial call to updateGoalState loses the genuine last_touched_at with no backfill of its own", async () => {
			const { updateGoalState } = await import("./state.ts");
			const sid = "goal-isolated-empty-partial-loses-history";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `goal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "blocked",
					iteration: 3,
					outcome: "some real goal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			// Called directly — NOT through makeDecision, so touchSessionStates never
			// runs first. This is the function's own contract in isolation.
			updateGoalState(sid, {});

			const after = JSON.parse(await readFile(statePath, "utf8"));
			// last_touched_at is bumped to now, as documented.
			expect(Math.abs(Date.now() - Date.parse(after.last_touched_at))).toBeLessThan(5000);
			// The pre-write last_touched_at (the file's last genuine-activity signal)
			// must survive into progress_touched_at — an unprotected empty-partial
			// write must not be the one place this invariant is allowed to break.
			expect(after.progress_touched_at).toBe(staleTouch);
		});

		it("ultragoal (in isolation): an empty-partial call to updateUltragoalState loses the genuine last_touched_at with no backfill of its own", async () => {
			const { updateUltragoalState } = await import("./state.ts");
			const sid = "ultragoal-isolated-empty-partial-loses-history";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `ultragoal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "blocked",
					iteration: 3,
					outcome: "some real ultragoal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			updateUltragoalState(sid, {});

			const after = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(after.last_touched_at))).toBeLessThan(5000);
			expect(after.progress_touched_at).toBe(staleTouch);
		});

		it("goal (full stack): an empty-partial suppression heartbeat is ALREADY safe today, because touchSessionStates backfills first", async () => {
			const sid = "goal-suppression-heartbeat-backfill";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `goal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "blocked",
					iteration: 3,
					outcome: "some real goal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			makeDecision(createContext({ sessionId: sid }));

			const after = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(after.last_touched_at))).toBeLessThan(5000);
			expect(after.progress_touched_at).toBe(staleTouch);
		});

		it("ultragoal (full stack): an empty-partial suppression heartbeat is ALREADY safe today, because touchSessionStates backfills first", async () => {
			const sid = "ultragoal-suppression-heartbeat-backfill";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `ultragoal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "blocked",
					iteration: 3,
					outcome: "some real ultragoal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			makeDecision(createContext({ sessionId: sid }));

			const after = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(after.last_touched_at))).toBeLessThan(5000);
			expect(after.progress_touched_at).toBe(staleTouch);
		});

		it("goal: a genuine iteration advance (non-empty partial) DOES advance progress_touched_at, unlike freezing at the first backfilled value", async () => {
			const sid = "goal-genuine-progress-advances";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `goal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					iteration: 3,
					outcome: "some real goal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			makeDecision(createContext({ sessionId: sid }));

			const after = JSON.parse(await readFile(statePath, "utf8"));
			expect(after.iteration).toBe(4);
			// A genuine write (iteration advanced) is real progress — progress_touched_at
			// advances to now. Without the fix, touchSessionStates (which runs first)
			// backfills progress_touched_at to the stale pre-call last_touched_at, and
			// updateGoalState's own genuine write never advances it past that — so this
			// would stay ~7h stale despite iteration having just genuinely moved.
			expect(Math.abs(Date.now() - Date.parse(after.progress_touched_at))).toBeLessThan(5000);
		});

		it("ultragoal: a genuine iteration advance (non-empty partial) DOES advance progress_touched_at, unlike freezing at the first backfilled value", async () => {
			const sid = "ultragoal-genuine-progress-advances";
			const staleTouch = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
			const statePath = join(omtDir, `ultragoal-state-${sid}.json`);
			await writeFile(
				statePath,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					iteration: 3,
					outcome: "some real ultragoal",
					max_iterations: 10,
					started_at: staleTouch,
					last_touched_at: staleTouch,
					// no progress_touched_at — legacy shape
				}),
			);

			makeDecision(createContext({ sessionId: sid }));

			const after = JSON.parse(await readFile(statePath, "utf8"));
			expect(after.iteration).toBe(4);
			expect(Math.abs(Date.now() - Date.parse(after.progress_touched_at))).toBeLessThan(5000);
		});
	});
});

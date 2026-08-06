import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import { makeDecision, DecisionContext } from "./decision.ts";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { approveOk } from "@lib/qa-chain-core";

describe("makeDecision", () => {
	const testDir = join(tmpdir(), "persistent-mode-decision-test-" + Date.now());
	const projectRoot = join(testDir, "project");
	const omtDir = join(testDir, "omt");
	const stateDir = join(omtDir, "state");

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(stateDir, { recursive: true });
		await mkdir(projectRoot, { recursive: true });
		execFileSync("git", ["init", "-q"], { cwd: projectRoot });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
		await writeFile(join(projectRoot, "baseline"), "baseline");
		execFileSync("git", ["add", "baseline"], { cwd: projectRoot });
		execFileSync("git", ["commit", "-qm", "baseline"], { cwd: projectRoot });
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
		activeBackgroundTaskCount: 0,
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
			expect(fs.readFileSync(join(stateDir, "block-count-skill-chain-test-session"), "utf-8")).toBe(
				"3",
			);
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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
						},
						non_goals: [
							{ item: "out-of-scope thing", decider: "user confirmed out of scope in round 2" },
						],
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

			const result = makeDecision(
				createContext({ lastAssistantMessage: "some message without done token" }),
			);

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
							components: [{ id: "c1", name: "C1", status: "active", clarity_scores: SCORED_DIMS }],
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

	// -------------------------------------------------------------------------
	// Priority 1.45: Ultragoal autonomous pursuit loop
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
		const runGit = (args: string[]) => execFileSync("git", args, { cwd: projectRoot });
		const commitProject = async (file: string, value: string) => {
			await writeFile(join(projectRoot, file), value);
			runGit(["add", file]);
			runGit(["commit", "-qm", value]);
			return execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
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
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS 3/10]");
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(3);
		});

		it("tenth consecutive no-progress stop transitions to budget_limited", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 9,
				max_iterations: 10,
				outcome: "objective",
			});
			const result = makeDecision(createContext());
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS LIMIT REACHED 10/10]");
			expect(result.reason).toContain("no diff-carrying commit, no story transition");
			const after = await readUltragoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
		});

		it("diff commit resets no-progress counter", async () => {
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 10,
				max_iterations: 10,
				last_seen_head: head,
				outcome: "objective",
			});
			await writeFile(join(projectRoot, "progress"), "progress");
			execFileSync("git", ["add", "progress"], { cwd: projectRoot });
			execFileSync("git", ["commit", "-qm", "progress"], { cwd: projectRoot });
			const result = makeDecision(createContext());
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS 0/10]");
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(0);
			expect(after.last_seen_head).not.toBe(head);
		});

		it("partial fingerprint with head only initializes missing digest", async () => {
			const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 0,
				max_iterations: 10,
				last_seen_head: head,
				outcome: "objective",
			});
			makeDecision(createContext());
			expect((await readUltragoalFile()).last_seen_stories_digest).toEqual(expect.any(String));
		});

		it("partial fingerprint with digest only initializes missing head", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 0,
				max_iterations: 10,
				last_seen_stories_digest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
				outcome: "objective",
			});
			makeDecision(createContext());
			expect((await readUltragoalFile()).last_seen_head).toEqual(expect.any(String));
		});

		it("empty last_seen_head initializes then detects a later diff commit", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 0,
				max_iterations: 10,
				last_seen_head: "",
				outcome: "objective",
			});
			makeDecision(createContext());
			const first = await readUltragoalFile();
			expect(first.last_seen_head).toEqual(expect.any(String));
			const baseline = first.last_seen_head;
			await commitProject("empty-head-progress", "progress");
			makeDecision(createContext());
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(0);
			expect(after.last_seen_head).not.toBe(baseline);
		});

		it("story transition resets counter", async () => {
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
			const digest = "invalidated-by-transition";
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 5,
				max_iterations: 10,
				last_seen_head: head,
				last_seen_stories_digest: digest,
				stories: [{ id: "s1", status: "pending" }],
				outcome: "objective",
			});
			const result = makeDecision(createContext());
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS 0/10]");
			expect((await readUltragoalFile()).iteration).toBe(0);
		});

		it("max_iterations override transitions on the third no-progress stop", async () => {
			for (const iteration of [0, 1]) {
				await writeUltragoal({
					active: true,
					phase: "pursuing",
					iteration,
					max_iterations: 3,
					outcome: "objective",
				});
				makeDecision(createContext());
			}
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 2,
				max_iterations: 3,
				outcome: "objective",
			});
			const result = makeDecision(createContext());
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS LIMIT REACHED 3/3]");
		});

		it("empty commit does not reset counter", async () => {
			const prior = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
			runGit(["commit", "--allow-empty", "-qm", "empty"]);
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 5,
				max_iterations: 10,
				last_seen_head: prior,
				outcome: "objective",
			});
			const result = makeDecision(createContext());
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS 6/10]");
			expect((await readUltragoalFile()).iteration).toBe(6);
		});

		it("amend reads as no commit progress", async () => {
			const prior = await commitProject("amend-boundary", "amend");
			runGit(["commit", "--amend", "--allow-empty", "--no-edit"]);
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 5,
				max_iterations: 10,
				last_seen_head: prior,
				outcome: "objective",
			});
			expect(makeDecision(createContext()).reason).toContain("[ULTRAGOAL - NO-PROGRESS 6/10]");
		});

		it("rebasing the observed prior HEAD increments no-progress", async () => {
			const base = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
			const prior = await commitProject("rebase-boundary", "rebase");
			runGit(["checkout", "-qb", "rebased-boundary"]);
			runGit(["rebase", "--onto", base, base, "rebased-boundary"]);
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 5,
				max_iterations: 10,
				last_seen_head: prior,
				outcome: "objective",
			});
			expect(makeDecision(createContext()).reason).toContain("[ULTRAGOAL - NO-PROGRESS 6/10]");
		});

		it("commit then revert reads as no commit progress", async () => {
			const prior = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim();
			await commitProject("revert-boundary", "revert");
			runGit(["revert", "--no-edit", "HEAD"]);
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 5,
				max_iterations: 10,
				last_seen_head: prior,
				outcome: "objective",
			});
			expect(makeDecision(createContext()).reason).toContain("[ULTRAGOAL - NO-PROGRESS 6/10]");
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
			expect(result.reason).toContain("[ULTRAGOAL - NO-PROGRESS LIMIT REACHED 10/10]");
			expect(result.reason).toContain("Let in-flight delegated work FINISH — harvest results and commit them.");
			expect(result.reason).not.toContain("[ULTRAGOAL - BUDGET LIMIT REACHED");
			const after = await readUltragoalFile();
			expect(after.phase).toBe("budget_limited");
			expect(after.active).toBe(false);
			expect(after.budget_limit_notified).toBe(true);
		});

		it("budget limit message states drain policy", async () => {
			await writeUltragoal({
				active: true,
				phase: "pursuing",
				iteration: 9,
				max_iterations: 10,
				outcome: "objective",
			});
			const reason = makeDecision(createContext()).reason ?? "";
			expect(reason).toContain("[ULTRAGOAL - NO-PROGRESS LIMIT REACHED 10/10]");
			expect(reason).toContain("Let in-flight delegated work FINISH — harvest results and commit them.");
			expect(reason).toContain("Do NOT dispatch new stories.");
			expect(reason).toContain("Do NOT interrupt running executors.");
			expect(reason).toContain("resume-pursuit");
			expect(reason).not.toMatch(/(?:^|\n)\s*(?:kill|interrupt)\b/i);
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

		it("a legacy pursuing goal is inert while an ultragoal pursues", async () => {
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

			// Legacy goal state must not preempt ultragoal or receive an iteration write.
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<ultragoal-continuation>");
			expect(result.reason ?? "").not.toContain("<goal-continuation>");
			const after = await readUltragoalFile();
			expect(after.iteration).toBe(2);
			const goalAfter = JSON.parse(
				await readFile(join(omtDir, "goal-state-test-session.json"), "utf8"),
			);
			expect(goalAfter.iteration).toBe(1);
		});
	});

	describe("legacy goal-state compatibility", () => {
		it("treats planning, pursuing, terminal, pristine, and malformed goal files as inert to baseline todos", async () => {
			const goalPath = join(omtDir, "goal-state-test-session.json");
			const states: Record<string, unknown>[] = [
				{ active: true, phase: "planning", iteration: 2, max_iterations: 10, outcome: "legacy" },
				{ active: true, phase: "pursuing", iteration: 2, max_iterations: 10, outcome: "legacy" },
				{ active: false, phase: "complete", iteration: 2, max_iterations: 10, outcome: "legacy" },
				{ active: true, phase: "planning", iteration: 0, max_iterations: 10, outcome: "" },
				{ unexpected: "legacy malformed state" },
			];

			for (const state of states) {
				await writeFile(goalPath, JSON.stringify(state));
				const result = makeDecision(createContext({ incompleteTodoCount: 1 }));

				expect(result.decision).toBe("block");
				expect(result.reason).toContain("<todo-continuation>");
				if (typeof state.iteration === "number") {
					const after = JSON.parse(await readFile(goalPath, "utf8"));
					expect(after.iteration).toBe(state.iteration);
				}
			}
		});
	});

	// -------------------------------------------------------------------------
	// Background-aware Stop hook guards
	// Guard 2: activeBackgroundTaskCount > 0 — must pass through immediately.
	// Any running/pending background task passes through (type-agnostic); count 0 still blocks.
	// -------------------------------------------------------------------------
	describe("background-aware Stop hook guards", () => {
		it("background tasks with wake guarantee continue without consuming", () => {
			const result = makeDecision(
				createContext({
					activeBackgroundTaskCount: 1,
					deferredStopWakeGuaranteed: true,
					incompleteTodoCount: 3,
				}),
			);
			expect(result).toEqual({ continue: true });
		});

		it("background tasks without wake guarantee block without consuming", async () => {
			await writeFile(
				join(omtDir, "ultragoal-state-test-session.json"),
				JSON.stringify({
					active: true,
					phase: "pursuing",
					iteration: 4,
					max_iterations: 10,
					last_seen_head: "h",
					last_seen_stories_digest: "d",
					outcome: "objective",
				}),
			);
			const result = makeDecision(createContext({ activeBackgroundTaskCount: 1 }));
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("[ULTRAGOAL - WAITING ON BACKGROUND WORK]");
			expect(result.reason).toContain("Do NOT dispatch new stories");
			const after = JSON.parse(
				await readFile(join(omtDir, "ultragoal-state-test-session.json"), "utf8"),
			);
			expect(after.iteration).toBe(4);
			expect(after.last_seen_head).toBe("h");
			expect(after.last_seen_stories_digest).toBe("d");
		});

		it("no active ultragoal falls through guard 2 unchanged", () => {
			const noWake = makeDecision(
				createContext({
					activeBackgroundTaskCount: 1,
					incompleteTodoCount: 2,
					sessionId: "no-wake",
				}),
			);
			const control = makeDecision(
				createContext({
					activeBackgroundTaskCount: 0,
					incompleteTodoCount: 2,
					sessionId: "control",
				}),
			);
			expect(noWake).toEqual(control);
		});

		it("activeBackgroundTaskCount=0 with incompleteTodos still blocks (no subagent bypass)", () => {
			const result = makeDecision(
				createContext({ activeBackgroundTaskCount: 0, incompleteTodoCount: 3 }),
			);
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("<todo-continuation>");
		});
	});

	// -------------------------------------------------------------------------
	// TODO 4: the Stop-hook heartbeat (touchSessionStates) fires unconditionally
	// on entry to makeDecision, BEFORE Guard 2's activeBackgroundTaskCount > 0 check —
	// not scoped inside it — so every Stop call proves this session is alive and
	// refreshes its state files, whether or not a subagent is currently running.
	// Two windows this closes: (1) a session with many running subagents never
	// touched state below the guard while it fired, and its state aged past
	// ACTIVE_IDLE_TTL while still in use; (2) prometheus/deep-interview/qa have
	// no per-family idle-Stop updater of their own (unlike goal/ultragoal, which
	// self-refresh on every pursuing Stop call), so with the heartbeat scoped to
	// activeBackgroundTaskCount > 0, those three families' state also aged toward the
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

			const result = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 1,
					deferredStopWakeGuaranteed: true,
				}),
			);

			expect(result).toEqual({ continue: true });
			const parsed = JSON.parse(await readFile(statePath, "utf8"));
			const touchedMs = Date.parse(parsed.last_touched_at);
			expect(Math.abs(Date.now() - touchedMs)).toBeLessThan(5000);
		});

		it("touches state without the guard ever reaching stateDir/ensureDir below it", async () => {
			// A dedicated OMT_DIR with no `state/` subdirectory pre-created — unlike
			// the shared beforeEach fixture above, which always mkdir's stateDir up
			// front. The heartbeat fires unconditionally on entry to makeDecision,
			// before Guard 2's activeBackgroundTaskCount > 0 check, so it touches this
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

				const result = makeDecision(
					createContext({
						sessionId: sid,
						activeBackgroundTaskCount: 1,
						deferredStopWakeGuaranteed: true,
					}),
				);

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

		it("preserves walk-away collectability: hooks/session-start.sh still reaps an abandoned session's inert state", async () => {
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
			// Control: an identical legacy state is inert to its own Stop call, without
			// touching (or aging) the walked-away fixture the GC step below depends on.
			await writeFile(controlPath, JSON.stringify(pursuingState));
			const controlDecision = makeDecision(
				createContext({ sessionId: controlSid, activeBackgroundTaskCount: 0 }),
			);
			expect(controlDecision).toEqual({ continue: true });

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
			const afterGc = makeDecision(
				createContext({ sessionId: walkedAwaySid, activeBackgroundTaskCount: 0 }),
			);
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

			makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 1,
					deferredStopWakeGuaranteed: true,
				}),
			);

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
		// 2's activeBackgroundTaskCount > 0 block — that is the point of the test. qa and
		// prometheus are the two state families with no per-family idle-Stop updater
		// of their own anywhere else in makeDecision (unlike goal/ultragoal, which
		// self-refresh last_touched_at on every pursuing Stop call): the ONLY thing
		// that can move either family's last_touched_at at activeBackgroundTaskCount === 0
		// is touchSessionStates firing unconditionally on entry, ahead of the guard.
		it("activeBackgroundTaskCount === 0 still fires the heartbeat for families with no per-family idle updater (prometheus, qa)", async () => {
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
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 0,
					lastAssistantMessage: "still working",
				}),
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
			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.progress_touched_at).toBe(staleIso);

			// Now Stop with no subagents active — must NOT wedge on the revived corpse.
			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeBackgroundTaskCount: 0 }),
			);
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

			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.progress_touched_at).toBe(staleIso);

			// First Stop call after revival — must not block, well before MAX_BLOCK_COUNT (5).
			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeBackgroundTaskCount: 0 }),
			);
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
			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.started_at).toBe(staleIso);
			expect(revived.progress_touched_at).toBe(staleIso);

			// Now Stop with no subagents active — must NOT wedge on the revived corpse.
			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeBackgroundTaskCount: 0 }),
			);
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

			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(Math.abs(Date.now() - Date.parse(revived.last_touched_at))).toBeLessThan(5000);
			expect(revived.started_at).toBe(staleIso);
			expect(revived.progress_touched_at).toBe(staleIso);

			const stopResult = makeDecision(
				createContext({ sessionId: sid, activeBackgroundTaskCount: 0 }),
			);
			expect(stopResult).toEqual({ continue: true });
		});

		// Corrected invariant (replaces a prior "legacy positive control" test that
		// asserted the OPPOSITE of what is correct here — it encoded a since-reverted
		// attempt that fell back to `started_at`). A legacy file that has never had a
		// GC-only writer touch it (progress_touched_at absent) must be judged by
		// `last_touched_at` alone. touchSessionStates now fires unconditionally on
		// every makeDecision call regardless of activeBackgroundTaskCount, so a heartbeat
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
			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(revived.progress_touched_at).toBe(recentTouch);

			// Next Stop call with no subagents active — must still block: the backfilled
			// progress_touched_at is fresh (2 minutes old), well under the 6h TTL.
			const stopResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 0,
					lastAssistantMessage: "still working",
				}),
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

			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const revived = JSON.parse(await readFile(statePath, "utf8"));
			expect(revived.progress_touched_at).toBe(recentTouch);

			const stopResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 0,
					lastAssistantMessage: "still working",
				}),
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
			const heartbeatResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 2,
					deferredStopWakeGuaranteed: true,
				}),
			);
			expect(heartbeatResult).toEqual({ continue: true });

			const stopResult = makeDecision(
				createContext({
					sessionId: sid,
					activeBackgroundTaskCount: 0,
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
			expect(makeDecision(createContext({ pendingSkillChainSkills: [] }))).toEqual({
				continue: true,
			});
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

	describe("ultragoal progress_touched_at and legacy goal inertness", () => {
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

		it("legacy goal: makeDecision does not advance iteration", async () => {
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
			expect(after.iteration).toBe(3);
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

describe("QA Stop-gate decision table", () => {
	const testDir = join(tmpdir(), "persistent-mode-qa-stop-test-" + Date.now());
	const projectRoot = join(testDir, "project");
	const omtDir = join(testDir, "omt");
	const stateDir = join(omtDir, "state");
	const sid = "qa-stop-session";
	const evidencePath = join(import.meta.dir, "decision.test.ts");

	beforeAll(async () => {
		await mkdir(stateDir, { recursive: true });
	});
	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	function cell(story: string, cls: number, sub?: "hang-timeout" | "flaky-green", status: "pass" | "fail" | "na" | null = "pass"): Record<string, any> {
		return {
			story,
			cls,
			...(sub ? { sub } : {}),
			attack_point: `attack ${cls}${sub ? ` ${sub}` : ""}`,
			priority: cls === 1 ? "H" : "M",
			status,
			cycle: 0,
			...(status === "pass" ? { evidence: { path: evidencePath, surface: "bash" } } : {}),
		};
	}

	function completeQa(verdict: "APPROVE" | "COMMENT" | "REQUEST_CHANGES" = "APPROVE"): Record<string, any> {
		return {
			active: true,
			phase: "BASELINE",
			phase_max: 2,
			cycle: 0,
			actors: [{ id: "actor-1", name: "Actor", boundary: "local boundary", driver: "bash", reachable: "yes" }],
			stories: [
				{
					id: "story-1",
					actor: "actor-1",
					baseline: {
						result: "pass",
						cycle: 0,
						evidence: { path: evidencePath, surface: "bash" },
					},
				},
			],
			cells: [
				cell("story-1", 1),
				cell("story-1", 2),
				cell("story-1", 3),
				cell("story-1", 4),
				cell("story-1", 5),
				cell("story-1", 6),
				cell("story-1", 1, "hang-timeout"),
				cell("story-1", 5, "flaky-green"),
			],
			run_checks: {
				stale_state: { result: "pass", cycle: 0 },
				dirty_worktree: { result: "fail", cycle: 0, note: "pre-existing changes" },
				flaky_rerun: { result: "pass", cycle: 0 },
			},
			verdict,
		};
	}

	function writeQaState(state: Record<string, unknown>, session = sid) {
		fs.writeFileSync(join(omtDir, `qa-state-${session}.json`), JSON.stringify(state));
	}

	function context(session = sid): DecisionContext {
		return {
			projectRoot,
			sessionId: session,
			lastAssistantMessage: null,
			incompleteTodoCount: 0,
			activeBackgroundTaskCount: 0,
		};
	}

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		await rm(omtDir, { recursive: true, force: true });
		await mkdir(stateDir, { recursive: true });
	});

	it("qa approve allow: active APPROVE with approveOk falls through", () => {
		const state = completeQa("APPROVE");
		writeQaState(state);
		expect(approveOk(state as never, (path) => ({ exists: fs.existsSync(path), size: fs.statSync(path).size }))).toBe(true);
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa inactive completed APPROVE with approveOk allows stop", () => {
		const state = completeQa("APPROVE");
		state.active = false;
		writeQaState(state);
		expect(approveOk(state as never, (path) => ({ exists: fs.existsSync(path), size: fs.statSync(path).size }))).toBe(true);
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa inactive completed COMMENT with commentOk allows stop", () => {
		const state = completeQa("COMMENT");
		state.active = false;
		writeQaState(state);
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa inactive completed REQUEST_CHANGES with recordComplete allows stop", () => {
		const state = completeQa("REQUEST_CHANGES");
		state.active = false;
		writeQaState(state);
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa inactive untouched REQUEST_CHANGES allows stop", () => {
		writeQaState({ active: false, phase: "PRE-FLIGHT", phase_max: 0, cycle: 0, verdict: "REQUEST_CHANGES", actors: [], stories: [], cells: [], run_checks: {} });
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa comment allow: active COMMENT with commentOk falls through", () => {
		writeQaState(completeQa("COMMENT"));
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa request-changes allow: recordComplete plus REQUEST_CHANGES", () => {
		writeQaState(completeQa("REQUEST_CHANGES"));
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa request-changes allow: cycleUntouched pre-flight fail-fast", () => {
		writeQaState({ active: true, phase: "PRE-FLIGHT", phase_max: 0, cycle: 0, verdict: "REQUEST_CHANGES", actors: [], stories: [], cells: [], run_checks: {} });
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa wedge: block-count >= MAX_BLOCK_COUNT allows stop without making approveOk true", async () => {
		const state = completeQa("APPROVE");
		(state.cells as Array<Record<string, unknown>>)[0].status = null;
		writeQaState(state);
		await writeFile(join(stateDir, `block-count-qa-${sid}`), "5");
		expect(approveOk(state as never, (path) => ({ exists: fs.existsSync(path), size: fs.statSync(path).size }))).toBe(false);
		expect(makeDecision(context())).toEqual({ continue: true });
		expect(fs.existsSync(join(stateDir, `block-count-qa-${sid}`))).toBe(false);
	});

	it("qa awaiting-user yield resets the QA namespace counter", async () => {
		writeQaState(completeQa("APPROVE"));
		await writeFile(join(stateDir, `block-count-qa-${sid}`), "3");
		expect(makeDecision({ ...context(), lastAssistantMessage: "pause <awaiting-user/>" })).toEqual({ continue: true });
		expect(fs.existsSync(join(stateDir, `block-count-qa-${sid}`))).toBe(false);
	});

	for (const verdict of [null, "APPROVE", "COMMENT", "REQUEST_CHANGES"] as const) {
		it(`qa default block: ${verdict ?? "null"} verdict with false predicate`, () => {
			const state = completeQa(verdict ?? "APPROVE");
			state.verdict = verdict;
			(state.cells as Array<Record<string, unknown>>)[0].status = null;
			writeQaState(state);
			const result = makeDecision(context());
			expect(result.decision).toBe("block");
			expect(result.reason).toContain("qa");
		});
	}

	it("qa empty-chain false APPROVE: recorded run checks do not make an empty chain approvable", () => {
		writeQaState({
			active: true,
			phase: "PRE-FLIGHT",
			phase_max: 0,
			cycle: 0,
			actors: [],
			stories: [],
			cells: [],
			run_checks: {
				stale_state: { result: "pass", cycle: 0 },
				dirty_worktree: { result: "pass", cycle: 0 },
				flaky_rerun: { result: "pass", cycle: 0 },
			},
			verdict: "APPROVE",
		});
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("qa inactive forged: touched inactive state with no allow arm blocks", () => {
		const state = completeQa("REQUEST_CHANGES");
		state.active = false;
		(state.cells as Array<Record<string, unknown>>)[0].status = null;
		writeQaState(state);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("qa inactive legacy: inactive untouched state does not block", () => {
		writeQaState({ active: false, phase: "PRE-FLIGHT", cycle: 0, actors: [], stories: [], cells: [], run_checks: {}, verdict: null });
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa no state file: never-invoked qa has no block", () => {
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("qa reset: partial work cannot claim REQUEST_CHANGES fail-fast", () => {
		const state = completeQa("REQUEST_CHANGES");
		state.stories = [{ id: "story-1", actor: "actor-1", baseline: null }];
		state.cells = [cell("story-1", 1)];
		writeQaState(state);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("qa authored but unrecorded: phase rewind and APPROVE still block", () => {
		const state = completeQa("APPROVE");
		state.phase = "PLAN";
		state.phase_max = 1;
		for (const current of state.cells as Array<Record<string, unknown>>) current.status = null;
		writeQaState(state);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("qa partial: recorded work with incomplete chain blocks under REQUEST_CHANGES", () => {
		const state = completeQa("REQUEST_CHANGES");
		state.stories = [{ id: "story-1", actor: "actor-1", baseline: null }];
		state.cells = [cell("story-1", 1)];
		writeQaState(state);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("qa evidence: deleting recorded evidence after state write blocks stop", () => {
		const tempEvidence = join(omtDir, "qa-evidence.txt");
		fs.writeFileSync(tempEvidence, "evidence");
		const state = completeQa("APPROVE");
		state.stories = [{ id: "story-1", actor: "actor-1", baseline: { result: "pass", cycle: 0, evidence: { path: tempEvidence, surface: "bash" } } }];
		state.cells = (state.cells as Array<Record<string, unknown>>).map((current) => ({ ...current, evidence: { path: tempEvidence, surface: "bash" } }));
		writeQaState(state);
		fs.unlinkSync(tempEvidence);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});
});

describe("explain-diff Stop-gate decision table", () => {
	const testDir = join(tmpdir(), "persistent-mode-ed-stop-test-" + Date.now());
	const projectRoot = join(testDir, "project");
	const omtDir = join(testDir, "omt");
	const stateDir = join(omtDir, "state");
	const sid = "ed-stop-session";

	beforeAll(async () => {
		await mkdir(stateDir, { recursive: true });
	});
	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});
	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		await rm(omtDir, { recursive: true, force: true });
		await mkdir(stateDir, { recursive: true });
	});

	function writeEdState(state: Record<string, unknown>, session = sid) {
		fs.writeFileSync(join(omtDir, `explain-diff-state-${session}.json`), JSON.stringify(state));
	}

	function context(session = sid): DecisionContext {
		return {
			projectRoot,
			sessionId: session,
			lastAssistantMessage: null,
			incompleteTodoCount: 0,
			activeBackgroundTaskCount: 0,
		};
	}

	const midSession = {
		active: true,
		step: "code",
		passed: ["evidence", "background", "intuition"],
		concepts: [],
		bank: [],
		awaiting_answer: false,
		no_progress: { key: "", count: 0, doc_digest: "" },
		last_failure: null,
	};

	it("문서를 아직 만드는 중이면 정지를 막는다", () => {
		writeEdState(midSession);
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("퀴즈 답을 기다리는 중이면 정지를 허용한다 — 사람이 답할 차례다", () => {
		writeEdState({
			...midSession,
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [{ id: "c1", required: true, passed: false }],
			awaiting_answer: true,
		});
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("필수 개념이 전부 통과되면 정지를 허용한다", () => {
		writeEdState({
			...midSession,
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [{ id: "c1", required: true, passed: true }],
		});
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("필수 개념이 남아 있으면 퀴즈 스텝에서도 정지를 막는다", () => {
		writeEdState({
			...midSession,
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [
				{ id: "c1", required: true, passed: true },
				{ id: "c2", required: true, passed: false },
			],
		});
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("필수 개념이 하나도 없으면 퀴즈 스텝이어도 정지를 막는다 — 빈 집합의 공허참을 막는다", () => {
		writeEdState({
			...midSession,
			step: "quiz",
			passed: ["evidence", "background", "intuition", "code", "render"],
			concepts: [{ id: "c1", required: false, passed: true }],
		});
		expect(makeDecision(context())).toMatchObject({ decision: "block" });
	});

	it("stalled 로 표시되면 정지를 허용한다 — 사용자만 풀 수 있는 교착이다", () => {
		writeEdState({ ...midSession, stalled: true });
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("비활성 상태는 정지를 막지 않는다", () => {
		writeEdState({ ...midSession, active: false });
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("상태 파일이 없으면 이 게이트는 관여하지 않는다", () => {
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("차단 횟수가 상한에 닿으면 탈출한다 — 게이트가 세션을 영구히 묶지 않는다", async () => {
		writeEdState(midSession);
		await writeFile(join(stateDir, `block-count-explain-diff-${sid}`), "5");
		expect(makeDecision(context())).toEqual({ continue: true });
	});

	it("차단 메시지는 어느 스텝이 남았는지 이름을 대준다", () => {
		writeEdState(midSession);
		const out = makeDecision(context());
		expect(JSON.stringify(out)).toContain("code");
	});
});

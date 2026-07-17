import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
	readDeepInterviewState,
	readDeepInterviewStateRaw,
	cleanupDeepInterviewState,
	readPrometheusState,
	cleanupPrometheusState,
	readGoalState,
	readGoalStateRaw,
	updateGoalState,
	readUltragoalState,
	readUltragoalStateRaw,
	updateUltragoalState,
	getBlockCount,
	incrementBlockCount,
	cleanupBlockCountFiles,
	MAX_BLOCK_COUNT,
} from "./state.ts";
import { writeFileNoCreate } from "@lib/state-core";
import type { DeepInterviewState } from "./types.ts";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Block counting", () => {
	const testDir = join(tmpdir(), "state-test-block-count-" + Date.now());
	const stateDir = join(testDir, "state");
	const attemptId = "attempt-123";

	beforeAll(async () => {
		await mkdir(stateDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		// Clean up block count files before each test
		try {
			await rm(join(stateDir, `block-count-${attemptId}`), { force: true });
		} catch {}
	});

	describe("MAX_BLOCK_COUNT", () => {
		it("should be 5", () => {
			expect(MAX_BLOCK_COUNT).toBe(5);
		});
	});

	describe("getBlockCount", () => {
		it("should return 0 when file does not exist", () => {
			const result = getBlockCount(stateDir, "nonexistent");

			expect(result).toBe(0);
		});

		it("should return count from file", async () => {
			await writeFile(join(stateDir, `block-count-${attemptId}`), "3");

			const result = getBlockCount(stateDir, attemptId);

			expect(result).toBe(3);
		});

		it("should return 0 for invalid content", async () => {
			await writeFile(join(stateDir, `block-count-${attemptId}`), "not a number");

			const result = getBlockCount(stateDir, attemptId);

			expect(result).toBe(0);
		});
	});

	describe("incrementBlockCount", () => {
		it("should increment from 0 when no file exists", () => {
			incrementBlockCount(stateDir, attemptId);

			expect(getBlockCount(stateDir, attemptId)).toBe(1);
		});

		it("should increment existing count", async () => {
			await writeFile(join(stateDir, `block-count-${attemptId}`), "2");

			incrementBlockCount(stateDir, attemptId);

			expect(getBlockCount(stateDir, attemptId)).toBe(3);
		});

		it("should create state directory if needed", async () => {
			const newStateDir = join(testDir, "new-state");

			incrementBlockCount(newStateDir, attemptId);

			expect(existsSync(newStateDir)).toBe(true);
		});
	});

	describe("cleanupBlockCountFiles", () => {
		it("should delete block count file", async () => {
			await writeFile(join(stateDir, `block-count-${attemptId}`), "3");

			cleanupBlockCountFiles(stateDir, attemptId);

			expect(existsSync(join(stateDir, `block-count-${attemptId}`))).toBe(false);
		});

		it("should not throw when files do not exist", () => {
			expect(() => cleanupBlockCountFiles(stateDir, "nonexistent")).not.toThrow();
		});
	});
});

describe("Deep interview state management", () => {
	const testDir = join(tmpdir(), "state-test-deep-interview-" + Date.now());
	const omtDir = join(testDir, "omt");
	const sessionId = "test-session-di";

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		const stateFile = join(omtDir, `deep-interview-active-state-${sessionId}.json`);
		try {
			await rm(stateFile, { force: true });
		} catch {}
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	describe("readDeepInterviewState", () => {
		it("deep-interview: readDeepInterviewState returns state when active=true", async () => {
			const state: DeepInterviewState = { active: true };
			await writeFile(
				join(omtDir, `deep-interview-active-state-${sessionId}.json`),
				JSON.stringify(state),
			);

			const result = readDeepInterviewState(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(true);
		});

		it("deep-interview: readDeepInterviewState returns null when active=false", async () => {
			const state: DeepInterviewState = { active: false };
			await writeFile(
				join(omtDir, `deep-interview-active-state-${sessionId}.json`),
				JSON.stringify(state),
			);

			const result = readDeepInterviewState(sessionId);

			expect(result).toBeNull();
		});
	});

	describe("cleanupDeepInterviewState", () => {
		it("deep-interview: cleanupDeepInterviewState removes file and is idempotent", async () => {
			const stateFile = join(omtDir, `deep-interview-active-state-${sessionId}.json`);
			await writeFile(stateFile, JSON.stringify({ active: true }));

			cleanupDeepInterviewState(sessionId);

			expect(existsSync(stateFile)).toBe(false);

			// Second call on nonexistent file must not throw
			expect(() => cleanupDeepInterviewState(sessionId)).not.toThrow();
		});
	});
});

describe("Prometheus state management", () => {
	const testDir = join(tmpdir(), "state-test-prometheus-" + Date.now());
	const omtDir = join(testDir, "omt");
	const sessionId = "test-session-prom";

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		const stateFile = join(omtDir, `prometheus-state-${sessionId}.json`);
		try {
			await rm(stateFile, { force: true });
		} catch {}
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	describe("readPrometheusState", () => {
		it("prometheus: readPrometheusState returns state when active=true", async () => {
			// Write the realistic on-disk shape that the seed hook and CLI produce
			const onDisk = {
				active: true,
				phase: "planning",
				plan_path: "/tmp/plan.md",
				resume_summary: "Continue from step 3",
				started_at: "2026-06-08T12:00:00+09:00",
			};
			await writeFile(join(omtDir, `prometheus-state-${sessionId}.json`), JSON.stringify(onDisk));

			const result = readPrometheusState(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(true);
		});

		it("prometheus: readPrometheusState returns null when active=false", async () => {
			const onDisk = { active: false };
			await writeFile(join(omtDir, `prometheus-state-${sessionId}.json`), JSON.stringify(onDisk));

			const result = readPrometheusState(sessionId);

			expect(result).toBeNull();
		});

		it("prometheus: readPrometheusState returns null when file is missing", () => {
			const result = readPrometheusState(sessionId);

			expect(result).toBeNull();
		});
	});

	describe("cleanupPrometheusState", () => {
		it("prometheus: cleanupPrometheusState removes file and is idempotent", async () => {
			const stateFile = join(omtDir, `prometheus-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "planning",
					plan_path: "/tmp/plan.md",
					resume_summary: "",
					started_at: "2026-06-08T12:00:00+09:00",
				}),
			);

			cleanupPrometheusState(sessionId);

			expect(existsSync(stateFile)).toBe(false);

			// Second call on nonexistent file must not throw
			expect(() => cleanupPrometheusState(sessionId)).not.toThrow();
		});
	});
});

describe("Goal state management", () => {
	const testDir = join(tmpdir(), "state-test-goal-" + Date.now());
	const omtDir = join(testDir, "omt");
	const sessionId = "test-session-goal";

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
		try {
			await rm(stateFile, { force: true });
		} catch {}
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	describe("readGoalState", () => {
		it("readGoalState null on absent or malformed file", async () => {
			// absent: file does not exist
			expect(readGoalState("nonexistent-goal")).toBeNull();

			// malformed: invalid JSON
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(stateFile, "not valid json {");
			expect(readGoalState(sessionId)).toBeNull();

			// active=false (terminal state): must read as null
			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 3,
					max_iterations: 10,
				}),
			);
			expect(readGoalState(sessionId)).toBeNull();
		});

		it("goal: readGoalState returns state when active=true", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 2,
					max_iterations: 10,
				}),
			);

			const result = readGoalState(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(true);
			expect(result?.phase).toBe("pursuing");
			expect(result?.iteration).toBe(2);
			expect(result?.max_iterations).toBe(10);
			expect(result?.objective_verdict).toBe("absent");
		});

		// B8: readGoalState is readGoalStateRaw folded by active — same object
		// when active, null when inactive.
		it("readGoalState mirrors readGoalStateRaw folded by active", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);

			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 4,
					max_iterations: 10,
				}),
			);
			expect(readGoalState(sessionId)).toEqual(readGoalStateRaw(sessionId));

			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 4,
					max_iterations: 10,
				}),
			);
			expect(readGoalState(sessionId)).toBeNull();
			expect(readGoalStateRaw(sessionId)).not.toBeNull();
		});
	});

	describe("readGoalStateRaw", () => {
		it("readGoalStateRaw returns the object even when active=false (terminal state)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 3,
					max_iterations: 10,
				}),
			);

			const result = readGoalStateRaw(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(false);
			expect(result?.phase).toBe("complete");
		});

		it("readGoalStateRaw returns null on absent file", () => {
			expect(readGoalStateRaw("nonexistent-goal-raw")).toBeNull();
		});

		it("readGoalStateRaw returns null on malformed file", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(stateFile, "not valid json {");

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		// Schema guard: structural validation of load-bearing fields
		it("readGoalStateRaw returns null when max_iterations is missing (cap-bypass guard)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 2,
					// max_iterations intentionally omitted
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it('readGoalStateRaw returns null when phase is an unknown token (e.g. "pursuit")', async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuit", // typo'd — not a valid GoalPhase
					objective_verdict: "absent",
					iteration: 2,
					max_iterations: 10,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null for empty object {}", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(stateFile, JSON.stringify({}));

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null when iteration is non-finite (e.g. NaN)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			// JSON does not have NaN; use null to produce a non-number value
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: null,
					max_iterations: 10,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		// B-2: integer + range guards — asymmetric corrupted-state defense
		it("readGoalStateRaw returns null when max_iterations is 0 (must be >= 1)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 0,
					max_iterations: 0,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null when max_iterations is negative (e.g. -1)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 0,
					max_iterations: -1,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null when iteration is negative (e.g. -1000)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: -1000,
					max_iterations: 10,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null when iteration is fractional (e.g. 2.5)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 2.5,
					max_iterations: 10,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns null when max_iterations is fractional (e.g. 1.5)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 0,
					max_iterations: 1.5,
				}),
			);

			expect(readGoalStateRaw(sessionId)).toBeNull();
		});

		it("readGoalStateRaw returns valid state when iteration is 0 (base-0 is valid)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 0,
					max_iterations: 10,
				}),
			);

			const result = readGoalStateRaw(sessionId);

			expect(result).not.toBeNull();
			expect(result?.iteration).toBe(0);
			expect(result?.max_iterations).toBe(10);
		});

		it("readGoalStateRaw returns valid terminal state when iteration equals max_iterations", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 10,
					max_iterations: 10,
				}),
			);

			const result = readGoalStateRaw(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(false);
			expect(result?.iteration).toBe(10);
			expect(result?.max_iterations).toBe(10);
		});

		it("readGoalStateRaw returns the object for a VALID terminal state (active:false, all fields well-formed)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 5,
					max_iterations: 10,
				}),
			);

			const result = readGoalStateRaw(sessionId);

			expect(result).not.toBeNull();
			expect(result?.active).toBe(false);
			expect(result?.phase).toBe("complete");
			expect(result?.iteration).toBe(5);
			expect(result?.max_iterations).toBe(10);
		});

		it("readGoalState returns null for a VALID terminal state (active-fold preserved)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: false,
					phase: "complete",
					objective_verdict: "APPROVE",
					iteration: 5,
					max_iterations: 10,
				}),
			);

			// readGoalState folds active:false → null even when all fields are valid
			expect(readGoalState(sessionId)).toBeNull();
			// readGoalStateRaw still returns the object
			expect(readGoalStateRaw(sessionId)).not.toBeNull();
		});
	});

	describe("updateGoalState", () => {
		it("updateGoalState spread-overlay preserves SKILL-only fields", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 1,
					max_iterations: 10,
					// SKILL-only fields the hook does not type:
					outcome: "Ship the feature",
					started_at: "2026-06-06T12:00:00",
					schema_version: 1,
				}),
			);

			updateGoalState(sessionId, { iteration: 3 });

			const content = await readFile(stateFile, "utf8");
			const parsed = JSON.parse(content);
			// Overlaid key changed:
			expect(parsed.iteration).toBe(3);
			// SKILL-only fields survive unchanged:
			expect(parsed.outcome).toBe("Ship the feature");
			expect(parsed.started_at).toBe("2026-06-06T12:00:00");
			expect(parsed.schema_version).toBe(1);
			// Untouched typed fields survive:
			expect(parsed.phase).toBe("pursuing");
			expect(parsed.max_iterations).toBe(10);
		});

		it("updateGoalState is a no-op on absent file (creates no file)", () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			expect(existsSync(stateFile)).toBe(false);

			updateGoalState(sessionId, { iteration: 3 });

			expect(existsSync(stateFile)).toBe(false);
		});

		it("updateGoalState is a no-op on malformed file (does not overwrite)", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(stateFile, "not valid json {");

			updateGoalState(sessionId, { iteration: 3 });

			const content = await readFile(stateFile, "utf8");
			expect(content).toBe("not valid json {");
		});

		// (A5) hook-side updateGoalState refreshes last_touched_at without creating
		it("(A5) updateGoalState stamps last_touched_at on an existing file", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			const oldStamp = "2020-01-01T00:00:00+00:00";
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 1,
					max_iterations: 10,
					started_at: "2020-01-01T00:00:00+00:00",
					last_touched_at: oldStamp,
				}),
			);

			updateGoalState(sessionId, { iteration: 2 });

			const content = await readFile(stateFile, "utf8");
			const parsed = JSON.parse(content);
			expect(parsed.last_touched_at).toBeTruthy();
			expect(parsed.last_touched_at).not.toBe(oldStamp);
			// stamp must be greater than the old one
			expect(parsed.last_touched_at > oldStamp).toBe(true);
		});

		// (A5) updateGoalState does NOT create a file when absent
		it("(A5) updateGoalState does not create a file when absent", () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			expect(existsSync(stateFile)).toBe(false);

			updateGoalState(sessionId, { iteration: 1 });

			expect(existsSync(stateFile)).toBe(false);
		});

		// (ADR-8) updateGoalState stamps last_touched_at UNCONDITIONALLY — empty partial still refreshes
		it("(ADR-8) updateGoalState stamps last_touched_at on an EMPTY partial", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			const oldStamp = "2020-01-01T00:00:00+00:00";
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 1,
					max_iterations: 10,
					started_at: "2020-01-01T00:00:00+00:00",
					last_touched_at: oldStamp,
					outcome: "keep me",
				}),
			);

			updateGoalState(sessionId, {});

			const content = await readFile(stateFile, "utf8");
			const parsed = JSON.parse(content);
			// stamp must have advanced
			expect(parsed.last_touched_at).not.toBe(oldStamp);
			expect(parsed.last_touched_at > oldStamp).toBe(true);
			// all other fields unchanged
			expect(parsed.iteration).toBe(1);
			expect(parsed.outcome).toBe("keep me");
		});

		// (TOCTOU no-create) updateGoalState must use a no-create write primitive so that a
		// concurrent adopt-rename between read and write does NOT resurrect the orphaned file.
		//
		// RED achieved: primitive-level contract test.
		//   OLD code path: writeFileSafe(path, content) on an absent path creates the file
		//     → existsSync(path) would be true after the call.
		//   NEW code path: writeFileNoCreate(path, content) throws ENOENT on absent path
		//     → updateGoalState catches ENOENT and returns → no file created.
		//
		// This test verifies the primitive contract: writeFileNoCreate on an absent path
		// throws ENOENT (the no-create guarantee) and does NOT create the file.
		// Against the old writeFileSafe: a parallel call to writeFileSafe on an absent path
		// would PASS (no throw) but would create the file — making the existsSync assertion fail.
		it("(TOCTOU) writeFileNoCreate on absent path throws ENOENT and does NOT create a file", () => {
			const racePath = join(omtDir, `goal-state-race-${sessionId}.json`);
			// Guarantee the file does not exist (simulates file deleted between read and write)
			expect(existsSync(racePath)).toBe(false);

			// writeFileNoCreate must throw ENOENT on absent path (no-create contract)
			let thrownCode: string | undefined;
			try {
				writeFileNoCreate(racePath, '{"active":true}');
			} catch (err) {
				thrownCode = (err as NodeJS.ErrnoException).code;
			}
			expect(thrownCode).toBe("ENOENT");
			// The file must NOT have been created — no resurrection
			expect(existsSync(racePath)).toBe(false);
		});

		// (TOCTOU public-API) after a race-deletion between read and write, updateGoalState
		// must not resurrect the file.  Simulated deterministically: seed, then call
		// updateGoalState (succeeds on existing file), then synchronously delete and call again.
		// Second call exercises the null-check guard.  Included to document that the full
		// update cycle — including the no-create write path — never creates an absent file.
		it("(TOCTOU public-API) updateGoalState does not resurrect a file deleted before write", async () => {
			const stateFile = join(omtDir, `goal-state-${sessionId}.json`);
			await writeFile(
				stateFile,
				JSON.stringify({
					active: true,
					phase: "pursuing",
					objective_verdict: "absent",
					iteration: 5,
					max_iterations: 10,
				}),
			);

			// First call succeeds — file is present at read AND write time
			updateGoalState(sessionId, { iteration: 6 });
			expect(existsSync(stateFile)).toBe(true);

			// Simulate the adopt-rename completing between two hook invocations — file is gone
			unlinkSync(stateFile);

			// Second call: file absent — must be a no-op, must not create
			updateGoalState(sessionId, { iteration: 7 });
			expect(existsSync(stateFile)).toBe(false);
		});
	});
});

describe("Ultragoal state management", () => {
	const testDir = join(tmpdir(), "state-test-ultragoal-" + Date.now());
	const omtDir = join(testDir, "omt");
	const sessionId = "test-session-ultragoal";

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		const stateFile = join(omtDir, `ultragoal-state-${sessionId}.json`);
		try {
			await rm(stateFile, { force: true });
		} catch {}
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	it("ultragoal: readUltragoalState returns state when active=true, null when active=false (active-fold mirrors goal)", async () => {
		const stateFile = join(omtDir, `ultragoal-state-${sessionId}.json`);
		await writeFile(
			stateFile,
			JSON.stringify({
				active: true,
				phase: "pursuing",
				objective_verdict: "absent",
				iteration: 1,
				max_iterations: 10,
			}),
		);

		const result = readUltragoalState(sessionId);
		expect(result).not.toBeNull();
		expect(result?.phase).toBe("pursuing");
		expect(result).toEqual(readUltragoalStateRaw(sessionId));

		await writeFile(
			stateFile,
			JSON.stringify({
				active: false,
				phase: "complete",
				objective_verdict: "APPROVE",
				iteration: 3,
				max_iterations: 10,
			}),
		);
		expect(readUltragoalState(sessionId)).toBeNull();
		expect(readUltragoalStateRaw(sessionId)).not.toBeNull();
	});

	it("ultragoal: readUltragoalStateRaw returns null on absent or malformed file", async () => {
		expect(readUltragoalStateRaw("nonexistent-ultragoal")).toBeNull();

		const stateFile = join(omtDir, `ultragoal-state-${sessionId}.json`);
		await writeFile(stateFile, "not valid json {");
		expect(readUltragoalStateRaw(sessionId)).toBeNull();
	});

	it("ultragoal: updateUltragoalState spread-overlay preserves SKILL-only fields; no-op on absent file", async () => {
		const stateFile = join(omtDir, `ultragoal-state-${sessionId}.json`);
		await writeFile(
			stateFile,
			JSON.stringify({
				active: true,
				phase: "pursuing",
				objective_verdict: "absent",
				iteration: 1,
				max_iterations: 10,
				outcome: "Ship the multi-story feature",
				schema_version: 1,
			}),
		);

		updateUltragoalState(sessionId, { iteration: 3 });

		const content = await readFile(stateFile, "utf8");
		const parsed = JSON.parse(content);
		expect(parsed.iteration).toBe(3);
		expect(parsed.outcome).toBe("Ship the multi-story feature");
		expect(parsed.schema_version).toBe(1);

		const absentSessionId = "nonexistent-ultragoal-update";
		const absentFile = join(omtDir, `ultragoal-state-${absentSessionId}.json`);
		expect(existsSync(absentFile)).toBe(false);
		updateUltragoalState(absentSessionId, { iteration: 3 });
		expect(existsSync(absentFile)).toBe(false);
	});
});

describe("readDeepInterviewStateRaw", () => {
	const testDir = join(tmpdir(), "state-test-diraw-" + Date.now());
	const omtDir = join(testDir, "omt");
	const sessionId = "test-session";

	const savedOmtDir = process.env.OMT_DIR;

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		process.env.OMT_DIR = omtDir;
		const stateFile = join(omtDir, `deep-interview-active-state-${sessionId}.json`);
		try {
			await rm(stateFile, { force: true });
		} catch {}
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
	});

	it("readDeepInterviewStateRaw returns the object even when active=false (terminal state)", async () => {
		const state: DeepInterviewState = { active: false };
		await writeFile(
			join(omtDir, `deep-interview-active-state-${sessionId}.json`),
			JSON.stringify(state),
		);

		const result = readDeepInterviewStateRaw(sessionId);

		expect(result).not.toBeNull();
		expect(result?.active).toBe(false);
	});

	it("readDeepInterviewStateRaw returns state when active=true", async () => {
		const state: DeepInterviewState = { active: true };
		await writeFile(
			join(omtDir, `deep-interview-active-state-${sessionId}.json`),
			JSON.stringify(state),
		);

		const result = readDeepInterviewStateRaw(sessionId);

		expect(result).not.toBeNull();
		expect(result?.active).toBe(true);
	});

	it("readDeepInterviewStateRaw returns null on absent file", () => {
		expect(readDeepInterviewStateRaw("nonexistent-di-raw")).toBeNull();
	});

	it("readDeepInterviewStateRaw returns null on malformed JSON", async () => {
		await writeFile(
			join(omtDir, `deep-interview-active-state-${sessionId}.json`),
			"not valid json {",
		);

		expect(readDeepInterviewStateRaw(sessionId)).toBeNull();
	});
});

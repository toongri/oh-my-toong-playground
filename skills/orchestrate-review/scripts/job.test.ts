#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, spawn, spawnSync } from "child_process";

import {
	buildUiPayload,
	buildManifest,
	parseChunkReviewConfig,
	computeStatus,
	detectCliType,
	buildAugmentedCommand,
	gcStaleJobs,
	cmdStart,
	cmdReap,
	classifyReapedOrphans,
} from "./job.ts";
import { extractDenySkills } from "@lib/generic-job";
import * as GenericJob from "@lib/generic-job";
import * as JobUtils from "@lib/job-utils";
import { getOmtDir } from "@lib/omt-dir";

// Snapshot the real bindings before any test mocks "@lib/job-utils" — mock.module mutates the
// shared module namespace object in place (and the swap leaks across this file's boundary since
// bun test runs every file in one process), so restoring via `() => JobUtils` after a mock would
// hand back the already-mutated object. This pristine copy is the real restore target.
const realJobUtils = { ...JobUtils };
// Same reasoning for "@lib/generic-job".
const realGenericJob = { ...GenericJob };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "chunk-job-test-"));
}

/**
 * `start` spawns a detached worker (lib/generic-job.ts spawnWorkers) that inherits
 * `env: process.env` and execs the member's real CLI command. A test whose config
 * declares a real CLI name (claude/codex/gemini) so it can pass assertDenyEnforceable
 * would otherwise spawn the actual billed CLI binary. This stub directory shadows all
 * three CLI names on PATH with a no-op `exit 0` script — detectCliType still resolves
 * the command's first token to "claude"/"codex"/"gemini" (so the enforceability gate
 * still passes), but the process the worker execs is this harmless stub.
 */
function makeCliStubDir(): string {
	const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "deny-cli-stub-"));
	for (const cli of ["claude", "codex", "gemini"]) {
		const stubPath = path.join(stubDir, cli);
		fs.writeFileSync(stubPath, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(stubPath, 0o755);
	}
	return stubDir;
}

/**
 * Builds an orphan job fixture directly on disk: a real detached process group
 * (a `sleep 30`, so it stays alive for the duration of a test) recorded as a
 * job's only member's `workerPgid`, with that member's status already terminal
 * ("done"). This is exactly lib/generic-job.ts's `findOrphanJobs` predicate —
 * alive PGID + zero live progress (`findActiveMembers` returns none) — so the
 * fixture is judged orphaned without needing to fake or bypass that judgment.
 */
function makeOrphanJobFixture(
	jobsDir: string,
	name: string,
	opts: { createdAt?: string } = {},
): { jobDir: string; pgid: number } {
	const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
	child.unref();
	// A detached child is the leader of its own process group, so PGID === PID
	// (same platform contract lib/generic-job.ts's spawnWorkers relies on).
	const pgid = child.pid as number;
	// Spawn-time witness (same `ps -o lstart=` value spawnWorkers itself records)
	// — required since the orphan reaper only signals a PGID whose current
	// leader's start time matches this recorded value (PID/PGID reuse guard).
	const workerPgidStartedAt = execFileSync("ps", ["-o", "lstart=", "-p", String(pgid)], {
		encoding: "utf8",
	}).trim();

	const jobDir = path.join(jobsDir, `chunk-review-${name}`);
	const memberDir = path.join(jobDir, "members", "alice");
	fs.mkdirSync(memberDir, { recursive: true });
	fs.writeFileSync(
		path.join(jobDir, "job.json"),
		JSON.stringify({
			id: `chunk-review-${name}`,
			createdAt: opts.createdAt ?? new Date().toISOString(),
			members: [{ name: "alice", workerPgid: pgid, workerPgidStartedAt }],
		}),
	);
	fs.writeFileSync(
		path.join(memberDir, "status.json"),
		JSON.stringify({ member: "alice", state: "done", exitCode: 0 }),
	);
	return { jobDir, pgid };
}

/**
 * Same fixture shape as makeOrphanJobFixture, but with N members — each its
 * own detached `sleep 30` process group — under a single job. Exists to
 * reproduce the job-count-vs-process-count mislabel: findOrphanJobs collapses
 * this into ONE orphan entry with `pgids.length === memberNames.length`, so a
 * caller that reports "N orphan job(s) ... M process(es)" using the same N
 * for both is wrong whenever a job has more than one live member.
 */
function makeMultiMemberOrphanJobFixture(
	jobsDir: string,
	name: string,
	memberNames: string[],
): { jobDir: string; pgids: number[] } {
	const jobDir = path.join(jobsDir, `chunk-review-${name}`);
	const members: Array<{ name: string; workerPgid: number; workerPgidStartedAt: string }> = [];
	const pgids: number[] = [];
	for (const memberName of memberNames) {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		child.unref();
		const pgid = child.pid as number;
		const workerPgidStartedAt = execFileSync("ps", ["-o", "lstart=", "-p", String(pgid)], {
			encoding: "utf8",
		}).trim();
		const memberDir = path.join(jobDir, "members", memberName);
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(
			path.join(memberDir, "status.json"),
			JSON.stringify({ member: memberName, state: "done", exitCode: 0 }),
		);
		members.push({ name: memberName, workerPgid: pgid, workerPgidStartedAt });
		pgids.push(pgid);
	}
	fs.writeFileSync(
		path.join(jobDir, "job.json"),
		JSON.stringify({ id: `chunk-review-${name}`, createdAt: new Date().toISOString(), members }),
	);
	return { jobDir, pgids };
}

/** `kill(pgid, 0)` sends no signal — it only probes whether the group still exists. */
function isPgidAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

function killPgidIfAlive(pgid: number): void {
	try {
		process.kill(-pgid, "SIGKILL");
	} catch {
		// already reaped/exited — nothing to clean up
	}
}

// `start` spawns its worker detached; `execFileSync("start", …)` returns long before
// that worker execs the member's CLI command (observed ~283ms later). A per-test
// stub dir torn down right after `start` returns — even after `stop`/`clean` — races
// that exec: PATH resolution doesn't fail closed when the stub disappears, it falls
// through to the next PATH entry (a real, billed CLI binary). Suite-scoped lifetime
// keeps the stub alive for every test in this file, past any worker's real exec.
let sharedStubDir: string;

/**
 * Log filename a jobDir's fixture produces, mirroring initLoggerFromJobDir's
 * (job.ts) jobId extraction and initLogger's (lib/logging.ts) filename template.
 */
function expectedLogFileName(jobDirBasename: string): string {
	const jobId = jobDirBasename.replace(/^chunk-review-/, "");
	const sanitized = jobId.replace(/[^a-zA-Z0-9-]/g, "-");
	return `chunk-review-job-${sanitized}.log`;
}

/**
 * Every jobDir basename this suite passes to status/results/collect/stop/clean
 * (the five commands that call initLoggerFromJobDir). A fixture must route its
 * literal through suiteJobDirBasename() below so a name missing from this array
 * fails to typecheck instead of silently escaping the AC9 canary.
 */
const SUITE_JOB_DIR_BASENAMES = [
	"evil",
	"chunk-review-test",
	"not-a-job",
	"job-qa1",
	"job-qa2",
	"job-qa3",
	"job-qa4",
	"job-manifest1",
	"job-manifest2",
	"job-manifest3",
	"job-manifest4",
	"job-overflow-replay",
	"job-collect-done",
	"chunk-review-logroot01",
	"chunk-review-durations1",
	"job-collect-timeout",
	"chunk-review-hardcap-clamp",
	"job-collect-size-bytes",
] as const;

function suiteJobDirBasename(name: (typeof SUITE_JOB_DIR_BASENAMES)[number]): string {
	return name;
}

/**
 * Real log directory an unfixed jobDir-under-tmpDir fixture leaks into —
 * see job.ts's logRootForJobsDir.
 */
const REAL_TMP_LOG_DIR = path.join(os.tmpdir(), "logs");

/**
 * Real log directory AC9 names literally ("~/.omt/<project>/logs/").
 */
const REAL_OMT_LOG_DIR = path.join(getOmtDir(), "logs");

/** mtimeMs+size fingerprint, or null if the file didn't exist at snapshot time. */
type FileFingerprint = { mtimeMs: number; size: number } | null;

function fingerprint(filePath: string): FileFingerprint {
	try {
		const st = fs.statSync(filePath);
		return { mtimeMs: st.mtimeMs, size: st.size };
	} catch {
		return null;
	}
}

// Snapshotted at module load — before any test in this file (or, best-effort, a
// concurrent worktree's own run) can write a log — so the AC9 canary below judges
// "did this suite change these files" rather than "do these names exist right now".
// A name pre-existing from an unrelated run is untouched by this suite and must stay
// untouched; the canary only fails on a fingerprint delta this suite itself causes.
const SUITE_LOG_FINGERPRINTS_BEFORE = new Map<string, FileFingerprint>();
for (const basename of SUITE_JOB_DIR_BASENAMES) {
	const file = expectedLogFileName(basename);
	SUITE_LOG_FINGERPRINTS_BEFORE.set(path.join(REAL_TMP_LOG_DIR, file), fingerprint(path.join(REAL_TMP_LOG_DIR, file)));
	SUITE_LOG_FINGERPRINTS_BEFORE.set(path.join(REAL_OMT_LOG_DIR, file), fingerprint(path.join(REAL_OMT_LOG_DIR, file)));
}

beforeAll(() => {
	sharedStubDir = makeCliStubDir();
});

afterAll(() => {
	fs.rmSync(sharedStubDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseChunkReviewConfig
// ---------------------------------------------------------------------------

describe("parseChunkReviewConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns fallback when config file does not exist", async () => {
		const result = await parseChunkReviewConfig(path.join(tmpDir, "missing.yaml"));
		expect(result["chunk-review"]).toBeTruthy();
		expect(Array.isArray(result["chunk-review"].members)).toBeTruthy();
		expect(result["chunk-review"].members.length > 0).toBeTruthy();
		expect(result["chunk-review"].chairman.role).toBe("auto");
	});

	test("fallback contains default members (claude, codex)", async () => {
		const result = await parseChunkReviewConfig(path.join(tmpDir, "nope.yaml"));
		const names = result["chunk-review"].members.map((r) => (r as { name: string }).name);
		expect(names.includes("claude")).toBeTruthy();
		expect(names.includes("codex")).toBeTruthy();
		expect(names.includes("gemini")).toBeFalsy();
	});

	test("fallback contains default settings", async () => {
		const result = await parseChunkReviewConfig(path.join(tmpDir, "nope.yaml"));
		expect(result["chunk-review"].settings.exclude_chairman_from_members).toBe(true);
		expect(result["chunk-review"].settings.timeout).toBe(300);
	});

	test("parses valid config via simple parser (yaml module unavailable)", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: gemini",
				"  members:",
				"    - name: alice",
				"      command: alice-cli",
				"  settings:",
				"    timeout: 600",
			].join("\n"),
		);
		const result = await parseChunkReviewConfig(configPath);
		expect(result["chunk-review"].chairman.role).toBe("gemini");
		expect(result["chunk-review"].members.length).toBe(1);
		expect((result["chunk-review"].members[0] as { name: string }).name).toBe("alice");
		expect(result["chunk-review"].settings.timeout).toBe(600);
	});

	test("merges settings with defaults from fallback", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(configPath, ["chunk-review:", "  settings:", "    timeout: 999"].join("\n"));
		const result = await parseChunkReviewConfig(configPath);
		expect(result["chunk-review"].settings.timeout).toBe(999);
		expect(result["chunk-review"].settings.exclude_chairman_from_members).toBe(true);
	});

	test("returns structure with chunk-review top-level key", async () => {
		const result = await parseChunkReviewConfig(path.join(tmpDir, "nope.yaml"));
		const keys = Object.keys(result);
		expect(keys).toEqual(["chunk-review"]);
	});

	test("parses member env map from config", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  members:",
				"    - name: kimi",
				"      command: kimi-cli",
				"      env:",
				"        KIMI_API_KEY: test-key",
				"        KIMI_MODEL: kimi-k2",
			].join("\n"),
		);
		const result = await parseChunkReviewConfig(configPath);
		expect((result["chunk-review"].members[0] as { env: unknown }).env).toEqual({
			KIMI_API_KEY: "test-key",
			KIMI_MODEL: "kimi-k2",
		});
	});

	test("real config registers the 4 angle members", async () => {
		const realPath = path.join(import.meta.dirname, "..", "orchestrate-review.config.yaml");
		const result = await parseChunkReviewConfig(realPath);
		const names = result["chunk-review"].members.map((r) => (r as { name: string }).name);
		expect(names).toEqual(["correctness", "regression", "cleanup", "requirement"]);
	});

	test("모든 멤버의 해석된 명령이 `-c agents.enabled=false` 를 포함한다", async () => {
		const realPath = path.join(import.meta.dirname, "..", "orchestrate-review.config.yaml");
		const result = await parseChunkReviewConfig(realPath);
		const denySkills = extractDenySkills(
			result["chunk-review"].settings as unknown as Record<string, unknown>,
		);
		for (const member of result["chunk-review"].members as { name: string; command: unknown }[]) {
			const entity = { ...member, deny: denySkills };
			const cliType = detectCliType(entity.command as string);
			const { command } = buildAugmentedCommand(entity, cliType);
			expect(command.includes("-c agents.enabled=false")).toBe(true);
		}
	});

	test('real config declares settings.mcps.allow as exactly ["codegraph"]', async () => {
		const realPath = path.join(import.meta.dirname, "..", "orchestrate-review.config.yaml");
		const result = await parseChunkReviewConfig(realPath);
		expect(result["chunk-review"].settings.mcps).toEqual({ allow: ["codegraph"] });
	});
});

// ---------------------------------------------------------------------------
// buildUiPayload
// ---------------------------------------------------------------------------

describe("buildUiPayload", () => {
	test("returns progress, codex, and claude keys", () => {
		const payload = {
			overallState: "done",
			counts: { total: 1, done: 1, queued: 0, running: 0, error: 0 },
			members: [{ member: "alice", state: "done", exitCode: 0 }],
		};
		const result = buildUiPayload(payload);
		expect(result.progress).toBeTruthy();
		expect(result.codex).toBeTruthy();
		expect(result.claude).toBeTruthy();
	});

	test("reports correct progress done/total", () => {
		const payload = {
			overallState: "running",
			counts: {
				total: 3,
				done: 1,
				error: 1,
				queued: 0,
				running: 1,
				missing_cli: 0,
				timed_out: 0,
				canceled: 0,
			},
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "error" },
				{ member: "carol", state: "running" },
			],
		};
		const result = buildUiPayload(payload);
		expect(result.progress.done).toBe(2);
		expect(result.progress.total).toBe(3);
	});

	test("marks dispatch as completed when no queued reviewers", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 1, queued: 0, running: 1 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload);
		expect(result.codex.update_plan.plan[0].status).toBe("completed");
	});

	test("marks dispatch as in_progress when queued reviewers exist", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 0, queued: 1, running: 1 },
			members: [
				{ member: "alice", state: "running" },
				{ member: "bob", state: "queued" },
			],
		};
		const result = buildUiPayload(payload);
		expect(result.codex.update_plan.plan[0].status).toBe("in_progress");
	});

	test("marks terminal-state reviewers as completed", () => {
		const payload = {
			overallState: "done",
			counts: { total: 3, done: 1, error: 1, missing_cli: 1, queued: 0, running: 0 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "error" },
				{ member: "carol", state: "missing_cli" },
			],
		};
		const result = buildUiPayload(payload);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		for (const step of reviewerSteps) {
			expect(step.status).toBe("completed");
		}
	});

	test("marks first running reviewer as in_progress when dispatch completed", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 0, queued: 0, running: 2 },
			members: [
				{ member: "alice", state: "running" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps[0].status).toBe("in_progress");
		expect(reviewerSteps[1].status).toBe("pending");
	});

	test("handles empty reviewers array", () => {
		const payload = {
			overallState: "done",
			counts: { total: 0, done: 0, queued: 0, running: 0 },
			members: [],
		};
		const result = buildUiPayload(payload);
		expect(result.progress.done).toBe(0);
		expect(result.progress.total).toBe(0);
		expect(result.codex.update_plan.plan.length).toBe(2);
	});

	test("all reviewers done sets synth to in_progress", () => {
		const payload = {
			overallState: "done",
			counts: {
				total: 2,
				done: 2,
				queued: 0,
				running: 0,
				error: 0,
				missing_cli: 0,
				timed_out: 0,
				canceled: 0,
			},
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "done" },
			],
		};
		const result = buildUiPayload(payload);
		const plan = result.codex.update_plan.plan;
		const synthStep = plan[plan.length - 1];
		expect(synthStep.status).toBe("in_progress");
	});

	test("all reviewers error sets synth to in_progress (all terminal, isDone)", () => {
		const payload = {
			overallState: "done",
			counts: { total: 2, done: 0, queued: 0, running: 0, error: 2 },
			members: [
				{ member: "alice", state: "error" },
				{ member: "bob", state: "error" },
			],
		};
		const result = buildUiPayload(payload);
		const plan = result.codex.update_plan.plan;
		const synthStep = plan[plan.length - 1];
		expect(synthStep.status).toBe("in_progress");
	});

	test("synth is pending when not all done", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 1, queued: 0, running: 1 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload);
		const plan = result.codex.update_plan.plan;
		const synthStep = plan[plan.length - 1];
		expect(synthStep.status).toBe("pending");
	});

	test("claude todos have content, status, and activeForm fields", () => {
		const payload = {
			overallState: "done",
			counts: { total: 1, done: 1, queued: 0, running: 0 },
			members: [{ member: "alice", state: "done" }],
		};
		const result = buildUiPayload(payload);
		for (const todo of result.claude.todo_write.todos) {
			expect("content" in todo).toBeTruthy();
			expect("status" in todo).toBeTruthy();
			expect("activeForm" in todo).toBeTruthy();
		}
	});

	test("reviewer labels contain [Chunk Review] prefix", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload);
		const reviewerStep = result.codex.update_plan.plan[1];
		expect(reviewerStep.step.startsWith("[Chunk Review]")).toBeTruthy();
	});

	test("sorts reviewers alphabetically", () => {
		const payload = {
			overallState: "running",
			counts: { total: 3, done: 0, queued: 0, running: 3 },
			members: [
				{ member: "carol", state: "running" },
				{ member: "alice", state: "running" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps[0].step.includes("alice")).toBeTruthy();
		expect(reviewerSteps[1].step.includes("bob")).toBeTruthy();
		expect(reviewerSteps[2].step.includes("carol")).toBeTruthy();
	});

	test("filters out reviewers with null/empty entity", () => {
		const payload = {
			overallState: "done",
			counts: { total: 2, done: 1, queued: 0, running: 0 },
			members: [
				{ member: "alice", state: "done" },
				{ member: null, state: "done" },
			],
		};
		const result = buildUiPayload(payload);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps.length).toBe(1);
	});

	test("handles missing counts gracefully", () => {
		const payload = {
			overallState: "done",
			members: [],
		};
		const result = buildUiPayload(payload);
		expect(result.progress.done).toBe(0);
		expect(result.progress.total).toBe(0);
	});

	test("handles missing reviewers gracefully", () => {
		const payload = {
			overallState: "done",
			counts: { total: 0 },
		};
		const result = buildUiPayload(payload);
		expect(result.codex.update_plan.plan.length).toBe(2);
	});

	test("hasInProgress propagation: dispatch in_progress prevents reviewer in_progress", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 0, queued: 1, running: 1 },
			members: [
				{ member: "alice", state: "running" },
				{ member: "bob", state: "queued" },
			],
		};
		const result = buildUiPayload(payload);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps[0].status).toBe("pending");
		expect(reviewerSteps[1].status).toBe("pending");
	});

	test("overallState is propagated in progress", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload);
		expect(result.progress.overallState).toBe("running");
	});
});

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------

describe("computeStatus", () => {
	let tmpDir: string;

	function setupJob(
		jobDir: string,
		jobJson: Record<string, unknown>,
		members: Record<string, unknown>,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(jobJson));
		const membersDir = path.join(jobDir, "members");
		fs.mkdirSync(membersDir, { recursive: true });
		for (const [name, status] of Object.entries(members)) {
			const dir = path.join(membersDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns done overallState when all reviewers are terminal", async () => {
		const jobDir = path.join(tmpDir, "job1");
		setupJob(
			jobDir,
			{ id: "test-1" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.overallState).toBe("done");
		expect(result.counts.total).toBe(2);
		expect(result.counts.done).toBe(2);
		expect(result.counts.running).toBe(0);
	});

	test("returns running overallState when some reviewers are running", async () => {
		const jobDir = path.join(tmpDir, "job2");
		setupJob(
			jobDir,
			{ id: "test-2" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
				bob: { member: "bob", state: "running" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.overallState).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.done).toBe(1);
	});

	test("returns queued overallState when only queued (no running)", async () => {
		const jobDir = path.join(tmpDir, "job3");
		setupJob(
			jobDir,
			{ id: "test-3" },
			{
				alice: { member: "alice", state: "queued" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.overallState).toBe("queued");
		expect(result.counts.queued).toBe(1);
	});

	test("counts error states correctly", async () => {
		const jobDir = path.join(tmpDir, "job4");
		setupJob(
			jobDir,
			{ id: "test-4" },
			{
				alice: { member: "alice", state: "error", exitCode: 1 },
				bob: { member: "bob", state: "done", exitCode: 0 },
				carol: { member: "carol", state: "missing_cli" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.overallState).toBe("done");
		expect(result.counts.error).toBe(1);
		expect(result.counts.missing_cli).toBe(1);
		expect(result.counts.done).toBe(1);
	});

	test("skips reviewer directories without status.json", async () => {
		const jobDir = path.join(tmpDir, "job7");
		setupJob(
			jobDir,
			{ id: "test-7" },
			{
				alice: { member: "alice", state: "done" },
			},
		);
		fs.mkdirSync(path.join(jobDir, "members", "bob"));
		const result = await computeStatus(jobDir);
		expect(result.counts.total).toBe(1);
		expect(result.members.length).toBe(1);
	});

	test("sorts reviewers alphabetically by name", async () => {
		const jobDir = path.join(tmpDir, "job8");
		setupJob(
			jobDir,
			{ id: "test-8" },
			{
				carol: { member: "carol", state: "done" },
				alice: { member: "alice", state: "done" },
				bob: { member: "bob", state: "done" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.members[0].member).toBe("alice");
		expect(result.members[1].member).toBe("bob");
		expect(result.members[2].member).toBe("carol");
	});

	test("includes reviewer metadata (startedAt, finishedAt, exitCode, message)", async () => {
		const jobDir = path.join(tmpDir, "job9");
		setupJob(
			jobDir,
			{ id: "test-9" },
			{
				alice: {
					member: "alice",
					state: "done",
					startedAt: "2026-01-01T00:00:00Z",
					finishedAt: "2026-01-01T00:01:00Z",
					exitCode: 0,
					message: "success",
				},
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.members[0].startedAt).toBe("2026-01-01T00:00:00Z");
		expect(result.members[0].finishedAt).toBe("2026-01-01T00:01:00Z");
		expect(result.members[0].exitCode).toBe(0);
		expect(result.members[0].message).toBe("success");
	});

	test("returns null for missing reviewer metadata fields", async () => {
		const jobDir = path.join(tmpDir, "job10");
		setupJob(
			jobDir,
			{ id: "test-10" },
			{
				alice: { member: "alice", state: "running" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.members[0].startedAt).toBe(null);
		expect(result.members[0].finishedAt).toBe(null);
		expect(result.members[0].exitCode).toBe(null);
		expect(result.members[0].message).toBe(null);
	});

	test("includes jobDir and id in result", async () => {
		const jobDir = path.join(tmpDir, "job11");
		setupJob(
			jobDir,
			{ id: "test-11" },
			{
				alice: { member: "alice", state: "done" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.id).toBe("test-11");
		expect(result.jobDir.endsWith("job11")).toBeTruthy();
	});

	test("includes chairmanRole from job.json", async () => {
		const jobDir = path.join(tmpDir, "job12");
		setupJob(
			jobDir,
			{ id: "test-12", chairmanRole: "claude" },
			{
				alice: { member: "alice", state: "done" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.chairmanRole).toBe("claude");
	});

	test("treats retrying reviewer as non-terminal (running)", async () => {
		const jobDir = path.join(tmpDir, "job13");
		setupJob(
			jobDir,
			{ id: "test-13" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
				bob: { member: "bob", state: "retrying" },
			},
		);
		const result = await computeStatus(jobDir);
		expect(result.overallState).toBe("running");
		expect(result.counts.retrying).toBe(1);
		expect(result.counts.done).toBe(1);
	});

	test("transitions stale queued reviewer to error when queuedAt exceeds threshold", async () => {
		const jobDir = path.join(tmpDir, "job-stale");
		const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-stale", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
		);
		// threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.queued).toBe(0);
	});

	test("does not transition queued reviewer that is within staleness threshold", async () => {
		const jobDir = path.join(tmpDir, "job-fresh");
		const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
		setupJob(
			jobDir,
			{ id: "test-fresh", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: freshTime },
			},
		);
		// threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("queued");
		expect(result.counts.queued).toBe(1);
	});

	test("uses 120s minimum threshold when timeoutSec is 0", async () => {
		const jobDir = path.join(tmpDir, "job-zero-timeout");
		const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-zero", settings: { timeoutSec: 0 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
			},
		);
		// threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
	});

	test("uses file mtime as fallback when queuedAt is missing", async () => {
		const jobDir = path.join(tmpDir, "job-no-queued-at");
		setupJob(
			jobDir,
			{ id: "test-mtime", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued" },
			},
		);
		// Force the file mtime to be old
		const statusPath = path.join(jobDir, "members", "alice", "status.json");
		const oldTime = new Date(Date.now() - 200_000);
		fs.utimesSync(statusPath, oldTime, oldTime);
		// threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
	});

	test("writes error details to status.json on staleness transition", async () => {
		const jobDir = path.join(tmpDir, "job-stale-write");
		const staleTime = new Date(Date.now() - 200_000).toISOString();
		setupJob(
			jobDir,
			{ id: "test-write", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
			},
		);
		await computeStatus(jobDir);
		const statusPath = path.join(jobDir, "members", "alice", "status.json");
		const written = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		expect(written.state).toBe("error");
		expect(written.error.includes("stale")).toBe(true);
	});

	// ---- Running worker staleness ----

	test("preserves normal running worker within threshold", async () => {
		const jobDir = path.join(tmpDir, "job-run-fresh");
		const recentStart = new Date(Date.now() - 10_000).toISOString(); // 10s ago
		setupJob(
			jobDir,
			{ id: "test-run-fresh", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: recentStart },
			},
		);
		// running threshold = (60 + 60) * 1000 = 120_000ms; 10s < 120s → not stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.error).toBe(0);
	});

	test("transitions stale running worker to error when startedAt exceeds threshold", async () => {
		const jobDir = path.join(tmpDir, "job-run-stale");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-stale", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
		);
		// running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.running).toBe(0);
	});

	test("CAS guard: does not transition if running worker changed state during re-read", async () => {
		const jobDir = path.join(tmpDir, "job-run-cas");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-cas", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
			},
		);
		// running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
		// Simulate race: spawn a background process that overwrites the file to 'done'
		// during the 250ms CAS sleep window (Atomics.wait blocks the event loop,
		// so setTimeout won't fire — only an external process can write the file).
		const statusPath = path.join(jobDir, "members", "alice", "status.json");
		const donePayload = JSON.stringify({
			member: "alice",
			state: "done",
			startedAt: staleStart,
			exitCode: 0,
		});
		Bun.spawn(["bash", "-c", `sleep 0.1 && printf '%s' '${donePayload}' > "${statusPath}"`]);
		const result = await computeStatus(jobDir);
		const alice = result.members.find((r) => r.member === "alice");
		// CAS re-read sees 'done' → preserves 'done', does NOT overwrite with error
		expect(alice.state).toBe("done");
		expect(result.counts.error).toBe(0);
	});

	test("writes error details to status.json on running staleness transition", async () => {
		const jobDir = path.join(tmpDir, "job-run-stale-write");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-stale-write", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
			},
		);
		// running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
		await computeStatus(jobDir);
		const statusPath = path.join(jobDir, "members", "alice", "status.json");
		const written = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		expect(written.state).toBe("error");
		expect(written.error).toContain("running for");
		expect(written.error).toContain("seconds");
	});
});

// ---------------------------------------------------------------------------
// detectCliType
// ---------------------------------------------------------------------------

describe("detectCliType", () => {
	test('returns "claude" for "claude -p"', () => {
		expect(detectCliType("claude -p")).toBe("claude");
	});

	test('returns "codex" for "codex exec"', () => {
		expect(detectCliType("codex exec")).toBe("codex");
	});

	test('returns "gemini" for bare "gemini"', () => {
		expect(detectCliType("gemini")).toBe("gemini");
	});

	test('returns "unknown" for unrecognized command', () => {
		expect(detectCliType("my-script")).toBe("unknown");
	});

	test('returns "unknown" for null', () => {
		expect(detectCliType(null)).toBe("unknown");
	});

	test('returns "unknown" for empty string', () => {
		expect(detectCliType("")).toBe("unknown");
	});

	test('returns "unknown" for undefined', () => {
		expect(detectCliType(undefined)).toBe("unknown");
	});

	test('returns "claude" when command has leading whitespace', () => {
		expect(detectCliType("  claude --model opus")).toBe("claude");
	});
});

// ---------------------------------------------------------------------------
// buildAugmentedCommand
// ---------------------------------------------------------------------------

describe("buildAugmentedCommand", () => {
	test("claude: appends --model and --output-format, sets env for effort_level", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: "opus", effort_level: "high", output_format: "json" },
			"claude",
		);
		expect(result.command).toBe("claude -p --model opus --output-format json");
		expect(result.env).toEqual({ CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "high" });
	});

	test("codex: appends -m, -c for effort, --json for output_format", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", model: "o3", effort_level: "high", output_format: "json" },
			"codex",
		);
		expect(result.command).toBe("codex exec -m o3 -c model_reasoning_effort=high --json");
		expect(result.env).toEqual({});
	});

	test("gemini: appends --model, ignores effort_level", () => {
		const result = buildAugmentedCommand(
			{ command: "gemini", model: "gemini-2.5-pro", effort_level: "high" },
			"gemini",
		);
		expect(result.command).toBe("gemini --model gemini-2.5-pro");
		expect(result.env).toEqual({});
	});

	test("gemini: appends --output-format for json", () => {
		const result = buildAugmentedCommand({ command: "gemini", output_format: "json" }, "gemini");
		expect(result.command).toBe("gemini --output-format json");
		expect(result.env).toEqual({});
	});

	// CLAUDECODE: '' is intentional — it prevents Claude CLI nested session errors.
	// buildAugmentedCommand always injects this env override for 'claude' CLI type
	// (see job.js buildAugmentedCommand), so it is not an "extra" field but a
	// required guard that must appear in every claude-type env expectation.
	test("no fields present: returns command unchanged with empty env", () => {
		const result = buildAugmentedCommand({ command: "claude -p" }, "claude");
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("falsy values (empty string, null): treated as absent", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: "", effort_level: null },
			"claude",
		);
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("falsy values (undefined): treated as absent", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: undefined, effort_level: undefined, output_format: undefined },
			"claude",
		);
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("unknown CLI type: only appends --model, ignores effort and output_format", () => {
		const result = buildAugmentedCommand(
			{ command: "my-script", model: "gpt-4", effort_level: "high", output_format: "json" },
			"unknown",
		);
		expect(result.command).toBe("my-script --model gpt-4");
		expect(result.env).toEqual({});
	});

	test('output_format "text" is ignored (no flag appended)', () => {
		const result = buildAugmentedCommand({ command: "claude -p", output_format: "text" }, "claude");
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("codex output_format non-json still appends --json", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", output_format: "stream" },
			"codex",
		);
		expect(result.command).toBe("codex exec --json");
		expect(result.env).toEqual({});
	});

	test("claude: unsets CLAUDECODE env to prevent nested session error", () => {
		const result = buildAugmentedCommand({ command: "claude -p" }, "claude");
		expect(result.env.CLAUDECODE).toBe("");
	});

	test("non-claude: does not include CLAUDECODE in env", () => {
		const result = buildAugmentedCommand({ command: "gemini" }, "gemini");
		expect(result.env.CLAUDECODE).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// gcStaleJobs
// ---------------------------------------------------------------------------

describe("gcStaleJobs", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("deletes chunk-review-* directories older than 1 hour", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const staleDir = path.join(jobsDir, "chunk-review-stale-001");
		fs.mkdirSync(staleDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(staleDir, "job.json"),
			JSON.stringify({ id: "chunk-review-stale-001", createdAt: twoHoursAgo }),
		);

		gcStaleJobs(jobsDir);

		expect(fs.existsSync(staleDir)).toBe(false);
	});

	test("preserves chunk-review-* directories younger than 1 hour", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const freshDir = path.join(jobsDir, "chunk-review-fresh-001");
		fs.mkdirSync(freshDir, { recursive: true });
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
		fs.writeFileSync(
			path.join(freshDir, "job.json"),
			JSON.stringify({ id: "chunk-review-fresh-001", createdAt: fiveMinutesAgo }),
		);

		gcStaleJobs(jobsDir);

		expect(fs.existsSync(freshDir)).toBe(true);
	});

	test("skips directories with missing job.json", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const noJsonDir = path.join(jobsDir, "chunk-review-nojson-001");
		fs.mkdirSync(noJsonDir, { recursive: true });
		// No job.json written

		gcStaleJobs(jobsDir);

		expect(fs.existsSync(noJsonDir)).toBe(true);
	});

	test("skips directories with malformed job.json", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const badJsonDir = path.join(jobsDir, "chunk-review-badjson-001");
		fs.mkdirSync(badJsonDir, { recursive: true });
		fs.writeFileSync(path.join(badJsonDir, "job.json"), "{{not valid json}}");

		gcStaleJobs(jobsDir);

		expect(fs.existsSync(badJsonDir)).toBe(true);
	});

	test("skips non-chunk-review directories", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const otherDir = path.join(jobsDir, "spec-review-other-001");
		fs.mkdirSync(otherDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(otherDir, "job.json"),
			JSON.stringify({ id: "spec-review-other-001", createdAt: twoHoursAgo }),
		);

		gcStaleJobs(jobsDir);

		expect(fs.existsSync(otherDir)).toBe(true);
	});

	test("path traversal guard prevents deletion outside jobsDir", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		// Create a target directory outside jobsDir
		const outsideDir = path.join(tmpDir, "outside-target");
		fs.mkdirSync(outsideDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(outsideDir, "job.json"),
			JSON.stringify({ id: "chunk-review-symlink", createdAt: twoHoursAgo }),
		);

		// Create a symlink inside jobsDir that points outside
		const symlinkPath = path.join(jobsDir, "chunk-review-symlink");
		fs.symlinkSync(outsideDir, symlinkPath);

		gcStaleJobs(jobsDir);

		// The outside directory must still exist
		expect(fs.existsSync(outsideDir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// job.ts reap — kills orphan process groups, stdout MUST stay empty (cache-safe
// SessionStart contract; see the reap docstring in job.ts).
//
// Placed before any mock.module(...) usage in this file: bun test runs every
// test file in one process, and mock.module leaks across file boundaries —
// tests that need the real @lib/generic-job engine must run before the first
// mock.module call anywhere in this file (see job.ts's MUST DO notes).
// ---------------------------------------------------------------------------

describe("job.ts reap", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;
	let jobsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("stdout는 완전히 비어 있고, 회수할 고아가 있을 때 진단은 stderr로만 나간다", () => {
		const { jobDir, pgid } = makeOrphanJobFixture(jobsDir, "cache-safe");

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "reap", "--jobs-dir", jobsDir, "--grace-ms", "0"],
			{ stdio: "pipe" },
		);

		// The real substance of this test: stdout carries zero bytes even though
		// there WAS something to reap — an empty stdout with nothing to do would
		// prove nothing about the cache-safety requirement.
		expect(result.toString()).toBe("");

		// stderr — not stdout — carries the diagnostic.
		expect(fs.existsSync(jobDir)).toBe(true); // reap never deletes the directory

		killPgidIfAlive(pgid);
	});

	test("stderr에 회수 진단이 기록되고, 회수된 고아 프로세스 그룹은 더 이상 살아있지 않다", () => {
		const { jobDir, pgid } = makeOrphanJobFixture(jobsDir, "reaped-effect");

		const proc = spawnSync(
			process.execPath,
			[SCRIPT, "reap", "--jobs-dir", jobsDir, "--grace-ms", "0"],
			{ encoding: "utf8" },
		);

		expect(proc.status).toBe(0);
		expect(proc.stdout).toBe("");
		expect(proc.stderr.length).toBeGreaterThan(0);
		expect(proc.stderr).toContain(jobDir);
		expect(isPgidAlive(pgid)).toBe(false);
	});

	test("--grace-ms 옵션이 reapOrphanJobs로 전달된다 (유예 시간 실측)", () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "grace-passthrough");

		const start = Date.now();
		execFileSync(process.execPath, [SCRIPT, "reap", "--jobs-dir", jobsDir, "--grace-ms", "300"], {
			stdio: "pipe",
		});
		const elapsed = Date.now() - start;

		// Default grace is REAP_GRACE_MS_DEFAULT (5000ms) — an elapsed time well
		// under that but still >= most of the requested 300ms proves --grace-ms
		// reached reapOrphanJobs rather than being ignored (which would either
		// return near-instantly or take the full 5s default).
		expect(elapsed).toBeGreaterThanOrEqual(250);
		expect(elapsed).toBeLessThan(4000);

		killPgidIfAlive(pgid);
	});

	test("회수할 고아가 없으면 stdout은 비고 정상 종료한다", () => {
		// --grace-ms 0으로 명시했으니 유예가 없다는 것은 자명하다 — 여기서 확인하는
		// 것은 그 값과 무관하게 정상 종료(빈 stdout)한다는 점.
		const result = execFileSync(
			process.execPath,
			[SCRIPT, "reap", "--jobs-dir", jobsDir, "--grace-ms", "0"],
			{ stdio: "pipe" },
		);
		expect(result.toString()).toBe("");
	});

	test("이 job과 무관한 프로세스는 reap 회수 전후 모두 살아있다 (오살 방지 방관자)", () => {
		// 방관자 — 어떤 job.json에도 workerPgid로 기록되지 않은 무관한 프로세스.
		// reap이 잘못된 그룹에 신호를 보내면 이 프로세스가 사라진다.
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		bystander.unref();
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");

		try {
			expect(isPgidAlive(bystanderPgid)).toBe(true);

			const { pgid } = makeOrphanJobFixture(jobsDir, "bystander-reap");
			execFileSync(process.execPath, [SCRIPT, "reap", "--jobs-dir", jobsDir, "--grace-ms", "0"], {
				stdio: "pipe",
			});

			expect(isPgidAlive(pgid)).toBe(false);
			// 핵심 단언 — 오살 방지: 무관한 프로세스는 여전히 살아있어야 한다.
			expect(isPgidAlive(bystanderPgid)).toBe(true);
		} finally {
			killPgidIfAlive(bystanderPgid);
		}
	});
});

// ---------------------------------------------------------------------------
// job.ts cmdReap — 로그는 그룹킬 후 생존한 프로세스를 "reaped"라고 주장하면
// 안 된다 (결함 B). reapOrphanJobs 자신도 별도로 "survived group kill" 줄을
// stderr에 남기므로, cmdReap이 매 orphan마다 무조건 "reaped"를 쓰면 같은
// stderr 스트림에 서로 모순되는 두 줄이 남는다.
// ---------------------------------------------------------------------------

describe("job.ts cmdReap — 생존 프로세스를 회수됐다고 보고하지 않는다", () => {
	let tmpDir: string;
	let jobsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("group kill 후에도 프로세스가 살아남으면 stderr에 'reaped' 성공 주장이 없다", async () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "survivor");

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다.
		expect(isPgidAlive(pgid)).toBe(true);

		const stderrChunks: string[] = [];
		const originalStderrWrite = process.stderr.write;
		(process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		};

		const originalKill = process.kill;
		// kill을 no-op으로 바꿔 실제로는 신호를 보내지 않는다 — 그러면 프로세스는
		// 반드시 살아남으므로 "생존" 분기가 타이밍에 의존하지 않고 결정적으로
		// 재현된다 (lib/generic-job.test.ts의 동일 기법).
		(process as unknown as { kill: unknown }).kill = () => true;

		try {
			await cmdReap({ "jobs-dir": jobsDir, "grace-ms": 0 });
		} finally {
			process.kill = originalKill;
			process.stderr.write = originalStderrWrite;
		}

		const combined = stderrChunks.join("");
		expect(combined).not.toContain("reaped orphan job");
		// 오살 방지: kill이 no-op이었으므로 프로세스는 실제로 살아있어야 한다.
		expect(isPgidAlive(pgid)).toBe(true);

		killPgidIfAlive(pgid);
	});
});

// ---------------------------------------------------------------------------
// job.ts doctor — reports orphan counts on stdout, never kills.
// ---------------------------------------------------------------------------

describe("job.ts doctor", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;
	let jobsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("kill 없이 고아 카운트를 stdout에 보고하고, 그룹은 doctor 실행 후에도 살아있다", () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "doctor-no-kill");

		const result = execFileSync(process.execPath, [SCRIPT, "doctor", "--jobs-dir", jobsDir, "--json"], {
			stdio: "pipe",
		});
		const output = JSON.parse(result.toString());
		expect(output.orphanJobCount).toBe(1);
		expect(output.orphanPgidCount).toBe(1);

		// kill 없음의 증거: doctor 호출 이후에도 프로세스 그룹이 여전히 살아있다.
		expect(isPgidAlive(pgid)).toBe(true);

		killPgidIfAlive(pgid);
	});

	test("고아가 없으면 카운트 0을 보고한다", () => {
		const result = execFileSync(process.execPath, [SCRIPT, "doctor", "--jobs-dir", jobsDir, "--json"], {
			stdio: "pipe",
		});
		const output = JSON.parse(result.toString());
		expect(output.orphanJobCount).toBe(0);
		expect(output.orphanPgidCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// cmdStart also reaps orphans at job-start time (in-process, real engine —
// cmdStart is directly exported and imported at the top of this file).
// ---------------------------------------------------------------------------

describe("cmdStart reaps orphan jobs on start", () => {
	let tmpDir: string;
	let jobsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("job 시작 시 기존 고아 job의 프로세스 그룹을 회수한다", async () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "start-reap");

		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		expect(isPgidAlive(pgid)).toBe(false);

		// cleanup: kill this test's own newly-spawned worker(s), best-effort.
		for (const entry of fs.readdirSync(jobsDir)) {
			const jobJsonPath = path.join(jobsDir, entry, "job.json");
			if (!fs.existsSync(jobJsonPath)) continue;
			const meta = JSON.parse(fs.readFileSync(jobJsonPath, "utf8"));
			for (const member of meta.members ?? []) {
				if (typeof member.workerPgid === "number") killPgidIfAlive(member.workerPgid);
			}
		}
	});

	test("createdAt이 GC 임계(1시간)보다 오래된 고아 job도 회수한다 (GC가 앵커를 지우기 전에 회수해야 한다)", async () => {
		// gcStaleJobs(GC_MAX_AGE_MS=1시간)가 reapOrphanJobs보다 먼저 돌면 이 job의
		// job.json(모든 회수 계층의 유일한 소유권 앵커)이 생존 여부 확인 없이
		// 지워진다 — 그러면 reapOrphanJobs가 뒤이어 돌아도 지울 앵커가 이미 없어
		// 이 프로세스 그룹은 회수되지 않는다. 순서를 바꾸지 않으면 RED.
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		const { pgid } = makeOrphanJobFixture(jobsDir, "gc-race", { createdAt: twoHoursAgo });

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다.
		expect(isPgidAlive(pgid)).toBe(true);

		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		expect(isPgidAlive(pgid)).toBe(false);

		// cleanup: kill this test's own newly-spawned worker(s), best-effort.
		for (const entry of fs.readdirSync(jobsDir)) {
			const jobJsonPath = path.join(jobsDir, entry, "job.json");
			if (!fs.existsSync(jobJsonPath)) continue;
			const meta = JSON.parse(fs.readFileSync(jobJsonPath, "utf8"));
			for (const member of meta.members ?? []) {
				if (typeof member.workerPgid === "number") killPgidIfAlive(member.workerPgid);
			}
		}
	});

	test("이 job과 무관한 프로세스는 cmdStart의 회수 전후 모두 살아있다 (오살 방지 방관자)", async () => {
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		bystander.unref();
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");

		try {
			expect(isPgidAlive(bystanderPgid)).toBe(true);

			const { pgid } = makeOrphanJobFixture(jobsDir, "bystander-start");

			const configPath = path.join(tmpDir, "config.yaml");
			fs.writeFileSync(
				configPath,
				[
					"chunk-review:",
					"  chairman:",
					"    role: none",
					"  members:",
					"    - name: bob",
					"      command: echo bob",
					"  settings:",
					"    exclude_chairman_from_members: false",
					"    timeout: 10",
				].join("\n"),
			);

			await cmdStart(
				{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
				"test prompt",
			);

			expect(isPgidAlive(pgid)).toBe(false);
			// 핵심 단언 — 오살 방지: 무관한 프로세스는 여전히 살아있어야 한다.
			expect(isPgidAlive(bystanderPgid)).toBe(true);

			for (const entry of fs.readdirSync(jobsDir)) {
				const jobJsonPath = path.join(jobsDir, entry, "job.json");
				if (!fs.existsSync(jobJsonPath)) continue;
				const meta = JSON.parse(fs.readFileSync(jobJsonPath, "utf8"));
				for (const member of meta.members ?? []) {
					if (typeof member.workerPgid === "number") killPgidIfAlive(member.workerPgid);
				}
			}
		} finally {
			killPgidIfAlive(bystanderPgid);
		}
	});
});

// ---------------------------------------------------------------------------
// classifyReapedOrphans — shared judgment core cmdReap and cmdStart's reap
// log both call into: per-orphan verdict of whether the group actually died
// after being signalled, using the same isPgidGroupAlive probe cmdReap used
// before this extraction. Tested directly (not through either caller) so the
// judgment is verified independent of either caller's own phrasing/channel.
// ---------------------------------------------------------------------------

describe("classifyReapedOrphans", () => {
	test("프로세스 그룹이 살아있으면 survived: true를 반환한다", () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		child.unref();
		const pgid = child.pid as number;
		try {
			expect(isPgidAlive(pgid)).toBe(true);

			const verdicts = classifyReapedOrphans([{ jobDir: "/tmp/whatever", pgids: [pgid] }]);

			expect(verdicts).toEqual([{ jobDir: "/tmp/whatever", pgids: [pgid], survived: true }]);
		} finally {
			killPgidIfAlive(pgid);
		}
	});

	test("프로세스 그룹이 죽었으면 survived: false를 반환한다", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		child.unref();
		const pgid = child.pid as number;
		process.kill(-pgid, "SIGKILL");
		// SIGKILL is asynchronous — poll until the group is actually gone before
		// asserting, or this test would flake on a slow host.
		for (let i = 0; i < 50 && isPgidAlive(pgid); i++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(isPgidAlive(pgid)).toBe(false);

		const verdicts = classifyReapedOrphans([{ jobDir: "/tmp/whatever", pgids: [pgid] }]);

		expect(verdicts).toEqual([{ jobDir: "/tmp/whatever", pgids: [pgid], survived: false }]);
	});

	test("reaped가 빈 배열이면 빈 배열을 반환한다", () => {
		expect(classifyReapedOrphans([])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// cmdStart의 reap 로그 — 독립 code review 2차가 CONFIRMED로 확정한 결함: cmdReap
// 은 group kill 후 생존 프로세스를 확인해 "reaped"라고 무조건 주장하지 않도록
// 고쳐졌지만, 같은 reapOrphanJobs를 호출하는 형제 cmdStart는 안 고쳐진 채
// survivingPids를 버리고 항상 "N orphan job(s) reaped"라고 logInfo했다.
// ---------------------------------------------------------------------------

describe("cmdStart reap 로그 — 생존 프로세스를 회수됐다고 보고하지 않는다", () => {
	let tmpDir: string;
	let jobsDir: string;
	let originalOmtDir: string | undefined;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		originalOmtDir = process.env.OMT_DIR;
		process.env.OMT_DIR = tmpDir;
	});

	afterEach(() => {
		if (originalOmtDir === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = originalOmtDir;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeStartConfig(): string {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		return configPath;
	}

	function readStartLog(): string {
		const logsDir = path.join(tmpDir, "logs");
		const files = fs.readdirSync(logsDir).filter((f) => f.startsWith("chunk-review-job-"));
		expect(files.length).toBe(1);
		return fs.readFileSync(path.join(logsDir, files[0]), "utf8");
	}

	function killSpawnedWorkers(): void {
		for (const entry of fs.readdirSync(jobsDir)) {
			const jobJsonPath = path.join(jobsDir, entry, "job.json");
			if (!fs.existsSync(jobJsonPath)) continue;
			const meta = JSON.parse(fs.readFileSync(jobJsonPath, "utf8"));
			for (const member of meta.members ?? []) {
				if (typeof member.workerPgid === "number") killPgidIfAlive(member.workerPgid);
			}
		}
	}

	test("group kill 후에도 프로세스가 살아남으면 로그에 'orphan job(s) reaped' 무조건 성공 주장이 없다", async () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "start-survivor");
		expect(isPgidAlive(pgid)).toBe(true);
		const configPath = writeStartConfig();

		const originalKill = process.kill;
		// kill을 no-op으로 바꿔 실제로는 신호를 보내지 않는다 — 그러면 프로세스는
		// 반드시 살아남으므로 "생존" 분기가 타이밍에 의존하지 않고 결정적으로
		// 재현된다 (job.ts cmdReap 테스트와 동일 기법).
		(process as unknown as { kill: unknown }).kill = () => true;

		try {
			await cmdStart(
				{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
				"test prompt",
			);
		} finally {
			process.kill = originalKill;
		}

		const logContent = readStartLog();
		expect(logContent).not.toContain("orphan job(s) reaped");
		// 오살 방지: kill이 no-op이었으므로 프로세스는 실제로 살아있어야 한다.
		expect(isPgidAlive(pgid)).toBe(true);

		killPgidIfAlive(pgid);
		killSpawnedWorkers();
	});

	test("실제로 전부 회수된 경우엔 여전히 회수 성공을 로그에 남긴다 (음성 대조군)", async () => {
		const { pgid } = makeOrphanJobFixture(jobsDir, "start-reaped-ok");
		expect(isPgidAlive(pgid)).toBe(true);
		const configPath = writeStartConfig();

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		const logContent = readStartLog();
		expect(logContent).toContain("1 orphan job(s) reaped");
		expect(isPgidAlive(pgid)).toBe(false);

		killSpawnedWorkers();
	});

	test("한 job에 살아있는 pgid가 2개 이상이면 로그의 process(es) 수는 job 수가 아니라 실제 생존 프로세스 수를 반영한다", async () => {
		// 결함 재현: job은 1개뿐인데 그 job의 살아있는 멤버는 2개다.
		// classifyReapedOrphans는 job 단위로 survived: boolean 하나만 반환하므로,
		// 그 개수(1)를 그대로 "process(es) survived"로 찍으면 실제 생존 프로세스
		// 수(2)와 어긋난다.
		const { pgids } = makeMultiMemberOrphanJobFixture(jobsDir, "start-multi-survivor", [
			"alice",
			"bob",
		]);
		expect(pgids.every((pgid) => isPgidAlive(pgid))).toBe(true);
		const configPath = writeStartConfig();

		const originalKill = process.kill;
		// kill을 no-op으로 바꿔 두 프로세스 모두 결정적으로 생존시킨다.
		(process as unknown as { kill: unknown }).kill = () => true;

		try {
			await cmdStart(
				{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
				"test prompt",
			);
		} finally {
			process.kill = originalKill;
		}

		const logContent = readStartLog();
		expect(logContent).toContain("1 orphan job(s) signalled");
		// 핵심 단언: 실제 생존 프로세스 수(2)가 찍혀야 하고, job 수(1)를 그대로
		// process 수로 잘못 라벨링한 "1 process(es) survived"가 찍히면 안 된다.
		expect(logContent).toContain("2 process(es) survived the group kill");
		expect(logContent).not.toContain("1 process(es) survived the group kill");
		// 오살 방지: kill이 no-op이었으므로 두 프로세스 모두 실제로 살아있어야 한다.
		expect(pgids.every((pgid) => isPgidAlive(pgid))).toBe(true);

		for (const pgid of pgids) killPgidIfAlive(pgid);
		killSpawnedWorkers();
	});
});

// ---------------------------------------------------------------------------
// cmdClean — path traversal guard (Fix A)
// ---------------------------------------------------------------------------

describe("cmdClean path traversal guard", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("rejects a path outside the configured jobs directory", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const outsidePath = path.join(tmpDir, "not-jobs", suiteJobDirBasename("evil"));
		fs.mkdirSync(outsidePath, { recursive: true });

		try {
			execFileSync(process.execPath, [SCRIPT, "clean", "--jobs-dir", jobsDir, outsidePath], {
				stdio: "pipe",
			});
			throw new Error("Expected execFileSync to throw");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect(
				(err as any).stderr.toString().includes("refusing to delete path outside jobs directory"),
			).toBe(true);
		}

		// The outside directory must still exist (not deleted)
		expect(fs.existsSync(outsidePath)).toBe(true);
	});

	test("accepts and cleans a path inside the configured jobs directory", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		const jobDir = path.join(jobsDir, suiteJobDirBasename("chunk-review-test"));
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "dummy.txt"), "test");

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "clean", "--jobs-dir", jobsDir, jobDir],
			{ stdio: "pipe" },
		);

		expect(result.toString().includes("cleaned:")).toBe(true);
		expect(!fs.existsSync(jobDir)).toBe(true);
	});

	test("cleans a custom jobs-dir job without --jobs-dir flag when job.json exists", () => {
		// Simulate a job created with --jobs-dir /custom: the job directory is NOT
		// under the default jobs directory, but it contains job.json proving it's real.
		const customJobsDir = path.join(tmpDir, "custom-jobs");
		const jobDir = path.join(customJobsDir, suiteJobDirBasename("chunk-review-test"));
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "test-custom" }));
		fs.writeFileSync(path.join(jobDir, "dummy.txt"), "test");

		// Clean WITHOUT --jobs-dir (direct jobDir argument)
		const result = execFileSync(process.execPath, [SCRIPT, "clean", jobDir], { stdio: "pipe" });

		expect(result.toString().includes("cleaned:")).toBe(true);
		expect(!fs.existsSync(jobDir)).toBe(true);
	});

	test("`--force` 는 활성 멤버 가드를 건너뛰고, jobDir 인자를 삼키지 않는다", () => {
		// --force must be registered as a boolean flag. If it is not, parseArgs binds the
		// following jobDir as --force's VALUE, the positional list comes back empty, and the
		// documented escape hatch dies while every other clean test still passes.
		// The argv shape below is the one SKILL.md documents — `clean --force "$JOB_DIR"`, with
		// the positional directly after the flag. An order that puts another `--`-prefixed
		// argument next would mask the defect, since parseArgs already treats a `--`-prefixed
		// successor as "no value".
		const jobsDir = path.join(tmpDir, "jobs");
		const jobDir = path.join(jobsDir, suiteJobDirBasename("chunk-review-test"));
		fs.mkdirSync(path.join(jobDir, "members", "correctness"), { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "test-force" }));
		fs.writeFileSync(
			path.join(jobDir, "members", "correctness", "status.json"),
			JSON.stringify({ state: "awaiting_resume" }),
		);

		// Plain clean must refuse: awaiting_resume is an active member state.
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", jobDir], { stdio: "pipe" });
			throw new Error("Expected plain clean to refuse an active member");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect((err as any).stderr.toString().includes("active")).toBe(true);
		}
		expect(fs.existsSync(jobDir)).toBe(true);

		const result = execFileSync(process.execPath, [SCRIPT, "clean", "--force", jobDir], {
			stdio: "pipe",
		});
		expect(result.toString().includes("cleaned:")).toBe(true);
		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("rejects a path outside jobs directory without job.json", () => {
		// An arbitrary directory without job.json should still be rejected
		const outsidePath = path.join(tmpDir, "jobs", suiteJobDirBasename("not-a-job"));
		fs.mkdirSync(outsidePath, { recursive: true });
		fs.writeFileSync(path.join(outsidePath, "important.txt"), "do not delete");

		try {
			execFileSync(process.execPath, [SCRIPT, "clean", outsidePath], { stdio: "pipe" });
			throw new Error("Expected execFileSync to throw");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect(
				(err as any).stderr.toString().includes("refusing to delete path outside jobs directory"),
			).toBe(true);
		}

		// The directory must still exist
		expect(fs.existsSync(outsidePath)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// spawnWorkers — safe name collision detection (Fix B)
// ---------------------------------------------------------------------------

describe("spawnWorkers safe name collision detection", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("exits with error when two reviewers produce the same safe name", () => {
		// Create a config where two reviewers collide case-insensitively:
		// "Alice" and "alice" are the same name when lowercased
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				'    - name: "Alice"',
				"      command: echo test1",
				'    - name: "alice"',
				"      command: echo test2",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		try {
			execFileSync(
				process.execPath,
				[
					SCRIPT,
					"start",
					"--config",
					configPath,
					"--jobs-dir",
					jobsDir,
					"--chairman",
					"none",
					"test prompt",
				],
				{ stdio: "pipe" },
			);
			throw new Error("Expected execFileSync to throw");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect((err as any).stderr.toString().includes("member name collision")).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// start: empty/all-filtered config → non-zero exit, no job.json (assertMembersOrExit)
// ---------------------------------------------------------------------------

describe("start: empty members config exits non-zero", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("exits non-zero with no-members message when config has empty members list", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members: []",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let threw = false;
		let err: any;
		try {
			execFileSync(
				process.execPath,
				[
					SCRIPT,
					"start",
					"--config",
					configPath,
					"--jobs-dir",
					jobsDir,
					"--chairman",
					"none",
					"test prompt",
				],
				{ stdio: "pipe" },
			);
		} catch (e) {
			threw = true;
			err = e;
		}

		expect(threw).toBe(true);
		expect(err.status).toBe(1);
		expect(err.stderr.toString()).toContain("to dispatch");

		// No job.json should have been written
		const jobDirs = fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : [];
		const jobJsonFound = jobDirs.some((d) => fs.existsSync(path.join(jobsDir, d, "job.json")));
		expect(jobJsonFound).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// --exclude-chairman=false boolean parsing (Bug fix)
// ---------------------------------------------------------------------------

describe("--exclude-chairman=false keeps chairman in reviewers", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("--exclude-chairman=false does NOT exclude the chairman reviewer", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--exclude-chairman=false",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		expect(memberNames.includes("claude")).toBe(true);
		expect(output.settings.excludeChairmanFromMembers).toBe(false);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("--exclude-chairman (no value) DOES exclude the chairman reviewer", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--exclude-chairman",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		expect(!memberNames.includes("claude")).toBe(true);
		expect(output.settings.excludeChairmanFromMembers).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("--exclude-chairman=false with --include-chairman=false falls back to config default", () => {
		// Both flags explicitly set to false — config says exclude, so chairman should be excluded
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--exclude-chairman=false",
				"--include-chairman=false",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		// --exclude-chairman=false overrides config to false (don't exclude)
		// --include-chairman=false means no force-include
		// So excludeChairmanFromMembers=false, includeChairman=false → chairman included
		expect(memberNames.includes("claude")).toBe(true);
		expect(output.settings.excludeChairmanFromMembers).toBe(false);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("--exclude-chairman=true DOES exclude the chairman reviewer", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--exclude-chairman=true",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		expect(!memberNames.includes("claude")).toBe(true);
		expect(output.settings.excludeChairmanFromMembers).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});
});

// ---------------------------------------------------------------------------
// --include-chairman=false boolean parsing (Bug fix: Boolean("false")===true)
// ---------------------------------------------------------------------------

describe("--include-chairman=false normalizeBool parsing", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("--include-chairman=false does NOT force-include chairman (config exclude=true respected)", () => {
		// Config says exclude chairman. --include-chairman=false should NOT override that.
		// Bug: Boolean("false") === true, so chairman was incorrectly force-included.
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--include-chairman=false",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		// --include-chairman=false → includeChairman should be false
		// excludeChairmanOverride should be null (fallback to config default: true)
		// So chairman should be excluded
		expect(!memberNames.includes("claude")).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("--include-chairman=true force-includes chairman even when config excludes", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--include-chairman=true",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		// --include-chairman=true → includeChairman=true, force-include chairman
		expect(memberNames.includes("claude")).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("--include-chairman (no value) force-includes chairman", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--include-chairman",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		// --include-chairman (boolean flag) → true → force-include
		expect(memberNames.includes("claude")).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("(no --include-chairman) falls back to config default for exclusion", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: true",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		// No flag → config default (exclude=true), no force-include → chairman excluded
		expect(!memberNames.includes("claude")).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});
});

// ---------------------------------------------------------------------------
// resume-member
// ---------------------------------------------------------------------------

describe("resume-member", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;
	let jobDir: string;
	let memberDir: string;

	// Minimal mock driver factory — only opencode is registered
	function makeMockDriver() {
		return {
			cli: "opencode" as const,
			initialCommand: () => ({ program: "opencode", args: [], env: {} }),
			resumeCommand: () => ({ program: "opencode", args: ["--resume", "sess-123"], env: {} }),
			parseStdout: (_s: string) => ({
				sessionID: "sess-123",
				terminal: "stop" as const,
				text: "result",
				rawEvents: [],
			}),
		};
	}

	function mockDriverFactory(cliType: string) {
		if (cliType === "opencode") return makeMockDriver();
		return null;
	}

	// Stub resumeOneTurn that succeeds without spawning a real process
	function makeResumeStub(sessionID = "sess-123") {
		return async (_sid: string, _opts: unknown) => ({
			state: "done",
			sessionID,
			text: "resumed output",
			exitCode: 0,
		});
	}

	function writeStatus(dir: string, payload: Record<string, unknown>) {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(payload, null, 2), "utf8");
	}

	function readStatus(dir: string): Record<string, unknown> {
		return JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-member-test-"));
		jobDir = path.join(tmpDir, "job1");
		memberDir = path.join(jobDir, "members", "opencode");
		writeStatus(memberDir, {
			member: "opencode",
			state: "done",
			sessionID: "sess-123",
			resume_count: 0,
			command: "opencode",
		});
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Import target lazily so we don't need dynamic import dance
	async function getCmdResumeMember() {
		const mod = await import("./job.ts");
		return (mod as any).cmdResumeMember as (
			jobDir: string,
			name: string,
			prompt: string,
			config: { entityDirName: string; [key: string]: unknown },
			opts?: {
				driverFactory?: (cliType: string) => unknown;
				resumeOneTurnFn?: typeof makeResumeStub extends () => infer R ? R : never;
			},
		) => Promise<void>;
	}

	const ORCHESTRATE_REVIEW_CONFIG = {
		entitySingular: "member",
		entityPlural: "members",
		entityDirName: "members",
		jobPrefix: "chunk-review-",
		uiLabel: "[Chunk Review]",
		configTopLevelKey: "chunk-review",
	};

	test("resume-member D1a sub-command exits 0 sessionID present", async () => {
		const cmdResumeMember = await getCmdResumeMember();
		// Should not throw — sessionID present, state not error/non_retryable, count < 3
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry this", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).resolves.toBeUndefined();
	});

	test("resume-member D1b persists resume_count 1 after D1a", async () => {
		const cmdResumeMember = await getCmdResumeMember();
		await cmdResumeMember(jobDir, "opencode", "retry this", ORCHESTRATE_REVIEW_CONFIG, {
			driverFactory: mockDriverFactory as any,
			resumeOneTurnFn: makeResumeStub() as any,
		});
		const status = readStatus(memberDir);
		expect(status.resume_count).toBe(1);
	});

	test("resume-member D2 rejects with resume cap exceeded", async () => {
		// Set resume_count to 3 (at cap)
		writeStatus(memberDir, {
			member: "opencode",
			state: "done",
			sessionID: "sess-123",
			resume_count: 3,
			command: "opencode",
		});
		const cmdResumeMember = await getCmdResumeMember();
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("resume cap exceeded (3/3)");
	});

	test("resume-member D3 rejects with no resumable session", async () => {
		// sessionID absent
		writeStatus(memberDir, {
			member: "opencode",
			state: "done",
			sessionID: null,
			command: "opencode",
		});
		const cmdResumeMember = await getCmdResumeMember();
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("no resumable session");
	});

	test("resume-member D4 sequential 3 calls final resume_count 3", async () => {
		const cmdResumeMember = await getCmdResumeMember();
		for (let i = 0; i < 3; i++) {
			await cmdResumeMember(jobDir, "opencode", `retry ${i}`, ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			});
		}
		const status = readStatus(memberDir);
		expect(status.resume_count).toBe(3);
		// 4th call must fail
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry 4", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("resume cap exceeded (3/3)");
	});

	test("resume-member detectCliType opencode", async () => {
		const cmdResumeMember = await getCmdResumeMember();
		const calls: string[] = [];
		const trackingFactory = (cliType: string) => {
			calls.push(cliType);
			return mockDriverFactory(cliType);
		};
		await cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
			driverFactory: trackingFactory as any,
			resumeOneTurnFn: makeResumeStub() as any,
		});
		expect(calls).toContain("opencode");
	});

	test("resume-member D6 registered before Unknown command", () => {
		const source = fs.readFileSync(SCRIPT, "utf8");
		const lines = source.split("\n");
		const resumeIdx = lines.findIndex((l) => l.includes('command === "resume-member"'));
		const unknownIdx = lines.findIndex((l) => l.includes("Unknown command"));
		expect(resumeIdx).toBeGreaterThan(-1);
		expect(unknownIdx).toBeGreaterThan(-1);
		expect(resumeIdx).toBeLessThan(unknownIdx);
	});

	test("resume-member D7a rejects when --job missing", async () => {
		// Test via CLI spawn — missing --job arg
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "resume-member", "--member", "alice", "--prompt", "hi"],
				{
					stdio: "pipe",
				},
			);
			throw new Error("expected non-zero exit");
		} catch (err: any) {
			expect(err.status).toBeGreaterThan(0);
			expect(err.stderr.toString()).toContain("--job required");
		}
	});

	test("resume-member D7b rejects when --member missing", async () => {
		try {
			execFileSync(process.execPath, [SCRIPT, "resume-member", "--job", jobDir, "--prompt", "hi"], {
				stdio: "pipe",
			});
			throw new Error("expected non-zero exit");
		} catch (err: any) {
			expect(err.status).toBeGreaterThan(0);
			expect(err.stderr.toString()).toContain("--member required");
		}
	});

	test("resume-member D7c rejects when --prompt missing", async () => {
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "resume-member", "--job", jobDir, "--member", "opencode"],
				{
					stdio: "pipe",
				},
			);
			throw new Error("expected non-zero exit");
		} catch (err: any) {
			expect(err.status).toBeGreaterThan(0);
			expect(err.stderr.toString()).toContain("--prompt required");
		}
	});

	test("resume-member D8 rejects when no driver for gemini", async () => {
		// gemini is intentionally absent from driver registry
		writeStatus(memberDir, {
			member: "opencode",
			state: "done",
			sessionID: "sess-123",
			resume_count: 0,
			command: "gemini",
		});
		const cmdResumeMember = await getCmdResumeMember();
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("no driver for gemini");
	});

	test("resume-member D9 rejects when state error", async () => {
		writeStatus(memberDir, {
			member: "opencode",
			state: "error",
			sessionID: "sess-123",
			resume_count: 0,
			command: "opencode",
		});
		const cmdResumeMember = await getCmdResumeMember();
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("member in non-resumable state: error");
	});

	test("resume-member D10 concurrent guardrail valid JSON", async () => {
		// Simulate concurrent writes: two calls run sequentially (sequential assumption).
		// After both, status.json must remain valid JSON.
		const cmdResumeMember = await getCmdResumeMember();
		await cmdResumeMember(jobDir, "opencode", "first", ORCHESTRATE_REVIEW_CONFIG, {
			driverFactory: mockDriverFactory as any,
			resumeOneTurnFn: makeResumeStub() as any,
		});
		await cmdResumeMember(jobDir, "opencode", "second", ORCHESTRATE_REVIEW_CONFIG, {
			driverFactory: mockDriverFactory as any,
			resumeOneTurnFn: makeResumeStub() as any,
		});
		const raw = fs.readFileSync(path.join(memberDir, "status.json"), "utf8");
		expect(() => JSON.parse(raw)).not.toThrow();
		const status = JSON.parse(raw);
		expect(typeof status.resume_count).toBe("number");
		expect(status.resume_count).toBe(2);
	});

	test("resume-member D11 rejects when status.command missing — unknown cli type", async () => {
		writeStatus(memberDir, {
			member: "opencode",
			state: "done",
			sessionID: "sess-123",
			resume_count: 0,
			// command: absent
		});
		const cmdResumeMember = await getCmdResumeMember();
		await expect(
			cmdResumeMember(jobDir, "opencode", "retry", ORCHESTRATE_REVIEW_CONFIG, {
				driverFactory: mockDriverFactory as any,
				resumeOneTurnFn: makeResumeStub() as any,
			}),
		).rejects.toThrow("unknown cli type");
	});
});

// ---------------------------------------------------------------------------
// resume-member CLI dispatch: detached-spawn contract (the actual `job.ts resume-member`
// entry point, unlike the tests above which call cmdResumeMember directly and never pass
// workerPath — that exercises the shared in-process fallback other skills still use). This is
// the surface the deliverable targets: a resume turn must not block the caller (a Bash tool
// call with its own timeout) for the turn's full duration.
// ---------------------------------------------------------------------------

describe("resume-member CLI 배선 — detached spawn 계약", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;
	let jobDir: string;
	let memberDir: string;
	let stubDir: string;

	/**
	 * Fake `opencode` binary on PATH: sleeps long enough that a caller blocking in-process on
	 * it would observably block, then emits a minimal opencode NDJSON stream the real
	 * opencodeDriver can parse (step_finish/stop + one text event) before exiting 0.
	 */
	function makeSlowOpencodeStub(sleepSec: number): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-spawn-stub-"));
		const stubPath = path.join(dir, "opencode");
		fs.writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				`sleep ${sleepSec}`,
				'echo \'{"type":"step_finish","sessionID":"sess-123","part":{"reason":"stop"}}\'',
				'echo \'{"type":"text","part":{"text":"resumed done"}}\'',
				"exit 0",
			].join("\n"),
			"utf8",
		);
		fs.chmodSync(stubPath, 0o755);
		return dir;
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-spawn-job-"));
		jobDir = path.join(tmpDir, "job1");
		memberDir = path.join(jobDir, "members", "opencode");
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(
			path.join(memberDir, "status.json"),
			JSON.stringify(
				{
					member: "opencode",
					state: "awaiting_resume",
					sessionID: "sess-existing",
					resume_count: 0,
					command: "opencode --format json",
				},
				null,
				2,
			),
			"utf8",
		);
		stubDir = makeSlowOpencodeStub(2);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(stubDir, { recursive: true, force: true });
	});

	function readStatus(): Record<string, unknown> {
		return JSON.parse(fs.readFileSync(path.join(memberDir, "status.json"), "utf8"));
	}

	test(
		"resume-member 서브커맨드는 워커 완료를 기다리지 않고 즉시 dispatched ack로 반환한다",
		async () => {
			const start = Date.now();
			const result = execFileSync(
				process.execPath,
				[SCRIPT, "resume-member", "--job", jobDir, "--member", "opencode", "--prompt", "continue"],
				{ stdio: "pipe", env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } },
			);
			const elapsedMs = Date.now() - start;

			// The fake CLI sleeps 2s before it would ever finish a turn — a caller still blocking
			// in-process on that turn would take at least that long. Returning in a small fraction
			// of that window is the direct evidence dispatch is non-blocking.
			expect(elapsedMs).toBeLessThan(1500);
			expect(JSON.parse(result.toString())).toEqual({ state: "dispatched", member: "opencode" });

			// Queued pre-transition: cmdCollect's "awaiting_resume already ended its own turn"
			// early-return must not still apply to this freshly-dispatched resume.
			const queuedStatus = readStatus();
			expect(queuedStatus.state).toBe("queued");
			expect(queuedStatus.sessionID).toBe("sess-existing");
			expect(queuedStatus.command).toBe("opencode --format json");
			expect(queuedStatus.resume_count).toBe(1);

			// Poll for the detached worker to actually finish the turn — state transitions
			// queued → running (runOnce's own status write, before the stub's 2s sleep resolves)
			// → done (executeOneTurn's final write once stdout is parsed).
			const deadline = Date.now() + 10000;
			let finalStatus = readStatus();
			while (
				(finalStatus.state === "queued" || finalStatus.state === "running") &&
				Date.now() < deadline
			) {
				await new Promise((resolve) => setTimeout(resolve, 200));
				finalStatus = readStatus();
			}

			expect(finalStatus.state).toBe("done");
			expect(finalStatus.sessionID).toBe("sess-123");
			expect(finalStatus.resume_count).toBe(1);
		},
		15000,
	);
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe("cmdResults", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	function setupJobFixture(
		jobDir: string,
		members: Record<
			string,
			{ member: string; state: string; exitCode: number; output: string; stderr: string }
		>,
		opts?: { prompt?: string },
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "test-results" }));
		if (opts?.prompt) {
			fs.writeFileSync(path.join(jobDir, "prompt.txt"), opts.prompt);
		}
		const membersDir = path.join(jobDir, "members");
		fs.mkdirSync(membersDir, { recursive: true });
		for (const [name, data] of Object.entries(members)) {
			const dir = path.join(membersDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "status.json"),
				JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }),
			);
			if (data.output || data.state === "done") {
				fs.writeFileSync(path.join(dir, "output.txt"), data.output);
			}
			fs.writeFileSync(path.join(dir, "error.txt"), data.stderr);
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("--json 출력에서 prompt, stderr 필드가 제거됨", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-qa1"));
		const largeStderr = "x".repeat(33000);
		const largePrompt = "p".repeat(30000);
		setupJobFixture(
			jobDir,
			{
				"claude-0": {
					member: "claude",
					state: "done",
					exitCode: 0,
					output: "review output",
					stderr: largeStderr,
				},
			},
			{ prompt: largePrompt },
		);

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--json", jobDir], {
			stdio: "pipe",
		});
		const parsed = JSON.parse(result.toString());

		expect(parsed).not.toHaveProperty("prompt");
		expect(parsed.members[0]).not.toHaveProperty("stderr");
		expect(parsed.members[0].output).toBe("review output");
		expect(parsed.members[0].member).toBe("claude");
		expect(parsed.members[0].state).toBe("done");
		expect(parsed.members[0].exitCode).toBe(0);
		expect(parsed.id).toBe("test-results");
		expect(parsed.jobDir).toBe(path.resolve(jobDir));
	});

	test("3 reviewers --json 출력이 30000자 미만", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-qa2"));
		setupJobFixture(
			jobDir,
			{
				"claude-0": {
					member: "claude",
					state: "done",
					exitCode: 0,
					output: "claude review",
					stderr: "x".repeat(33000),
				},
				"codex-0": {
					member: "codex",
					state: "done",
					exitCode: 0,
					output: "codex review",
					stderr: "x".repeat(33000),
				},
				"gemini-0": {
					member: "gemini",
					state: "error",
					exitCode: 1,
					output: "gemini review",
					stderr: "x".repeat(33000),
				},
			},
			{ prompt: "p".repeat(30000) },
		);

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--json", jobDir], {
			stdio: "pipe",
		});
		const output = result.toString();

		expect(output.length).toBeLessThan(30000);
		const parsed = JSON.parse(output);
		expect(parsed.members).toHaveLength(3);
	});

	test("non-JSON: output 비어있으면 stderr fallback 출력", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-qa3"));
		setupJobFixture(jobDir, {
			"claude-0": {
				member: "claude",
				state: "error",
				exitCode: 1,
				output: "",
				stderr: "stderr-fallback-content",
			},
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", jobDir], { stdio: "pipe" });
		const stdout = result.toString();

		expect(stdout).toContain("stderr-fallback-content");
	});

	test("non-JSON: output 있으면 output 출력, stderr 미포함", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-qa4"));
		setupJobFixture(jobDir, {
			"claude-0": {
				member: "claude",
				state: "done",
				exitCode: 0,
				output: "primary-output-content",
				stderr: "hidden-stderr-content",
			},
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", jobDir], { stdio: "pipe" });
		const stdout = result.toString();

		expect(stdout).toContain("primary-output-content");
		expect(stdout).not.toContain("hidden-stderr-content");
	});

	test("--manifest: done reviewer의 outputFilePath가 job dir 내 output.txt 참조", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-manifest1"));
		setupJobFixture(jobDir, {
			"claude-0": {
				member: "claude",
				state: "done",
				exitCode: 0,
				output: "claude review output here",
				stderr: "",
			},
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--manifest", jobDir], {
			stdio: "pipe",
		});
		const parsed = JSON.parse(result.toString());

		expect(parsed.id).toBe("test-results");
		expect(parsed.members).toHaveLength(1);
		expect(parsed.members[0].member).toBe("claude");
		expect(parsed.members[0].outputFilePath).toBeTruthy();
		expect(parsed.members[0].outputFilePath).toContain("output.txt");
		expect(parsed.members[0].outputFilePath).toContain(path.join("members", "claude-0"));
		expect(parsed.members[0].errorMessage).toBeNull();

		const fileContent = fs.readFileSync(parsed.members[0].outputFilePath, "utf8");
		expect(fileContent).toBe("claude review output here");
	});

	test("--manifest: failed/non_retryable reviewer의 outputFilePath가 null + errorMessage 존재", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-manifest2"));
		setupJobFixture(jobDir, {
			"claude-0": {
				member: "claude",
				state: "done",
				exitCode: 0,
				output: "valid output",
				stderr: "",
			},
			"codex-0": { member: "codex", state: "error", exitCode: 1, output: "", stderr: "some error" },
			"gemini-0": {
				member: "gemini",
				state: "non_retryable",
				exitCode: 42,
				output: "",
				stderr: "quota exceeded",
			},
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--manifest", jobDir], {
			stdio: "pipe",
		});
		const parsed = JSON.parse(result.toString());

		expect(parsed.members).toHaveLength(3);

		const claude = parsed.members.find((r: any) => r.member === "claude");
		const codex = parsed.members.find((r: any) => r.member === "codex");
		const gemini = parsed.members.find((r: any) => r.member === "gemini");

		expect(claude.outputFilePath).toBeTruthy();
		expect(claude.errorMessage).toBeNull();
		expect(codex.outputFilePath).toBeNull();
		expect(codex.errorMessage).toBeTruthy();
		expect(gemini.outputFilePath).toBeNull();
		expect(gemini.errorMessage).toBeTruthy();
	});

	test("--manifest: JSON schema 검증 (id, reviewers 필드 구조)", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-manifest3"));
		setupJobFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "output A", stderr: "" },
			"codex-0": { member: "codex", state: "done", exitCode: 0, output: "output B", stderr: "" },
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--manifest", jobDir], {
			stdio: "pipe",
		});
		const parsed = JSON.parse(result.toString());

		// Top-level schema
		expect(parsed).toHaveProperty("id");
		expect(parsed).toHaveProperty("members");
		expect(Array.isArray(parsed.members)).toBe(true);

		// Must NOT have jobDir (unlike --json mode)
		expect(parsed).not.toHaveProperty("jobDir");

		// Each reviewer must have at least: member, outputFilePath, errorMessage.
		// Extended fields (json-mode): size_bytes, attempts, error.
		for (const r of parsed.members) {
			expect(r).toHaveProperty("member");
			expect(r).toHaveProperty("outputFilePath");
			expect(r).toHaveProperty("errorMessage");
			expect(r).toHaveProperty("size_bytes");
			expect(r).toHaveProperty("attempts");
			expect(r).toHaveProperty("error");
			// Must NOT have legacy fields
			expect(r).not.toHaveProperty("state");
			expect(r).not.toHaveProperty("exitCode");
			expect(r).not.toHaveProperty("message");
			expect(r).not.toHaveProperty("outputFile");
			// Must NOT have output inline (unlike --json mode)
			expect(r).not.toHaveProperty("output");
		}
	});

	test("--manifest: stdout가 경량 (2KB 미만, output 인라인 없음)", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-manifest4"));
		const largeOutput = "x".repeat(50000);
		setupJobFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: largeOutput, stderr: "" },
			"codex-0": { member: "codex", state: "done", exitCode: 0, output: largeOutput, stderr: "" },
			"gemini-0": { member: "gemini", state: "done", exitCode: 0, output: largeOutput, stderr: "" },
		});

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--manifest", jobDir], {
			stdio: "pipe",
		});
		const output = result.toString();

		// Manifest stdout must be tiny regardless of output size
		expect(output.length).toBeLessThan(2000);

		const parsed = JSON.parse(output);
		expect(parsed.members).toHaveLength(3);

		// Each outputFilePath must point to job dir and contain the large output
		for (const r of parsed.members) {
			expect(r.outputFilePath).toBeTruthy();
			expect(r.outputFilePath).toContain("output.txt");
			const content = fs.readFileSync(r.outputFilePath, "utf8");
			expect(content.length).toBe(50000);
		}
	});

	const GPT_S5_500K_NDJSON =
		'{"type":"step_start","timestamp":1778226217098,"sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","part":{"id":"prt_e068ac087001t8WNcPEOZryJIV","messageID":"msg_e068ab2a50014dmNYIRCjqDHPI","sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","type":"step-start"}}\n' +
		'{"type":"error","timestamp":1778226217218,"sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","error":{"name":"ContextOverflowError","data":{"message":"Input exceeds context window of this model","responseBody":"{\\"type\\":\\"error\\",\\"sequence_number\\":2,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"code\\":\\"context_length_exceeded\\",\\"message\\":\\"Your input exceeds the context window of this model. Please adjust your input and try again.\\",\\"param\\":\\"input\\"}}"}}}\n' +
		'{"type":"step_start","timestamp":1778226218388,"sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","part":{"id":"prt_e068ac592001uc6X0Qm6puG9uR","messageID":"msg_e068ac11a0016rmZAZiESQmXu9","sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","type":"step-start"}}\n' +
		'{"type":"error","timestamp":1778226218594,"sessionID":"ses_1f9755009ffee8JrpYLKy1QwzO","error":{"name":"ContextOverflowError","data":{"message":"Input exceeds context window of this model","responseBody":"{\\"type\\":\\"error\\",\\"sequence_number\\":2,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"code\\":\\"context_length_exceeded\\",\\"message\\":\\"Your input exceeds the context window of this model. Please adjust your input and try again.\\",\\"param\\":\\"input\\"}}"}}}\n';

	test("replay smoke: gpt-S5-500k overflow → manifest outputFilePath null", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-overflow-replay"));
		setupJobFixture(jobDir, {
			"gpt-0": {
				member: "gpt",
				state: "permanent_error",
				exitCode: 1,
				output: GPT_S5_500K_NDJSON,
				stderr: "",
			},
		});
		// Override status.json to include size_bytes so buildManifest activates json-mode gate
		const statusPath = path.join(jobDir, "members", "gpt-0", "status.json");
		fs.writeFileSync(
			statusPath,
			JSON.stringify({
				member: "gpt",
				state: "permanent_error",
				exitCode: 1,
				size_bytes: GPT_S5_500K_NDJSON.length,
				attempts: 2,
			}),
		);

		const result = execFileSync(process.execPath, [SCRIPT, "results", "--manifest", jobDir], {
			stdio: "pipe",
		});
		const parsed = JSON.parse(result.toString());

		expect(parsed.members).toHaveLength(1);
		expect(parsed.members[0].member).toBe("gpt");
		expect(parsed.members[0].outputFilePath).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// buildManifest (unit)
// ---------------------------------------------------------------------------

describe("buildManifest", () => {
	let tmpDir: string;

	function setupManifestFixture(
		jobDir: string,
		members: Record<string, { member: string; state: string; exitCode: number; output: string }>,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "manifest-test" }));
		const membersDir = path.join(jobDir, "members");
		fs.mkdirSync(membersDir, { recursive: true });
		for (const [name, data] of Object.entries(members)) {
			const dir = path.join(membersDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "status.json"),
				JSON.stringify({
					member: data.member,
					state: data.state,
					exitCode: data.exitCode,
					message: data.state === "error" ? "failed" : undefined,
				}),
			);
			if (data.output) {
				fs.writeFileSync(path.join(dir, "output.txt"), data.output);
			}
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("올바른 manifest 구조 반환 (done 리뷰어)", () => {
		const jobDir = path.join(tmpDir, "job-bm1");
		setupManifestFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "review A" },
			"codex-0": { member: "codex", state: "done", exitCode: 0, output: "review B" },
		});

		const manifest = buildManifest(jobDir);

		expect(manifest.id).toBe("manifest-test");
		expect(manifest.members).toHaveLength(2);
		// Sorted alphabetically
		expect(manifest.members[0].member).toBe("claude");
		expect(manifest.members[1].member).toBe("codex");
		// Done reviewers have outputFilePath and null errorMessage
		for (const r of manifest.members) {
			expect(r.outputFilePath).toBeTruthy();
			expect(r.outputFilePath).toContain("output.txt");
			expect(r.errorMessage).toBeNull();
		}
	});

	test("output 없는 리뷰어는 outputFilePath=null, errorMessage 설정", () => {
		const jobDir = path.join(tmpDir, "job-bm2");
		setupManifestFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "has output" },
			"gemini-0": { member: "gemini", state: "error", exitCode: 1, output: "" },
		});

		const manifest = buildManifest(jobDir);
		const claude = manifest.members.find((r: any) => r.member === "claude");
		const gemini = manifest.members.find((r: any) => r.member === "gemini");

		expect(claude.outputFilePath).toBeTruthy();
		expect(claude.errorMessage).toBeNull();
		expect(gemini.outputFilePath).toBeNull();
		expect(gemini.errorMessage).toBeTruthy();
	});

	test("job.json 없으면 id=unknown", () => {
		const jobDir = path.join(tmpDir, "job-bm3");
		fs.mkdirSync(jobDir, { recursive: true });
		// No job.json, no reviewers
		const manifest = buildManifest(jobDir);
		expect(manifest.id).toBe("unknown");
		expect(manifest.members).toHaveLength(0);
	});

	test("_safeName 내부 필드가 외부에 노출되지 않음", () => {
		const jobDir = path.join(tmpDir, "job-bm4");
		setupManifestFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "data" },
		});

		const manifest = buildManifest(jobDir);
		for (const r of manifest.members) {
			expect(r).not.toHaveProperty("_safeName");
		}
	});
});

// ---------------------------------------------------------------------------
// cmdCollect (process-level)
// ---------------------------------------------------------------------------

describe("cmdCollect", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	function setupCollectFixture(
		jobDir: string,
		members: Record<string, { member: string; state: string; exitCode: number; output: string }>,
		opts?: { timeoutSec?: number },
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: "collect-test", settings: { timeoutSec: opts?.timeoutSec ?? 60 } }),
		);
		const membersDir = path.join(jobDir, "members");
		fs.mkdirSync(membersDir, { recursive: true });
		for (const [name, data] of Object.entries(members)) {
			const dir = path.join(membersDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "status.json"),
				JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }),
			);
			if (data.output) {
				fs.writeFileSync(path.join(dir, "output.txt"), data.output);
			}
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		mock.module("@lib/job-utils", () => realJobUtils);
		mock.restore();
	});

	test("done 상태: manifest JSON 반환", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-collect-done"));
		setupCollectFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "review output A" },
			"codex-0": { member: "codex", state: "done", exitCode: 0, output: "review output B" },
		});

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "collect", "--timeout-ms", "5000", jobDir],
			{ stdio: "pipe" },
		);
		const parsed = JSON.parse(result.toString());

		expect(parsed.overallState).toBe("done");
		expect(parsed.id).toBe("collect-test");
		expect(parsed.members).toHaveLength(2);
		expect(parsed.members[0].member).toBe("claude");
		expect(parsed.members[0].outputFilePath).toBeTruthy();
		expect(parsed.members[0].errorMessage).toBeNull();
	});

	test("로그는 job의 jobs 디렉터리 옆에 떨어진다 (실제 OMT_DIR 비오염)", () => {
		// Production layout: <omtDir>/jobs/<jobId>. The logger derives its root two
		// levels up from jobDir, so a run pointed at a temp jobs-dir logs there —
		// this is what keeps the suite from writing into ~/.omt/<project>/logs/.
		const jobDirBasename = suiteJobDirBasename("chunk-review-logroot01");
		const jobDir = path.join(tmpDir, "jobs", jobDirBasename);
		setupCollectFixture(jobDir, {
			"claude-0": { member: "claude", state: "done", exitCode: 0, output: "x" },
		});

		execFileSync(process.execPath, [SCRIPT, "collect", "--timeout-ms", "5000", jobDir], {
			stdio: "pipe",
		});

		const expectedLogFile = expectedLogFileName(jobDirBasename);
		const logPath = path.join(tmpDir, "logs", expectedLogFile);
		expect(fs.existsSync(logPath)).toBe(true);
		expect(fs.readFileSync(logPath, "utf8")).toContain("collect:");

		// Checks only the exact filenames this suite's own fixtures can produce, compared
		// against the module-load-time snapshot — a pre-existing file (e.g. left behind by
		// another worktree running this same suite) is allowed to sit there unchanged, but
		// this run creating or appending to any of them is a real regression and fails.
		for (const basename of SUITE_JOB_DIR_BASENAMES) {
			const file = expectedLogFileName(basename);
			for (const dir of [REAL_TMP_LOG_DIR, REAL_OMT_LOG_DIR]) {
				const filePath = path.join(dir, file);
				expect(fingerprint(filePath)).toEqual(SUITE_LOG_FINGERPRINTS_BEFORE.get(filePath) ?? null);
			}
		}
	});

	test("collect 후 멤버별 소요를 job createdAt 기준으로 기록", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("chunk-review-durations1"));
		setupCollectFixture(jobDir, {
			"alpha-0": { member: "alpha", state: "done", exitCode: 0, output: "a" },
			"beta-0": { member: "beta", state: "done", exitCode: 0, output: "b" },
		});

		// Mirrors the real terminal status.json: `finishedAt` only, no `startedAt`
		// — the running-state write that sets `startedAt` is replaced wholesale
		// when the member finishes, so elapsed must anchor on job.json createdAt.
		// Do not add `startedAt` here; that would test a field the worker never
		// leaves behind.
		const base = Date.parse("2026-01-01T00:00:00.000Z");
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({
				id: "collect-test",
				createdAt: new Date(base).toISOString(),
				settings: { timeoutSec: 60 },
			}),
		);
		const membersDir = path.join(jobDir, "members");
		for (const [dir, member, elapsedSec] of [
			["alpha-0", "alpha", 90],
			["beta-0", "beta", 30],
		] as const) {
			fs.writeFileSync(
				path.join(membersDir, dir, "status.json"),
				JSON.stringify({
					member,
					state: "done",
					exitCode: 0,
					finishedAt: new Date(base + elapsedSec * 1000).toISOString(),
				}),
			);
		}

		execFileSync(process.execPath, [SCRIPT, "collect", "--timeout-ms", "5000", jobDir], {
			stdio: "pipe",
		});

		const log = fs.readFileSync(
			path.join(tmpDir, "logs", "chunk-review-job-durations1.log"),
			"utf8",
		);
		expect(log).toContain("member durations: alpha-0=90s beta-0=30s");
	});

	test("timeout: not-done JSON 반환 (overallState, id, counts)", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-collect-timeout"));
		setupCollectFixture(jobDir, {
			"claude-0": { member: "claude", state: "running", exitCode: 0, output: "" },
			"codex-0": { member: "codex", state: "queued", exitCode: 0, output: "" },
		});
		// Set running member as stale (startedAt 200s ago) to trigger CAS sleep (~250ms) in
		// computeStatus, making the timeout-ms check fire reliably after the first poll.
		// Keep queuedAt fresh to prevent the queued member from also becoming stale.
		const membersDir = path.join(jobDir, "members");
		const staleTs = new Date(Date.now() - 200_000).toISOString();
		const now = new Date().toISOString();
		fs.writeFileSync(
			path.join(membersDir, "claude-0", "status.json"),
			JSON.stringify({ member: "claude", state: "running", exitCode: 0, startedAt: staleTs }),
		);
		fs.writeFileSync(
			path.join(membersDir, "codex-0", "status.json"),
			JSON.stringify({ member: "codex", state: "queued", exitCode: 0, queuedAt: now }),
		);

		// timeout-ms=200: computeStatus sleeps ~250ms due to stale CAS, so elapsed >= 200 fires
		const result = execFileSync(
			process.execPath,
			[SCRIPT, "collect", "--timeout-ms", "200", jobDir],
			{ stdio: "pipe", timeout: 10000 },
		);
		const parsed = JSON.parse(result.toString());

		expect(parsed.overallState).not.toBe("done");
		expect(parsed.id).toBe("collect-test");
		expect(parsed).toHaveProperty("counts");
		expect(parsed.counts).toHaveProperty("total");
		expect(parsed.counts).toHaveProperty("running");
		expect(parsed.counts).toHaveProperty("queued");
		// Must NOT have reviewers array (that's manifest-only)
		expect(parsed).not.toHaveProperty("members");
	});

	test("hardcap: timeout-ms=999999 → COLLECT_TIMEOUT_HARDCAP_MS(600000)로 정확히 클램프", async () => {
		// The clamp (`Math.min(requested, COLLECT_TIMEOUT_HARDCAP_MS)`) can't be observed by
		// actually waiting it out — even the clamped value is 10 minutes. Instead this drives
		// cmdCollect's real poll loop against a fully fake clock: `sleepMs` (the only thing the
		// loop awaits between polls) is replaced so each call advances a fake `Date.now()` by the
		// requested ms and resolves immediately — no real delay. The loop then runs its true
		// iteration count in near-zero real time, and the fake-elapsed accumulated at the moment
		// it hits the timeout branch (sleepCallCount * pollIntervalMs) equals exactly whatever
		// COLLECT_TIMEOUT_HARDCAP_MS currently is — changing the constant changes this number,
		// without ever reading it directly (lib/generic-job.ts stays untouched, per this
		// pursuit's non-goal). A member left in a non-terminal state (never "done") keeps the
		// loop from returning before it ever reaches the timeout comparison.
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("chunk-review-hardcap-clamp"));
		setupCollectFixture(jobDir, {
			"claude-0": { member: "claude", state: "queued", exitCode: 0, output: "" },
		});
		const testJobConfig = {
			entitySingular: "member",
			entityPlural: "members",
			entityDirName: "members",
			jobPrefix: "chunk-review-",
			uiLabel: "[Chunk Review]",
			configTopLevelKey: "chunk-review",
		};

		const clock = { now: 1_000_000 };
		let sleepCallCount = 0;
		let observedPollIntervalMs = 0;
		mock.module("@lib/job-utils", () => ({
			...JobUtils,
			sleepMs: async (ms: number) => {
				const msNum = Number(ms);
				if (Number.isFinite(msNum) && msNum > 0) {
					sleepCallCount++;
					observedPollIntervalMs = msNum;
					clock.now += msNum;
				}
			},
		}));

		const realDateNow = Date.now;
		const cacheBust = `${realDateNow()}-${Math.random()}`;
		try {
			Date.now = () => clock.now;
			const freshGenericJob = await import(`@lib/generic-job?hardcap-clamp-test=${cacheBust}`);
			await freshGenericJob.cmdCollect({ "timeout-ms": 999999 }, jobDir, testJobConfig);
		} finally {
			Date.now = realDateNow;
		}

		// Sanity: the fake-sleep path actually ran — guards against the assertion below
		// passing vacuously if the mock silently failed to intercept.
		expect(sleepCallCount).toBeGreaterThan(0);
		expect(sleepCallCount * observedPollIntervalMs).toBe(600000);
	});

	test("collect: jobDir 누락 시 에러", () => {
		try {
			execFileSync(process.execPath, [SCRIPT, "collect"], { stdio: "pipe" });
			throw new Error("Expected execFileSync to throw");
		} catch (err: any) {
			expect(err.status).toBe(1);
			expect(err.stderr.toString()).toContain("collect: missing jobDir");
		}
	});

	test("cmdCollect propagates size_bytes to chairman payload", () => {
		const jobDir = path.join(tmpDir, "jobs", suiteJobDirBasename("job-collect-size-bytes"));
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: "size-bytes-test", settings: { timeoutSec: 60 } }),
		);
		const memberDir = path.join(jobDir, "members", "test-member-0");
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(
			path.join(memberDir, "status.json"),
			JSON.stringify({ member: "test-member", state: "done", size_bytes: 1234, attempts: 3 }),
		);
		fs.writeFileSync(path.join(memberDir, "output.txt"), "review output");

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "collect", "--timeout-ms", "5000", jobDir],
			{ stdio: "pipe" },
		);
		const parsed = JSON.parse(result.toString());

		expect(parsed.overallState).toBe("done");
		expect(parsed.members).toHaveLength(1);
		expect(parsed.members[0].size_bytes).toBe(1234);
	});
});

// ---------------------------------------------------------------------------
// start + collect integration
// ---------------------------------------------------------------------------

describe("start + collect integration", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeTestConfig(dir: string): string {
		const configPath = path.join(dir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: r1",
				"      command: echo r1",
				"    - name: r2",
				"      command: echo r2",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		return configPath;
	}

	function cleanupJob(jobDir: string) {
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", jobDir], { stdio: "pipe" });
		} catch {}
	}

	test("전체 파이프라인: start --prompt-file → mock done → collect → manifest JSON", async () => {
		const configPath = writeTestConfig(tmpDir);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		// Write prompt file
		const promptFile = path.join(tmpDir, "prompt.txt");
		fs.writeFileSync(promptFile, "Review this code for bugs");

		// start: create job via --prompt-file
		const startResult = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"none",
				"--prompt-file",
				promptFile,
			],
			{ stdio: "pipe", timeout: 15000 },
		);
		const jobDir = startResult.toString().trim();
		expect(fs.existsSync(jobDir)).toBe(true);

		try {
			// Verify job structure was created
			const jobJson = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));
			expect(jobJson.members).toHaveLength(2);
			const memberNames = jobJson.members.map((r: any) => r.name);
			expect(memberNames).toContain("r1");
			expect(memberNames).toContain("r2");

			// Verify prompt was stored
			const storedPrompt = fs.readFileSync(path.join(jobDir, "prompt.txt"), "utf8");
			expect(storedPrompt).toBe("Review this code for bugs");

			// Wait for workers to reach a terminal state before mocking.
			// Workers run `echo r1/r2` which produces non-NDJSON output, so they
			// cycle through retries and end in `empty_output` with size_bytes written.
			// Only once workers are terminal (not queued/running/retrying) can we
			// safely overwrite status.json without a race.
			const membersDir = path.join(jobDir, "members");
			const ACTIVE_STATES = new Set(["queued", "running", "retrying"]);
			const deadline = Date.now() + 15000;
			while (Date.now() < deadline) {
				const allTerminal = fs.readdirSync(membersDir).every((entry) => {
					try {
						const s = JSON.parse(
							fs.readFileSync(path.join(membersDir, entry, "status.json"), "utf8"),
						);
						return !ACTIVE_STATES.has(String(s.state));
					} catch {
						return false;
					}
				});
				if (allTerminal) break;
				await new Promise<void>((resolve) => setTimeout(resolve, 100));
			}

			// Mock done status for each reviewer.
			// Include size_bytes > 0 so buildManifest's state-aware predicate
			// (isReadable = state==='done' && (size_bytes ?? Infinity) > 0) keeps outputFilePath non-null.
			for (const entry of fs.readdirSync(membersDir)) {
				const statusPath = path.join(membersDir, entry, "status.json");
				const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
				const mockOutput = `Review output from ${status.member}`;
				fs.writeFileSync(path.join(membersDir, entry, "output.txt"), mockOutput);
				fs.writeFileSync(
					statusPath,
					JSON.stringify({
						member: status.member,
						state: "done",
						exitCode: 0,
						startedAt: new Date().toISOString(),
						finishedAt: new Date().toISOString(),
						size_bytes: Buffer.byteLength(mockOutput),
					}),
				);
			}

			// collect: poll until done and return manifest
			const collectResult = execFileSync(
				process.execPath,
				[SCRIPT, "collect", "--timeout-ms", "5000", jobDir],
				{ stdio: "pipe", timeout: 15000 },
			);
			const manifest = JSON.parse(collectResult.toString());

			expect(manifest.overallState).toBe("done");
			expect(manifest.members).toHaveLength(2);
			for (const reviewer of manifest.members) {
				expect(reviewer.outputFilePath).toBeTruthy();
				expect(fs.existsSync(reviewer.outputFilePath)).toBe(true);
				expect(reviewer.errorMessage).toBeNull();
			}
		} finally {
			cleanupJob(jobDir);
		}
	}, 30000);

	test("짧은 timeout: queued 상태에서 not-done 반환", () => {
		// Use slow commands (sleep 60) so workers stay in running state and never
		// complete before collect times out.
		const configPath = path.join(tmpDir, "config-slow.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: r1",
				"      command: sleep 60",
				"    - name: r2",
				"      command: sleep 60",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		// Write prompt file
		const promptFile = path.join(tmpDir, "prompt.txt");
		fs.writeFileSync(promptFile, "Review this code");

		// start: create job
		const startResult = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"none",
				"--prompt-file",
				promptFile,
			],
			{ stdio: "pipe", timeout: 15000 },
		);
		const jobDir = startResult.toString().trim();

		try {
			// Workers run `sleep 60` — they are queued/running and will not complete during the test.
			// collect with 200ms timeout: computeStatus returns quickly, timeout fires after first poll
			// because elapsed time after I/O exceeds the short timeout.
			const membersDir = path.join(jobDir, "members");
			const now = new Date().toISOString();
			for (const entry of fs.readdirSync(membersDir)) {
				const statusPath = path.join(membersDir, entry, "status.json");
				const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
				fs.writeFileSync(
					statusPath,
					JSON.stringify({
						member: status.member,
						state: "queued",
						exitCode: 0,
						queuedAt: now,
					}),
				);
			}

			// collect with 1ms timeout: workers are running `sleep 60` and will not complete,
			// so every poll returns not-done and the timeout fires quickly
			const collectResult = execFileSync(
				process.execPath,
				[SCRIPT, "collect", "--timeout-ms", "1", jobDir],
				{ stdio: "pipe", timeout: 10000 },
			);
			const parsed = JSON.parse(collectResult.toString());

			expect(parsed.overallState).not.toBe("done");
			expect(parsed).toHaveProperty("counts");
			expect(parsed.counts.total).toBe(2);
			// Should NOT have reviewers array (that's manifest-only, returned only when done)
			expect(parsed).not.toHaveProperty("members");
		} finally {
			cleanupJob(jobDir);
		}
	}, 30000);
});

// ---------------------------------------------------------------------------
// exclude_chairman_from_members: YAML 1.2 문자열 "no" 회귀 (Bug fix)
// Bun.YAML.parse는 YAML 1.2라 `no`/`off`는 boolean이 아닌 문자열로 파싱된다.
// `optionalBoolean()`로 걸러버리면 undefined가 되어 기본값(true, chairman 제외)으로
// 역전된다 — configExcludeSetting은 normalizeBool로 사전 정규화해서 넘겨야 한다.
// ---------------------------------------------------------------------------

describe('exclude_chairman_from_members: 문자열 "no" (YAML 1.2) 회귀', () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('설정값이 문자열 `"no"`이면 CLI 오버라이드 없이도 chairman이 유지된다', () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: claude",
				"  members:",
				"    - name: claude",
				"      command: echo claude",
				"    - name: gemini",
				"      command: echo gemini",
				"  settings:",
				"    exclude_chairman_from_members: no",
				"    timeout: 10",
			].join("\n"),
		);

		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"claude",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());
		const memberNames = output.members.map((r: { name: string }) => r.name);
		expect(output.settings.excludeChairmanFromMembers).toBe(false);
		expect(memberNames.includes("claude")).toBe(true);

		// cleanup spawned workers
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});
});

// ---------------------------------------------------------------------------
// parseChunkReviewConfig — settings.deny.skills parsing + format validation
// ---------------------------------------------------------------------------

describe("parseChunkReviewConfig settings.deny.skills", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function expectParseExitsWithError(configPath: string, expectedSubstring: string) {
		const scriptContent = `
      const { parseChunkReviewConfig } = await import('${path.resolve(import.meta.dirname, "./job.ts").replace(/'/g, "\\'")}');
      await parseChunkReviewConfig('${configPath.replace(/'/g, "\\'")}');
    `;
		try {
			execFileSync(process.execPath, ["-e", scriptContent], {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			});
			throw new Error("Expected parseChunkReviewConfig subprocess to exit non-zero");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect((err as any).stderr.toString()).toContain(expectedSubstring);
		}
	}

	test("parses settings.deny.skills as a string array from real YAML", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  settings:",
				"    deny:",
				"      skills:",
				"        - orchestrate-review",
				"        - code-review",
			].join("\n"),
		);
		const result = await parseChunkReviewConfig(configPath);
		expect(result["chunk-review"].settings.deny).toEqual({
			skills: ["orchestrate-review", "code-review"],
		});
	});

	test("fallback (missing config file) does not declare a deny key", async () => {
		const result = await parseChunkReviewConfig(path.join(tmpDir, "missing.yaml"));
		expect(result["chunk-review"].settings.deny).toBeUndefined();
	});

	test("real YAML with no deny key leaves settings.deny undefined", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(configPath, ["chunk-review:", "  settings:", "    timeout: 5"].join("\n"));
		const result = await parseChunkReviewConfig(configPath);
		expect(result["chunk-review"].settings.deny).toBeUndefined();
	});

	test("deny: key with no value (null) does not throw and carries no skills", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(configPath, ["chunk-review:", "  settings:", "    deny:"].join("\n"));
		const result = await parseChunkReviewConfig(configPath);
		expect(result["chunk-review"].settings.deny).toBeNull();
	});

	test("exits 1 when deny.skills is not an array", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", '      skills: "not-an-array"'].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains a non-string element", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", "        - 123"].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains an empty string", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", '        - ""'].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains a whitespace-only string", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", '        - "   "'].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains a name with an embedded space", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", "        - 'a b'"].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains a name with a backslash", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", "        - 'a\\b'"].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});

	test("exits 1 when deny.skills contains a name with an embedded quote", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    deny:", "      skills:", '        - \'a"b\''].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});
});

// ---------------------------------------------------------------------------
// start: settings.deny.skills → job.json settings.denySkills
// ---------------------------------------------------------------------------

describe("start: settings.deny.skills recorded in job.json settings.denySkills", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("job.json settings.denySkills matches the declared deny.skills array", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: claude -p",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    deny:",
				"      skills:",
				"        - orchestrate-review",
				"        - code-review",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"none",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe", env: { ...process.env, PATH: `${sharedStubDir}:${process.env.PATH}` } },
		);
		const output = JSON.parse(result.toString());
		expect(output.settings.denySkills).toEqual(["orchestrate-review", "code-review"]);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});

	test("job.json settings.denySkills is an empty array when deny is not declared", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: claude -p",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"none",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe", env: { ...process.env, PATH: `${sharedStubDir}:${process.env.PATH}` } },
		);
		const output = JSON.parse(result.toString());
		expect(output.settings.denySkills).toEqual([]);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});
});

// ---------------------------------------------------------------------------
// parseChunkReviewConfig settings.mcps.allow — shape guard (assertMcpAllowShape)
// ---------------------------------------------------------------------------

describe("parseChunkReviewConfig settings.mcps.allow", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function expectParseExitsWithError(configPath: string, expectedSubstring: string) {
		const scriptContent = `
      const { parseChunkReviewConfig } = await import('${path.resolve(import.meta.dirname, "./job.ts").replace(/'/g, "\\'")}');
      await parseChunkReviewConfig('${configPath.replace(/'/g, "\\'")}');
    `;
		try {
			execFileSync(process.execPath, ["-e", scriptContent], {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			});
			throw new Error("Expected parseChunkReviewConfig subprocess to exit non-zero");
		} catch (err) {
			expect((err as any).status).toBe(1);
			expect((err as any).stderr.toString()).toContain(expectedSubstring);
		}
	}

	test("exits 1 when mcps.allow is not an array (a string)", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			["chunk-review:", "  settings:", "    mcps:", '      allow: "codegraph"'].join("\n"),
		);
		expectParseExitsWithError(configPath, `Invalid config in ${configPath}`);
	});
});

// ---------------------------------------------------------------------------
// start: settings.mcps.allow → job.json members[].mcpBlock (computeMcpBlockList
// wiring). Uses cmdStart directly (not via subprocess) so CODEX_HOME can be
// pointed at a hermetic config.toml fixture instead of the real host's.
//
// The block list is recorded per member because a member's own `env.CODEX_HOME`
// changes which config.toml its worker actually reads — see cmdStart's
// mcpBlockByMember.
// ---------------------------------------------------------------------------

describe("start: settings.mcps.allow recorded in job.json members[].mcpBlock", () => {
	let tmpDir: string;
	let jobsDir: string;
	let codexHomeDir: string;
	let prevCodexHome: string | undefined;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-test-"));
		fs.writeFileSync(
			path.join(codexHomeDir, "config.toml"),
			[
				"[mcp_servers.codegraph]",
				'command = "stub"',
				"",
				"[mcp_servers.figma]",
				'command = "stub"',
				"",
				"[mcp_servers.notion]",
				'command = "stub"',
			].join("\n"),
		);
		prevCodexHome = process.env.CODEX_HOME;
		process.env.CODEX_HOME = codexHomeDir;
	});

	afterEach(() => {
		if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = prevCodexHome;
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(codexHomeDir, { recursive: true, force: true });
	});

	test("job.json members[].mcpBlock is the complement of settings.mcps.allow against configured servers", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    mcps:",
				"      allow:",
				"        - codegraph",
			].join("\n"),
		);

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		const entry = fs.readdirSync(jobsDir).find((e) => e.startsWith("chunk-review-"));
		expect(entry).toBeDefined();
		const jobMeta = JSON.parse(
			fs.readFileSync(path.join(jobsDir, entry as string, "job.json"), "utf8"),
		);
		expect(jobMeta.members.map((m: { mcpBlock: string[] }) => m.mcpBlock)).toEqual([
			["figma", "notion"],
		]);
	});

	test("a member's own env.CODEX_HOME decides which config.toml its block list is computed against", async () => {
		// The member home declares a DISJOINT server set from the conductor home
		// (see beforeEach: codegraph/figma/notion). Both failure directions the
		// per-member computation exists to prevent are visible in one assertion:
		// "linear" (member-only) must be blocked, and "figma"/"notion"
		// (conductor-only) must NOT appear — passing a name the member's own
		// config.toml never declares makes codex fail to boot.
		const memberCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-member-"));
		fs.writeFileSync(
			path.join(memberCodexHome, "config.toml"),
			["[mcp_servers.codegraph]", 'command = "stub"', "", "[mcp_servers.linear]", 'command = "stub"'].join(
				"\n",
			),
		);

		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: echo bob",
				"    - name: carol",
				"      command: echo carol",
				"      env:",
				`        CODEX_HOME: ${memberCodexHome}`,
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    mcps:",
				"      allow:",
				"        - codegraph",
			].join("\n"),
		);

		try {
			await cmdStart(
				{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
				"test prompt",
			);

			const entry = fs.readdirSync(jobsDir).find((e) => e.startsWith("chunk-review-"));
			expect(entry).toBeDefined();
			const jobMeta = JSON.parse(
				fs.readFileSync(path.join(jobsDir, entry as string, "job.json"), "utf8"),
			);
			const byName = Object.fromEntries(
				jobMeta.members.map((m: { name: string; mcpBlock: string[] }) => [m.name, m.mcpBlock]),
			);
			expect(byName.bob).toEqual(["figma", "notion"]);
			expect(byName.carol).toEqual(["linear"]);
		} finally {
			fs.rmSync(memberCodexHome, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// start: assertDenyEnforceable gate wiring (cmdStart calls it right after
// assertMembersOrExit, before spawning workers)
// ---------------------------------------------------------------------------

describe("start: assertDenyEnforceable gate wiring", () => {
	const SCRIPT = path.join(import.meta.dirname, "job.ts");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("deny declared + a gemini member present → exit 1 listing the violation and enforceable CLIs", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: claude -p",
				"    - name: bob",
				"      command: gemini",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    deny:",
				"      skills:",
				"        - orchestrate-review",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let threw = false;
		let err: any;
		try {
			execFileSync(
				process.execPath,
				[
					SCRIPT,
					"start",
					"--config",
					configPath,
					"--jobs-dir",
					jobsDir,
					"--chairman",
					"none",
					"test prompt",
				],
				{ stdio: "pipe" },
			);
		} catch (e) {
			threw = true;
			err = e;
		}

		expect(threw).toBe(true);
		expect(err.status).toBe(1);
		const stderr = err.stderr.toString();
		expect(stderr).toContain("Enforceable CLIs: codex, claude, opencode");
		expect(stderr).toContain("bob (gemini)");

		// No job.json should have been written — the gate must block before spawn.
		const jobDirs = fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : [];
		const jobJsonFound = jobDirs.some((d) => fs.existsSync(path.join(jobsDir, d, "job.json")));
		expect(jobJsonFound).toBe(false);
	});

	test("deny not declared + a gemini member present → gate does not block", () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: bob",
				"      command: gemini",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		// This member's command really is "gemini" and the gate passes (no deny
		// declared), so start really spawns it — the suite-scoped stub on PATH
		// makes the detached worker exec a harmless no-op instead of the real
		// gemini binary.
		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--chairman",
				"none",
				"--json",
				"test prompt",
			],
			{ stdio: "pipe", env: { ...process.env, PATH: `${sharedStubDir}:${process.env.PATH}` } },
		);
		// stdout must be pure JSON — the informational "no skill deny declared"
		// note (deny is not declared here) must not leak into the same stream.
		const stdout = result.toString();
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(stdout).not.toContain("no skill deny declared");

		const output = JSON.parse(stdout);
		expect(output.settings.denySkills).toEqual([]);
		const memberNames = output.members.map((m: { name: string }) => m.name);
		expect(memberNames).toContain("bob");

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir], { stdio: "pipe" });
		} catch {}
	});
});

// ---------------------------------------------------------------------------
// cmdStart — job.json members[].workerPgid 앵커 기록
// ---------------------------------------------------------------------------

describe("cmdStart writes workerPgid to job.json", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("job.json의 모든 members가 양의 정수 `workerPgid`를 가진다", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: echo alice",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		const jobDirName = fs.readdirSync(jobsDir)[0];
		const jobDir = path.join(jobsDir, jobDirName);
		const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));

		expect(jobMeta.members.length).toBe(2);
		for (const member of jobMeta.members) {
			expect("workerPgid" in member).toBeTruthy();
			expect(Number.isInteger(member.workerPgid)).toBe(true);
			expect(member.workerPgid).toBeGreaterThan(0);
		}

		// cleanup spawned worker process groups (may have already exited — best-effort)
		for (const member of jobMeta.members) {
			try {
				process.kill(-member.workerPgid, "SIGKILL");
			} catch {
				// already exited — nothing to clean up
			}
		}
	});

	test("job.json의 모든 members가 spawn 시각 증인(`workerPgidStartedAt`)을 가진다", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: echo alice",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		await cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		const jobDirName = fs.readdirSync(jobsDir)[0];
		const jobDir = path.join(jobsDir, jobDirName);
		const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));

		expect(jobMeta.members.length).toBe(2);
		for (const member of jobMeta.members) {
			// 오살 회귀 결함의 수정 검증: 회수기가 "이 PGID 번호가 우리 것"을
			// 확인할 유일한 근거가 이 증인이다 — 부재하면 findOrphanJobs/cmdClean
			// 어느 쪽도 이 워커를 회수하지 않는다.
			expect("workerPgidStartedAt" in member).toBeTruthy();
			expect(typeof member.workerPgidStartedAt).toBe("string");
			expect((member.workerPgidStartedAt as string).length).toBeGreaterThan(0);
		}

		// cleanup spawned worker process groups (may have already exited — best-effort)
		for (const member of jobMeta.members) {
			try {
				process.kill(-member.workerPgid, "SIGKILL");
			} catch {
				// already exited — nothing to clean up
			}
		}
	});

	test("반환 배열에 이름이 없는 멤버는 workerPgid: null로 병합된다", async () => {
		let capturedJobDir = "";
		mock.module("@lib/generic-job", () => ({
			...GenericJob,
			spawnWorkers: ({ jobDir }: { jobDir: string }) => {
				capturedJobDir = jobDir;
				// Only "alice" is reported back — "bob" is absent from the returned array,
				// simulating a spawn that didn't report every entity by name.
				return [{ name: "alice", workerPgid: 4242 }];
			},
		}));

		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: echo alice",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const mod = await import(`./job.ts?workerpgid-merge=${Date.now()}-${Math.random()}`);
		await mod.cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		expect(capturedJobDir).not.toBe("");
		const jobMeta = JSON.parse(fs.readFileSync(path.join(capturedJobDir, "job.json"), "utf8"));
		const alice = jobMeta.members.find((m: { name: string }) => m.name === "alice");
		const bob = jobMeta.members.find((m: { name: string }) => m.name === "bob");
		expect(alice.workerPgid).toBe(4242);
		expect(bob.workerPgid).toBe(null);

		mock.restore();
	});
});

// ---------------------------------------------------------------------------
// cmdStart — conductor session witness in job.json
// ---------------------------------------------------------------------------

describe("cmdStart records the trustworthy conductor session in job.json", () => {
	let tmpDir: string;
	let priorOmtSessionId: string | undefined;
	let priorCodexThreadId: string | undefined;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		priorOmtSessionId = process.env.OMT_SESSION_ID;
		priorCodexThreadId = process.env.CODEX_THREAD_ID;
	});

	afterEach(() => {
		if (priorOmtSessionId === undefined) delete process.env.OMT_SESSION_ID;
		else process.env.OMT_SESSION_ID = priorOmtSessionId;
		if (priorCodexThreadId === undefined) delete process.env.CODEX_THREAD_ID;
		else process.env.CODEX_THREAD_ID = priorCodexThreadId;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test.each([
		["Claude OMT_SESSION_ID", "claude_session", undefined, "claude_session"],
		["Codex CODEX_THREAD_ID fallback", undefined, "codex_thread", "codex_thread"],
		["mismatched IDs", "claude_session", "codex_thread", null],
		["unsafe ID", "unsafe/session", undefined, null],
		["absent IDs", undefined, undefined, null],
	])(
		"%s is persisted through the worker-PGID rewrite",
		async (_caseName, omtSessionId, codexThreadId, expected) => {
			if (omtSessionId === undefined) delete process.env.OMT_SESSION_ID;
			else process.env.OMT_SESSION_ID = omtSessionId;
			if (codexThreadId === undefined) delete process.env.CODEX_THREAD_ID;
			else process.env.CODEX_THREAD_ID = codexThreadId;

			const configPath = path.join(tmpDir, "config.yaml");
			fs.writeFileSync(
				configPath,
				[
					"chunk-review:",
					"  chairman:",
					"    role: none",
					"  members:",
					"    - name: alice",
					"      command: echo alice",
					"  settings:",
					"    exclude_chairman_from_members: false",
				].join("\n"),
			);
			const jobsDir = path.join(tmpDir, "jobs");
			fs.mkdirSync(jobsDir, { recursive: true });

			await cmdStart(
				{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
				"test prompt",
			);

			const jobDir = path.join(jobsDir, fs.readdirSync(jobsDir)[0]);
			const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));
			expect(jobMeta.conductorSessionId).toBe(expected);
			expect(jobMeta.members[0].workerPgid).toBeGreaterThan(0);

			try {
				process.kill(-jobMeta.members[0].workerPgid, "SIGKILL");
			} catch {
				// already exited — nothing to clean up
			}
		},
	);
});


// ---------------------------------------------------------------------------
// start → spawnWorkers wiring: declared deny reaches each dispatched entity
// (AC6 — verified by spying on the shared lib's spawnWorkers, per the spec's
// allowed fallback method since detached workers are not easily inspectable).
// ---------------------------------------------------------------------------

describe("start: deny reaches spawnWorkers entities (AC6 wiring)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		mock.module("@lib/generic-job", () => realGenericJob);
		mock.restore();
	});

	test("each dispatched member entity carries the declared deny array", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: claude -p",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    deny:",
				"      skills:",
				"        - orchestrate-review",
				"        - code-review",
			].join("\n"),
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let capturedEntities: Array<Record<string, unknown>> | undefined;
		mock.module("@lib/generic-job", () => ({
			...GenericJob,
			spawnWorkers: ({ entities }: { entities: Array<Record<string, unknown>> }) => {
				capturedEntities = entities;
				return [];
			},
		}));

		const mod = await import(`./job.ts?ac6-orchestrate-review=${Date.now()}-${Math.random()}`);
		await mod.cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		expect(capturedEntities).toBeDefined();
		expect(capturedEntities?.length).toBe(1);
		expect(capturedEntities?.[0].deny).toEqual(["orchestrate-review", "code-review"]);
	});
});

// ---------------------------------------------------------------------------
// start → spawnWorkers wiring: the computed mcpBlock reaches each dispatched
// entity (closes the untested seam between computeMcpBlockList's calculation
// and buildAugmentedCommand's translation — the transmission point itself was
// unasserted: job.ts:593 could drop or misspell mcpBlock in the entities map
// and every existing test would still pass green).
// ---------------------------------------------------------------------------

describe("start: mcpBlock reaches spawnWorkers entities", () => {
	let tmpDir: string;
	let jobsDir: string;
	let codexHomeDir: string;
	let prevCodexHome: string | undefined;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-test-"));
		fs.writeFileSync(
			path.join(codexHomeDir, "config.toml"),
			[
				"[mcp_servers.codegraph]",
				'command = "stub"',
				"",
				"[mcp_servers.figma]",
				'command = "stub"',
				"",
				"[mcp_servers.notion]",
				'command = "stub"',
			].join("\n"),
		);
		prevCodexHome = process.env.CODEX_HOME;
		process.env.CODEX_HOME = codexHomeDir;
	});

	afterEach(() => {
		if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = prevCodexHome;
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(codexHomeDir, { recursive: true, force: true });
		mock.restore();
	});

	test("every dispatched entity carries the computed mcpBlock", async () => {
		const configPath = path.join(tmpDir, "config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"chunk-review:",
				"  chairman:",
				"    role: none",
				"  members:",
				"    - name: alice",
				"      command: echo alice",
				"    - name: bob",
				"      command: echo bob",
				"  settings:",
				"    exclude_chairman_from_members: false",
				"    timeout: 10",
				"    mcps:",
				"      allow:",
				"        - codegraph",
			].join("\n"),
		);

		let capturedEntities: Array<Record<string, unknown>> | undefined;
		mock.module("@lib/generic-job", () => ({
			...GenericJob,
			spawnWorkers: ({ entities }: { entities: Array<Record<string, unknown>> }) => {
				capturedEntities = entities;
				return [];
			},
		}));

		const mod = await import(`./job.ts?mcpblock-transmission=${Date.now()}-${Math.random()}`);
		await mod.cmdStart(
			{ config: configPath, "jobs-dir": jobsDir, chairman: "none", json: true },
			"test prompt",
		);

		expect(capturedEntities).toBeDefined();
		expect(capturedEntities?.length).toBe(2);
		for (const entity of capturedEntities ?? []) {
			expect(entity.mcpBlock).toEqual(["figma", "notion"]);
		}
	});
});

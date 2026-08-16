#!/usr/bin/env bun

import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

import {
	exitWithError,
	detectHostRole,
	ensureDir,
	safeFileName as _safeFileName,
	atomicWriteJson,
	computeTerminalDoneCount,
	parseArgs,
	generateJobId,
	findProjectRoot,
	resolveChairmanExclusion,
	normalizeBool,
	logRootForJobsDir,
} from "@lib/job-utils";

import { initLogger, logInfo, logStart, logEnd } from "@lib/logging";
import { getOmtDir } from "@lib/omt-dir";

import {
	type JobConfig,
	type SpawnedWorker,
	type OrphanJob,
	assertMembersOrExit,
	assertDenyEnforceable,
	assertDenyShape,
	assertMcpAllowShape,
	extractDenySkills,
	extractDenySubagents,
	prepareMcpEntities,
	detectCliType,
	buildAugmentedCommand,
	gcStaleJobs as _gcStaleJobs,
	computeStatus as _computeStatus,
	buildUiPayload as _buildUiPayload,
	spawnWorkers as _spawnWorkers,
	cmdResults as _cmdResults,
	cmdStop as _cmdStop,
	cmdClean as _cmdClean,
	cmdCollect as _cmdCollect,
	buildManifest as _buildManifest,
	cmdResumeMember as _cmdResumeMember,
	reapOrphanJobs,
	doctorOrphanJobs,
} from "@lib/generic-job";

export { cmdResumeMember } from "@lib/generic-job";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = import.meta.dirname;
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const WORKER_PATH = path.join(SCRIPT_DIR, "worker.ts");

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, "orchestrate-review.config.yaml");
const REPO_CONFIG_FILE = path.join(PROJECT_ROOT, "orchestrate-review.config.yaml");

const DEFAULT_JOBS_DIR = process.env.CHUNK_REVIEW_JOBS_DIR || path.join(getOmtDir(), "jobs");

// ---------------------------------------------------------------------------
// JobConfig for chunk-review
// ---------------------------------------------------------------------------

const CHUNK_REVIEW_JOB_CONFIG: JobConfig = {
	entitySingular: "member",
	entityPlural: "members",
	entityDirName: "members",
	jobPrefix: "chunk-review-",
	uiLabel: "[Chunk Review]",
	configTopLevelKey: "chunk-review",
};

// ---------------------------------------------------------------------------
// Chunk-review custom boolean flags for parseArgs
// ---------------------------------------------------------------------------

const CHUNK_REVIEW_BOOLEAN_FLAGS = new Set([
	"json",
	"text",
	"checklist",
	"help",
	"h",
	"verbose",
	"manifest",
	"include-chairman",
	"exclude-chairman",
	"stdin",
	"blocking",
	"force",
]);

// ---------------------------------------------------------------------------
// Type-narrowing helpers — parseArgs/YAML values arrive as unknown; these
// convert without an `as` assertion (consistent-type-assertions: 'never').
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function resolveConductorSessionId(): string | null {
	const omtSessionId = process.env.OMT_SESSION_ID;
	const codexThreadId = process.env.CODEX_THREAD_ID;
	const isSafeSessionId = (id: string) =>
		id.length >= 1 && id.length <= 200 && /^[A-Za-z0-9_-]+$/.test(id);

	if (omtSessionId !== undefined && codexThreadId !== undefined && omtSessionId !== codexThreadId) {
		return null;
	}
	if (omtSessionId !== undefined) return isSafeSessionId(omtSessionId) ? omtSessionId : null;
	if (codexThreadId !== undefined) return isSafeSessionId(codexThreadId) ? codexThreadId : null;
	return null;
}

// ---------------------------------------------------------------------------
// Wrapper functions — pre-apply CHUNK_REVIEW_JOB_CONFIG for test compatibility
// ---------------------------------------------------------------------------

function safeFileName(name: string, fallback?: string): string {
	return _safeFileName(name, fallback || "member");
}

function gcStaleJobs(jobsDir: string): void {
	_gcStaleJobs(jobsDir, CHUNK_REVIEW_JOB_CONFIG);
}

async function computeStatus(jobDir: string) {
	return _computeStatus(jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function buildUiPayload(statusPayload: Parameters<typeof _buildUiPayload>[0]) {
	return _buildUiPayload(statusPayload, CHUNK_REVIEW_JOB_CONFIG);
}

function buildManifest(jobDir: string) {
	return _buildManifest(jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

// ---------------------------------------------------------------------------
// Logging helper for non-start commands (extract jobId from jobDir path)
// ---------------------------------------------------------------------------

function initLoggerFromJobDir(jobDir: string): void {
	const resolved = path.resolve(jobDir);
	const jobId = path.basename(resolved).replace(/^chunk-review-/, "");
	initLogger("chunk-review-job", logRootForJobsDir(path.dirname(resolved)), jobId);
}

// ---------------------------------------------------------------------------
// Command implementations (chunk-review-specific with logging)
// ---------------------------------------------------------------------------

async function cmdStatus(options: Record<string, unknown>, jobDir: string): Promise<void> {
	initLoggerFromJobDir(jobDir);
	logInfo(`status: ${path.resolve(jobDir)}`);
	const payload = await computeStatus(jobDir);

	const wantChecklist = Boolean(options.checklist) && !options.json;
	if (wantChecklist) {
		const done = computeTerminalDoneCount(payload.counts);
		const headerId = payload.id ? ` (${payload.id})` : "";
		process.stdout.write(`Chunk Review${headerId}\n`);
		process.stdout.write(
			`Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`,
		);
		for (const r of payload.members) {
			const state = String(r.state || "");
			const mark =
				state === "done"
					? "[x]"
					: state === "running" || state === "queued"
						? "[ ]"
						: state
							? "[!]"
							: "[ ]";
			const exitInfo =
				r.exitCode !== null && r.exitCode !== undefined ? ` (exit ${r.exitCode})` : "";
			process.stdout.write(`${mark} ${r.member} \u2014 ${state}${exitInfo}\n`);
		}
		return;
	}

	const wantText = Boolean(options.text) && !options.json;
	if (wantText) {
		const done = computeTerminalDoneCount(payload.counts);
		process.stdout.write(
			`members ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`,
		);
		if (options.verbose) {
			for (const r of payload.members) {
				process.stdout.write(
					`- ${r.member}: ${r.state}${r.exitCode !== null && r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}\n`,
				);
			}
		}
		return;
	}

	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function cmdResults(options: Record<string, unknown>, jobDir: string): void {
	initLoggerFromJobDir(jobDir);
	logInfo(`results: ${path.resolve(jobDir)}`);
	_cmdResults(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

/**
 * Per-member wall-clock, emitted after each collect returns.
 *
 * Members run in parallel, so a chunk costs max(member), not the sum — without
 * this line nothing records which angle set that max, and the per-member
 * artifacts are gone once the job is cleaned.
 *
 * Elapsed is measured from the job's own `createdAt`, not from a per-member
 * start: a terminal status.json carries `finishedAt` but no `startedAt` (the
 * running-state write that sets it is replaced wholesale when the member
 * finishes). `createdAt` is an accurate common origin because every member is
 * spawned in the same pass — measured at 3ms of spawn spread.
 */
function logMemberDurations(jobDir: string): void {
	const resolved = path.resolve(jobDir);
	const membersDir = path.join(resolved, CHUNK_REVIEW_JOB_CONFIG.entityDirName);

	let names: string[];
	let origin: number;
	try {
		names = fs.readdirSync(membersDir).sort();
		const jobMeta = JSON.parse(fs.readFileSync(path.join(resolved, "job.json"), "utf8"));
		origin = Date.parse(String(jobMeta.createdAt));
	} catch {
		return;
	}
	if (!Number.isFinite(origin)) return;

	const parts = names.map((name) => {
		try {
			const status = JSON.parse(
				fs.readFileSync(path.join(membersDir, name, "status.json"), "utf8"),
			);
			const finished = Date.parse(String(status.finishedAt));
			return Number.isFinite(finished)
				? `${name}=${Math.round((finished - origin) / 1000)}s`
				: `${name}=${status.state || "unknown"}`;
		} catch {
			return `${name}=unreadable`;
		}
	});

	if (parts.length > 0) {
		logInfo(`member durations: ${parts.join(" ")}`);
	}
}

async function cmdCollect(options: Record<string, unknown>, jobDir: string): Promise<void> {
	initLoggerFromJobDir(jobDir);
	logInfo(`collect: ${path.resolve(jobDir)}`);
	await _cmdCollect(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
	logMemberDurations(jobDir);
}

async function cmdStop(options: Record<string, unknown>, jobDir: string): Promise<void> {
	initLoggerFromJobDir(jobDir);
	logInfo(`stop: ${path.resolve(jobDir)}`);
	await _cmdStop(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function cmdClean(options: Record<string, unknown>, jobDir: string): void {
	initLoggerFromJobDir(jobDir);
	logInfo(`clean: ${path.resolve(jobDir)}`);
	const configuredJobsDir = path.resolve(
		optionalString(options["jobs-dir"]) || process.env.CHUNK_REVIEW_JOBS_DIR || DEFAULT_JOBS_DIR,
	);
	_cmdClean(options, jobDir, CHUNK_REVIEW_JOB_CONFIG, configuredJobsDir);
}

// ---------------------------------------------------------------------------
// Chunk-review-specific config parsing
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile(): string {
	if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
	if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
	return SKILL_CONFIG_FILE;
}

interface ChunkReviewSection {
	chairman: Record<string, unknown>;
	members: unknown[];
	settings: Record<string, unknown>;
}

interface ChunkReviewConfig {
	"chunk-review": ChunkReviewSection;
}

function parseChunkReviewConfig(configPath: string): ChunkReviewConfig {
	const fallback: ChunkReviewConfig = {
		"chunk-review": {
			chairman: { role: "auto" },
			members: [
				{ name: "claude", command: "claude -p", emoji: "\u{1F9E0}", color: "CYAN" },
				{ name: "codex", command: "codex exec", emoji: "\u{1F916}", color: "BLUE" },
			],
			settings: { exclude_chairman_from_members: true, timeout: 300 },
		},
	};

	if (!fs.existsSync(configPath)) return fallback;

	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(fs.readFileSync(configPath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		exitWithError(`Invalid YAML in ${configPath}: ${message}`);
	}

	if (!isRecord(parsed)) {
		exitWithError(
			`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`,
		);
	}
	const chunkReviewRaw = parsed["chunk-review"];
	if (!chunkReviewRaw) {
		exitWithError(
			`Invalid config in ${configPath}: missing required top-level key 'chunk-review:'`,
		);
	}
	if (!isRecord(chunkReviewRaw)) {
		exitWithError(`Invalid config in ${configPath}: 'chunk-review' must be a mapping/object`);
	}

	const merged: ChunkReviewConfig = {
		"chunk-review": {
			chairman: { ...fallback["chunk-review"].chairman },
			members: Array.isArray(fallback["chunk-review"].members)
				? [...fallback["chunk-review"].members]
				: [],
			settings: { ...fallback["chunk-review"].settings },
		},
	};

	const chunkReview = chunkReviewRaw;

	if (chunkReview.chairman !== null && chunkReview.chairman !== undefined) {
		if (!isRecord(chunkReview.chairman)) {
			exitWithError(
				`Invalid config in ${configPath}: 'chunk-review.chairman' must be a mapping/object`,
			);
		}
		merged["chunk-review"].chairman = {
			...merged["chunk-review"].chairman,
			...chunkReview.chairman,
		};
	}

	if (Object.prototype.hasOwnProperty.call(chunkReview, "members")) {
		if (!Array.isArray(chunkReview.members)) {
			exitWithError(`Invalid config in ${configPath}: 'chunk-review.members' must be a list/array`);
		}
		merged["chunk-review"].members = chunkReview.members;
	}

	if (chunkReview.settings !== null && chunkReview.settings !== undefined) {
		if (!isRecord(chunkReview.settings)) {
			exitWithError(
				`Invalid config in ${configPath}: 'chunk-review.settings' must be a mapping/object`,
			);
		}
		merged["chunk-review"].settings = {
			...merged["chunk-review"].settings,
			...chunkReview.settings,
		};
	}

	assertDenyShape(merged["chunk-review"].settings, CHUNK_REVIEW_JOB_CONFIG, configPath);
	assertMcpAllowShape(merged["chunk-review"].settings, CHUNK_REVIEW_JOB_CONFIG, configPath);

	return merged;
}

// ---------------------------------------------------------------------------
// jobsDir resolution — shared by start/reap/doctor so the 3-tier fallback
// (--jobs-dir option → CHUNK_REVIEW_JOBS_DIR env var → default under
// getOmtDir()) can never drift into disagreement between the command that
// writes job.json's workerPgid anchor and the commands that read it back.
// ---------------------------------------------------------------------------

function resolveJobsDir(options: Record<string, unknown>): string {
	return (
		optionalString(options["jobs-dir"]) ||
		process.env.CHUNK_REVIEW_JOBS_DIR ||
		path.join(getOmtDir(), "jobs")
	);
}

// ---------------------------------------------------------------------------
// Chunk-review-specific start command
// ---------------------------------------------------------------------------

function printHelp(): void {
	process.stdout.write(`Chunk Review (job mode)

Usage:
  job.ts start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  job.ts start --stdin
  job.ts status [--json|--text|--checklist] [--verbose] <jobDir>
  job.ts collect [--timeout-ms N] <jobDir>
  job.ts results [--json|--manifest] <jobDir>
  job.ts stop <jobDir>
  job.ts clean <jobDir>
  job.ts reap [--jobs-dir path] [--grace-ms N]
  job.ts doctor [--jobs-dir path] [--json]

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - reap kills orphaned job process groups (SIGTERM then SIGKILL); all its output goes to
    stderr — stdout is always empty, since a SessionStart hook calls it and must not vary
  - doctor reports orphan counts on stdout without killing anything (diagnostic only)
`);
}

/** Probe only — never signals. `kill(-pgid, 0)` sends no signal; ESRCH means
 *  the group has no member left alive. Used solely to decide the reap log
 *  wording (reaped vs signalled) per orphan, since reapOrphanJobs' return
 *  value gives a flat survivingPids list with no per-job attribution. */
function isPgidGroupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Judges, per orphan job reapOrphanJobs already signalled, whether its
 *  process group actually died — the shared judgment both reap-triggering
 *  callers (cmdReap, and cmdStart's own reap-on-start step) need so neither
 *  claims "reaped" for a group that in fact survived the kill. Returns
 *  structured verdicts only; each caller decides its own phrasing and output
 *  channel (cmdReap: one stderr line per job; cmdStart: one aggregate
 *  logInfo line) — the same split this repo's hooks/ core/adapter files use
 *  (judgment shared, output envelope per caller). */
function classifyReapedOrphans(
	reaped: OrphanJob[],
): Array<{ jobDir: string; pgids: number[]; survived: boolean }> {
	return reaped.map((orphan) => ({
		jobDir: orphan.jobDir,
		pgids: orphan.pgids,
		survived: orphan.pgids.some((pgid) => isPgidGroupAlive(pgid)),
	}));
}

interface ChunkReviewIdentity {
	reviewId: string;
	chunkKey: string;
	attempt: number;
	worktreeRealpath: string;
	baseSha: string;
	headSha: string;
	diffFingerprint: string;
}

const IDENTITY_FIELDS: Array<keyof ChunkReviewIdentity> = [
	"reviewId",
	"chunkKey",
	"attempt",
	"worktreeRealpath",
	"baseSha",
	"headSha",
	"diffFingerprint",
];

type ChunkReviewIdentityResult =
	| { kind: "none" }
	| { kind: "invalid"; missing: string[] }
	| { kind: "complete"; identity: ChunkReviewIdentity };

function readChunkReviewIdentity(options: Record<string, unknown>): ChunkReviewIdentityResult {
	const identityContainerPresent = Object.prototype.hasOwnProperty.call(options, "identity");
	const reviewIdentityContainerPresent = Object.prototype.hasOwnProperty.call(
		options,
		"reviewIdentity",
	);
	if (
		(identityContainerPresent && !isRecord(options.identity)) ||
		(reviewIdentityContainerPresent && !isRecord(options.reviewIdentity))
	) {
		return { kind: "invalid", missing: ["identity"] };
	}
	if (identityContainerPresent && reviewIdentityContainerPresent)
		return { kind: "invalid", missing: ["identity"] };
	let source: Record<string, unknown> = options;
	if (identityContainerPresent && isRecord(options.identity)) source = options.identity;
	else if (reviewIdentityContainerPresent && isRecord(options.reviewIdentity))
		source = options.reviewIdentity;
	const aliases: Record<keyof ChunkReviewIdentity, string[]> = {
		reviewId: ["reviewId", "review-id", "review_id"],
		chunkKey: ["chunkKey", "chunk-key", "chunk_key"],
		attempt: ["attempt"],
		worktreeRealpath: ["worktreeRealpath", "worktree-realpath", "worktree_realpath"],
		baseSha: ["baseSha", "base-sha", "base_sha"],
		headSha: ["headSha", "head-sha", "head_sha"],
		diffFingerprint: ["diffFingerprint", "diff-fingerprint", "diff_fingerprint"],
	};
	const present = (names: string[]) =>
		names.some((name) => Object.prototype.hasOwnProperty.call(source, name));
	const read = (names: string[]) =>
		names.find((name) => Object.prototype.hasOwnProperty.call(source, name));
	const value = (names: string[]) => {
		const key = read(names);
		return key === undefined ? undefined : source[key];
	};
	const reviewId = optionalString(value(aliases.reviewId));
	const chunkKey = optionalString(value(aliases.chunkKey));
	const attemptValue = value(aliases.attempt);
	const attemptNumber =
		typeof attemptValue === "string" && attemptValue.trim() !== ""
			? Number(attemptValue)
			: attemptValue;
	const attempt =
		typeof attemptNumber === "number" && Number.isFinite(attemptNumber) ? attemptNumber : undefined;
	const worktreeRealpath = optionalString(value(aliases.worktreeRealpath));
	const baseSha = optionalString(value(aliases.baseSha));
	const headSha = optionalString(value(aliases.headSha));
	const diffFingerprint = optionalString(value(aliases.diffFingerprint));
	const anyPresent = IDENTITY_FIELDS.some((field) => present(aliases[field]));
	if (!anyPresent && !identityContainerPresent && !reviewIdentityContainerPresent) {
		return { kind: "none" };
	}
	const values = {
		reviewId,
		chunkKey,
		attempt,
		worktreeRealpath,
		baseSha,
		headSha,
		diffFingerprint,
	};
	const missing = IDENTITY_FIELDS.filter(
		(field) => values[field] === undefined || !present(aliases[field]),
	);
	if (missing.length > 0) {
		return { kind: "invalid", missing };
	}
	if (
		reviewId === undefined ||
		chunkKey === undefined ||
		attempt === undefined ||
		worktreeRealpath === undefined ||
		baseSha === undefined ||
		headSha === undefined ||
		diffFingerprint === undefined
	) {
		return {
			kind: "invalid",
			missing: IDENTITY_FIELDS.filter((field) => values[field] === undefined),
		};
	}
	return {
		kind: "complete",
		identity: { reviewId, chunkKey, attempt, worktreeRealpath, baseSha, headSha, diffFingerprint },
	};
}

const IDENTITY_LOCK_STALE_MS = 10 * 60 * 1000;
const configuredIdentityDeadline = Number(process.env.CHUNK_REVIEW_IDENTITY_LOCK_DEADLINE_MS);
const IDENTITY_LOCK_DEADLINE_MS =
	Number.isFinite(configuredIdentityDeadline) && configuredIdentityDeadline >= 100
		? configuredIdentityDeadline
		: 45 * 1000;

function identityLockPath(jobsDir: string, identity: ChunkReviewIdentity): string {
	const stable = IDENTITY_FIELDS.map((field) => `${field}=${JSON.stringify(identity[field])}`).join(
		"\n",
	);
	const digest = createHash("sha256").update(stable).digest("hex");
	return path.join(jobsDir, `.chunk-review-identity-${digest}.lock`);
}

async function acquireIdentityClaim(
	jobsDir: string,
	identity: ChunkReviewIdentity,
): Promise<
	| { fd: number; lockPath: string }
	| { existing: { jobDir: string; metadata: Record<string, unknown> } }
> {
	const lockPath = identityLockPath(jobsDir, identity);
	const deadline = Date.now() + IDENTITY_LOCK_DEADLINE_MS;
	for (;;) {
		try {
			const fd = fs.openSync(lockPath, "wx");
			try {
				fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
				const existing = findExistingJobForIdentity(jobsDir, identity);
				if (existing) {
					fs.closeSync(fd);
					fs.unlinkSync(lockPath);
					return { existing };
				}
				return { fd, lockPath };
			} catch (error) {
				try {
					fs.closeSync(fd);
				} catch {
					// Best-effort close before propagating the original acquisition error.
				}
				try {
					fs.unlinkSync(lockPath);
				} catch {
					// Best-effort unlink prevents a failed claim from blocking future starts.
				}
				throw error;
			}
		} catch (error) {
			if (!(error instanceof Error) || !String(error.message).includes("EEXIST")) throw error;
			if (!fs.existsSync(lockPath)) continue;
			try {
				const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
				const createdAt = typeof lock.createdAt === "number" ? lock.createdAt : NaN;
				const pid = typeof lock.pid === "number" ? lock.pid : NaN;
				const stale = Number.isFinite(createdAt) && Date.now() - createdAt > IDENTITY_LOCK_STALE_MS;
				let alive = true;
				try {
					if (Number.isFinite(pid)) process.kill(pid, 0);
					else alive = true;
				} catch {
					alive = false;
				}
				if (stale && !alive) {
					try {
						fs.unlinkSync(lockPath);
					} catch {
						// Another contender may have reclaimed the lock first.
					}
					continue;
				}
			} catch {
				// A process can die after creating the lock but before its JSON write completes.
				// Such a lock has no usable owner PID, so reclaim only after the same stale
				// window, using filesystem mtime as the durable creation-time fallback.
				try {
					const stale = Date.now() - fs.statSync(lockPath).mtimeMs > IDENTITY_LOCK_STALE_MS;
					if (stale) {
						try {
							fs.unlinkSync(lockPath);
						} catch {
							// Another contender may have reclaimed the malformed lock first.
						}
						continue;
					}
				} catch {
					// The lock disappeared or cannot be inspected; retry until the bounded deadline.
				}
			}
			if (Date.now() >= deadline)
				throw new Error(`identity claim timeout: ${lockPath}`, { cause: error });
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

function findExistingJobForIdentity(
	jobsDir: string,
	identity: ChunkReviewIdentity,
): { jobDir: string; metadata: Record<string, unknown> } | undefined {
	let entries: string[];
	try {
		entries = fs.readdirSync(jobsDir);
	} catch {
		return undefined;
	}
	for (const entry of entries.sort()) {
		if (!entry.startsWith("chunk-review-")) continue;
		const jobDir = path.join(jobsDir, entry);
		let metadata: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));
			if (!isRecord(parsed)) continue;
			metadata = parsed;
		} catch {
			// Incomplete/crashed metadata cannot be adopted.
			continue;
		}
		const persistedIdentity = isRecord(metadata.identity)
			? metadata.identity
			: isRecord(metadata.reviewIdentity)
				? metadata.reviewIdentity
				: undefined;
		if (
			persistedIdentity &&
			IDENTITY_FIELDS.every((field) => persistedIdentity[field] === identity[field])
		) {
			if (metadata.state === "initializing")
				throw new Error(`identity job is still initializing: ${jobDir}`);
			if (metadata.state === "ready") return { jobDir, metadata };
		}
	}
	return undefined;
}

async function cmdReap(options: Record<string, unknown>): Promise<void> {
	const jobsDir = resolveJobsDir(options);
	const graceMs = optionalNumber(options["grace-ms"]);
	const { reaped } = await reapOrphanJobs(
		jobsDir,
		CHUNK_REVIEW_JOB_CONFIG,
		graceMs !== undefined ? { graceMs } : {},
	);
	// stdout MUST stay empty — see the Usage note above and the file-level
	// cache-safe context-injection rule (CLAUDE.md) this exists to satisfy.
	// Every diagnostic, including reapOrphanJobs' own surviving-PID report,
	// goes to stderr only.
	for (const verdict of classifyReapedOrphans(reaped)) {
		// reapOrphanJobs already wrote its own "N process(es) survived group
		// kill" line above for whatever didn't die — if this orphan's own pgid
		// is one of them, don't also claim "reaped" here, or the same stderr
		// stream carries two contradictory lines for the same process group.
		if (verdict.survived) {
			process.stderr.write(
				`reap: signalled orphan job ${verdict.jobDir} (pgids: ${verdict.pgids.join(", ")}) — some process(es) survived the group kill, see above\n`,
			);
		} else {
			process.stderr.write(
				`reap: reaped orphan job ${verdict.jobDir} (pgids: ${verdict.pgids.join(", ")})\n`,
			);
		}
	}
	if (reaped.length === 0) {
		process.stderr.write("reap: no orphan jobs found\n");
	}
}

function cmdDoctor(options: Record<string, unknown>): void {
	const jobsDir = resolveJobsDir(options);
	const { orphanJobCount, orphanPgidCount, orphans } = doctorOrphanJobs(
		jobsDir,
		CHUNK_REVIEW_JOB_CONFIG,
	);
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ orphanJobCount, orphanPgidCount, orphans }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(
		`orphan jobs: ${orphanJobCount}, orphan process groups: ${orphanPgidCount}\n`,
	);
	for (const orphan of orphans) {
		process.stdout.write(`  ${orphan.jobDir} (pgids: ${orphan.pgids.join(", ")})\n`);
	}
}

async function cmdStart(options: Record<string, unknown>, prompt: string): Promise<void> {
	const configPath =
		optionalString(options.config) || process.env.CHUNK_REVIEW_CONFIG || resolveDefaultConfigFile();
	const jobsDir = resolveJobsDir(options);

	ensureDir(jobsDir);
	const identityResult = readChunkReviewIdentity(options);
	if (identityResult.kind === "invalid")
		exitWithError(`start: incomplete identity (missing: ${identityResult.missing.join(", ")})`);
	const identity = identityResult.kind === "complete" ? identityResult.identity : undefined;
	let identityClaim: { fd: number; lockPath: string } | undefined;
	if (identity) {
		const claim = await acquireIdentityClaim(jobsDir, identity);
		if ("existing" in claim) {
			if (options.json)
				process.stdout.write(
					`${JSON.stringify({ jobDir: claim.existing.jobDir, ...claim.existing.metadata }, null, 2)}\n`,
				);
			else process.stdout.write(`${claim.existing.jobDir}\n`);
			return;
		}
		identityClaim = claim;
	}
	let createdJobDir: string | undefined;
	let startCompleted = false;
	let spawnAttempted = false;
	try {
		// Reap orphaned job process groups BEFORE gcStaleJobs, not after — the other
		// trigger besides the SessionStart hook (next task), so an orphan gets swept
		// up whether the user re-runs a review or opens a new session. gcStaleJobs
		// deletes any job.json older than GC_MAX_AGE_MS with no liveness check at
		// all (lib/generic-job.ts), and job.json is the only ownership anchor every
		// reap layer depends on — running gc first would delete that anchor out from
		// under a still-alive orphan (a dead conductor's job.json ages past the
		// 1-hour mark while its codex-exec descendants are still running), making
		// the orphan unreachable by every layer until the next reboot. graceMs: 0 —
		// job start must never be delayed by the normal SIGTERM→SIGKILL grace wait
		// (REAP_GRACE_MS_DEFAULT is 5s): a group findOrphanJobs already judged
		// orphaned (alive PGID, zero live progress) has nothing left worth waiting
		// on before SIGKILL.
		const { reaped: reapedOrphans, survivingPids } = await reapOrphanJobs(
			jobsDir,
			CHUNK_REVIEW_JOB_CONFIG,
			{
				graceMs: 0,
			},
		);
		gcStaleJobs(jobsDir);

		const hostRole = detectHostRole(SKILL_DIR);
		const config = parseChunkReviewConfig(configPath);
		const chairmanRoleRaw =
			optionalString(options.chairman) ||
			process.env.CHUNK_REVIEW_CHAIRMAN ||
			optionalString(config["chunk-review"].chairman.role) ||
			"auto";

		// Pre-normalize via the same normalizeBool the framework applies internally, so passing an
		// already-normalized boolean|null through is idempotent (identical outcome for every input shape)
		// while satisfying resolveChairmanExclusion's `boolean | null | undefined` parameter type.
		const rawExcludeSetting = config["chunk-review"].settings.exclude_chairman_from_members;
		const configExcludeSetting: boolean | null | undefined =
			typeof rawExcludeSetting === "boolean" ? rawExcludeSetting : normalizeBool(rawExcludeSetting);

		const { chairmanRole, excludeChairmanFromMembers, filterMember } = resolveChairmanExclusion({
			options,
			configExcludeSetting,
			hostRole,
			chairmanRoleRaw,
		});

		const timeoutSetting = Number(config["chunk-review"].settings.timeout || 0);
		const timeoutOverride =
			options.timeout !== null && options.timeout !== undefined ? Number(options.timeout) : null;
		const timeoutSec =
			timeoutOverride !== null && Number.isFinite(timeoutOverride) && timeoutOverride > 0
				? timeoutOverride
				: timeoutSetting > 0
					? timeoutSetting
					: 0;

		const requestedMembers = config["chunk-review"].members || [];
		const members = requestedMembers.filter(isRecord).filter(filterMember);

		assertMembersOrExit(members, CHUNK_REVIEW_JOB_CONFIG, configPath);

		const denySkills = extractDenySkills(config["chunk-review"].settings);
		const denySubagents = extractDenySubagents(config["chunk-review"].settings);
		assertDenyEnforceable(members, denySkills, CHUNK_REVIEW_JOB_CONFIG, configPath, denySubagents);

		const conductorCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
		const memberEntities = members.map((r) => ({
			...r,
			deny: denySkills,
			denySubagents,
		}));
		const preparedMembers = prepareMcpEntities(
			config["chunk-review"].settings,
			memberEntities,
			CHUNK_REVIEW_JOB_CONFIG,
			configPath,
			conductorCodexHome,
		);

		const jobId = generateJobId();
		initLogger("chunk-review-job", logRootForJobsDir(jobsDir), jobId);
		logStart();
		logInfo(`GC: stale jobs cleaned`);
		// Mirrors cmdReap's own reaped-vs-survived distinction (classifyReapedOrphans)
		// — this trigger runs on every review start, so an unconditional "reaped"
		// claim here would go stale far more often than cmdReap's own SessionStart
		// trigger. Never claim "reaped" for a group that in fact survived the kill.
		const reapedOrphanVerdicts = classifyReapedOrphans(reapedOrphans);
		const anyOrphanSurvived = reapedOrphanVerdicts.some((v) => v.survived);
		logInfo(
			anyOrphanSurvived
				? `reap: ${reapedOrphanVerdicts.length} orphan job(s) signalled — ${survivingPids.length} process(es) survived the group kill`
				: `reap: ${reapedOrphans.length} orphan job(s) reaped`,
		);
		logInfo(`config: ${configPath}, chairman: ${chairmanRole}, members: ${members.length}`);

		const jobDir = path.join(jobsDir, `chunk-review-${jobId}`);
		createdJobDir = jobDir;
		const membersDir = path.join(jobDir, "members");
		ensureDir(membersDir);
		const conductorSessionId = resolveConductorSessionId();

		fs.writeFileSync(path.join(jobDir, "prompt.txt"), String(prompt), "utf8");

		// workerPgid는 스폰 전이라 아직 없다(null) — 스폰 후 members가 채워진다(하단
		// 참고). 함수 반환 타입 애노테이션을 거치는 이유: 리터럴 null을 그냥 쓰거나
		// `const x: number | null = null`으로 변수에 담아 써도 TS는 그 지점의 값을
		// 여전히 리터럴 null로 좁혀 추론해, 아래 재할당(workerPgidByName.get(...)
		// ?? null)과 타입이 맞지 않는다 — 함수 호출식의 타입은 선언된 반환 타입
		// 그대로 쓰이므로 좁혀지지 않는다. 타입 단언(as) 없이 타입을 넓히는 방법.
		function unsetWorkerPgid(): number | null {
			return null;
		}
		// Same widening trick as unsetWorkerPgid above, for the spawn-time witness
		// (`ps -o lstart=`) recorded alongside workerPgid — see lib/generic-job.ts's
		// judgePgidSignal for why the reaper needs this to tell "still our worker"
		// apart from "this PGID number is merely alive" (PID/PGID reuse).
		function unsetWorkerPgidStartedAt(): string | null {
			return null;
		}
		const jobMeta = {
			id: `chunk-review-${jobId}`,
			createdAt: new Date().toISOString(),
			conductorSessionId,
			configPath,
			hostRole,
			chairmanRole,
			settings: {
				excludeChairmanFromMembers,
				timeoutSec: timeoutSec || null,
				denySkills,
				denySubagents,
			},
			...(identity ? { identity } : {}),
			state: identity ? "initializing" : undefined,
			members: members.map((r, i) => ({
				name: String(r.name),
				command: String(r.command),
				emoji: r.emoji ? String(r.emoji) : null,
				color: r.color ? String(r.color) : null,
				model: r.model || null,
				effort_level: r.effort_level || null,
				output_format: r.output_format || null,
				env: r.env ?? {},
				mcpBlock: preparedMembers[i].mcpBlock,
				workerPgid: unsetWorkerPgid(),
				workerPgidStartedAt: unsetWorkerPgidStartedAt(),
			})),
		};
		atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);

		let spawned: SpawnedWorker[] = [];
		try {
			spawned = _spawnWorkers({
				entities: preparedMembers,
				workerPath: WORKER_PATH,
				jobDir,
				entitiesDir: membersDir,
				timeoutSec,
				config: CHUNK_REVIEW_JOB_CONFIG,
			});
			spawnAttempted = spawned.length > 0;
		} catch (error) {
			// spawnWorkers validates all names before creating member directories. An
			// empty directory therefore proves no worker launch began; once any member
			// state exists, retain the identity anchor for conservative recovery.
			spawnAttempted = fs.readdirSync(membersDir).length > 0;
			throw error;
		}
		logInfo(`workers spawned: ${members.map((r) => String(r.name)).join(", ")}`);

		const workerPgidByName = new Map(spawned.map((w) => [w.name, w.workerPgid]));
		const workerPgidStartedAtByName = new Map(spawned.map((w) => [w.name, w.workerPgidStartedAt]));
		jobMeta.members = jobMeta.members.map((m) => ({
			...m,
			workerPgid: workerPgidByName.get(m.name) ?? null,
			workerPgidStartedAt: workerPgidStartedAtByName.get(m.name) ?? null,
		}));
		if (identity) {
			jobMeta.state = "ready";
			atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);
		} else {
			atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);
		}
		if (options.json) {
			process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
		} else {
			process.stdout.write(`${jobDir}\n`);
		}
		logEnd();
		startCompleted = true;
	} finally {
		if (!startCompleted && !spawnAttempted && createdJobDir && identity) {
			try {
				fs.rmSync(createdJobDir, { recursive: true, force: true });
			} catch {
				// Cleanup is best effort; the original start failure remains authoritative.
			}
		}
		if (identityClaim) {
			try {
				fs.closeSync(identityClaim.fd);
			} catch {
				// The descriptor may already be closed after an earlier failure.
			}
			try {
				fs.unlinkSync(identityClaim.lockPath);
			} catch {
				// The lock may already have been removed by a competing cleanup.
			}
		}
	}
}

// ---------------------------------------------------------------------------
// resume-member: implemented in @lib/generic-job (cmdResumeMember)
// re-exported for backward compat via `export { cmdResumeMember } from '@lib/generic-job'`
// (see import block above)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const options = parseArgs(process.argv, CHUNK_REVIEW_BOOLEAN_FLAGS);
	const [command, ...rest] = options._;

	if (!command || options.help || options.h) {
		printHelp();
		return;
	}

	if (command === "start") {
		let prompt: string;
		if (options["prompt-file"]) {
			const filePath = String(options["prompt-file"]);
			try {
				prompt = fs.readFileSync(filePath, "utf8");
			} catch {
				exitWithError(`start: cannot read --prompt-file: ${filePath}`);
			}
		} else if (options.stdin) {
			prompt = fs.readFileSync(0, "utf8");
		} else {
			prompt = rest.join(" ").trim();
		}
		if (!prompt) exitWithError("start: missing prompt");
		await cmdStart(options, prompt);
		return;
	}
	if (command === "status") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("status: missing jobDir");
		await cmdStatus(options, jobDir);
		return;
	}
	if (command === "collect") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("collect: missing jobDir");
		await cmdCollect(options, jobDir);
		return;
	}
	if (command === "results") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("results: missing jobDir");
		cmdResults(options, jobDir);
		return;
	}
	if (command === "stop") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("stop: missing jobDir");
		await cmdStop(options, jobDir);
		return;
	}
	if (command === "clean") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("clean: missing jobDir");
		cmdClean(options, jobDir);
		return;
	}
	if (command === "reap") {
		await cmdReap(options);
		return;
	}
	if (command === "doctor") {
		cmdDoctor(options);
		return;
	}
	if (command === "resume-member") {
		const jobDirArg = optionalString(options.job);
		if (!jobDirArg) exitWithError("--job required");
		const nameArg = optionalString(options.member);
		if (!nameArg) exitWithError("--member required");
		const promptArg = optionalString(options.prompt);
		if (!promptArg) exitWithError("--prompt required");
		try {
			await _cmdResumeMember(jobDirArg, nameArg, promptArg, CHUNK_REVIEW_JOB_CONFIG, {
				workerPath: WORKER_PATH,
			});
		} catch (e: unknown) {
			exitWithError(e instanceof Error ? e.message : String(e));
		}
		return;
	}

	exitWithError(`Unknown command: ${command}`);
}

if (import.meta.main) {
	main();
}

export {
	detectHostRole,
	normalizeBool,
	resolveAutoRole,
	ensureDir,
	atomicWriteJson,
	readJsonIfExists,
	sleepMs,
	computeTerminalDoneCount,
	asCodexStepStatus,
	parseArgs,
	parseWaitCursor,
	formatWaitCursor,
	resolveBucketSize,
	generateJobId,
} from "@lib/job-utils";

export { safeFileName };

export {
	buildUiPayload,
	buildManifest,
	parseChunkReviewConfig,
	computeStatus,
	detectCliType,
	buildAugmentedCommand,
	gcStaleJobs,
	cmdStart,
	cmdReap,
	cmdDoctor,
	resolveJobsDir,
	classifyReapedOrphans,
};

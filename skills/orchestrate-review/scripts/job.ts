#!/usr/bin/env bun

import fs from "fs";
import os from "os";
import path from "path";

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
} from "@lib/job-utils";

import { initLogger, logInfo, logStart, logEnd } from "@lib/logging";
import { getOmtDir } from "@lib/omt-dir";

import {
	type JobConfig,
	type SpawnedWorker,
	type OrphanJob,
	assertMembersOrExit,
	assertDenyEnforceable,
	assertDenySkillsShape,
	assertMcpAllowShape,
	extractDenySkills,
	enumerateConfiguredMcpServers,
	computeMcpBlockList,
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
	const jobId = path.basename(jobDir).replace(/^chunk-review-/, "");
	initLogger("chunk-review-job", getOmtDir(), jobId);
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

async function cmdCollect(options: Record<string, unknown>, jobDir: string): Promise<void> {
	initLoggerFromJobDir(jobDir);
	logInfo(`collect: ${path.resolve(jobDir)}`);
	await _cmdCollect(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function cmdStop(options: Record<string, unknown>, jobDir: string): void {
	initLoggerFromJobDir(jobDir);
	logInfo(`stop: ${path.resolve(jobDir)}`);
	_cmdStop(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
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

	assertDenySkillsShape(merged["chunk-review"].settings, CHUNK_REVIEW_JOB_CONFIG, configPath);
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
		process.stdout.write(`${JSON.stringify({ orphanJobCount, orphanPgidCount, orphans }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`orphan jobs: ${orphanJobCount}, orphan process groups: ${orphanPgidCount}\n`);
	for (const orphan of orphans) {
		process.stdout.write(`  ${orphan.jobDir} (pgids: ${orphan.pgids.join(", ")})\n`);
	}
}

async function cmdStart(options: Record<string, unknown>, prompt: string): Promise<void> {
	const configPath =
		optionalString(options.config) || process.env.CHUNK_REVIEW_CONFIG || resolveDefaultConfigFile();
	const jobsDir = resolveJobsDir(options);

	ensureDir(jobsDir);
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
	const { reaped: reapedOrphans } = await reapOrphanJobs(jobsDir, CHUNK_REVIEW_JOB_CONFIG, {
		graceMs: 0,
	});
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
	assertDenyEnforceable(members, denySkills, CHUNK_REVIEW_JOB_CONFIG, configPath);

	const configuredMcpServers = enumerateConfiguredMcpServers(
		process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
	);
	const mcpBlock = computeMcpBlockList(config["chunk-review"].settings, configuredMcpServers);

	const jobId = generateJobId();
	initLogger("chunk-review-job", getOmtDir(), jobId);
	logStart();
	logInfo(`GC: stale jobs cleaned`);
	// Mirrors cmdReap's own reaped-vs-survived distinction (classifyReapedOrphans)
	// — this trigger runs on every review start, so an unconditional "reaped"
	// claim here would go stale far more often than cmdReap's own SessionStart
	// trigger. Never claim "reaped" for a group that in fact survived the kill.
	const reapedOrphanVerdicts = classifyReapedOrphans(reapedOrphans);
	const survivedOrphanCount = reapedOrphanVerdicts.filter((v) => v.survived).length;
	logInfo(
		survivedOrphanCount > 0
			? `reap: ${reapedOrphanVerdicts.length} orphan job(s) signalled — ${survivedOrphanCount} process(es) survived the group kill`
			: `reap: ${reapedOrphans.length} orphan job(s) reaped`,
	);
	logInfo(`config: ${configPath}, chairman: ${chairmanRole}, members: ${members.length}`);

	const jobDir = path.join(jobsDir, `chunk-review-${jobId}`);
	const membersDir = path.join(jobDir, "members");
	ensureDir(membersDir);

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
		configPath,
		hostRole,
		chairmanRole,
		settings: {
			excludeChairmanFromMembers,
			timeoutSec: timeoutSec || null,
			denySkills,
			mcpBlock,
		},
		members: members.map((r) => ({
			name: String(r.name),
			command: String(r.command),
			emoji: r.emoji ? String(r.emoji) : null,
			color: r.color ? String(r.color) : null,
			model: r.model || null,
			effort_level: r.effort_level || null,
			output_format: r.output_format || null,
			env: r.env ?? {},
			workerPgid: unsetWorkerPgid(),
			workerPgidStartedAt: unsetWorkerPgidStartedAt(),
		})),
	};
	atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);

	const spawned: SpawnedWorker[] = _spawnWorkers({
		entities: members.map((r) => ({ ...r, deny: denySkills, mcpBlock })),
		workerPath: WORKER_PATH,
		jobDir,
		entitiesDir: membersDir,
		timeoutSec,
		config: CHUNK_REVIEW_JOB_CONFIG,
	});
	logInfo(`workers spawned: ${members.map((r) => String(r.name)).join(", ")}`);

	const workerPgidByName = new Map(spawned.map((w) => [w.name, w.workerPgid]));
	const workerPgidStartedAtByName = new Map(spawned.map((w) => [w.name, w.workerPgidStartedAt]));
	jobMeta.members = jobMeta.members.map((m) => ({
		...m,
		workerPgid: workerPgidByName.get(m.name) ?? null,
		workerPgidStartedAt: workerPgidStartedAtByName.get(m.name) ?? null,
	}));
	atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
	} else {
		process.stdout.write(`${jobDir}\n`);
	}
	logEnd();
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
		cmdStop(options, jobDir);
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
			await _cmdResumeMember(jobDirArg, nameArg, promptArg, CHUNK_REVIEW_JOB_CONFIG);
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

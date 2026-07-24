/**
 * Generic job orchestration framework.
 *
 * Extracted from scripts/chunk-review/job.ts (the most mature implementation).
 * All functions are parameterized via JobConfig for entity terminology, job prefix,
 * UI labels, and YAML config key.
 *
 * Consumers import initLogger directly from lib/logging.ts.
 * Shared primitives (atomicWriteJson, sleepMs, etc.) are imported from lib/job-utils.ts.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import {
	exitWithError,
	ensureDir,
	safeFileName as _safeFileName,
	atomicWriteJson,
	readJsonIfExists,
	sleepMs,
	computeTerminalDoneCount,
	asCodexStepStatus,
	parseWaitCursor,
	formatWaitCursor,
	resolveBucketSize,
	stripAnsi,
} from "./job-utils";

import { pickDriver, type CliType } from "./agent-drivers/types";
import {
	resumeOneTurn,
	runOnce,
	splitCommand,
	type RunOneTurnOpts,
	type OneTurnResult,
} from "./worker-utils";

// ---------------------------------------------------------------------------
// Internal narrowing helpers (not exported — safe to type precisely)
// ---------------------------------------------------------------------------

/** Narrow an unknown JSON-decoded value to a plain object for safe property access. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Parse a status/job-meta timestamp field to epoch ms; NaN for anything not string|number. */
function toEpochMs(value: unknown): number {
	return typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : NaN;
}

/** Narrow detectCliType's loose `string` result to the CliType union pickDriver expects. */
function isCliType(value: string): value is CliType {
	return (
		value === "opencode" ||
		value === "claude" ||
		value === "codex" ||
		value === "gemini" ||
		value === "unknown"
	);
}

// ---------------------------------------------------------------------------
// JobConfig type
// ---------------------------------------------------------------------------

export interface JobConfig {
	/** e.g. 'reviewer' or 'member' */
	entitySingular: string;
	/** e.g. 'reviewers' or 'members' */
	entityPlural: string;
	/** directory name under jobDir, e.g. 'reviewers' or 'members' */
	entityDirName: string;
	/** prefix for job directory names, e.g. 'chunk-review-' or 'council-' */
	jobPrefix: string;
	/** UI label prefix, e.g. '[Chunk Review]' or '[Council]' */
	uiLabel: string;
	/** top-level YAML key in config files, e.g. 'chunk-review' or 'council' */
	configTopLevelKey: string;
	/** optional feature flags for consumers */
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Hook interfaces for cmdResults / cmdWait extensibility
// ---------------------------------------------------------------------------

export interface CmdResultsHooks {
	/** Extra top-level fields to add to JSON output (e.g., specName, prompt) */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public hook signature (consumer-facing); narrowing would break existing hook implementations across consumers
	extraTopLevel?: (jobDir: string, jobMeta: any) => Record<string, unknown>;
	/** Extra per-member fields. Receives the raw member object (includes stderr, output, safeName, all status.json fields). */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public hook signature (consumer-facing); narrowing would break existing hook implementations across consumers
	extraMemberFields?: (rawMember: any) => Record<string, unknown>;
}

export interface CmdWaitHooks {
	/** Transform the wait payload before output (e.g., add specName) */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public hook signature (consumer-facing); narrowing would break existing hook implementations across consumers
	transformPayload?: (payload: any) => any;
	/** Override default timeout-ms (framework default: 600000). Set 0 for infinite. */
	defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// safeFileName wrapper (defaults to entitySingular fallback)
// ---------------------------------------------------------------------------

export function safeFileName(name: string, fallback: string = "member"): string {
	return _safeFileName(name, fallback);
}

// ---------------------------------------------------------------------------
// assertMembersOrExit — shared guard for "no members at job start"
// ---------------------------------------------------------------------------

export function assertMembersOrExit(
	members: unknown[],
	config: JobConfig,
	configPath: string,
): void {
	if (members.length === 0) {
		exitWithError(
			`start: no ${config.entityPlural} to dispatch — config has zero valid ${config.entityPlural}. config=${configPath}`,
		);
	}
}

// ---------------------------------------------------------------------------
// CLI detection & augmented command construction
// ---------------------------------------------------------------------------

const PACKAGE_RUNNERS = ["npx", "bunx", "pnpm", "yarn", "deno"];
const CLI_NAMES = ["claude", "gemini", "codex", "opencode"];

export function detectCliType(command: unknown): string {
	if (!command) return "unknown";
	const tokens = String(command).trim().split(/\s+/);
	if (CLI_NAMES.includes(tokens[0])) return tokens[0];
	if (PACKAGE_RUNNERS.includes(tokens[0])) {
		for (const token of tokens.slice(1, 3)) {
			if (CLI_NAMES.includes(token)) return token;
		}
	}
	return "unknown";
}

// ---------------------------------------------------------------------------
// assertDenyEnforceable — job-start gate: declared deny × per-member cliType.
// "선언가능 = 집행가능" invariant — a CLI with no invocation-scoped skill-deny
// lever (gemini, unknown) must not be allowed to silently ignore a declared
// deny. Reuses detectCliType's result; no new judgment logic.
// ---------------------------------------------------------------------------

const ENFORCEABLE_CLI_TYPES = ["codex", "claude", "opencode"];

export function assertDenyEnforceable(
	entities: unknown[],
	denySkills: string[] | undefined,
	config: JobConfig,
	configPath: string,
): void {
	const deny = denySkills ?? [];
	if (deny.length === 0) {
		process.stderr.write(
			`start: this job has no skill deny declared (settings.deny.skills is empty) — proceeding unguarded. config=${configPath}\n`,
		);
		return;
	}

	const violations: string[] = [];
	for (const entity of entities) {
		if (!isRecord(entity)) continue;
		const cliType = detectCliType(entity.command);
		if (!ENFORCEABLE_CLI_TYPES.includes(cliType)) {
			violations.push(`${String(entity.name)} (${cliType})`);
		}
	}

	if (violations.length > 0) {
		exitWithError(
			`start: settings.deny.skills is declared but the following ${config.entityPlural} use a CLI with no enforcement lever: ${violations.join(", ")}. ` +
				`Enforceable CLIs: ${ENFORCEABLE_CLI_TYPES.join(", ")}. ` +
				`Fix by either (1) replacing these ${config.entityPlural} with an enforceable CLI, or (2) removing this job's settings.deny.skills declaration. config=${configPath}`,
		);
	}
}

// ---------------------------------------------------------------------------
// assertDenySkillsShape / extractDenySkills — settings.deny.skills format
// validation + extraction, shared by every consumer's config parser. Deny is
// FORMAT-validated only — skill-name reality is not checked here (a later
// stage's assertDenyEnforceable covers reachability by reading the real
// YAML). No baseline deny list is injected here: YAML remains the sole
// source. Name characters are restricted to the class spawnWorkers already
// enforces on entity names ([a-zA-Z0-9_-]) — the same set splitCommand's
// re-tokenization can carry unmangled through the spawned CLI's argv.
// ---------------------------------------------------------------------------

/** Narrow to a plain object, excluding arrays (deny must be a mapping, not a list). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertDenySkillsShape(
	settings: Record<string, unknown>,
	config: JobConfig,
	configPath: string,
): void {
	const keyPrefix = config.configTopLevelKey;
	const deny = settings.deny;
	if (deny === null || deny === undefined) return;
	if (!isPlainObject(deny)) {
		exitWithError(
			`Invalid config in ${configPath}: '${keyPrefix}.settings.deny' must be a mapping/object`,
		);
	}
	const skills = deny.skills;
	if (skills === null || skills === undefined) return;
	if (!Array.isArray(skills)) {
		exitWithError(
			`Invalid config in ${configPath}: '${keyPrefix}.settings.deny.skills' must be a list/array of non-empty strings`,
		);
	}
	for (const skill of skills) {
		if (typeof skill !== "string" || !/^[a-zA-Z0-9_-]+$/.test(skill)) {
			exitWithError(
				`Invalid config in ${configPath}: '${keyPrefix}.settings.deny.skills' must contain only [a-zA-Z0-9_-] skill names, got: ${JSON.stringify(skill)}`,
			);
		}
	}
}

/** Read settings.deny.skills, already format-validated by assertDenySkillsShape, as string[]. */
export function extractDenySkills(settings: Record<string, unknown>): string[] {
	const deny = settings.deny;
	if (!isPlainObject(deny) || !Array.isArray(deny.skills)) return [];
	return deny.skills.map((skill) => String(skill));
}

export function buildAugmentedCommand(
	entity: {
		command: unknown;
		model?: unknown;
		effort_level?: unknown;
		output_format?: unknown;
		env?: Record<string, string>;
		deny?: unknown;
	},
	cliType: string,
): { command: string; env: Record<string, string> } {
	const parts = [String(entity.command)];

	// Seed with member's env (YAML scalars may be non-string, so String()-cast each value).
	const env: Record<string, string> = {};
	if (entity.env) {
		for (const [k, v] of Object.entries(entity.env)) {
			env[k] = String(v);
		}
	}

	// model
	if (entity.model) {
		if (cliType === "codex") {
			parts.push("-m", String(entity.model));
		} else {
			parts.push("--model", String(entity.model));
		}
	}

	// nested session guard
	if (cliType === "claude") {
		env.CLAUDECODE = "";
	}

	// deny — invocation-scoped skill block, translated per cliType. No-op when deny is
	// absent/empty: skill names come solely from entity.deny, never hardcoded here.
	const denySkills = Array.isArray(entity.deny) ? entity.deny.map((name) => String(name)) : [];
	if (denySkills.length > 0) {
		if (cliType === "codex") {
			// splitCommand (the only re-tokenizer between here and the spawned CLI — see
			// spawnWorkers/worker.ts) treats an unescaped '"' as a quote-mode toggle and drops
			// it from the token. Escape so the quote survives as a literal byte in the TOML value.
			const entries = denySkills.map((name) => `{name=\\"${name}\\",enabled=false}`).join(",");
			parts.push("-c", `skills.config=[${entries}]`);
		} else if (cliType === "claude") {
			// Object.create(null): a plain {} literal has Object.prototype as its
			// prototype, so a deny name of "__proto__" assigns through the prototype
			// setter instead of creating an own property — it silently vanishes from
			// the JSON.stringify output below. A null-prototype object has no such setter.
			const skillOverrides: Record<string, string> = Object.create(null);
			for (const name of denySkills) skillOverrides[name] = "off";
			// Same reason as codex above: escape every quote in the JSON so splitCommand's
			// re-tokenization doesn't strip them and produce invalid JSON on the receiving end.
			parts.push("--settings", JSON.stringify({ skillOverrides }).replace(/"/g, '\\"'));
		} else if (cliType === "opencode") {
			// This env var is not a deny-only channel — it carries opencode's ENTIRE inline
			// config (provider, model, mcp, other permissions). It reaches the CLI from two
			// inputs, so both must be preserved: the member's own `env:` (seeded above) and
			// the ambient environment, since workerEnv is spread LAST over process.env at
			// spawn time (lib/worker-utils.ts) and would therefore win over an inherited
			// value. Merge into whichever is present rather than replacing it.
			const inherited = env.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT;
			let base: Record<string, unknown> = {};
			if (inherited) {
				try {
					const parsed: unknown = JSON.parse(inherited);
					if (isRecord(parsed)) base = parsed;
				} catch {
					// Unparseable inherited config — opencode itself would reject it, so there is
					// nothing worth preserving. Fall through to an empty base and still enforce deny.
				}
			}
			const permission: Record<string, unknown> = isRecord(base.permission) ? base.permission : {};
			// Same null-prototype reasoning as claude's skillOverrides above.
			const skill: Record<string, string> = Object.create(null);
			if (isRecord(permission.skill)) {
				for (const [name, decision] of Object.entries(permission.skill)) {
					skill[name] = String(decision);
				}
			}
			// Default the wildcard only when the inherited config states no policy of its own:
			// writing "allow" unconditionally would WIDEN an inherited '*: deny' default, turning
			// a config-preserving merge into a permission grant.
			if (skill["*"] === undefined) skill["*"] = "allow";
			for (const name of denySkills) skill[name] = "deny";
			env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
				...base,
				permission: { ...permission, skill },
			});
		}
		// gemini/unknown: no enforceable lever here — enforceability is a job-start gate's job, not this translator's.
	}

	// effort_level
	if (entity.effort_level) {
		if (cliType === "claude") {
			env.CLAUDE_CODE_EFFORT_LEVEL = String(entity.effort_level);
		} else if (cliType === "codex") {
			parts.push("-c", `model_reasoning_effort=${entity.effort_level}`);
		} else if (cliType === "opencode") {
			parts.push("--variant", String(entity.effort_level));
		}
		// gemini/unknown: ignored
	}

	// output_format
	if (entity.output_format && entity.output_format !== "text") {
		if (cliType === "claude" || cliType === "gemini") {
			parts.push("--output-format", String(entity.output_format));
		} else if (cliType === "codex") {
			parts.push("--json");
		} else if (cliType === "opencode") {
			parts.push("--format", String(entity.output_format));
		}
		// unknown: ignored
	}

	return { command: parts.join(" "), env };
}

// ---------------------------------------------------------------------------
// GC stale jobs
// ---------------------------------------------------------------------------

const GC_MAX_AGE_MS = 3_600_000; // 1 hour

export function gcStaleJobs(jobsDir: string, config: JobConfig): void {
	try {
		const resolvedJobsDir = fs.realpathSync(jobsDir);
		const prefix = config.jobPrefix;
		const entries = fs.readdirSync(jobsDir);
		for (const entry of entries) {
			if (!entry.startsWith(prefix)) continue;

			const candidatePath = path.join(jobsDir, entry);

			// Path traversal guard — resolve symlinks before comparing
			let realCandidatePath: string;
			try {
				realCandidatePath = fs.realpathSync(candidatePath);
			} catch {
				continue;
			}
			const relative = path.relative(resolvedJobsDir, realCandidatePath);
			const isUnder = !relative.startsWith("..") && !path.isAbsolute(relative);
			if (!isUnder) continue;

			let jobMeta: unknown;
			try {
				jobMeta = readJsonIfExists(path.join(candidatePath, "job.json"));
			} catch {
				continue;
			}
			if (!isRecord(jobMeta) || !jobMeta.createdAt) continue;

			const createdAtMs = toEpochMs(jobMeta.createdAt);
			if (Number.isNaN(createdAtMs)) continue;

			const age = Date.now() - createdAtMs;
			if (age > GC_MAX_AGE_MS) {
				fs.rmSync(candidatePath, { recursive: true, force: true });
			}
		}
	} catch {
		// GC is best-effort — never block cmdStart
	}
}

// ---------------------------------------------------------------------------
// Worker spawning
// ---------------------------------------------------------------------------

export function spawnWorkers({
	entities,
	workerPath,
	jobDir,
	entitiesDir,
	timeoutSec,
	config,
}: {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported signature; entity shape is consumer-defined YAML-derived data
	entities: any[];
	workerPath: string;
	jobDir: string;
	entitiesDir: string;
	timeoutSec: number;
	config: JobConfig;
}): void {
	// Validate names and detect case-insensitive collisions before spawning
	const seenLower = new Map<string, string>();
	for (const entity of entities) {
		const name = String(entity.name);
		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			exitWithError(
				`start: ${config.entitySingular} name must contain only alphanumeric, underscore, or hyphen characters: "${name}"`,
			);
		}
		const lower = name.toLowerCase();
		if (seenLower.has(lower)) {
			exitWithError(
				`start: ${config.entitySingular} name collision (case-insensitive) — "${name}" and "${seenLower.get(lower)}"`,
			);
		}
		seenLower.set(lower, name);
	}

	for (const entity of entities) {
		const name = String(entity.name);
		const entityDir = path.join(entitiesDir, name);
		ensureDir(entityDir);

		atomicWriteJson(path.join(entityDir, "status.json"), {
			member: name,
			state: "queued",
			queuedAt: new Date().toISOString(),
			command: String(entity.command),
		});

		const cliType = detectCliType(entity.command);
		const augmented = buildAugmentedCommand(entity, cliType);

		const workerArgs = [
			workerPath,
			"--job-dir",
			jobDir,
			"--member",
			name,
			"--command",
			augmented.command,
		];
		for (const [key, value] of Object.entries(augmented.env)) {
			workerArgs.push("--env", `${key}=${value}`);
		}
		if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
			workerArgs.push("--timeout", String(timeoutSec));
		}

		const child = spawn(process.execPath, workerArgs, {
			detached: true,
			stdio: "ignore",
			env: process.env,
		});
		child.unref();
	}
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Heartbeat staleness thresholds
// ---------------------------------------------------------------------------

/** Running entity is stale if lastHeartbeat is older than this. */
export const HEARTBEAT_STALE_THRESHOLD_MS = 60_000;

/** Grace period for running entity with no heartbeat yet (startedAt/mtime fallback). */
export const HEARTBEAT_GRACE_PERIOD_MS = 120_000;

export async function computeStatus(
	jobDir: string,
	config: JobConfig,
): Promise<{
	jobDir: string;
	id: string | null;
	chairmanRole: string | null;
	overallState: string;
	counts: Record<string, number>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported return type; members shape is intentionally loose for downstream JSON serialization
	members: any[];
}> {
	const resolvedJobDir = path.resolve(jobDir);
	if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

	const jobMetaRaw = readJsonIfExists(path.join(resolvedJobDir, "job.json"));
	if (!isRecord(jobMetaRaw))
		exitWithError(`job.json not found: ${path.join(resolvedJobDir, "job.json")}`);
	const jobMeta = jobMetaRaw;

	const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);
	if (!fs.existsSync(entitiesRoot))
		exitWithError(`${config.entityDirName} folder not found: ${entitiesRoot}`);

	// Staleness threshold: Math.max(2 * timeoutSec, 120) seconds
	const jobSettings = isRecord(jobMeta.settings) ? jobMeta.settings : undefined;
	const timeoutSec =
		jobSettings && Number.isFinite(Number(jobSettings.timeoutSec))
			? Number(jobSettings.timeoutSec)
			: 0;
	const stalenessThresholdMs = Math.max(2 * timeoutSec, 120) * 1000;

	const members: Record<string, unknown>[] = [];
	for (const entry of fs.readdirSync(entitiesRoot)) {
		const statusPath = path.join(entitiesRoot, entry, "status.json");
		const statusRaw = readJsonIfExists(statusPath);
		if (!isRecord(statusRaw)) continue;
		let status: Record<string, unknown> = statusRaw;

		// Staleness check for queued entities
		if (status.state === "queued") {
			let queuedTs: number;
			if (status.queuedAt) {
				queuedTs = toEpochMs(status.queuedAt);
			} else {
				// Fallback to file mtime
				try {
					queuedTs = fs.statSync(statusPath).mtimeMs;
				} catch {
					queuedTs = Date.now();
				}
			}
			const elapsed = Date.now() - queuedTs;
			if (elapsed > stalenessThresholdMs) {
				// CAS pattern: sleep then re-read to avoid race with worker startup
				await sleepMs(250);
				const recheck = readJsonIfExists(statusPath);
				if (isRecord(recheck) && recheck.state === "queued") {
					const errorPayload = {
						...recheck,
						state: "error",
						error: `Worker stale: no progress for ${Math.round(elapsed / 1000)} seconds`,
					};
					atomicWriteJson(statusPath, errorPayload);
					status = errorPayload;
				} else if (isRecord(recheck)) {
					status = recheck;
				}
			}
		}

		// Staleness check for running entities (heartbeat-based)
		if (status.state === "running") {
			let isStale: boolean;
			let startTs: number;
			if (status.lastHeartbeat) {
				// heartbeat present: stale if older than HEARTBEAT_STALE_THRESHOLD_MS
				const heartbeatAge = Date.now() - toEpochMs(status.lastHeartbeat);
				isStale = heartbeatAge > HEARTBEAT_STALE_THRESHOLD_MS;
				startTs = toEpochMs(status.lastHeartbeat);
			} else {
				// no heartbeat yet: grace period based on startedAt or file mtime
				if (status.startedAt) {
					startTs = toEpochMs(status.startedAt);
				} else {
					try {
						startTs = fs.statSync(statusPath).mtimeMs;
					} catch {
						startTs = Date.now();
					}
				}
				isStale = Date.now() - startTs > HEARTBEAT_GRACE_PERIOD_MS;
			}

			if (isStale) {
				// CAS pattern: sleep then re-read to avoid race with legitimate completion
				await sleepMs(250);
				const recheck = readJsonIfExists(statusPath);
				if (isRecord(recheck) && recheck.state === "running") {
					// Recompute elapsed using recheck fields (post-CAS)
					let recheckStartTs: number;
					if (recheck.lastHeartbeat) {
						recheckStartTs = toEpochMs(recheck.lastHeartbeat);
					} else if (recheck.startedAt) {
						recheckStartTs = toEpochMs(recheck.startedAt);
					} else {
						try {
							recheckStartTs = fs.statSync(statusPath).mtimeMs;
						} catch {
							recheckStartTs = startTs;
						}
					}
					const elapsed = Math.round((Date.now() - recheckStartTs) / 1000);
					const errorPayload = {
						...recheck,
						state: "error",
						error: recheck.lastHeartbeat
							? `Worker stale: no heartbeat for ${elapsed} seconds`
							: `Worker stale: running for ${elapsed} seconds without heartbeat`,
					};
					atomicWriteJson(statusPath, errorPayload);
					status = errorPayload;
				} else if (isRecord(recheck)) {
					status = recheck;
				}
			}
		}

		members.push({ safeName: entry, ...status });
	}

	const totals: Record<string, number> = {
		queued: 0,
		running: 0,
		retrying: 0,
		done: 0,
		error: 0,
		missing_cli: 0,
		timed_out: 0,
		canceled: 0,
		non_retryable: 0,
		empty_output: 0,
		transient_error: 0,
		permanent_error: 0,
		awaiting_resume: 0,
	};
	for (const r of members) {
		const state = String(r.state || "unknown");
		if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
	}

	const allDone =
		totals.running === 0 &&
		totals.queued === 0 &&
		totals.retrying === 0 &&
		totals.awaiting_resume === 0;
	const overallState = allDone
		? "done"
		: totals.running > 0 || totals.retrying > 0
			? "running"
			: totals.queued > 0
				? "queued"
				: totals.awaiting_resume > 0
					? "awaiting_resume"
					: "queued";

	return {
		jobDir: resolvedJobDir,
		id: typeof jobMeta.id === "string" ? jobMeta.id : null,
		chairmanRole: typeof jobMeta.chairmanRole === "string" ? jobMeta.chairmanRole : null,
		overallState,
		counts: { total: members.length, ...totals },
		members: members
			.map((r) => ({
				member: r.member,
				state: r.state,
				startedAt: r.startedAt || null,
				finishedAt: r.finishedAt || null,
				exitCode: r.exitCode !== undefined && r.exitCode !== null ? r.exitCode : null,
				message: r.message || null,
			}))
			.sort((a, b) => String(a.member).localeCompare(String(b.member))),
	};
}

// ---------------------------------------------------------------------------
// UI payload
// ---------------------------------------------------------------------------

const UI_STRINGS = {
	dispatch: {
		completed: "Dispatched review prompts",
		inProgress: "Dispatching review prompts",
	},
	synthesize: {
		completed: "Results ready",
		inProgress: "Ready to synthesize",
		pending: "Waiting to synthesize",
	},
};

export function buildUiPayload(
	statusPayload: {
		overallState?: string;
		counts?: Record<string, number>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported signature; members come straight from computeStatus's loose members: any[]
		members?: any[];
	},
	config: JobConfig,
): {
	progress: { done: number; total: number; overallState: string };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported return type (codex update_plan / claude todo_write consumer contract)
	codex: { update_plan: { plan: any[] } };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported return type (codex update_plan / claude todo_write consumer contract)
	claude: { todo_write: { todos: any[] } };
} {
	const counts = statusPayload.counts || {};
	const done = computeTerminalDoneCount(counts);
	const total = Number(counts.total || 0);
	const isDone = String(statusPayload.overallState || "") === "done";

	const queued = Number(counts.queued || 0);
	const running = Number(counts.running || 0);

	const membersArray = Array.isArray(statusPayload.members) ? statusPayload.members : [];
	const sortedMembers = membersArray
		.map((r) => ({
			entity: r && r.member !== undefined && r.member !== null ? String(r.member) : "",
			state: r && r.state !== undefined && r.state !== null ? String(r.state) : "unknown",
			exitCode: r && r.exitCode !== undefined && r.exitCode !== null ? r.exitCode : null,
		}))
		.filter((r) => r.entity)
		.sort((a, b) => a.entity.localeCompare(b.entity));

	const terminalStates = new Set([
		"done",
		"missing_cli",
		"error",
		"timed_out",
		"canceled",
		"non_retryable",
		"empty_output",
		"transient_error",
		"permanent_error",
	]);
	const dispatchStatus = asCodexStepStatus(
		isDone ? "completed" : queued > 0 ? "in_progress" : "completed",
	);
	let hasInProgress = dispatchStatus === "in_progress";

	const memberSteps = sortedMembers.map((r) => {
		const state = r.state || "unknown";
		const isTerminal = terminalStates.has(state);

		let status: string;
		if (isTerminal) {
			status = "completed";
		} else if (!hasInProgress && running > 0 && state === "running") {
			status = "in_progress";
			hasInProgress = true;
		} else {
			status = "pending";
		}

		const label = `${config.uiLabel} Ask ${r.entity}`;
		return { label, status: asCodexStepStatus(status) };
	});

	const synthStatus = asCodexStepStatus(
		isDone ? (hasInProgress ? "pending" : "in_progress") : "pending",
	);

	const codexPlan = [
		{ step: `${config.uiLabel} Prompt dispatch`, status: dispatchStatus },
		...memberSteps.map((s) => ({ step: s.label, status: s.status })),
		{ step: `${config.uiLabel} Synthesize`, status: synthStatus },
	];

	const claudeTodos = [
		{
			content: `${config.uiLabel} Prompt dispatch`,
			status: dispatchStatus,
			activeForm:
				dispatchStatus === "completed"
					? UI_STRINGS.dispatch.completed
					: UI_STRINGS.dispatch.inProgress,
		},
		...memberSteps.map((s) => ({
			content: s.label,
			status: s.status,
			activeForm: s.status === "completed" ? "Finished" : "Awaiting response",
		})),
		{
			content: `${config.uiLabel} Synthesize`,
			status: synthStatus,
			activeForm:
				synthStatus === "completed"
					? UI_STRINGS.synthesize.completed
					: synthStatus === "in_progress"
						? UI_STRINGS.synthesize.inProgress
						: UI_STRINGS.synthesize.pending,
		},
	];

	return {
		progress: { done, total, overallState: String(statusPayload.overallState || "") },
		codex: { update_plan: { plan: codexPlan } },
		claude: { todo_write: { todos: claudeTodos } },
	};
}

// ---------------------------------------------------------------------------
// Wait payload (internal helper)
// ---------------------------------------------------------------------------

function asWaitPayload(
	statusPayload: Awaited<ReturnType<typeof computeStatus>>,
	config: JobConfig,
): Record<string, unknown> {
	const membersArray = Array.isArray(statusPayload.members) ? statusPayload.members : [];

	return {
		jobDir: statusPayload.jobDir,
		id: statusPayload.id,
		chairmanRole: statusPayload.chairmanRole,
		overallState: statusPayload.overallState,
		counts: statusPayload.counts,
		[config.entityPlural]: membersArray.map((r) => ({
			member: r.member,
			state: r.state,
			exitCode: r.exitCode !== undefined && r.exitCode !== null ? r.exitCode : null,
			message: r.message || null,
		})),
		ui: buildUiPayload(statusPayload, config),
	};
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

export function buildManifest(
	jobDir: string,
	config: JobConfig,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public exported return type; manifest entity shape is intentionally loose for downstream JSON serialization
): { id: string; [key: string]: any } {
	const resolvedJobDir = path.resolve(jobDir);
	const jobMetaRaw = readJsonIfExists(path.join(resolvedJobDir, "job.json"));
	const jobMeta = isRecord(jobMetaRaw) ? jobMetaRaw : undefined;
	const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);

	const jobId = jobMeta && typeof jobMeta.id === "string" ? jobMeta.id : "unknown";
	const entities: Record<string, unknown>[] = [];
	if (fs.existsSync(entitiesRoot)) {
		for (const entry of fs.readdirSync(entitiesRoot)) {
			const statusPath = path.join(entitiesRoot, entry, "status.json");
			const status = readJsonIfExists(statusPath);
			if (!isRecord(status)) continue;
			const outputPath = path.join(entitiesRoot, entry, "output.txt");
			const outputExists = fs.existsSync(outputPath);
			const sizeBytes = typeof status.size_bytes === "number" ? status.size_bytes : undefined;
			const isReadable = status.state === "done" && (sizeBytes ?? Infinity) > 0;
			const statusError = isRecord(status.error) ? status.error : undefined;
			entities.push({
				member: status.member,
				outputFilePath: outputExists && isReadable ? outputPath : null,
				errorMessage:
					outputExists && isReadable
						? null
						: status.message || statusError?.type || statusError?.message || status.state,
				size_bytes: status.size_bytes ?? null,
				attempts: status.attempts ?? null,
				error: status.error ?? null,
				_safeName: entry,
			});
		}
	}

	return {
		id: jobId,
		[config.entityPlural]: entities
			.map(({ _safeName, ...rest }) => rest)
			.sort((a, b) => String(a.member).localeCompare(String(b.member))),
	};
}

// ---------------------------------------------------------------------------
// Command: wait
// ---------------------------------------------------------------------------

export async function cmdWait(
	options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
	hooks?: CmdWaitHooks,
): Promise<void> {
	const resolvedJobDir = path.resolve(jobDir);
	const cursorFilePath = path.join(resolvedJobDir, ".wait_cursor");
	const prevCursorRaw =
		options.cursor !== undefined && options.cursor !== null
			? String(options.cursor)
			: fs.existsSync(cursorFilePath)
				? String(fs.readFileSync(cursorFilePath, "utf8")).trim()
				: "";
	const prevCursor = parseWaitCursor(prevCursorRaw);

	const intervalMsRaw =
		options["interval-ms"] !== undefined && options["interval-ms"] !== null
			? options["interval-ms"]
			: 250;
	const intervalMs = Math.max(50, Math.trunc(Number(intervalMsRaw)));
	if (!Number.isFinite(intervalMs) || intervalMs <= 0)
		exitWithError(`wait: invalid --interval-ms: ${intervalMsRaw}`);

	const defaultTimeout = hooks?.defaultTimeoutMs ?? 600000;
	const timeoutMsRaw =
		options["timeout-ms"] !== undefined && options["timeout-ms"] !== null
			? options["timeout-ms"]
			: defaultTimeout;
	const timeoutMs = Math.trunc(Number(timeoutMsRaw));
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
		exitWithError(`wait: invalid --timeout-ms: ${timeoutMsRaw}`);

	const applyHook = (p: Record<string, unknown>): Record<string, unknown> =>
		hooks?.transformPayload ? hooks.transformPayload(p) : p;

	let payload = await computeStatus(jobDir, config);
	const bucketSize = resolveBucketSize(options, payload.counts.total, prevCursor);

	const doneCount = computeTerminalDoneCount(payload.counts);
	const isDone = payload.overallState === "done";
	const total = Number(payload.counts.total || 0);
	const queued = Number(payload.counts.queued || 0);
	const dispatchBucket = queued === 0 && total > 0 ? 1 : 0;
	const doneBucket = Math.floor(doneCount / bucketSize);
	const cursor = formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone);

	if (!prevCursor) {
		fs.writeFileSync(cursorFilePath, cursor, "utf8");
		process.stdout.write(
			`${JSON.stringify({ ...applyHook(asWaitPayload(payload, config)), cursor }, null, 2)}\n`,
		);
		return;
	}

	const start = Date.now();
	while (cursor === prevCursorRaw) {
		if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
		await sleepMs(intervalMs);
		payload = await computeStatus(jobDir, config);
		const d = computeTerminalDoneCount(payload.counts);
		const doneFlag = payload.overallState === "done";
		const totalCount = Number(payload.counts.total || 0);
		const queuedCount = Number(payload.counts.queued || 0);
		const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
		const doneB = Math.floor(d / bucketSize);
		const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
		if (nextCursor !== prevCursorRaw) {
			fs.writeFileSync(cursorFilePath, nextCursor, "utf8");
			process.stdout.write(
				`${JSON.stringify({ ...applyHook(asWaitPayload(payload, config)), cursor: nextCursor }, null, 2)}\n`,
			);
			return;
		}
	}

	const finalPayload = await computeStatus(jobDir, config);
	const finalDone = computeTerminalDoneCount(finalPayload.counts);
	const finalDoneFlag = finalPayload.overallState === "done";
	const finalTotal = Number(finalPayload.counts.total || 0);
	const finalQueued = Number(finalPayload.counts.queued || 0);
	const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
	const finalDoneBucket = Math.floor(finalDone / bucketSize);
	const finalCursor = formatWaitCursor(
		bucketSize,
		finalDispatchBucket,
		finalDoneBucket,
		finalDoneFlag,
	);
	fs.writeFileSync(cursorFilePath, finalCursor, "utf8");
	process.stdout.write(
		`${JSON.stringify({ ...applyHook(asWaitPayload(finalPayload, config)), cursor: finalCursor }, null, 2)}\n`,
	);
}

// ---------------------------------------------------------------------------
// Command: results
// ---------------------------------------------------------------------------

export function cmdResults(
	options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
	hooks?: CmdResultsHooks,
): void {
	const resolvedJobDir = path.resolve(jobDir);
	const jobMetaRaw = readJsonIfExists(path.join(resolvedJobDir, "job.json"));
	const jobMeta = isRecord(jobMetaRaw) ? jobMetaRaw : undefined;
	const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);

	const reviewers: Record<string, unknown>[] = [];
	if (fs.existsSync(entitiesRoot)) {
		for (const entry of fs.readdirSync(entitiesRoot)) {
			const statusPath = path.join(entitiesRoot, entry, "status.json");
			const outputPath = path.join(entitiesRoot, entry, "output.txt");
			const errorPath = path.join(entitiesRoot, entry, "error.txt");
			const status = readJsonIfExists(statusPath);
			if (!isRecord(status)) continue;
			const output = fs.existsSync(outputPath)
				? stripAnsi(fs.readFileSync(outputPath, "utf8"))
				: "";
			const stderr = fs.existsSync(errorPath) ? stripAnsi(fs.readFileSync(errorPath, "utf8")) : "";
			reviewers.push({ safeName: entry, ...status, output, stderr });
		}
	}

	if (options.manifest) {
		const manifest = buildManifest(jobDir, config);
		process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
		return;
	}

	if (options.json) {
		const extraTop = hooks?.extraTopLevel ? hooks.extraTopLevel(resolvedJobDir, jobMeta) : {};
		process.stdout.write(
			`${JSON.stringify(
				{
					jobDir: resolvedJobDir,
					id: jobMeta ? jobMeta.id : null,
					...extraTop,
					[config.entityPlural]: reviewers
						.map((r) => ({
							member: r.member,
							state: r.state,
							exitCode: r.exitCode !== undefined && r.exitCode !== null ? r.exitCode : null,
							message: r.message || null,
							output: r.output,
							...(hooks?.extraMemberFields ? hooks.extraMemberFields(r) : {}),
						}))
						.sort((a, b) => String(a.member).localeCompare(String(b.member))),
				},
				null,
				2,
			)}\n`,
		);
		return;
	}

	for (const r of reviewers.sort((a, b) => String(a.member).localeCompare(String(b.member)))) {
		process.stdout.write(`\n=== ${r.member} (${r.state}) ===\n`);
		if (r.message) process.stdout.write(`${r.message}\n`);
		process.stdout.write(String(r.output || ""));
		if (!r.output && r.stderr) {
			process.stdout.write("\n");
			process.stdout.write(String(r.stderr));
		}
		process.stdout.write("\n");
	}
}

// ---------------------------------------------------------------------------
// Command: stop
// ---------------------------------------------------------------------------

export function cmdStop(
	_options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
): void {
	const resolvedJobDir = path.resolve(jobDir);
	const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);
	if (!fs.existsSync(entitiesRoot))
		exitWithError(`No ${config.entityDirName} folder found: ${entitiesRoot}`);

	let stoppedAny = false;
	for (const entry of fs.readdirSync(entitiesRoot)) {
		const statusPath = path.join(entitiesRoot, entry, "status.json");
		const status = readJsonIfExists(statusPath);
		if (!isRecord(status)) continue;
		if (status.state !== "running") continue;
		if (!status.pid) continue;

		try {
			process.kill(Number(status.pid), "SIGTERM");
			stoppedAny = true;
		} catch {
			// ignore
		}
	}

	process.stdout.write(
		stoppedAny
			? `stop: sent SIGTERM to running ${config.entityPlural}\n`
			: `stop: no running ${config.entityPlural}\n`,
	);
}

// ---------------------------------------------------------------------------
// Command: clean
// ---------------------------------------------------------------------------

export function cmdClean(
	options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
	defaultJobsDir: string,
): void {
	const resolvedJobDir = path.resolve(jobDir);

	// Primary: use explicit jobs-dir from options/env/default
	const jobsDirOption = typeof options["jobs-dir"] === "string" ? options["jobs-dir"] : undefined;
	const configuredJobsDir = path.resolve(jobsDirOption || defaultJobsDir);

	// Path traversal guard: check if target is under the configured jobs directory
	const relative = path.relative(configuredJobsDir, resolvedJobDir);
	const isUnderConfigured = !relative.startsWith("..") && !path.isAbsolute(relative);

	if (!isUnderConfigured) {
		// Fallback: accept if jobDir contains job.json (proves it's a real job directory)
		const jobJsonPath = path.join(resolvedJobDir, "job.json");
		if (!fs.existsSync(jobJsonPath)) {
			exitWithError(
				`clean: refusing to delete path outside jobs directory: ${resolvedJobDir} (jobsDir: ${configuredJobsDir})`,
			);
		}
	}

	// Active-member guard: refuse to delete if any member is in a non-terminal/resumable state.
	// Override with force: true (e.g. options.force = true) to skip this check.
	if (!options["force"]) {
		const activeMemberStates = new Set(["awaiting_resume", "running", "queued", "retrying"]);
		const entitiesDir = path.join(resolvedJobDir, config.entityDirName);
		if (fs.existsSync(entitiesDir)) {
			let activeEntries: string[] = [];
			try {
				activeEntries = fs.readdirSync(entitiesDir).filter((e) => {
					const statusPath = path.join(entitiesDir, e, "status.json");
					const status = readJsonIfExists(statusPath);
					if (!isRecord(status)) return false;
					const state = typeof status.state === "string" ? status.state : "";
					return activeMemberStates.has(state);
				});
			} catch {
				// If we can't read the entities dir, proceed; the path-traversal guard already validated.
			}
			if (activeEntries.length > 0) {
				exitWithError(
					`clean: refusing to delete job dir with active ${config.entityPlural}: ${activeEntries.join(", ")} — use force option to override`,
				);
			}
		}
	}

	fs.rmSync(resolvedJobDir, { recursive: true, force: true });
	process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// ---------------------------------------------------------------------------
// Command: collect — blocking poll until done
// ---------------------------------------------------------------------------

const COLLECT_POLL_INTERVAL_MS = 5000;
const COLLECT_TIMEOUT_HARDCAP_MS = 300000;

export async function cmdCollect(
	options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
): Promise<void> {
	const timeoutMsRaw =
		options["timeout-ms"] !== undefined && options["timeout-ms"] !== null
			? Number(options["timeout-ms"])
			: 150000;
	const timeoutMs = Math.min(
		Math.max(0, Number.isFinite(timeoutMsRaw) ? Math.trunc(timeoutMsRaw) : 150000),
		COLLECT_TIMEOUT_HARDCAP_MS,
	);

	const start = Date.now();
	while (true) {
		const status = await computeStatus(jobDir, config);
		if (status.overallState === "done") {
			const manifest = buildManifest(jobDir, config);
			process.stdout.write(`${JSON.stringify({ overallState: "done", ...manifest }, null, 2)}\n`);
			return;
		}
		if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
			process.stdout.write(
				`${JSON.stringify({ overallState: status.overallState, id: status.id, counts: status.counts }, null, 2)}\n`,
			);
			return;
		}
		await sleepMs(COLLECT_POLL_INTERVAL_MS);
	}
}

// ---------------------------------------------------------------------------
// Command: resume-member
// ---------------------------------------------------------------------------

export type ResumeMemberOpts = {
	driverFactory?: (cliType: string) => ReturnType<typeof pickDriver>;
	resumeOneTurnFn?: (sessionID: string, opts: RunOneTurnOpts) => Promise<OneTurnResult>;
	/** Test-only: forwarded to resumeOneTurn for spawn-less e2e wire validation. */
	runOnceFn?: typeof runOnce;
};

export async function cmdResumeMember(
	jobDir: string,
	name: string,
	prompt: string,
	config: JobConfig,
	opts: ResumeMemberOpts = {},
): Promise<void> {
	const memberDir = path.join(jobDir, config.entityDirName, name);
	const statusPath = path.join(memberDir, "status.json");

	// Read status.json
	let status: Record<string, unknown>;
	try {
		status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
	} catch {
		throw new Error("no resumable session");
	}

	// Check sessionID
	const sessionID = status.sessionID;
	if (!sessionID) throw new Error("no resumable session");

	// State check
	const state = String(status.state ?? "");
	if (state === "error" || state === "non_retryable") {
		throw new Error(`member in non-resumable state: ${state}`);
	}

	// Restore workerEnv saved by executeOneTurn (P1-4: preserve cross-CLI env contract across resume).
	const storedWorkerEnv: Record<string, string> = {};
	if (isRecord(status.workerEnv)) {
		for (const [envKey, envValue] of Object.entries(status.workerEnv)) {
			if (typeof envValue === "string") storedWorkerEnv[envKey] = envValue;
		}
	}

	// Preflight: validate CLI type, driver, and command BEFORE reserving the cap slot so that
	// misconfigured commands do not burn a resume_count increment (item 4).
	const command = status.command;
	const cliType = detectCliType(command);
	if (cliType === "unknown") throw new Error("unknown cli type");
	if (!isCliType(cliType)) throw new Error("unknown cli type");

	// Driver lookup
	const driverFactory = opts.driverFactory ?? pickDriver;
	const driver = driverFactory(cliType);
	if (!driver) throw new Error(`no driver for ${cliType}`);

	// P1-3: parse status.command to restore original program+args (preserve --agent/--model/-p/run/etc.)
	const cmdStr = String(command ?? "");
	const tokens = splitCommand(cmdStr);
	if (!tokens || tokens.length === 0) throw new Error("invalid stored command");

	// Cap check + reserve (P2-2): increment BEFORE awaiting resumeFn so a subsequent
	// sequential call observes the incremented count. NOTE: atomicWriteJson guarantees
	// single-write atomicity, NOT read-check-write atomicity — true concurrent invocations
	// can still race past the cap. The single-developer / chairman-driven flow is
	// effectively sequential, so the cap holds in practice. executeOneTurn preserves
	// resume_count via read-then-write (line 449 of worker-utils.ts).
	const resumeCount = typeof status.resume_count === "number" ? status.resume_count : 0;
	if (resumeCount >= 3) throw new Error("resume cap exceeded (3/3)");
	atomicWriteJson(statusPath, { ...status, resume_count: resumeCount + 1 });
	const [origProgram, ...origArgs] = tokens;

	// P2-1: read timeoutSec from job.json instead of hardcoding
	let timeoutSec = 300;
	try {
		const jobMeta: Record<string, unknown> = JSON.parse(
			fs.readFileSync(path.join(jobDir, "job.json"), "utf8"),
		);
		const settings = isRecord(jobMeta.settings) ? jobMeta.settings : undefined;
		if (settings && typeof settings.timeoutSec === "number" && settings.timeoutSec >= 0) {
			timeoutSec = settings.timeoutSec;
		}
	} catch {
		/* keep default 300 */
	}

	// Note: promptsDir and fallbackFile are intentionally not forwarded here.
	// session-preserving CLIs (claude --resume, opencode session resume, codex exec resume)
	// retain persona + reviewContent server-side, making assemblePrompt re-injection redundant on resume.
	const resumeFn = opts.resumeOneTurnFn ?? resumeOneTurn;
	await resumeFn(String(sessionID), {
		program: origProgram,
		args: origArgs,
		prompt,
		member: name,
		memberDir,
		command: cmdStr,
		timeoutSec,
		cliType,
		workerEnv: storedWorkerEnv,
		driverFactory: opts.driverFactory,
		runOnceFn: opts.runOnceFn,
	});
}

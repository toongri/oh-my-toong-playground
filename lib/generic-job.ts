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
import { spawn, execSync } from "child_process";

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

// ---------------------------------------------------------------------------
// MCP whitelist engine — settings.mcps.allow validation, config.toml server
// enumeration, and block-list computation. A review worker's codex process
// inherits every MCP server declared in ~/.codex/config.toml regardless of
// whether the review workflow uses it (measured: 13 servers configured on
// this host, 1 — codegraph — actually used by review workers), and each is a
// process the worker spawns. This engine computes the complement so
// buildAugmentedCommand can pass `-c mcp_servers.<name>.enabled=false` for
// every non-allow-listed configured server, shrinking the process count a
// worker creates in the first place (orthogonal to the reaping layers
// elsewhere in this file — this reduces what gets created, not what gets
// cleaned up after).
// ---------------------------------------------------------------------------

export function assertMcpAllowShape(
	settings: Record<string, unknown>,
	config: JobConfig,
	configPath: string,
): void {
	const keyPrefix = config.configTopLevelKey;
	const mcps = settings.mcps;
	if (mcps === null || mcps === undefined) return;
	if (!isPlainObject(mcps)) {
		exitWithError(
			`Invalid config in ${configPath}: '${keyPrefix}.settings.mcps' must be a mapping/object`,
		);
	}
	const allow = mcps.allow;
	if (allow === null || allow === undefined) return;
	if (!Array.isArray(allow)) {
		exitWithError(
			`Invalid config in ${configPath}: '${keyPrefix}.settings.mcps.allow' must be a list/array of non-empty strings`,
		);
	}
	for (const name of allow) {
		if (typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
			exitWithError(
				`Invalid config in ${configPath}: '${keyPrefix}.settings.mcps.allow' must contain only [a-zA-Z0-9_-] MCP server names, got: ${JSON.stringify(name)}`,
			);
		}
	}
}

/**
 * Enumerate MCP server names declared in `<codexHome>/config.toml` via
 * `[mcp_servers.<name>]` headers, sorted and de-duplicated.
 *
 * Deliberately reads config.toml directly rather than shelling out to
 * `codex mcp list --json` — calling that CLI would itself spawn a process,
 * defeating the point of this engine (fewer processes per job).
 */
export function enumerateConfiguredMcpServers(codexHome: string): string[] {
	let content: string;
	try {
		content = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
	} catch {
		// Fail-open: no config.toml (or unreadable) means nothing to enumerate,
		// and therefore nothing to block against — an empty allowlist target,
		// not an error.
		return [];
	}
	// Single segment only: matches [mcp_servers.<name>] where <name> contains
	// no further dot. This host's real config.toml has both
	// [mcp_servers.maestro] and [mcp_servers.maestro.env] — the latter is a
	// nested table (env vars for the maestro server), not a second server
	// named "maestro.env". A looser `^\[mcp_servers\.(.+)\]$` would wrongly
	// capture "maestro.env" as its own server name.
	//
	// Quoted headers ([mcp_servers."weird name"]) are deliberately NOT
	// matched: such a name cannot be carried safely through a
	// `-c mcp_servers.<name>.enabled=false` CLI argument, so it is left
	// unenumerated and stays on (under-recall over over-recall — an
	// unenumerated server is simply not blocked, never wrongly blocked).
	const headerRe = /^\s*\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/;
	const names = new Set<string>();
	for (const line of content.split("\n")) {
		const match = headerRe.exec(line);
		if (match) names.add(match[1]);
	}
	return [...names].sort();
}

/**
 * Compute the MCP servers to disable: every `configuredNames` entry not
 * present in `settings.mcps.allow`.
 *
 * Fail-closed by design — the OPPOSITE default direction from
 * `settings.deny.skills` (unspecified deny = nothing blocked, a no-op).
 * `mcps.allow` is opt-in: an unspecified `mcps` or `mcps.allow` blocks EVERY
 * configured server, so a job config that never declares an allowlist does
 * not silently inherit the ambient config.toml's full MCP surface.
 */
export function computeMcpBlockList(
	settings: Record<string, unknown>,
	configuredNames: string[],
): string[] {
	const mcps = settings.mcps;
	if (!isPlainObject(mcps) || !Array.isArray(mcps.allow)) {
		return [...configuredNames].sort();
	}
	const allow = new Set(mcps.allow.map((name) => String(name)));
	// Filter configuredNames — never build the result by iterating `allow` —
	// so the block list is always a SUBSET of configuredNames. An allow entry
	// with no matching configured server (e.g. "ghost") must never leak into
	// the block list: `-c mcp_servers.ghost.enabled=false` for a server codex
	// never declared makes codex fail to boot ("Error loading config.toml:
	// invalid transport").
	return configuredNames.filter((name) => !allow.has(name)).sort();
}

export function buildAugmentedCommand(
	entity: {
		command: unknown;
		model?: unknown;
		effort_level?: unknown;
		output_format?: unknown;
		env?: Record<string, string>;
		deny?: unknown;
		mcpBlock?: unknown;
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

	// mcpBlock — MCP server whitelist enforcement (see computeMcpBlockList), codex only.
	// No quote escaping needed here, unlike deny's skills.config value above: names are
	// pre-validated to [a-zA-Z0-9_-] by assertMcpAllowShape, so the value can never contain
	// a space or quote for splitCommand's re-tokenization to mangle.
	const mcpBlock = Array.isArray(entity.mcpBlock) ? entity.mcpBlock.map((name) => String(name)) : [];
	if (mcpBlock.length > 0 && cliType === "codex") {
		for (const name of mcpBlock) {
			parts.push("-c", `mcp_servers.${name}.enabled=false`);
		}
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

export type SpawnedWorker = {
	name: string;
	workerPgid: number | null;
	/** Spawn-time witness: the leader process's own `ps -o lstart=` start time,
	 *  captured right after spawn. This is what later distinguishes "this PGID
	 *  number is still our worker" from "this PGID number is alive" — the two
	 *  are not the same claim, since the OS reuses PID/PGID numbers (see
	 *  judgePgidSignal below for the full reasoning). `null` when the lookup
	 *  itself failed — treated as "no witness" by every consumer, never as
	 *  "assume it's ours". */
	workerPgidStartedAt: string | null;
};

/** `ps -o lstart=` for a single freshly-spawned pid — the spawn-time witness
 *  recorded alongside workerPgid. Mirrors the error handling of the existing
 *  `ps -A` calls elsewhere in this file (reapOrphanJobs, cmdClean): failure
 *  has no basis to assert anything, so it degrades to `null` (no witness)
 *  rather than guessing. */
function getProcessStartedAt(pid: number): string | null {
	try {
		// LC_ALL=C: see getPgidSnapshot's own comment below for why this witness
		// must render in a fixed locale — this call and that one are the two
		// sides of the same later comparison, running in different processes.
		const output = execSync(`LC_ALL=C ps -o lstart= -p ${pid}`, { encoding: "utf8" }).trim();
		return output || null;
	} catch {
		return null;
	}
}

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
}): SpawnedWorker[] {
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

	const spawned: SpawnedWorker[] = [];

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

		// A detached child is the leader of its own process group, so its PGID
		// equals its PID — no `ps` lookup needed (see spawnWorkers tests for the
		// measured proof of this platform contract). The start-time witness
		// still needs its own `ps` lookup, done immediately so it reflects this
		// exact process rather than whatever later reuses the same number.
		const workerPgid = child.pid ?? null;
		spawned.push({
			name,
			workerPgid,
			workerPgidStartedAt: workerPgid !== null ? getProcessStartedAt(workerPgid) : null,
		});
	}

	return spawned;
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

/**
 * Synchronous stale-heartbeat predicate for a `running` status record.
 * Extracted from computeStatus's own running-staleness block so `cmdClean`'s
 * active-member guard can share the exact same judgment instead of a second,
 * potentially drifting copy of the threshold logic. `cmdClean` needs a sync
 * predicate — it must stay a sync function itself (5 skill call-sites import
 * it; see cmdClean's own comment for why) — which computeStatus's async CAS
 * re-check flow does not provide directly.
 */
export function isRunningStatusStale(status: Record<string, unknown>, statusPath: string): boolean {
	if (status.lastHeartbeat) {
		// heartbeat present: stale if older than HEARTBEAT_STALE_THRESHOLD_MS
		const heartbeatAge = Date.now() - toEpochMs(status.lastHeartbeat);
		return heartbeatAge > HEARTBEAT_STALE_THRESHOLD_MS;
	}
	// no heartbeat yet: grace period based on startedAt or file mtime
	let startTs: number;
	if (status.startedAt) {
		startTs = toEpochMs(status.startedAt);
	} else {
		try {
			startTs = fs.statSync(statusPath).mtimeMs;
		} catch {
			startTs = Date.now();
		}
	}
	return Date.now() - startTs > HEARTBEAT_GRACE_PERIOD_MS;
}

/**
 * Names of members in entitiesDir that currently have live progress: a
 * non-terminal/resumable state (`awaiting_resume`, `running`, `queued`,
 * `retrying`) — except a `running` member whose heartbeat is stale (same
 * judgment isRunningStatusStale/computeStatus already use), which is treated
 * as not-active since an external SIGKILL can leave a member stuck at
 * state:"running" forever otherwise.
 *
 * Returns `null` — not `[]` — when activity can't be determined: readdirSync
 * on entitiesDir throws (permission error, EMFILE, I/O error), or a member's
 * status.json exists on disk but doesn't read back as a record (read/parse
 * failure). `[]` stays reserved for "read fine, found nothing active" —
 * entitiesDir itself missing, or a member with no status.json yet, both
 * still collapse to inactive exactly as before. Conflating "couldn't read"
 * with "read and found nothing" is the bug this return type exists to close:
 * an EMFILE during a process blowup (the runaway scenario findOrphanJobs's
 * own comment below cites — 1,073 processes in 9 minutes) would otherwise
 * read as "no active members" and hand a live job straight to the reaper.
 *
 * Extracted from cmdClean's own active-member guard so findOrphanJobs (layer
 * 3, below) can reuse the EXACT same predicate cmdClean's guard (layer 2)
 * uses — the two layers must agree on what "live progress" means, or one
 * layer treats a job as active while the other treats it as orphaned. They
 * share the predicate but not the indeterminate handling: layer 3
 * (findOrphanJobs) skips the job and reports to stderr rather than guessing;
 * layer 2 (cmdClean) refuses the operation via its existing active-member
 * guard, recoverable with --force. Both point the same direction — never
 * destroy on a null verdict — because a false "not orphaned"/false "refused"
 * is recoverable, and a false "orphaned"/false "deleted" is not.
 */
export function findActiveMembers(entitiesDir: string): string[] | null {
	const activeMemberStates = new Set(["awaiting_resume", "running", "queued", "retrying"]);
	if (!fs.existsSync(entitiesDir)) return [];
	let members: string[];
	try {
		members = fs.readdirSync(entitiesDir);
	} catch {
		// Can't read the entities dir at all — indeterminate, not "no active
		// members". Callers already validated the path via their own guards;
		// this is a runtime read failure (permission/EMFILE/I-O), not a bad path.
		return null;
	}
	const active: string[] = [];
	for (const e of members) {
		const statusPath = path.join(entitiesDir, e, "status.json");
		const status = readJsonIfExists(statusPath);
		if (!isRecord(status)) {
			// readJsonIfExists collapses "absent" and "exists but unreadable/
			// unparseable" into the same null — distinguish here. A status.json
			// that exists but doesn't come back as a record is indeterminate,
			// not inactive; a genuinely absent status.json (member hasn't
			// written one yet) stays inactive, same as before.
			if (fs.existsSync(statusPath)) return null;
			continue;
		}
		const state = typeof status.state === "string" ? status.state : "";
		if (!activeMemberStates.has(state)) continue;
		if (state === "running" && isRunningStatusStale(status, statusPath)) continue;
		active.push(e);
	}
	return active;
}

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
			let startTs: number;
			if (status.lastHeartbeat) {
				startTs = toEpochMs(status.lastHeartbeat);
			} else if (status.startedAt) {
				startTs = toEpochMs(status.startedAt);
			} else {
				try {
					startTs = fs.statSync(statusPath).mtimeMs;
				} catch {
					startTs = Date.now();
				}
			}
			const isStale = isRunningStatusStale(status, statusPath);

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

// Cap on waiting for a stopped member's own exit — must not hang indefinitely.
const STOP_WAIT_CAP_MS = 10_000;

export async function cmdStop(
	_options: Record<string, unknown>,
	jobDir: string,
	config: JobConfig,
): Promise<void> {
	const resolvedJobDir = path.resolve(jobDir);
	const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);
	if (!fs.existsSync(entitiesRoot))
		exitWithError(`No ${config.entityDirName} folder found: ${entitiesRoot}`);

	// Wait axis: whether status.pid exists, not whether process.kill actually succeeded.
	// worker-utils.ts writes status.json in two steps (state:"running" first with pid:null,
	// then again with the real child.pid once the CLI child is spawned) — a member read in
	// that gap has no pid to signal, so waiting on it can't hasten its exit, only babysit the
	// CLI's own natural run to completion.
	let hadRunning = false;
	const waitEntries: string[] = [];
	for (const entry of fs.readdirSync(entitiesRoot)) {
		const statusPath = path.join(entitiesRoot, entry, "status.json");
		const status = readJsonIfExists(statusPath);
		if (!isRecord(status)) continue;
		if (status.state !== "running") continue;
		hadRunning = true;

		if (status.pid) {
			try {
				process.kill(Number(status.pid), "SIGTERM");
			} catch {
				// ESRCH: child already exited, but the worker itself hasn't flipped state yet
				// (it's still parsing output) — still wait for that transition (bcb6c50d).
			}
			waitEntries.push(entry);
		}
		// else: no pid recorded yet — no handle to signal, and cmdStop's own pid is never
		// persisted anywhere either (generic-job.ts spawns the worker detached + unref()s it),
		// so there's nothing to wait on. Not waiting here is not a regression: main never
		// waited on this member either, since it wasn't in the running set with a pid.
	}

	const stillRunning = (entry: string): boolean => {
		const status = readJsonIfExists(path.join(entitiesRoot, entry, "status.json"));
		return isRecord(status) && status.state === "running";
	};
	const waitStart = Date.now();
	while (waitEntries.some(stillRunning) && Date.now() - waitStart < STOP_WAIT_CAP_MS) {
		await sleepMs(250);
	}

	const manifest = buildManifest(jobDir, config);
	const stopMessage = !hadRunning
		? `stop: no running ${config.entityPlural}\n`
		: waitEntries.length > 0
			? `stop: sent SIGTERM to running ${config.entityPlural}\n`
			: `stop: running ${config.entityPlural} found but none had a pid to signal\n`;
	process.stdout.write(`${stopMessage}${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// PGID witness verification — shared by cmdClean (layer 2) and
// findOrphanJobs (layer 3) below.
//
// The recorded PGID number alone does not prove ownership. Layer 1
// (reapOwnProcessGroup, lib/worker-utils.ts) SIGKILLs the worker's own group
// on its normal exit path, which immediately frees that PGID number back to
// the OS — but job.json keeps holding it until clean/reap runs, up to
// GC_MAX_AGE_MS (1 hour) later. Measured on this host: PIDs progress ~862/s,
// and the ~99999-wide macOS PID space wraps in roughly two minutes — so
// "this PGID is alive" within that hour-long window is a claim about a
// *number*, not about *this job's worker*. Signaling on that claim alone
// risks killing whatever unrelated process now owns the number (an editor,
// another agent session, a build) — the exact failure "오살보다 미회수"
// (under-reaping over mis-killing) exists to prevent.
//
// The fix: record the leader process's own start time (`ps -o lstart=`) at
// spawn time (SpawnedWorker.workerPgidStartedAt, above), then re-check it
// against the *current* leader's start time before ever signaling.
// ---------------------------------------------------------------------------

/**
 * One-shot snapshot of every live process's pgid/pid/start-time, from a
 * single `ps -A` call — reused for every candidate in one sweep, same
 * reasoning as the existing single-call `ps -A` pattern below
 * (findOrphanJobs' comment (ii)) rather than one subprocess per candidate
 * PGID.
 *
 * Two views over the same rows:
 * - `leaderStartTimes`: the start time of the live process-group LEADER
 *   (the row where pid === pgid — a worker's PGID always equals its own
 *   leader PID, spawnWorkers' detached-spawn contract above) for a given
 *   PGID, if a leader is currently alive under that number at all.
 * - `memberStartTimes`: the start times of EVERY live row currently under a
 *   given PGID (the leader row too, when alive). This is what lets
 *   judgePgidSignal recover a group whose LEADER died (SIGKILL, panic, OOM)
 *   while its descendants (a spawned `codex exec`, an MCP server) are still
 *   alive under the same PGID — no leader row exists to compare a start
 *   time against, but the surviving descendants' own start times are still
 *   usable for a partial identity check (see judgePgidSignal below).
 *
 * `LC_ALL=C` pins the `lstart` rendering to a fixed format regardless of the
 * calling process's own locale. The witness this produces is recorded once,
 * in one process's environment (cmdStart, via getProcessStartedAt above),
 * and re-checked later from a different process's environment (the
 * SessionStart hook's detached `bun`) — without a fixed locale on both
 * sides, the same real process can render as two different strings and
 * every re-check becomes a permanent, silent "mismatch".
 *
 * Throws on `ps` failure so callers can distinguish "no live processes"
 * from "couldn't ask at all" (the latter has no basis to judge anything,
 * matching the existing `ps -A` call sites' try/catch-at-the-call-site
 * style in this file).
 */
export interface PgidSnapshot {
	leaderStartTimes: Map<number, string>;
	memberStartTimes: Map<number, string[]>;
}

export function getPgidSnapshot(): PgidSnapshot {
	const leaderStartTimes = new Map<number, string>();
	const memberStartTimes = new Map<number, string[]>();
	const psOutput = execSync("LC_ALL=C ps -o pgid=,pid=,lstart= -A", { encoding: "utf8" });
	for (const line of psOutput.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
		if (!match) continue;
		const pgid = Number(match[1]);
		const pid = Number(match[2]);
		const startedAt = match[3].trim();
		const existing = memberStartTimes.get(pgid);
		if (existing) existing.push(startedAt);
		else memberStartTimes.set(pgid, [startedAt]);
		if (pid === pgid) leaderStartTimes.set(pgid, startedAt);
	}
	return { leaderStartTimes, memberStartTimes };
}

export type PgidSignalVerdict = "signal" | "no-witness" | "leader-dead" | "mismatch";

/** Short reason string for every non-"signal" verdict — shared by cmdClean,
 *  findOrphanJobs, and reapOrphanJobs's post-grace re-check so a skipped
 *  candidate is always reported with the same wording regardless of which
 *  layer skipped it (defect: a skip used to be silent outside "mismatch"). */
export function pgidVerdictReason(verdict: PgidSignalVerdict): string {
	switch (verdict) {
		case "no-witness":
			return "no spawn-time witness recorded (old-format job.json, or the spawn-time ps lookup failed)";
		case "leader-dead":
			return "no live process verified as this job's own PGID group (either the group is gone entirely, or its surviving descendants predate this job's own recorded spawn time)";
		case "mismatch":
			return "recorded witness does not match the current process's start time (PID/PGID reused by an unrelated process)";
		case "signal":
			return "verified";
	}
}

/**
 * Judge whether it is safe to send a signal to `pgid`, given the spawn-time
 * witness recorded in job.json (workerPgidStartedAt) and a snapshot of every
 * currently-live process's pgid/start-time (getPgidSnapshot above). cmdClean
 * and findOrphanJobs both call this exact function so the two layers can
 * never disagree about what is safe to reap — same reasoning as
 * isRunningStatusStale/findActiveMembers's shared-predicate extraction.
 *
 * - "no-witness": recordedStartedAt is null (old-format job, or the spawn-
 *   time `ps` lookup failed) — nothing to verify against, so don't signal.
 * - "mismatch": a live leader owns this PGID number, but its start time
 *   differs from the recorded witness — the number was reused by an
 *   unrelated process. Signaling here would be exactly the mis-kill this
 *   witness exists to prevent.
 * - "signal": either (a) the live leader's start time matches the recorded
 *   witness, or (b) no leader is alive under this PGID at all, but every
 *   live descendant under it started AFTER the recorded leader spawn time —
 *   a partial identity check for the leader-died-but-group-lives case (see
 *   below).
 * - "leader-dead": no live process at all is verified as ours under this
 *   PGID — either nothing is alive under the number, or something is alive
 *   but at least one live descendant started BEFORE the recorded leader
 *   spawn time (this PGID predates our own spawn, so it cannot be our
 *   group).
 *
 * Why the leader-died-but-group-lives fallback exists: a worker's PGID
 * equals its own leader PID, so a dead leader used to mean "no row in the
 * snapshot has pid === pgid" → treated as "leader-dead" unconditionally,
 * even when the group's own descendants (a spawned `codex exec`, an MCP
 * server) are still alive under that same PGID. That is exactly the SIGKILL
 * / panic / OOM case layer 3 exists for — under the old rule those groups
 * were never reaped at all. The fallback recovers them without a full
 * identity re-verification (there is no live leader row left to compare a
 * start time against): if NO live descendant predates the recorded leader
 * spawn time, nothing here contradicts "this is still our group with its
 * leader gone", so it's treated the same as "signal".
 *
 * Residual risk, recorded rather than closed (오살보다 미회수 — under-
 * reaping over mis-killing is the accepted direction): if this exact PGID
 * number is reused by an entirely unrelated NEW group after our worker's
 * true leader died, and THAT new group's own leader also dies while its
 * descendants (all started after our recordedStartedAt) remain, this
 * fallback cannot tell the two groups apart and would reap the wrong one.
 * This only narrows one specific, previously-total blind spot (leader-dead
 * orphans were never reaped at all); it does not weaken the mismatch check
 * above, which still catches the far more common case of a live replacement
 * leader with a different start time.
 */
export function judgePgidSignal(
	pgid: number,
	recordedStartedAt: string | null,
	snapshot: PgidSnapshot,
): PgidSignalVerdict {
	if (recordedStartedAt === null) return "no-witness";
	const leaderStartedAt = snapshot.leaderStartTimes.get(pgid);
	if (leaderStartedAt !== undefined) {
		return leaderStartedAt === recordedStartedAt ? "signal" : "mismatch";
	}
	const memberStarts = snapshot.memberStartTimes.get(pgid);
	if (!memberStarts || memberStarts.length === 0) return "leader-dead";
	const recordedMs = toEpochMs(recordedStartedAt);
	// Fail closed, same as the rest of this witness system: an unparseable
	// recorded witness gives no basis to compare against, so it must not be
	// treated as "no member predates it" (NaN comparisons are always false).
	if (Number.isNaN(recordedMs)) return "no-witness";
	const anyMemberPredatesRecorded = memberStarts.some((startedAt) => {
		const memberMs = toEpochMs(startedAt);
		// An unparseable member start time is treated as predating the
		// recorded witness (the exclusion direction) rather than silently
		// dropped by the same NaN-comparison asymmetry.
		return Number.isNaN(memberMs) || memberMs < recordedMs;
	});
	return anyMemberPredatesRecorded ? "leader-dead" : "signal";
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
	// Judgment lives in findActiveMembers, shared with findOrphanJobs (layer 3)
	// below — see that function's own predicate for why the two layers must agree.
	if (!options["force"]) {
		const entitiesDir = path.join(resolvedJobDir, config.entityDirName);
		const activeEntries = findActiveMembers(entitiesDir);
		if (activeEntries === null) {
			exitWithError(
				`clean: could not determine whether ${config.entityPlural} in ${entitiesDir} are active (entities dir or a member's status.json could not be read) — refusing to delete on an indeterminate activity read; use force option to override`,
			);
		}
		if (activeEntries.length > 0) {
			exitWithError(
				`clean: refusing to delete job dir with active ${config.entityPlural}: ${activeEntries.join(", ")} — use force option to override`,
			);
		}
	}

	// Reap each member's process group before deleting the directory. Anchor
	// is job.json's members[].workerPgid (written by cmdStart's spawnWorkers,
	// e.g. skills/orchestrate-review/scripts/job.ts) — never status.json's
	// `pid`, which is the codex-exec child's pid, not the worker's own PGID.
	// Absent/null workerPgid (or an unreadable job.json) means "don't know
	// what to kill" — skip the kill entirely rather than guess. Under-reaping
	// (a process leaks) is the safe failure here; over-reaping (killing a
	// process this job never owned) is not, and this function only ever has
	// this one jobDir's own job.json to go on.
	const jobMetaForKill = readJsonIfExists(path.join(resolvedJobDir, "job.json"));
	const membersForKill =
		isRecord(jobMetaForKill) && Array.isArray(jobMetaForKill.members) ? jobMetaForKill.members : [];
	const memberWitnessesForKill = membersForKill
		.map((m) => {
			if (!isRecord(m)) return null;
			const pgid = m.workerPgid;
			if (!(typeof pgid === "number" && Number.isInteger(pgid) && pgid > 0)) return null;
			const startedAt = typeof m.workerPgidStartedAt === "string" ? m.workerPgidStartedAt : null;
			return { pgid, startedAt };
		})
		.filter((m): m is { pgid: number; startedAt: string | null } => m !== null);

	// Members with no valid workerPgid recorded at all (some skills never
	// wire up this anchor) never reach the witness loop below, so they used
	// to vanish silently. Report each one here, before this job's directory
	// (their only ownership anchor) is deleted — same reasoning as the
	// per-verdict report inside the loop below.
	for (const m of membersForKill) {
		if (!isRecord(m)) continue;
		const pgid = m.workerPgid;
		if (typeof pgid === "number" && Number.isInteger(pgid) && pgid > 0) continue;
		const name = typeof m.name === "string" ? m.name : "<unknown>";
		process.stderr.write(
			`clean: no workerPgid recorded for member "${name}" in ${resolvedJobDir} — ${pgidVerdictReason("no-witness")}; cannot verify or signal any process for it. This job's directory is about to be deleted, so this becomes unrecoverable by any reap layer after this.\n`,
		);
	}

	// The witness check itself needs a `ps` snapshot — if that fails, there is
	// no basis to verify anything, so every candidate below resolves to
	// "leader-dead" (empty maps) and nothing gets signaled. Fail closed, same
	// as the rest of this witness system.
	let snapshotForKill: PgidSnapshot;
	try {
		snapshotForKill = getPgidSnapshot();
	} catch {
		snapshotForKill = { leaderStartTimes: new Map(), memberStartTimes: new Map() };
	}

	const pgidsToKill: number[] = [];
	for (const { pgid, startedAt } of memberWitnessesForKill) {
		const verdict = judgePgidSignal(pgid, startedAt, snapshotForKill);
		if (verdict !== "signal") {
			// Report every skip, not just "mismatch" — cmdClean is about to
			// destroy this job's own job.json, the only ownership anchor every
			// reap layer (including this one) depends on. Once that happens, a
			// still-alive process group under this pgid becomes unrecoverable
			// by any layer, so a silent skip here is the worst place for one.
			process.stderr.write(
				`clean: skipping pgid ${pgid} for ${resolvedJobDir} (verdict: ${verdict}) — ${pgidVerdictReason(verdict)}; not signaling. This job's directory is about to be deleted, so this process group becomes unrecoverable by any reap layer after this.\n`,
			);
			continue;
		}
		pgidsToKill.push(pgid);
	}

	for (const pgid of pgidsToKill) {
		// No grace period between SIGTERM and SIGKILL, unlike
		// reapOwnProcessGroup's self-reap: that 5s grace period exists to let
		// a live worker exit cleanly on its own normal path, but a member
		// that reaches this guard is already terminal or heartbeat-stale (the
		// active-member guard above only lets those through), so there is no
		// still-working process here to give a grace period to.
		try {
			process.kill(-pgid, "SIGTERM");
		} catch {
			/* ESRCH: group already empty — nothing to reap */
		}
		try {
			process.kill(-pgid, "SIGKILL");
		} catch {
			/* ESRCH: group already empty — nothing to reap */
		}
	}

	// Report-only pass: cmdClean is not the leader of any of these groups
	// (unlike reapOwnProcessGroup, which signals its own group), so it has no
	// basis for deciding what a surviving process actually is or whether
	// escalating further is safe. Report to stderr and stop — a human or the
	// layer-3 orphan reaper decides from here.
	if (pgidsToKill.length > 0) {
		try {
			const psOutput = execSync("ps -o pgid=,pid= -A", { encoding: "utf8" });
			const pgidSet = new Set(pgidsToKill);
			const survivingPids: string[] = [];
			for (const line of psOutput.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				const [pgidStr, pidStr] = trimmed.split(/\s+/);
				if (pgidSet.has(Number(pgidStr))) survivingPids.push(pidStr);
			}
			if (survivingPids.length > 0) {
				process.stderr.write(
					`clean: ${survivingPids.length} process(es) survived group kill for ${resolvedJobDir}: pid ${survivingPids.join(", ")}\n`,
				);
			}
		} catch {
			// ps unavailable or failed — best-effort reporting only, never block clean
		}
	}

	fs.rmSync(resolvedJobDir, { recursive: true, force: true });
	process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// ---------------------------------------------------------------------------
// Orphan process-group reaper — layer 3 of the 3-layer defense.
//
// Layer 1 (reapOwnProcessGroup, lib/worker-utils.ts) only runs if a worker
// reaches its own normal teardown path. Layer 2 (cmdClean's group-kill above)
// only runs if the conductor (the LLM session driving the job) reaches ITS
// teardown and calls clean. When a worker dies by SIGKILL, panic, or OOM,
// neither layer runs and the worker's process group is orphaned — this layer
// sweeps those up independently of any conductor ever running again.
//
// (i) Why this is NOT a PPID-based orphan check. The obvious-looking rule
// "PGID is alive but has no parent (PPID=1)" was tried and falsified by
// direct measurement on this host: workers are spawned with `detached: true`
// + `child.unref()`, and the CLI that spawns them (job.ts start) returns
// immediately and exits, so the worker's own parent disappears within
// seconds — reparenting EVERY healthy worker to PPID=1, not just orphaned
// ones. Measured: spawn a detached child, kill the parent immediately, then
// `ps -o pid=,ppid=,pgid=` on the child → `28309  1  28309` — PPID=1,
// PGID=self. That is the normal steady state of a healthy running worker,
// not an orphan signal; a PPID=1 rule would kill every healthy review
// worker within seconds of dispatch. The actual anchor is job.json's
// members[].workerPgid (the same anchor cmdClean already uses above)
// combined with the job's own progress state: a PGID group that is alive
// while its job has NO live progress (findActiveMembers, shared with
// cmdClean) is the orphan signal — not process ancestry.
// ---------------------------------------------------------------------------

export interface OrphanJob {
	jobDir: string;
	pgids: number[];
	/** Recorded workerPgidStartedAt witness for each entry in `pgids`, same
	 *  index alignment. Carried through (rather than re-derived) so
	 *  reapOrphanJobs can re-verify PGID identity again after the SIGTERM→
	 *  SIGKILL grace wait, not just once at judgment time here — the wait is
	 *  exactly the window in which a freed PGID number can be handed to an
	 *  unrelated new process (see reapOrphanJobs below). Optional (not just
	 *  index-safe when absent) so a consumer constructing an OrphanJob-shaped
	 *  literal without this field — e.g. a test exercising a narrower
	 *  {jobDir, pgids} view — still type-checks; findOrphanJobs itself always
	 *  populates it. Always non-null per entry when present: every pgid
	 *  landing in `pgids` already passed judgePgidSignal with a non-null
	 *  recordedStartedAt (verdict "signal" requires it). */
	witnesses?: string[];
}

/** Production default grace period between SIGTERM and SIGKILL — matches the
 *  value layer 1 (reapOwnProcessGroup) and the timeout-escalation path
 *  already use; not a newly-invented number. */
export const REAP_GRACE_MS_DEFAULT = 5000;

/**
 * Judge which jobs under jobsDir are orphaned: their recorded process group
 * is alive, but the job itself has no live progress left (findActiveMembers
 * returns none — every member is terminal, `running` with a stale heartbeat,
 * or has no status.json at all). Pure judgment — no kill, no delete.
 * reapOrphanJobs and doctorOrphanJobs both call this exact function so the
 * two engines can never disagree about what counts as orphaned.
 */
export function findOrphanJobs(jobsDir: string, config: JobConfig): OrphanJob[] {
	const orphans: OrphanJob[] = [];

	let resolvedJobsDir: string;
	let entries: string[];
	try {
		resolvedJobsDir = fs.realpathSync(jobsDir);
		entries = fs.readdirSync(jobsDir);
	} catch {
		return orphans;
	}

	// (ii) One `ps` call for the whole sweep, not one per job. jobsDir can hold
	// many stale job directories at once — this is exactly the runaway
	// scenario this layer exists for (1,073 processes across many jobs in 9
	// minutes) — so spawning `ps -A` once and reusing the parsed snapshot for
	// every candidate job avoids an O(job count) subprocess-spawn fan-out for
	// what is fundamentally one snapshot-in-time liveness+identity question.
	// This snapshot also carries start times, not just liveness — see
	// judgePgidSignal above for why liveness alone is not enough to prove
	// ownership.
	let snapshot: PgidSnapshot;
	try {
		snapshot = getPgidSnapshot();
	} catch {
		// ps unavailable — no basis to judge liveness, so no basis to reap.
		return orphans;
	}

	for (const entry of entries) {
		if (!entry.startsWith(config.jobPrefix)) continue;

		const candidatePath = path.join(jobsDir, entry);

		// Path traversal guard — same pattern as gcStaleJobs above.
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
		if (!isRecord(jobMeta)) continue;

		const members = Array.isArray(jobMeta.members) ? jobMeta.members : [];
		const memberWitnesses = members
			.map((m) => {
				if (!isRecord(m)) return null;
				const pgid = m.workerPgid;
				if (!(typeof pgid === "number" && Number.isInteger(pgid) && pgid > 0)) return null;
				const startedAt = typeof m.workerPgidStartedAt === "string" ? m.workerPgidStartedAt : null;
				return { pgid, startedAt };
			})
			.filter((m): m is { pgid: number; startedAt: string | null } => m !== null);

		// Members with no valid workerPgid recorded at all never reach the
		// witness loop above and used to vanish silently — report each one,
		// mirroring cmdClean's report, before falling through to the skip
		// below.
		for (const m of members) {
			if (!isRecord(m)) continue;
			const pgid = m.workerPgid;
			if (typeof pgid === "number" && Number.isInteger(pgid) && pgid > 0) continue;
			const name = typeof m.name === "string" ? m.name : "<unknown>";
			process.stderr.write(
				`orphan-reaper: no workerPgid recorded for member "${name}" in ${candidatePath} — ${pgidVerdictReason("no-witness")}; not signaling\n`,
			);
		}
		// No workerPgid recorded at all — no basis to judge this job, skip it.
		if (memberWitnesses.length === 0) continue;

		const signalablePgids: number[] = [];
		const signalableWitnesses: string[] = [];
		for (const { pgid, startedAt } of memberWitnesses) {
			const verdict = judgePgidSignal(pgid, startedAt, snapshot);
			if (verdict !== "signal") {
				process.stderr.write(
					`orphan-reaper: skipping pgid ${pgid} in ${candidatePath} (verdict: ${verdict}) — ${pgidVerdictReason(verdict)}; not signaling\n`,
				);
				continue;
			}
			// startedAt is guaranteed non-null here — judgePgidSignal only
			// returns "signal" when recordedStartedAt !== null.
			if (startedAt !== null) {
				signalablePgids.push(pgid);
				signalableWitnesses.push(startedAt);
			}
		}
		// Recorded group isn't actually alive under a verified identity —
		// nothing to reap here.
		if (signalablePgids.length === 0) continue;

		// The job still has live progress — it's working normally, not orphaned.
		const entitiesDir = path.join(candidatePath, config.entityDirName);
		const activeMembers = findActiveMembers(entitiesDir);
		if (activeMembers === null) {
			// Couldn't determine activity (entities dir or a member's
			// status.json could not be read) — this is NOT evidence of "no
			// activity". A live, identity-verified process group would
			// otherwise be handed to the reaper on an unreadable directory
			// alone; report it and skip instead of guessing.
			process.stderr.write(
				`orphan-reaper: could not determine active members for ${candidatePath} — entities dir or a member's status.json could not be read; treating as not orphaned, not signaling\n`,
			);
			continue;
		}
		if (activeMembers.length > 0) continue;

		orphans.push({ jobDir: candidatePath, pgids: signalablePgids, witnesses: signalableWitnesses });
	}

	return orphans;
}

/**
 * Reap every orphan job's process group: SIGTERM, wait opts.graceMs (default
 * REAP_GRACE_MS_DEFAULT), then SIGKILL. Does NOT delete job directories —
 * that remains cmdClean's job on its own next run. (iii) A final `ps` pass
 * collects whatever survives both signals and reports it to stderr only —
 * this function is not the leader of any of these groups (unlike
 * reapOwnProcessGroup, which signals its own group), so — like cmdClean's own
 * report-only pass above — it has no basis to judge what a surviving process
 * actually is or whether killing it again would be safe. Escalating past
 * SIGKILL is a decision for a human or a future layer, not this one.
 *
 * (iv) Re-verifies identity again after the grace wait, before ever sending
 * SIGKILL — findOrphanJobs already verified identity once, but that
 * judgment is only as fresh as the snapshot it was taken from. The SIGTERM
 * above can itself end the group during the wait (its whole point, on the
 * normal path), freeing its PGID number back to the OS — and the wait is
 * long enough (REAP_GRACE_MS_DEFAULT is 5s; this host's own measured PID
 * churn is ~862/s) for that number to be handed to an unrelated new
 * process before SIGKILL fires. SIGKILL-ing on the pre-wait judgment alone
 * would be exactly the mis-kill this whole witness system exists to
 * prevent, just moved one signal later. `opts.getSnapshotFn` exists purely
 * so a test can fabricate that post-wait world deterministically instead of
 * waiting on real, non-deterministic PID reuse.
 */
export async function reapOrphanJobs(
	jobsDir: string,
	config: JobConfig,
	opts: { graceMs?: number; getSnapshotFn?: () => PgidSnapshot } = {},
): Promise<{ reaped: OrphanJob[]; survivingPids: number[] }> {
	const orphans = findOrphanJobs(jobsDir, config);
	const graceMs = opts.graceMs ?? REAP_GRACE_MS_DEFAULT;
	const getSnapshot = opts.getSnapshotFn ?? getPgidSnapshot;

	for (const orphan of orphans) {
		for (const pgid of orphan.pgids) {
			try {
				process.kill(-pgid, "SIGTERM");
			} catch {
				/* ESRCH: group already empty */
			}
		}
	}

	// Zero orphans means nothing was signaled above — waiting out the grace
	// period anyway would idle a background process (e.g. the SessionStart
	// hook's detached reap) for no reason on every session start, which fights
	// the exact process-accumulation problem this reaper exists to fix.
	if (orphans.length > 0 && graceMs > 0) await sleepMs(graceMs);

	if (orphans.length > 0) {
		// See (iv) above: re-snapshot and re-judge every candidate against its
		// own carried witness before escalating to SIGKILL. Snapshot failure
		// degrades to empty maps — same fail-closed posture as every other `ps`
		// call in this witness system — so every candidate resolves to
		// "leader-dead"/"no-witness" and nothing gets SIGKILLed on a failed ask.
		let postGraceSnapshot: PgidSnapshot;
		try {
			postGraceSnapshot = getSnapshot();
		} catch {
			postGraceSnapshot = { leaderStartTimes: new Map(), memberStartTimes: new Map() };
		}

		for (const orphan of orphans) {
			for (let i = 0; i < orphan.pgids.length; i++) {
				const pgid = orphan.pgids[i];
				const startedAt = orphan.witnesses?.[i] ?? null;
				const verdict = judgePgidSignal(pgid, startedAt, postGraceSnapshot);
				if (verdict !== "signal") {
					process.stderr.write(
						`reap: skipping SIGKILL for pgid ${pgid} in ${orphan.jobDir} after grace period (verdict: ${verdict}) — ${pgidVerdictReason(verdict)}; not signaling\n`,
					);
					continue;
				}
				try {
					process.kill(-pgid, "SIGKILL");
				} catch {
					/* ESRCH: group already empty */
				}
			}
		}
	}

	const survivingPids: number[] = [];
	const allPgids = orphans.flatMap((o) => o.pgids);
	if (allPgids.length > 0) {
		try {
			const psOutput = execSync("ps -o pgid=,pid= -A", { encoding: "utf8" });
			const pgidSet = new Set(allPgids);
			for (const line of psOutput.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				const [pgidStr, pidStr] = trimmed.split(/\s+/);
				if (pgidSet.has(Number(pgidStr))) survivingPids.push(Number(pidStr));
			}
		} catch {
			// ps unavailable or failed — best-effort reporting only, never throw.
		}
	}
	if (survivingPids.length > 0) {
		process.stderr.write(
			`reap: ${survivingPids.length} process(es) survived group kill: pid ${survivingPids.join(", ")}\n`,
		);
	}

	return { reaped: orphans, survivingPids };
}

/**
 * Count-only view of findOrphanJobs — never kills, never deletes. Calls the
 * exact same findOrphanJobs reapOrphanJobs calls, so `doctor` and `reap`
 * can never disagree about what counts as orphaned.
 */
export function doctorOrphanJobs(
	jobsDir: string,
	config: JobConfig,
): { orphanJobCount: number; orphanPgidCount: number; orphans: OrphanJob[] } {
	const orphans = findOrphanJobs(jobsDir, config);
	const orphanPgidCount = orphans.reduce((sum, o) => sum + o.pgids.length, 0);
	return { orphanJobCount: orphans.length, orphanPgidCount, orphans };
}

// ---------------------------------------------------------------------------
// Command: collect — blocking poll until done
// ---------------------------------------------------------------------------

const COLLECT_POLL_INTERVAL_MS = 5000;
const COLLECT_TIMEOUT_HARDCAP_MS = 600000;

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
		// awaiting_resume already ended its own turn — further polling cannot change it.
		if (status.overallState === "done" || status.overallState === "awaiting_resume") {
			const manifest = buildManifest(jobDir, config);
			process.stdout.write(
				`${JSON.stringify({ overallState: status.overallState, ...manifest }, null, 2)}\n`,
			);
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

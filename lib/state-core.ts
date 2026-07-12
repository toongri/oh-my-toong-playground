/**
 * Shared state spine for goal, ultragoal, prometheus, and deep-interview skill CLIs.
 *
 * Exports:
 *   nowStamp()                    — ISO-seconds timestamp, round-trips BSD/GNU date parser
 *   isSafeSessionId(id)           — validates ^[A-Za-z0-9_-]+$, length 1..200
 *   resolveSessionIdOrThrow()     — reads OMT_SESSION_ID env (fallback: CODEX_THREAD_ID), throws if absent/unsafe
 *   mergeWithHeartbeat(p, q)      — {...p, ...q, last_touched_at: nowStamp()}
 *   ACTIVE_IDLE_TTL_SECONDS       — 21600 (6 hours) — TS definition site (parity-tested vs bash)
 *   TERMINAL_TTL_SECONDS          — 1800 (30 minutes) — TS definition site
 *   isStateLive(parsed, nowEpoch) — Single liveness rule; fallback: last_touched_at → started_at
 *   STATE_PREFIX                  — type → filename prefix map
 *   listOthers(type)              — ACTIVE-live non-pristine other-session candidates
 *   adopt(type, srcSid)           — atomic rename re-key, rules r1-r8
 *   restampAfterAdopt(path)       — post-rename heartbeat re-stamp via writeFileNoCreate
 *   writeFileNoCreate(path, s)    — single-syscall no-create write (ENOENT if absent)
 *   isPristine(type, parsed)      — true iff state is freshly seeded, safe for adoption overwrite
 *
 * Sid is derived from FILENAME ONLY — never read a session-id field from file content.
 * This module does NOT create state files; adoption may only rename existing ones.
 */

import {
	readdirSync,
	readFileSync,
	renameSync,
	appendFileSync,
	existsSync,
	openSync,
	ftruncateSync,
	writeSync,
	closeSync,
} from "fs";
import { join } from "path";
// lib-internal imports must be relative — deployed copies under .claude/lib/ have no @lib alias
// (the sync alias-rewriter skips lib/** files). Relative imports let `make sync`'s dep collector
// follow the path and deploy omt-dir alongside this module.
import { getOmtDir } from "./omt-dir";

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

/**
 * Returns the current local time as an ISO-8601 string with seconds precision
 * and explicit timezone offset — matching `date -Iseconds` output.
 * Format: YYYY-MM-DDTHH:MM:SS±HH:MM
 * The bash GC parser (session-start.sh:80) strips the timezone before feeding
 * to `date -j -f "%Y-%m-%dT%H:%M:%S"` (BSD) or `date -d` (GNU).
 */
export function nowStamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	// getTimezoneOffset returns minutes west of UTC; negative = east
	const tzOffset = -d.getTimezoneOffset(); // minutes east of UTC
	const tzSign = tzOffset >= 0 ? "+" : "-";
	const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
	const tzM = pad(Math.abs(tzOffset) % 60);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${tzSign}${tzH}:${tzM}`
	);
}

// ---------------------------------------------------------------------------
// Safe session ID
// ---------------------------------------------------------------------------

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_ID_MAX = 200;

/**
 * Returns true iff `id` is a safe session id: matches ^[A-Za-z0-9_-]+$
 * and has length 1..200. No dots, slashes, spaces — prevents path traversal.
 */
export function isSafeSessionId(id: string): boolean {
	return id.length >= 1 && id.length <= SAFE_ID_MAX && SAFE_ID_RE.test(id);
}

/**
 * Reads OMT_SESSION_ID from env; falls back to CODEX_THREAD_ID when OMT_SESSION_ID
 * is absent. OMT_SESSION_ID is authoritative: when present, it is validated and
 * returned without ever falling through to CODEX_THREAD_ID, even if unsafe.
 * Throws if neither is set, or if the value in use is unsafe.
 * Skill CLIs (TypeScript) call this at startup; they hard-fail on bad sid.
 */
export function resolveSessionIdOrThrow(): string {
	const omtSid = process.env["OMT_SESSION_ID"];
	if (omtSid) {
		if (!isSafeSessionId(omtSid)) {
			throw new Error(
				`OMT_SESSION_ID "${omtSid}" is not a safe session id (must match ^[A-Za-z0-9_-]+$, length 1..200).`,
			);
		}
		return omtSid;
	}
	const codexSid = process.env["CODEX_THREAD_ID"];
	if (codexSid) {
		if (!isSafeSessionId(codexSid)) {
			throw new Error(
				`CODEX_THREAD_ID "${codexSid}" is not a safe session id (must match ^[A-Za-z0-9_-]+$, length 1..200).`,
			);
		}
		return codexSid;
	}
	throw new Error("No session id: neither OMT_SESSION_ID (Claude) nor CODEX_THREAD_ID (Codex) is set.");
}

// ---------------------------------------------------------------------------
// Heartbeat merge
// ---------------------------------------------------------------------------

/**
 * Merges `partial` over `prior` and sets `last_touched_at` to `nowStamp()`.
 * Every state writer calls this — heartbeat is always refreshed on any write.
 */
export function mergeWithHeartbeat<T extends object>(
	prior: T,
	partial: Partial<T>,
): T & { last_touched_at: string } {
	return { ...prior, ...partial, last_touched_at: nowStamp() };
}

// ---------------------------------------------------------------------------
// TTL constants (the TS definition site — parity-tested against bash spine in TODO 2)
// ---------------------------------------------------------------------------

/** Active-session idle TTL: 6 hours. State is LIVE iff active AND idle < this. */
export const ACTIVE_IDLE_TTL_SECONDS = 21600;

/** Terminal-session TTL: 30 minutes. State is LIVE iff !active AND idle < this. */
export const TERMINAL_TTL_SECONDS = 1800;

// ---------------------------------------------------------------------------
// Liveness predicate (Single liveness rule)
// ---------------------------------------------------------------------------

/**
 * The Single liveness rule (defined here; every other consumer references this).
 *
 * A state is live iff:
 *   active && idle < ACTIVE_IDLE_TTL_SECONDS, OR
 *   !active && idle < TERMINAL_TTL_SECONDS
 * where idle = nowEpoch − epochFromTimestamp(touched).
 *
 * Fallback chain for touched timestamp (bash parity: state-liveness.sh):
 *   last_touched_at → started_at → (both absent/unparseable) → return false
 * Note: the bash spine also falls back to file mtime, but that requires a file
 * path which this function does not receive — the two-step chain is the full
 * TS-applicable parity.
 *
 * @param parsed    The parsed state object (.active, .last_touched_at, .started_at).
 * @param nowEpoch  Current Unix epoch seconds.
 */
export function isStateLive(
	parsed: { active?: boolean; last_touched_at?: string; started_at?: string },
	nowEpoch: number,
): boolean {
	// Fallback chain: last_touched_at → started_at → dead
	let touched: number | null = null;
	const lta = parsed.last_touched_at;
	if (lta) touched = parseEpoch(lta);
	if (touched === null) {
		const sa = parsed.started_at;
		if (sa) touched = parseEpoch(sa);
	}
	if (touched === null) return false;
	// Clock-skew: if touched > now, treat as live (age clamped to 0)
	const idle = Math.max(0, nowEpoch - touched);
	if (parsed.active) {
		return idle < ACTIVE_IDLE_TTL_SECONDS;
	} else {
		return idle < TERMINAL_TTL_SECONDS;
	}
}

// ---------------------------------------------------------------------------
// State-type prefix map
// ---------------------------------------------------------------------------

export type StateType = "goal" | "ultragoal" | "prometheus" | "deep-interview" | "qa";

/** Maps each stateful skill type to its state-file filename prefix. */
export const STATE_PREFIX: Record<StateType, string> = {
	goal: "goal-state-",
	ultragoal: "ultragoal-state-",
	prometheus: "prometheus-state-",
	"deep-interview": "deep-interview-active-state-",
	qa: "qa-state-",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parses an ISO-8601 string to a Unix epoch (seconds). Returns null on failure. */
function parseEpoch(iso: string): number | null {
	try {
		const t = Date.parse(iso);
		if (isNaN(t)) return null;
		return Math.floor(t / 1000);
	} catch {
		return null;
	}
}

/** Extracts the sid from a state filename given the prefix. */
function sidFromFilename(filename: string, prefix: string): string {
	// filename: `<prefix><sid>.json`
	return filename.slice(prefix.length, -".json".length);
}

/** Returns the state-file path for a given type and sid. */
function statePath(type: StateType, sid: string): string {
	return join(getOmtDir(), `${STATE_PREFIX[type]}${sid}.json`);
}

/** True iff `value` is a non-null, non-array object (i.e. a JSON "object"). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True iff `err` is an Error-shaped value carrying a Node.js `code` field. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

/** Reads and parses a state file. Returns null on missing or malformed. */
function readParsed(path: string): Record<string, unknown> | null {
	try {
		const raw = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isPlainObject(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Narrows a parsed state record down to the shape isStateLive expects, without
 * an unsafe cast. Fields with the wrong runtime type are treated as absent —
 * matches how isStateLive already only ever receives well-formed state files
 * written by this module.
 */
function toLivenessShape(parsed: Record<string, unknown>): {
	active?: boolean;
	last_touched_at?: string;
	started_at?: string;
} {
	return {
		active: typeof parsed["active"] === "boolean" ? parsed["active"] : undefined,
		last_touched_at:
			typeof parsed["last_touched_at"] === "string" ? parsed["last_touched_at"] : undefined,
		started_at: typeof parsed["started_at"] === "string" ? parsed["started_at"] : undefined,
	};
}

/** Returns the purpose string for a candidate, per type. */
function purposeFor(type: StateType, parsed: Record<string, unknown>): string {
	if (type === "goal" || type === "ultragoal") {
		return String(parsed["outcome"] ?? "");
	}
	if (type === "prometheus") {
		const planPath = String(parsed["plan_path"] ?? "");
		if (planPath !== "") return planPath;
		return String(parsed["phase"] ?? "");
	}
	if (type === "deep-interview") {
		const state = parsed["state"];
		if (isPlainObject(state)) {
			return String(state["initial_idea"] ?? "");
		}
		return "";
	}
	if (type === "qa") {
		return String(parsed["target"] ?? "");
	}
	return "";
}

// ---------------------------------------------------------------------------
// writeFileNoCreate
// ---------------------------------------------------------------------------

/**
 * Writes `content` to an existing file at `path` using a single open-truncate-write
 * sequence. Throws ENOENT if the file does not exist — callers decide whether to
 * create it. This eliminates the existsSync-then-writeFileSync TOCTOU window where
 * an adopt-rename between the two calls could resurrect an orphan file.
 */
export function writeFileNoCreate(path: string, content: string): void {
	const buf = Buffer.from(content, "utf8");
	let fd: number | undefined;
	try {
		fd = openSync(path, "r+");
		ftruncateSync(fd, 0);
		if (buf.length > 0) {
			writeSync(fd, buf, 0, buf.length, 0);
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

// ---------------------------------------------------------------------------
// Pristine predicates (ADR-2)
// ---------------------------------------------------------------------------

/**
 * Returns true iff the current-session state is "pristine" — freshly seeded,
 * no real work done — and therefore safe to be overwritten by adoption.
 *
 * Pristine definitions per type:
 *   prometheus:     phase=="S0" && plan_path==""
 *   goal/ultragoal: phase=="planning" && iteration==0 && outcome==""
 *   deep-interview: seeded file lacking the rich `state` object
 *   qa:             phase=="PRE-FLIGHT" && cycle==0 && target==""
 */
export function isPristine(type: StateType, parsed: Record<string, unknown>): boolean {
	if (type === "prometheus") {
		return (
			parsed["phase"] === "S0" &&
			parsed["plan_path"] === "" &&
			(parsed["resume_summary"] === "" || parsed["resume_summary"] === undefined)
		);
	}
	if (type === "goal" || type === "ultragoal") {
		return (
			parsed["phase"] === "planning" &&
			(parsed["iteration"] === 0 || parsed["iteration"] === undefined) &&
			(parsed["outcome"] === "" || parsed["outcome"] === undefined)
		);
	}
	if (type === "deep-interview") {
		// Pristine = seed file without the rich `state` object
		return parsed["state"] === undefined || parsed["state"] === null;
	}
	if (type === "qa") {
		return parsed["phase"] === "PRE-FLIGHT" && parsed["cycle"] === 0 && parsed["target"] === "";
	}
	return false;
}

// ---------------------------------------------------------------------------
// listOthers
// ---------------------------------------------------------------------------

export interface AdoptionCandidate {
	sid: string;
	purpose: string;
	startedAt: string;
	idleSeconds: number;
}

/**
 * Returns all ACTIVE-live candidates of the given type OTHER than the current session.
 *
 * - Reads $OMT_DIR for files matching `STATE_PREFIX[type]*`
 * - Excludes the current session's file
 * - Skips malformed files (parse-fail) without throwing
 * - Filters to ACTIVE-live only (active===true && isStateLive)
 * - Sid derived from filename only — never reads session-id from file content
 *
 * Used in adoption UX: skill presents these candidates to the user before calling adopt().
 */
export function listOthers(type: StateType): AdoptionCandidate[] {
	const omtDir = getOmtDir();
	const prefix = STATE_PREFIX[type];
	const curSid = (process.env["OMT_SESSION_ID"] ?? process.env["CODEX_THREAD_ID"]) ?? "";
	const now = Math.floor(Date.now() / 1000);

	let entries: string[];
	try {
		entries = readdirSync(omtDir);
	} catch {
		return [];
	}

	const results: AdoptionCandidate[] = [];

	for (const entry of entries) {
		if (!entry.startsWith(prefix) || !entry.endsWith(".json")) continue;
		const sid = sidFromFilename(entry, prefix);
		// Exclude current session
		if (sid === curSid) continue;
		// Parse the file — skip malformed
		const parsed = readParsed(join(omtDir, entry));
		if (parsed === null) continue;
		// Only ACTIVE-live candidates (r7 source filter)
		if (parsed["active"] !== true) continue;
		if (!isStateLive(toLivenessShape(parsed), now)) continue;
		// Pristine seeds are INERT to consumers (f9f3242): skip empty-purpose seeds
		if (isPristine(type, parsed)) continue;
		const lta = String(parsed["last_touched_at"] ?? "");
		const touched = parseEpoch(lta);
		const idleSeconds = touched !== null ? Math.max(0, now - touched) : 0;
		results.push({
			sid,
			purpose: purposeFor(type, parsed),
			startedAt: String(parsed["started_at"] ?? ""),
			idleSeconds,
		});
	}

	return results;
}

// ---------------------------------------------------------------------------
// restampAfterAdopt
// ---------------------------------------------------------------------------

/**
 * Reads the file at `path`, updates `last_touched_at`, and writes it back using
 * writeFileNoCreate — so it will throw ENOENT if the file has disappeared between
 * the rename and this call, preventing accidental file creation.
 *
 * Called by adopt's r5 best-effort heartbeat re-stamp block; also exported for
 * direct unit testing of the no-create invariant.
 */
export function restampAfterAdopt(path: string): void {
	const content = readFileSync(path, "utf8");
	const parsed: unknown = JSON.parse(content);
	if (!isPlainObject(parsed)) {
		throw new Error(`restampAfterAdopt: "${path}" does not contain a JSON object`);
	}
	const stamped = { ...parsed, last_touched_at: nowStamp() };
	writeFileNoCreate(path, JSON.stringify(stamped, null, 2));
}

// ---------------------------------------------------------------------------
// adopt
// ---------------------------------------------------------------------------

/**
 * Adopts the state from `srcSid` into the current session for `type`.
 *
 * Enforces ADR-2 rules r1–r8:
 *   r1: self-adopt refused
 *   r2: both sids safe-id validated
 *   r3: refused iff current exists AND (ACTIVE non-pristine OR malformed)
 *   r4: atomic fs.renameSync; ENOENT → throw, no mutation
 *   r5: post-rename best-effort heartbeat re-stamp via restampAfterAdopt (failure → stderr warn)
 *   r6: LIVE source adoptable (checked via isStateLive)
 *   r7: source must be ACTIVE-live (TERMINAL/stale/malformed refused)
 *   r8: source must not be pristine (pristine seeds are INERT — f9f3242)
 *
 * Sid is derived from filename only — never reads session-id from file content.
 * Does NOT create any file; only renames an existing one.
 *
 * Appends one line to $OMT_DIR/adoption.log after success:
 *   <ISO ts> <type> <srcSid> -> <curSid>
 */
export function adopt(type: StateType, srcSid: string): void {
	const curSid = resolveSessionIdOrThrow();

	// r2: validate both sids
	if (!isSafeSessionId(srcSid)) {
		throw new Error(`adopt: srcSid "${srcSid}" fails safe-id validation`);
	}
	if (!isSafeSessionId(curSid)) {
		throw new Error(`adopt: curSid "${curSid}" fails safe-id validation`);
	}

	// r1: self-adopt refused
	if (srcSid === curSid) {
		throw new Error(`adopt: self-adopt refused (srcSid === curSid === "${curSid}")`);
	}

	const omtDir = getOmtDir();
	const srcPath = statePath(type, srcSid);
	const dstPath = statePath(type, curSid);
	const now = Math.floor(Date.now() / 1000);

	// r7: source must be ACTIVE-live
	const srcParsed = readParsed(srcPath);
	if (srcParsed === null) {
		throw new Error(
			`adopt: source "${srcPath}" is missing or malformed (lost race or never existed)`,
		);
	}
	if (srcParsed["active"] !== true) {
		throw new Error(`adopt: source "${srcPath}" is not ACTIVE (r7: TERMINAL sources are refused)`);
	}
	if (!isStateLive(toLivenessShape(srcParsed), now)) {
		throw new Error(
			`adopt: source "${srcPath}" failed the liveness check (r7: TTL-expired or no parseable timestamp — only live sources are adoptable)`,
		);
	}

	// r8: source must not be pristine (pristine seeds are INERT to consumers — f9f3242)
	if (isPristine(type, srcParsed)) {
		throw new Error(
			`adopt: source "${srcPath}" is a pristine seed with no real work (r8: pristine sources are refused — nothing to adopt).`,
		);
	}

	// r3: check current session state
	if (existsSync(dstPath)) {
		const curParsed = readParsed(dstPath);
		if (curParsed === null) {
			// Malformed current — fail closed
			throw new Error(
				`adopt: current session state "${dstPath}" is malformed. ` +
					`Please manually inspect and remove it, then re-invoke the skill.`,
			);
		}
		// ACTIVE non-pristine → refuse
		if (curParsed["active"] === true && !isPristine(type, curParsed)) {
			throw new Error(
				`adopt: current session has ACTIVE non-pristine state at "${dstPath}". ` +
					`Adoption refused to avoid overwriting in-progress work (r3).`,
			);
		}
		// ACTIVE pristine, TERMINAL, or absent → adoptable-over (fall through to rename)
	}

	// r4: atomic rename (ENOENT → throw, no mutation)
	try {
		renameSync(srcPath, dstPath);
	} catch (err) {
		const code = isErrnoException(err) ? err.code : undefined;
		if (code === "ENOENT") {
			throw new Error(
				`adopt: source "${srcPath}" vanished before rename (lost race — another session adopted it first). ` +
					`No mutation occurred.`,
				{ cause: err },
			);
		}
		throw err;
	}

	// r5: post-rename heartbeat re-stamp of the renamed-to file (best-effort)
	try {
		restampAfterAdopt(dstPath);
	} catch (e) {
		process.stderr.write(
			`adopt: warning: post-rename heartbeat re-stamp failed for "${dstPath}": ${String(e)}\n`,
		);
		// Still success — r5 is best-effort
	}

	// Append audit log line
	try {
		const logPath = join(omtDir, "adoption.log");
		appendFileSync(logPath, `${nowStamp()} ${type} ${srcSid} -> ${curSid}\n`, "utf8");
	} catch (e) {
		process.stderr.write(`adopt: warning: failed to append adoption.log: ${String(e)}\n`);
	}
}

// ---------------------------------------------------------------------------
// ensureSeed — autonomous self-heal seed fallback
// ---------------------------------------------------------------------------

/**
 * The canonical pristine skeleton written when a state file is first created.
 * MUST stay value-equal (modulo timestamps) to the skeleton the PreToolUse seed
 * writes in hooks/pre-tool-enforcer.sh — a parity test (state-core.test.ts,
 * ES-parity) asserts this. The hook and this CLI-side fallback must produce
 * identical pristine state so that a slash-command entry (hook miss) and a
 * Skill-tool entry are indistinguishable downstream.
 */
function seedSkeleton(type: StateType, ts: string): Record<string, unknown> {
	if (type === "prometheus") {
		return {
			active: true,
			phase: "S0",
			plan_path: "",
			resume_summary: "",
			started_at: ts,
			last_touched_at: ts,
		};
	}
	if (type === "goal" || type === "ultragoal") {
		return {
			active: true,
			phase: "planning",
			iteration: 0,
			outcome: "",
			verification_surface: "",
			constraints: "",
			boundaries: "",
			max_iterations: 10,
			blocked_stop: "",
			objective_verdict: "absent",
			plan_path: "",
			resume_summary: "",
			budget_limit_notified: false,
			blocked_reason: "",
			completion_evidence_paths: [],
			schema_version: 1,
			started_at: ts,
			last_touched_at: ts,
		};
	}
	if (type === "qa") {
		return {
			active: true,
			phase: "PRE-FLIGHT",
			cycle: 0,
			max_cycles: 5,
			same_failure_key: "",
			same_failure_count: 0,
			fix_head_before: "",
			user_dirty_set: [],
			target: "",
			started_at: ts,
			last_touched_at: ts,
		};
	}
	// deep-interview
	return { active: true, started_at: ts, last_touched_at: ts };
}

/**
 * Returns true iff `srcSid`'s state of `type` was adopted away by another session,
 * per the adoption.log audit trail (`<ts> <type> <srcSid> -> <curSid>`). Used by
 * ensureSeed to refuse resurrecting a file a live session took over (split-brain
 * guard). Reaped or never-seeded files leave no log line and are safe to re-create.
 *
 * Fails open: a missing/unreadable/partially-written log returns false. This is
 * required, since the common case (no adoption ever happened) has no log at all and
 * must still seed. The residual cost is a narrow window — adopt() renames the file
 * away just before it appends its log line, so a write landing between those two
 * steps (or against a corrupt log) sees no record and re-creates a PRISTINE (empty)
 * skeleton. The real content is safe under the adopter's sid; the resurrected file
 * holds no work, so this is a bounded, recoverable empty-file reappearance — not
 * content loss. The realistic sequential case (adopt completes, then the old session
 * writes) is fully covered.
 */
function wasAdoptedAway(type: StateType, srcSid: string): boolean {
	const logPath = join(getOmtDir(), "adoption.log");
	let content: string;
	try {
		content = readFileSync(logPath, "utf8");
	} catch {
		return false; // no log → no adoption ever happened
	}
	for (const line of content.split("\n")) {
		const parts = line.trim().split(/\s+/);
		// parts: [<iso-ts>, <type>, <srcSid>, '->', <curSid>]
		if (parts.length >= 5 && parts[1] === type && parts[2] === srcSid && parts[3] === "->") {
			return true;
		}
	}
	return false;
}

/**
 * Autonomous seed fallback. Creates the pristine skeleton for `type`/`sessionId`
 * iff the state file is absent AND the session was not adopted away. Idempotent
 * and race-safe: an atomic O_EXCL create means a concurrent PreToolUse seed loses
 * to EEXIST and is silently tolerated.
 *
 * This is the CLI-side mirror of the PreToolUse seed (hooks/pre-tool-enforcer.sh):
 * the hook fires only on a `Skill` TOOL call, so slash-command entry never seeds.
 * Calling ensureSeed at the top of a writer closes that gap WITHOUT relaxing the
 * strict no-create contract of the real writers — only a pristine skeleton is ever
 * created here. Because adopt() refuses pristine sources (r8), the skeleton cannot
 * be renamed away between this create and the writer's own write, so ADR-7's
 * orphan-resurrection guarantee is preserved.
 */
export function ensureSeed(type: StateType, sessionId: string): void {
	// Defensive: callers validate sid, but never derive a path from an unsafe id.
	if (!isSafeSessionId(sessionId)) return;
	const path = statePath(type, sessionId);
	if (existsSync(path)) return; // already seeded — never clobber real work
	if (wasAdoptedAway(type, sessionId)) return; // taken over by a live session — do not resurrect
	const content = JSON.stringify(seedSkeleton(type, nowStamp()), null, 2);
	let fd: number | undefined;
	try {
		fd = openSync(path, "wx"); // O_CREAT|O_EXCL — atomic; EEXIST if seeded concurrently
		const buf = Buffer.from(content, "utf8");
		writeSync(fd, buf, 0, buf.length, 0);
	} catch (err) {
		if (isErrnoException(err) && err.code === "EEXIST") return; // lost the create race — fine
		throw err;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/**
 * Shared state spine for goal, ultragoal, prometheus, and deep-interview skill CLIs.
 *
 * Exports:
 *   nowStamp()                    — ISO-seconds timestamp, round-trips BSD/GNU date parser
 *   isSafeSessionId(id)           — validates ^[A-Za-z0-9_-]+$, length 1..200
 *   resolveSessionIdOrThrow()     — reads OMT_SESSION_ID env (fallback: CODEX_THREAD_ID), throws if absent/unsafe
 *   mergeWithHeartbeat(p, q)      — {...p, ...q, last_touched_at: nowStamp(), progress_touched_at: nowStamp()}
 *   ACTIVE_IDLE_TTL_SECONDS       — 21600 (6 hours) — TS definition site (parity-tested vs bash)
 *   TERMINAL_TTL_SECONDS          — 1800 (30 minutes) — TS definition site
 *   isStateLive(parsed, nowEpoch) — Single liveness rule; fallback: last_touched_at → started_at
 *   isProgressLive(parsed, now)   — Wedge/progress-axis liveness: isStateLive keyed off
 *                                    progress_touched_at (fallback: last_touched_at) instead of
 *                                    last_touched_at directly — immune to GC-only heartbeat revival
 *   STATE_PREFIX                  — type → filename prefix map
 *   listOthers(type)              — ACTIVE + progress-live non-pristine other-session candidates
 *   adopt(type, srcSid)           — atomic rename re-key, rules r1-r8
 *   restampAfterAdopt(path)       — post-rename re-stamp of BOTH last_touched_at and
 *                                    progress_touched_at via writeFileNoCreate — adoption is a
 *                                    genuine progress event (explicit user resume), not a
 *                                    GC-only write
 *   writeFileNoCreate(path, s)    — single-syscall no-create write (ENOENT if absent)
 *   isPristine(type, parsed)      — true iff state is freshly seeded, safe for adoption overwrite
 *   touchSessionStates(sid)       — family-agnostic heartbeat: refreshes last_touched_at on
 *                                    every existing, non-pristine state file for sid
 *   backfillProgressTouchedAt(p)  — the progress_touched_at patch every GC-only writer (this
 *                                    module's touchSessionStates, and
 *                                    lib/persistent-mode-core/state.ts's updateGoalState/
 *                                    updateUltragoalState heartbeat-only calls) must apply
 *                                    before overwriting last_touched_at
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
import { getOmtDir, resolveOmtDir } from "./omt-dir";
import type { QaChainState } from "./qa-chain-core";

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
	if (omtSid !== undefined) {
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
 * Merges `partial` over `prior` and stamps two timestamps, both `nowStamp()`,
 * that answer two different questions:
 *   - `last_touched_at`     — GC axis: "is this session alive?" Also refreshed
 *     by touchSessionStates' Stop-hook heartbeat (see below), so a session with
 *     long-running subagents survives SessionStart GC's TTL sweep.
 *   - `progress_touched_at` — wedge axis: "is this family's work actually
 *     progressing?" Stamped ONLY here, at a genuine producer write — the
 *     heartbeat never touches it. lib/persistent-mode-core/decision.ts's
 *     blocking checks (deep-interview, prometheus) key off this field instead
 *     of last_touched_at, so a heartbeat-revived TTL-stale corpse cannot wedge
 *     the session merely because the GC-axis timestamp was kept fresh.
 * Every genuine state writer (goal-state.ts, ultragoal-state.ts,
 * prometheus-state.ts, deep-interview-state.ts, qa-state.ts) calls this — both
 * timestamps are always refreshed together on any real write.
 */
export function mergeWithHeartbeat<T extends object>(
	prior: T,
	partial: Partial<T>,
): T & { last_touched_at: string; progress_touched_at: string } {
	const ts = nowStamp();
	return { ...prior, ...partial, last_touched_at: ts, progress_touched_at: ts };
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

/**
 * The wedge/progress-axis liveness predicate: the same isStateLive rule above,
 * but keyed off `progress_touched_at` — falling back to `last_touched_at` only
 * when `progress_touched_at` is absent — instead of `last_touched_at` directly.
 *
 * `last_touched_at` answers "is this session alive?" (the GC axis) and is
 * revived on every Stop-hook heartbeat (touchSessionStates below) — including on
 * a TTL-stale corpse that stopped making real progress long ago. Any consumer
 * that must not be fooled by that revival reads this predicate instead:
 * `progress_touched_at` is stamped fresh only by a genuine producer write
 * (mergeWithHeartbeat above) or a genuine progress event (restampAfterAdopt
 * below — adoption is an explicit user resume, not a GC-only write), and is
 * only ever MIGRATED — never stamped fresh — by the one GC-only writer
 * (touchSessionStates; see backfillProgressTouchedAt's doc comment). Two
 * independent consumer classes
 * rely on this: lib/persistent-mode-core/decision.ts's deep-interview/prometheus
 * corpse-block checks (deciding whether to BLOCK), and listOthers/adopt below
 * (deciding whether a source is a genuine, in-progress adoption candidate) — a
 * source revived only by a heartbeat must not look "in progress" to either.
 *
 * Falling back to `last_touched_at` directly (rather than to `started_at`) is
 * safe only because of the invariant backfillProgressTouchedAt establishes:
 * `progress_touched_at` absent ⟹ no GC-only writer has ever touched this file ⟹
 * `last_touched_at` is still that file's last genuine-activity timestamp, not a
 * value a GC-only write could have kept artificially fresh.
 */
export function isProgressLive(
	parsed: {
		active?: boolean;
		last_touched_at?: string;
		started_at?: string;
		progress_touched_at?: string;
	},
	nowEpoch: number,
): boolean {
	return isStateLive(
		{ ...parsed, last_touched_at: parsed.progress_touched_at ?? parsed.last_touched_at },
		nowEpoch,
	);
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

/**
 * Reads the QA state without folding inactive files to null. The Stop gate
 * must distinguish a legacy untouched inactive marker from a forged
 * deactivation after work was recorded, so this reader intentionally returns
 * `active:false` states as-is. Missing, malformed, or non-object JSON is
 * treated as absent.
 */
export function readQaStateRaw(sessionId: string): QaChainState | null {
	if (!isSafeSessionId(sessionId)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(statePath("qa", sessionId), "utf8"));
		return isPlainObject(parsed) ? (parsed as QaChainState) : null;
	} catch {
		return null;
	}
}

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

/**
 * Sentinel backfilled into `progress_touched_at` when there is no genuine
 * `last_touched_at` to preserve (absent or not a string) — an epoch old enough
 * that isStateLive/isProgressLive always read it as dead. Without this, the
 * naive backfill `{ progress_touched_at: parsed["last_touched_at"] }` would be
 * `{ progress_touched_at: undefined }` on such a file; JSON.stringify drops an
 * undefined-valued key, so `progress_touched_at` would stay absent on disk after
 * the FIRST GC-only touch (even though `last_touched_at` was already bumped to
 * now). A SECOND GC-only touch would then see `progress_touched_at` still
 * absent and backfill again — this time from the FIRST touch's own fresh GC
 * stamp, promoting a GC-only timestamp into the progress axis. Stamping this
 * sentinel instead guarantees `progress_touched_at` is a real, present value
 * after the very first touch, so a later touch's presence check (below) always
 * finds it and never re-derives it from an intervening GC write.
 */
const NEVER_TOUCHED_SENTINEL = "1970-01-01T00:00:00+00:00";

/**
 * Returns the `progress_touched_at` patch every GC-only writer must apply
 * BEFORE it overwrites `last_touched_at`. Callers: this module's
 * touchSessionStates, and lib/persistent-mode-core/state.ts's
 * updateGoalState/updateUltragoalState on their heartbeat-only (empty-partial)
 * path — all five state families funnel their GC-only writes through this one
 * patch, which is what makes the invariant below actually hold across all
 * five, not just the three (deep-interview, prometheus, qa) that only ever go
 * through this module's own writers. restampAfterAdopt below is NOT a caller:
 * adoption is a genuine progress event, so it stamps `progress_touched_at`
 * fresh directly (like mergeWithHeartbeat) rather than migrating a prior
 * value through this patch.
 *
 * Every GC-only writer refreshes `last_touched_at` (the GC-liveness axis)
 * without a genuine producer write ever having happened — unlike
 * mergeWithHeartbeat, which stamps `progress_touched_at` (the wedge-liveness
 * axis isProgressLive above reads) only at real work. Left alone, a GC-only
 * writer touching a legacy file (one written before `progress_touched_at`
 * existed) would permanently erase that file's last genuine-activity timestamp
 * the moment it stamps `last_touched_at` — the fresh GC stamp becomes the ONLY
 * record left of when the file was last real. This patch closes that: when
 * `progress_touched_at` is already present, a real producer write (or an
 * earlier GC-only backfill) owns it, so return {} and leave it untouched. When
 * absent, migrate the current (soon to be overwritten) `last_touched_at` into
 * it FIRST — or, when even that is absent/not a string, stamp
 * NEVER_TOUCHED_SENTINEL (see its own doc comment for why a plain `undefined`
 * value cannot be used here) — preserving the last genuine-activity timestamp
 * instead of losing it. This establishes the invariant isProgressLive's
 * fallback depends on: progress_touched_at absent ⟹ no GC-only writer has ever
 * touched this file ⟹ last_touched_at is still that file's last genuine-
 * activity timestamp.
 */
export function backfillProgressTouchedAt(parsed: Record<string, unknown>): Record<string, unknown> {
	if (typeof parsed["progress_touched_at"] === "string") return {};
	const lta = parsed["last_touched_at"];
	return { progress_touched_at: typeof lta === "string" ? lta : NEVER_TOUCHED_SENTINEL };
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
 * Narrows a parsed state record down to the shape isStateLive/isProgressLive
 * expect, without an unsafe cast. Fields with the wrong runtime type are
 * treated as absent — matches how isStateLive already only ever receives
 * well-formed state files written by this module. Includes
 * `progress_touched_at` (isStateLive itself ignores the extra field; only
 * isProgressLive reads it) so one shape serves both predicates.
 */
function toLivenessShape(parsed: Record<string, unknown>): {
	active?: boolean;
	last_touched_at?: string;
	started_at?: string;
	progress_touched_at?: string;
} {
	return {
		active: typeof parsed["active"] === "boolean" ? parsed["active"] : undefined,
		last_touched_at:
			typeof parsed["last_touched_at"] === "string" ? parsed["last_touched_at"] : undefined,
		started_at: typeof parsed["started_at"] === "string" ? parsed["started_at"] : undefined,
		progress_touched_at:
			typeof parsed["progress_touched_at"] === "string" ? parsed["progress_touched_at"] : undefined,
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
 * Returns all ACTIVE + progress-live candidates of the given type OTHER than
 * the current session.
 *
 * - Reads $OMT_DIR for files matching `STATE_PREFIX[type]*`
 * - Excludes the current session's file
 * - Skips malformed files (parse-fail) without throwing
 * - Filters to ACTIVE + progress-live only (active===true && isProgressLive) —
 *   NOT isStateLive: a source revived only by a GC-only heartbeat
 *   (touchSessionStates keeps its GC-axis last_touched_at fresh with no real
 *   work having happened) must not be offered as an in-progress candidate
 *   merely because that axis looks alive.
 * - Sid derived from filename only — never reads session-id from file content
 * - `idleSeconds` is likewise measured on the progress axis
 *   (progress_touched_at ?? last_touched_at), so it reports genuine idle time,
 *   not idle time since the last heartbeat.
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
		// Only ACTIVE + progress-live candidates (r7 source filter). Progress axis,
		// not GC axis: a source revived only by a heartbeat must not qualify.
		if (parsed["active"] !== true) continue;
		const shape = toLivenessShape(parsed);
		if (!isProgressLive(shape, now)) continue;
		// Pristine seeds are INERT to consumers (f9f3242): skip empty-purpose seeds
		if (isPristine(type, parsed)) continue;
		const progressTouched = shape.progress_touched_at ?? shape.last_touched_at ?? "";
		const touched = progressTouched ? parseEpoch(progressTouched) : null;
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
 * Reads the file at `path`, updates BOTH `last_touched_at` and
 * `progress_touched_at`, and writes it back using writeFileNoCreate — so it
 * will throw ENOENT if the file has disappeared between the rename and this
 * call, preventing accidental file creation.
 *
 * Unlike touchSessionStates/updateGoalState/updateUltragoalState's
 * heartbeat-only path, this is NOT a GC-only writer: adoption is a genuine
 * progress event — an explicit user act declaring "I am resuming this work" —
 * so it advances the progress axis exactly like mergeWithHeartbeat's real
 * producer write, rather than merely backfilling/preserving a prior value via
 * backfillProgressTouchedAt. This also means a legacy file (no
 * `progress_touched_at` on disk) comes out with a fresh stamp, not an absent
 * field or the NEVER_TOUCHED_SENTINEL.
 *
 * Called by adopt's r5 best-effort re-stamp block; also exported for direct
 * unit testing of the no-create invariant.
 */
export function restampAfterAdopt(path: string): void {
	const content = readFileSync(path, "utf8");
	const parsed: unknown = JSON.parse(content);
	if (!isPlainObject(parsed)) {
		throw new Error(`restampAfterAdopt: "${path}" does not contain a JSON object`);
	}
	const ts = nowStamp();
	const stamped = {
		...parsed,
		last_touched_at: ts,
		progress_touched_at: ts,
	};
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
 *   r5: post-rename best-effort re-stamp of both liveness axes via restampAfterAdopt (failure → stderr warn)
 *   r6: LIVE source adoptable (checked via isProgressLive — progress axis, not GC axis)
 *   r7: source must be ACTIVE + progress-live (TERMINAL/progress-stale/malformed refused;
 *       a source revived only by a GC-only heartbeat does not qualify)
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

	// r7: source must be ACTIVE + progress-live. Progress axis, not GC axis: a
	// source kept "alive" only by a GC-only heartbeat (touchSessionStates) with
	// no real work since must be refused, exactly like a source with no
	// heartbeat at all — otherwise the heartbeat alone would be enough to
	// resurrect a stale corpse as an adoptable candidate.
	const srcParsed = readParsed(srcPath);
	if (srcParsed === null) {
		throw new Error(
			`adopt: source "${srcPath}" is missing or malformed (lost race or never existed)`,
		);
	}
	if (srcParsed["active"] !== true) {
		throw new Error(`adopt: source "${srcPath}" is not ACTIVE (r7: TERMINAL sources are refused)`);
	}
	if (!isProgressLive(toLivenessShape(srcParsed), now)) {
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

	// r5: post-rename re-stamp of both liveness axes on the renamed-to file (best-effort)
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

// ---------------------------------------------------------------------------
// touchSessionStates — family-agnostic Stop-hook session-state heartbeat
// ---------------------------------------------------------------------------

/** Type predicate: is `key` one of STATE_PREFIX's own keys (i.e. a StateType)? */
function isStateType(key: string): key is StateType {
	return Object.prototype.hasOwnProperty.call(STATE_PREFIX, key);
}

/**
 * Returns the StateType whose STATE_PREFIX prefixes `filename`, or null if none match.
 * Kept out of touchSessionStates' own body so that function's source stays free of
 * any family-name literal — this helper is the one place that reads STATE_PREFIX.
 */
function typeFromStateFilename(filename: string): StateType | null {
	for (const [type, prefix] of Object.entries(STATE_PREFIX)) {
		if (isStateType(type) && filename.startsWith(prefix)) return type;
	}
	return null;
}

/**
 * Refreshes `last_touched_at` on every existing state file belonging to `sessionId`,
 * across every state family, without this function's own source containing any
 * family name. Every STATE_PREFIX entry ends in `-state-`, so matching directory
 * entries by the suffix `-state-${sessionId}.json` alone covers all of them; the
 * `.json` anchor also excludes a `...-{sid}.json.closed.bak` backup, which must not
 * be heartbeated.
 *
 * Never creates a file or directory: resolves the directory via resolveOmtDir (not
 * getOmtDir, which mkdirs) and writes only through writeFileNoCreate. If the
 * directory does not exist, does nothing. A pristine state is skipped — a freshly
 * seeded state must not be kept alive by a heartbeat it never really used. Every
 * per-file error (ENOENT from a read/write race, a parse failure, a malformed file)
 * is swallowed and the sweep continues — this is called unconditionally at the
 * very top of makeDecision (lib/persistent-mode-core/decision.ts), before Guard
 * 2's activeBackgroundTaskCount check, wrapped in its own try/catch there, so a throw
 * here would corrupt the Stop hook's decision if it were allowed to propagate.
 *
 * GC-only writer (see backfillProgressTouchedAt's doc comment): before this
 * refreshes `last_touched_at`, it backfills `progress_touched_at` from the
 * pre-overwrite value when absent, so a heartbeat on a legacy file does not erase
 * that file's last genuine-activity timestamp.
 *
 * Read-modify-write, no lock: each iteration does read → parse → stamp →
 * writeFileNoCreate (truncate+write, no lock — see its own doc comment). This is
 * only safe because the main thread is the sole writer of any given session state
 * file — the code review on PR #209 flagged this as a lost-update risk, and the
 * invariant that closes it is measured, not assumed: no agent definition under
 * agents/ invokes a state CLI, and no dispatch prompt instructs a subagent to. The
 * state-writing commands in skills/{goal,ultragoal}/references/{planning,
 * completion-gate}.md (`set`, `set-stories`, `set-verdict`, `confirm-*`,
 * `request-complete`) all live in skill body prose that only the orchestrator (main
 * thread) executes; what crosses into the code-reviewer subagent is a serialized
 * payload and an artifact path, never a state CLI call. Every state-writing skill
 * (goal, ultragoal, qa, prometheus, deep-interview) writes from its own skill body
 * on the main thread. This breaks — and a lock or compare-and-retry becomes
 * necessary — the moment either: a subagent gains a path to invoke a state-writing
 * skill (subagents already hold the Skill tool, so nothing structural blocks this
 * today, only convention), or some call site starts running a state CLI command
 * via a backgrounded shell. Switching the heartbeat to `utimesSync` (mtime-only,
 * no write) would not sidestep this: liveness reads `last_touched_at` from the JSON
 * body first and falls back to mtime only when it's absent (hooks/lib/
 * state-liveness.sh's `is_state_live`; lib/state-core.ts's `isStateLive` above
 * does not even receive a file path, so it cannot reach mtime at all) — as long as
 * a state file carries `last_touched_at`, mtime is unreachable, so an mtime-only
 * heartbeat would go unread.
 */
export function touchSessionStates(sessionId: string): void {
	const omtDir = resolveOmtDir();
	const suffix = `-state-${sessionId}.json`;

	let entries: string[];
	try {
		entries = readdirSync(omtDir);
	} catch {
		return; // directory absent — nothing to touch, and nothing to create
	}

	for (const entry of entries) {
		if (!entry.endsWith(suffix)) continue;
		const type = typeFromStateFilename(entry);
		if (type === null) continue;
		const path = join(omtDir, entry);
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!isPlainObject(parsed)) continue;
			if (isPristine(type, parsed)) continue;
			const stamped = {
				...parsed,
				...backfillProgressTouchedAt(parsed),
				last_touched_at: nowStamp(),
			};
			writeFileNoCreate(path, JSON.stringify(stamped, null, 2));
		} catch (err) {
			if (isErrnoException(err) && err.code === "ENOENT") continue; // vanished between readdir and write — harmless race
			continue; // any other per-file error must not abort the sweep
		}
	}
}

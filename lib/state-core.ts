/**
 * Shared state spine for goal, prometheus, and deep-interview skill CLIs.
 *
 * Exports:
 *   nowStamp()                    — ISO-seconds timestamp, round-trips BSD/GNU date parser
 *   isSafeSessionId(id)           — validates ^[A-Za-z0-9_-]+$, length 1..200
 *   resolveSessionIdOrThrow()     — reads OMT_SESSION_ID env, throws if absent/unsafe
 *   mergeWithHeartbeat(p, q)      — {...p, ...q, last_touched_at: nowStamp()}
 *   ACTIVE_IDLE_TTL_SECONDS       — 21600 (6 hours) — TS definition site (parity-tested vs bash)
 *   TERMINAL_TTL_SECONDS          — 1800 (30 minutes) — TS definition site
 *   isStateLive(parsed, nowEpoch) — Single liveness rule (active + idle window)
 *   STATE_PREFIX                  — type → filename prefix map
 *   listOthers(type)              — ACTIVE-live other-session candidates
 *   adopt(type, srcSid)           — atomic rename re-key, rules r1-r7
 *
 * Sid is derived from FILENAME ONLY — never read a session-id field from file content.
 * This module does NOT create state files; adoption may only rename existing ones.
 */

import { readdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getOmtDir } from '@lib/omt-dir';

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
  const pad = (n: number) => String(n).padStart(2, '0');
  // getTimezoneOffset returns minutes west of UTC; negative = east
  const tzOffset = -d.getTimezoneOffset(); // minutes east of UTC
  const tzSign = tzOffset >= 0 ? '+' : '-';
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
 * Reads OMT_SESSION_ID from env. Throws if absent or unsafe.
 * Skill CLIs (TypeScript) call this at startup; they hard-fail on bad sid.
 */
export function resolveSessionIdOrThrow(): string {
  const sid = process.env['OMT_SESSION_ID'];
  if (!sid) {
    throw new Error(
      'OMT_SESSION_ID is not set. The PreToolUse seed must have run before invoking this CLI.'
    );
  }
  if (!isSafeSessionId(sid)) {
    throw new Error(
      `OMT_SESSION_ID "${sid}" is not a safe session id (must match ^[A-Za-z0-9_-]+$, length 1..200).`
    );
  }
  return sid;
}

// ---------------------------------------------------------------------------
// Heartbeat merge
// ---------------------------------------------------------------------------

/**
 * Merges `partial` over `prior` and sets `last_touched_at` to `nowStamp()`.
 * Every state writer calls this — heartbeat is always refreshed on any write.
 */
export function mergeWithHeartbeat<T extends object>(prior: T, partial: Partial<T>): T & { last_touched_at: string } {
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
 * where idle = nowEpoch − epochFromTimestamp(last_touched_at).
 *
 * @param parsed  The parsed state object (must have .active and .last_touched_at).
 * @param nowEpoch  Current Unix epoch seconds.
 */
export function isStateLive(
  parsed: { active?: boolean; last_touched_at?: string },
  nowEpoch: number
): boolean {
  const lta = parsed.last_touched_at;
  if (!lta) return false;
  const touched = parseEpoch(lta);
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

export type StateType = 'goal' | 'prometheus' | 'deep-interview';

/** Maps each stateful skill type to its state-file filename prefix. */
export const STATE_PREFIX: Record<StateType, string> = {
  goal: 'goal-state-',
  prometheus: 'prometheus-state-',
  'deep-interview': 'deep-interview-active-state-',
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
  return filename.slice(prefix.length, -'.json'.length);
}

/** Returns the state-file path for a given type and sid. */
function statePath(type: StateType, sid: string): string {
  return join(getOmtDir(), `${STATE_PREFIX[type]}${sid}.json`);
}

/** Reads and parses a state file. Returns null on missing or malformed. */
function readParsed(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Returns the purpose string for a candidate, per type. */
function purposeFor(type: StateType, parsed: Record<string, unknown>): string {
  if (type === 'goal') {
    return String(parsed['outcome'] ?? '');
  }
  if (type === 'prometheus') {
    const planPath = String(parsed['plan_path'] ?? '');
    if (planPath !== '') return planPath;
    return String(parsed['phase'] ?? '');
  }
  if (type === 'deep-interview') {
    const state = parsed['state'];
    if (typeof state === 'object' && state !== null && !Array.isArray(state)) {
      return String((state as Record<string, unknown>)['initial_idea'] ?? '');
    }
    return '';
  }
  return '';
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
 *   goal:           phase=="planning" && iteration==0 && outcome==""
 *   deep-interview: seeded file lacking the rich `state` object
 */
function isPristine(type: StateType, parsed: Record<string, unknown>): boolean {
  if (type === 'prometheus') {
    return parsed['phase'] === 'S0' && parsed['plan_path'] === '';
  }
  if (type === 'goal') {
    return (
      parsed['phase'] === 'planning' &&
      (parsed['iteration'] === 0 || parsed['iteration'] === undefined) &&
      (parsed['outcome'] === '' || parsed['outcome'] === undefined)
    );
  }
  if (type === 'deep-interview') {
    // Pristine = seed file without the rich `state` object
    return parsed['state'] === undefined || parsed['state'] === null;
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
  const curSid = process.env['OMT_SESSION_ID'] ?? '';
  const now = Math.floor(Date.now() / 1000);

  let entries: string[];
  try {
    entries = readdirSync(omtDir);
  } catch {
    return [];
  }

  const results: AdoptionCandidate[] = [];

  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue;
    const sid = sidFromFilename(entry, prefix);
    // Exclude current session
    if (sid === curSid) continue;
    // Parse the file — skip malformed
    const parsed = readParsed(join(omtDir, entry));
    if (parsed === null) continue;
    // Only ACTIVE-live candidates (r7 source filter)
    if (parsed['active'] !== true) continue;
    if (!isStateLive(parsed as { active?: boolean; last_touched_at?: string }, now)) continue;
    const lta = String(parsed['last_touched_at'] ?? '');
    const touched = parseEpoch(lta);
    const idleSeconds = touched !== null ? Math.max(0, now - touched) : 0;
    results.push({
      sid,
      purpose: purposeFor(type, parsed),
      startedAt: String(parsed['started_at'] ?? ''),
      idleSeconds,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// adopt
// ---------------------------------------------------------------------------

/**
 * Adopts the state from `srcSid` into the current session for `type`.
 *
 * Enforces ADR-2 rules r1–r7:
 *   r1: self-adopt refused
 *   r2: both sids safe-id validated
 *   r3: refused iff current exists AND (ACTIVE non-pristine OR malformed)
 *   r4: atomic fs.renameSync; ENOENT → throw, no mutation
 *   r5: post-rename best-effort heartbeat re-stamp (failure → stderr warn)
 *   r6: LIVE source adoptable (checked via isStateLive)
 *   r7: source must be ACTIVE-live (TERMINAL/stale/malformed refused)
 *
 * Sid is derived from filename only — never reads session-id from file content.
 * Does NOT create any file; only renames an existing one.
 *
 * Appends one line to $OMT_DIR/adoption.log after success:
 *   <ISO ts> <type> <srcSid> -> <curSid>
 */
export function adopt(type: StateType, srcSid: string): void {
  const curSid = process.env['OMT_SESSION_ID'];
  if (!curSid) {
    throw new Error('adopt: OMT_SESSION_ID is not set');
  }

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
    throw new Error(`adopt: source "${srcPath}" is missing or malformed (lost race or never existed)`);
  }
  if (srcParsed['active'] !== true) {
    throw new Error(`adopt: source "${srcPath}" is not ACTIVE (r7: TERMINAL sources are refused)`);
  }
  if (!isStateLive(srcParsed as { active?: boolean; last_touched_at?: string }, now)) {
    throw new Error(`adopt: source "${srcPath}" is not live (r7: stale sources are refused)`);
  }

  // r3: check current session state
  if (existsSync(dstPath)) {
    const curParsed = readParsed(dstPath);
    if (curParsed === null) {
      // Malformed current — fail closed
      throw new Error(
        `adopt: current session state "${dstPath}" is malformed. ` +
          `Please manually inspect and remove it, then re-invoke the skill.`
      );
    }
    // ACTIVE non-pristine → refuse
    if (curParsed['active'] === true && !isPristine(type, curParsed)) {
      throw new Error(
        `adopt: current session has ACTIVE non-pristine state at "${dstPath}". ` +
          `Adoption refused to avoid overwriting in-progress work (r3).`
      );
    }
    // ACTIVE pristine, TERMINAL, or absent → adoptable-over (fall through to rename)
  }

  // r4: atomic rename (ENOENT → throw, no mutation)
  try {
    renameSync(srcPath, dstPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `adopt: source "${srcPath}" vanished before rename (lost race — another session adopted it first). ` +
          `No mutation occurred.`
      );
    }
    throw err;
  }

  // r5: post-rename heartbeat re-stamp of the renamed-to file (best-effort)
  try {
    const content = readFileSync(dstPath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const stamped = { ...parsed, last_touched_at: nowStamp() };
    writeFileSync(dstPath, JSON.stringify(stamped, null, 2), 'utf8');
  } catch (e) {
    process.stderr.write(
      `adopt: warning: post-rename heartbeat re-stamp failed for "${dstPath}": ${String(e)}\n`
    );
    // Still success — r5 is best-effort
  }

  // Append audit log line
  try {
    const logPath = join(omtDir, 'adoption.log');
    appendFileSync(logPath, `${nowStamp()} ${type} ${srcSid} -> ${curSid}\n`, 'utf8');
  } catch (e) {
    process.stderr.write(`adopt: warning: failed to append adoption.log: ${String(e)}\n`);
  }
}

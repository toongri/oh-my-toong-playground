import { DeepInterviewState, PrometheusState, GoalState } from './types.ts';
import { readFileOrNull, writeFileSafe, deleteFile, ensureDir } from './utils.ts';
import { writeFileNoCreate } from '@lib/state-core';
import { join } from 'path';
import { getOmtDir } from '@lib/omt-dir';

/** Returns the current local time as an ISO-seconds string (hooks/persistent-mode
 *  is deployed separately from lib/ and cannot import @lib/state-core). */
function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const tzOffset = -d.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzM = pad(Math.abs(tzOffset) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${tzSign}${tzH}:${tzM}`
  );
}

const MAX_BLOCK_COUNT = 5;

export function readDeepInterviewState(sessionId: string): DeepInterviewState | null {
  const path = join(getOmtDir(), `deep-interview-active-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return null;

  try {
    const state = JSON.parse(content) as DeepInterviewState;
    return state.active ? state : null;
  } catch {
    return null;
  }
}

// Active-agnostic probe: returns the parsed deep-interview state even when active=false
// (terminal — interview concluded), so the hook can delete orphaned terminal markers.
// Null on absent or malformed; never throws. Distinct from readDeepInterviewState, which
// folds active:false -> null (causing the delete branch to never fire on terminal files).
export function readDeepInterviewStateRaw(sessionId: string): DeepInterviewState | null {
  const path = join(getOmtDir(), `deep-interview-active-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return null;

  try {
    return JSON.parse(content) as DeepInterviewState;
  } catch {
    return null;
  }
}

export function cleanupDeepInterviewState(sessionId: string): void {
  deleteFile(join(getOmtDir(), `deep-interview-active-state-${sessionId}.json`));
}

export function readPrometheusState(sessionId: string): PrometheusState | null {
  const path = join(getOmtDir(), `prometheus-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return null;

  try {
    const state = JSON.parse(content) as PrometheusState;
    return state.active ? state : null;
  } catch {
    return null;
  }
}

export function cleanupPrometheusState(sessionId: string): void {
  deleteFile(join(getOmtDir(), `prometheus-state-${sessionId}.json`));
}

// active-only view: readGoalStateRaw folded by active (null on absent/malformed/inactive).
export function readGoalState(sessionId: string): GoalState | null {
  const state = readGoalStateRaw(sessionId);
  return state && state.active ? state : null;
}

// Active-agnostic probe: returns the parsed goal-state even when active=false
// (terminal phases complete/blocked/budget_limited), so the hook can suppress
// the baseline-todo branch for ANY goal phase. Null on absent or malformed;
// never throws. Distinct from readGoalState, which folds active:false -> null.
export function readGoalStateRaw(sessionId: string): GoalState | null {
  const path = join(getOmtDir(), `goal-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return null;

  try {
    const s = JSON.parse(content) as GoalState;
    // Schema guard: a structurally partial/corrupt state must read as absent (null) —
    // never let garbage drive the loop (cap bypass) or suppress baseline-todo. Validate
    // only the load-bearing fields the decision tree branches/arithmetic on; a VALID
    // terminal state (active:false + well-formed fields) still returns so M3 suppression holds.
    const phases = ['planning', 'pursuing', 'budget_limited', 'blocked', 'complete'];
    if (
      typeof s.active !== 'boolean' ||
      !phases.includes(s.phase as string) ||
      !Number.isInteger(s.iteration) || s.iteration < 0 ||
      !Number.isInteger(s.max_iterations) || s.max_iterations < 1
    ) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

// Strict spread-overlay writer. Reads the RAW on-disk JSON untyped (preserving
// every field, including SKILL-only ones written by goal-state.ts), overlays
// ONLY the keys in `partial`, and writes back. If the raw read is absent or
// malformed it does NOTHING — never seeds defaults, never reconstructs a fresh
// object, never creates a file. Diverging from goal-state.ts's mergeWrite would
// risk fabricating a goal-state, so a second writer must stay strictly additive.
export function updateGoalState(sessionId: string, partial: Partial<GoalState>): void {
  const path = join(getOmtDir(), `goal-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return;
  }

  // Stamp last_touched_at UNCONDITIONALLY — an empty partial still refreshes
  // the heartbeat (ADR-8: every use of a state is a use).
  // writeFileNoCreate (single open-truncate-write syscall) throws ENOENT if the file
  // was renamed away between our read and this write — i.e. the adopt TOCTOU window.
  // Catching ENOENT preserves the existing "file absent → do nothing" semantics while
  // closing the race: the write syscall itself refuses creation (ADR-7 / F10).
  try {
    writeFileNoCreate(path, JSON.stringify({ ...raw, ...partial, last_touched_at: nowStamp() }, null, 2));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

// Block counting for stuck agent escape hatch
export function getBlockCount(stateDir: string, attemptId: string): number {
  const content = readFileOrNull(`${stateDir}/block-count-${attemptId}`);
  return content ? parseInt(content, 10) || 0 : 0;
}

export function incrementBlockCount(stateDir: string, attemptId: string): void {
  const current = getBlockCount(stateDir, attemptId);
  ensureDir(stateDir);
  writeFileSafe(`${stateDir}/block-count-${attemptId}`, String(current + 1));
}

export function cleanupBlockCountFiles(stateDir: string, attemptId: string): void {
  deleteFile(`${stateDir}/block-count-${attemptId}`);
}

export { MAX_BLOCK_COUNT };

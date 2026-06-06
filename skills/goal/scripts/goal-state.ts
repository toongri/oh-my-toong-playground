/**
 * Goal skill state CLI.
 *
 * State file path: ${OMT_DIR}/goal-state-${sessionId}.json
 * Session ID: process.env.OMT_SESSION_ID || "default"
 *
 * Structural mirror of prometheus-state.ts: session-keyed JSON, merge-write
 * preserving prior fields, `started_at` seeded once and never re-seeded,
 * null-on-malformed reads.
 *
 * The single load-bearing invariant: the state layer can never be made to
 * false-complete. Each gate is STRUCTURAL — enforced by which subcommand can
 * write what, not by vigilance:
 *   - `set` (orchestrator) accepts ONLY phase planning|pursuing; it can never
 *     write phase=complete and never writes objective_verdict.
 *   - `request-complete` is the ONLY path to phase=complete, and it is gated on
 *     completion-evidence being present.
 *   - `set-verdict` is the ONLY writer of objective_verdict.
 *   - `set-budget-limited` / `set-blocked` are system-only terminal setters and
 *     can never write phase=complete.
 *
 * Subcommands:
 *   set --phase <planning|pursuing> [--outcome ..] [--verification-surface ..]
 *       [--constraints ..] [--boundaries ..] [--max-iterations <n>]
 *       [--blocked-stop ..] [--plan-path ..] [--resume-summary ..]
 *       [--completion-evidence p1,p2]
 *   set-budget-limited                       (system-only)
 *   set-blocked --reason <text>              (system-only)
 *   request-complete                         (gated: requires completion evidence)
 *   set-verdict --verdict <APPROVE|REQUEST_CHANGES|COMMENT|absent>
 *   get
 *   status
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';
import { getOmtDir } from '@lib/omt-dir';

export type GoalPhase = 'planning' | 'pursuing' | 'budget_limited' | 'blocked' | 'complete';
export type ObjectiveVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'absent';

/** Phases the orchestrator's `set` subcommand may write. */
const SETTABLE_PHASES: GoalPhase[] = ['planning', 'pursuing'];
const DEFAULT_MAX_ITERATIONS = 10;

export interface GoalState {
  // --- 4 content slots ---
  outcome: string;
  verification_surface: string;
  constraints: string;
  boundaries: string;
  // --- 2 loop-control slots ---
  /** From the iteration-policy slot. Finite cap on pursuit blocks. */
  max_iterations: number;
  /** Blocked-stop predicate text (objective-specific). */
  blocked_stop: string;
  // --- FSM / control ---
  phase: GoalPhase;
  /** Pursuit-block counter; single writer is decision.ts. Base 0 here. */
  iteration: number;
  /** Local ISO-8601 without milliseconds, seeded once. */
  started_at: string;
  active: boolean;
  /** Written ONLY by set-verdict. Unset reads as 'absent'. */
  objective_verdict: ObjectiveVerdict;
  plan_path: string;
  resume_summary: string;
  budget_limit_notified: boolean;
  blocked_reason: string;
  completion_evidence_paths: string[];
  /** Present-but-unused placeholder; no migration logic. */
  schema_version: number;
}

// ---------------------------------------------------------------------------
// IO helpers (safe write semantics, no import from hooks/)
// ---------------------------------------------------------------------------

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function writeFileSafe(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Path resolution — identical dir resolution as prometheus-state
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
  return `${getOmtDir()}/goal-state-${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// started_at seeding — spawns shell date to match ralph's BSD-parseable format
// ---------------------------------------------------------------------------

function seedStartedAt(): string {
  try {
    const result = execSync('date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S"', {
      encoding: 'utf8',
      shell: '/bin/sh',
    });
    return result.trim();
  } catch {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

function normalize(s: string): string {
  return s.replace(/[\x00-\x1F]/g, ' ');
}

// ---------------------------------------------------------------------------
// Internal: read prior state (raw, regardless of active), null on malformed
// ---------------------------------------------------------------------------

function readPrior(sessionId: string): Partial<GoalState> {
  const content = readFileOrNull(resolveStatePath(sessionId));
  if (!content) return {};
  try {
    return JSON.parse(content) as Partial<GoalState>;
  } catch {
    return {};
  }
}

/**
 * Merge `next` over the prior on-disk state, seeding `started_at` once and
 * supplying field defaults on first write. Persists and returns the result.
 */
function mergeWrite(sessionId: string, next: Partial<GoalState>): GoalState {
  const prior = readPrior(sessionId);
  const state: GoalState = {
    outcome: next.outcome ?? prior.outcome ?? '',
    verification_surface: next.verification_surface ?? prior.verification_surface ?? '',
    constraints: next.constraints ?? prior.constraints ?? '',
    boundaries: next.boundaries ?? prior.boundaries ?? '',
    max_iterations: next.max_iterations ?? prior.max_iterations ?? DEFAULT_MAX_ITERATIONS,
    blocked_stop: next.blocked_stop ?? prior.blocked_stop ?? '',
    phase: next.phase ?? prior.phase ?? 'planning',
    iteration: next.iteration ?? prior.iteration ?? 0,
    started_at: prior.started_at ?? seedStartedAt(),
    active: next.active ?? prior.active ?? true,
    objective_verdict: next.objective_verdict ?? prior.objective_verdict ?? 'absent',
    plan_path: next.plan_path ?? prior.plan_path ?? '',
    resume_summary: normalize(next.resume_summary ?? prior.resume_summary ?? ''),
    budget_limit_notified: next.budget_limit_notified ?? prior.budget_limit_notified ?? false,
    blocked_reason: next.blocked_reason ?? prior.blocked_reason ?? '',
    completion_evidence_paths:
      next.completion_evidence_paths ?? prior.completion_evidence_paths ?? [],
    schema_version: next.schema_version ?? prior.schema_version ?? 1,
  };
  writeFileSafe(resolveStatePath(sessionId), JSON.stringify(state, null, 2));
  return state;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readGoalState(sessionId: string): GoalState | null {
  const content = readFileOrNull(resolveStatePath(sessionId));
  if (!content) return null;
  try {
    const state = JSON.parse(content) as GoalState;
    return state.active ? state : null;
  } catch {
    return null;
  }
}

/**
 * status derives 1:1 from phase — the status token IS the phase token.
 */
export function deriveStatus(state: Pick<GoalState, 'phase'>): GoalPhase {
  return state.phase;
}

export interface SetGoalOpts {
  phase: GoalPhase;
  outcome?: string;
  verification_surface?: string;
  constraints?: string;
  boundaries?: string;
  max_iterations?: number;
  blocked_stop?: string;
  plan_path?: string;
  resume_summary?: string;
  completion_evidence_paths?: string[];
}

/**
 * Orchestrator-authority set. Accepts ONLY planning|pursuing — it can never
 * write phase=complete (that is request-complete-only) and never writes
 * objective_verdict. On phase=planning, objective_verdict is reset to 'absent'
 * so a stale APPROVE cannot survive a re-plan.
 */
export function setGoalState(sessionId: string, opts: SetGoalOpts): void {
  if (!SETTABLE_PHASES.includes(opts.phase)) {
    throw new Error(
      `set: phase must be one of ${SETTABLE_PHASES.join('|')} (got "${opts.phase}"). ` +
        `complete is request-complete-only; budget_limited/blocked are system-only.`
    );
  }
  const next: Partial<GoalState> = {
    phase: opts.phase,
    active: true,
    outcome: opts.outcome,
    verification_surface: opts.verification_surface,
    constraints: opts.constraints,
    boundaries: opts.boundaries,
    max_iterations: opts.max_iterations,
    blocked_stop: opts.blocked_stop,
    plan_path: opts.plan_path,
    resume_summary: opts.resume_summary,
    completion_evidence_paths: opts.completion_evidence_paths,
  };
  if (opts.phase === 'planning') {
    // Stale verdict cannot survive a re-plan (ADR-3).
    next.objective_verdict = 'absent';
  }
  mergeWrite(sessionId, next);
}

/** Verdict-layer authority — the ONLY writer of objective_verdict. */
export function setVerdict(sessionId: string, verdict: ObjectiveVerdict): void {
  mergeWrite(sessionId, { objective_verdict: verdict });
}

/** System-only terminal setter — never writes phase=complete. */
export function setBudgetLimited(sessionId: string): void {
  mergeWrite(sessionId, {
    phase: 'budget_limited',
    active: false,
    budget_limit_notified: true,
  });
}

/** System-only terminal setter — never writes phase=complete. */
export function setBlocked(sessionId: string, reason: string): void {
  mergeWrite(sessionId, {
    phase: 'blocked',
    active: false,
    blocked_reason: normalize(reason),
  });
}

/**
 * The ONLY path to phase=complete. Gated: requires completion-evidence present.
 * Returns false (no state change) when the gate is not satisfied. Succeeds even
 * over a prior budget_limited (complete-wins, ADR-7).
 */
export function requestComplete(sessionId: string): boolean {
  const prior = readPrior(sessionId);
  const evidence = prior.completion_evidence_paths ?? [];
  if (evidence.length === 0) {
    return false;
  }
  mergeWrite(sessionId, { phase: 'complete', active: false });
  return true;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else if (!result['_subcommand']) {
      result['_subcommand'] = arg;
    }
  }
  return result;
}

function str(v: string | boolean | undefined): string | undefined {
  return v !== undefined ? String(v) : undefined;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const subcommand = args['_subcommand'];
  const sessionId = process.env.OMT_SESSION_ID || 'default';

  if (subcommand === 'set') {
    const maxIter = args['max-iterations'] !== undefined ? Number(args['max-iterations']) : undefined;
    // parseArgs collapses repeated --key to the LAST value, so evidence arrives
    // as a single comma-separated value. Absent => undefined so the merge-write
    // preserves prior evidence rather than clobbering it with [].
    const evidence = str(args['completion-evidence']);
    const completionEvidence =
      evidence !== undefined ? evidence.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    setGoalState(sessionId, {
      phase: String(args['phase'] ?? '') as GoalPhase,
      outcome: str(args['outcome']),
      verification_surface: str(args['verification-surface']),
      constraints: str(args['constraints']),
      boundaries: str(args['boundaries']),
      max_iterations: maxIter,
      blocked_stop: str(args['blocked-stop']),
      plan_path: str(args['plan-path']),
      resume_summary: str(args['resume-summary']),
      completion_evidence_paths: completionEvidence,
    });
  } else if (subcommand === 'set-verdict') {
    setVerdict(sessionId, String(args['verdict'] ?? 'absent') as ObjectiveVerdict);
  } else if (subcommand === 'set-budget-limited') {
    setBudgetLimited(sessionId);
  } else if (subcommand === 'set-blocked') {
    setBlocked(sessionId, String(args['reason'] ?? ''));
  } else if (subcommand === 'request-complete') {
    const ok = requestComplete(sessionId);
    if (!ok) {
      process.stderr.write('request-complete: refused — completion evidence absent\n');
      process.exit(1);
    }
  } else if (subcommand === 'get') {
    process.stdout.write(JSON.stringify(readGoalState(sessionId)) + '\n');
  } else if (subcommand === 'status') {
    const state = readGoalState(sessionId);
    process.stdout.write((state ? deriveStatus(state) : 'absent') + '\n');
  } else {
    process.stderr.write(
      'Usage: goal-state.ts <set|set-verdict|set-budget-limited|set-blocked|request-complete|get|status> [options]\n'
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

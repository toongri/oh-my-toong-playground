/**
 * Deep-interview skill state CLI.
 *
 * State file path: ${OMT_DIR}/deep-interview-active-state-${sessionId}.json
 * Session ID: derived from OMT_SESSION_ID env via resolveSessionIdOrThrow().
 *
 * The PreToolUse seed (hooks/pre-tool-enforcer.sh) is the SOLE creator of this
 * file; it writes the skeleton {active, started_at, last_touched_at} on
 * Skill(deep-interview) invocation. Every writer here is STRICT NO-CREATE
 * (ADR-7): absent file → non-zero exit, no file created.
 *
 * Subcommands:
 *   init   [--initial-idea <text>] [--interview-id <id>] [--type greenfield|brownfield]
 *          [--current-phase <phase>] [--threshold <n>]
 *          Strict overlay of the rich shape into the EXISTING seed file.
 *   update [--current-phase <phase>] [--current-ambiguity <n>]
 *          Strict-overlay merge refreshing last_touched_at.
 *   get    Print the state JSON.
 *
 * No sessionId field is ever written (ADR-7, RC3 root-cause fix: sid is
 * derived from the FILENAME only, never from file content).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getOmtDir } from '@lib/omt-dir';
import {
  resolveSessionIdOrThrow,
  mergeWithHeartbeat,
  STATE_PREFIX,
} from '@lib/state-core';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
  return `${getOmtDir()}/${STATE_PREFIX['deep-interview']}${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// Internal IO
// ---------------------------------------------------------------------------

function readRaw(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rich state shape (per SKILL.md:72-89, NO sessionId field)
// ---------------------------------------------------------------------------

export interface DeepInterviewStateContent {
  interview_id?: string;
  type?: 'greenfield' | 'brownfield';
  initial_idea?: string;
  initial_context_summary?: string | null;
  rounds?: unknown[];
  current_ambiguity?: number;
  threshold?: number;
  codebase_context?: unknown;
  challenge_modes_used?: string[];
  ontology_snapshots?: unknown[];
}

export interface DeepInterviewState {
  active?: boolean;
  current_phase?: string;
  started_at?: string;
  last_touched_at?: string;
  state?: DeepInterviewStateContent;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strict overlay of the rich shape into the EXISTING seeded file.
 * Absent file → throws (ADR-7). Never writes a sessionId field.
 */
export function initDeepInterviewState(
  sessionId: string,
  payload: {
    initial_idea?: string;
    interview_id?: string;
    type?: 'greenfield' | 'brownfield';
    current_phase?: string;
    threshold?: number;
  }
): void {
  const path = resolveStatePath(sessionId);
  const prior = readRaw(path);
  if (prior === null) {
    throw new Error(
      `deep-interview-state: no state file found at "${path}". ` +
        'Either the seed is missing (re-invoke the deep-interview skill) ' +
        'or this session was adopted by another session.'
    );
  }

  // Build the state object: merge with any existing state content
  const priorState =
    typeof prior['state'] === 'object' && prior['state'] !== null && !Array.isArray(prior['state'])
      ? (prior['state'] as DeepInterviewStateContent)
      : {};

  const newState: DeepInterviewStateContent = {
    interview_id: payload.interview_id ?? priorState.interview_id,
    type: payload.type ?? priorState.type,
    initial_idea: payload.initial_idea ?? priorState.initial_idea,
    initial_context_summary: priorState.initial_context_summary ?? null,
    rounds: priorState.rounds ?? [],
    current_ambiguity: priorState.current_ambiguity ?? 1.0,
    threshold: payload.threshold ?? priorState.threshold,
    codebase_context: priorState.codebase_context ?? null,
    challenge_modes_used: priorState.challenge_modes_used ?? [],
    ontology_snapshots: priorState.ontology_snapshots ?? [],
  };

  const overlay: DeepInterviewState = {
    current_phase: payload.current_phase ?? (prior['current_phase'] as string | undefined) ?? 'deep-interview',
    state: newState,
  };

  const next = mergeWithHeartbeat(prior, overlay as Record<string, unknown>);
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
}

/**
 * Strict-overlay merge refreshing last_touched_at.
 * Absent file → throws (ADR-7). Never writes a sessionId field.
 *
 * current_ambiguity is nested under state (SKILL.md:93 shape); current_phase
 * lives at the top level alongside active/started_at/last_touched_at.
 */
export function updateDeepInterviewState(
  sessionId: string,
  partial: {
    current_phase?: string;
    current_ambiguity?: number;
  }
): void {
  const path = resolveStatePath(sessionId);
  const prior = readRaw(path);
  if (prior === null) {
    throw new Error(
      `deep-interview-state: no state file found at "${path}". ` +
        'Either the seed is missing (re-invoke the deep-interview skill) ' +
        'or this session was adopted by another session.'
    );
  }

  const overlay: Record<string, unknown> = {};
  if (partial.current_phase !== undefined) {
    overlay['current_phase'] = partial.current_phase;
  }
  if (partial.current_ambiguity !== undefined) {
    // current_ambiguity lives under state per the SKILL.md rich shape
    const priorState =
      typeof prior['state'] === 'object' && prior['state'] !== null && !Array.isArray(prior['state'])
        ? (prior['state'] as Record<string, unknown>)
        : {};
    overlay['state'] = { ...priorState, current_ambiguity: partial.current_ambiguity };
  }

  const next = mergeWithHeartbeat(prior, overlay);
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
}

/**
 * Reads the raw state. Returns null if absent or malformed.
 */
export function readDeepInterviewState(sessionId: string): Record<string, unknown> | null {
  return readRaw(resolveStatePath(sessionId));
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
      // First non-flag token = subcommand; subsequent positional args are ignored
      // (A3: no positional arg may redirect the filename)
      result['_subcommand'] = arg;
    }
    // Subsequent positional args after subcommand are silently dropped (A3)
  }
  return result;
}

function str(v: string | boolean | undefined): string | undefined {
  return v !== undefined && v !== true ? String(v) : undefined;
}

function main(): void {
  let sessionId: string;
  try {
    sessionId = resolveSessionIdOrThrow();
  } catch (e) {
    process.stderr.write(`deep-interview-state: ${String(e)}\n`);
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const subcommand = args['_subcommand'];

  if (subcommand === 'init') {
    const threshold = str(args['threshold']);
    try {
      initDeepInterviewState(sessionId, {
        initial_idea: str(args['initial-idea']),
        interview_id: str(args['interview-id']),
        type: str(args['type']) as 'greenfield' | 'brownfield' | undefined,
        current_phase: str(args['current-phase']),
        threshold: threshold !== undefined ? Number(threshold) : undefined,
      });
    } catch (e) {
      process.stderr.write(`deep-interview-state init: ${String(e)}\n`);
      process.exit(1);
    }
  } else if (subcommand === 'update') {
    const ambiguity = str(args['current-ambiguity']);
    try {
      updateDeepInterviewState(sessionId, {
        current_phase: str(args['current-phase']),
        current_ambiguity: ambiguity !== undefined ? Number(ambiguity) : undefined,
      });
    } catch (e) {
      process.stderr.write(`deep-interview-state update: ${String(e)}\n`);
      process.exit(1);
    }
  } else if (subcommand === 'get') {
    const result = readDeepInterviewState(sessionId);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stderr.write(
      'Usage: deep-interview-state.ts <init|update|get> [options]\n' +
        '  init   --initial-idea <text> [--interview-id <id>] [--type greenfield|brownfield]\n' +
        '         [--current-phase <phase>] [--threshold <n>]\n' +
        '  update --current-phase <phase> [--current-ambiguity <n>]\n' +
        '  get\n'
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

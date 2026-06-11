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
 *          [--current-phase <phase>] [--threshold <n>] [--codebase-context <text>]
 *          Strict overlay of the rich shape into the EXISTING seed file.
 *   update [--current-phase <phase>] [--current-ambiguity <n>]
 *          [--append-round '<json>'] [--append-ontology-snapshot '<json>']
 *          [--append-round-stdin] [--append-ontology-snapshot-stdin]
 *          [--challenge-mode <name>]
 *          Strict-overlay merge refreshing last_touched_at.
 *          Stdin flags (--append-round-stdin / --append-ontology-snapshot-stdin) read
 *          the JSON payload from stdin, avoiding shell-quoting hazards with free text
 *          (apostrophes, double quotes). Use with a quoted-delimiter heredoc in SKILL.md.
 *   get    Print the state JSON.
 *
 * No sessionId field is ever written (ADR-7, RC3 root-cause fix: sid is
 * derived from the FILENAME only, never from file content).
 */

import { readFileSync, existsSync } from 'fs';
import { getOmtDir } from '@lib/omt-dir';
import {
  resolveSessionIdOrThrow,
  mergeWithHeartbeat,
  writeFileNoCreate,
  STATE_PREFIX,
  listOthers,
  adopt,
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
    codebase_context?: string;
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
    codebase_context: payload.codebase_context ?? priorState.codebase_context ?? null,
    challenge_modes_used: priorState.challenge_modes_used ?? [],
    ontology_snapshots: priorState.ontology_snapshots ?? [],
  };

  const overlay: DeepInterviewState = {
    current_phase: payload.current_phase ?? (prior['current_phase'] as string | undefined) ?? 'deep-interview',
    state: newState,
  };

  const next = mergeWithHeartbeat(prior, overlay as Record<string, unknown>);
  writeFileNoCreate(path, JSON.stringify(next, null, 2));
}

/**
 * Strict-overlay merge refreshing last_touched_at.
 * Absent file → throws (ADR-7). Never writes a sessionId field.
 *
 * current_ambiguity is nested under state (SKILL.md:93 shape); current_phase
 * lives at the top level alongside active/started_at/last_touched_at.
 *
 * append_round: appended to state.rounds array (one round object per call).
 * append_ontology_snapshot: appended to state.ontology_snapshots array.
 * challenge_mode: appended to state.challenge_modes_used (deduplicated).
 */
export function updateDeepInterviewState(
  sessionId: string,
  partial: {
    current_phase?: string;
    current_ambiguity?: number;
    append_round?: unknown;
    append_ontology_snapshot?: unknown;
    challenge_mode?: string;
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

  const needsStateOverlay =
    partial.current_ambiguity !== undefined ||
    partial.append_round !== undefined ||
    partial.append_ontology_snapshot !== undefined ||
    partial.challenge_mode !== undefined;

  if (needsStateOverlay) {
    // current_ambiguity lives under state per the SKILL.md rich shape
    const priorState =
      typeof prior['state'] === 'object' && prior['state'] !== null && !Array.isArray(prior['state'])
        ? (prior['state'] as Record<string, unknown>)
        : {};

    const updatedState: Record<string, unknown> = { ...priorState };

    if (partial.current_ambiguity !== undefined) {
      updatedState['current_ambiguity'] = partial.current_ambiguity;
    }
    if (partial.append_round !== undefined) {
      const existing = Array.isArray(priorState['rounds']) ? (priorState['rounds'] as unknown[]) : [];
      updatedState['rounds'] = [...existing, partial.append_round];
    }
    if (partial.append_ontology_snapshot !== undefined) {
      const existing = Array.isArray(priorState['ontology_snapshots'])
        ? (priorState['ontology_snapshots'] as unknown[])
        : [];
      updatedState['ontology_snapshots'] = [...existing, partial.append_ontology_snapshot];
    }
    if (partial.challenge_mode !== undefined) {
      const existing = Array.isArray(priorState['challenge_modes_used'])
        ? (priorState['challenge_modes_used'] as string[])
        : [];
      if (!existing.includes(partial.challenge_mode)) {
        updatedState['challenge_modes_used'] = [...existing, partial.challenge_mode];
      }
    }

    overlay['state'] = updatedState;
  }

  const next = mergeWithHeartbeat(prior, overlay);
  writeFileNoCreate(path, JSON.stringify(next, null, 2));
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
        codebase_context: str(args['codebase-context']),
      });
    } catch (e) {
      process.stderr.write(`deep-interview-state init: ${String(e)}\n`);
      process.exit(1);
    }
  } else if (subcommand === 'update') {
    const ambiguity = str(args['current-ambiguity']);
    const appendRoundRaw = str(args['append-round']);
    const appendSnapshotRaw = str(args['append-ontology-snapshot']);
    const appendRoundStdin = args['append-round-stdin'] === true;
    const appendSnapshotStdin = args['append-ontology-snapshot-stdin'] === true;
    const challengeMode = str(args['challenge-mode']);

    // Read stdin once if any stdin flag is present (avoids double-read)
    let stdinText: string | undefined;
    if (appendRoundStdin || appendSnapshotStdin) {
      try {
        stdinText = readFileSync(0, 'utf8').trim();
      } catch (e) {
        process.stderr.write(`deep-interview-state update: failed to read stdin: ${String(e)}\n`);
        process.exit(1);
      }
    }

    // Validate JSON flags before any write
    let appendRound: unknown;
    if (appendRoundStdin) {
      try {
        appendRound = JSON.parse(stdinText!);
      } catch {
        process.stderr.write(
          `deep-interview-state update: --append-round-stdin: invalid JSON from stdin\n`
        );
        process.exit(1);
      }
    } else if (appendRoundRaw !== undefined) {
      try {
        appendRound = JSON.parse(appendRoundRaw);
      } catch {
        process.stderr.write(
          `deep-interview-state update: --append-round: invalid JSON: ${appendRoundRaw}\n`
        );
        process.exit(1);
      }
    }
    let appendSnapshot: unknown;
    if (appendSnapshotStdin) {
      try {
        appendSnapshot = JSON.parse(stdinText!);
      } catch {
        process.stderr.write(
          `deep-interview-state update: --append-ontology-snapshot-stdin: invalid JSON from stdin\n`
        );
        process.exit(1);
      }
    } else if (appendSnapshotRaw !== undefined) {
      try {
        appendSnapshot = JSON.parse(appendSnapshotRaw);
      } catch {
        process.stderr.write(
          `deep-interview-state update: --append-ontology-snapshot: invalid JSON: ${appendSnapshotRaw}\n`
        );
        process.exit(1);
      }
    }

    try {
      updateDeepInterviewState(sessionId, {
        current_phase: str(args['current-phase']),
        current_ambiguity: ambiguity !== undefined ? Number(ambiguity) : undefined,
        append_round: appendRound,
        append_ontology_snapshot: appendSnapshot,
        challenge_mode: challengeMode,
      });
    } catch (e) {
      process.stderr.write(`deep-interview-state update: ${String(e)}\n`);
      process.exit(1);
    }
  } else if (subcommand === 'get') {
    const result = readDeepInterviewState(sessionId);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (subcommand === 'list-others') {
    const candidates = listOthers('deep-interview');
    for (const c of candidates) {
      const shortSid = c.sid.slice(0, 8);
      process.stdout.write(
        `${shortSid}\t${c.sid}\t${c.purpose}\t${c.startedAt}\t${c.idleSeconds}s\n`
      );
    }
  } else if (subcommand === 'adopt') {
    const srcSid = str(args['src']);
    if (!srcSid) {
      process.stderr.write('adopt: --src <sid> is required\n');
      process.exit(1);
    }
    try {
      adopt('deep-interview', srcSid);
    } catch (e) {
      process.stderr.write(`deep-interview-state adopt: ${String(e)}\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: deep-interview-state.ts <init|update|get|list-others|adopt> [options]\n' +
        '  init   --initial-idea <text> [--interview-id <id>] [--type greenfield|brownfield]\n' +
        '         [--current-phase <phase>] [--threshold <n>] [--codebase-context <text>]\n' +
        "  update [--current-phase <phase>] [--current-ambiguity <n>]\n" +
        "         [--append-round '<json>'] [--append-ontology-snapshot '<json>']\n" +
        "         [--append-round-stdin]            (recommended for free-text: read JSON from stdin)\n" +
        "         [--append-ontology-snapshot-stdin] (recommended for free-text: read JSON from stdin)\n" +
        '         [--challenge-mode <name>]\n' +
        '  get\n' +
        '  list-others\n' +
        '  adopt --src <sid>\n'
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

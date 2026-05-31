/**
 * Prometheus skill state CLI.
 *
 * State file path: ${OMT_DIR}/prometheus-state-${sessionId}.json
 * Session ID: process.env.OMT_SESSION_ID || "default"
 *
 * Subcommands:
 *   set --phase <S> [--plan-path <p>] [--resume-summary <s>]
 *   clear
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';

export interface PrometheusState {
  active: boolean;
  /** Pipeline token: S0-S8 */
  phase: string;
  /** Absolute path under $OMT_DIR/plans/, empty string until plan written */
  plan_path: string;
  /** Single-line pause bookmark, control chars normalized to spaces */
  resume_summary: string;
  /** Local ISO-8601 without milliseconds, seeded once via `date -Iseconds` */
  started_at: string;
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

function deleteFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore missing file
  }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getOmtDir(): string {
  const dir = process.env.OMT_DIR;
  if (!dir) throw new Error('OMT_DIR environment variable is not set');
  return dir;
}

export function resolveStatePath(sessionId: string): string {
  return `${getOmtDir()}/prometheus-state-${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// started_at seeding — spawns shell date to match ralph's BSD-parseable format
// ---------------------------------------------------------------------------

function seedStartedAt(): string {
  try {
    const result = execSync(
      'date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S"',
      { encoding: 'utf8', shell: '/bin/sh' }
    );
    return result.trim();
  } catch {
    // Final fallback: manual ISO-8601 without milliseconds
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

// ---------------------------------------------------------------------------
// Normalize resume_summary: replace U+0000-U+001F with space
// ---------------------------------------------------------------------------

function normalizeResumeSummary(s: string): string {
  return s.replace(/[\x00-\x1F]/g, ' ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readPrometheusState(sessionId: string): PrometheusState | null {
  const path = resolveStatePath(sessionId);
  const content = readFileOrNull(path);
  if (!content) return null;
  try {
    const state = JSON.parse(content) as PrometheusState;
    return state.active ? state : null;
  } catch {
    return null;
  }
}

export function setPrometheusState(
  sessionId: string,
  opts: { phase: string; plan_path: string; resume_summary: string }
): void {
  const path = resolveStatePath(sessionId);
  const existing = readFileOrNull(path);
  let prior: Partial<PrometheusState> = {};
  if (existing) {
    try {
      prior = JSON.parse(existing) as Partial<PrometheusState>;
    } catch {
      // corrupt file; start fresh
    }
  }

  const state: PrometheusState = {
    active: true,
    phase: opts.phase,
    plan_path: opts.plan_path ?? prior.plan_path ?? '',
    resume_summary: normalizeResumeSummary(opts.resume_summary ?? prior.resume_summary ?? ''),
    // Preserve existing started_at on subsequent writes; seed on first write
    started_at: prior.started_at ?? seedStartedAt(),
  };

  writeFileSafe(path, JSON.stringify(state, null, 2));
}

export function clearPrometheusState(sessionId: string): void {
  deleteFile(resolveStatePath(sessionId));
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const subcommand = args['_subcommand'];
  const sessionId = process.env.OMT_SESSION_ID || 'default';

  if (subcommand === 'set') {
    const phase = String(args['phase'] ?? '');
    const planPath = String(args['plan-path'] ?? '');
    const resumeSummary = String(args['resume-summary'] ?? '');
    setPrometheusState(sessionId, { phase, plan_path: planPath, resume_summary: resumeSummary });
  } else if (subcommand === 'clear') {
    clearPrometheusState(sessionId);
  } else {
    process.stderr.write('Usage: prometheus-state.ts <set|clear> [options]\n');
    process.exit(1);
  }
}

// Only run CLI when executed directly (not when imported as a module)
if (import.meta.main) {
  main();
}

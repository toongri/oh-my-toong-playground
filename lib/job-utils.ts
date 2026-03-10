/**
 * Shared utility functions for job orchestrator scripts.
 *
 * Extracted from council-job.ts, chunk-review-job.ts, spec-review-job.ts.
 * All functions are byte-identical across consumers except where parameterized
 * (safeFileName fallback, parseArgs booleanFlags).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

export function exitWithError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Host / role detection
// ---------------------------------------------------------------------------

export function detectHostRole(skillDir: string): string {
  const normalized = skillDir.replace(/\\/g, '/');
  if (normalized.includes('/.claude/skills/')) return 'claude';
  if (normalized.includes('/.gemini/skills/')) return 'gemini';
  if (normalized.includes('/.codex/skills/')) return 'codex';
  return 'unknown';
}

export function normalizeBool(value: unknown): boolean | null {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

export function resolveAutoRole(role: string | undefined | null, hostRole: string): string {
  const roleLc = String(role || '').trim().toLowerCase();
  if (roleLc && roleLc !== 'auto') return roleLc;
  if (hostRole === 'codex') return 'codex';
  if (hostRole === 'claude') return 'claude';
  return 'claude';
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function safeFileName(name: string, fallback: string = 'member'): string {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return cleaned || fallback;
}

export function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function readJsonIfExists(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timing (async — non-blocking setTimeout)
// ---------------------------------------------------------------------------

export function sleepMs(ms: number): Promise<void> {
  const msNum = Number(ms);
  if (!Number.isFinite(msNum) || msNum <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.trunc(msNum)));
}

// ---------------------------------------------------------------------------
// Status computation helpers
// ---------------------------------------------------------------------------

export function computeTerminalDoneCount(counts: Record<string, number | undefined>): number {
  const c = counts || {};
  return (
    Number(c.done || 0) +
    Number(c.missing_cli || 0) +
    Number(c.error || 0) +
    Number(c.timed_out || 0) +
    Number(c.canceled || 0) +
    Number(c.non_retryable || 0)
  );
}

export function asCodexStepStatus(value: string): string {
  const v = String(value || '');
  if (v === 'pending' || v === 'in_progress' || v === 'completed') return v;
  return 'pending';
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const DEFAULT_BOOLEAN_FLAGS = new Set([
  'json',
  'text',
  'checklist',
  'help',
  'h',
  'verbose',
  'include-chairman',
  'exclude-chairman',
  'stdin',
]);

export function parseArgs(
  argv: string[],
  booleanFlags: Set<string> = DEFAULT_BOOLEAN_FLAGS,
): Record<string, unknown> & { _: string[] } {
  const args = argv.slice(2);
  const out: Record<string, unknown> & { _: string[] } = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }

    const eqIdx = a.indexOf('=');
    if (eqIdx !== -1) {
      out[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
      continue;
    }

    const normalizedKey = a.slice(2);
    if (booleanFlags.has(normalizedKey)) {
      out[normalizedKey] = true;
      continue;
    }

    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[normalizedKey] = true;
      continue;
    }
    out[normalizedKey] = next;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wait cursor utilities
// ---------------------------------------------------------------------------

export interface WaitCursor {
  version: string;
  bucketSize: number;
  dispatchBucket: number;
  doneBucket: number;
  isDone: boolean;
}

export function parseWaitCursor(value: string | null | undefined): WaitCursor | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  const version = parts[0];
  if (version === 'v1' && parts.length === 4) {
    const bucketSize = Number(parts[1]);
    const doneBucket = Number(parts[2]);
    const isDone = parts[3] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket: 0, doneBucket, isDone };
  }
  if (version === 'v2' && parts.length === 5) {
    const bucketSize = Number(parts[1]);
    const dispatchBucket = Number(parts[2]);
    const doneBucket = Number(parts[3]);
    const isDone = parts[4] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(dispatchBucket) || dispatchBucket < 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket, doneBucket, isDone };
  }
  return null;
}

export function formatWaitCursor(bucketSize: number, dispatchBucket: number, doneBucket: number, isDone: boolean): string {
  return `v2:${bucketSize}:${dispatchBucket}:${doneBucket}:${isDone ? 1 : 0}`;
}

export function resolveBucketSize(
  options: Record<string, unknown>,
  total: number,
  prevCursor: WaitCursor | null,
): number {
  const raw = options.bucket != null ? options.bucket : options['bucket-size'];

  if (raw == null || raw === true) {
    if (prevCursor && prevCursor.bucketSize) return prevCursor.bucketSize;
  } else {
    const asString = String(raw).trim().toLowerCase();
    if (asString !== 'auto') {
      const num = Number(asString);
      if (!Number.isFinite(num) || num <= 0) exitWithError(`wait: invalid --bucket: ${raw}`);
      return Math.trunc(num);
    }
  }

  const totalNum = Number(total || 0);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return 1;
  return Math.max(1, Math.ceil(totalNum / 5));
}

// ---------------------------------------------------------------------------
// Job ID generation
// ---------------------------------------------------------------------------

export function generateJobId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)}-${crypto
    .randomBytes(3)
    .toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Project root resolution
// ---------------------------------------------------------------------------

export function findProjectRoot(scriptDir: string): string {
  let current = scriptDir;
  const root = path.parse(current).root;

  while (current !== root) {
    const omtDir = path.join(current, '.omt');
    if (fs.existsSync(omtDir) && fs.statSync(omtDir).isDirectory()) {
      return current;
    }

    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }

    current = path.dirname(current);
  }

  const normalized = scriptDir.replace(/\\/g, '/');
  const scriptsMatch = normalized.match(/^(.+?)\/\.(claude|gemini|codex|opencode)\/(scripts|skills\/[^/]+\/scripts)(?:\/|$)/);
  if (scriptsMatch) {
    return scriptsMatch[1];
  }

  return path.resolve(scriptDir, '../..');
}

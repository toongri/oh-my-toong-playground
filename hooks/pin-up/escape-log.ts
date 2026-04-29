/**
 * Escape log for pin validation failures (AC-14).
 *
 * Appends JSONL entries to $OMT_DIR/pins/.escape.jsonl.
 * raw field truncated to ≤1500 bytes (PIPE_BUF 4KB safety margin).
 * Uses appendFileSync (O_APPEND semantics) for atomic append.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { EscapeEntry, EscapeReason } from './types.ts';

const ESCAPE_FILE_NAME = '.escape.jsonl';
const RAW_MAX_BYTES = 1500;
const RAW_TRUNCATE_SUFFIX = '...';

function escapePath(omtDir: string): string {
  return join(omtDir, 'pins', ESCAPE_FILE_NAME);
}

/**
 * Truncate a string to ≤ maxBytes UTF-8 bytes.
 * Appends "..." if truncated.
 */
export function truncateRaw(raw: string, maxBytes: number = RAW_MAX_BYTES): string {
  const buf = Buffer.from(raw, 'utf-8');
  if (buf.length <= maxBytes) return raw;

  const suffixBytes = Buffer.byteLength(RAW_TRUNCATE_SUFFIX, 'utf-8');
  const keepBytes = maxBytes - suffixBytes;
  const truncated = buf.slice(0, keepBytes).toString('utf-8');
  return truncated + RAW_TRUNCATE_SUFFIX;
}

/**
 * Append an escape entry to $OMT_DIR/pins/.escape.jsonl.
 * Fails silently to maintain fail-open behavior.
 */
export function appendEscapeEntry(
  omtDir: string,
  sessionId: string,
  reason: EscapeReason,
  pinSlug: string | null,
  raw: string,
): void {
  try {
    const path = escapePath(omtDir);
    mkdirSync(dirname(path), { recursive: true });

    const entry: EscapeEntry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      reason,
      pin_slug: pinSlug,
      raw: truncateRaw(raw),
    };

    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Silent fail — escape log is best-effort operational logging
  }
}

/**
 * Cursor state management for pin-up hook (AC-3b).
 *
 * Tracks per-transcript byte_offset + last_uuid so subsequent Stop invocations
 * only scan new content. Uses atomic write (tmp → fsync → rename) to survive
 * crashes. Corrupt file → fail-open (full re-scan).
 *
 * Inter-process race protection: saveCursor uses an exclusive lock file
 * (${cursorPath}.lock) with read-merge-write inside the lock to prevent
 * lost-update when two Stop hooks run concurrently.
 */

import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { randomBytes } from 'crypto';
import type { CursorState } from './types.ts';

const CURSOR_FILE_NAME = '.cursor.json';
const LOCK_BACKOFF_MS = 10;
const LOCK_MAX_RETRIES = 100; // 10ms × 100 = 1 second max wait

function cursorPath(omtDir: string): string {
  return join(omtDir, 'pins', CURSOR_FILE_NAME);
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/**
 * Acquire an exclusive lock via 'wx' open (fails if file exists).
 * Retries with 10ms backoff up to LOCK_MAX_RETRIES times (≤1 second total).
 * Returns the lock file descriptor.
 * Throws if lock cannot be acquired within the timeout.
 */
function acquireLock(lockPath: string): number {
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      return openSync(lockPath, 'wx');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (i < LOCK_MAX_RETRIES - 1) sleepSync(LOCK_BACKOFF_MS);
    }
  }
  throw new Error(`[pin-up] saveCursor: could not acquire lock ${lockPath} after ${LOCK_MAX_RETRIES} retries`);
}

/**
 * Load cursor state from $OMT_DIR/pins/.cursor.json.
 * Returns empty state if file is absent or corrupt (fail-open).
 */
export function loadCursor(omtDir: string): CursorState {
  const path = cursorPath(omtDir);
  try {
    if (!existsSync(path)) {
      return { transcripts: {} };
    }
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as CursorState;
    // Minimal schema validation
    if (!parsed || typeof parsed.transcripts !== 'object') {
      return { transcripts: {} };
    }
    return parsed;
  } catch {
    // Corrupt or unparseable — fail-open
    return { transcripts: {} };
  }
}

/**
 * Save cursor state atomically with inter-process lock protection.
 *
 * Lock protocol: exclusive create (wx) on ${cursorPath}.lock, retry with
 * 10ms backoff up to 100 times (≤ 1 second), release in finally.
 *
 * Write protocol inside lock:
 *   1. Re-read latest disk state (another process may have written since our
 *      last loadCursor call).
 *   2. Merge: spread disk state first, then in-memory state on top, so the
 *      current session's updates always win over stale disk data.
 *   3. Atomic write: tmp → fsync → rename.
 */
export function saveCursor(omtDir: string, state: CursorState): void {
  const path = cursorPath(omtDir);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const lockPath = `${path}.lock`;
  const lockFd = acquireLock(lockPath);
  try {
    // Re-read disk to get any writes from concurrent processes
    const latest = loadCursor(omtDir);

    // Merge: disk entries first, in-memory entries win (current session is newer)
    const merged: CursorState = {
      ...latest,
      transcripts: { ...latest.transcripts, ...state.transcripts },
    };

    const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');

    // fsync before rename to ensure durability
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(tmp, path);
  } finally {
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* already gone — ignore */ }
  }
}

/**
 * Get the cursor entry for a specific transcript, normalized to absolute path.
 */
export function getCursorEntry(
  state: CursorState,
  transcriptPath: string,
): CursorState['transcripts'][string] | undefined {
  const normalized = resolve(transcriptPath);
  return state.transcripts[normalized];
}

/**
 * Update cursor entry for a specific transcript.
 * Returns a new CursorState (immutable update).
 */
export function updateCursorEntry(
  state: CursorState,
  transcriptPath: string,
  byteOffset: number,
  lastUuid: string,
): CursorState {
  const normalized = resolve(transcriptPath);
  return {
    ...state,
    transcripts: {
      ...state.transcripts,
      [normalized]: {
        byte_offset: byteOffset,
        last_uuid: lastUuid,
        updated_at: new Date().toISOString(),
      },
    },
  };
}

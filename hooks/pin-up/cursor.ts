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

import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { randomBytes } from 'crypto';
import type { CursorState } from './types.ts';

const CURSOR_FILE_NAME = '.cursor.json';
const LOCK_BACKOFF_MS = 10;
const LOCK_MAX_RETRIES = 100; // 10ms × 100 = 1 second max wait
// 정상 saveCursor 사이클은 1초 이내 완료 → 30배 여유로 IO 폭증도 커버
const STALE_LOCK_THRESHOLD_MS = 30_000;

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
      // Stale detection: lockfile older than threshold = previous holder crashed
      try {
        const lockMtimeMs = statSync(lockPath).mtimeMs;
        if (Date.now() - lockMtimeMs > STALE_LOCK_THRESHOLD_MS) {
          unlinkSync(lockPath);
          continue; // immediate retry without backoff
        }
      } catch {
        // race lost — another process unlinked or stat failed; fall through to retry
      }
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
 * Save a single transcript cursor entry atomically with inter-process lock protection.
 *
 * Lock protocol: exclusive create (wx) on ${cursorPath}.lock, retry with
 * 10ms backoff up to 100 times (≤ 1 second), release in finally.
 *
 * Write protocol inside lock:
 *   1. Re-read latest disk state (another process may have written since our
 *      last loadCursor call).
 *   2. Delta merge: 잠금 내부에서 disk fresh value를 기준으로, 해당 transcript 키 하나만
 *      새 값으로 갱신. 나머지 키는 모두 disk fresh value 그대로 유지.
 *   3. Atomic write: tmp → fsync → rename.
 */
export function saveCursor(
  omtDir: string,
  delta: { transcriptPath: string; byteOffset: number; lastUuid: string },
): void {
  const path = cursorPath(omtDir);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const lockPath = `${path}.lock`;
  const lockFd = acquireLock(lockPath);
  try {
    // 잠금 내부에서 disk를 다시 읽어 동시 프로세스의 갱신을 반영
    const latest = loadCursor(omtDir);

    // 해당 transcript 키만 새 값으로 갱신, 나머지 키는 disk fresh value 보존
    const merged: CursorState = updateCursorEntry(
      latest,
      delta.transcriptPath,
      delta.byteOffset,
      delta.lastUuid,
    );

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

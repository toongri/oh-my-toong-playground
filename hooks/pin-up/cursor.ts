/**
 * Cursor state management for pin-up hook (AC-3b).
 *
 * Tracks per-transcript byte_offset + last_uuid so subsequent Stop invocations
 * only scan new content. Uses atomic write (tmp → fsync → rename) to survive
 * crashes. Corrupt file → fail-open (full re-scan).
 */

import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { randomBytes } from 'crypto';
import type { CursorState } from './types.ts';

const CURSOR_FILE_NAME = '.cursor.json';

function cursorPath(omtDir: string): string {
  return join(omtDir, 'pins', CURSOR_FILE_NAME);
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
 * Save cursor state atomically: write to tmp → fsync → rename.
 * Normalizes transcript_path keys via path.resolve().
 */
export function saveCursor(omtDir: string, state: CursorState): void {
  const path = cursorPath(omtDir);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const payload = JSON.stringify(state, null, 2);

  writeFileSync(tmp, payload, 'utf-8');

  // fsync before rename to ensure durability
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tmp, path);
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

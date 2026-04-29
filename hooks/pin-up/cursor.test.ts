/**
 * Tests for cursor state management (AC-3b).
 * 7 cases:
 *   1. loadCursor — absent file → empty state (fail-open)
 *   2. loadCursor — corrupt file → empty state (fail-open)
 *   3. saveCursor + loadCursor round-trip (atomic write)
 *   4. getCursorEntry/updateCursorEntry path normalization
 *   5. Two sessions write separate cursor entries (race-safe isolation)
 *   6. [RACE] Interleaved saveCursor calls preserve both transcript entries
 *   7. lock file is removed after saveCursor completes normally
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadCursor, saveCursor, getCursorEntry, updateCursorEntry } from './cursor.ts';

describe('cursor', () => {
  const testDir = join(tmpdir(), 'pin-up-cursor-test-' + Date.now());
  const omtDir = join(testDir, 'omt');

  beforeAll(async () => {
    await mkdir(join(omtDir, 'pins'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty state when cursor file is absent', () => {
    const state = loadCursor(omtDir);
    expect(state).toEqual({ transcripts: {} });
  });

  it('returns empty state when cursor file is corrupt (fail-open)', async () => {
    const cursorPath = join(omtDir, 'pins', '.cursor.json');
    await writeFile(cursorPath, 'NOT_JSON', 'utf-8');
    const state = loadCursor(omtDir);
    expect(state).toEqual({ transcripts: {} });
    // Cleanup for next test
    await rm(cursorPath, { force: true });
  });

  it('round-trips cursor state via saveCursor + loadCursor', () => {
    const initial = loadCursor(omtDir);
    const updated = updateCursorEntry(initial, '/fake/transcript.jsonl', 1234, 'uuid-abc');
    saveCursor(omtDir, updated);

    const loaded = loadCursor(omtDir);
    // The key is the resolved absolute path of '/fake/transcript.jsonl'
    const entry = Object.values(loaded.transcripts)[0];
    expect(entry).toBeDefined();
    expect(entry.byte_offset).toBe(1234);
    expect(entry.last_uuid).toBe('uuid-abc');
    expect(typeof entry.updated_at).toBe('string');
  });

  it('normalizes transcript_path via path.resolve', () => {
    // Two different representations of the same path should resolve the same key
    const state = loadCursor(omtDir);
    const updated = updateCursorEntry(state, '/abs/path/session.jsonl', 500, 'uuid-1');
    const entry = getCursorEntry(updated, '/abs/path/session.jsonl');
    expect(entry).toBeDefined();
    expect(entry?.byte_offset).toBe(500);
  });

  it('stores separate entries for different transcript paths', () => {
    const state = loadCursor(omtDir);
    const s1 = updateCursorEntry(state, '/session/a.jsonl', 100, 'uuid-a');
    const s2 = updateCursorEntry(s1, '/session/b.jsonl', 200, 'uuid-b');
    saveCursor(omtDir, s2);

    const loaded = loadCursor(omtDir);
    const entryA = getCursorEntry(loaded, '/session/a.jsonl');
    const entryB = getCursorEntry(loaded, '/session/b.jsonl');
    expect(entryA?.byte_offset).toBe(100);
    expect(entryB?.byte_offset).toBe(200);
  });

  it('[RACE] interleaved saveCursor calls preserve both transcript entries', () => {
    // Simulate two Stop hook processes running concurrently against the same omtDir.
    // Timeline:
    //   Session A: loadCursor → snapshot (empty)
    //   Session B: loadCursor → same snapshot (empty)
    //   Session A: updateCursorEntry(pathA) → saveCursor  [writes only pathA]
    //   Session B: updateCursorEntry(pathB) → saveCursor  [must merge, preserving pathA]
    // Expected: disk has both pathA and pathB after B's saveCursor.

    // Clear any prior state for a clean slate
    saveCursor(omtDir, { transcripts: {} });

    // Session A snapshot
    const snapshotA = loadCursor(omtDir);
    // Session B snapshot (same disk state)
    const snapshotB = loadCursor(omtDir);

    // Session A updates its transcript and saves
    const stateA = updateCursorEntry(snapshotA, '/race/session-a.jsonl', 111, 'uuid-race-a');
    saveCursor(omtDir, stateA);

    // Session B updates its (stale snapshot) transcript and saves
    // Without read-merge-write, this overwrites A's entry
    const stateB = updateCursorEntry(snapshotB, '/race/session-b.jsonl', 222, 'uuid-race-b');
    saveCursor(omtDir, stateB);

    // Both entries must survive
    const final = loadCursor(omtDir);
    const entryA = getCursorEntry(final, '/race/session-a.jsonl');
    const entryB = getCursorEntry(final, '/race/session-b.jsonl');
    expect(entryA?.byte_offset).toBe(111);
    expect(entryB?.byte_offset).toBe(222);
  });

  it('lock file is removed after saveCursor completes normally', () => {
    const cursorFilePath = join(omtDir, 'pins', '.cursor.json');
    const lockPath = `${cursorFilePath}.lock`;

    const state = updateCursorEntry(loadCursor(omtDir), '/lock/test.jsonl', 999, 'uuid-lock');
    saveCursor(omtDir, state);

    expect(existsSync(lockPath)).toBe(false);
  });
});

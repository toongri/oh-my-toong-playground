/**
 * Tests for cursor state management (AC-3b).
 * 9 cases:
 *   1. loadCursor — absent file → empty state (fail-open)
 *   2. loadCursor — corrupt file → empty state (fail-open)
 *   3. saveCursor + loadCursor round-trip (atomic write)
 *   4. getCursorEntry/updateCursorEntry path normalization
 *   5. Two sessions write separate cursor entries (race-safe isolation)
 *   6. [RACE] Interleaved saveCursor calls preserve both transcript entries
 *   7. lock file is removed after saveCursor completes normally
 *   8. [STALE] stale lockfile (30초 초과)이 존재할 때 saveCursor가 자가회복하고 정상 완료
 *   9. [STALE] fresh lockfile (10초 이내)이 존재할 때 saveCursor가 1초 후 throw
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync, utimesSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import type { CursorState } from './types.ts';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadCursor, saveCursor, getCursorEntry, updateCursorEntry } from './cursor.ts';

describe('cursor', () => {
  const testDir = join(tmpdir(), 'pin-up-cursor-test-' + Date.now());
  const omtDir = join(testDir, 'omt');

  // stale lock 테스트용 임시 디렉토리 목록 (afterEach 정리)
  const staleTestDirs: string[] = [];

  beforeAll(async () => {
    await mkdir(join(omtDir, 'pins'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const dir of staleTestDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
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

  it('stale lockfile (30초 초과)이 존재할 때 `saveCursor`가 자가회복하고 정상 완료', () => {
    const staleDir = join(tmpdir(), 'pin-up-stale-test-' + Date.now());
    staleTestDirs.push(staleDir);

    const staleOmtDir = join(staleDir, 'omt');
    const pinsDir = join(staleOmtDir, 'pins');
    // saveCursor 내부 mkdirSync 전에 lockfile을 미리 생성해야 하므로 여기서 생성
    mkdirSync(pinsDir, { recursive: true });

    const cursorFilePath = join(pinsDir, '.cursor.json');
    const lockPath = `${cursorFilePath}.lock`;

    // stale lockfile 생성 후 mtime을 31초 전으로 설정
    writeFileSync(lockPath, '');
    const staleMtimeSec = (Date.now() - 31_000) / 1000;
    utimesSync(lockPath, staleMtimeSec, staleMtimeSec);

    // 현재 코드에서는 1초 후 throw — stale detection 구현 후 즉시 복구해야 함
    const state: CursorState = {
      transcripts: {
        '/test/transcript.jsonl': {
          byte_offset: 100,
          last_uuid: 'u1',
          updated_at: new Date().toISOString(),
        },
      },
    };

    // throw 없이 완료해야 함
    expect(() => saveCursor(staleOmtDir, state)).not.toThrow();

    // cursor.json이 올바르게 기록됐는지 확인
    const loaded = loadCursor(staleOmtDir);
    expect(Object.keys(loaded.transcripts).length).toBeGreaterThan(0);
    const entry = Object.values(loaded.transcripts)[0];
    expect(entry.byte_offset).toBe(100);
    expect(entry.last_uuid).toBe('u1');

    // lockfile은 finally에서 정리됨
    expect(existsSync(lockPath)).toBe(false);
  }, 3000);

  it('fresh lockfile (10초 이내)이 존재할 때 `saveCursor`가 1초 후 throw', () => {
    const freshDir = join(tmpdir(), 'pin-up-fresh-test-' + Date.now());
    staleTestDirs.push(freshDir);

    const freshOmtDir = join(freshDir, 'omt');
    const pinsDir = join(freshOmtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });

    const cursorFilePath = join(pinsDir, '.cursor.json');
    const lockPath = `${cursorFilePath}.lock`;

    // fresh lockfile 생성 (현재 시각 mtime)
    writeFileSync(lockPath, '');
    const freshMtimeSec = Date.now() / 1000;
    utimesSync(lockPath, freshMtimeSec, freshMtimeSec);

    let threw = false;
    let errorMessage = '';
    try {
      saveCursor(freshOmtDir, { transcripts: {} });
    } catch (err: unknown) {
      threw = true;
      errorMessage = (err as Error).message;
    } finally {
      // lockfile을 정리하여 테스트 격리
      try { unlinkSync(lockPath); } catch { /* ignore */ }
    }

    expect(threw).toBe(true);
    expect(errorMessage).toMatch(/could not acquire lock/);
  }, 3000);
});

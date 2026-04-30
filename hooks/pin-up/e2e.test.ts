/**
 * E2E tests for pin-up hook (AC-16).
 *
 * 5 scenarios:
 *   S1. Single <pin> emit fixture → pin-up writes file + cursor updated
 *   S2. Empty transcript → 0 files written + cursor advanced to end
 *   S3. Invalid frontmatter (missing required field) → escape.jsonl entry + no file written
 *   S4. Duplicate slug (two entries same slug in one transcript) → second gets timestamp suffix, both files exist
 *   S4-multi-process. Concurrent pin-up processes with same slug → both pin files preserved (no silent overwrite) + cursor retains both transcript keys
 *   S5 (P2-3 callsite). Forward reference: pin A references pin B (same batch) → both written, no escape entry
 *   S6 (P2-2). Write failure on 1 pin → cursor NOT advanced (다음 실행에서 재처리 가능)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { main } from './index.ts';
import { loadCursor, getCursorEntry } from './cursor.ts';
import { spawnSync, spawn } from 'child_process';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function assistantLine(text: string, uuid = 'uuid-e2e-001'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: { content: [{ type: 'text', text }] },
  }) + '\n';
}

const VALID_PIN_TEXT = `<pin slug="code-auth-jwt" source_url="auth/jwt.ts:142" authority="code" tier="L1" tags="auth,jwt" sensitivity="private">
## 한 줄 요지
verifyToken이 auth 권위

## SSOT 위치
auth/jwt.ts:142

## 전후 컨텍스트
OAuth 리팩토링 중 발견

## 관련 cross-link
없음
</pin>`;

const INVALID_PIN_TEXT = `<pin slug="code-bad-pin" source_url="x" authority="code" tier="L1" tags="t" sensitivity="private">
This body has NO required Korean section headers at all.
</pin>`;

// ─── Setup ────────────────────────────────────────────────────────────────────

async function runHook(input: Record<string, string>): Promise<void> {
  // Temporarily override process.stdin by stubbing stdin reading
  // Instead, we directly call the main flow via stdin injection using a subprocess
  // For unit/e2e here we test via the orchestration modules directly
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pin-up e2e', () => {
  const testDir = join(tmpdir(), 'pin-up-e2e-' + Date.now());
  const omtDir = join(testDir, 'omt');
  const pinsDir = join(omtDir, 'pins');
  const escapeFile = join(pinsDir, '.escape.jsonl');

  const savedEnv = process.env.OMT_DIR;
  const savedArgv = process.argv;

  beforeAll(async () => {
    await mkdir(pinsDir, { recursive: true });
    process.env.OMT_DIR = omtDir;
  });

  afterAll(async () => {
    if (savedEnv === undefined) {
      delete process.env.OMT_DIR;
    } else {
      process.env.OMT_DIR = savedEnv;
    }
    process.argv = savedArgv;
    await rm(testDir, { recursive: true, force: true });
  });

  it('S1: valid <pin> emit → file written + cursor updated', async () => {
    const transcriptPath = join(testDir, 's1-transcript.jsonl');
    await writeFile(transcriptPath, assistantLine(VALID_PIN_TEXT), 'utf-8');

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s1' });
    const result = spawnSync('bun', ['run', hookPath], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OMT_DIR: omtDir },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // Pin file should be written
    const pinFile = join(pinsDir, 'code-auth-jwt.md');
    expect(existsSync(pinFile)).toBe(true);

    const content = await readFile(pinFile, 'utf-8');
    expect(content).toContain('slug: "code-auth-jwt"');
    expect(content).toContain('한 줄 요지');

    // Cursor should be updated
    const cursor = loadCursor(omtDir);
    const entry = getCursorEntry(cursor, transcriptPath);
    expect(entry).toBeDefined();
    expect(entry!.byte_offset).toBeGreaterThan(0);
  });

  it('S2: empty transcript → 0 files written + continue', async () => {
    const transcriptPath = join(testDir, 's2-transcript.jsonl');
    await writeFile(transcriptPath, '', 'utf-8');

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s2' });
    const result = spawnSync('bun', ['run', hookPath], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OMT_DIR: omtDir },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // No new pin files for s2 content
    const files = await readdir(pinsDir);
    const s2Files = files.filter(
      (f) => !f.startsWith('.') && !f.startsWith('code-auth-jwt')
    );
    expect(s2Files.filter((f) => f.endsWith('.md'))).toHaveLength(0);
  });

  it('S3: invalid frontmatter → escape.jsonl entry + no pin file', async () => {
    const transcriptPath = join(testDir, 's3-transcript.jsonl');
    await writeFile(transcriptPath, assistantLine(INVALID_PIN_TEXT, 'uuid-s3'), 'utf-8');

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s3' });
    const result = spawnSync('bun', ['run', hookPath], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OMT_DIR: omtDir },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // Pin file should NOT be written
    expect(existsSync(join(pinsDir, 'code-bad-pin.md'))).toBe(false);

    // escape.jsonl should have an entry
    expect(existsSync(escapeFile)).toBe(true);
    const escapeContent = await readFile(escapeFile, 'utf-8');
    const entries = escapeContent.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const s3Entry = entries.find((e) => e.session_id === 'e2e-s3');
    expect(s3Entry).toBeDefined();
    expect(s3Entry.pin_slug).toBe('code-bad-pin');
  });

  it('[S4-single-process] duplicate slug in one transcript → second gets timestamp suffix, both files exist', async () => {
    // Write a pin with slug code-dup-test
    const dupPinA = VALID_PIN_TEXT
      .replace(/slug="[^"]*"/, 'slug="code-dup-test"')
      .replace(/source_url="[^"]*"/, 'source_url="x://dup-a"');
    const dupPinB = VALID_PIN_TEXT
      .replace(/slug="[^"]*"/, 'slug="code-dup-test"')
      .replace(/source_url="[^"]*"/, 'source_url="x://dup-b"');

    // Transcript with two pins with same slug
    const transcriptPath = join(testDir, 's4-transcript.jsonl');
    await writeFile(
      transcriptPath,
      assistantLine(dupPinA, 'uuid-s4a') + assistantLine(dupPinB, 'uuid-s4b'),
      'utf-8',
    );

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s4' });
    const result = spawnSync('bun', ['run', hookPath], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OMT_DIR: omtDir },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // First file exists
    expect(existsSync(join(pinsDir, 'code-dup-test.md'))).toBe(true);

    // Second file has timestamp suffix (code-dup-test-HHMMSS.md)
    const files = await readdir(pinsDir);
    const dupFiles = files.filter((f) => f.startsWith('code-dup-test') && f.endsWith('.md'));
    expect(dupFiles.length).toBe(2);
  });

  it('[S4-multi-process] concurrent pin-up processes preserve both pin files for duplicate slug', async () => {
    /**
     * RED reasoning (without T4/T5 fixes):
     *   - Without T5 (writePinAtomically / wx flag): process B's writeFileSync would
     *     overwrite process A's file — only 1 file survives, bodies identical → FAIL
     *     on "exactly 2 files" assertion.
     *   - Without T4 (cursor lock / read-merge-write): process B reads cursor before A
     *     writes → A's updateCursorEntry is overwritten by B's saveCursor → cursor
     *     missing transcript-A key → FAIL on "both keys present" assertion.
     *
     * GREEN (T4+T5 applied): wx exclusive create ensures distinct filenames; lock
     * ensures cursor merge preserves both transcript keys.
     */

    const RACE_SLUG = 'code-auth-jwt-verify';

    // Pin body differs by discovery_context so we can distinguish the two files
    function makeRacePin(label: string): string {
      return `<pin slug="${RACE_SLUG}" source_url="auth/jwt.ts:200" authority="code" tier="L1" tags="auth,jwt" sensitivity="private" discovery_context="race-${label}">
## 한 줄 요지
verifyToken race ${label}

## SSOT 위치
auth/jwt.ts:200

## 전후 컨텍스트
race test fixture ${label}

## 관련 cross-link
없음
</pin>`;
    }

    // Two separate transcripts — each from a different "session"
    const transcriptA = join(testDir, 's4mp-transcript-a.jsonl');
    const transcriptB = join(testDir, 's4mp-transcript-b.jsonl');

    await Promise.all([
      writeFile(transcriptA, assistantLine(makeRacePin('A'), 'uuid-s4mp-a'), 'utf-8'),
      writeFile(transcriptB, assistantLine(makeRacePin('B'), 'uuid-s4mp-b'), 'utf-8'),
    ]);

    const hookPath = join(import.meta.dir, 'index.ts');
    const inputA = JSON.stringify({ transcript_path: transcriptA, sessionId: 'e2e-s4mp-a' });
    const inputB = JSON.stringify({ transcript_path: transcriptB, sessionId: 'e2e-s4mp-b' });

    const env = { ...process.env, OMT_DIR: omtDir };

    // Launch both processes concurrently via async spawn
    function runProcess(input: string): Promise<{ exitCode: number; stdout: string }> {
      return new Promise((resolve, reject) => {
        const proc = spawn('bun', ['run', hookPath], { env });
        let stdout = '';
        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.on('error', reject);
        proc.on('exit', (code) => {
          resolve({ exitCode: code ?? 1, stdout });
        });
        proc.stdin.write(input);
        proc.stdin.end();
      });
    }

    // Start both at the same time, wait for both to finish
    const [resultA, resultB] = await Promise.all([
      runProcess(inputA),
      runProcess(inputB),
    ]);

    // Both processes must exit cleanly (fail-open)
    expect(resultA.exitCode).toBe(0);
    expect(resultB.exitCode).toBe(0);

    const outputA = JSON.parse(resultA.stdout.trim().split('\n').pop() || '{}');
    const outputB = JSON.parse(resultB.stdout.trim().split('\n').pop() || '{}');
    expect(outputA.continue).toBe(true);
    expect(outputB.continue).toBe(true);

    // Exactly 2 .md files for RACE_SLUG — no silent overwrite
    const allFiles = await readdir(pinsDir);
    const raceFiles = allFiles.filter(
      (f) => f.startsWith(RACE_SLUG) && f.endsWith('.md'),
    );
    expect(raceFiles.length).toBe(2);

    // Both files are non-empty
    for (const f of raceFiles) {
      const content = await readFile(join(pinsDir, f), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }

    // The two files have different bodies (distinguishable by discovery_context label)
    const contents = await Promise.all(
      raceFiles.map((f) => readFile(join(pinsDir, f), 'utf-8')),
    );
    const hasA = contents.some((c) => c.includes('race-A'));
    const hasB = contents.some((c) => c.includes('race-B'));
    expect(hasA).toBe(true);
    expect(hasB).toBe(true);

    // Cursor must contain both transcript keys (T4 lock: no lost-update)
    const cursor = loadCursor(omtDir);
    const entryA = getCursorEntry(cursor, transcriptA);
    const entryB = getCursorEntry(cursor, transcriptB);
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    expect(entryA!.byte_offset).toBeGreaterThan(0);
    expect(entryB!.byte_offset).toBeGreaterThan(0);

    // No stale lock files
    const lockFiles = allFiles.filter((f) => f.endsWith('.lock'));
    expect(lockFiles).toHaveLength(0);
  });

  it('[S5] 같은 배치에서 forward reference: A가 B를 related로 참조 → 둘 다 write됨', async () => {
    // pin-a references pin-b via related, but pin-b does not yet exist on disk.
    // Both are emitted in the same transcript (same batch).
    // With batchSlugs forwarded to validatePin, both should pass validation and be written.
    const pinA = `<pin slug="code-feature-a" source_url="src/a.ts:10" authority="code" tier="L1" tags="feat" sensitivity="private" related="code-feature-b">
## 한 줄 요지
Feature A depends on B

## SSOT 위치
src/a.ts:10

## 전후 컨텍스트
Forward reference to B

## 관련 cross-link
code-feature-b
</pin>`;

    const pinB = `<pin slug="code-feature-b" source_url="src/b.ts:20" authority="code" tier="L1" tags="feat" sensitivity="private">
## 한 줄 요지
Feature B

## SSOT 위치
src/b.ts:20

## 전후 컨텍스트
Referenced by A

## 관련 cross-link
없음
</pin>`;

    const transcriptPath = join(testDir, 's5-transcript.jsonl');
    await writeFile(
      transcriptPath,
      assistantLine(pinA, 'uuid-s5a') + assistantLine(pinB, 'uuid-s5b'),
      'utf-8',
    );

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s5' });
    const result = spawnSync('bun', ['run', hookPath], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OMT_DIR: omtDir },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // Both pin files must be written
    expect(existsSync(join(pinsDir, 'code-feature-a.md'))).toBe(true);
    expect(existsSync(join(pinsDir, 'code-feature-b.md'))).toBe(true);

    // escape.jsonl must NOT have an entry for session e2e-s5
    if (existsSync(escapeFile)) {
      const escapeContent = await readFile(escapeFile, 'utf-8');
      const entries = escapeContent.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const s5Entries = entries.filter((e) => e.session_id === 'e2e-s5');
      expect(s5Entries).toHaveLength(0);
    }

    // Cursor must be advanced
    const cursor = loadCursor(omtDir);
    const entry = getCursorEntry(cursor, transcriptPath);
    expect(entry).toBeDefined();
    expect(entry!.byte_offset).toBeGreaterThan(0);
  });

  it('[S6] pin write 실패 시 cursor advance 보류 → 다음 실행에서 재처리 가능', async () => {
    // Use a separate omtDir for this test to isolate from shared state
    const s6OmtDir = join(testDir, 's6-omt');
    const s6PinsDir = join(s6OmtDir, 'pins');
    await mkdir(s6PinsDir, { recursive: true });

    const pinText = `<pin slug="code-write-fail" source_url="src/fail.ts:1" authority="code" tier="L1" tags="test" sensitivity="private">
## 한 줄 요지
Write failure test

## SSOT 위치
src/fail.ts:1

## 전후 컨텍스트
Write will fail due to read-only dir

## 관련 cross-link
없음
</pin>`;

    const transcriptPath = join(testDir, 's6-transcript.jsonl');
    await writeFile(transcriptPath, assistantLine(pinText, 'uuid-s6'), 'utf-8');

    // Make pinsDir read-only to cause EACCES on writeFileSync
    chmodSync(s6PinsDir, 0o555);

    const hookPath = join(import.meta.dir, 'index.ts');
    const input = JSON.stringify({ transcript_path: transcriptPath, sessionId: 'e2e-s6' });
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync('bun', ['run', hookPath], {
        input,
        encoding: 'utf-8',
        env: { ...process.env, OMT_DIR: s6OmtDir },
      });
    } finally {
      // Restore permissions so cleanup can proceed
      chmodSync(s6PinsDir, 0o755);
    }

    // Hook must still exit cleanly (fail-open)
    expect(result!.status).toBe(0);
    const output = JSON.parse(result!.stdout.trim().split('\n').pop() || '{}');
    expect(output.continue).toBe(true);

    // Stderr must contain WARN about the skipped pin
    expect(result!.stderr).toContain('[pin-up] WARN');
    expect(result!.stderr).toContain('code-write-fail');

    // Stderr must NOT contain ERROR — cursor save should be skipped cleanly,
    // not triggered by an uncaught exception from saveCursor.
    // (P2-2 fix: allWritesSucceeded=false → saveCursor is never called → no ERROR thrown)
    expect(result!.stderr).not.toContain('[pin-up] ERROR');

    // Pin file must NOT be written (write failed)
    expect(existsSync(join(s6PinsDir, 'code-write-fail.md'))).toBe(false);

    // Cursor must NOT be advanced — byte_offset stays at 0 (or entry absent)
    const cursor = loadCursor(s6OmtDir);
    const entry = getCursorEntry(cursor, transcriptPath);
    // Either no entry at all, or byte_offset is 0 (not advanced past initial)
    const byteOffset = entry?.byte_offset ?? 0;
    expect(byteOffset).toBe(0);
  });
});

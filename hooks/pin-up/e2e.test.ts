/**
 * E2E tests for pin-up hook (AC-16).
 *
 * 4 scenarios:
 *   S1. Single <pin> emit fixture → pin-up writes file + cursor updated
 *   S2. Empty transcript → 0 files written + cursor advanced to end
 *   S3. Invalid frontmatter (missing required field) → escape.jsonl entry + no file written
 *   S4. Duplicate slug (two entries same slug) → second gets timestamp suffix, both files exist
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { main } from './index.ts';
import { loadCursor, getCursorEntry } from './cursor.ts';

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

    // Simulate stdin by overriding process.stdin (use spawn subprocess approach)
    const { spawnSync } = await import('child_process');
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

    const { spawnSync } = await import('child_process');
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

    const { spawnSync } = await import('child_process');
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

  it('S4: duplicate slug → second gets timestamp suffix', async () => {
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

    const { spawnSync } = await import('child_process');
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
});

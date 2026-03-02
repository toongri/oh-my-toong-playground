import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt,
  MAX_RETRIES,
  BASE_DELAY_MS,
  NON_RETRYABLE_PATTERNS,
  NON_RETRYABLE_EXIT_CODES,
  runWithRetry,
  type RunWithRetryOpts,
} from './worker-utils.ts';

const noopSleep = async () => {};

function makeOpts(testDir: string, overrides: Partial<RunWithRetryOpts> = {}): RunWithRetryOpts {
  const reviewerDir = join(testDir, 'reviewer');
  mkdirSync(reviewerDir, { recursive: true });
  return {
    program: '/bin/sh',
    args: ['-c', 'exit 1'],
    prompt: 'test prompt',
    reviewer: 'test-reviewer',
    reviewerDir,
    command: '/bin/sh -c "exit 1"',
    timeoutSec: 10,
    sleepFn: noopSleep,
    ...overrides,
  };
}

describe('non-retryable 에러 분류', () => {
  const testDir = join(tmpdir(), 'worker-utils-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('TerminalQuotaError in error.txt → state=non_retryable, 재시도 없음', async () => {
    const subDir = join(testDir, 'quota-error');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "TerminalQuotaError: quota limit reached" >&2; exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    const result = await runWithRetry(opts);

    expect(result.state).toBe('non_retryable');
    // attempt stays at 0 — no retry occurred
    expect(result.attempt).toBe(0);
  });

  it('exitCode=42 → state=non_retryable', async () => {
    const subDir = join(testDir, 'exit42');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "some error" >&2; exit 42'],
      command: '/bin/sh -c "exit 42"',
    });

    const result = await runWithRetry(opts);

    expect(result.state).toBe('non_retryable');
    expect(result.exitCode).toBe(42);
  });

  it('retryable error (Connection refused) → 재시도 진행', async () => {
    const subDir = join(testDir, 'retryable');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "Connection refused" >&2; exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    const result = await runWithRetry(opts);

    // After exhausting retries, final state should still be 'error' (not non_retryable)
    expect(result.state).toBe('error');
    // Attempt should be MAX_RETRIES (1), indicating retry occurred
    expect(result.attempt).toBe(1);
  });

  it('error.txt 없음/비어있음 → 재시도 진행', async () => {
    const subDir = join(testDir, 'no-errortxt');
    // Exit with code 1 but no stderr output → empty error.txt
    const opts = makeOpts(subDir, {
      args: ['-c', 'exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    const result = await runWithRetry(opts);

    // Should retry and end with 'error' (not non_retryable)
    expect(result.state).toBe('error');
    expect(result.attempt).toBe(1);
  });

  it('status.json이 non_retryable로 업데이트됨', async () => {
    const subDir = join(testDir, 'status-update');
    const reviewerDir = join(subDir, 'reviewer');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "QUOTA_EXHAUSTED" >&2; exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    await runWithRetry(opts);

    const statusPath = join(reviewerDir, 'status.json');
    expect(existsSync(statusPath)).toBe(true);
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(status.state).toBe('non_retryable');
  });
});

describe('NON_RETRYABLE_PATTERNS 배열 검증', () => {
  it('예상 패턴들을 포함해야 함', () => {
    const expected = [
      'TerminalQuotaError',
      'QUOTA_EXHAUSTED',
      'Quota exceeded',
      'upgrade to Plus',
      'Selected model is at capacity',
      'ran out of room',
      'authentication_error',
      'attempt 10/10',
    ];

    for (const pattern of expected) {
      expect(NON_RETRYABLE_PATTERNS).toContain(pattern);
    }
  });
});

describe('NON_RETRYABLE_EXIT_CODES 검증', () => {
  it('예상 exit code들을 포함해야 함', () => {
    expect(NON_RETRYABLE_EXIT_CODES.has(41)).toBe(true);
    expect(NON_RETRYABLE_EXIT_CODES.has(42)).toBe(true);
    expect(NON_RETRYABLE_EXIT_CODES.has(52)).toBe(true);
    expect(NON_RETRYABLE_EXIT_CODES.has(130)).toBe(true);
  });

  it('일반 exit code는 포함하지 않아야 함', () => {
    expect(NON_RETRYABLE_EXIT_CODES.has(0)).toBe(false);
    expect(NON_RETRYABLE_EXIT_CODES.has(1)).toBe(false);
    expect(NON_RETRYABLE_EXIT_CODES.has(2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// helpers (shared blocks)
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'worker-utils-shared-'));
}

// ---------------------------------------------------------------------------
// splitCommand
// ---------------------------------------------------------------------------

describe('splitCommand', () => {

  test('splits a simple command', () => {
    expect(splitCommand('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });

  test('handles single-quoted arguments', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  test('handles double-quoted arguments', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  test('handles escaped characters', () => {
    expect(splitCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  test('returns null for unmatched single quote', () => {
    expect(splitCommand("echo 'hello")).toBe(null);
  });

  test('returns null for unmatched double quote', () => {
    expect(splitCommand('echo "hello')).toBe(null);
  });

  test('returns empty array for empty string', () => {
    expect(splitCommand('')).toEqual([]);
  });

  test('returns empty array for null/undefined', () => {
    expect(splitCommand(null)).toEqual([]);
    expect(splitCommand(undefined)).toEqual([]);
  });

  test('handles multiple spaces between tokens', () => {
    expect(splitCommand('a   b   c')).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// atomicWriteJson
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes valid JSON to the target path', () => {
    const fp = join(tmpDir, 'test.json');
    const payload = { member: 'gpt-4', state: 'done' };
    atomicWriteJson(fp, payload);
    const result = JSON.parse(readFileSync(fp, 'utf8'));
    expect(result).toEqual(payload);
  });

  test('overwrites existing file', () => {
    const fp = join(tmpDir, 'test.json');
    atomicWriteJson(fp, { v: 1 });
    atomicWriteJson(fp, { v: 2 });
    const result = JSON.parse(readFileSync(fp, 'utf8'));
    expect(result.v).toBe(2);
  });

  test('leaves no tmp files behind', () => {
    const fp = join(tmpDir, 'test.json');
    atomicWriteJson(fp, { ok: true });
    const files = readdirSync(tmpDir);
    expect(files).toEqual(['test.json']);
  });
});

// ---------------------------------------------------------------------------
// sleepMsAsync
// ---------------------------------------------------------------------------

describe('sleepMsAsync', () => {

  test('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleepMsAsync(50);
    const elapsed = Date.now() - start;
    expect(elapsed >= 40).toBe(true);
  });

  test('resolves with undefined', async () => {
    const result = await sleepMsAsync(1);
    expect(result).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

describe('assemblePrompt', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns structured prompt with REVIEW CONTENT when role file exists and reviewContent provided', () => {
    const roleContent = '# Claude Role\nYou are a helpful assistant.';
    writeFileSync(join(tmpDir, 'claude.md'), roleContent, 'utf8');

    const result = assemblePrompt({
      promptsDir: tmpDir,
      entityName: 'claude',
      rawPrompt: 'Analyze the code',
      reviewContent: 'function foo() { return 42; }',
    });

    expect(result.isStructured).toBe(true);
    expect(result.assembled.includes('<system-instructions>')).toBe(true);
    expect(result.assembled.includes(roleContent)).toBe(true);
    expect(result.assembled.includes('--- REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('function foo() { return 42; }')).toBe(true);
    expect(result.assembled.includes('--- END REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('[HEADLESS SESSION]')).toBe(true);
    expect(result.assembled.includes('Analyze the code')).toBe(true);
  });

  test('returns structured prompt without REVIEW CONTENT when role file exists and no reviewContent', () => {
    const roleContent = '# Codex Role\nYou are an expert reviewer.';
    writeFileSync(join(tmpDir, 'codex.md'), roleContent, 'utf8');

    const result = assemblePrompt({
      promptsDir: tmpDir,
      entityName: 'codex',
      rawPrompt: 'Review this PR',
    });

    expect(result.isStructured).toBe(true);
    expect(result.assembled.includes('<system-instructions>')).toBe(true);
    expect(result.assembled.includes(roleContent)).toBe(true);
    expect(!result.assembled.includes('--- REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('[HEADLESS SESSION]')).toBe(true);
    expect(result.assembled.includes('Review this PR')).toBe(true);
  });

  test('returns unstructured fallback when role file is absent', () => {
    // No role file created in tmpDir
    const result = assemblePrompt({
      promptsDir: tmpDir,
      entityName: 'nonexistent',
      rawPrompt: 'Just do the thing',
    });

    expect(result.isStructured).toBe(false);
    expect(result.assembled).toBe('Just do the thing');
  });

  test('returns unstructured fallback when role file is absent even with reviewContent', () => {
    // No role file, but reviewContent provided - still falls back
    const result = assemblePrompt({
      promptsDir: tmpDir,
      entityName: 'missing-model',
      rawPrompt: 'Analyze it',
      reviewContent: 'some review content',
    });

    expect(result.isStructured).toBe(false);
    expect(result.assembled).toBe('Analyze it');
  });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  test('MAX_RETRIES is 1', () => {
    expect(MAX_RETRIES).toBe(1);
  });

  test('BASE_DELAY_MS is 1000', () => {
    expect(BASE_DELAY_MS).toBe(1000);
  });
});

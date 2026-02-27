import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
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

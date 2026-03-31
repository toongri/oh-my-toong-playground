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
  HEARTBEAT_INTERVAL_MS,
  runOnce,
  runWithRetry,
  type RunOnceOpts,
  type RunWithRetryOpts,
} from './worker-utils.ts';

const noopSleep = async () => {};

function makeOpts(testDir: string, overrides: Partial<RunWithRetryOpts> = {}): RunWithRetryOpts {
  const memberDir = join(testDir, 'member');
  mkdirSync(memberDir, { recursive: true });
  return {
    program: '/bin/sh',
    args: ['-c', 'exit 1'],
    prompt: 'test prompt',
    member: 'test-member',
    memberDir,
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

  it('attempt 0의 non-retryable stderr가 attempt 1 판정에 영향 없음', async () => {
    const subDir = join(testDir, 'cross-attempt-isolation');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "Connection refused" >&2; exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    // Pre-seed error.txt with a non-retryable pattern (simulating previous attempt residue)
    writeFileSync(join(opts.memberDir, 'error.txt'), 'TerminalQuotaError from previous attempt\n');

    const result = await runWithRetry(opts);

    // With offset tracking: pre-seeded content is ignored → retryable → state='error'
    // Without offset tracking: pre-seeded content included → non_retryable (BUG)
    expect(result.state).toBe('error');
  });

  it('status.json이 non_retryable로 업데이트됨', async () => {
    const subDir = join(testDir, 'status-update');
    const memberDir = join(subDir, 'member');
    const opts = makeOpts(subDir, {
      args: ['-c', 'echo "QUOTA_EXHAUSTED" >&2; exit 1'],
      command: '/bin/sh -c "exit 1"',
    });

    await runWithRetry(opts);

    const statusPath = join(memberDir, 'status.json');
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

  test('HEARTBEAT_INTERVAL_MS is 10000', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

describe('runOnce heartbeat', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'worker-heartbeat-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRunOnceOpts(overrides: Partial<RunOnceOpts> = {}): RunOnceOpts {
    const memberDir = join(tmpDir, 'member');
    mkdirSync(memberDir, { recursive: true });
    return {
      program: '/bin/sh',
      args: ['-c', 'sleep 1'],
      prompt: 'test prompt',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "sleep 1"',
      timeoutSec: 10,
      attempt: 0,
      heartbeatIntervalMs: 50,
      ...overrides,
    };
  }

  test('실행 중에 status.json에 lastHeartbeat을 기록함', async () => {
    const opts = makeRunOnceOpts();
    const statusPath = join(opts.memberDir, 'status.json');

    const promise = runOnce(opts);

    // Wait for at least 2 heartbeat cycles to fire
    await sleepMsAsync(200);

    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(status.lastHeartbeat).toBeDefined();
    // lastHeartbeat should be a valid ISO8601 timestamp
    expect(() => new Date(status.lastHeartbeat as string).toISOString()).not.toThrow();
    // Other fields should still be present
    expect(status.member).toBe('test-member');
    expect(status.state).toBe('running');

    await promise;
  });

  test('finalize 후 heartbeat interval이 정리되어 status.json이 갱신되지 않음', async () => {
    const opts = makeRunOnceOpts({
      args: ['-c', 'exit 0'],
      command: '/bin/sh -c "exit 0"',
    });
    const statusPath = join(opts.memberDir, 'status.json');

    await runOnce(opts);

    // Read status immediately after resolve — should be terminal state
    const statusAfterFinalize = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(statusAfterFinalize.state).toBe('done');

    // Wait for multiple heartbeat cycles that would fire if interval leaked
    await sleepMsAsync(200);

    // status.json should still not have lastHeartbeat (finalize wrote terminal payload without it)
    const statusAfterWait = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(statusAfterWait.lastHeartbeat).toBeUndefined();
    expect(statusAfterWait.state).toBe('done');
  });

  test('state가 running이 아닌 경우 heartbeat가 status.json을 덮어쓰지 않음', async () => {
    const opts = makeRunOnceOpts({
      args: ['-c', 'sleep 0.5'],
      command: '/bin/sh -c "sleep 0.5"',
    });
    const statusPath = join(opts.memberDir, 'status.json');

    const promise = runOnce(opts);

    // Wait for heartbeat to start writing
    await sleepMsAsync(150);

    // Manually overwrite status.json with a terminal state (simulating external finalize)
    const terminalPayload = { member: 'test-member', state: 'done', exitCode: 0 };
    writeFileSync(statusPath, JSON.stringify(terminalPayload));

    // Wait for additional heartbeat cycles
    await sleepMsAsync(200);

    // status.json should remain the terminal state — heartbeat guard skipped the write
    const statusAfterWait = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(statusAfterWait.state).toBe('done');
    expect(statusAfterWait.lastHeartbeat).toBeUndefined();

    await promise;
  });
});

// ---------------------------------------------------------------------------
// runOnce 환경 변수 전파
// ---------------------------------------------------------------------------

function createCapturingSpawnFn() {
  const captured: { env?: Record<string, string> } = {};
  const mockSpawn = (program: string, args: string[], options: any) => {
    captured.env = options?.env;
    const child = new (require('events').EventEmitter)();
    const stdin = { write: () => true, end: () => {}, on: () => stdin } as any;
    (child as any).stdin = stdin;
    (child as any).stdout = null;
    (child as any).stderr = null;
    (child as any).pid = 12345;
    process.nextTick(() => {
      child.emit('exit', 0, null);
      process.nextTick(() => child.emit('close', 0, null));
    });
    return child as any;
  };
  return { mockSpawn, captured };
}

describe('runOnce 환경 변수 전파', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'worker-env-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEnvTestOpts(overrides: Partial<RunOnceOpts> = {}): RunOnceOpts {
    const memberDir = join(tmpDir, 'member');
    mkdirSync(memberDir, { recursive: true });
    return {
      program: '/bin/sh',
      args: ['-c', 'exit 0'],
      prompt: 'test prompt',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "exit 0"',
      timeoutSec: 10,
      attempt: 0,
      ...overrides,
    };
  }

  it('NO_COLOR=1 전파 확인', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn });
    await runOnce(opts);
    expect(captured.env?.NO_COLOR).toBe('1');
  });

  it('TERM=dumb 전파 확인', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn });
    await runOnce(opts);
    expect(captured.env?.TERM).toBe('dumb');
  });

  it('FORCE_COLOR=0 전파 확인', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn });
    await runOnce(opts);
    expect(captured.env?.FORCE_COLOR).toBe('0');
  });

  it('workerEnv가 NO_COLOR override 가능', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn, workerEnv: { NO_COLOR: '' } });
    await runOnce(opts);
    expect(captured.env?.NO_COLOR).toBe('');
  });
});

// ---------------------------------------------------------------------------
// retry 시 output 정제
// ---------------------------------------------------------------------------

describe('retry 시 output 정제', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'worker-retry-output-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('attempt 1에서 output.txt에 attempt 마커 없음', async () => {
    const subDir = join(tmpDir, 'no-marker');
    const memberDir = join(subDir, 'member');
    mkdirSync(memberDir, { recursive: true });

    await runOnce({
      program: '/bin/sh',
      args: ['-c', 'echo "retry output"'],
      prompt: 'test prompt',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c \'echo "retry output"\'',
      timeoutSec: 10,
      attempt: 1,
    });

    const outputContent = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(outputContent).not.toContain('--- attempt');
  });

  it('attempt 1에서 output.txt가 truncate됨 (이전 데이터 없음)', async () => {
    const subDir = join(tmpDir, 'truncate-check');
    const memberDir = join(subDir, 'member');
    mkdirSync(memberDir, { recursive: true });

    // Pre-write old data
    writeFileSync(join(memberDir, 'output.txt'), 'old data\n');

    await runOnce({
      program: '/bin/sh',
      args: ['-c', 'echo "new output"'],
      prompt: 'test prompt',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c \'echo "new output"\'',
      timeoutSec: 10,
      attempt: 1,
    });

    const outputContent = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(outputContent).toContain('new output');
    expect(outputContent).not.toContain('old data');
  });

  it('errOffset=0 for retry: non-retryable 패턴 감지 정상', async () => {
    const subDir = join(tmpDir, 'eroffset-retry');
    const memberDir = join(subDir, 'member');
    mkdirSync(memberDir, { recursive: true });

    // Write a counter file to make the script behave differently on each invocation
    const counterFile = join(subDir, 'counter');
    writeFileSync(counterFile, '0');

    const script = `
  COUNT=$(cat ${counterFile})
  echo $((COUNT + 1)) > ${counterFile}
  if [ "$COUNT" = "0" ]; then
    echo "Connection refused: retryable error" >&2
    exit 1
  else
    echo "TerminalQuotaError: quota exceeded" >&2
    exit 1
  fi
`;

    const result = await runWithRetry({
      program: '/bin/sh',
      args: ['-c', script],
      prompt: 'test prompt',
      member: 'test-member',
      memberDir,
      command: '/bin/sh script',
      timeoutSec: 10,
      sleepFn: noopSleep,
    });

    expect(result.state).toBe('non_retryable');
  });
});

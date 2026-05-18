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
  NON_RETRYABLE_EXIT_CODES,
  NON_RETRYABLE_STATES,
  HEARTBEAT_INTERVAL_MS,
  PROMPT_MAX_BYTES,
  runOnce,
  runWithRetry,
  runOneTurn,
  resumeOneTurn,
  type RunOnceOpts,
  type RunWithRetryOpts,
  type RunOneTurnOpts,
} from './worker-utils.ts';
import type { AgentDriver, ParseResult, CliType } from './agent-drivers/types.ts';

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
    // Attempt should be MAX_RETRIES (2), indicating retry occurred
    expect(result.attempt).toBe(2);
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
    expect(result.attempt).toBe(2);
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
    expect(splitCommand(null as any)).toEqual([]);
    expect(splitCommand(undefined as any)).toEqual([]);
  });

  test('handles multiple spaces between tokens', () => {
    expect(splitCommand('a   b   c')).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// atomicWriteJson
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  let tmpDir: string;

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
  let tmpDir: string;

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
  test('MAX_RETRIES is 2', () => {
    expect(MAX_RETRIES).toBe(2);
  });

  test('BASE_DELAY_MS is 1000', () => {
    expect(BASE_DELAY_MS).toBe(1000);
  });

  test('HEARTBEAT_INTERVAL_MS is 10000', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10_000);
  });

  test('NON_RETRYABLE_STATES size 4', () => {
    expect(NON_RETRYABLE_STATES.size).toBe(4);
  });

  test('NON_RETRYABLE_STATES missing_cli', () => {
    expect(NON_RETRYABLE_STATES.has('missing_cli')).toBe(true);
  });

  test('NON_RETRYABLE_STATES timed_out', () => {
    expect(NON_RETRYABLE_STATES.has('timed_out')).toBe(true);
  });

  test('NON_RETRYABLE_STATES canceled', () => {
    expect(NON_RETRYABLE_STATES.has('canceled')).toBe(true);
  });

  test('NON_RETRYABLE_STATES non_retryable', () => {
    expect(NON_RETRYABLE_STATES.has('non_retryable')).toBe(true);
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
  const mockSpawn = (_program: string, _args: string[], options: any) => {
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
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
    await runOnce(opts);
    expect(captured.env?.NO_COLOR).toBe('1');
  });

  it('TERM=dumb 전파 확인', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
    await runOnce(opts);
    expect(captured.env?.TERM).toBe('dumb');
  });

  it('FORCE_COLOR=0 전파 확인', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
    await runOnce(opts);
    expect(captured.env?.FORCE_COLOR).toBe('0');
  });

  it('workerEnv가 NO_COLOR override 가능', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();
    const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any, workerEnv: { NO_COLOR: '' } });
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

// ---------------------------------------------------------------------------
// opencode silent-failure sentinel (AC-1, AC-1.5, AC-2)
// ---------------------------------------------------------------------------

// Helper: create a real executable named 'opencode' in a temp bin dir.
// Sentinel checks path.basename(program) === 'opencode' so absolute wrapper paths work.
function makeOpencodeWrapper(dir: string, stderrOutput: string): string {
  const wrapperDir = join(dir, 'bin');
  mkdirSync(wrapperDir, { recursive: true });
  const wrapper = join(wrapperDir, 'opencode');
  writeFileSync(wrapper, `#!/bin/sh\n${stderrOutput}\nexit 0\n`);
  const { chmodSync } = require('fs');
  chmodSync(wrapper, 0o755);
  return join(wrapperDir, 'opencode');
}

describe('opencode sentinel: happy path + false-positive guards', () => {
  const testDir = join(tmpdir(), 'sentinel-guard-' + Date.now());

  beforeAll(() => { mkdirSync(testDir, { recursive: true }); });
  afterAll(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('opencode normal response: exit 0 + stdout non-empty + stderr empty → state=done', async () => {
    const subDir = join(testDir, 'happy-path');
    const program = makeOpencodeWrapper(subDir, 'echo "rendered review text"');
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('done');
  });

  it('false-positive guard (a): stdout non-empty + Error: on stderr → sentinel does not fire → state=done', async () => {
    const subDir = join(testDir, 'fp-stdout');
    // stdout non-empty wins: even with Error: in stderr, sentinel must not fire
    const program = makeOpencodeWrapper(subDir,
      'echo "some output"\nprintf "Error: Model not found\\n" >&2');
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('done');
  });

  it('false-positive guard (b): stderr empty → sentinel does not fire → state=done', async () => {
    const subDir = join(testDir, 'fp-stderr-empty');
    // opencode-named binary, exit 0, no stderr — pure happy path
    const program = makeOpencodeWrapper(subDir, '');
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('done');
  });

  it('false-positive guard (c): stderr non-empty but no line starts with Error: → state=done', async () => {
    const subDir = join(testDir, 'fp-no-error-prefix');
    const program = makeOpencodeWrapper(subDir, 'printf "informational log line\\n" >&2');
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('done');
  });

  it('false-positive guard (d): program !== opencode, stderr has Error: → sentinel does not fire → state=done', async () => {
    const subDir = join(testDir, 'fp-not-opencode');
    // Use /bin/sh (not opencode) — sentinel must not fire even with Error: in stderr
    const result = await runWithRetry(makeOpts(subDir, {
      program: '/bin/sh',
      args: ['-c', 'printf "Error: Model not found\\n" >&2; exit 0'],
      command: '/bin/sh -c ...',
    }));
    expect(result.state).toBe('done');
  });
});

describe('opencode sentinel: keyword classification (AC-1.5)', () => {
  const testDir = join(tmpdir(), 'sentinel-classify-' + Date.now());

  beforeAll(() => { mkdirSync(testDir, { recursive: true }); });
  afterAll(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('Model not found in stderr → state=non_retryable, error.type=model_not_found', async () => {
    const subDir = join(testDir, 'kw-model-not-found');
    const program = makeOpencodeWrapper(subDir, "printf 'Error: Model not found: gpt-5\\n' >&2");
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.type).toBe('model_not_found');
  });

  it('ContextOverflowError in stderr → error.type=context_window', async () => {
    const subDir = join(testDir, 'kw-context-overflow');
    const program = makeOpencodeWrapper(subDir, "printf 'Error: ContextOverflowError: context too large\\n' >&2");
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.type).toBe('context_window');
  });

  it('APIError in stderr → error.type=api_error', async () => {
    const subDir = join(testDir, 'kw-api-error');
    const program = makeOpencodeWrapper(subDir, "printf 'Error: APIError: 500 internal\\n' >&2");
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.type).toBe('api_error');
  });

  it('Unknown session error → error.type=opencode_session_error (fallback)', async () => {
    const subDir = join(testDir, 'kw-fallback');
    const program = makeOpencodeWrapper(subDir, "printf 'Error: SomethingUnknown happened\\n' >&2");
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.type).toBe('opencode_session_error');
  });

  it('sentinel writes error.message = first stderr line with Error: prefix stripped', async () => {
    const subDir = join(testDir, 'kw-message-strip');
    const program = makeOpencodeWrapper(subDir, "printf 'Error: Model not found: my-model\\nSecond line\\n' >&2");
    const result = await runWithRetry(makeOpts(subDir, { program, args: [], command: program }));
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.message).toBe('Model not found: my-model');
  });
});

// ---------------------------------------------------------------------------
// PROMPT_MAX_BYTES guard at mode='text' path (AC-4)
// ---------------------------------------------------------------------------

describe('mode=text prompt size guard', () => {
  const testDir = join(tmpdir(), 'prompt-size-text-' + Date.now());

  beforeAll(() => { mkdirSync(testDir, { recursive: true }); });
  afterAll(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('prompt 79KB → spawn proceeds normally (exit 0 → state=done)', async () => {
    const subDir = join(testDir, 'prompt-79kb');
    const memberDir = join(subDir, 'member');
    mkdirSync(memberDir, { recursive: true });
    const promptPath = join(subDir, 'prompt.txt');
    writeFileSync(promptPath, 'x'.repeat(79 * 1024));
    const result = await runWithRetry({
      program: '/bin/sh',
      args: ['-c', 'exit 0'],
      prompt: 'test',
      promptPath,
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "exit 0"',
      timeoutSec: 10,
      sleepFn: noopSleep,
    });
    expect(result.state).toBe('done');
  });

  it('prompt 81KB → no spawn, state=non_retryable, error.type=prompt_too_large', async () => {
    const subDir = join(testDir, 'prompt-81kb');
    const memberDir = join(subDir, 'member');
    mkdirSync(memberDir, { recursive: true });
    const promptPath = join(subDir, 'prompt.txt');
    writeFileSync(promptPath, 'x'.repeat(81 * 1024));
    const result = await runWithRetry({
      program: '/bin/sh',
      args: ['-c', 'exit 0'],
      prompt: 'test',
      promptPath,
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "exit 0"',
      timeoutSec: 10,
      sleepFn: noopSleep,
    });
    expect(result.state).toBe('non_retryable');
    expect((result.error as any)?.type).toBe('prompt_too_large');
    expect((result.error as any)?.bytes).toBeGreaterThan(80 * 1024);
    expect((result.error as any)?.limit).toBe(PROMPT_MAX_BYTES);
  });
});


// ---------------------------------------------------------------------------
// runOneTurn / resumeOneTurn — caller-judgment single-turn pump (TODO 1)
// ---------------------------------------------------------------------------

/**
 * Make a mock runOnce for runOneTurn tests.
 * Writes memberDir/output.txt with rawStdout, returns {state, exitCode}.
 * The mock is injected via the runOnceFn override on RunOneTurnOpts.
 */
function makeOneTurnMockRunOnce(rawStdout: string, exitCode: number = 0) {
  const fn = async (opts: RunOnceOpts): Promise<Record<string, unknown>> => {
    writeFileSync(join(opts.memberDir, 'output.txt'), rawStdout);
    writeFileSync(join(opts.memberDir, 'error.txt'), '');
    const state = exitCode === 0 ? 'done' : 'error';
    return { state, exitCode, member: opts.member, command: opts.command, attempt: 0 };
  };
  return fn;
}

/**
 * Make an AgentDriver mock suitable for runOneTurn tests.
 * parseStdout returns the provided ParseResult (or null).
 * resumeCommand is tracked via a spy.calls array.
 */
function makeOneTurnMockDriver(parseResult: import('./agent-drivers/types.ts').ParseResult | null): AgentDriver & {
  spy: { calls: import('./agent-drivers/types.ts').ResumeCommandOpts[][] };
} {
  const spy = { calls: [] as import('./agent-drivers/types.ts').ResumeCommandOpts[][] };
  return {
    cli: 'opencode',
    parseStdout: (_stdout: string) => parseResult,
    initialCommand: (opts) => ({ program: opts.baseCommand, args: opts.baseArgs, env: opts.workerEnv }),
    resumeCommand: (opts) => {
      spy.calls.push([opts]);
      return { program: opts.baseCommand, args: [...opts.baseArgs, '--resume', opts.sessionID], env: opts.workerEnv };
    },
    spy,
  };
}

/** Base opts for runOneTurn tests. */
function makeOneTurnOpts(memberDir: string, overrides: Partial<RunOneTurnOpts> = {}): RunOneTurnOpts {
  return {
    program: 'opencode',
    args: ['--format', 'json'],
    prompt: 'test prompt',
    member: 'test-member',
    memberDir,
    command: 'opencode --format json',
    timeoutSec: 10,
    cliType: 'opencode' as CliType,
    workerEnv: {},
    ...overrides,
  };
}

import type { ResumeCommandOpts } from './agent-drivers/types.ts';

describe('runOneTurn / resumeOneTurn — caller-judgment single-turn pump', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'one-turn-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC-A1: state='done' on exit 0
  test('runOneTurn state done', async () => {
    const memberDir = join(tmpDir, 'a1');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a1', terminal: 'stop', text: 'parsed body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw stdout', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.state).toBe('done');
  });

  // AC-A2: state='error' on exit non-zero (driver did not report error terminal)
  test('runOneTurn state error', async () => {
    const memberDir = join(tmpDir, 'a2');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a2', terminal: 'unknown_pause', text: '', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 1);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.state).toBe('error');
  });

  // P1-5: driver-reported terminal='error' elevates state to non_retryable regardless of exitCode
  test('runOneTurn state non_retryable when driver terminal=error', async () => {
    const memberDir = join(tmpDir, 'a2b');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a2b', terminal: 'error', text: '', rawEvents: [],
    });
    // exitCode 0 — driver detected error in stdout (opencode exit-0 pattern)
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.state).toBe('non_retryable');
  });

  // AC-A3: sessionID extracted from driver.parseStdout
  test('runOneTurn sessionID', async () => {
    const memberDir = join(tmpDir, 'a3');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_xyz', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.sessionID).toBe('ses_xyz');
  });

  // AC-A4: forwards parsed text
  test('runOneTurn text', async () => {
    const memberDir = join(tmpDir, 'a4');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a4', terminal: 'stop', text: 'parsed body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw stdout', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.text).toBe('parsed body');
  });

  // AC-A5: forwards CLI exitCode
  test('runOneTurn exitCode', async () => {
    const memberDir = join(tmpDir, 'a5');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a5', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.exitCode).toBe(0);
  });

  // AC-A6a+A6b: output.txt overwrite (not append), no _turn-N/ subdir
  test('runOneTurn output overwrite no _turn-N subdir', async () => {
    const memberDir = join(tmpDir, 'a6');
    mkdirSync(memberDir, { recursive: true });

    // Pre-populate output.txt with 'OLD'
    writeFileSync(join(memberDir, 'output.txt'), 'OLD');

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_a6', terminal: 'stop', text: 'NEW', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    // AC-A6a: output.txt contains exactly 'NEW'
    const content = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(content).toBe('NEW');

    // AC-A6b: no _turn-0 or _turn-1 subdirs created
    expect(existsSync(join(memberDir, '_turn-0'))).toBe(false);
    expect(existsSync(join(memberDir, '_turn-1'))).toBe(false);
  });

  // AC-B1: driver.resumeCommand called with sessionID
  test('resumeOneTurn spy', async () => {
    const memberDir = join(tmpDir, 'b1');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_resume', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    await resumeOneTurn('ses_target', makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(mockDriver.spy.calls.length).toBeGreaterThan(0);
    expect(mockDriver.spy.calls[0][0].sessionID).toBe('ses_target');
  });

  // AC-B2: resumeOneTurn returns non-empty sessionID
  test('resumeOneTurn sessionID non-empty', async () => {
    const memberDir = join(tmpDir, 'b2');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_b2_result', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    const result = await resumeOneTurn('ses_input', makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.sessionID).toBeTruthy();
  });

  // AC-C1: status.json contains sessionID
  test('runOneTurn sessionID atomicWriteJson', async () => {
    const memberDir = join(tmpDir, 'c1');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_xyz', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8'));
    expect(status.sessionID).toBe('ses_xyz');
  });

  // AC-C2: initial resume_count === 0
  test('runOneTurn resume_count zero init', async () => {
    const memberDir = join(tmpDir, 'c2');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_c2', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8'));
    expect(status.resume_count).toBe(0);
  });

  // AC-C6: atomicWriteJson uses pid+crypto tmpfile+rename (not partial write)
  test('atomicWriteJson tmpfile rename atomicity', async () => {
    const memberDir = join(tmpDir, 'c6');
    mkdirSync(memberDir, { recursive: true });

    // Verify atomicWriteJson uses a crypto-suffixed tmpfile that is renamed.
    // We spy by checking that no .tmp files remain after the call.
    const statusPath = join(memberDir, 'status.json');
    atomicWriteJson(statusPath, { state: 'done', sessionID: 'ses_c6' });

    // No tmp files remain — atomicity via rename
    const files = readdirSync(memberDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles).toHaveLength(0);

    // The written file parses as valid JSON with the expected content
    const parsed = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(parsed.state).toBe('done');
    expect(parsed.sessionID).toBe('ses_c6');
  });

  // AC-C7: legacy status.json (no resume_count field) auto-initializes to 0
  test('runOneTurn legacy status.json resume_count auto-init', async () => {
    const memberDir = join(tmpDir, 'c7');
    mkdirSync(memberDir, { recursive: true });

    // Pre-populate legacy status.json with no resume_count field
    writeFileSync(join(memberDir, 'status.json'), JSON.stringify({
      member: 'x', state: 'done', command: 'opencode run ...',
    }));

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_c7', terminal: 'stop', text: 'body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw', 0);

    // Must not throw despite missing resume_count
    await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8'));
    expect(status.resume_count).toBe(0);
  });

  // QA Scenario: happy path end-to-end
  test('runOneTurn end-to-end opencode', async () => {
    const memberDir = join(tmpDir, 'qa-happy');
    mkdirSync(memberDir, { recursive: true });

    const mockDriver = makeOneTurnMockDriver({
      sessionID: 'ses_xyz', terminal: 'stop', text: 'parsed body', rawEvents: [],
    });
    const mockRunOnce = makeOneTurnMockRunOnce('raw ndjson stdout', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    expect(result.state).toBe('done');
    expect(result.sessionID).toBe('ses_xyz');
    expect(result.text).toBe('parsed body');
    expect(result.exitCode).toBe(0);

    // output.txt overwritten with parsed text
    const outputContent = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(outputContent).toBe('parsed body');

    // No _turn-0 subdir
    expect(existsSync(join(memberDir, '_turn-0'))).toBe(false);
  });

  // QA Scenario: parse failure → state='error', output.txt = raw stdout
  test('runOneTurn parse failure', async () => {
    const memberDir = join(tmpDir, 'qa-parse-fail');
    mkdirSync(memberDir, { recursive: true });

    // Driver parseStdout returns null = parse failure
    const mockDriver = makeOneTurnMockDriver(null);
    const mockRunOnce = makeOneTurnMockRunOnce('raw unparseable stdout', 0);

    const result = await runOneTurn(makeOneTurnOpts(memberDir, {
      driverFactory: () => mockDriver,
      runOnceFn: mockRunOnce,
    }));

    // Parse failure → state='error'
    expect(result.state).toBe('error');

    // output.txt = raw stdout (no transformation)
    const outputContent = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(outputContent).toBe('raw unparseable stdout');

    // No _turn-N subdir
    expect(existsSync(join(memberDir, '_turn-0'))).toBe(false);
  });
});

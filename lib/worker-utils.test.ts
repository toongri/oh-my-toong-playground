import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt,
  MAX_RETRIES,
  BASE_DELAY_MS,
  NON_RETRYABLE_EXIT_CODES,
  HEARTBEAT_INTERVAL_MS,
  PROMPT_MAX_BYTES,
  runOnce,
  runWithRetry,
  classifyError,
  parseNdjsonOutput,
  classifyState,
  type RunOnceOpts,
  type RunWithRetryOpts,
  type NDJSONResult,
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
  test('MAX_RETRIES is 2', () => {
    expect(MAX_RETRIES).toBe(2);
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

// ---------------------------------------------------------------------------
// NDJSON parser
// ---------------------------------------------------------------------------

describe('NDJSON parser', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ndjson-parser-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const fp = join(tmpDir, name);
    writeFileSync(fp, content, 'utf8');
    return fp;
  }

  test('parses text events into textParts', () => {
    const fp = write('text.ndjson', '{"type":"text","text":"hello"}\n{"type":"text","text":" world"}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.textParts).toEqual(['hello', ' world']);
    expect(result.errorEvents).toEqual([]);
    expect(result.finishReason).toBeUndefined();
    expect(result.parseError).toBe(false);
  });

  test('parses step_finish reason into finishReason', () => {
    const fp = write('step_finish.ndjson', '{"type":"text","text":"hi"}\n{"type":"step_finish","reason":"stop"}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.finishReason).toBe('stop');
    expect(result.textParts).toEqual(['hi']);
  });

  test('parses error events into errorEvents array', () => {
    const fp = write('error.ndjson', '{"type":"error","error":{"type":"rate_limit","message":"Too many requests"}}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.errorEvents).toHaveLength(1);
    expect(result.errorEvents[0].error.type).toBe('rate_limit');
    expect(result.finishReason).toBeUndefined();
  });

  test('sets parseError=true on malformed JSON line but continues parsing', () => {
    const fp = write('malformed.ndjson', '{"type":"text","text":"ok"}\nNOT_JSON\n{"type":"step_finish","reason":"stop"}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.parseError).toBe(true);
    expect(result.textParts).toEqual(['ok']);
    expect(result.finishReason).toBe('stop');
  });

  test('returns empty result for nonexistent file (never throws)', () => {
    const result = parseNdjsonOutput(join(tmpDir, 'does-not-exist.ndjson'));
    expect(result.textParts).toEqual([]);
    expect(result.errorEvents).toEqual([]);
    expect(result.finishReason).toBeUndefined();
    expect(result.parseError).toBe(false);
  });

  test('skips blank lines and comment-style lines', () => {
    const fp = write('comments.ndjson', '\n// comment line\n{"type":"text","text":"data"}\n\n');
    const result = parseNdjsonOutput(fp);
    expect(result.textParts).toEqual(['data']);
    expect(result.parseError).toBe(false);
  });

  test('parser: text via event.part.text', () => {
    // Production schema: text is null, part.text carries the content
    const fp = write('part-text.ndjson', '{"type":"text","part":{"text":"hello from part"},"text":null}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.textParts).toEqual(['hello from part']);
  });

  test('parser: finishReason via event.part.reason', () => {
    // Production schema: reason is null, part.reason carries the value
    const fp = write('part-reason.ndjson', '{"type":"step_finish","part":{"reason":"stop"},"reason":null}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.finishReason).toBe('stop');
  });

  test('parser: non-string part.text → skipped, no throw', () => {
    // part.text is an array — should skip gracefully without throwing
    const fp = write('part-text-array.ndjson', '{"type":"text","part":{"text":["chunk1","chunk2"]},"text":null}\n');
    expect(() => {
      const result = parseNdjsonOutput(fp);
      expect(result.textParts).toEqual([]);
    }).not.toThrow();
  });

  test('parser: empty text part → not pushed', () => {
    // Empty string should not be pushed into textParts
    const fp = write('part-text-empty.ndjson', '{"type":"text","part":{"text":""},"text":null}\n');
    const result = parseNdjsonOutput(fp);
    expect(result.textParts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// classifyState
// ---------------------------------------------------------------------------

describe('classifyState', () => {
  test('classifyState: stop reason → done', () => {
    const parsed: NDJSONResult = { textParts: ['hello'], finishReason: 'stop', errorEvents: [] };
    expect(classifyState(parsed).state).toBe('done');
  });

  test('classifyState: tool_use reason → empty_output', () => {
    const parsed: NDJSONResult = { textParts: ['hi'], finishReason: 'tool_use', errorEvents: [] };
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('classifyState: no step_finish (undefined finishReason) → empty_output', () => {
    const parsed: NDJSONResult = { textParts: ['hi'], finishReason: undefined, errorEvents: [] };
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('classifyState: parseError=true → empty_output', () => {
    const parsed: NDJSONResult = { textParts: [], finishReason: undefined, errorEvents: [], parseError: true };
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('classifyState: error event + no step_finish → transient_error for rate_limit', () => {
    const parsed: NDJSONResult = {
      textParts: [],
      finishReason: undefined,
      errorEvents: [{ type: 'error', error: { type: 'rate_limit', message: 'Too many requests' } }],
    };
    const result = classifyState(parsed);
    expect(result.state).toBe('transient_error');
    expect(result.error?.type).toBe('rate_limit');
  });

  test('classifyState: error event + step_finish=stop → done (step_finish wins race)', () => {
    const parsed: NDJSONResult = {
      textParts: ['partial'],
      finishReason: 'stop',
      errorEvents: [{ type: 'error', error: { type: 'network', message: 'econnreset' } }],
    };
    expect(classifyState(parsed).state).toBe('done');
  });

  test('classifyState: auth error → permanent_error', () => {
    const parsed: NDJSONResult = {
      textParts: [],
      finishReason: undefined,
      errorEvents: [{ type: 'error', error: { type: 'auth', message: 'Unauthorized' } }],
    };
    const result = classifyState(parsed);
    expect(result.state).toBe('permanent_error');
    expect(result.error?.type).toBe('auth');
  });

  test('classifyState: errorEvents+parseError+finishReason stop → done', () => {
    const parsed: NDJSONResult = {
      textParts: [],
      finishReason: 'stop',
      errorEvents: [{ type: 'error', error: { type: 'network', message: 'econnreset' } }],
      parseError: true,
    };
    expect(classifyState(parsed).state).toBe('done');
  });

  test('classifyState: errorEvents+finishReason stop → done', () => {
    const parsed: NDJSONResult = {
      textParts: [],
      finishReason: 'stop',
      errorEvents: [{ type: 'error', error: { type: 'rate_limit', message: 'Too many requests' } }],
    };
    expect(classifyState(parsed).state).toBe('done');
  });

  test('classifyState: errorEvents+finishReason tool_use → classifyError result', () => {
    const parsed: NDJSONResult = {
      textParts: [],
      finishReason: 'tool_use',
      errorEvents: [{ type: 'error', error: { type: 'rate_limit', message: 'Too many requests' } }],
    };
    const result = classifyState(parsed);
    expect(result.state).toBe('transient_error');
    expect(result.error?.type).toBe('rate_limit');
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  test('classifyError priority 1: auth permanent', () => {
    const r = classifyError({ message: 'invalid api key provided' });
    expect(r.type).toBe('auth');
    expect(r.category).toBe('permanent');
  });

  test('classifyError priority 2: model_not_found permanent', () => {
    const r = classifyError({ message: 'Model not found: openai/gpt-99' });
    expect(r.type).toBe('model_not_found');
    expect(r.category).toBe('permanent');
  });

  test('classifyError priority 3: context_window permanent', () => {
    const r = classifyError({ message: 'context window exceeded for this request' });
    expect(r.type).toBe('context_window');
    expect(r.category).toBe('permanent');
  });

  test('classifyError priority 4: quota_exceeded permanent', () => {
    const r = classifyError({ message: 'quota limit reached for this billing period' });
    expect(r.type).toBe('quota_exceeded');
    expect(r.category).toBe('permanent');
  });

  test('classifyError priority 5: rate_limit transient', () => {
    const r = classifyError({ message: 'rate limit exceeded, please retry' });
    expect(r.type).toBe('rate_limit');
    expect(r.category).toBe('transient');
  });

  test('classifyError priority 6: timeout transient', () => {
    const r = classifyError({ message: 'request timed out after 30s' });
    expect(r.type).toBe('timeout');
    expect(r.category).toBe('transient');
  });

  test('classifyError priority 7: server_error transient', () => {
    const r = classifyError({ message: 'internal server error 500' });
    expect(r.type).toBe('server_error');
    expect(r.category).toBe('transient');
  });

  test('classifyError priority 8: network transient', () => {
    const r = classifyError({ message: 'ECONNRESET: connection reset by peer' });
    expect(r.type).toBe('network');
    expect(r.category).toBe('transient');
  });

  test('classifyError priority 9: unknown transient (no pattern match)', () => {
    const r = classifyError({ message: 'something completely unexpected happened' });
    expect(r.type).toBe('unknown');
    expect(r.category).toBe('transient');
  });

  test('classifyError: explicit type bypasses message matching', () => {
    const r = classifyError({ type: 'auth', message: 'some rate limit message' });
    expect(r.type).toBe('auth');
    expect(r.category).toBe('permanent');
  });

  test('classifyError: kimi APIError responseBody → context_window permanent', () => {
    // Kimi-S5 spike박제: responseBody는 escaped JSON string, token-limit 키워드 포함
    const responseBody = JSON.stringify({
      error: {
        message: 'Error from provider: Provider returned error',
        code: 400,
        metadata: {
          raw: JSON.stringify({
            error: {
              message: 'Invalid request: Your request exceeded model token limit: 262144 (requested: 370653)',
              type: 'invalid_request_error',
            },
          }),
        },
      },
    });
    const r = classifyError({ message: 'Error from provider: Provider returned error', responseBody });
    expect(r.type).toBe('context_window');
    expect(r.category).toBe('permanent');
  });

  test('classifyError: APIError without responseBody → unknown transient', () => {
    const r = classifyError({ message: 'Error from provider: Provider returned error' });
    expect(r.type).toBe('unknown');
    expect(r.category).toBe('transient');
  });

  test('classifyError: APIError malformed responseBody → unknown transient', () => {
    const r = classifyError({ message: 'Error from provider: Provider returned error', responseBody: 'NOT_VALID_JSON' });
    expect(r.type).toBe('unknown');
    expect(r.category).toBe('transient');
  });

  test('classifyError: APIError unrelated responseBody → unknown transient', () => {
    const responseBody = JSON.stringify({ error: { message: 'some other error', code: 400 } });
    const r = classifyError({ message: 'Error from provider: Provider returned error', responseBody });
    expect(r.type).toBe('unknown');
    expect(r.category).toBe('transient');
  });
});

// ---------------------------------------------------------------------------
// retry transition (mode='json', mock spawn via spawnFn)
// ---------------------------------------------------------------------------

describe('retry transition', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'retry-transition-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Creates a spawnFn that writes NDJSON to output.txt on each call,
   * cycling through the provided outputs array.
   */
  function makeNdjsonSpawnFn(memberDir: string, outputs: string[]) {
    let callCount = 0;
    const mockSpawn = (_program: string, _args: string[], _options: any) => {
      const outputNdjson = outputs[callCount] ?? outputs[outputs.length - 1];
      callCount++;
      const child = new (require('events').EventEmitter)();
      const stdin = { write: () => true, end: () => {}, on: () => stdin } as any;
      (child as any).stdin = stdin;
      (child as any).stderr = null;
      (child as any).pid = 12345 + callCount;
      // Pipe NDJSON through stdout so runOnce's WriteStream receives data before truncation race
      const stdout = new Readable({ read() {} });
      (child as any).stdout = stdout;
      process.nextTick(() => {
        stdout.push(outputNdjson);
        stdout.push(null); // EOF
        child.emit('exit', 0, null);
        process.nextTick(() => child.emit('close', 0, null));
      });
      return child as any;
    };
    return { mockSpawn, getCallCount: () => callCount };
  }

  const EMPTY_NDJSON = '{"type":"text","text":"partial output"}\n';
  const DONE_NDJSON = '{"type":"text","text":"full review"}\n{"type":"step_finish","reason":"stop"}\n';
  const PERM_ERR_NDJSON = '{"type":"error","error":{"type":"auth","message":"unauthorized"}}\n';
  const TRANS_ERR_NDJSON = '{"type":"error","error":{"type":"rate_limit","message":"429"}}\n';

  function makeRetryOpts(memberDir: string, spawnFn: any): RunWithRetryOpts {
    return {
      program: 'mock',
      args: [],
      prompt: 'test',
      member: 'test-member',
      memberDir,
      command: 'mock',
      timeoutSec: 5,
      mode: 'json',
      sleepFn: noopSleep,
      jitter: () => 0,
      spawnFn,
    };
  }

  test('retry transition: empty → done (call_count=2)', async () => {
    const memberDir = join(tmpDir, 'empty-done');
    mkdirSync(memberDir, { recursive: true });
    const { mockSpawn, getCallCount } = makeNdjsonSpawnFn(memberDir, [EMPTY_NDJSON, DONE_NDJSON]);
    const result = await runWithRetry(makeRetryOpts(memberDir, mockSpawn));
    expect(result.state).toBe('done');
    expect(result.attempts).toBe(2);
    expect(getCallCount()).toBe(2);
  });

  test('retry transition: empty → empty → done (call_count=3)', async () => {
    const memberDir = join(tmpDir, 'empty-empty-done');
    mkdirSync(memberDir, { recursive: true });
    const { mockSpawn, getCallCount } = makeNdjsonSpawnFn(memberDir, [EMPTY_NDJSON, EMPTY_NDJSON, DONE_NDJSON]);
    const result = await runWithRetry(makeRetryOpts(memberDir, mockSpawn));
    expect(result.state).toBe('done');
    expect(result.attempts).toBe(3);
    expect(getCallCount()).toBe(3);
  });

  test('retry transition: empty → empty → empty → exhausted (call_count=3)', async () => {
    const memberDir = join(tmpDir, 'exhausted');
    mkdirSync(memberDir, { recursive: true });
    const { mockSpawn, getCallCount } = makeNdjsonSpawnFn(memberDir, [EMPTY_NDJSON, EMPTY_NDJSON, EMPTY_NDJSON]);
    const result = await runWithRetry(makeRetryOpts(memberDir, mockSpawn));
    expect(result.state).toBe('empty_output');
    expect(result.attempts).toBe(3);
    expect(getCallCount()).toBe(3);
  });

  test('retry transition: transient → permanent → no further retry (call_count=2)', async () => {
    const memberDir = join(tmpDir, 'transient-permanent');
    mkdirSync(memberDir, { recursive: true });
    const { mockSpawn, getCallCount } = makeNdjsonSpawnFn(memberDir, [TRANS_ERR_NDJSON, PERM_ERR_NDJSON]);
    const result = await runWithRetry(makeRetryOpts(memberDir, mockSpawn));
    expect(result.state).toBe('permanent_error');
    expect(result.attempts).toBe(2);
    expect(getCallCount()).toBe(2);
  });

  test('retry transition: permanent → no retry (call_count=1)', async () => {
    const memberDir = join(tmpDir, 'permanent-only');
    mkdirSync(memberDir, { recursive: true });
    const { mockSpawn, getCallCount } = makeNdjsonSpawnFn(memberDir, [PERM_ERR_NDJSON]);
    const result = await runWithRetry(makeRetryOpts(memberDir, mockSpawn));
    expect(result.state).toBe('permanent_error');
    expect(result.attempts).toBe(1);
    expect(getCallCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// retry backoff
// ---------------------------------------------------------------------------

describe('retry backoff', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'retry-backoff-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('retry backoff with jitter mock', async () => {
    const memberDir = join(tmpDir, 'backoff');
    mkdirSync(memberDir, { recursive: true });
    const outputPath = join(memberDir, 'output.txt');

    // 3 empty outputs → exhaust retries
    let callCount = 0;
    const mockSpawn = (_program: string, _args: string[], _options: any) => {
      callCount++;
      const child = new (require('events').EventEmitter)();
      const stdin = { write: () => true, end: () => {}, on: () => stdin } as any;
      (child as any).stdin = stdin;
      (child as any).stdout = null;
      (child as any).stderr = null;
      (child as any).pid = 20000 + callCount;
      process.nextTick(() => {
        writeFileSync(outputPath, '{"type":"text","text":"partial"}\n', 'utf8');
        child.emit('exit', 0, null);
        process.nextTick(() => child.emit('close', 0, null));
      });
      return child as any;
    };

    const delays: number[] = [];
    const sleepFn = async (ms: number) => { delays.push(ms); };
    const FIXED_JITTER = 50;

    await runWithRetry({
      program: 'mock',
      args: [],
      prompt: 'test',
      member: 'test-member',
      memberDir,
      command: 'mock',
      timeoutSec: 5,
      mode: 'json',
      sleepFn,
      jitter: () => FIXED_JITTER,
      spawnFn: mockSpawn,
    });

    // MAX_RETRIES=2 → 3 attempts → 2 backoff sleeps
    expect(delays).toHaveLength(2);
    // attempt 1: 1000 * 2^0 + 50 = 1050
    expect(delays[0]).toBe(1000 + FIXED_JITTER);
    // attempt 2: 1000 * 2^1 + 50 = 2050
    expect(delays[1]).toBe(2000 + FIXED_JITTER);
  });
});

// ---------------------------------------------------------------------------
// prompt size guard
// ---------------------------------------------------------------------------

describe('prompt size guard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prompt-guard-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeGuardOpts(memberDir: string, promptPath: string): RunWithRetryOpts {
    return {
      program: '/bin/sh',
      args: ['-c', 'exit 0'],
      prompt: '',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "exit 0"',
      timeoutSec: 5,
      mode: 'json',
      sleepFn: noopSleep,
      promptPath,
    };
  }

  test('prompt size guard: exactly at PROMPT_MAX_BYTES passes through', async () => {
    const memberDir = join(tmpDir, 'at-limit');
    mkdirSync(memberDir, { recursive: true });
    const promptPath = join(tmpDir, 'prompt-at.txt');
    writeFileSync(promptPath, Buffer.alloc(PROMPT_MAX_BYTES, 'x'));

    const result = await runWithRetry(makeGuardOpts(memberDir, promptPath));
    // Should proceed to spawn (not rejected by guard)
    // state won't be permanent_error with type=prompt_too_large
    expect(result.state).not.toBe('permanent_error');
  });

  test('prompt size guard: 1 byte over PROMPT_MAX_BYTES → permanent_error prompt_too_large', async () => {
    const memberDir = join(tmpDir, 'over-limit');
    mkdirSync(memberDir, { recursive: true });
    const promptPath = join(tmpDir, 'prompt-over.txt');
    writeFileSync(promptPath, Buffer.alloc(PROMPT_MAX_BYTES + 1, 'x'));

    const result = await runWithRetry(makeGuardOpts(memberDir, promptPath));
    expect(result.state).toBe('permanent_error');
    expect((result as any).error?.type).toBe('prompt_too_large');
    expect((result as any).error?.bytes).toBe(PROMPT_MAX_BYTES + 1);
    expect((result as any).error?.limit).toBe(PROMPT_MAX_BYTES);
  });

  test('prompt size guard: attempts=0 on prompt_too_large (no spawn)', async () => {
    const memberDir = join(tmpDir, 'no-spawn');
    mkdirSync(memberDir, { recursive: true });
    const promptPath = join(tmpDir, 'prompt-big.txt');
    writeFileSync(promptPath, Buffer.alloc(PROMPT_MAX_BYTES + 1000, 'y'));

    const result = await runWithRetry(makeGuardOpts(memberDir, promptPath));
    expect(result.attempts).toBe(0);
  });

  test('prompt size guard: no promptPath → guard skipped (no error)', async () => {
    const memberDir = join(tmpDir, 'no-path');
    mkdirSync(memberDir, { recursive: true });

    const result = await runWithRetry({
      program: '/bin/sh',
      args: ['-c', 'exit 0'],
      prompt: '',
      member: 'test-member',
      memberDir,
      command: '/bin/sh -c "exit 0"',
      timeoutSec: 5,
      mode: 'json',
      sleepFn: noopSleep,
      // no promptPath
    });
    // Guard not triggered — spawn should run
    expect(result.state).not.toBe('permanent_error');
  });
});

// ---------------------------------------------------------------------------
// incident-f99e10 regression
// ---------------------------------------------------------------------------

describe('incident-f99e10 regression', () => {
  const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__');

  test('incident-f99e10 regression: no step_finish → empty_output', () => {
    const fp = join(FIXTURE_DIR, 'incident-f99e10-no-step-finish.ndjson');
    const parsed = parseNdjsonOutput(fp);
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('incident-f99e10 regression: tool_use reason → empty_output', () => {
    const fp = join(FIXTURE_DIR, 'incident-f99e10-tool-use-reason.ndjson');
    const parsed = parseNdjsonOutput(fp);
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('incident-f99e10 regression: production schema no-step-finish → empty_output', () => {
    const fp = join(FIXTURE_DIR, 'incident-f99e10-no-step-finish.ndjson');
    const parsed = parseNdjsonOutput(fp);
    expect(classifyState(parsed).state).toBe('empty_output');
  });

  test('incident-f99e10 regression: production schema tool_use → empty_output', () => {
    const fp = join(FIXTURE_DIR, 'incident-f99e10-tool-use-reason.ndjson');
    const parsed = parseNdjsonOutput(fp);
    expect(classifyState(parsed).state).toBe('empty_output');
  });
});

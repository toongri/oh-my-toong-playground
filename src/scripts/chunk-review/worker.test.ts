#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  runOnce,
  runWithRetry,
  sleepMs,
  BASE_DELAY_MS,
} from './worker.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-worker-test-'));
}

function setupJobDir(tmpDir) {
  const member = 'test-reviewer';
  const jobDir = path.join(tmpDir, 'job');
  const memberDir = path.join(jobDir, 'reviewers', member);
  fs.mkdirSync(memberDir, { recursive: true });
  const statusPath = path.join(memberDir, 'status.json');
  const outPath = path.join(memberDir, 'output.txt');
  const errPath = path.join(memberDir, 'error.txt');
  return { jobDir, member, memberDir, statusPath, outPath, errPath };
}

function readStatus(statusPath) {
  return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
}

/**
 * Poll a file until it contains the expected substring.
 * Handles the stream-flush race where output.txt may not be fully written
 * when runOnce resolves (large prompts piped through cat).
 */
async function waitForFileContent(filePath, substring, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(substring)) return content;
    } catch { /* file not ready yet */ }
    await sleepMs(10);
  }
  // Final attempt — return whatever is there for assertion error message
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// runOnce() — stdin pipe tests
// ---------------------------------------------------------------------------

describe('runOnce - stdin pipe', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes prompt to child stdin instead of passing as CLI argument', async () => {
    const result = await runOnce({
      program: 'cat',
      args: [],
      prompt: 'hello from stdin',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'cat',
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    const output = await waitForFileContent(paths.outPath, 'hello from stdin');
    expect(output.includes('hello from stdin')).toBe(true);
  });

  test('handles stdin pipe errors gracefully', async () => {
    const result = await runOnce({
      program: 'echo',
      args: ['fixed-output'],
      prompt: 'THIS_SHOULD_NOT_APPEAR',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'echo fixed-output',
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(!output.includes('THIS_SHOULD_NOT_APPEAR')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOnce() — exit states
// ---------------------------------------------------------------------------

describe('runOnce - exit states', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns done state on exit code 0', async () => {
    const result = await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('done');
    expect(result.exitCode).toBe(0);
  });

  test('returns error state on non-zero exit code', async () => {
    const result = await runOnce({
      program: 'false',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'false',
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('error');
    expect(result.exitCode).toBe(1);
  });

  test('returns missing_cli state on ENOENT error', async () => {
    const result = await runOnce({
      program: 'nonexistent-command-xyz-abc-123',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'nonexistent-command-xyz-abc-123',
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('missing_cli');
  });

  test('returns timed_out state when timeout triggers', async () => {
    const result = await runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sleep 60',
      timeoutSec: 0.2,
      attempt: 0,
    });
    expect(result.state).toBe('timed_out');
  });

  test('returns canceled state on SIGTERM without timeout', async () => {
    const resultPromise = runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sleep 60',
      timeoutSec: 0,
      attempt: 0,
    });

    // Poll status.json for pid
    let pid = null;
    for (let i = 0; i < 100; i++) {
      await sleepMs(50);
      try {
        const status = readStatus(paths.statusPath);
        if (status.pid) {
          pid = status.pid;
          break;
        }
      } catch { /* status.json not written yet */ }
    }
    expect(pid).toBeTruthy();
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }

    const result = await resultPromise;
    expect(result.state).toBe('canceled');
  });

  test('includes attempt field in status.json', async () => {
    await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 2,
    });
    const status = readStatus(paths.statusPath);
    expect(status.attempt).toBe(2);
  });

  test('writes status.json to memberDir', async () => {
    await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 0,
    });
    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('done');
    expect(status.attempt).toBe(0);
    expect(status.member).toBe(paths.member);
  });

  test('writes output.txt and error.txt', async () => {
    await runOnce({
      program: 'sh',
      args: ['-c', 'echo stdout-data; echo stderr-data >&2'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c "echo stdout-data; echo stderr-data >&2"',
      timeoutSec: 5,
      attempt: 0,
    });

    const out = await waitForFileContent(paths.outPath, 'stdout-data');
    const err = await waitForFileContent(paths.errPath, 'stderr-data');
    expect(out.includes('stdout-data')).toBe(true);
    expect(err.includes('stderr-data')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runWithRetry() tests
// ---------------------------------------------------------------------------

describe('runWithRetry', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('succeeds without retry on first exit 0', async () => {
    const result = await runWithRetry({
      program: 'true',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'true',
      timeoutSec: 5,
    });

    expect(result.state).toBe('done');
    expect(result.attempt).toBe(0);
  });

  test('retries on error and succeeds on second attempt', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker');
    const result = await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    expect(result.state).toBe('done');
    expect(result.attempt).toBe(1);
  });

  test('exhausts all retries and returns final error', async () => {
    const result = await runWithRetry({
      program: 'false',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'false',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    expect(result.state).toBe('error');
    expect(result.attempt).toBe(1); // 0, 1 = 2 attempts
  });

  test('does NOT retry on missing_cli (ENOENT)', async () => {
    const result = await runWithRetry({
      program: 'nonexistent-command-xyz-abc-123',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'nonexistent-command-xyz-abc-123',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    expect(result.state).toBe('missing_cli');
    expect(result.attempt).toBe(0);
  });

  test('does NOT retry on timed_out', async () => {
    const result = await runWithRetry({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sleep 60',
      timeoutSec: 0.2,
      sleepFn: () => Promise.resolve(),
    });

    expect(result.state).toBe('timed_out');
    expect(result.attempt).toBe(0);
  });

  test('does NOT retry on canceled', async () => {
    const resultPromise = runWithRetry({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sleep 60',
      timeoutSec: 0,
      sleepFn: () => Promise.resolve(),
    });

    // Poll status.json for pid
    let pid = null;
    for (let i = 0; i < 100; i++) {
      await sleepMs(50);
      try {
        const status = readStatus(paths.statusPath);
        if (status.pid) {
          pid = status.pid;
          break;
        }
      } catch { /* status.json not written yet */ }
    }
    expect(pid).toBeTruthy();
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }

    const result = await resultPromise;
    expect(result.state).toBe('canceled');
    expect(result.attempt).toBe(0);
  });

  test('applies exponential backoff with jitter between retries', async () => {
    const delays = [];

    await runWithRetry({
      program: 'false',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'false',
      timeoutSec: 5,
      sleepFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    // Should have 1 delay (retry after attempt 0)
    expect(delays.length).toBe(1);

    // First delay: BASE_DELAY_MS * 2^0 + jitter(0~BASE_DELAY_MS) = 1000..2000
    expect(delays[0] >= BASE_DELAY_MS).toBe(true);
    expect(delays[0] < BASE_DELAY_MS * 3).toBe(true);
  });

  test('appends output with attempt marker on retry', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker2');
    const result = await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then echo attempt2 && exit 0; else touch "${markerFile}" && echo attempt1 && exit 1; fi`],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    const out = await waitForFileContent(paths.outPath, 'attempt2');
    expect(out.includes('attempt1')).toBe(true);
    expect(out.includes('--- attempt 1 ---')).toBe(true);
    expect(out.includes('attempt2')).toBe(true);
  });

  test('includes attempt field in final status.json', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker3');
    await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    const status = readStatus(paths.statusPath);
    expect(status.attempt).toBe(1);
    expect(status.state).toBe('done');
  });

  test('writes retrying status before backoff sleep', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker-retrying');
    let capturedStatus = null;

    const sleepFn = async () => {
      capturedStatus = readStatus(paths.statusPath);
    };

    await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn,
    });

    expect(capturedStatus).toBeTruthy();
    expect(capturedStatus.state).toBe('retrying');
    expect(capturedStatus.attempt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runOnce() — synchronous spawn throw
// ---------------------------------------------------------------------------

describe('runOnce - synchronous spawnFn throw', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error state when spawnFn throws synchronously', async () => {
    const throwingSpawn = () => { throw new Error('spawn failed'); };

    const result = await runOnce({
      program: 'anything',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'anything',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: throwingSpawn,
    });

    expect(result.state).toBe('error');
    expect(result.message.includes('spawn failed')).toBe(true);

    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('error');
    expect(status.message.includes('spawn failed')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// runOnce() — non-SIGTERM signal (SIGKILL)
// ---------------------------------------------------------------------------

describe('runOnce - non-SIGTERM signal (SIGKILL)', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error state (not canceled) when process killed with SIGKILL', async () => {
    const resultPromise = runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sleep 60',
      timeoutSec: 0,
      attempt: 0,
    });

    // Poll status.json for pid
    let pid = null;
    for (let i = 0; i < 100; i++) {
      await sleepMs(50);
      try {
        const status = readStatus(paths.statusPath);
        if (status.pid) {
          pid = status.pid;
          break;
        }
      } catch { /* status.json not written yet */ }
    }
    expect(pid).toBeTruthy();
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }

    const result = await resultPromise;
    expect(result.state).toBe('error');
    expect(result.exitCode).toBe(null);
    expect(result.signal).toBe('SIGKILL');
  });
});

// ---------------------------------------------------------------------------
// runOnce() — SIGKILL fallback after SIGTERM timeout
// ---------------------------------------------------------------------------

describe('runOnce - SIGKILL fallback after SIGTERM timeout', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sends SIGKILL when child ignores SIGTERM after timeout grace period', { timeout: 15000 }, async () => {
    // Spawn a node process that traps SIGTERM and ignores it
    const result = await runOnce({
      program: 'node',
      args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000)"],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'node -e "ignore SIGTERM"',
      timeoutSec: 0.2,
      attempt: 0,
    });

    // Child should still be marked as timed_out even though SIGKILL was the actual kill signal
    expect(result.state).toBe('timed_out');
    expect(result.message.includes('Timed out')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOnce - SIGTERM trap with graceful exit (timeout misclassification bug)
// ---------------------------------------------------------------------------

describe('runOnce - SIGTERM trap with graceful exit', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns timed_out when child traps SIGTERM and exits 0', { timeout: 15000 }, async () => {
    // Child traps SIGTERM, does cleanup, then exits with code 0.
    // This means signal=null in the exit handler, but timeoutTriggered=true.
    const result = await runOnce({
      program: 'node',
      args: ['-e', "process.on('SIGTERM', () => { process.exit(0); }); setTimeout(() => {}, 60000)"],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'node -e "trap SIGTERM exit 0"',
      timeoutSec: 0.2,
      attempt: 0,
    });

    // Must be timed_out, not done — timeoutTriggered is the authoritative signal
    expect(result.state).toBe('timed_out');
    expect(result.message.includes('Timed out')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOnce() — workerEnv injection
// ---------------------------------------------------------------------------

/**
 * Creates a mock spawnFn that captures spawn options and simulates
 * a successful child process (exit code 0).
 */
function createCapturingSpawnFn() {
  const captured = {};

  function mockSpawn(_program, _args, options) {
    captured.program = _program;
    captured.args = _args;
    captured.options = options;

    const child = new EventEmitter();
    const stdin = new EventEmitter();
    stdin.write = () => true;
    stdin.end = () => {};
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stdout.pipe = () => {};
    child.stderr = new EventEmitter();
    child.stderr.pipe = () => {};
    child.pid = 99999;

    // Simulate successful exit on next tick, then close after stdio drains
    process.nextTick(() => {
      child.emit('exit', 0, null);
      process.nextTick(() => child.emit('close', 0, null));
    });
    return child;
  }

  return { mockSpawn, captured };
}

describe('runOnce - workerEnv injection', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('merges workerEnv into spawn env', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();

    await runOnce({
      program: 'test-program',
      args: ['--arg1'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'test-program --arg1',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: mockSpawn,
      workerEnv: { CLAUDE_CODE_EFFORT_LEVEL: 'high' },
    });

    expect(captured.options.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
    // Existing env vars should still be present
    expect(captured.options.env.PATH).toBe(process.env.PATH);
  });

  test('uses process.env only when workerEnv is not provided', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();

    await runOnce({
      program: 'test-program',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'test-program',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: mockSpawn,
    });

    // Existing env vars should be present
    expect(captured.options.env.PATH).toBe(process.env.PATH);
    expect(captured.options.env.HOME).toBe(process.env.HOME);
    // No extra keys beyond what process.env has
    const envKeys = Object.keys(captured.options.env);
    const processEnvKeys = Object.keys(process.env);
    expect(envKeys.sort()).toEqual(processEnvKeys.sort());
  });

  test('merges multiple workerEnv vars into spawn env', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();

    await runOnce({
      program: 'test-program',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'test-program',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: mockSpawn,
      workerEnv: { VAR_A: '1', VAR_B: '2' },
    });

    expect(captured.options.env.VAR_A).toBe('1');
    expect(captured.options.env.VAR_B).toBe('2');
    // Existing env vars should still be present
    expect(captured.options.env.PATH).toBe(process.env.PATH);
  });

  test('workerEnv values override existing process.env values', async () => {
    const { mockSpawn, captured } = createCapturingSpawnFn();

    await runOnce({
      program: 'test-program',
      args: [],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'test-program',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: mockSpawn,
      workerEnv: { HOME: '/override/home' },
    });

    // workerEnv should take precedence (spread order: { ...process.env, ...workerEnv })
    expect(captured.options.env.HOME).toBe('/override/home');
    // Other process.env vars should still be present
    expect(captured.options.env.PATH).toBe(process.env.PATH);
  });
});

// ---------------------------------------------------------------------------
// runOnce() — stream close guarantee
// ---------------------------------------------------------------------------

describe('runOnce - stream close guarantee', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  test('does not resolve before outStream/errStream close events fire', async () => {
    // Track close events on the real file write streams by monkey-patching
    // fs.createWriteStream for this test.
    const originalCreateWriteStream = fs.createWriteStream;
    const streamCloseTimestamps = [];
    let resolveTimestamp = 0;

    fs.createWriteStream = function (...args) {
      const stream = originalCreateWriteStream.apply(this, args);
      stream.on('close', () => {
        streamCloseTimestamps.push(Date.now());
      });
      return stream;
    };

    try {
      const { mockSpawn } = createCapturingSpawnFn();

      const result = await runOnce({
        program: 'test-program',
        args: [],
        prompt: '',
        member: paths.member,
        memberDir: paths.memberDir,
        command: 'test-program',
        timeoutSec: 0,
        attempt: 0,
        spawnFn: mockSpawn,
      });
      resolveTimestamp = Date.now();

      expect(result.state).toBe('done');

      // Give a tick for any pending close events to fire
      await new Promise((r) => setTimeout(r, 50));

      // Both outStream and errStream should have closed BEFORE (or at) resolve
      expect(streamCloseTimestamps.length).toBe(2);
      for (const ts of streamCloseTimestamps) {
        expect(ts <= resolveTimestamp).toBe(true);
      }
    } finally {
      fs.createWriteStream = originalCreateWriteStream;
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

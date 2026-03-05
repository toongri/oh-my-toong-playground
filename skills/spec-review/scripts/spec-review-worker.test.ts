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
} from './spec-review-worker.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
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

  afterEach(() => {
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
    const output = fs.readFileSync(paths.outPath, 'utf8');
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

  afterEach(() => {
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

  test('writes status.json to reviewerDir', async () => {
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

    const out = fs.readFileSync(paths.outPath, 'utf8');
    const err = fs.readFileSync(paths.errPath, 'utf8');
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

  afterEach(() => {
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

    const out = fs.readFileSync(paths.outPath, 'utf8');
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
// runOnce() — synchronous spawn throw (M-2)
// ---------------------------------------------------------------------------

describe('runOnce - synchronous spawnFn throw', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(async () => {
    // Allow async stream cleanup to complete before removing tmpDir
    await sleepMs(50);
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
// runOnce() — non-SIGTERM signal (M-4)
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
// runOnce() — workerEnv injection
// ---------------------------------------------------------------------------

/**
 * Creates a mock spawnFn that captures spawn options and simulates
 * a successful child process (exit code 0).
 */
function createCapturingSpawnFn() {
  const captured: Record<string, unknown> = {};

  function mockSpawn(_program, _args, options) {
    captured.program = _program;
    captured.args = _args;
    captured.options = options;

    const child = new EventEmitter();
    const stdin = new EventEmitter() as EventEmitter & { write: () => boolean; end: () => void };
    stdin.write = () => true;
    stdin.end = () => {};
    (child as unknown as Record<string, unknown>).stdin = stdin;
    const stdout = new EventEmitter();
    (stdout as unknown as Record<string, unknown>).pipe = () => {};
    (child as unknown as Record<string, unknown>).stdout = stdout;
    const stderr = new EventEmitter();
    (stderr as unknown as Record<string, unknown>).pipe = () => {};
    (child as unknown as Record<string, unknown>).stderr = stderr;
    (child as unknown as Record<string, unknown>).pid = 99999;

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

  afterEach(() => {
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

    expect((captured.options as Record<string, unknown> & { env: Record<string, string> }).env.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
    expect((captured.options as Record<string, unknown> & { env: Record<string, string> }).env.PATH).toBe(process.env.PATH);
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

    const env = (captured.options as Record<string, unknown> & { env: Record<string, string> }).env;
    expect(env.VAR_A).toBe('1');
    expect(env.VAR_B).toBe('2');
    expect(env.PATH).toBe(process.env.PATH);
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

    const env = (captured.options as Record<string, unknown> & { env: Record<string, string> }).env;
    expect(env.HOME).toBe('/override/home');
    expect(env.PATH).toBe(process.env.PATH);
  });

  test('subprocess receives workerEnv variables in its environment', async () => {
    // End-to-end: spawn a real process that prints the env var
    const result = await runOnce({
      program: 'sh',
      args: ['-c', 'echo "VAL=$MY_WORKER_VAR"'],
      prompt: '',
      member: paths.member,
      memberDir: paths.memberDir,
      command: 'sh -c echo VAL=$MY_WORKER_VAR',
      timeoutSec: 5,
      attempt: 0,
      workerEnv: { MY_WORKER_VAR: 'hello-env' },
    });

    expect(result.state).toBe('done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(output.includes('VAL=hello-env')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// main() — logging lifecycle via subprocess
// ---------------------------------------------------------------------------

describe('main - logging lifecycle', () => {
  const WORKER_PATH = path.join(import.meta.dirname, 'spec-review-worker.ts');

  test('creates a log file in .omt/logs/ after successful run', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-log-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'reviewers', 'claude');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), 'test prompt', 'utf8');

      const proc = Bun.spawn(
        ['bun', WORKER_PATH, '--job-dir', jobDir, '--member', 'claude', '--command', 'true', '--project-root', tmpDir],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Log file should exist in tmpDir/.omt/logs/
      // jobId = basename('job').replace(/^spec-review-/, '') = 'job'
      const logFile = path.join(tmpDir, '.omt', 'logs', 'spec-review-worker-job.log');
      expect(fs.existsSync(logFile)).toBe(true);
      const content = fs.readFileSync(logFile, 'utf8');
      expect(content.includes('========== START ==========')).toBe(true);
      expect(content.includes('========== END ==========')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('passes --env KEY=VALUE to spawned subprocess environment', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-env-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'reviewers', 'claude');
      const outFile = path.join(tmpDir, 'env-output.txt');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), '', 'utf8');

      // Command writes MY_ENV_VAR value to outFile
      const command = `sh -c 'echo $MY_ENV_VAR > ${outFile}'`;

      const proc = Bun.spawn(
        [
          'bun', WORKER_PATH,
          '--job-dir', jobDir,
          '--member', 'claude',
          '--command', command,
          '--env', 'MY_ENV_VAR=env-test-value',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      await proc.exited;

      // The env var should have been passed to the subprocess
      const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      expect(output.trim()).toBe('env-test-value');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runOnce() — assembled-prompt.txt creation (M-5)
// ---------------------------------------------------------------------------

describe('runOnce - assembled-prompt.txt creation', () => {
  let tmpDir;
  let paths;
  let promptsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
    // Create a prompts dir with a role file matching the reviewer name
    promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates assembled-prompt.txt in reviewerDir when role file exists', async () => {
    // assemblePrompt uses PROMPTS_DIR which is hardcoded to ../prompts relative to script.
    // We need to use a reviewer name that has a role file in the real prompts dir.
    // The real prompts dir has claude.md, codex.md, gemini.md.
    // Use 'claude' as reviewer to trigger structured prompt assembly.
    const result = await runOnce({
      program: 'true',
      args: [],
      prompt: 'test prompt',
      member: 'claude',
      memberDir: paths.memberDir,
      command: 'true',
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    const assembledPath = path.join(paths.memberDir, 'assembled-prompt.txt');
    expect(fs.existsSync(assembledPath)).toBe(true);
    const content = fs.readFileSync(assembledPath, 'utf8');
    expect(content.includes('test prompt')).toBe(true);
    expect(content.includes('<system-instructions>')).toBe(true);
  });
});

#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { Writable, Readable } from 'stream';

import {
  runOnce,
  runWithRetry,
  assemblePrompt,
} from './council-job-worker.ts';

const WORKER_PATH = path.join(import.meta.dirname, 'council-job-worker.ts');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cjw-test-'));
}

function setupJobDir(tmpDir, { prompt = 'test prompt' } = {}) {
  const jobDir = path.join(tmpDir, 'job');
  const memberDir = path.join(jobDir, 'members', 'test-member');
  fs.mkdirSync(memberDir, { recursive: true });
  if (prompt !== null) {
    fs.writeFileSync(path.join(jobDir, 'prompt.txt'), prompt, 'utf8');
  }
  return {
    jobDir,
    memberDir,
    statusPath: path.join(memberDir, 'status.json'),
    outPath: path.join(memberDir, 'output.txt'),
    errPath: path.join(memberDir, 'error.txt'),
  };
}

function readStatus(statusPath) {
  return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
}

/** Create a fake child process (EventEmitter + stdin/stdout/stderr). */
function fakeChild({ pid = 1234 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      child.stdin._written = (child.stdin._written || '') + chunk.toString();
      cb();
    },
  });
  child.stdin._written = '';
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  return child;
}

// ---------------------------------------------------------------------------
// runOnce - stdin delivery
// ---------------------------------------------------------------------------

describe('runOnce - stdin delivery', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('passes prompt via stdin, not as CLI argument', async () => {
    // Use a real child process: `cat` reads stdin and writes to stdout.
    const result = await runOnce({
      command: 'cat',
      prompt: 'hello from stdin',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    // cat echoes stdin to stdout -> output.txt should contain the prompt
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(output).toBe('hello from stdin');
  });

  test('does not include prompt in spawn arguments', async () => {
    // `echo` ignores stdin and prints its args.
    // If prompt were passed as an arg, output would contain it.
    const result = await runOnce({
      command: 'echo fixed-output',
      prompt: 'THIS_SHOULD_NOT_APPEAR',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(!output.includes('THIS_SHOULD_NOT_APPEAR')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOnce - terminal states
// ---------------------------------------------------------------------------

describe('runOnce - terminal states', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns done state on exit 0', async () => {
    const result = await runOnce({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('done');
    expect(result.exitCode).toBe(0);
  });

  test('returns error state on exit 1', async () => {
    const result = await runOnce({
      command: 'false',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('error');
    expect(result.exitCode).toBe(1);
  });

  test('returns missing_cli state for nonexistent command', async () => {
    const result = await runOnce({
      command: 'nonexistent-command-abc123xyz',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.state).toBe('missing_cli');
  });

  test('returns timed_out state when timeout exceeded', async () => {
    const result = await runOnce({
      command: 'sleep 60',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0.2,
      attempt: 0,
    });
    expect(result.state).toBe('timed_out');
  });

  test('includes attempt field in status.json', async () => {
    await runOnce({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 2,
    });
    const status = readStatus(paths.statusPath);
    expect(status.attempt).toBe(2);
  });

  test('includes member and command in result', async () => {
    const result = await runOnce({
      command: 'true',
      prompt: '',
      member: 'gpt-4',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    expect(result.member).toBe('gpt-4');
    expect(result.command).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// runWithRetry
// ---------------------------------------------------------------------------

describe('runWithRetry', () => {
  let tmpDir;
  let paths;
  let callCount;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
    callCount = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('succeeds without retry when first attempt passes', async () => {
    const result = await runWithRetry({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
    });
    expect(result.state).toBe('done');
    expect(result.attempt).toBe(0);
  });

  test('retries on error and succeeds on second attempt', async () => {
    // Use a script that fails first time, succeeds second time via a marker file
    const markerFile = path.join(tmpDir, 'attempt-marker');
    // sh -c script: if marker exists -> exit 0, else create marker and exit 1
    const script = `sh -c 'if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}" && exit 1; fi'`;

    const result = await runWithRetry({
      command: script,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(), // skip delay in tests
    });
    expect(result.state).toBe('done');
    expect(result.attempt).toBe(1);
  });

  test('exhausts all retries and returns final error', async () => {
    const result = await runWithRetry({
      command: 'false',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.state).toBe('error');
    expect(result.attempt).toBe(1); // 0, 1 = 2 attempts
  });

  test('does not retry on missing_cli', async () => {
    const result = await runWithRetry({
      command: 'nonexistent-command-abc123xyz',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.state).toBe('missing_cli');
    expect(result.attempt).toBe(0);
  });

  test('does not retry on timed_out', async () => {
    const result = await runWithRetry({
      command: 'sleep 60',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0.2,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.state).toBe('timed_out');
    expect(result.attempt).toBe(0);
  });

  test('does not retry on canceled', async () => {
    // Simulate canceled: spawn a long process and immediately SIGTERM it
    // We use a custom runOnce mock via sleepFn tracking
    // Actually, to test canceled we need a real scenario.
    // Start a process and kill it externally.
    const scriptPath = path.join(tmpDir, 'long-sleep.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\nsleep 60\n', { mode: 0o755 });

    // Start runWithRetry in background and kill the spawned process
    const resultPromise = runWithRetry({
      command: scriptPath,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0, // no timeout
      sleepFn: () => Promise.resolve(),
    });

    // Wait for status.json to have a pid
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        try {
          const status = readStatus(paths.statusPath);
          if (status.pid) {
            clearInterval(interval);
            // Kill the process with SIGTERM (canceled, not timed out)
            try { process.kill(status.pid, 'SIGTERM'); } catch {}
            resolve();
          }
        } catch {
          // status.json not written yet
        }
      }, 20);
    });

    const result = await resultPromise;
    expect(result.state).toBe('canceled');
    expect(result.attempt).toBe(0);
  });

  test('appends output with attempt marker on retry', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker2');
    // First attempt: echo "attempt1" and exit 1; second: echo "attempt2" and exit 0
    const script = `sh -c 'if [ -f "${markerFile}" ]; then echo attempt2 && exit 0; else touch "${markerFile}" && echo attempt1 && exit 1; fi'`;

    await runWithRetry({
      command: script,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    const output = fs.readFileSync(paths.outPath, 'utf8');
    // Should contain both attempts with marker separator
    expect(output.includes('attempt1')).toBe(true);
    expect(output.includes('--- attempt 1 ---')).toBe(true);
    expect(output.includes('attempt2')).toBe(true);
  });

  test('status.json contains attempt field after completion', async () => {
    await runWithRetry({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
    });
    const status = readStatus(paths.statusPath);
    expect(typeof status.attempt).toBe('number');
    expect(status.attempt).toBe(0);
  });

  test('applies exponential backoff with jitter', async () => {
    const delays = [];
    const sleepFn = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    await runWithRetry({
      command: 'false',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn,
    });

    // 1 retry = 1 delay
    expect(delays.length).toBe(1);
    // First delay: base * 2^0 + jitter = 1000..2000
    expect(delays[0] >= 1000).toBe(true);
    expect(delays[0] < 2000).toBe(true);
  });

  test('writes retrying status before backoff sleep', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker-retrying');
    const script = `sh -c 'if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}" && exit 1; fi'`;

    const capturedStatuses = [];
    const sleepFn = async (ms) => {
      // Read status.json during sleep to verify retrying state
      const status = readStatus(paths.statusPath);
      capturedStatuses.push(status);
    };

    const result = await runWithRetry({
      command: script,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn,
    });

    expect(result.state).toBe('done');
    expect(capturedStatuses.length).toBe(1);
    expect(capturedStatuses[0].state).toBe('retrying');
    expect(capturedStatuses[0].attempt).toBe(1);
    expect(capturedStatuses[0].member).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// runOnce - invalid command (unmatched quote)
// ---------------------------------------------------------------------------

describe('runOnce - invalid command', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error state with Invalid command message for unmatched quote', async () => {
    const result = await runOnce({
      command: "echo 'unmatched",
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('error');
    expect(result.message.includes('Invalid command')).toBe(true);
    // Also verify status.json was written
    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// runOnce - non-SIGTERM signal (SIGKILL)
// ---------------------------------------------------------------------------

describe('runOnce - SIGKILL signal', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error state (not canceled) when process is killed with SIGKILL', async () => {
    const resultPromise = runOnce({
      command: 'sleep 60',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });

    // Poll for pid in status.json
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        try {
          const status = readStatus(paths.statusPath);
          if (status.pid) {
            clearInterval(interval);
            process.kill(status.pid, 'SIGKILL');
            resolve();
          }
        } catch {
          // status.json not written yet
        }
      }, 20);
    });

    const result = await resultPromise;
    expect(result.state).toBe('error');
    expect(result.state).not.toBe('canceled');
    expect(result.exitCode).toBe(null);
    expect(result.signal).toBe('SIGKILL');
  });
});

// ---------------------------------------------------------------------------
// runWithRetry - workerEnv injection
// ---------------------------------------------------------------------------

describe('runWithRetry - workerEnv injection', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('subprocess receives workerEnv variables in its environment', async () => {
    // End-to-end: spawn a real process that prints the env var to output
    const outFile = path.join(tmpDir, 'env-check.txt');
    const result = await runWithRetry({
      command: `sh -c 'echo "VAL=$MY_COUNCIL_VAR" > ${outFile}'`,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      workerEnv: { MY_COUNCIL_VAR: 'council-env-value' },
    });

    expect(result.state).toBe('done');
    const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    expect(output.trim()).toBe('VAL=council-env-value');
  });

  test('multiple workerEnv vars are all passed to subprocess', async () => {
    const outFile = path.join(tmpDir, 'env-multi.txt');
    const result = await runWithRetry({
      command: `sh -c 'echo "$VAR_A $VAR_B" > ${outFile}'`,
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      workerEnv: { VAR_A: 'alpha', VAR_B: 'beta' },
    });

    expect(result.state).toBe('done');
    const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    expect(output.trim()).toBe('alpha beta');
  });
});

// ---------------------------------------------------------------------------
// main() — --env passthrough via subprocess
// ---------------------------------------------------------------------------

describe('main - --env passthrough', () => {
  const WORKER_PATH = path.join(import.meta.dirname, 'council-job-worker.ts');

  test('passes --env KEY=VALUE to spawned subprocess environment', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-env-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'members', 'test-member');
      const outFile = path.join(tmpDir, 'env-output.txt');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), '', 'utf8');

      // Command writes MY_COUNCIL_ENV value to outFile
      const command = `sh -c 'echo $MY_COUNCIL_ENV > ${outFile}'`;

      const proc = Bun.spawn(
        [
          'bun', WORKER_PATH,
          '--job-dir', jobDir,
          '--member', 'test-member',
          '--command', command,
          '--env', 'MY_COUNCIL_ENV=council-test-value',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      await proc.exited;

      const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      expect(output.trim()).toBe('council-test-value');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates a log file in .omt/logs/ after successful run', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-log-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'members', 'test-member');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), 'test prompt', 'utf8');

      const proc = Bun.spawn(
        [
          'bun', WORKER_PATH,
          '--job-dir', jobDir,
          '--member', 'test-member',
          '--command', 'true',
          '--project-root', tmpDir,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Log file should exist in tmpDir/.omt/logs/
      // jobId = basename('job').replace(/^council-/, '') = 'job'
      const logFile = path.join(tmpDir, '.omt', 'logs', 'council-job-worker-job.log');
      expect(fs.existsSync(logFile)).toBe(true);
      const content = fs.readFileSync(logFile, 'utf8');
      expect(content.includes('========== START ==========')).toBe(true);
      expect(content.includes('========== END ==========')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runOnce - assembled-prompt.txt creation
// ---------------------------------------------------------------------------

describe('runOnce - assembled-prompt.txt', () => {
  let tmpDir;
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates assembled-prompt.txt when role file exists', async () => {
    // runOnce uses PROMPTS_DIR = path.resolve(import.meta.dirname, '../prompts') internally.
    // We need to place a role file at that location for the member name.
    // Instead, use a unique member name with a role file in the real prompts dir.
    // Actually, the PROMPTS_DIR is hardcoded. Let's check if prompts dir has files.
    const promptsDir = path.resolve(import.meta.dirname, '../prompts');

    // Find any existing role file in the prompts dir
    let entityName = null;
    try {
      const files = fs.readdirSync(promptsDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          entityName = f.replace('.md', '');
          break;
        }
      }
    } catch {
      // prompts dir doesn't exist
    }

    if (!entityName) {
      // Create prompts dir and a test role file
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(path.join(promptsDir, '__test-entity__.md'), '# Test Role', 'utf8');
      entityName = '__test-entity__';
    }

    const safeMember = 'test-member';
    const result = await runOnce({
      command: 'true',
      prompt: 'test prompt for assembly',
      member: entityName,
      safeMember,
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');

    // Verify assembled-prompt.txt was created
    const assembledPath = path.join(paths.memberDir, 'assembled-prompt.txt');
    expect(fs.existsSync(assembledPath)).toBe(true);

    // Verify content matches what assemblePrompt would produce
    const assembledContent = fs.readFileSync(assembledPath, 'utf8');
    const expected = assemblePrompt({
      promptsDir,
      entityName,
      rawPrompt: 'test prompt for assembly',
    });
    expect(assembledContent).toBe(expected.assembled);

    // Clean up test role file if we created it
    try {
      fs.unlinkSync(path.join(promptsDir, '__test-entity__.md'));
    } catch { /* ignore */ }
  });

  test('does not create assembled-prompt.txt when role file is absent', async () => {
    const safeMember = 'test-member';
    const result = await runOnce({
      command: 'true',
      prompt: 'raw prompt only',
      member: 'nonexistent-model-xyz',
      safeMember,
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');

    // assembled-prompt.txt should NOT exist since role file is missing
    const assembledPath = path.join(paths.memberDir, 'assembled-prompt.txt');
    expect(!fs.existsSync(assembledPath)).toBe(true);
  });
});

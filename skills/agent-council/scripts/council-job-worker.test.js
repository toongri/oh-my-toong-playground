#!/usr/bin/env node

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { Writable, Readable } = require('stream');

const WORKER_PATH = path.join(__dirname, 'council-job-worker.js');

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
// splitCommand
// ---------------------------------------------------------------------------

describe('splitCommand', () => {
  let splitCommand;

  beforeEach(() => {
    splitCommand = require(WORKER_PATH).splitCommand;
  });

  it('splits a simple command', () => {
    assert.deepEqual(splitCommand('echo hello world'), ['echo', 'hello', 'world']);
  });

  it('handles single-quoted arguments', () => {
    assert.deepEqual(splitCommand("echo 'hello world'"), ['echo', 'hello world']);
  });

  it('handles double-quoted arguments', () => {
    assert.deepEqual(splitCommand('echo "hello world"'), ['echo', 'hello world']);
  });

  it('handles escaped characters', () => {
    assert.deepEqual(splitCommand('echo hello\\ world'), ['echo', 'hello world']);
  });

  it('returns null for unmatched single quote', () => {
    assert.equal(splitCommand("echo 'hello"), null);
  });

  it('returns null for unmatched double quote', () => {
    assert.equal(splitCommand('echo "hello'), null);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(splitCommand(''), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepEqual(splitCommand(null), []);
    assert.deepEqual(splitCommand(undefined), []);
  });

  it('handles multiple spaces between tokens', () => {
    assert.deepEqual(splitCommand('a   b   c'), ['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// atomicWriteJson
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  let atomicWriteJson;
  let tmpDir;

  beforeEach(() => {
    atomicWriteJson = require(WORKER_PATH).atomicWriteJson;
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON to the target path', () => {
    const fp = path.join(tmpDir, 'test.json');
    const payload = { member: 'gpt-4', state: 'done' };
    atomicWriteJson(fp, payload);
    const result = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.deepEqual(result, payload);
  });

  it('overwrites existing file', () => {
    const fp = path.join(tmpDir, 'test.json');
    atomicWriteJson(fp, { v: 1 });
    atomicWriteJson(fp, { v: 2 });
    const result = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(result.v, 2);
  });

  it('leaves no tmp files behind', () => {
    const fp = path.join(tmpDir, 'test.json');
    atomicWriteJson(fp, { ok: true });
    const files = fs.readdirSync(tmpDir);
    assert.deepEqual(files, ['test.json']);
  });
});

// ---------------------------------------------------------------------------
// sleepMs
// ---------------------------------------------------------------------------

describe('sleepMs', () => {
  let sleepMs;

  beforeEach(() => {
    sleepMs = require(WORKER_PATH).sleepMs;
  });

  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleepMs(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `expected >= 40ms, got ${elapsed}ms`);
  });

  it('resolves with undefined', async () => {
    const result = await sleepMs(1);
    assert.equal(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// runOnce - stdin delivery
// ---------------------------------------------------------------------------

describe('runOnce - stdin delivery', () => {
  let runOnce;
  let tmpDir;
  let paths;

  beforeEach(() => {
    runOnce = require(WORKER_PATH).runOnce;
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes prompt via stdin, not as CLI argument', async () => {
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

    assert.equal(result.state, 'done');
    // cat echoes stdin to stdout -> output.txt should contain the prompt
    const output = fs.readFileSync(paths.outPath, 'utf8');
    assert.equal(output, 'hello from stdin');
  });

  it('does not include prompt in spawn arguments', async () => {
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

    assert.equal(result.state, 'done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    assert.ok(
      !output.includes('THIS_SHOULD_NOT_APPEAR'),
      `prompt leaked into CLI args: ${output}`,
    );
  });
});

// ---------------------------------------------------------------------------
// runOnce - terminal states
// ---------------------------------------------------------------------------

describe('runOnce - terminal states', () => {
  let runOnce;
  let tmpDir;
  let paths;

  beforeEach(() => {
    runOnce = require(WORKER_PATH).runOnce;
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns done state on exit 0', async () => {
    const result = await runOnce({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'done');
    assert.equal(result.exitCode, 0);
  });

  it('returns error state on exit 1', async () => {
    const result = await runOnce({
      command: 'false',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'error');
    assert.equal(result.exitCode, 1);
  });

  it('returns missing_cli state for nonexistent command', async () => {
    const result = await runOnce({
      command: 'nonexistent-command-abc123xyz',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'missing_cli');
  });

  it('returns timed_out state when timeout exceeded', async () => {
    const result = await runOnce({
      command: 'sleep 60',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0.2,
      attempt: 0,
    });
    assert.equal(result.state, 'timed_out');
  });

  it('includes attempt field in status.json', async () => {
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
    assert.equal(status.attempt, 2);
  });

  it('includes member and command in result', async () => {
    const result = await runOnce({
      command: 'true',
      prompt: '',
      member: 'gpt-4',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.member, 'gpt-4');
    assert.equal(result.command, 'true');
  });
});

// ---------------------------------------------------------------------------
// runWithRetry
// ---------------------------------------------------------------------------

describe('runWithRetry', () => {
  let runWithRetry;
  let tmpDir;
  let paths;
  let callCount;
  let originalRunOnce;

  beforeEach(() => {
    const worker = require(WORKER_PATH);
    runWithRetry = worker.runWithRetry;
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
    callCount = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('succeeds without retry when first attempt passes', async () => {
    const result = await runWithRetry({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
    });
    assert.equal(result.state, 'done');
    assert.equal(result.attempt, 0);
  });

  it('retries on error and succeeds on second attempt', async () => {
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
    assert.equal(result.state, 'done');
    assert.equal(result.attempt, 1);
  });

  it('exhausts all retries and returns final error', async () => {
    const result = await runWithRetry({
      command: 'false',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });
    assert.equal(result.state, 'error');
    assert.equal(result.attempt, 2); // 0, 1, 2 = 3 attempts
  });

  it('does not retry on missing_cli', async () => {
    const result = await runWithRetry({
      command: 'nonexistent-command-abc123xyz',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });
    assert.equal(result.state, 'missing_cli');
    assert.equal(result.attempt, 0);
  });

  it('does not retry on timed_out', async () => {
    const result = await runWithRetry({
      command: 'sleep 60',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 0.2,
      sleepFn: () => Promise.resolve(),
    });
    assert.equal(result.state, 'timed_out');
    assert.equal(result.attempt, 0);
  });

  it('does not retry on canceled', async () => {
    // Simulate canceled: spawn a long process and immediately SIGTERM it
    // We use a custom runOnce mock via sleepFn tracking
    // Actually, to test canceled we need a real scenario.
    // Start a process and kill it externally.
    const child_process = require('child_process');
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
    assert.equal(result.state, 'canceled');
    assert.equal(result.attempt, 0);
  });

  it('overwrites output.txt and error.txt on retry', async () => {
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
    // Should contain only the last attempt's output
    assert.ok(output.includes('attempt2'), `expected 'attempt2' in output, got: ${output}`);
    assert.ok(!output.includes('attempt1'), `should not contain 'attempt1', got: ${output}`);
  });

  it('status.json contains attempt field after completion', async () => {
    await runWithRetry({
      command: 'true',
      prompt: '',
      member: 'test',
      safeMember: 'test-member',
      jobDir: paths.jobDir,
      timeoutSec: 5,
    });
    const status = readStatus(paths.statusPath);
    assert.equal(typeof status.attempt, 'number');
    assert.equal(status.attempt, 0);
  });

  it('applies exponential backoff with jitter', async () => {
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

    // 2 retries = 2 delays
    assert.equal(delays.length, 2);
    // First delay: base * 2^0 + jitter = 1000..2000
    assert.ok(delays[0] >= 1000, `delay[0] should be >= 1000, got ${delays[0]}`);
    assert.ok(delays[0] < 2000, `delay[0] should be < 2000, got ${delays[0]}`);
    // Second delay: base * 2^1 + jitter = 2000..3000
    assert.ok(delays[1] >= 2000, `delay[1] should be >= 2000, got ${delays[1]}`);
    assert.ok(delays[1] < 3000, `delay[1] should be < 3000, got ${delays[1]}`);
  });
});

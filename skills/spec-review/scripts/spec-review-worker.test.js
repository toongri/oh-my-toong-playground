#!/usr/bin/env node

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const {
  splitCommand,
  atomicWriteJson,
  runOnce,
  runWithRetry,
  sleepMs,
  MAX_RETRIES,
  BASE_DELAY_MS,
} = require('./spec-review-worker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
}

function buildJobDir(tmpDir) {
  const jobDir = path.join(tmpDir, 'job');
  const reviewerDir = path.join(jobDir, 'reviewers', 'safe-rev');
  fs.mkdirSync(reviewerDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), 'test prompt content', 'utf8');
  return jobDir;
}

/** Create a fake ChildProcess EventEmitter with stdin/stdout/stderr stubs. */
function fakeChild({ pid = 12345 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;

  // stdin mock
  const stdinData = [];
  child.stdin = {
    write(data) { stdinData.push(data); },
    end() { stdinData.push('__END__'); },
    on() {},
    _written() { return stdinData.filter(d => d !== '__END__').join(''); },
    _ended() { return stdinData.includes('__END__'); },
  };

  // stdout/stderr as passthrough
  child.stdout = new EventEmitter();
  child.stdout.pipe = function (dest) {
    this.on('data', (chunk) => dest.write(chunk));
    return dest;
  };
  child.stderr = new EventEmitter();
  child.stderr.pipe = function (dest) {
    this.on('data', (chunk) => dest.write(chunk));
    return dest;
  };

  return { child, stdinData };
}

// ---------------------------------------------------------------------------
// splitCommand() tests
// ---------------------------------------------------------------------------

describe('splitCommand', () => {
  it('splits simple space-separated tokens', () => {
    assert.deepEqual(splitCommand('echo hello world'), ['echo', 'hello', 'world']);
  });

  it('handles single-quoted strings', () => {
    assert.deepEqual(splitCommand("echo 'hello world'"), ['echo', 'hello world']);
  });

  it('handles double-quoted strings', () => {
    assert.deepEqual(splitCommand('echo "hello world"'), ['echo', 'hello world']);
  });

  it('handles escaped characters', () => {
    assert.deepEqual(splitCommand('echo hello\\ world'), ['echo', 'hello world']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(splitCommand(''), []);
  });

  it('returns null for null/undefined input', () => {
    assert.deepEqual(splitCommand(null), []);
    assert.deepEqual(splitCommand(undefined), []);
  });

  it('returns null for unmatched single quote', () => {
    assert.equal(splitCommand("echo 'hello"), null);
  });

  it('returns null for unmatched double quote', () => {
    assert.equal(splitCommand('echo "hello'), null);
  });

  it('handles multiple spaces between tokens', () => {
    assert.deepEqual(splitCommand('echo   hello   world'), ['echo', 'hello', 'world']);
  });

  it('handles mixed quotes', () => {
    assert.deepEqual(splitCommand(`echo "hello 'world'"`), ['echo', "hello 'world'"]);
  });
});

// ---------------------------------------------------------------------------
// atomicWriteJson() tests
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON to the target path', () => {
    const filePath = path.join(tmpDir, 'test.json');
    const payload = { state: 'done', exitCode: 0 };
    atomicWriteJson(filePath, payload);
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(result, payload);
  });

  it('overwrites existing file atomically', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { v: 1 });
    atomicWriteJson(filePath, { v: 2 });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(result.v, 2);
  });

  it('formats JSON with 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { a: 1 });
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.equal(raw, JSON.stringify({ a: 1 }, null, 2));
  });

  it('does not leave tmp files on success', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { ok: true });
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], 'test.json');
  });
});

// ---------------------------------------------------------------------------
// sleepMs() tests
// ---------------------------------------------------------------------------

describe('sleepMs', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleepMs(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
  });

  it('returns a promise', () => {
    const result = sleepMs(1);
    assert.ok(result instanceof Promise);
  });
});

// ---------------------------------------------------------------------------
// runOnce() — stdin pipe tests
// ---------------------------------------------------------------------------

describe('runOnce - stdin pipe', () => {
  let tmpDir;
  let jobDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    jobDir = buildJobDir(tmpDir);
  });

  afterEach(async () => {
    await sleepMs(50); // let write streams close
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes prompt to child stdin instead of passing as CLI argument', async () => {
    const { child, stdinData } = fakeChild();

    const spawnMock = mock.fn(() => child);

    const resultPromise = runOnce({
      program: 'echo',
      args: ['--flag'],
      prompt: 'my prompt text',
      reviewer: 'rev1',
      reviewerDir: path.join(jobDir, 'reviewers', 'safe-rev'),
      command: 'echo --flag',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: spawnMock,
    });

    // Verify spawn was called WITHOUT prompt in args
    const spawnArgs = spawnMock.mock.calls[0].arguments;
    assert.equal(spawnArgs[0], 'echo');
    assert.deepEqual(spawnArgs[1], ['--flag']);
    // stdio should have 'pipe' for stdin
    assert.equal(spawnArgs[2].stdio[0], 'pipe');

    // Verify stdin received the prompt
    assert.equal(child.stdin._written(), 'my prompt text');
    assert.ok(child.stdin._ended());

    // Complete the child
    child.emit('exit', 0, null);
    await resultPromise;
  });

  it('handles stdin pipe errors gracefully', async () => {
    const { child } = fakeChild();
    let stdinErrorHandler = null;
    child.stdin.on = (event, handler) => {
      if (event === 'error') stdinErrorHandler = handler;
    };

    const spawnMock = mock.fn(() => child);

    const resultPromise = runOnce({
      program: 'echo',
      args: [],
      prompt: 'test',
      reviewer: 'rev1',
      reviewerDir: path.join(jobDir, 'reviewers', 'safe-rev'),
      command: 'echo',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: spawnMock,
    });

    // Trigger stdin error — should not crash
    if (stdinErrorHandler) stdinErrorHandler(new Error('pipe broken'));

    child.emit('exit', 0, null);
    const result = await resultPromise;
    assert.equal(result.state, 'done');
  });
});

// ---------------------------------------------------------------------------
// runOnce() — exit states
// ---------------------------------------------------------------------------

describe('runOnce - exit states', () => {
  let tmpDir;
  let jobDir;
  let reviewerDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    jobDir = buildJobDir(tmpDir);
    reviewerDir = path.join(jobDir, 'reviewers', 'safe-rev');
  });

  afterEach(async () => {
    await sleepMs(50); // let write streams close
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRunOnce(overrides = {}) {
    const { child } = fakeChild();
    const spawnMock = mock.fn(() => child);
    const defaults = {
      program: 'test-cmd',
      args: [],
      prompt: '',
      reviewer: 'rev1',
      reviewerDir,
      command: 'test-cmd',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: spawnMock,
    };
    return { child, spawnMock, opts: { ...defaults, ...overrides } };
  }

  it('returns done state on exit code 0', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);
    child.emit('exit', 0, null);
    const result = await p;
    assert.equal(result.state, 'done');
    assert.equal(result.exitCode, 0);
  });

  it('returns error state on non-zero exit code', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);
    child.emit('exit', 1, null);
    const result = await p;
    assert.equal(result.state, 'error');
    assert.equal(result.exitCode, 1);
  });

  it('returns missing_cli state on ENOENT error', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);
    const err = new Error('spawn test-cmd ENOENT');
    err.code = 'ENOENT';
    child.emit('error', err);
    const result = await p;
    assert.equal(result.state, 'missing_cli');
  });

  it('returns timed_out state when timeout triggers', async () => {
    const { child } = fakeChild();
    const spawnMock = mock.fn(() => child);
    const p = runOnce({
      program: 'test-cmd',
      args: [],
      prompt: '',
      reviewer: 'rev1',
      reviewerDir,
      command: 'test-cmd',
      timeoutSec: 0.05,
      attempt: 0,
      spawnFn: spawnMock,
    });

    // Wait for timeout to fire then emit exit
    await sleepMs(100);
    child.emit('exit', null, 'SIGTERM');
    const result = await p;
    assert.equal(result.state, 'timed_out');
  });

  it('returns canceled state on SIGTERM without timeout', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);
    child.emit('exit', null, 'SIGTERM');
    const result = await p;
    assert.equal(result.state, 'canceled');
  });

  it('includes attempt field in status.json', async () => {
    const { child, opts } = makeRunOnce({ attempt: 2 });
    const p = runOnce(opts);
    child.emit('exit', 0, null);
    const result = await p;
    assert.equal(result.attempt, 2);
  });

  it('writes status.json to reviewerDir', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);
    child.emit('exit', 0, null);
    await p;
    const statusPath = path.join(reviewerDir, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(status.state, 'done');
    assert.equal(status.attempt, 0);
    assert.equal(status.reviewer, 'rev1');
  });

  it('writes output.txt and error.txt', async () => {
    const { child, opts } = makeRunOnce();
    const p = runOnce(opts);

    // Simulate stdout/stderr data
    child.stdout.emit('data', Buffer.from('stdout data'));
    child.stderr.emit('data', Buffer.from('stderr data'));

    child.emit('exit', 0, null);
    await p;

    // Give streams a moment to flush
    await sleepMs(50);

    const outPath = path.join(reviewerDir, 'output.txt');
    const errPath = path.join(reviewerDir, 'error.txt');
    assert.equal(fs.readFileSync(outPath, 'utf8'), 'stdout data');
    assert.equal(fs.readFileSync(errPath, 'utf8'), 'stderr data');
  });
});

// ---------------------------------------------------------------------------
// runWithRetry() tests
// ---------------------------------------------------------------------------

describe('runWithRetry', () => {
  let tmpDir;
  let jobDir;
  let reviewerDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    jobDir = buildJobDir(tmpDir);
    reviewerDir = path.join(jobDir, 'reviewers', 'safe-rev');
  });

  afterEach(async () => {
    await sleepMs(50); // let write streams close
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeOpts(overrides = {}) {
    return {
      program: 'test-cmd',
      args: [],
      prompt: '',
      reviewer: 'rev1',
      reviewerDir,
      command: 'test-cmd',
      timeoutSec: 0,
      ...overrides,
    };
  }

  it('succeeds without retry on first exit 0', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      // Auto-exit success
      process.nextTick(() => child.emit('exit', 0, null));
      return child;
    };

    const result = await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'done');
    assert.equal(callCount, 1);
    assert.equal(result.attempt, 0);
  });

  it('retries on error and succeeds on second attempt', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      if (callCount === 1) {
        process.nextTick(() => child.emit('exit', 1, null));
      } else {
        process.nextTick(() => child.emit('exit', 0, null));
      }
      return child;
    };

    const result = await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'done');
    assert.equal(callCount, 2);
    assert.equal(result.attempt, 1);
  });

  it('exhausts all retries and returns final error', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      process.nextTick(() => child.emit('exit', 1, null));
      return child;
    };

    const result = await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'error');
    assert.equal(callCount, 3); // 1 initial + 2 retries
    assert.equal(result.attempt, 2);
  });

  it('does NOT retry on missing_cli (ENOENT)', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      process.nextTick(() => child.emit('error', err));
      return child;
    };

    const result = await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'missing_cli');
    assert.equal(callCount, 1);
  });

  it('does NOT retry on timed_out', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      // We need runOnce to detect timed_out. Use short timeout.
      return child;
    };

    // Use a very short timeout so it fires
    const result = await runWithRetry({
      ...makeOpts({ timeoutSec: 0.05 }),
      spawnFn: () => {
        callCount++;
        const { child } = fakeChild();
        // Wait for timeout to trigger, then emit exit
        setTimeout(() => child.emit('exit', null, 'SIGTERM'), 100);
        return child;
      },
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'timed_out');
    assert.equal(callCount, 1);
  });

  it('does NOT retry on canceled', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      process.nextTick(() => child.emit('exit', null, 'SIGTERM'));
      return child;
    };

    const result = await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'canceled');
    assert.equal(callCount, 1);
  });

  it('applies exponential backoff with jitter between retries', async () => {
    const delays = [];
    const spawnFactory = () => {
      const { child } = fakeChild();
      process.nextTick(() => child.emit('exit', 1, null));
      return child;
    };

    await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    // Should have 2 delays (retry after attempt 0 and attempt 1)
    assert.equal(delays.length, 2);

    // First delay: BASE_DELAY_MS * 2^0 + jitter(0~BASE_DELAY_MS) = 1000..2000
    assert.ok(delays[0] >= BASE_DELAY_MS, `First delay ${delays[0]} should be >= ${BASE_DELAY_MS}`);
    assert.ok(delays[0] < BASE_DELAY_MS * 3, `First delay ${delays[0]} should be < ${BASE_DELAY_MS * 3}`);

    // Second delay: BASE_DELAY_MS * 2^1 + jitter(0~BASE_DELAY_MS) = 2000..3000
    assert.ok(delays[1] >= BASE_DELAY_MS * 2, `Second delay ${delays[1]} should be >= ${BASE_DELAY_MS * 2}`);
    assert.ok(delays[1] < BASE_DELAY_MS * 4, `Second delay ${delays[1]} should be < ${BASE_DELAY_MS * 4}`);
  });

  it('overwrites output.txt and error.txt on retry', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(`stdout-attempt-${callCount}`));
        child.stderr.emit('data', Buffer.from(`stderr-attempt-${callCount}`));
        if (callCount < 2) {
          child.emit('exit', 1, null);
        } else {
          child.emit('exit', 0, null);
        }
      });
      return child;
    };

    await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    await sleepMs(50); // let streams flush

    const outPath = path.join(reviewerDir, 'output.txt');
    const errPath = path.join(reviewerDir, 'error.txt');
    const out = fs.readFileSync(outPath, 'utf8');
    const err = fs.readFileSync(errPath, 'utf8');

    // Should contain only the last attempt's data
    assert.ok(out.includes('stdout-attempt-2'), `output.txt should have attempt 2 data, got: ${out}`);
    assert.ok(!out.includes('stdout-attempt-1'), `output.txt should NOT have attempt 1 data, got: ${out}`);
    assert.ok(err.includes('stderr-attempt-2'), `error.txt should have attempt 2 data, got: ${err}`);
  });

  it('includes attempt field in final status.json', async () => {
    let callCount = 0;
    const spawnFactory = () => {
      callCount++;
      const { child } = fakeChild();
      if (callCount === 1) {
        process.nextTick(() => child.emit('exit', 1, null));
      } else {
        process.nextTick(() => child.emit('exit', 0, null));
      }
      return child;
    };

    await runWithRetry({
      ...makeOpts(),
      spawnFn: spawnFactory,
      sleepFn: () => Promise.resolve(),
    });

    const statusPath = path.join(reviewerDir, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(status.attempt, 1);
    assert.equal(status.state, 'done');
  });
});

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('MAX_RETRIES is 2', () => {
    assert.equal(MAX_RETRIES, 2);
  });

  it('BASE_DELAY_MS is 1000', () => {
    assert.equal(BASE_DELAY_MS, 1000);
  });
});

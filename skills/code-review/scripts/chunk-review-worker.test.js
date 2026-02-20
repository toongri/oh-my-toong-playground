#!/usr/bin/env node

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  splitCommand,
  atomicWriteJson,
  runOnce,
  runWithRetry,
  sleepMs,
  assemblePrompt,
  MAX_RETRIES,
  BASE_DELAY_MS,
} = require('./chunk-review-worker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-worker-test-'));
}

function setupJobDir(tmpDir) {
  const reviewer = 'test-reviewer';
  const safeReviewer = 'test-reviewer';
  const jobDir = path.join(tmpDir, 'job');
  const reviewerDir = path.join(jobDir, 'reviewers', safeReviewer);
  fs.mkdirSync(reviewerDir, { recursive: true });
  const statusPath = path.join(reviewerDir, 'status.json');
  const outPath = path.join(reviewerDir, 'output.txt');
  const errPath = path.join(reviewerDir, 'error.txt');
  return { jobDir, reviewer, safeReviewer, reviewerDir, statusPath, outPath, errPath };
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
  let paths;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes prompt to child stdin instead of passing as CLI argument', async () => {
    const result = await runOnce({
      program: 'cat',
      args: [],
      prompt: 'hello from stdin',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'cat',
      timeoutSec: 5,
      attempt: 0,
    });

    assert.equal(result.state, 'done');
    const output = await waitForFileContent(paths.outPath, 'hello from stdin');
    assert.ok(output.includes('hello from stdin'), `expected prompt in output, got: ${output}`);
  });

  it('handles stdin pipe errors gracefully', async () => {
    const result = await runOnce({
      program: 'echo',
      args: ['fixed-output'],
      prompt: 'THIS_SHOULD_NOT_APPEAR',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'echo fixed-output',
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

  it('returns done state on exit code 0', async () => {
    const result = await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'done');
    assert.equal(result.exitCode, 0);
  });

  it('returns error state on non-zero exit code', async () => {
    const result = await runOnce({
      program: 'false',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'false',
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'error');
    assert.equal(result.exitCode, 1);
  });

  it('returns missing_cli state on ENOENT error', async () => {
    const result = await runOnce({
      program: 'nonexistent-command-xyz-abc-123',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'nonexistent-command-xyz-abc-123',
      timeoutSec: 0,
      attempt: 0,
    });
    assert.equal(result.state, 'missing_cli');
  });

  it('returns timed_out state when timeout triggers', async () => {
    const result = await runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sleep 60',
      timeoutSec: 0.2,
      attempt: 0,
    });
    assert.equal(result.state, 'timed_out');
  });

  it('returns canceled state on SIGTERM without timeout', async () => {
    const resultPromise = runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
    assert.ok(pid, 'should have obtained pid from status.json');
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }

    const result = await resultPromise;
    assert.equal(result.state, 'canceled');
  });

  it('includes attempt field in status.json', async () => {
    await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 2,
    });
    const status = readStatus(paths.statusPath);
    assert.equal(status.attempt, 2);
  });

  it('writes status.json to reviewerDir', async () => {
    await runOnce({
      program: 'true',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 0,
    });
    const status = readStatus(paths.statusPath);
    assert.equal(status.state, 'done');
    assert.equal(status.attempt, 0);
    assert.equal(status.reviewer, paths.reviewer);
  });

  it('writes output.txt and error.txt', async () => {
    await runOnce({
      program: 'sh',
      args: ['-c', 'echo stdout-data; echo stderr-data >&2'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sh -c "echo stdout-data; echo stderr-data >&2"',
      timeoutSec: 5,
      attempt: 0,
    });

    const out = await waitForFileContent(paths.outPath, 'stdout-data');
    const err = await waitForFileContent(paths.errPath, 'stderr-data');
    assert.ok(out.includes('stdout-data'), `expected 'stdout-data' in output, got: ${out}`);
    assert.ok(err.includes('stderr-data'), `expected 'stderr-data' in error, got: ${err}`);
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

  it('succeeds without retry on first exit 0', async () => {
    const result = await runWithRetry({
      program: 'true',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 5,
    });

    assert.equal(result.state, 'done');
    assert.equal(result.attempt, 0);
  });

  it('retries on error and succeeds on second attempt', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker');
    const result = await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'done');
    assert.equal(result.attempt, 1);
  });

  it('exhausts all retries and returns final error', async () => {
    const result = await runWithRetry({
      program: 'false',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'false',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'error');
    assert.equal(result.attempt, 2); // 0, 1, 2 = 3 attempts
  });

  it('does NOT retry on missing_cli (ENOENT)', async () => {
    const result = await runWithRetry({
      program: 'nonexistent-command-xyz-abc-123',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'nonexistent-command-xyz-abc-123',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'missing_cli');
    assert.equal(result.attempt, 0);
  });

  it('does NOT retry on timed_out', async () => {
    const result = await runWithRetry({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sleep 60',
      timeoutSec: 0.2,
      sleepFn: () => Promise.resolve(),
    });

    assert.equal(result.state, 'timed_out');
    assert.equal(result.attempt, 0);
  });

  it('does NOT retry on canceled', async () => {
    const resultPromise = runWithRetry({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
    assert.ok(pid, 'should have obtained pid from status.json');
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }

    const result = await resultPromise;
    assert.equal(result.state, 'canceled');
    assert.equal(result.attempt, 0);
  });

  it('applies exponential backoff with jitter between retries', async () => {
    const delays = [];

    await runWithRetry({
      program: 'false',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'false',
      timeoutSec: 5,
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
    const markerFile = path.join(tmpDir, 'attempt-marker2');
    const result = await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then echo attempt2 && exit 0; else touch "${markerFile}" && echo attempt1 && exit 1; fi`],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    const out = await waitForFileContent(paths.outPath, 'attempt2');
    assert.ok(out.includes('attempt2'), `expected 'attempt2' in output, got: ${out}`);
    assert.ok(!out.includes('attempt1'), `should not contain 'attempt1', got: ${out}`);
  });

  it('includes attempt field in final status.json', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker3');
    await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    const status = readStatus(paths.statusPath);
    assert.equal(status.attempt, 1);
    assert.equal(status.state, 'done');
  });

  it('writes retrying status before backoff sleep', async () => {
    const markerFile = path.join(tmpDir, 'attempt-marker-retrying');
    let capturedStatus = null;

    const sleepFn = async () => {
      capturedStatus = readStatus(paths.statusPath);
    };

    await runWithRetry({
      program: 'sh',
      args: ['-c', `if [ -f "${markerFile}" ]; then exit 0; else touch "${markerFile}"; exit 1; fi`],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'sh -c marker-script',
      timeoutSec: 5,
      sleepFn,
    });

    assert.ok(capturedStatus, 'sleepFn should have been called and captured status');
    assert.equal(capturedStatus.state, 'retrying');
    assert.equal(capturedStatus.attempt, 1);
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

// ---------------------------------------------------------------------------
// assemblePrompt() tests
// ---------------------------------------------------------------------------

describe('assemblePrompt', () => {
  let tmpDir;
  let promptsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns structured prompt with REVIEW CONTENT when role file exists and reviewContent provided', () => {
    fs.writeFileSync(path.join(promptsDir, 'claude.md'), 'You are a reviewer.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
      reviewContent: 'function add(a,b) { return a+b; }',
    });

    assert.equal(result.isStructured, true);
    assert.ok(result.assembled.includes('You are a reviewer.'), 'should contain role prompt');
    assert.ok(result.assembled.includes('--- REVIEW CONTENT ---'), 'should contain REVIEW CONTENT header');
    assert.ok(result.assembled.includes('function add(a,b) { return a+b; }'), 'should contain review content');
    assert.ok(result.assembled.includes('--- END REVIEW CONTENT ---'), 'should contain END REVIEW CONTENT');
    assert.ok(result.assembled.includes('Review this code'), 'should contain raw prompt');
    assert.ok(result.assembled.includes('<system-instructions>'), 'should contain system-instructions tag');
    assert.ok(result.assembled.includes('[HEADLESS SESSION]'), 'should contain headless enforcement');
  });

  it('returns structured prompt without REVIEW CONTENT when role file exists but no reviewContent', () => {
    fs.writeFileSync(path.join(promptsDir, 'claude.md'), 'You are a reviewer.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
    });

    assert.equal(result.isStructured, true);
    assert.ok(result.assembled.includes('You are a reviewer.'), 'should contain role prompt');
    assert.ok(!result.assembled.includes('--- REVIEW CONTENT ---'), 'should NOT contain REVIEW CONTENT header');
    assert.ok(result.assembled.includes('Review this code'), 'should contain raw prompt');
  });

  it('returns rawPrompt with isStructured=false when role file does not exist', () => {
    const result = assemblePrompt({
      promptsDir,
      entityName: 'nonexistent',
      rawPrompt: 'Review this code',
    });

    assert.equal(result.isStructured, false);
    assert.equal(result.assembled, 'Review this code');
  });

  it('returns rawPrompt with isStructured=false when role file missing even with reviewContent', () => {
    const result = assemblePrompt({
      promptsDir,
      entityName: 'nonexistent',
      rawPrompt: 'Review this code',
      reviewContent: 'some content to review',
    });

    assert.equal(result.isStructured, false);
    assert.equal(result.assembled, 'Review this code');
  });

  // NEW: reviewer.md fallback test
  it('falls back to reviewer.md when entity-specific file not found', () => {
    // Only create reviewer.md, not claude.md
    fs.writeFileSync(path.join(promptsDir, 'reviewer.md'), 'You are a generic reviewer.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
    });

    assert.equal(result.isStructured, true);
    assert.ok(result.assembled.includes('You are a generic reviewer.'), 'should contain reviewer.md content');
    assert.ok(result.assembled.includes('Review this code'), 'should contain raw prompt');
    assert.ok(result.assembled.includes('<system-instructions>'), 'should contain system-instructions tag');
  });

  it('prefers entity-specific file over reviewer.md fallback', () => {
    fs.writeFileSync(path.join(promptsDir, 'claude.md'), 'Claude-specific instructions.', 'utf8');
    fs.writeFileSync(path.join(promptsDir, 'reviewer.md'), 'Generic reviewer instructions.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
    });

    assert.equal(result.isStructured, true);
    assert.ok(result.assembled.includes('Claude-specific instructions.'), 'should use entity-specific file');
    assert.ok(!result.assembled.includes('Generic reviewer instructions.'), 'should NOT use reviewer.md fallback');
  });

  it('returns unstructured when neither entity file nor reviewer.md exists', () => {
    // No files created in promptsDir

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
    });

    assert.equal(result.isStructured, false);
    assert.equal(result.assembled, 'Review this code');
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
    // Allow async stream cleanup to complete before removing tmpDir
    await sleepMs(50);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error state when spawnFn throws synchronously', async () => {
    const throwingSpawn = () => { throw new Error('spawn failed'); };

    const result = await runOnce({
      program: 'anything',
      args: [],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'anything',
      timeoutSec: 0,
      attempt: 0,
      spawnFn: throwingSpawn,
    });

    assert.equal(result.state, 'error');
    assert.ok(result.message.includes('spawn failed'), `expected 'spawn failed' in message, got: ${result.message}`);

    const status = readStatus(paths.statusPath);
    assert.equal(status.state, 'error');
    assert.ok(status.message.includes('spawn failed'));
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

  it('returns error state (not canceled) when process killed with SIGKILL', async () => {
    const resultPromise = runOnce({
      program: 'sleep',
      args: ['60'],
      prompt: '',
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
    assert.ok(pid, 'should have obtained pid from status.json');
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }

    const result = await resultPromise;
    assert.equal(result.state, 'error', 'SIGKILL should produce error, not canceled');
    assert.equal(result.exitCode, null, 'exitCode should be null for signal kill');
    assert.equal(result.signal, 'SIGKILL', 'signal should be SIGKILL');
  });
});

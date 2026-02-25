#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  splitCommand,
  atomicWriteJson,
  runOnce,
  runWithRetry,
  sleepMs,
  assemblePrompt,
  MAX_RETRIES,
  BASE_DELAY_MS,
} from './spec-review-worker.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
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

// ---------------------------------------------------------------------------
// splitCommand() tests
// ---------------------------------------------------------------------------

describe('splitCommand', () => {
  test('splits simple space-separated tokens', () => {
    expect(splitCommand('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });

  test('handles single-quoted strings', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  test('handles double-quoted strings', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  test('handles escaped characters', () => {
    expect(splitCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  test('returns empty array for empty string', () => {
    expect(splitCommand('')).toEqual([]);
  });

  test('returns null for null/undefined input', () => {
    expect(splitCommand(null)).toEqual([]);
    expect(splitCommand(undefined)).toEqual([]);
  });

  test('returns null for unmatched single quote', () => {
    expect(splitCommand("echo 'hello")).toBe(null);
  });

  test('returns null for unmatched double quote', () => {
    expect(splitCommand('echo "hello')).toBe(null);
  });

  test('handles multiple spaces between tokens', () => {
    expect(splitCommand('echo   hello   world')).toEqual(['echo', 'hello', 'world']);
  });

  test('handles mixed quotes', () => {
    expect(splitCommand(`echo "hello 'world'"`)).toEqual(['echo', "hello 'world'"]);
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

  test('writes valid JSON to the target path', () => {
    const filePath = path.join(tmpDir, 'test.json');
    const payload = { state: 'done', exitCode: 0 };
    atomicWriteJson(filePath, payload);
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(result).toEqual(payload);
  });

  test('overwrites existing file atomically', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { v: 1 });
    atomicWriteJson(filePath, { v: 2 });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(result.v).toBe(2);
  });

  test('formats JSON with 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { a: 1 });
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  test('does not leave tmp files on success', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { ok: true });
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe('test.json');
  });
});

// ---------------------------------------------------------------------------
// sleepMs() tests
// ---------------------------------------------------------------------------

describe('sleepMs', () => {
  test('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleepMs(50);
    const elapsed = Date.now() - start;
    expect(elapsed >= 40).toBe(true);
  });

  test('returns a promise', () => {
    const result = sleepMs(1);
    expect(result instanceof Promise).toBeTruthy();
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

  test('writes prompt to child stdin instead of passing as CLI argument', async () => {
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

    expect(result.state).toBe('done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(output.includes('hello from stdin')).toBe(true);
  });

  test('handles stdin pipe errors gracefully', async () => {
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 0,
      attempt: 0,
    });
    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('done');
    expect(status.attempt).toBe(0);
    expect(status.reviewer).toBe(paths.reviewer);
  });

  test('writes output.txt and error.txt', async () => {
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
      command: 'false',
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    });

    expect(result.state).toBe('error');
    expect(result.attempt).toBe(2); // 0, 1, 2 = 3 attempts
  });

  test('does NOT retry on missing_cli (ENOENT)', async () => {
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

    expect(result.state).toBe('missing_cli');
    expect(result.attempt).toBe(0);
  });

  test('does NOT retry on timed_out', async () => {
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

    expect(result.state).toBe('timed_out');
    expect(result.attempt).toBe(0);
  });

  test('does NOT retry on canceled', async () => {
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
    expect(delays.length).toBe(2);

    // First delay: BASE_DELAY_MS * 2^0 + jitter(0~BASE_DELAY_MS) = 1000..2000
    expect(delays[0] >= BASE_DELAY_MS).toBe(true);
    expect(delays[0] < BASE_DELAY_MS * 3).toBe(true);

    // Second delay: BASE_DELAY_MS * 2^1 + jitter(0~BASE_DELAY_MS) = 2000..3000
    expect(delays[1] >= BASE_DELAY_MS * 2).toBe(true);
    expect(delays[1] < BASE_DELAY_MS * 4).toBe(true);
  });

  test('overwrites output.txt and error.txt on retry', async () => {
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

    const out = fs.readFileSync(paths.outPath, 'utf8');
    expect(out.includes('attempt2')).toBe(true);
    expect(!out.includes('attempt1')).toBe(true);
  });

  test('includes attempt field in final status.json', async () => {
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
// Constants tests
// ---------------------------------------------------------------------------

describe('constants', () => {
  test('MAX_RETRIES is 2', () => {
    expect(MAX_RETRIES).toBe(2);
  });

  test('BASE_DELAY_MS is 1000', () => {
    expect(BASE_DELAY_MS).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt() tests (H-2)
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

  test('returns structured prompt with REVIEW CONTENT when role file exists and reviewContent provided', () => {
    fs.writeFileSync(path.join(promptsDir, 'claude.md'), 'You are a reviewer.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
      reviewContent: 'function add(a,b) { return a+b; }',
    });

    expect(result.isStructured).toBe(true);
    expect(result.assembled.includes('You are a reviewer.')).toBe(true);
    expect(result.assembled.includes('--- REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('function add(a,b) { return a+b; }')).toBe(true);
    expect(result.assembled.includes('--- END REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('Review this code')).toBe(true);
    expect(result.assembled.includes('<system-instructions>')).toBe(true);
    expect(result.assembled.includes('[HEADLESS SESSION]')).toBe(true);
  });

  test('returns structured prompt without REVIEW CONTENT when role file exists but no reviewContent', () => {
    fs.writeFileSync(path.join(promptsDir, 'claude.md'), 'You are a reviewer.', 'utf8');

    const result = assemblePrompt({
      promptsDir,
      entityName: 'claude',
      rawPrompt: 'Review this code',
    });

    expect(result.isStructured).toBe(true);
    expect(result.assembled.includes('You are a reviewer.')).toBe(true);
    expect(!result.assembled.includes('--- REVIEW CONTENT ---')).toBe(true);
    expect(result.assembled.includes('Review this code')).toBe(true);
  });

  test('returns rawPrompt with isStructured=false when role file does not exist', () => {
    const result = assemblePrompt({
      promptsDir,
      entityName: 'nonexistent',
      rawPrompt: 'Review this code',
    });

    expect(result.isStructured).toBe(false);
    expect(result.assembled).toBe('Review this code');
  });

  test('returns rawPrompt with isStructured=false when role file missing even with reviewContent', () => {
    const result = assemblePrompt({
      promptsDir,
      entityName: 'nonexistent',
      rawPrompt: 'Review this code',
      reviewContent: 'some content to review',
    });

    expect(result.isStructured).toBe(false);
    expect(result.assembled).toBe('Review this code');
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
      reviewer: paths.reviewer,
      reviewerDir: paths.reviewerDir,
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
    expect(pid).toBeTruthy();
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }

    const result = await resultPromise;
    expect(result.state).toBe('error');
    expect(result.exitCode).toBe(null);
    expect(result.signal).toBe('SIGKILL');
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
      reviewer: 'claude',
      reviewerDir: paths.reviewerDir,
      command: 'true',
      timeoutSec: 5,
      attempt: 0,
    });

    expect(result.state).toBe('done');
    const assembledPath = path.join(paths.reviewerDir, 'assembled-prompt.txt');
    expect(fs.existsSync(assembledPath)).toBe(true);
    const content = fs.readFileSync(assembledPath, 'utf8');
    expect(content.includes('test prompt')).toBe(true);
    expect(content.includes('<system-instructions>')).toBe(true);
  });
});

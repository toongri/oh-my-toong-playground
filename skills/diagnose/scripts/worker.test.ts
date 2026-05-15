#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { runOnce, runWithRetry } from './worker.ts';

type WorkerResult = {
  state: string;
  member?: string;
  command?: string;
  attempt?: number;
  exitCode?: number | null;
  signal?: string | null;
  message?: string | null;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diagnose-worker-test-'));
}

function setupJobDir(tmpDir: string, { prompt = 'test prompt' }: { prompt?: string } = {}) {
  const jobDir = path.join(tmpDir, 'job');
  // diagnose uses 'reviewers/' not 'members/'
  const reviewerDir = path.join(jobDir, 'reviewers', 'test-reviewer');
  fs.mkdirSync(reviewerDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), prompt, 'utf8');
  return {
    jobDir,
    reviewerDir,
    statusPath: path.join(reviewerDir, 'status.json'),
    outPath: path.join(reviewerDir, 'output.txt'),
  };
}

function readStatus(statusPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Happy path: opencode success → state=done
// ---------------------------------------------------------------------------

describe('runOnce - happy path', () => {
  let tmpDir: string;
  let paths: ReturnType<typeof setupJobDir>;

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
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    }) as WorkerResult;

    expect(result.state).toBe('done');
    expect(result.exitCode).toBe(0);
  });

  test('writes status.json with state=done on success', async () => {
    await runOnce({
      command: 'true',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });

    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('done');
    expect(status.member).toBe('opencode');
  });

  test('passes prompt via stdin and captures output', async () => {
    const result = await runOnce({
      command: 'cat',
      prompt: 'diagnose this',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      attempt: 0,
    }) as WorkerResult;

    expect(result.state).toBe('done');
    const output = fs.readFileSync(paths.outPath, 'utf8');
    expect(output).toBe('diagnose this');
  });
});

// ---------------------------------------------------------------------------
// Fallback branch: opencode missing → state=missing_cli
// ---------------------------------------------------------------------------

describe('runOnce - fallback: opencode missing (ENOENT / missing_cli)', () => {
  let tmpDir: string;
  let paths: ReturnType<typeof setupJobDir>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns missing_cli when opencode binary does not exist', async () => {
    const result = await runOnce({
      command: 'opencode-nonexistent-binary-xyz',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    }) as WorkerResult;

    // ENOENT on spawn → missing_cli
    expect(result.state).toBe('missing_cli');
  });

  test('writes status.json with state=missing_cli when cli absent', async () => {
    await runOnce({
      command: 'opencode-nonexistent-binary-xyz',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 0,
      attempt: 0,
    });

    const status = readStatus(paths.statusPath);
    expect(status.state).toBe('missing_cli');
  });
});

// ---------------------------------------------------------------------------
// Fallback branch: timed_out
// ---------------------------------------------------------------------------

describe('runOnce - fallback: timed_out', () => {
  let tmpDir: string;
  let paths: ReturnType<typeof setupJobDir>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns timed_out when process exceeds timeout', async () => {
    const result = await runOnce({
      command: 'sleep 60',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 0.2,
      attempt: 0,
    }) as WorkerResult;

    expect(result.state).toBe('timed_out');
  });
});

// ---------------------------------------------------------------------------
// runWithRetry - opencode success without retry
// ---------------------------------------------------------------------------

describe('runWithRetry - opencode happy path', () => {
  let tmpDir: string;
  let paths: ReturnType<typeof setupJobDir>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    paths = setupJobDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('succeeds on first attempt with state=done', async () => {
    const result = await runWithRetry({
      command: 'true',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 5,
    }) as WorkerResult;

    expect(result.state).toBe('done');
    expect(result.attempt).toBe(0);
  });

  test('does not retry on missing_cli', async () => {
    const result = await runWithRetry({
      command: 'opencode-nonexistent-binary-xyz',
      prompt: '',
      member: 'opencode',
      safeMember: 'test-reviewer',
      jobDir: paths.jobDir,
      timeoutSec: 5,
      sleepFn: () => Promise.resolve(),
    }) as WorkerResult;

    // missing_cli is terminal — no retry
    expect(result.state).toBe('missing_cli');
    expect(result.attempt).toBe(0);
  });
});

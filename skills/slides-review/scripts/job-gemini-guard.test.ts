#!/usr/bin/env bun
/**
 * TDD: gemini pre-check in resume-member.
 *
 * RED test: with a gemini fixture status.json, resume-member should exit non-zero
 * and print a skill-aware error containing 'slides-review', 'gemini', 'no driver'.
 *
 * Hermetic: registered-driver fixtures (opencode/claude) would otherwise have resume-member
 * spawn the real authenticated CLI. A fake bin dir is prepended to PATH so the downstream
 * spawn resolves to a no-op exit-0 stub instead of the real binary — keeping `bun test`
 * deterministic and offline.
 *
 * Must NOT modify job.test.ts (T5 territory).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const SCRIPT = path.join(import.meta.dirname, 'job.ts');

function makeJobDir(command: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'slides-review-test-'));
  const reviewersDir = path.join(dir, 'reviewers', 'gemini');
  fs.mkdirSync(reviewersDir, { recursive: true });

  // Minimal status.json with a fake sessionID to pass the no-session check
  const status = {
    state: 'stop',
    sessionID: 'fake-session-id',
    command,
    resume_count: 0,
    workerEnv: {},
  };
  fs.writeFileSync(path.join(reviewersDir, 'status.json'), JSON.stringify(status), 'utf8');

  // Minimal job.json
  const jobMeta = {
    id: 'slides-review-test',
    createdAt: new Date().toISOString(),
    settings: { timeoutSec: 60 },
    members: [{ name: 'gemini', command }],
  };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobMeta), 'utf8');

  return dir;
}

function makeJobDirForMember(memberName: string, command: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'slides-review-test-'));
  const memberDir = path.join(dir, 'reviewers', memberName);
  fs.mkdirSync(memberDir, { recursive: true });

  const status = {
    state: 'stop',
    sessionID: 'fake-session-id',
    command,
    resume_count: 0,
    workerEnv: {},
  };
  fs.writeFileSync(path.join(memberDir, 'status.json'), JSON.stringify(status), 'utf8');

  const jobMeta = {
    id: 'slides-review-test',
    createdAt: new Date().toISOString(),
    settings: { timeoutSec: 60 },
    members: [{ name: memberName, command }],
  };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobMeta), 'utf8');

  return dir;
}

let geminiDir: string;
let claudeDir: string;
let opencodeDir: string;
let fakeBinDir: string;

beforeAll(() => {
  // Fake CLI stubs prepended to PATH: resume-member's downstream spawn resolves these no-op
  // exit-0 binaries instead of the real authenticated opencode/claude CLIs.
  fakeBinDir = fs.mkdtempSync(path.join(tmpdir(), 'slides-review-fakebin-'));
  for (const bin of ['opencode', 'claude']) {
    fs.writeFileSync(path.join(fakeBinDir, bin), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  geminiDir = makeJobDir('gemini');
  claudeDir = makeJobDir('claude');
  opencodeDir = makeJobDirForMember('opencode', 'opencode');
});

afterAll(() => {
  for (const d of [geminiDir, claudeDir, opencodeDir, fakeBinDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function runResumeMember(jobDir: string, member: string, prompt: string): { exitCode: number; stderr: string } {
  try {
    execFileSync(process.execPath, [SCRIPT, 'resume-member', jobDir, member, prompt], {
      stdio: 'pipe',
      env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    return { exitCode: 0, stderr: '' };
  } catch (e: any) {
    return { exitCode: e.status ?? 1, stderr: e.stderr?.toString() ?? '' };
  }
}

describe('resume-member gemini pre-check', () => {
  test('gemini fixture: exits non-zero with skill-aware error containing all 3 keywords', () => {
    const { exitCode, stderr } = runResumeMember(geminiDir, 'gemini', 'follow-up');

    expect(exitCode).not.toBe(0);
    // Skill-aware error from cmdResumeMember (generic-job) with skillName='slides-review'.
    expect(stderr).toContain('slides-review');
    expect(stderr).toContain('gemini');
    expect(stderr).toContain('no driver');
    expect(stderr).toContain('implement driver or change default member');
  });

  test('happy path: registered cliType reaches cmdResumeMember beyond driver gate', () => {
    // opencode is a registered driver: the driver gate is passed and the faked CLI is spawned.
    // The assertion only checks the gate is cleared — no 'no driver' error is emitted.
    const { stderr } = runResumeMember(opencodeDir, 'opencode', 'test prompt');

    expect(stderr).not.toContain('no driver for');
    expect(stderr).not.toContain('slides-review: no driver');
  });

  test('claude fixture: does NOT trigger the gemini guard (passes the driver gate)', () => {
    const { stderr } = runResumeMember(claudeDir, 'gemini', 'follow-up');

    // The claude path is a registered driver, so the gemini guard must not fire.
    expect(stderr).not.toContain('no driver for gemini');
    expect(stderr).not.toContain('slides-review default member is gemini');
  });
});

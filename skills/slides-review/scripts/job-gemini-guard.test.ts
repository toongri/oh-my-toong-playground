#!/usr/bin/env bun
/**
 * TDD: gemini pre-check in resume-member.
 *
 * RED test: with a gemini fixture status.json, resume-member should exit non-zero
 * and print a skill-aware error containing 'slides-review', 'gemini', 'no driver'.
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

const geminiDir = makeJobDir('gemini');
const claudeDir = makeJobDir('claude');

afterAll(() => {
  try { fs.rmSync(geminiDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(claudeDir, { recursive: true, force: true }); } catch {}
});

describe('resume-member gemini pre-check', () => {
  test('gemini fixture: exits non-zero with skill-aware error containing all 3 keywords', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member', geminiDir, 'gemini', 'follow-up'], {
        stdio: 'pipe',
      });
    } catch (e: any) {
      exitCode = e.status;
      stderr = e.stderr?.toString() || '';
    }

    expect(exitCode).not.toBe(0);
    // Skill-aware error from cmdResumeMember (generic-job) with skillName='slides-review'.
    expect(stderr).toContain('slides-review');
    expect(stderr).toContain('gemini');
    expect(stderr).toContain('no driver');
    expect(stderr).toContain('implement driver or change default member');
  });

  test('claude fixture: does NOT trigger the gemini guard (exits with a different error)', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member', claudeDir, 'gemini', 'follow-up'], {
        stdio: 'pipe',
      });
    } catch (e: any) {
      exitCode = e.status;
      stderr = e.stderr?.toString() || '';
    }

    // The claude path should NOT produce the gemini guard message.
    // It will fail for a different reason (no actual claude CLI), but not with the guard.
    expect(stderr).not.toContain('no driver for gemini');
    // Must NOT contain the skill-aware guard message
    expect(stderr).not.toContain('slides-review default member is gemini');
  });
});

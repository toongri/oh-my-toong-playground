/**
 * E2E test: caller-controlled retry mechanism (cmdResumeMember).
 *
 * Validates that the wire works end-to-end:
 *   status.json (sessionID, command, state) → cmdResumeMember
 *     → resumeOneTurnFn injection → output.txt overwrite + resume_count increment.
 *
 * LLM-free: no real CLI processes are spawned. All external calls are mocked.
 *
 * Production failure context: chunk-review-2026-05-15-0913-88f32f — chairman
 * received narrative-only output without verdict; new design lets chairman LLM
 * decide to retry via resume-member sub-command. These tests validate the wire.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cmdResumeMember } from '../skills/orchestrate-review/scripts/job.ts';
import { atomicWriteJson } from '@lib/job-utils';
import type { RunOneTurnOpts, OneTurnResult } from './worker-utils.ts';
import type { AgentDriver } from './agent-drivers/types.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let jobDir: string;
let memberDir: string;

/** Minimal stub AgentDriver — only needed to pass the driver-null guard in cmdResumeMember. */
const stubDriver: AgentDriver = {
  cli: 'opencode',
  initialCommand: () => ({ program: 'opencode', args: [], env: {} }),
  resumeCommand: () => ({ program: 'opencode', args: [], env: {} }),
  parseStdout: () => null,
};

const mockDriverFactory = (_cliType: string): AgentDriver | null => stubDriver;

/**
 * Mock resumeOneTurnFn:
 * - Writes 'follow-up complete' to memberDir/output.txt (mirrors real resumeOneTurn behavior)
 * - Returns OneTurnResult indicating success
 */
const mockResumeFn = async (
  _sessionID: string,
  opts: RunOneTurnOpts,
): Promise<OneTurnResult> => {
  writeFileSync(join(opts.memberDir, 'output.txt'), 'follow-up complete', 'utf8');
  return { state: 'done', sessionID: 'ses_x', text: 'follow-up complete', exitCode: 0 };
};

beforeEach(() => {
  jobDir = mkdtempSync(join(tmpdir(), 'chairman-flow-e2e-'));
  memberDir = join(jobDir, 'members', 'gpt');
  mkdirSync(memberDir, { recursive: true });

  // Seed status.json — mirrors the production failure case shape
  atomicWriteJson(join(memberDir, 'status.json'), {
    member: 'gpt',
    state: 'done',
    sessionID: 'ses_x',
    resume_count: 0,
    command: 'opencode run --format json --session ses_x',
    exitCode: 0,
  });

  // Seed output.txt with narrative-only content (no verdict)
  writeFileSync(join(memberDir, 'output.txt'), 'narrative without verdict', 'utf8');
});

afterEach(() => {
  rmSync(jobDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chairman retry wire (AC-H6)', () => {
  it('resume-member sub-command exit 0', async () => {
    // AC-H6a: cmdResumeMember completes without throwing (= exit 0 semantically)
    await expect(
      cmdResumeMember(jobDir, 'gpt', 'follow up?', {
        driverFactory: mockDriverFactory,
        resumeOneTurnFn: mockResumeFn,
      }),
    ).resolves.toBeUndefined();
  });

  it('resume_count == 1 after sub-command', async () => {
    // AC-H6b: resume_count in status.json is incremented to 1
    await cmdResumeMember(jobDir, 'gpt', 'follow up?', {
      driverFactory: mockDriverFactory,
      resumeOneTurnFn: mockResumeFn,
    });

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8')) as Record<string, unknown>;
    expect(status.resume_count).toBe(1);
  });

  it('output.txt contains follow-up complete', async () => {
    // AC-H6c: output.txt is overwritten by mock (mirroring real resumeOneTurn)
    await cmdResumeMember(jobDir, 'gpt', 'follow up?', {
      driverFactory: mockDriverFactory,
      resumeOneTurnFn: mockResumeFn,
    });

    const content = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(content.includes('follow-up complete')).toBe(true);
  });
});

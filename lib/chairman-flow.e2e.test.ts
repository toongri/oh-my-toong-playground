/**
 * E2E test: caller-controlled retry mechanism (cmdResumeMember).
 *
 * Validates the FULL wire end-to-end (P2-4 fix):
 *   status.json (sessionID, command, state) → cmdResumeMember
 *     → default resumeOneTurn → driver.resumeCommand → runOnceFn injection
 *     → executeOneTurn → driver.parseStdout → status.json/output.txt write.
 *
 * LLM-free: no real CLI processes are spawned. runOnceFn is mocked at the
 * primitive layer so the real resumeOneTurn → executeOneTurn path executes.
 *
 * Production failure context: chunk-review-2026-05-15-0913-88f32f — chairman
 * received narrative-only output without verdict; new design lets chairman LLM
 * decide to retry via resume-member sub-command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cmdResumeMember } from '../skills/orchestrate-review/scripts/job.ts';
import { atomicWriteJson } from '@lib/job-utils';
import type { RunOnceOpts } from './worker-utils.ts';
import type { AgentDriver } from './agent-drivers/types.ts';

let jobDir: string;
let memberDir: string;

/** Driver mock — parseStdout returns the parsed payload that executeOneTurn writes to output.txt. */
const mockDriverFactory = (_cliType: string): AgentDriver | null => ({
  cli: 'opencode',
  initialCommand: (opts) => ({ program: opts.baseCommand, args: opts.baseArgs, env: opts.workerEnv }),
  resumeCommand: (opts) => ({ program: opts.baseCommand, args: opts.baseArgs, env: opts.workerEnv }),
  parseStdout: () => ({ sessionID: 'ses_x', terminal: 'stop', text: 'follow-up complete', rawEvents: [] }),
});

/** runOnce mock — writes raw stdout to output.txt and returns success. Mirrors real runOnce contract. */
const mockRunOnceFn = async (opts: RunOnceOpts): Promise<Record<string, unknown>> => {
  writeFileSync(join(opts.memberDir, 'output.txt'), 'raw-ndjson-stub', 'utf8');
  writeFileSync(join(opts.memberDir, 'error.txt'), '', 'utf8');
  return { state: 'done', exitCode: 0, member: opts.member, command: opts.command, attempt: 0 };
};

beforeEach(() => {
  jobDir = mkdtempSync(join(tmpdir(), 'chairman-flow-e2e-'));
  memberDir = join(jobDir, 'members', 'gpt');
  mkdirSync(memberDir, { recursive: true });

  atomicWriteJson(join(memberDir, 'status.json'), {
    member: 'gpt',
    state: 'done',
    sessionID: 'ses_x',
    resume_count: 0,
    command: 'opencode run --format json',
    exitCode: 0,
  });

  writeFileSync(join(memberDir, 'output.txt'), 'narrative without verdict', 'utf8');
});

afterEach(() => {
  rmSync(jobDir, { recursive: true, force: true });
});

describe('chairman retry wire (AC-H6) — real resumeOneTurn path', () => {
  it('cmdResumeMember completes via real resumeOneTurn', async () => {
    await expect(
      cmdResumeMember(jobDir, 'gpt', 'follow up?', {
        entitySingular: 'member',
        entityPlural: 'members',
        entityDirName: 'members',
        jobPrefix: 'chunk-review-',
        uiLabel: '[Chunk Review]',
        configTopLevelKey: 'chunk-review',
      }, {
        driverFactory: mockDriverFactory,
        runOnceFn: mockRunOnceFn,
      }),
    ).resolves.toBeUndefined();
  });

  it('resume_count == 1 after sub-command (reserve-before-await pattern)', async () => {
    await cmdResumeMember(jobDir, 'gpt', 'follow up?', {
      entitySingular: 'member',
      entityPlural: 'members',
      entityDirName: 'members',
      jobPrefix: 'chunk-review-',
      uiLabel: '[Chunk Review]',
      configTopLevelKey: 'chunk-review',
    }, {
      driverFactory: mockDriverFactory,
      runOnceFn: mockRunOnceFn,
    });

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8')) as Record<string, unknown>;
    expect(status.resume_count).toBe(1);
  });

  it('output.txt overwritten with driver.parseStdout text', async () => {
    await cmdResumeMember(jobDir, 'gpt', 'follow up?', {
      entitySingular: 'member',
      entityPlural: 'members',
      entityDirName: 'members',
      jobPrefix: 'chunk-review-',
      uiLabel: '[Chunk Review]',
      configTopLevelKey: 'chunk-review',
    }, {
      driverFactory: mockDriverFactory,
      runOnceFn: mockRunOnceFn,
    });

    // executeOneTurn overwrites output.txt with parsed.text ('follow-up complete'),
    // not the raw stdout that mockRunOnceFn wrote.
    const content = readFileSync(join(memberDir, 'output.txt'), 'utf8');
    expect(content).toBe('follow-up complete');
  });

  it('status.json carries sessionID from driver.parseStdout', async () => {
    await cmdResumeMember(jobDir, 'gpt', 'follow up?', {
      entitySingular: 'member',
      entityPlural: 'members',
      entityDirName: 'members',
      jobPrefix: 'chunk-review-',
      uiLabel: '[Chunk Review]',
      configTopLevelKey: 'chunk-review',
    }, {
      driverFactory: mockDriverFactory,
      runOnceFn: mockRunOnceFn,
    });

    const status = JSON.parse(readFileSync(join(memberDir, 'status.json'), 'utf8')) as Record<string, unknown>;
    expect(status.sessionID).toBe('ses_x');
  });
});

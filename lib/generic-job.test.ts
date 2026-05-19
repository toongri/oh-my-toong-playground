#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { JobConfig, CmdResultsHooks, ResumeMemberOpts } from './generic-job.ts';
import type { RunOneTurnOpts } from './worker-utils.ts';
import {
  detectCliType,
  buildAugmentedCommand,
  gcStaleJobs,
  computeStatus,
  buildUiPayload,
  buildManifest,
  parseYamlSimple,
  spawnWorkers,
  cmdWait,
  cmdResults,
  cmdStop,
  cmdClean,
  cmdCollect,
  cmdResumeMember,
} from './generic-job.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'generic-job-test-'));
}

const chunkReviewConfig: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'chunk-review-',
  uiLabel: '[Chunk Review]',
  configTopLevelKey: 'chunk-review',
};

const councilConfig: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'council-',
  uiLabel: '[Council]',
  configTopLevelKey: 'council',
};

const specReviewConfig: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'spec-review-',
  uiLabel: '[Spec Review]',
  configTopLevelKey: 'spec-review',
};

// ---------------------------------------------------------------------------
// exports presence
// ---------------------------------------------------------------------------

describe('module exports', () => {
  test('exports detectCliType', () => {
    expect(typeof detectCliType).toBe('function');
  });

  test('exports buildAugmentedCommand', () => {
    expect(typeof buildAugmentedCommand).toBe('function');
  });

  test('exports gcStaleJobs', () => {
    expect(typeof gcStaleJobs).toBe('function');
  });

  test('exports computeStatus', () => {
    expect(typeof computeStatus).toBe('function');
  });

  test('exports buildUiPayload', () => {
    expect(typeof buildUiPayload).toBe('function');
  });

  test('exports buildManifest', () => {
    expect(typeof buildManifest).toBe('function');
  });

  test('exports parseYamlSimple', () => {
    expect(typeof parseYamlSimple).toBe('function');
  });

  test('exports spawnWorkers', () => {
    expect(typeof spawnWorkers).toBe('function');
  });

  test('exports cmdWait', () => {
    expect(typeof cmdWait).toBe('function');
  });

  test('exports cmdResults', () => {
    expect(typeof cmdResults).toBe('function');
  });

  test('exports cmdStop', () => {
    expect(typeof cmdStop).toBe('function');
  });

  test('exports cmdClean', () => {
    expect(typeof cmdClean).toBe('function');
  });

  test('exports cmdCollect', () => {
    expect(typeof cmdCollect).toBe('function');
  });

  test('exports cmdResumeMember', () => {
    expect(typeof cmdResumeMember).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// detectCliType
// ---------------------------------------------------------------------------

describe('detectCliType', () => {
  test('returns "claude" for "claude -p"', () => {
    expect(detectCliType('claude -p')).toBe('claude');
  });

  test('returns "codex" for "codex exec"', () => {
    expect(detectCliType('codex exec')).toBe('codex');
  });

  test('returns "gemini" for bare "gemini"', () => {
    expect(detectCliType('gemini')).toBe('gemini');
  });

  test('returns "unknown" for unrecognized command', () => {
    expect(detectCliType('my-script')).toBe('unknown');
  });

  test('returns "unknown" for null', () => {
    expect(detectCliType(null)).toBe('unknown');
  });

  test('returns "unknown" for empty string', () => {
    expect(detectCliType('')).toBe('unknown');
  });

  test('returns "unknown" for undefined', () => {
    expect(detectCliType(undefined)).toBe('unknown');
  });

  test('returns "claude" when command has leading whitespace', () => {
    expect(detectCliType('  claude --model opus')).toBe('claude');
  });

  test('returns "claude" for "npx claude --model opus"', () => {
    expect(detectCliType('npx claude --model opus')).toBe('claude');
  });

  test('returns "gemini" for "bunx gemini"', () => {
    expect(detectCliType('bunx gemini')).toBe('gemini');
  });

  test('returns "codex" for "pnpm dlx codex"', () => {
    expect(detectCliType('pnpm dlx codex')).toBe('codex');
  });

  test('returns "unknown" when cli name appears after the 3rd token', () => {
    expect(detectCliType('echo hello claude')).toBe('unknown');
  });

  test('detects opencode', () => {
    expect(detectCliType('opencode run --agent foo')).toBe('opencode');
  });

  test('detects opencode via package runner', () => {
    expect(detectCliType('bunx opencode run')).toBe('opencode');
  });
});

// ---------------------------------------------------------------------------
// buildAugmentedCommand
// ---------------------------------------------------------------------------

describe('buildAugmentedCommand', () => {
  test('claude: appends --model and --output-format, sets env for effort_level', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: 'opus', effort_level: 'high', output_format: 'json' },
      'claude',
    );
    expect(result.command).toBe('claude -p --model opus --output-format json');
    expect(result.env).toEqual({ CLAUDECODE: '', CLAUDE_CODE_EFFORT_LEVEL: 'high' });
  });

  test('codex: appends -m, -c for effort, --json for output_format', () => {
    const result = buildAugmentedCommand(
      { command: 'codex exec', model: 'o3', effort_level: 'high', output_format: 'json' },
      'codex',
    );
    expect(result.command).toBe('codex exec -m o3 -c model_reasoning_effort=high --json');
    expect(result.env).toEqual({});
  });

  test('gemini: appends --model, ignores effort_level', () => {
    const result = buildAugmentedCommand(
      { command: 'gemini', model: 'gemini-2.5-pro', effort_level: 'high' },
      'gemini',
    );
    expect(result.command).toBe('gemini --model gemini-2.5-pro');
    expect(result.env).toEqual({});
  });

  test('gemini: appends --output-format for json', () => {
    const result = buildAugmentedCommand(
      { command: 'gemini', output_format: 'json' },
      'gemini',
    );
    expect(result.command).toBe('gemini --output-format json');
    expect(result.env).toEqual({});
  });

  test('claude: no fields — returns command unchanged with CLAUDECODE guard', () => {
    const result = buildAugmentedCommand({ command: 'claude -p' }, 'claude');
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('claude: falsy values (empty string, null) treated as absent', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: '', effort_level: null },
      'claude',
    );
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('claude: falsy values (undefined) treated as absent', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: undefined, effort_level: undefined, output_format: undefined },
      'claude',
    );
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('unknown CLI type: only appends --model, ignores effort and output_format', () => {
    const result = buildAugmentedCommand(
      { command: 'my-script', model: 'gpt-4', effort_level: 'high', output_format: 'json' },
      'unknown',
    );
    expect(result.command).toBe('my-script --model gpt-4');
    expect(result.env).toEqual({});
  });

  test('output_format "text" is ignored (no flag appended)', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', output_format: 'text' },
      'claude',
    );
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('codex output_format non-json still appends --json', () => {
    const result = buildAugmentedCommand(
      { command: 'codex exec', output_format: 'stream' },
      'codex',
    );
    expect(result.command).toBe('codex exec --json');
    expect(result.env).toEqual({});
  });

  test('claude: unsets CLAUDECODE env to prevent nested session error', () => {
    const result = buildAugmentedCommand({ command: 'claude -p' }, 'claude');
    expect(result.env.CLAUDECODE).toBe('');
  });

  test('non-claude: does not include CLAUDECODE in env', () => {
    const result = buildAugmentedCommand({ command: 'gemini' }, 'gemini');
    expect(result.env.CLAUDECODE as string | undefined).toBe(undefined);
  });

  test('opencode appends --variant for effort_level', () => {
    const result = buildAugmentedCommand(
      { command: 'opencode run', model: 'openai/gpt-5.5', effort_level: 'high' },
      'opencode',
    );
    expect(result.command).toBe('opencode run --model openai/gpt-5.5 --variant high');
    expect(result.env).toEqual({});
  });

  test('opencode without effort_level has no --variant', () => {
    const result = buildAugmentedCommand(
      { command: 'opencode run', model: 'openai/gpt-5.5' },
      'opencode',
    );
    expect(result.command).toBe('opencode run --model openai/gpt-5.5');
  });
});

// ---------------------------------------------------------------------------
// gcStaleJobs — parameterized by jobPrefix
// ---------------------------------------------------------------------------

describe('gcStaleJobs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('deletes chunk-review-* directories older than 1 hour (chunk-review prefix)', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const staleDir = path.join(jobsDir, 'chunk-review-stale-001');
    fs.mkdirSync(staleDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(staleDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-stale-001', createdAt: twoHoursAgo }),
    );

    gcStaleJobs(jobsDir, chunkReviewConfig);

    expect(fs.existsSync(staleDir)).toBe(false);
  });

  test('preserves chunk-review-* directories younger than 1 hour', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const freshDir = path.join(jobsDir, 'chunk-review-fresh-001');
    fs.mkdirSync(freshDir, { recursive: true });
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    fs.writeFileSync(
      path.join(freshDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-fresh-001', createdAt: fiveMinutesAgo }),
    );

    gcStaleJobs(jobsDir, chunkReviewConfig);

    expect(fs.existsSync(freshDir)).toBe(true);
  });

  test('skips directories with missing job.json', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const noJsonDir = path.join(jobsDir, 'chunk-review-nojson-001');
    fs.mkdirSync(noJsonDir, { recursive: true });

    gcStaleJobs(jobsDir, chunkReviewConfig);

    expect(fs.existsSync(noJsonDir)).toBe(true);
  });

  test('skips directories with malformed job.json', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const badJsonDir = path.join(jobsDir, 'chunk-review-badjson-001');
    fs.mkdirSync(badJsonDir, { recursive: true });
    fs.writeFileSync(path.join(badJsonDir, 'job.json'), '{{not valid json}}');

    gcStaleJobs(jobsDir, chunkReviewConfig);

    expect(fs.existsSync(badJsonDir)).toBe(true);
  });

  test('skips non-matching-prefix directories using chunk-review prefix', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const otherDir = path.join(jobsDir, 'council-other-001');
    fs.mkdirSync(otherDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(otherDir, 'job.json'),
      JSON.stringify({ id: 'council-other-001', createdAt: twoHoursAgo }),
    );

    gcStaleJobs(jobsDir, chunkReviewConfig);

    // council- prefix is NOT matched by chunk-review- filter, so dir preserved
    expect(fs.existsSync(otherDir)).toBe(true);
  });

  test('GC uses council- prefix (council config)', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    // council- prefixed directory that is stale → should be deleted
    const staleCouncilDir = path.join(jobsDir, 'council-stale-001');
    fs.mkdirSync(staleCouncilDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(staleCouncilDir, 'job.json'),
      JSON.stringify({ id: 'council-stale-001', createdAt: twoHoursAgo }),
    );

    // chunk-review- prefixed stale directory → should NOT be deleted
    const staleChunkDir = path.join(jobsDir, 'chunk-review-stale-001');
    fs.mkdirSync(staleChunkDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleChunkDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-stale-001', createdAt: twoHoursAgo }),
    );

    gcStaleJobs(jobsDir, councilConfig);

    expect(fs.existsSync(staleCouncilDir)).toBe(false);
    expect(fs.existsSync(staleChunkDir)).toBe(true);
  });

  test('path traversal guard prevents deletion outside jobsDir', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const outsideDir = path.join(tmpDir, 'outside-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(outsideDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-symlink', createdAt: twoHoursAgo }),
    );

    const symlinkPath = path.join(jobsDir, 'chunk-review-symlink');
    fs.symlinkSync(outsideDir, symlinkPath);

    gcStaleJobs(jobsDir, chunkReviewConfig);

    expect(fs.existsSync(outsideDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeStatus — parameterized by entityDirName
// ---------------------------------------------------------------------------

describe('computeStatus', () => {
  let tmpDir: string;

  function setupJob(jobDir: string, jobJson: Record<string, unknown>, entities: Record<string, unknown>, config: JobConfig) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(jobJson));
    const entitiesDir = path.join(jobDir, config.entityDirName);
    fs.mkdirSync(entitiesDir, { recursive: true });
    for (const [name, status] of Object.entries(entities)) {
      const dir = path.join(entitiesDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns done overallState when all entities are terminal (reviewer config)', async () => {
    const jobDir = path.join(tmpDir, 'job1');
    setupJob(jobDir, { id: 'test-1' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('done');
    expect(result.counts.total).toBe(2);
    expect(result.counts.done).toBe(2);
    expect(result.counts.running).toBe(0);
  });

  test('returns running overallState when some entities are running', async () => {
    const jobDir = path.join(tmpDir, 'job2');
    setupJob(jobDir, { id: 'test-2' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'running' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('returns queued overallState when only queued (no running)', async () => {
    const jobDir = path.join(tmpDir, 'job3');
    setupJob(jobDir, { id: 'test-3' }, {
      alice: { member: 'alice', state: 'queued' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('counts error states correctly', async () => {
    const jobDir = path.join(tmpDir, 'job4');
    setupJob(jobDir, { id: 'test-4' }, {
      alice: { member: 'alice', state: 'error', exitCode: 1 },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
      carol: { member: 'carol', state: 'missing_cli' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('done');
    expect(result.counts.error).toBe(1);
    expect(result.counts.missing_cli).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('uses members/ directory with council config', async () => {
    const jobDir = path.join(tmpDir, 'job-council');
    setupJob(jobDir, { id: 'council-test' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
    }, councilConfig);
    const result = await computeStatus(jobDir, councilConfig);
    expect(result.overallState).toBe('done');
    expect(result.counts.total).toBe(1);
  });

  test('transitions stale queued entity to error when queuedAt exceeds threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-stale');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-stale', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    }, chunkReviewConfig);
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.queued).toBe(0);
  });

  test('does not transition queued entity within staleness threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-fresh');
    const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-fresh', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: freshTime },
    }, chunkReviewConfig);
    // threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('uses 120s minimum threshold when timeoutSec is 0', async () => {
    const jobDir = path.join(tmpDir, 'job-zero-timeout');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-zero', settings: { timeoutSec: 0 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
    }, chunkReviewConfig);
    // threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
  });

  test('transitions stale running entity to error when startedAt exceeds threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-run-stale');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    }, chunkReviewConfig);
    // no heartbeat: grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('preserves normal running entity within running threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-run-fresh');
    const recentHeartbeat = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-run-fresh', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', lastHeartbeat: recentHeartbeat },
    }, chunkReviewConfig);
    // heartbeat 10s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 10s < 60s → not stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  test('writes error details to status.json on queued staleness transition', async () => {
    const jobDir = path.join(tmpDir, 'job-stale-write');
    const staleTime = new Date(Date.now() - 200_000).toISOString();
    setupJob(jobDir, { id: 'test-write', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
    }, chunkReviewConfig);
    await computeStatus(jobDir, chunkReviewConfig);
    const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(written.state).toBe('error');
    expect(written.error.includes('stale')).toBe(true);
  });

  test('writes error details to status.json on running staleness transition', async () => {
    const jobDir = path.join(tmpDir, 'job-run-stale-write');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale-write', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
    }, chunkReviewConfig);
    await computeStatus(jobDir, chunkReviewConfig);
    const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(written.state).toBe('error');
    expect(written.error).toContain('heartbeat');
    expect(written.error).toContain('seconds');
  });

  test('CAS guard: does not transition if running worker changed state during re-read', async () => {
    const jobDir = path.join(tmpDir, 'job-run-cas');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-cas', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
    }, chunkReviewConfig);
    // no heartbeat: grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
    const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, 'alice', 'status.json');
    const donePayload = JSON.stringify({ member: 'alice', state: 'done', startedAt: staleStart, exitCode: 0 });
    Bun.spawn(['bash', '-c', `sleep 0.1 && printf '%s' '${donePayload}' > "${statusPath}"`]);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    // CAS re-read sees 'done' → preserves 'done', does NOT overwrite with error
    expect(alice.state).toBe('done');
    expect(result.counts.error).toBe(0);
  });

  test('transitions running entity to error using mtime fallback when startedAt is missing', async () => {
    const jobDir = path.join(tmpDir, 'job-run-mtime-stale');
    setupJob(jobDir, { id: 'test-run-mtime', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running' }, // no startedAt, no heartbeat
    }, chunkReviewConfig);
    // Set file mtime to 200s ago (stale)
    const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, 'alice', 'status.json');
    const staleMtime = new Date(Date.now() - 200_000); // 200s ago
    fs.utimesSync(statusPath, staleMtime, staleMtime);
    // no heartbeat, no startedAt: mtime fallback, grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('running entity with recent lastHeartbeat is not stale', async () => {
    const jobDir = path.join(tmpDir, 'job-run-hb-fresh');
    const recentHeartbeat = new Date(Date.now() - 5_000).toISOString(); // 5s ago
    setupJob(jobDir, { id: 'test-run-hb-fresh', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', lastHeartbeat: recentHeartbeat },
    }, chunkReviewConfig);
    // heartbeat 5s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 5s < 60s → not stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  test('running entity with old lastHeartbeat is stale', async () => {
    const jobDir = path.join(tmpDir, 'job-run-hb-old');
    const oldHeartbeat = new Date(Date.now() - 90_000).toISOString(); // 90s ago
    setupJob(jobDir, { id: 'test-run-hb-old', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', lastHeartbeat: oldHeartbeat },
    }, chunkReviewConfig);
    // heartbeat 90s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 90s > 60s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('running entity without heartbeat within grace period is not stale', async () => {
    const jobDir = path.join(tmpDir, 'job-run-no-hb-grace');
    const recentStart = new Date(Date.now() - 60_000).toISOString(); // 60s ago
    setupJob(jobDir, { id: 'test-run-no-hb-grace', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: recentStart },
    }, chunkReviewConfig);
    // no heartbeat, startedAt 60s ago: HEARTBEAT_GRACE_PERIOD_MS = 120s; 60s < 120s → not stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  test('running entity without heartbeat beyond grace period is stale', async () => {
    const jobDir = path.join(tmpDir, 'job-run-no-hb-stale');
    const oldStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-no-hb-stale', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: oldStart },
    }, chunkReviewConfig);
    // no heartbeat, startedAt 200s ago: HEARTBEAT_GRACE_PERIOD_MS = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('counts json-mode terminal states: permanent_error, transient_error, empty_output', async () => {
    const jobDir = path.join(tmpDir, 'job-json-mode-states');
    setupJob(jobDir, { id: 'test-json-mode' }, {
      alice: { member: 'alice', state: 'permanent_error' },
      bob: { member: 'bob', state: 'transient_error' },
      carol: { member: 'carol', state: 'empty_output' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.counts.permanent_error).toBe(1);
    expect(result.counts.transient_error).toBe(1);
    expect(result.counts.empty_output).toBe(1);
  });

  test('computeStatus totals 13 keys', async () => {
    const jobDir = path.join(tmpDir, 'job-12keys');
    setupJob(jobDir, { id: 'test-12keys' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    const expectedKeys = [
      'queued', 'running', 'retrying', 'done', 'error',
      'missing_cli', 'timed_out', 'canceled', 'non_retryable',
      'empty_output', 'transient_error', 'permanent_error',
      'awaiting_resume',
    ];
    for (const key of expectedKeys) {
      expect(key in result.counts).toBe(true);
    }
    // Exactly 13 keys (excluding 'total' which is added separately)
    const countKeys = Object.keys(result.counts).filter(k => k !== 'total');
    expect(countKeys.length).toBe(13);
    expect('max_turns_exceeded' in result.counts).toBe(false);
  });

  // awaiting_resume overallState integration tests
  test('모든 멤버가 awaiting_resume이면 overallState는 done이 아님', async () => {
    const jobDir = path.join(tmpDir, 'job-all-awaiting-resume');
    setupJob(jobDir, { id: 'test-all-ar' }, {
      alice: { member: 'alice', state: 'awaiting_resume' },
      bob: { member: 'bob', state: 'awaiting_resume' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).not.toBe('done');
    expect(result.overallState).toBe('awaiting_resume');
  });

  test('일부 done, 일부 awaiting_resume이면 overallState는 done이 아님', async () => {
    const jobDir = path.join(tmpDir, 'job-partial-awaiting-resume');
    setupJob(jobDir, { id: 'test-partial-ar' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'awaiting_resume' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).not.toBe('done');
  });

  test('일부 running, 일부 awaiting_resume이면 overallState는 running (running 우선)', async () => {
    const jobDir = path.join(tmpDir, 'job-running-awaiting-resume');
    setupJob(jobDir, { id: 'test-run-ar' }, {
      alice: { member: 'alice', state: 'running' },
      bob: { member: 'bob', state: 'awaiting_resume' },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('running');
  });

  test('모든 멤버 done이면 overallState는 done (regression)', async () => {
    const jobDir = path.join(tmpDir, 'job-all-done-regression');
    setupJob(jobDir, { id: 'test-all-done' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    }, chunkReviewConfig);
    const result = await computeStatus(jobDir, chunkReviewConfig);
    expect(result.overallState).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// buildUiPayload — parameterized by uiLabel
// ---------------------------------------------------------------------------

describe('buildUiPayload', () => {
  test('returns progress, codex, and claude keys', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 1, done: 1, queued: 0, running: 0, error: 0 },
      members: [{ member: 'alice', state: 'done', exitCode: 0 }],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.progress).toBeTruthy();
    expect(result.codex).toBeTruthy();
    expect(result.claude).toBeTruthy();
  });

  test('reports correct progress done/total', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 3, done: 1, error: 1, queued: 0, running: 1, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'alice', state: 'done' },
        { member: 'bob', state: 'error' },
        { member: 'carol', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.progress.done).toBe(2);
    expect(result.progress.total).toBe(3);
  });

  test('reviewer labels contain [Chunk Review] prefix when using chunk-review config', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Chunk Review]')).toBeTruthy();
  });

  test('reviewer labels contain [Council] prefix when using council config', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload, councilConfig);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Council]')).toBeTruthy();
  });

  test('reviewer labels contain [Spec Review] prefix when using spec-review config', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload, specReviewConfig);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Spec Review]')).toBeTruthy();
  });

  test('marks dispatch as completed when no queued reviewers', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 1, queued: 0, running: 1 },
      members: [
        { member: 'alice', state: 'done' },
        { member: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.codex.update_plan.plan[0].status).toBe('completed');
  });

  test('marks dispatch as in_progress when queued reviewers exist', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 1, running: 1 },
      members: [
        { member: 'alice', state: 'running' },
        { member: 'bob', state: 'queued' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.codex.update_plan.plan[0].status).toBe('in_progress');
  });

  test('marks terminal-state reviewers as completed', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 3, done: 1, error: 1, missing_cli: 1, queued: 0, running: 0 },
      members: [
        { member: 'alice', state: 'done' },
        { member: 'bob', state: 'error' },
        { member: 'carol', state: 'missing_cli' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    for (const step of reviewerSteps) {
      expect(step.status).toBe('completed');
    }
  });

  test('all reviewers done sets synth to in_progress', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 2, queued: 0, running: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'alice', state: 'done' },
        { member: 'bob', state: 'done' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    expect(synthStep.status).toBe('in_progress');
  });

  test('synth is pending when not all done', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 1, queued: 0, running: 1 },
      members: [
        { member: 'alice', state: 'done' },
        { member: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    expect(synthStep.status).toBe('pending');
  });

  test('claude todos have content, status, and activeForm fields', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 1, done: 1, queued: 0, running: 0 },
      members: [{ member: 'alice', state: 'done' }],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    for (const todo of result.claude.todo_write.todos) {
      expect('content' in todo).toBeTruthy();
      expect('status' in todo).toBeTruthy();
      expect('activeForm' in todo).toBeTruthy();
    }
  });

  test('sorts reviewers alphabetically', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 3, done: 0, queued: 0, running: 3 },
      members: [
        { member: 'carol', state: 'running' },
        { member: 'alice', state: 'running' },
        { member: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(reviewerSteps[0].step.includes('alice')).toBeTruthy();
    expect(reviewerSteps[1].step.includes('bob')).toBeTruthy();
    expect(reviewerSteps[2].step.includes('carol')).toBeTruthy();
  });

  test('filters out reviewers with null/empty entity', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 1, queued: 0, running: 0 },
      members: [
        { member: 'alice', state: 'done' },
        { member: null, state: 'done' },
      ],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(reviewerSteps.length).toBe(1);
  });

  test('handles missing counts gracefully', () => {
    const payload = {
      overallState: 'done',
      members: [],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.progress.done).toBe(0);
    expect(result.progress.total).toBe(0);
  });

  test('handles missing reviewers gracefully', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0 },
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.codex.update_plan.plan.length).toBe(2);
  });

  test('overallState is propagated in progress', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    expect(result.progress.overallState).toBe('running');
  });

  test('awaiting_resume 멤버는 completed가 아닌 in_progress로 분류됨 (non-terminal)', () => {
    const payload = {
      overallState: 'awaiting_resume',
      counts: { total: 1, done: 0, queued: 0, running: 0, awaiting_resume: 1 },
      members: [{ member: 'alice', state: 'awaiting_resume' }],
    };
    const result = buildUiPayload(payload, chunkReviewConfig);
    // The reviewer step (index 1) must NOT be 'completed' — awaiting_resume is non-terminal
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.status).not.toBe('completed');
    // Synthesize step must NOT be in_progress yet (job not done)
    const synthStep = result.codex.update_plan.plan[result.codex.update_plan.plan.length - 1];
    expect(synthStep.status).not.toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// buildManifest — parameterized by entityDirName and entitySingular
// ---------------------------------------------------------------------------

describe('buildManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupManifestJob(jobDir: string, config: JobConfig, entities: Record<string, { status: unknown; hasOutput: boolean }>) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test-manifest-job' }));
    const entitiesDir = path.join(jobDir, config.entityDirName);
    fs.mkdirSync(entitiesDir, { recursive: true });
    for (const [name, { status, hasOutput }] of Object.entries(entities)) {
      const dir = path.join(entitiesDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
      if (hasOutput) {
        fs.writeFileSync(path.join(dir, 'output.txt'), `output from ${name}`);
      }
    }
  }

  test('returns id and members array with chunk-review config', () => {
    const jobDir = path.join(tmpDir, 'job-manifest');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'done' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.id).toBe('test-manifest-job');
    expect(Array.isArray(result.members)).toBeTruthy();
    expect(result.members.length).toBe(1);
  });

  test('returns outputFilePath when output.txt exists', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-output');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'done' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBeTruthy();
    expect(result.members[0].errorMessage).toBe(null);
  });

  test('returns errorMessage when no output.txt', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-err');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'error', message: 'failed' }, hasOutput: false },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBeTruthy();
  });

  test('sorts members alphabetically', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-sort');
    setupManifestJob(jobDir, chunkReviewConfig, {
      carol: { status: { member: 'carol', state: 'done' }, hasOutput: true },
      alice: { status: { member: 'alice', state: 'done' }, hasOutput: true },
      bob: { status: { member: 'bob', state: 'done' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].member).toBe('alice');
    expect(result.members[1].member).toBe('bob');
    expect(result.members[2].member).toBe('carol');
  });

  test('uses members directory with council config', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-council');
    setupManifestJob(jobDir, councilConfig, {
      alice: { status: { member: 'alice', state: 'done' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, councilConfig);
    expect(result.id).toBe('test-manifest-job');
    expect(result.members.length).toBe(1);
  });

  test('buildManifest: json-mode empty_output → outputFilePath null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-json-empty-output');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'empty_output', size_bytes: 0 }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('empty_output');
  });

  test('buildManifest: json-mode done with size_bytes=0 → outputFilePath null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-json-done-zero');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'done', size_bytes: 0 }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('done');
  });

  test('buildManifest: text-mode state=done → outputFilePath non-null, errorMessage null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-text-done');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'done' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).not.toBe(null);
    expect(result.members[0].errorMessage).toBe(null);
  });

  test('buildManifest: text-mode state=error → outputFilePath null, errorMessage=state', () => {
    // state='error' is not 'done' → new predicate treats it as unreadable
    const jobDir = path.join(tmpDir, 'job-manifest-text-error');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'error', message: 'timeout' }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('timeout');
  });

  test('buildManifest: text-mode state=non_retryable + output.txt exists → outputFilePath null, errorMessage from error.type', () => {
    // Sentinel fires and writes state='non_retryable'; even though output.txt exists (possibly empty),
    // buildManifest must return null outputFilePath and surface the error.type.
    const jobDir = path.join(tmpDir, 'job-manifest-text-non-retryable-with-output');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'non_retryable',
          error: { type: 'model_not_found', message: 'Model not found: gpt-5' },
        },
        hasOutput: true,  // output.txt exists but should be ignored
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('model_not_found');
  });

  test('buildManifest: json-mode permanent_error → outputFilePath null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-json-perm-error');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: { status: { member: 'alice', state: 'permanent_error', size_bytes: 42 }, hasOutput: true },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('permanent_error');
  });

  test('empty output.txt (0 bytes) classifies as outputFilePath !== null, errorMessage === null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-empty-output');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test-manifest-job' }));
    const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
    fs.mkdirSync(entitiesDir, { recursive: true });
    const memberDir = path.join(entitiesDir, 'alice');
    fs.mkdirSync(memberDir, { recursive: true });
    fs.writeFileSync(path.join(memberDir, 'status.json'), JSON.stringify({ member: 'alice', state: 'done' }));
    // Write empty (0-byte) output.txt
    fs.writeFileSync(path.join(memberDir, 'output.txt'), '');
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).not.toBe(null);
    expect(result.members[0].errorMessage).toBe(null);
  });

  test('buildManifest: json-mode permanent_error with error.type=context_window → errorMessage === "context_window"', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-json-perm-context-window');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'permanent_error',
          attempts: 3,
          size_bytes: 0,
          error: { type: 'context_window', message: 'AI_APICallError', raw_message: 'AI_APICallError' },
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('context_window');
  });

  test('buildManifest: json-mode empty_output without error → errorMessage === "empty_output"', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-json-empty-no-error');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'empty_output',
          attempts: 3,
          size_bytes: 0,
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('empty_output');
  });

  test('buildManifest: text-mode timed_out with status.message → errorMessage === "Timed out after 480s"', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-text-timed-out');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'timed_out',
          attempts: 3,
          message: 'Timed out after 480s',
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('Timed out after 480s');
  });

  test('buildManifest: text-mode without message and error → errorMessage === "non_retryable"', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-text-non-retryable-synthetic');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'non_retryable',
          attempts: 3,
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('non_retryable');
  });

  test('buildManifest: prompt_too_large (text-mode-style) → errorMessage === "prompt_too_large"', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-prompt-too-large');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'permanent_error',
          attempts: 0,
          error: { type: 'prompt_too_large', bytes: 100000, limit: 81920 },
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('prompt_too_large');
  });

  test('buildManifest: error.message without error.type → errorMessage === error.message (link 3)', () => {
    const jobDir = path.join(tmpDir, 'job-manifest-link3-error-message');
    setupManifestJob(jobDir, chunkReviewConfig, {
      alice: {
        status: {
          member: 'alice',
          state: 'permanent_error',
          attempts: 3,
          error: { message: 'Unknown API failure' },
        },
        hasOutput: false,
      },
    });
    const result = buildManifest(jobDir, chunkReviewConfig);
    expect(result.members[0].outputFilePath).toBe(null);
    expect(result.members[0].errorMessage).toBe('Unknown API failure');
  });
});

// ---------------------------------------------------------------------------
// parseYamlSimple — parameterized by configTopLevelKey
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir: string;

  const chunkFallback = {
    'chunk-review': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p' },
      ],
      settings: { exclude_chairman_from_members: true, timeout: 300 },
    },
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses chunk-review top-level key (chunk-review config)', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].chairman.role).toBe('gemini');
  });

  test('parses members array with multiple entries', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
      '    - name: bob',
      '      command: bob-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].members.length).toBe(2);
    expect(result['chunk-review'].members[0].name).toBe('alice');
    expect(result['chunk-review'].members[1].name).toBe('bob');
  });

  test('parses settings section with type coercion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 300',
      '    exclude_chairman_from_members: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].settings.timeout).toBe(300);
    expect(result['chunk-review'].settings.exclude_chairman_from_members).toBe(false);
  });

  test('returns fallback on read error (non-existent file)', () => {
    const result = parseYamlSimple(path.join(tmpDir, 'missing.yaml'), chunkFallback, chunkReviewConfig);
    expect(result).toEqual(chunkFallback);
  });

  test('falls back to default members when none defined', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: auto',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].members).toEqual(chunkFallback['chunk-review'].members);
  });

  test('strips quotes from member name values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: "quoted-name"',
      '      command: some-cmd',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].members[0].name).toBe('quoted-name');
  });

  test('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    name: custom',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].chairman.name).toBe('custom');
    expect(result['chunk-review'].chairman.role).toBe('auto');
  });

  test('coerces "true" string to boolean true in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    verbose: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].settings.verbose).toBe(true);
  });

  test('skips comment lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '# This is a comment',
      'chunk-review:',
      '  chairman:',
      '    # Another comment',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].chairman.role).toBe('codex');
  });

  test('skips empty lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '',
      '  chairman:',
      '',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].chairman.role).toBe('codex');
  });

  test('strips inline comments from settings values (e.g. timeout: 300 # seconds)', () => {
    const configPath = path.join(tmpDir, 'config-inline-comment.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 300 # seconds',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].settings.timeout).toBe(300);
  });

  test('extraSections: context 섹션을 key-value 매핑으로 파싱', () => {
    const configPath = path.join(tmpDir, 'config-extra.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  context:',
      '    shared_context_dir: ~/my/context',
      '    specs_dir: specs',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig, ['context']);
    expect(result['chunk-review'].context).toBeDefined();
    expect(result['chunk-review'].context.shared_context_dir).toBe('~/my/context');
    expect(result['chunk-review'].context.specs_dir).toBe('specs');
  });

  test('extraSections: fallback context 값과 merge됨', () => {
    const configPath = path.join(tmpDir, 'config-extra-fallback.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  context:',
      '    specs_dir: custom/specs',
    ].join('\n'));
    const fallbackWithContext = {
      'chunk-review': {
        ...chunkFallback['chunk-review'],
        context: { shared_context_dir: '~/.omt/default', specs_dir: 'specs' },
      },
    };
    const result = parseYamlSimple(configPath, fallbackWithContext, chunkReviewConfig, ['context']);
    expect(result['chunk-review'].context.shared_context_dir).toBe('~/.omt/default');
    expect(result['chunk-review'].context.specs_dir).toBe('custom/specs');
  });

  test('extraSections 미제공 시 기존 동작 유지 (context 섹션 무시됨)', () => {
    const configPath = path.join(tmpDir, 'config-no-extra.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
      '  context:',
      '    specs_dir: specs',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].chairman.role).toBe('gemini');
    expect(result['chunk-review'].context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// spawnWorkers — name validation (whitelist regex)
// ---------------------------------------------------------------------------

describe('spawnWorkers 이름 유효성 검사', () => {
  let tmpDir: string;
  let originalExit: typeof process.exit;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    // exitWithError calls process.exit(1) — intercept it
    originalExit = process.exit;
    (process as any).exit = (code?: number) => {
      throw new Error(`process.exit(${code})`);
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function trySpawn(name: string): string | null {
    try {
      spawnWorkers({
        entities: [{ name, command: 'echo test' }],
        workerPath: '/nonexistent/worker.ts',
        jobDir: tmpDir,
        entitiesDir: path.join(tmpDir, 'members'),
        timeoutSec: 30,
        config: councilConfig,
      });
      return null;
    } catch (e: any) {
      return String(e.message || e);
    }
  }

  test('"." 은 화이트리스트 거부', () => {
    const err = trySpawn('.');
    expect(err).not.toBeNull();
  });

  test('".." 은 화이트리스트 거부', () => {
    const err = trySpawn('..');
    expect(err).not.toBeNull();
  });

  test('"a b" (공백 포함) 은 화이트리스트 거부', () => {
    const err = trySpawn('a b');
    expect(err).not.toBeNull();
  });

  test('"test!" (특수문자 포함) 은 화이트리스트 거부', () => {
    const err = trySpawn('test!');
    expect(err).not.toBeNull();
  });

  test('"valid-name" 은 허용 (하이픈)', () => {
    fs.mkdirSync(path.join(tmpDir, 'members'), { recursive: true });
    const err = trySpawn('valid-name');
    expect(err).toBeNull();
  });

  test('"valid_name" 은 허용 (언더스코어)', () => {
    fs.mkdirSync(path.join(tmpDir, 'members'), { recursive: true });
    const err = trySpawn('valid_name');
    expect(err).toBeNull();
  });

  test('"validName123" 은 허용 (영문+숫자)', () => {
    fs.mkdirSync(path.join(tmpDir, 'members'), { recursive: true });
    const err = trySpawn('validName123');
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cmdCollect — timeout-ms 0 is infinite wait
// ---------------------------------------------------------------------------

describe('cmdCollect', () => {
  let tmpDir: string;

  function setupCollectJob(jobDir: string, entities: Record<string, unknown>) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'collect-test' }));
    const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
    fs.mkdirSync(entitiesDir, { recursive: true });
    for (const [name, status] of Object.entries(entities)) {
      const dir = path.join(entitiesDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--timeout-ms 0은 즉시 종료하지 않고 done 상태까지 대기함', async () => {
    const jobDir = path.join(tmpDir, 'job-collect-timeout0');
    // Start with running state
    setupCollectJob(jobDir, {
      alice: { member: 'alice', state: 'running' },
    });

    const aliceStatusPath = path.join(jobDir, chunkReviewConfig.entityDirName, 'alice', 'status.json');

    // Transition to done after COLLECT_POLL_INTERVAL_MS (5000ms) so the second poll sees 'done'
    const donePayload = JSON.stringify({ member: 'alice', state: 'done', exitCode: 0 });
    Bun.spawn(['bash', '-c', `sleep 1 && printf '%s' '${donePayload}' > "${aliceStatusPath}"`]);

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
      if (typeof chunk === 'string') output.push(chunk);
      return origWrite(chunk as any);
    };

    try {
      await cmdCollect({ 'timeout-ms': 0 }, jobDir, chunkReviewConfig);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(output.length).toBeGreaterThan(0);
    const result = JSON.parse(output[0]);
    expect(result.overallState).toBe('done');
  }, 15000);

  test('awaiting_resume 상태에서는 done manifest를 반환하지 않고 timeout fallback', async () => {
    const jobDir = path.join(tmpDir, 'job-collect-awaiting-resume');
    setupCollectJob(jobDir, {
      alice: { member: 'alice', state: 'awaiting_resume' },
    });

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
      if (typeof chunk === 'string') output.push(chunk);
      return origWrite(chunk as any);
    };

    try {
      // timeout-ms must exceed COLLECT_POLL_INTERVAL_MS (5000ms) to allow one poll cycle.
      // The loop sleeps 5s then re-checks timeout, so total wall time is ~10s; set to 11s.
      await cmdCollect({ 'timeout-ms': 5100 }, jobDir, chunkReviewConfig);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(output.length).toBeGreaterThan(0);
    const result = JSON.parse(output[0]);
    // Must NOT return done manifest when awaiting_resume
    expect(result.overallState).not.toBe('done');
    // Must not contain manifest 'members' array (done manifest only)
    expect(result.members).toBeUndefined();
  }, 15000);
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe('cmdResults', () => {
  let tmpDir: string;

  function captureStdout(fn: () => void): string {
    let captured = '';
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      captured += String(chunk);
      return true;
    }) as any;
    try {
      fn();
    } finally {
      process.stdout.write = orig;
    }
    return captured;
  }

  function setupResultsFixture(
    jobDir: string,
    members: Record<string, { member: string; state: string; exitCode: number; output: string; stderr: string }>,
    jobMeta?: Record<string, any>,
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(jobMeta || { id: 'test' }));
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, data] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }));
      fs.writeFileSync(path.join(dir, 'output.txt'), data.output);
      fs.writeFileSync(path.join(dir, 'error.txt'), data.stderr);
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--json 기본 출력 구조 검증', () => {
    const jobDir = path.join(tmpDir, 'job-results-basic');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: 'hello', stderr: '' },
    });

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig);
    });

    const result = JSON.parse(raw);
    expect(result.jobDir).toBeDefined();
    expect(result.id).toBe('test');
    expect(Array.isArray(result.members)).toBe(true);
    const member = result.members[0];
    expect(member.member).toBe('alice');
    expect(member.state).toBe('done');
    expect(member.exitCode).toBe(0);
    expect(member.message).toBeNull();
    expect(member.output).toBe('hello');
    expect(member.stderr).toBeUndefined();
  });

  test('hooks.extraTopLevel 커스텀 필드 추가', () => {
    const jobDir = path.join(tmpDir, 'job-results-extratop');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: '', stderr: '' },
    });

    const hooks: CmdResultsHooks = {
      extraTopLevel: () => ({ specName: 'test-spec', prompt: 'test prompt' }),
    };

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
    });

    const result = JSON.parse(raw);
    expect(result.specName).toBe('test-spec');
    expect(result.prompt).toBe('test prompt');
  });

  test('hooks.extraMemberFields per-member 필드 추가', () => {
    const jobDir = path.join(tmpDir, 'job-results-extramember');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: '', stderr: 'some error' },
    });

    const hooks: CmdResultsHooks = {
      extraMemberFields: (r) => ({ stderr: r.stderr }),
    };

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
    });

    const result = JSON.parse(raw);
    expect(result.members[0].stderr).toBe('some error');
  });

  test('ANSI 코드가 output에서 제거됨', () => {
    const jobDir = path.join(tmpDir, 'job-results-ansi-output');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: '\x1b[31mred\x1b[0m', stderr: '' },
    });

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig);
    });

    const result = JSON.parse(raw);
    expect(result.members[0].output).toBe('red');
  });

  test('hooks 미전달 시 기존 동작 유지', () => {
    const jobDir = path.join(tmpDir, 'job-results-nohooks');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: 'out', stderr: 'err' },
    });

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig);
    });

    const result = JSON.parse(raw);
    const member = result.members[0];
    expect(member.member).toBe('alice');
    expect(member.output).toBe('out');
    expect(member.stderr).toBeUndefined();
    expect(member.specName).toBeUndefined();
  });

  test('ANSI 코드가 stderr에서도 제거됨', () => {
    const jobDir = path.join(tmpDir, 'job-results-ansi-stderr');
    setupResultsFixture(jobDir, {
      alice: { member: 'alice', state: 'done', exitCode: 0, output: '', stderr: '\x1b[32mgreen\x1b[0m' },
    });

    const hooks: CmdResultsHooks = {
      extraMemberFields: (r) => ({ stderr: r.stderr }),
    };

    const raw = captureStdout(() => {
      cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
    });

    const result = JSON.parse(raw);
    expect(result.members[0].stderr).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// opencode output_format branch
// ---------------------------------------------------------------------------

describe('buildAugmentedCommand opencode output_format', () => {
  test('opencode json: appends --format json', () => {
    const result = buildAugmentedCommand(
      { command: 'opencode run', output_format: 'json' },
      'opencode',
    );
    expect(result.command).toContain('--format');
    expect(result.command).toContain('json');
  });

  test('opencode without output_format: does not append --format json', () => {
    const result = buildAugmentedCommand(
      { command: 'opencode run' },
      'opencode',
    );
    expect(result.command).not.toContain('--format');
  });

  test('기존 claude 브랜치 회귀: `--output-format json` 유지', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', output_format: 'json' },
      'claude',
    );
    expect(result.command).toContain('--output-format');
    expect(result.command).toContain('json');
  });

  test('기존 codex 브랜치 회귀: `--json` 유지', () => {
    const result = buildAugmentedCommand(
      { command: 'codex exec', output_format: 'json' },
      'codex',
    );
    expect(result.command).toContain('--json');
  });
});

// ---------------------------------------------------------------------------
// cmdResumeMember
// ---------------------------------------------------------------------------

describe('cmdResumeMember', () => {
  let tmpDir: string;
  let jobDir: string;

  const membersConfig: JobConfig = {
    entitySingular: 'member',
    entityPlural: 'members',
    entityDirName: 'members',
    jobPrefix: 'council-',
    uiLabel: '[Council]',
    configTopLevelKey: 'council',
  };

  const reviewersConfig: JobConfig = {
    entitySingular: 'reviewer',
    entityPlural: 'reviewers',
    entityDirName: 'reviewers',
    jobPrefix: 'spec-review-',
    uiLabel: '[Spec Review]',
    configTopLevelKey: 'spec-review',
  };

  function writeMemberStatus(entityDir: string, payload: Record<string, unknown>) {
    fs.mkdirSync(entityDir, { recursive: true });
    fs.writeFileSync(path.join(entityDir, 'status.json'), JSON.stringify(payload, null, 2), 'utf8');
  }

  function readMemberStatus(entityDir: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(entityDir, 'status.json'), 'utf8'));
  }

  function makeMockDriver() {
    return {
      cli: 'opencode' as const,
      initialCommand: () => ({ program: 'opencode', args: [], env: {} }),
      resumeCommand: () => ({ program: 'opencode', args: ['--resume', 'sess-abc'], env: {} }),
      parseStdout: (_s: string) => ({
        sessionID: 'sess-abc',
        terminal: 'stop' as const,
        text: 'resumed result',
        rawEvents: [],
      }),
    };
  }

  function makeResumeStub(sessionID = 'sess-abc') {
    return async (_sid: string, _opts: unknown) => ({
      state: 'done',
      sessionID,
      text: 'resumed output',
      exitCode: 0,
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-job-resume-test-'));
    jobDir = path.join(tmpDir, 'job1');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('uses entityDirName=members to locate status.json', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).resolves.toBeUndefined();
  });

  test('uses entityDirName=reviewers to locate status.json', async () => {
    const entityDir = path.join(jobDir, 'reviewers', 'bob');
    writeMemberStatus(entityDir, {
      member: 'bob',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'bob', 'follow up', reviewersConfig, opts),
    ).resolves.toBeUndefined();
  });

  test('rejects when status.json absent (no resumable session)', async () => {
    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'ghost', 'follow up', membersConfig, opts),
    ).rejects.toThrow('no resumable session');
  });

  test('rejects when sessionID missing in status.json', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: null,
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('no resumable session');
  });

  test('increments resume_count to 1 after one call', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts);
    const status = readMemberStatus(entityDir);
    expect(status.resume_count).toBe(1);
  });

  test('rejects with cap exceeded when resume_count is 3', async () => {
    const entityDir = path.join(jobDir, 'reviewers', 'bob');
    writeMemberStatus(entityDir, {
      member: 'bob',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 3,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'bob', 'follow up', reviewersConfig, opts),
    ).rejects.toThrow('resume cap exceeded (3/3)');
  });

  test('rejects when state is error', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'error',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('member in non-resumable state: error');
  });

  test('wrong entityDirName does not find status.json in sibling directory', async () => {
    // Status is in 'members/' but we pass reviewersConfig (entityDirName='reviewers')
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    // reviewersConfig uses 'reviewers' dir — should not find 'members/alice'
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', reviewersConfig, opts),
    ).rejects.toThrow('no resumable session');
  });

  test('passes workerEnv from status.json through to resumeFn', async () => {
    const entityDir = path.join(jobDir, 'members', 'gpt');
    writeMemberStatus(entityDir, {
      member: 'gpt',
      state: 'done',
      sessionID: 'ses_x',
      resume_count: 0,
      command: 'opencode',
      workerEnv: { CLAUDECODE: '', CLAUDE_CODE_EFFORT_LEVEL: 'xhigh', CUSTOM: 'val' },
    });

    let capturedOpts: RunOneTurnOpts | null = null;
    const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
      capturedOpts = opts;
      return { state: 'done' as const, sessionID: 'ses_x', text: '', exitCode: 0 };
    };

    await cmdResumeMember(jobDir, 'gpt', 'follow up', membersConfig, {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn,
    });

    expect(capturedOpts).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(capturedOpts!.workerEnv).toEqual({
      CLAUDECODE: '',
      CLAUDE_CODE_EFFORT_LEVEL: 'xhigh',
      CUSTOM: 'val',
    });
  });

  // ---------------------------------------------------------------------------
  // Regression tests: triple fix (item 2 comment, item 4 preflight, item 5 timeoutSec=0)
  // ---------------------------------------------------------------------------

  test('unknown command throws before resume_count is incremented (preflight before cap)', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    fs.mkdirSync(entityDir, { recursive: true });
    const statusPayload = {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'unknowncli run',
    };
    fs.writeFileSync(path.join(entityDir, 'status.json'), JSON.stringify(statusPayload, null, 2), 'utf8');

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('unknown cli type');

    const status = JSON.parse(fs.readFileSync(path.join(entityDir, 'status.json'), 'utf8'));
    expect(status.resume_count).toBe(0);
  });

  test('timeoutSec=0 in job.json forwarded as 0 to resumeFn (not coerced to 300)', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    fs.mkdirSync(entityDir, { recursive: true });
    fs.writeFileSync(path.join(entityDir, 'status.json'), JSON.stringify({
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    }, null, 2), 'utf8');

    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({
      settings: { timeoutSec: 0 },
    }, null, 2), 'utf8');

    let capturedTimeoutSec: number | undefined;
    const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
      capturedTimeoutSec = opts.timeoutSec;
      return { state: 'done' as const, sessionID: 'sess-abc', text: '', exitCode: 0 };
    };

    await cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn,
    });

    expect(capturedTimeoutSec).toBe(0);
  });

  test('intent comment exists in cmdResumeMember explaining non-forwarding of promptsDir', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'generic-job.ts'),
      'utf8',
    );
    // Verify comment is present between cmdResumeMember start and end
    const fnStart = src.indexOf('export async function cmdResumeMember(');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/session.*preserv|--resume.*persona|intentionally.*omit|not forwarded|session-preserving/i);
  });

  // ---------------------------------------------------------------------------
  // skillName-aware error messages
  // ---------------------------------------------------------------------------

  test('skillName absent + no driver emits generic message', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => null as any,
      resumeOneTurnFn: makeResumeStub() as any,
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('no driver for opencode');
    // Must NOT include skill prefix
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow(/^no driver for/);
  });

  test('skillName + no driver emits prefixed message with guidance', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => null as any,
      resumeOneTurnFn: makeResumeStub() as any,
      skillName: 'slides-review',
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('slides-review: no driver for opencode, implement driver or change default member');
  });

  test('skillName + unknown cli type emits prefixed message', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 0,
      command: 'unknowncli run',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
      skillName: 'orchestrate-review',
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('orchestrate-review: unknown cli type');
  });

  test('skillName + no resumable session emits prefixed message', async () => {
    // No status.json written → 'no resumable session'
    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
      skillName: 'slides-review',
    };
    await expect(
      cmdResumeMember(jobDir, 'ghost', 'follow up', membersConfig, opts),
    ).rejects.toThrow('slides-review: no resumable session');
  });

  test('skillName + resume cap exceeded emits prefixed message', async () => {
    const entityDir = path.join(jobDir, 'members', 'alice');
    writeMemberStatus(entityDir, {
      member: 'alice',
      state: 'done',
      sessionID: 'sess-abc',
      resume_count: 3,
      command: 'opencode',
    });

    const opts: ResumeMemberOpts = {
      driverFactory: () => makeMockDriver(),
      resumeOneTurnFn: makeResumeStub() as any,
      skillName: 'orchestrate-review',
    };
    await expect(
      cmdResumeMember(jobDir, 'alice', 'follow up', membersConfig, opts),
    ).rejects.toThrow('orchestrate-review: resume cap exceeded (3/3)');
  });
});

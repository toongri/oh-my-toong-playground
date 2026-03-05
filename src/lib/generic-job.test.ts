#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { JobConfig } from './generic-job.ts';
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
  HEARTBEAT_STALE_THRESHOLD_MS,
  HEARTBEAT_GRACE_PERIOD_MS,
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
    expect(result.env.CLAUDECODE).toBe(undefined);
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
      settings: { exclude_chairman_from_reviewers: true, timeout: 300 },
    },
  };

  const councilFallback = {
    'council': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p' },
      ],
      settings: { timeout: 300 },
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
      '    exclude_chairman_from_reviewers: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].settings.timeout).toBe(300);
    expect(result['chunk-review'].settings.exclude_chairman_from_reviewers).toBe(false);
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

  test('handles "reviewers:" as alias for members section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, chunkFallback, chunkReviewConfig);
    expect(result['chunk-review'].members.length).toBe(1);
    expect(result['chunk-review'].members[0].name).toBe('alice');
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
});

// ---------------------------------------------------------------------------
// spawnWorkers — name validation (whitelist regex)
// ---------------------------------------------------------------------------

describe('spawnWorkers 이름 유효성 검사', () => {
  let tmpDir: string;
  let originalExit: typeof process.exit;
  let exitError: string | null;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    exitError = null;
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

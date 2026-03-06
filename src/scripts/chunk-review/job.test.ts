#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

import {
  buildUiPayload,
  buildManifest,
  parseChunkReviewConfig,
  parseYamlSimple,
  computeStatus,
  detectCliType,
  buildAugmentedCommand,
  gcStaleJobs,
} from './job.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-job-test-'));
}

// ---------------------------------------------------------------------------
// parseYamlSimple
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir;
  const fallback = {
    'chunk-review': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '\u{1F9E0}', color: 'CYAN' },
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

  test('parses basic key-value in chairman section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
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
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].members.length).toBe(2);
    expect(result['chunk-review'].members[0].name).toBe('alice');
    expect(result['chunk-review'].members[0].command).toBe('alice-cli');
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
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].settings.timeout).toBe(300);
    expect(result['chunk-review'].settings.exclude_chairman_from_members).toBe(false);
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
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].chairman.role).toBe('codex');
  });

  test('falls back to default members when none defined', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: auto',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].members).toEqual(fallback['chunk-review'].members);
  });

  test('returns fallback on read error (non-existent file)', () => {
    const result = parseYamlSimple(path.join(tmpDir, 'missing.yaml'), fallback);
    expect(result).toEqual(fallback);
  });

  test('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    name: custom',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].chairman.name).toBe('custom');
    expect(result['chunk-review'].chairman.role).toBe('auto');
  });

  test('parses members: section correctly', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
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
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].members[0].name).toBe('quoted-name');
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
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].chairman.role).toBe('codex');
  });

  test('coerces "true" string to boolean true in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    verbose: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].settings.verbose).toBe(true);
  });

  test('parses hyphen keys in settings section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    bucket-size: 50',
      '    exclude-chairman: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].settings['bucket-size']).toBe(50);
    expect(result['chunk-review'].settings['exclude-chairman']).toBe(true);
  });

  test('parses hyphen keys in member properties', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: alice',
      '      effort-level: high',
      '      output-format: json',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].members[0]['effort-level']).toBe('high');
    expect(result['chunk-review'].members[0]['output-format']).toBe('json');
  });

  test('parses values containing colons', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    command: gemini --flag=value:123',
      '  members:',
      '    - name: alice',
      '      command: claude --endpoint=http://localhost:8080',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].chairman.command).toBe('gemini --flag=value:123');
    expect(result['chunk-review'].members[0].command).toBe('claude --endpoint=http://localhost:8080');
  });
});

// ---------------------------------------------------------------------------
// parseChunkReviewConfig
// ---------------------------------------------------------------------------

describe('parseChunkReviewConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns fallback when config file does not exist', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'missing.yaml'));
    expect(result['chunk-review']).toBeTruthy();
    expect(Array.isArray(result['chunk-review'].members)).toBeTruthy();
    expect(result['chunk-review'].members.length > 0).toBeTruthy();
    expect(result['chunk-review'].chairman.role).toBe('auto');
  });

  test('fallback contains default members (claude, codex, gemini)', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const names = result['chunk-review'].members.map(r => r.name);
    expect(names.includes('claude')).toBeTruthy();
    expect(names.includes('codex')).toBeTruthy();
    expect(names.includes('gemini')).toBeTruthy();
  });

  test('fallback contains default settings', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    expect(result['chunk-review'].settings.exclude_chairman_from_members).toBe(true);
    expect(result['chunk-review'].settings.timeout).toBe(300);
  });

  test('parses valid config via simple parser (yaml module unavailable)', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
      '  settings:',
      '    timeout: 600',
    ].join('\n'));
    const result = await parseChunkReviewConfig(configPath);
    expect(result['chunk-review'].chairman.role).toBe('gemini');
    expect(result['chunk-review'].members.length).toBe(1);
    expect(result['chunk-review'].members[0].name).toBe('alice');
    expect(result['chunk-review'].settings.timeout).toBe(600);
  });

  test('merges settings with defaults from fallback', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 999',
    ].join('\n'));
    const result = await parseChunkReviewConfig(configPath);
    expect(result['chunk-review'].settings.timeout).toBe(999);
    expect(result['chunk-review'].settings.exclude_chairman_from_members).toBe(true);
  });

  test('returns structure with chunk-review top-level key', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const keys = Object.keys(result);
    expect(keys).toEqual(['chunk-review']);
  });
});

// ---------------------------------------------------------------------------
// buildUiPayload
// ---------------------------------------------------------------------------

describe('buildUiPayload', () => {
  test('returns progress, codex, and claude keys', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 1, done: 1, queued: 0, running: 0, error: 0 },
      members: [{ member: 'alice', state: 'done', exitCode: 0 }],
    };
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
    expect(result.progress.done).toBe(2);
    expect(result.progress.total).toBe(3);
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
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    for (const step of reviewerSteps) {
      expect(step.status).toBe('completed');
    }
  });

  test('marks first running reviewer as in_progress when dispatch completed', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 0, running: 2 },
      members: [
        { member: 'alice', state: 'running' },
        { member: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(reviewerSteps[0].status).toBe('in_progress');
    expect(reviewerSteps[1].status).toBe('pending');
  });

  test('handles empty reviewers array', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0, done: 0, queued: 0, running: 0 },
      members: [],
    };
    const result = buildUiPayload(payload);
    expect(result.progress.done).toBe(0);
    expect(result.progress.total).toBe(0);
    expect(result.codex.update_plan.plan.length).toBe(2);
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
    const result = buildUiPayload(payload);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    expect(synthStep.status).toBe('in_progress');
  });

  test('all reviewers error sets synth to in_progress (all terminal, isDone)', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 0, queued: 0, running: 0, error: 2 },
      members: [
        { member: 'alice', state: 'error' },
        { member: 'bob', state: 'error' },
      ],
    };
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
    for (const todo of result.claude.todo_write.todos) {
      expect('content' in todo).toBeTruthy();
      expect('status' in todo).toBeTruthy();
      expect('activeForm' in todo).toBeTruthy();
    }
  });

  test('reviewer labels contain [Chunk Review] prefix', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Chunk Review]')).toBeTruthy();
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
    const result = buildUiPayload(payload);
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
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(reviewerSteps.length).toBe(1);
  });

  test('handles missing counts gracefully', () => {
    const payload = {
      overallState: 'done',
      members: [],
    };
    const result = buildUiPayload(payload);
    expect(result.progress.done).toBe(0);
    expect(result.progress.total).toBe(0);
  });

  test('handles missing reviewers gracefully', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0 },
    };
    const result = buildUiPayload(payload);
    expect(result.codex.update_plan.plan.length).toBe(2);
  });

  test('hasInProgress propagation: dispatch in_progress prevents reviewer in_progress', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 1, running: 1 },
      members: [
        { member: 'alice', state: 'running' },
        { member: 'bob', state: 'queued' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(reviewerSteps[0].status).toBe('pending');
    expect(reviewerSteps[1].status).toBe('pending');
  });

  test('overallState is propagated in progress', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    expect(result.progress.overallState).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------

describe('computeStatus', () => {
  let tmpDir;

  function setupJob(jobDir, jobJson, members) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(jobJson));
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, status] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
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

  test('returns done overallState when all reviewers are terminal', async () => {
    const jobDir = path.join(tmpDir, 'job1');
    setupJob(jobDir, { id: 'test-1' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    });
    const result = await computeStatus(jobDir);
    expect(result.overallState).toBe('done');
    expect(result.counts.total).toBe(2);
    expect(result.counts.done).toBe(2);
    expect(result.counts.running).toBe(0);
  });

  test('returns running overallState when some reviewers are running', async () => {
    const jobDir = path.join(tmpDir, 'job2');
    setupJob(jobDir, { id: 'test-2' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'running' },
    });
    const result = await computeStatus(jobDir);
    expect(result.overallState).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('returns queued overallState when only queued (no running)', async () => {
    const jobDir = path.join(tmpDir, 'job3');
    setupJob(jobDir, { id: 'test-3' }, {
      alice: { member: 'alice', state: 'queued' },
    });
    const result = await computeStatus(jobDir);
    expect(result.overallState).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('counts error states correctly', async () => {
    const jobDir = path.join(tmpDir, 'job4');
    setupJob(jobDir, { id: 'test-4' }, {
      alice: { member: 'alice', state: 'error', exitCode: 1 },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
      carol: { member: 'carol', state: 'missing_cli' },
    });
    const result = await computeStatus(jobDir);
    expect(result.overallState).toBe('done');
    expect(result.counts.error).toBe(1);
    expect(result.counts.missing_cli).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('skips reviewer directories without status.json', async () => {
    const jobDir = path.join(tmpDir, 'job7');
    setupJob(jobDir, { id: 'test-7' }, {
      alice: { member: 'alice', state: 'done' },
    });
    fs.mkdirSync(path.join(jobDir, 'members', 'bob'));
    const result = await computeStatus(jobDir);
    expect(result.counts.total).toBe(1);
    expect(result.members.length).toBe(1);
  });

  test('sorts reviewers alphabetically by name', async () => {
    const jobDir = path.join(tmpDir, 'job8');
    setupJob(jobDir, { id: 'test-8' }, {
      carol: { member: 'carol', state: 'done' },
      alice: { member: 'alice', state: 'done' },
      bob: { member: 'bob', state: 'done' },
    });
    const result = await computeStatus(jobDir);
    expect(result.members[0].member).toBe('alice');
    expect(result.members[1].member).toBe('bob');
    expect(result.members[2].member).toBe('carol');
  });

  test('includes reviewer metadata (startedAt, finishedAt, exitCode, message)', async () => {
    const jobDir = path.join(tmpDir, 'job9');
    setupJob(jobDir, { id: 'test-9' }, {
      alice: {
        member: 'alice',
        state: 'done',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:01:00Z',
        exitCode: 0,
        message: 'success',
      },
    });
    const result = await computeStatus(jobDir);
    expect(result.members[0].startedAt).toBe('2026-01-01T00:00:00Z');
    expect(result.members[0].finishedAt).toBe('2026-01-01T00:01:00Z');
    expect(result.members[0].exitCode).toBe(0);
    expect(result.members[0].message).toBe('success');
  });

  test('returns null for missing reviewer metadata fields', async () => {
    const jobDir = path.join(tmpDir, 'job10');
    setupJob(jobDir, { id: 'test-10' }, {
      alice: { member: 'alice', state: 'running' },
    });
    const result = await computeStatus(jobDir);
    expect(result.members[0].startedAt).toBe(null);
    expect(result.members[0].finishedAt).toBe(null);
    expect(result.members[0].exitCode).toBe(null);
    expect(result.members[0].message).toBe(null);
  });

  test('includes jobDir and id in result', async () => {
    const jobDir = path.join(tmpDir, 'job11');
    setupJob(jobDir, { id: 'test-11' }, {
      alice: { member: 'alice', state: 'done' },
    });
    const result = await computeStatus(jobDir);
    expect(result.id).toBe('test-11');
    expect(result.jobDir.endsWith('job11')).toBeTruthy();
  });

  test('includes chairmanRole from job.json', async () => {
    const jobDir = path.join(tmpDir, 'job12');
    setupJob(jobDir, { id: 'test-12', chairmanRole: 'claude' }, {
      alice: { member: 'alice', state: 'done' },
    });
    const result = await computeStatus(jobDir);
    expect(result.chairmanRole).toBe('claude');
  });

  test('treats retrying reviewer as non-terminal (running)', async () => {
    const jobDir = path.join(tmpDir, 'job13');
    setupJob(jobDir, { id: 'test-13' }, {
      alice: { member: 'alice', state: 'done', exitCode: 0 },
      bob: { member: 'bob', state: 'retrying' },
    });
    const result = await computeStatus(jobDir);
    expect(result.overallState).toBe('running');
    expect(result.counts.retrying).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('transitions stale queued reviewer to error when queuedAt exceeds threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-stale');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-stale', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.queued).toBe(0);
  });

  test('does not transition queued reviewer that is within staleness threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-fresh');
    const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-fresh', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: freshTime },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('uses 120s minimum threshold when timeoutSec is 0', async () => {
    const jobDir = path.join(tmpDir, 'job-zero-timeout');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-zero', settings: { timeoutSec: 0 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
    });
    // threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
  });

  test('uses file mtime as fallback when queuedAt is missing', async () => {
    const jobDir = path.join(tmpDir, 'job-no-queued-at');
    setupJob(jobDir, { id: 'test-mtime', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued' },
    });
    // Force the file mtime to be old
    const statusPath = path.join(jobDir, 'members', 'alice', 'status.json');
    const oldTime = new Date(Date.now() - 200_000);
    fs.utimesSync(statusPath, oldTime, oldTime);
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
  });

  test('writes error details to status.json on staleness transition', async () => {
    const jobDir = path.join(tmpDir, 'job-stale-write');
    const staleTime = new Date(Date.now() - 200_000).toISOString();
    setupJob(jobDir, { id: 'test-write', settings: { timeoutSec: 30 } }, {
      alice: { member: 'alice', state: 'queued', queuedAt: staleTime },
    });
    await computeStatus(jobDir);
    const statusPath = path.join(jobDir, 'members', 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(written.state).toBe('error');
    expect(written.error.includes('stale')).toBe(true);
  });

  // ---- Running worker staleness ----

  test('preserves normal running worker within threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-run-fresh');
    const recentStart = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-run-fresh', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: recentStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 10s < 120s → not stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  test('transitions stale running worker to error when startedAt exceeds threshold', async () => {
    const jobDir = path.join(tmpDir, 'job-run-stale');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
      bob: { member: 'bob', state: 'done', exitCode: 0 },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('CAS guard: does not transition if running worker changed state during re-read', async () => {
    const jobDir = path.join(tmpDir, 'job-run-cas');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-cas', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    // Simulate race: spawn a background process that overwrites the file to 'done'
    // during the 250ms CAS sleep window (Atomics.wait blocks the event loop,
    // so setTimeout won't fire — only an external process can write the file).
    const statusPath = path.join(jobDir, 'members', 'alice', 'status.json');
    const donePayload = JSON.stringify({ member: 'alice', state: 'done', startedAt: staleStart, exitCode: 0 });
    Bun.spawn(['bash', '-c', `sleep 0.1 && printf '%s' '${donePayload}' > "${statusPath}"`]);
    const result = await computeStatus(jobDir);
    const alice = result.members.find(r => r.member === 'alice');
    // CAS re-read sees 'done' → preserves 'done', does NOT overwrite with error
    expect(alice.state).toBe('done');
    expect(result.counts.error).toBe(0);
  });

  test('writes error details to status.json on running staleness transition', async () => {
    const jobDir = path.join(tmpDir, 'job-run-stale-write');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale-write', settings: { timeoutSec: 60 } }, {
      alice: { member: 'alice', state: 'running', startedAt: staleStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    await computeStatus(jobDir);
    const statusPath = path.join(jobDir, 'members', 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(written.state).toBe('error');
    expect(written.error).toContain('running for');
    expect(written.error).toContain('seconds');
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

  // CLAUDECODE: '' is intentional — it prevents Claude CLI nested session errors.
  // buildAugmentedCommand always injects this env override for 'claude' CLI type
  // (see job.js buildAugmentedCommand), so it is not an "extra" field but a
  // required guard that must appear in every claude-type env expectation.
  test('no fields present: returns command unchanged with empty env', () => {
    const result = buildAugmentedCommand({ command: 'claude -p' }, 'claude');
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('falsy values (empty string, null): treated as absent', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: '', effort_level: null },
      'claude',
    );
    expect(result.command).toBe('claude -p');
    expect(result.env).toEqual({ CLAUDECODE: '' });
  });

  test('falsy values (undefined): treated as absent', () => {
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
// gcStaleJobs
// ---------------------------------------------------------------------------

describe('gcStaleJobs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('deletes chunk-review-* directories older than 1 hour', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const staleDir = path.join(jobsDir, 'chunk-review-stale-001');
    fs.mkdirSync(staleDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(staleDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-stale-001', createdAt: twoHoursAgo }),
    );

    gcStaleJobs(jobsDir);

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

    gcStaleJobs(jobsDir);

    expect(fs.existsSync(freshDir)).toBe(true);
  });

  test('skips directories with missing job.json', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const noJsonDir = path.join(jobsDir, 'chunk-review-nojson-001');
    fs.mkdirSync(noJsonDir, { recursive: true });
    // No job.json written

    gcStaleJobs(jobsDir);

    expect(fs.existsSync(noJsonDir)).toBe(true);
  });

  test('skips directories with malformed job.json', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const badJsonDir = path.join(jobsDir, 'chunk-review-badjson-001');
    fs.mkdirSync(badJsonDir, { recursive: true });
    fs.writeFileSync(path.join(badJsonDir, 'job.json'), '{{not valid json}}');

    gcStaleJobs(jobsDir);

    expect(fs.existsSync(badJsonDir)).toBe(true);
  });

  test('skips non-chunk-review directories', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const otherDir = path.join(jobsDir, 'spec-review-other-001');
    fs.mkdirSync(otherDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(otherDir, 'job.json'),
      JSON.stringify({ id: 'spec-review-other-001', createdAt: twoHoursAgo }),
    );

    gcStaleJobs(jobsDir);

    expect(fs.existsSync(otherDir)).toBe(true);
  });

  test('path traversal guard prevents deletion outside jobsDir', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    // Create a target directory outside jobsDir
    const outsideDir = path.join(tmpDir, 'outside-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(
      path.join(outsideDir, 'job.json'),
      JSON.stringify({ id: 'chunk-review-symlink', createdAt: twoHoursAgo }),
    );

    // Create a symlink inside jobsDir that points outside
    const symlinkPath = path.join(jobsDir, 'chunk-review-symlink');
    fs.symlinkSync(outsideDir, symlinkPath);

    gcStaleJobs(jobsDir);

    // The outside directory must still exist
    expect(fs.existsSync(outsideDir)).toBe(true);
  });
});
// cmdClean — path traversal guard (Fix A)
// ---------------------------------------------------------------------------

describe('cmdClean path traversal guard', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rejects a path outside the configured jobs directory', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const outsidePath = path.join(tmpDir, 'not-jobs', 'evil');
    fs.mkdirSync(outsidePath, { recursive: true });

    try {
      execFileSync(process.execPath, [
        SCRIPT, 'clean', '--jobs-dir', jobsDir, outsidePath,
      ], { stdio: 'pipe' });
      throw new Error('Expected execFileSync to throw');
    } catch (err) {
      expect(err.status).toBe(1);
      expect(err.stderr.toString().includes('refusing to delete path outside jobs directory')).toBe(true);
    }

    // The outside directory must still exist (not deleted)
    expect(fs.existsSync(outsidePath)).toBe(true);
  });

  test('accepts and cleans a path inside the configured jobs directory', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const jobDir = path.join(jobsDir, 'chunk-review-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'dummy.txt'), 'test');

    const result = execFileSync(process.execPath, [
      SCRIPT, 'clean', '--jobs-dir', jobsDir, jobDir,
    ], { stdio: 'pipe' });

    expect(result.toString().includes('cleaned:')).toBe(true);
    expect(!fs.existsSync(jobDir)).toBe(true);
  });

  test('cleans a custom jobs-dir job without --jobs-dir flag when job.json exists', () => {
    // Simulate a job created with --jobs-dir /custom: the job directory is NOT
    // under the default jobs directory, but it contains job.json proving it's real.
    const customJobsDir = path.join(tmpDir, 'custom-jobs');
    const jobDir = path.join(customJobsDir, 'chunk-review-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test-custom' }));
    fs.writeFileSync(path.join(jobDir, 'dummy.txt'), 'test');

    // Clean WITHOUT --jobs-dir (direct jobDir argument)
    const result = execFileSync(process.execPath, [
      SCRIPT, 'clean', jobDir,
    ], { stdio: 'pipe' });

    expect(result.toString().includes('cleaned:')).toBe(true);
    expect(!fs.existsSync(jobDir)).toBe(true);
  });

  test('rejects a path outside jobs directory without job.json', () => {
    // An arbitrary directory without job.json should still be rejected
    const outsidePath = path.join(tmpDir, 'not-a-job');
    fs.mkdirSync(outsidePath, { recursive: true });
    fs.writeFileSync(path.join(outsidePath, 'important.txt'), 'do not delete');

    try {
      execFileSync(process.execPath, [
        SCRIPT, 'clean', outsidePath,
      ], { stdio: 'pipe' });
      throw new Error('Expected execFileSync to throw');
    } catch (err) {
      expect(err.status).toBe(1);
      expect(err.stderr.toString().includes('refusing to delete path outside jobs directory')).toBe(true);
    }

    // The directory must still exist
    expect(fs.existsSync(outsidePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spawnWorkers — safe name collision detection (Fix B)
// ---------------------------------------------------------------------------

describe('spawnWorkers safe name collision detection', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('exits with error when two reviewers produce the same safe name', () => {
    // Create a config where two reviewers collide case-insensitively:
    // "Alice" and "alice" are the same name when lowercased
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: none',
      '  members:',
      '    - name: "Alice"',
      '      command: echo test1',
      '    - name: "alice"',
      '      command: echo test2',
      '  settings:',
      '    exclude_chairman_from_members: false',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    try {
      execFileSync(process.execPath, [
        SCRIPT, 'start',
        '--config', configPath,
        '--jobs-dir', jobsDir,
        '--chairman', 'none',
        'test prompt',
      ], { stdio: 'pipe' });
      throw new Error('Expected execFileSync to throw');
    } catch (err) {
      expect(err.status).toBe(1);
      expect(err.stderr.toString().includes('member name collision')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// --exclude-chairman=false boolean parsing (Bug fix)
// ---------------------------------------------------------------------------

describe('--exclude-chairman=false keeps chairman in reviewers', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--exclude-chairman=false does NOT exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--exclude-chairman=false',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    expect(memberNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromMembers).toBe(false);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('--exclude-chairman (no value) DOES exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: false',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--exclude-chairman',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    expect(!memberNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromMembers).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('--exclude-chairman=false with --include-chairman=false falls back to config default', () => {
    // Both flags explicitly set to false — config says exclude, so chairman should be excluded
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--exclude-chairman=false',
      '--include-chairman=false',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    // --exclude-chairman=false overrides config to false (don't exclude)
    // --include-chairman=false means no force-include
    // So excludeChairmanFromMembers=false, includeChairman=false → chairman included
    expect(memberNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromMembers).toBe(false);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('--exclude-chairman=true DOES exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: false',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--exclude-chairman=true',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    expect(!memberNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromMembers).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });
});

// ---------------------------------------------------------------------------
// --include-chairman=false boolean parsing (Bug fix: Boolean("false")===true)
// ---------------------------------------------------------------------------

describe('--include-chairman=false normalizeBool parsing', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--include-chairman=false does NOT force-include chairman (config exclude=true respected)', () => {
    // Config says exclude chairman. --include-chairman=false should NOT override that.
    // Bug: Boolean("false") === true, so chairman was incorrectly force-included.
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--include-chairman=false',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    // --include-chairman=false → includeChairman should be false
    // excludeChairmanOverride should be null (fallback to config default: true)
    // So chairman should be excluded
    expect(!memberNames.includes('claude')).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('--include-chairman=true force-includes chairman even when config excludes', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--include-chairman=true',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    // --include-chairman=true → includeChairman=true, force-include chairman
    expect(memberNames.includes('claude')).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('--include-chairman (no value) force-includes chairman', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--include-chairman',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    // --include-chairman (boolean flag) → true → force-include
    expect(memberNames.includes('claude')).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  test('(no --include-chairman) falls back to config default for exclusion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  members:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'claude',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const memberNames = output.members.map(r => r.name);
    // No flag → config default (exclude=true), no force-include → chairman excluded
    expect(!memberNames.includes('claude')).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe('cmdResults', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir: string;

  function setupJobFixture(
    jobDir: string,
    members: Record<string, { member: string; state: string; exitCode: number; output: string; stderr: string }>,
    opts?: { prompt?: string },
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test-results' }));
    if (opts?.prompt) {
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), opts.prompt);
    }
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, data] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'status.json'),
        JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }),
      );
      if (data.output || data.state === 'done') {
        fs.writeFileSync(path.join(dir, 'output.txt'), data.output);
      }
      fs.writeFileSync(path.join(dir, 'error.txt'), data.stderr);
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--json 출력에서 prompt, stderr 필드가 제거됨', () => {
    const jobDir = path.join(tmpDir, 'job-qa1');
    const largeStderr = 'x'.repeat(33000);
    const largePrompt = 'p'.repeat(30000);
    setupJobFixture(
      jobDir,
      { 'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'review output', stderr: largeStderr } },
      { prompt: largePrompt },
    );

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed).not.toHaveProperty('prompt');
    expect(parsed.members[0]).not.toHaveProperty('stderr');
    expect(parsed.members[0].output).toBe('review output');
    expect(parsed.members[0].member).toBe('claude');
    expect(parsed.members[0].state).toBe('done');
    expect(parsed.members[0].exitCode).toBe(0);
    expect(parsed.id).toBe('test-results');
    expect(parsed.jobDir).toBe(path.resolve(jobDir));
  });

  test('3 reviewers --json 출력이 30000자 미만', () => {
    const jobDir = path.join(tmpDir, 'job-qa2');
    setupJobFixture(
      jobDir,
      {
        'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'claude review', stderr: 'x'.repeat(33000) },
        'codex-0': { member: 'codex', state: 'done', exitCode: 0, output: 'codex review', stderr: 'x'.repeat(33000) },
        'gemini-0': { member: 'gemini', state: 'error', exitCode: 1, output: 'gemini review', stderr: 'x'.repeat(33000) },
      },
      { prompt: 'p'.repeat(30000) },
    );

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const output = result.toString();

    expect(output.length).toBeLessThan(30000);
    const parsed = JSON.parse(output);
    expect(parsed.members).toHaveLength(3);
  });

  test('non-JSON: output 비어있으면 stderr fallback 출력', () => {
    const jobDir = path.join(tmpDir, 'job-qa3');
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'error', exitCode: 1, output: '', stderr: 'stderr-fallback-content' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    const stdout = result.toString();

    expect(stdout).toContain('stderr-fallback-content');
  });

  test('non-JSON: output 있으면 output 출력, stderr 미포함', () => {
    const jobDir = path.join(tmpDir, 'job-qa4');
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'primary-output-content', stderr: 'hidden-stderr-content' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    const stdout = result.toString();

    expect(stdout).toContain('primary-output-content');
    expect(stdout).not.toContain('hidden-stderr-content');
  });

  test('--manifest: done reviewer의 outputFilePath가 job dir 내 output.txt 참조', () => {
    const jobDir = path.join(tmpDir, 'job-manifest1');
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'claude review output here', stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed.id).toBe('test-results');
    expect(parsed.members).toHaveLength(1);
    expect(parsed.members[0].member).toBe('claude');
    expect(parsed.members[0].outputFilePath).toBeTruthy();
    expect(parsed.members[0].outputFilePath).toContain('output.txt');
    expect(parsed.members[0].outputFilePath).toContain(path.join('members', 'claude-0'));
    expect(parsed.members[0].errorMessage).toBeNull();

    const fileContent = fs.readFileSync(parsed.members[0].outputFilePath, 'utf8');
    expect(fileContent).toBe('claude review output here');
  });

  test('--manifest: failed/non_retryable reviewer의 outputFilePath가 null + errorMessage 존재', () => {
    const jobDir = path.join(tmpDir, 'job-manifest2');
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'valid output', stderr: '' },
      'codex-0': { member: 'codex', state: 'error', exitCode: 1, output: '', stderr: 'some error' },
      'gemini-0': { member: 'gemini', state: 'non_retryable', exitCode: 42, output: '', stderr: 'quota exceeded' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed.members).toHaveLength(3);

    const claude = parsed.members.find((r: any) => r.member === 'claude');
    const codex = parsed.members.find((r: any) => r.member === 'codex');
    const gemini = parsed.members.find((r: any) => r.member === 'gemini');

    expect(claude.outputFilePath).toBeTruthy();
    expect(claude.errorMessage).toBeNull();
    expect(codex.outputFilePath).toBeNull();
    expect(codex.errorMessage).toBeTruthy();
    expect(gemini.outputFilePath).toBeNull();
    expect(gemini.errorMessage).toBeTruthy();
  });

  test('--manifest: JSON schema 검증 (id, reviewers 필드 구조)', () => {
    const jobDir = path.join(tmpDir, 'job-manifest3');
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'output A', stderr: '' },
      'codex-0': { member: 'codex', state: 'done', exitCode: 0, output: 'output B', stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    // Top-level schema
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('members');
    expect(Array.isArray(parsed.members)).toBe(true);

    // Must NOT have jobDir (unlike --json mode)
    expect(parsed).not.toHaveProperty('jobDir');

    // Each reviewer must have exactly 3 fields (member, outputFilePath, errorMessage)
    for (const r of parsed.members) {
      expect(r).toHaveProperty('member');
      expect(r).toHaveProperty('outputFilePath');
      expect(r).toHaveProperty('errorMessage');
      // Must NOT have legacy fields
      expect(r).not.toHaveProperty('state');
      expect(r).not.toHaveProperty('exitCode');
      expect(r).not.toHaveProperty('message');
      expect(r).not.toHaveProperty('outputFile');
      // Must NOT have output inline (unlike --json mode)
      expect(r).not.toHaveProperty('output');
    }
  });

  test('--manifest: stdout가 경량 (2KB 미만, output 인라인 없음)', () => {
    const jobDir = path.join(tmpDir, 'job-manifest4');
    const largeOutput = 'x'.repeat(50000);
    setupJobFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
      'codex-0': { member: 'codex', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
      'gemini-0': { member: 'gemini', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const output = result.toString();

    // Manifest stdout must be tiny regardless of output size
    expect(output.length).toBeLessThan(2000);

    const parsed = JSON.parse(output);
    expect(parsed.members).toHaveLength(3);

    // Each outputFilePath must point to job dir and contain the large output
    for (const r of parsed.members) {
      expect(r.outputFilePath).toBeTruthy();
      expect(r.outputFilePath).toContain('output.txt');
      const content = fs.readFileSync(r.outputFilePath, 'utf8');
      expect(content.length).toBe(50000);
    }
  });
});

// ---------------------------------------------------------------------------
// buildManifest (unit)
// ---------------------------------------------------------------------------

describe('buildManifest', () => {
  let tmpDir: string;

  function setupManifestFixture(
    jobDir: string,
    members: Record<string, { member: string; state: string; exitCode: number; output: string }>,
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'manifest-test' }));
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, data] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'status.json'),
        JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode, message: data.state === 'error' ? 'failed' : undefined }),
      );
      if (data.output) {
        fs.writeFileSync(path.join(dir, 'output.txt'), data.output);
      }
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('올바른 manifest 구조 반환 (done 리뷰어)', () => {
    const jobDir = path.join(tmpDir, 'job-bm1');
    setupManifestFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'review A' },
      'codex-0': { member: 'codex', state: 'done', exitCode: 0, output: 'review B' },
    });

    const manifest = buildManifest(jobDir);

    expect(manifest.id).toBe('manifest-test');
    expect(manifest.members).toHaveLength(2);
    // Sorted alphabetically
    expect(manifest.members[0].member).toBe('claude');
    expect(manifest.members[1].member).toBe('codex');
    // Done reviewers have outputFilePath and null errorMessage
    for (const r of manifest.members) {
      expect(r.outputFilePath).toBeTruthy();
      expect(r.outputFilePath).toContain('output.txt');
      expect(r.errorMessage).toBeNull();
    }
  });

  test('output 없는 리뷰어는 outputFilePath=null, errorMessage 설정', () => {
    const jobDir = path.join(tmpDir, 'job-bm2');
    setupManifestFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'has output' },
      'gemini-0': { member: 'gemini', state: 'error', exitCode: 1, output: '' },
    });

    const manifest = buildManifest(jobDir);
    const claude = manifest.members.find((r: any) => r.member === 'claude');
    const gemini = manifest.members.find((r: any) => r.member === 'gemini');

    expect(claude.outputFilePath).toBeTruthy();
    expect(claude.errorMessage).toBeNull();
    expect(gemini.outputFilePath).toBeNull();
    expect(gemini.errorMessage).toBeTruthy();
  });

  test('job.json 없으면 id=unknown', () => {
    const jobDir = path.join(tmpDir, 'job-bm3');
    fs.mkdirSync(jobDir, { recursive: true });
    // No job.json, no reviewers
    const manifest = buildManifest(jobDir);
    expect(manifest.id).toBe('unknown');
    expect(manifest.members).toHaveLength(0);
  });

  test('_safeName 내부 필드가 외부에 노출되지 않음', () => {
    const jobDir = path.join(tmpDir, 'job-bm4');
    setupManifestFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'data' },
    });

    const manifest = buildManifest(jobDir);
    for (const r of manifest.members) {
      expect(r).not.toHaveProperty('_safeName');
    }
  });
});

// ---------------------------------------------------------------------------
// cmdCollect (process-level)
// ---------------------------------------------------------------------------

describe('cmdCollect', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir: string;

  function setupCollectFixture(
    jobDir: string,
    members: Record<string, { member: string; state: string; exitCode: number; output: string }>,
    opts?: { timeoutSec?: number },
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'job.json'),
      JSON.stringify({ id: 'collect-test', settings: { timeoutSec: opts?.timeoutSec ?? 60 } }),
    );
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, data] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'status.json'),
        JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }),
      );
      if (data.output) {
        fs.writeFileSync(path.join(dir, 'output.txt'), data.output);
      }
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('done 상태: manifest JSON 반환', () => {
    const jobDir = path.join(tmpDir, 'job-collect-done');
    setupCollectFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'review output A' },
      'codex-0': { member: 'codex', state: 'done', exitCode: 0, output: 'review output B' },
    });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'collect', '--timeout-ms', '5000', jobDir,
    ], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed.overallState).toBe('done');
    expect(parsed.id).toBe('collect-test');
    expect(parsed.members).toHaveLength(2);
    expect(parsed.members[0].member).toBe('claude');
    expect(parsed.members[0].outputFilePath).toBeTruthy();
    expect(parsed.members[0].errorMessage).toBeNull();
  });

  test('timeout: not-done JSON 반환 (overallState, id, counts)', () => {
    const jobDir = path.join(tmpDir, 'job-collect-timeout');
    setupCollectFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'running', exitCode: 0, output: '' },
      'codex-0': { member: 'codex', state: 'queued', exitCode: 0, output: '' },
    });
    // Set running member as stale (startedAt 200s ago) to trigger CAS sleep (~250ms) in
    // computeStatus, making the timeout-ms check fire reliably after the first poll.
    // Keep queuedAt fresh to prevent the queued member from also becoming stale.
    const membersDir = path.join(jobDir, 'members');
    const staleTs = new Date(Date.now() - 200_000).toISOString();
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(membersDir, 'claude-0', 'status.json'),
      JSON.stringify({ member: 'claude', state: 'running', exitCode: 0, startedAt: staleTs }),
    );
    fs.writeFileSync(
      path.join(membersDir, 'codex-0', 'status.json'),
      JSON.stringify({ member: 'codex', state: 'queued', exitCode: 0, queuedAt: now }),
    );

    // timeout-ms=200: computeStatus sleeps ~250ms due to stale CAS, so elapsed >= 200 fires
    const result = execFileSync(process.execPath, [
      SCRIPT, 'collect', '--timeout-ms', '200', jobDir,
    ], { stdio: 'pipe', timeout: 10000 });
    const parsed = JSON.parse(result.toString());

    expect(parsed.overallState).not.toBe('done');
    expect(parsed.id).toBe('collect-test');
    expect(parsed).toHaveProperty('counts');
    expect(parsed.counts).toHaveProperty('total');
    expect(parsed.counts).toHaveProperty('running');
    expect(parsed.counts).toHaveProperty('queued');
    // Must NOT have reviewers array (that's manifest-only)
    expect(parsed).not.toHaveProperty('members');
  });

  test('hardcap: timeout-ms=999999 → 300000 이하로 클램프', () => {
    // We can't easily verify the internal clamp value directly, but we can verify
    // the command completes within a reasonable time (not 999 seconds).
    // With all reviewers done, it should return immediately regardless of timeout.
    const jobDir = path.join(tmpDir, 'job-collect-hardcap');
    setupCollectFixture(jobDir, {
      'claude-0': { member: 'claude', state: 'done', exitCode: 0, output: 'data' },
    });

    const start = Date.now();
    const result = execFileSync(process.execPath, [
      SCRIPT, 'collect', '--timeout-ms', '999999', jobDir,
    ], { stdio: 'pipe', timeout: 10000 });
    const elapsed = Date.now() - start;
    const parsed = JSON.parse(result.toString());

    // Should return immediately since all reviewers are done
    expect(parsed.overallState).toBe('done');
    expect(elapsed).toBeLessThan(5000);
  });

  test('collect: jobDir 누락 시 에러', () => {
    try {
      execFileSync(process.execPath, [SCRIPT, 'collect'], { stdio: 'pipe' });
      throw new Error('Expected execFileSync to throw');
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('collect: missing jobDir');
    }
  });
});

// ---------------------------------------------------------------------------
// start + collect integration
// ---------------------------------------------------------------------------

describe('start + collect integration', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTestConfig(dir: string): string {
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: none',
      '  members:',
      '    - name: r1',
      '      command: echo r1',
      '    - name: r2',
      '      command: echo r2',
      '  settings:',
      '    exclude_chairman_from_members: false',
      '    timeout: 10',
    ].join('\n'));
    return configPath;
  }

  function cleanupJob(jobDir: string) {
    try { execFileSync(process.execPath, [SCRIPT, 'stop', jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', jobDir], { stdio: 'pipe' }); } catch {}
  }

  test('전체 파이프라인: start --prompt-file → mock done → collect → manifest JSON', () => {
    const configPath = writeTestConfig(tmpDir);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    // Write prompt file
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'Review this code for bugs');

    // start: create job via --prompt-file
    const startResult = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'none',
      '--prompt-file', promptFile,
    ], { stdio: 'pipe', timeout: 15000 });
    const jobDir = startResult.toString().trim();
    expect(fs.existsSync(jobDir)).toBe(true);

    try {
      // Verify job structure was created
      const jobJson = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
      expect(jobJson.members).toHaveLength(2);
      const memberNames = jobJson.members.map((r: any) => r.name);
      expect(memberNames).toContain('r1');
      expect(memberNames).toContain('r2');

      // Verify prompt was stored
      const storedPrompt = fs.readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8');
      expect(storedPrompt).toBe('Review this code for bugs');

      // Mock done status for each reviewer
      const membersDir = path.join(jobDir, 'members');
      for (const entry of fs.readdirSync(membersDir)) {
        const statusPath = path.join(membersDir, entry, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        fs.writeFileSync(statusPath, JSON.stringify({
          member: status.member,
          state: 'done',
          exitCode: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        }));
        fs.writeFileSync(
          path.join(membersDir, entry, 'output.txt'),
          `Review output from ${status.member}`,
        );
      }

      // collect: poll until done and return manifest
      const collectResult = execFileSync(process.execPath, [
        SCRIPT, 'collect', '--timeout-ms', '5000', jobDir,
      ], { stdio: 'pipe', timeout: 15000 });
      const manifest = JSON.parse(collectResult.toString());

      expect(manifest.overallState).toBe('done');
      expect(manifest.members).toHaveLength(2);
      for (const reviewer of manifest.members) {
        expect(reviewer.outputFilePath).toBeTruthy();
        expect(fs.existsSync(reviewer.outputFilePath)).toBe(true);
        expect(reviewer.errorMessage).toBeNull();
      }
    } finally {
      cleanupJob(jobDir);
    }
  }, 30000);

  test('짧은 timeout: queued 상태에서 not-done 반환', () => {
    // Use slow commands (sleep 60) so workers stay in running state and never
    // complete before collect times out.
    const configPath = path.join(tmpDir, 'config-slow.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: none',
      '  members:',
      '    - name: r1',
      '      command: sleep 60',
      '    - name: r2',
      '      command: sleep 60',
      '  settings:',
      '    exclude_chairman_from_members: false',
      '    timeout: 10',
    ].join('\n'));
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    // Write prompt file
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'Review this code');

    // start: create job
    const startResult = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'none',
      '--prompt-file', promptFile,
    ], { stdio: 'pipe', timeout: 15000 });
    const jobDir = startResult.toString().trim();

    try {
      // Workers run `sleep 60` — they are queued/running and will not complete during the test.
      // collect with 200ms timeout: computeStatus returns quickly, timeout fires after first poll
      // because elapsed time after I/O exceeds the short timeout.
      const membersDir = path.join(jobDir, 'members');
      const now = new Date().toISOString();
      for (const entry of fs.readdirSync(membersDir)) {
        const statusPath = path.join(membersDir, entry, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        fs.writeFileSync(statusPath, JSON.stringify({
          member: status.member,
          state: 'queued',
          exitCode: 0,
          queuedAt: now,
        }));
      }

      // collect with 1ms timeout: workers are running `sleep 60` and will not complete,
      // so every poll returns not-done and the timeout fires quickly
      const collectResult = execFileSync(process.execPath, [
        SCRIPT, 'collect', '--timeout-ms', '1', jobDir,
      ], { stdio: 'pipe', timeout: 10000 });
      const parsed = JSON.parse(collectResult.toString());

      expect(parsed.overallState).not.toBe('done');
      expect(parsed).toHaveProperty('counts');
      expect(parsed.counts.total).toBe(2);
      // Should NOT have reviewers array (that's manifest-only, returned only when done)
      expect(parsed).not.toHaveProperty('members');
    } finally {
      cleanupJob(jobDir);
    }
  }, 30000);
});

#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

import {
  buildUiPayload,
  parseSpecReviewConfig,
  parseYamlSimple,
  computeStatus,
  resolveContextDir,
  findProjectRoot,
} from './job.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'job-test-'));
}

// ---------------------------------------------------------------------------
// parseYamlSimple
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir;
  const fallback = {
    'spec-review': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
      ],
      context: {},
      settings: { exclude_chairman_from_members: true, timeout: 180 },
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
      'spec-review:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.role).toBe('gemini');
  });

  test('parses context section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  context:',
      '    shared_context_dir: .omt/ctx',
      '    specs_dir: specs',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].context.shared_context_dir).toBe('.omt/ctx');
    expect(result['spec-review'].context.specs_dir).toBe('specs');
  });

  test('parses settings section with type coercion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  settings:',
      '    timeout: 300',
      '    exclude_chairman_from_members: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].settings.timeout).toBe(300);
    expect(result['spec-review'].settings.exclude_chairman_from_members).toBe(false);
  });

  test('skips comment lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '# This is a comment',
      'spec-review:',
      '  chairman:',
      '    # Another comment',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.role).toBe('codex');
  });

  test('falls back to default reviewers when none defined', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      '    role: auto',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].members).toEqual(fallback['spec-review'].members);
  });

  test('returns fallback on read error (non-existent file)', () => {
    const result = parseYamlSimple(path.join(tmpDir, 'missing.yaml'), fallback);
    expect(result).toEqual(fallback);
  });

  test('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      '    name: custom',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.name).toBe('custom');
    expect(result['spec-review'].chairman.role).toBe('auto');
  });

  test('parses members section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].members.length).toBe(1);
    expect(result['spec-review'].members[0].name).toBe('alice');
  });

  test('strips quotes from reviewer name values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  members:',
      '    - name: "quoted-name"',
      '      command: some-cmd',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].members[0].name).toBe('quoted-name');
  });

  test('skips empty lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '',
      '  chairman:',
      '',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.role).toBe('codex');
  });

  test('coerces "true" string to boolean true in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  settings:',
      '    verbose: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].settings.verbose).toBe(true);
  });

  test('strips inline comment from integer value', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  settings:',
      '    timeout: 180 # default',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].settings.timeout).toBe(180);
  });

  test('strips inline comment from string value', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      '    role: auto # resolved at runtime',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.role).toBe('auto');
  });

  test('preserves # inside quoted string values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      '    role: "value#with#hash"',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].chairman.role).toBe('value#with#hash');
  });
});

// ---------------------------------------------------------------------------
// parseSpecReviewConfig
// ---------------------------------------------------------------------------

describe('parseSpecReviewConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns fallback when config file does not exist', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'missing.yaml'));
    expect(result['spec-review']).toBeTruthy();
    expect(Array.isArray(result['spec-review'].members)).toBeTruthy();
    expect(result['spec-review'].members.length > 0).toBeTruthy();
    expect(result['spec-review'].chairman.role).toBe('auto');
  });

  test('fallback contains default reviewers (claude, codex, gemini)', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const names = result['spec-review'].members.map(r => r.name);
    expect(names.includes('claude')).toBeTruthy();
    expect(names.includes('codex')).toBeTruthy();
    expect(names.includes('gemini')).toBeTruthy();
  });

  test('fallback contains default settings', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    expect(result['spec-review'].settings.exclude_chairman_from_members).toBe(true);
    expect(result['spec-review'].settings.timeout).toBe(180);
  });

  test('fallback contains empty context object', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    expect(result['spec-review'].context).toEqual({});
  });

  test('parses valid config via simple parser (yaml module unavailable)', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      '    role: gemini',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
      '  context:',
      '    shared_context_dir: .omt/custom-ctx',
      '  settings:',
      '    timeout: 600',
    ].join('\n'));
    const result = await parseSpecReviewConfig(configPath);
    expect(result['spec-review'].chairman.role).toBe('gemini');
    expect(result['spec-review'].members.length).toBe(1);
    expect(result['spec-review'].members[0].name).toBe('alice');
    expect(result['spec-review'].context.shared_context_dir).toBe('.omt/custom-ctx');
    expect(result['spec-review'].settings.timeout).toBe(600);
  });

  test('merges settings with defaults from fallback', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  settings:',
      '    timeout: 999',
    ].join('\n'));
    const result = await parseSpecReviewConfig(configPath);
    expect(result['spec-review'].settings.timeout).toBe(999);
    expect(result['spec-review'].settings.exclude_chairman_from_members).toBe(true);
  });

  test('returns structure with spec-review top-level key', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const keys = Object.keys(result);
    expect(keys).toEqual(['spec-review']);
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

  test('reviewer labels contain [Spec Review] prefix', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      members: [{ member: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Spec Review]')).toBeTruthy();
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
    setupJob(jobDir, { id: 'test-1', specName: 'my-spec' }, {
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

  test('includes specName from job.json', async () => {
    const jobDir = path.join(tmpDir, 'job5');
    setupJob(jobDir, { id: 'test-5', specName: 'auth-flow' }, {
      alice: { member: 'alice', state: 'done' },
    });
    const result = await computeStatus(jobDir);
    expect(result.specName).toBe('auth-flow');
  });

  test('returns null specName when not in job.json', async () => {
    const jobDir = path.join(tmpDir, 'job6');
    setupJob(jobDir, { id: 'test-6' }, {
      alice: { member: 'alice', state: 'done' },
    });
    const result = await computeStatus(jobDir);
    expect(result.specName).toBe(null);
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
});

// ---------------------------------------------------------------------------
// resolveContextDir
// ---------------------------------------------------------------------------

describe('resolveContextDir', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.OMT_PROJECT = process.env.OMT_PROJECT;
    savedEnv.HOME = process.env.HOME;
  });

  afterEach(() => {
    if (savedEnv.OMT_PROJECT === undefined) delete process.env.OMT_PROJECT;
    else process.env.OMT_PROJECT = savedEnv.OMT_PROJECT;
    if (savedEnv.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = savedEnv.HOME;
  });

  test('expands ~ to os.homedir() for tilde-prefixed path', () => {
    process.env.OMT_PROJECT = 'myproject';
    const result = resolveContextDir('~/.omt/${OMT_PROJECT}/context', '/some/root');
    expect(result).toBe(path.join(os.homedir(), '.omt', 'myproject', 'context'));
  });

  test('expands ${OMT_PROJECT} to env var value', () => {
    process.env.OMT_PROJECT = 'test-proj';
    const result = resolveContextDir('~/.omt/${OMT_PROJECT}/context', '/some/root');
    expect(result.includes('test-proj')).toBeTruthy();
  });

  test('returns null when OMT_PROJECT env var is not set and path contains ${OMT_PROJECT}', () => {
    delete process.env.OMT_PROJECT;
    const result = resolveContextDir('~/.omt/${OMT_PROJECT}/context', '/some/root');
    expect(result).toBe(null);
  });

  test('joins relative path with projectRoot when path does not start with ~', () => {
    const result = resolveContextDir('.omt/specs/context', '/my/project');
    expect(result).toBe(path.join('/my/project', '.omt/specs/context'));
  });

  test('returns absolute path unchanged when path starts with /', () => {
    const result = resolveContextDir('/absolute/path/context', '/some/root');
    expect(result).toBe('/absolute/path/context');
  });

  test('handles path without ${OMT_PROJECT} placeholder (no env var needed)', () => {
    delete process.env.OMT_PROJECT;
    const result = resolveContextDir('~/.omt/fixed/context', '/some/root');
    expect(result).toBe(path.join(os.homedir(), '.omt', 'fixed', 'context'));
  });
});

// ---------------------------------------------------------------------------
// findProjectRoot
// ---------------------------------------------------------------------------

describe('findProjectRoot', () => {
  test('returns non-null result when run from within repo', () => {
    const result = findProjectRoot();
    expect(result).not.toBe(null);
  });

  test('findProjectRoot regex matches .claude/scripts/ path', () => {
    const re = /^(.+?)\/\.(claude|gemini|codex|opencode)\/scripts\//;
    const match = '/path/to/project/.claude/scripts/spec-reviewer/job.ts'.match(re);
    expect(match).not.toBe(null);
    expect(match![1]).toBe('/path/to/project');
  });

  test('findProjectRoot regex matches .gemini/scripts/ path', () => {
    const re = /^(.+?)\/\.(claude|gemini|codex|opencode)\/scripts\//;
    const match = '/path/to/project/.gemini/scripts/spec-reviewer/job.ts'.match(re);
    expect(match).not.toBe(null);
    expect(match![1]).toBe('/path/to/project');
  });

  test('findProjectRoot regex matches .codex/scripts/ path', () => {
    const re = /^(.+?)\/\.(claude|gemini|codex|opencode)\/scripts\//;
    const match = '/path/to/project/.codex/scripts/spec-reviewer/job.ts'.match(re);
    expect(match).not.toBe(null);
    expect(match![1]).toBe('/path/to/project');
  });

  test('findProjectRoot regex matches .opencode/scripts/ path', () => {
    const re = /^(.+?)\/\.(claude|gemini|codex|opencode)\/scripts\//;
    const match = '/path/to/project/.opencode/scripts/spec-reviewer/job.ts'.match(re);
    expect(match).not.toBe(null);
    expect(match![1]).toBe('/path/to/project');
  });

  test('findProjectRoot regex does not match non-platform scripts path', () => {
    const re = /^(.+?)\/\.(claude|gemini|codex|opencode)\/scripts\//;
    const match = '/path/to/project/.other/scripts/spec-reviewer/job.ts'.match(re);
    expect(match).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// excludeChairmanOverride 플래그 파싱 (boolean flag parsing bug regression)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// cmdStart: --exclude-chairman 플래그 boolean 파싱 (회귀 방지)
// ---------------------------------------------------------------------------

describe('cmdStart: --exclude-chairman 플래그 boolean 파싱', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(chairmanRole: string, jobsDir: string): string {
    const configPath = path.join(tmpDir, 'spec-review.config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  chairman:',
      `    role: ${chairmanRole}`,
      '  members:',
      '    - name: claude',
      '      command: claude -p',
      `    - name: ${chairmanRole}`,
      '      command: echo test',
      '  settings:',
      '    exclude_chairman_from_members: true',
      '    timeout: 0',
    ].join('\n'));
    return configPath;
  }

  test('--exclude-chairman=false이면 job.json에 excludeChairmanFromMembers가 false로 저장된다', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const configPath = makeConfig('codex', jobsDir);
    execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--exclude-chairman=false',
      'test prompt',
    ], { stdio: 'pipe' });

    const jobDirs = fs.readdirSync(jobsDir).map(d => path.join(jobsDir, d));
    expect(jobDirs.length).toBe(1);
    const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDirs[0], 'job.json'), 'utf8'));
    expect(jobMeta.settings.excludeChairmanFromMembers).toBe(false);
  });

  test('--exclude-chairman=true이면 job.json에 excludeChairmanFromMembers가 true로 저장된다', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const configPath = makeConfig('codex', jobsDir);
    execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--exclude-chairman=true',
      'test prompt',
    ], { stdio: 'pipe' });

    const jobDirs = fs.readdirSync(jobsDir).map(d => path.join(jobsDir, d));
    expect(jobDirs.length).toBe(1);
    const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDirs[0], 'job.json'), 'utf8'));
    expect(jobMeta.settings.excludeChairmanFromMembers).toBe(true);
  });

  test('--exclude-chairman=false이면 chairman 역할이 members에 포함된다', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const configPath = makeConfig('codex', jobsDir);
    execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--chairman', 'codex',
      '--exclude-chairman=false',
      'test prompt',
    ], { stdio: 'pipe' });

    const jobDirs = fs.readdirSync(jobsDir).map(d => path.join(jobsDir, d));
    const jobMeta = JSON.parse(fs.readFileSync(path.join(jobDirs[0], 'job.json'), 'utf8'));
    const memberNames = jobMeta.members.map((m: any) => m.name);
    expect(memberNames.includes('codex')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe('cmdResults', () => {
  const SCRIPT = path.join(import.meta.dirname, 'job.ts');
  let tmpDir;

  function setupResultsFixture(
    jobDir: string,
    members: Record<string, { member: string; state: string; exitCode: number; output: string; stderr: string }>,
    opts?: { specName?: string; prompt?: string },
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({
      id: 'spec-review-test',
      specName: opts?.specName || null,
    }));
    if (opts?.prompt) {
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), opts.prompt);
    }
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    for (const [name, data] of Object.entries(members)) {
      const dir = path.join(membersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
        member: data.member, state: data.state, exitCode: data.exitCode,
      }));
      if (data.output !== undefined) {
        fs.writeFileSync(path.join(dir, 'output.txt'), data.output);
      }
      fs.writeFileSync(path.join(dir, 'error.txt'), data.stderr || '');
    }
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('--json 출력에 specName, prompt, stderr 필드 포함', () => {
    const jobDir = path.join(tmpDir, 'job-results-1');
    setupResultsFixture(
      jobDir,
      {
        claude: { member: 'claude', state: 'done', exitCode: 0, output: 'review output', stderr: 'some warning' },
      },
      { specName: 'auth-flow', prompt: 'review this spec' },
    );
    const raw = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(raw.toString());
    expect(parsed.specName).toBe('auth-flow');
    expect(parsed.prompt).toBe('review this spec');
    expect(parsed.members[0].stderr).toBe('some warning');
  });

  test('--json members가 알파벳 순 정렬', () => {
    const jobDir = path.join(tmpDir, 'job-results-2');
    setupResultsFixture(jobDir, {
      codex: { member: 'codex', state: 'done', exitCode: 0, output: 'codex output', stderr: '' },
      alice: { member: 'alice', state: 'done', exitCode: 0, output: 'alice output', stderr: '' },
    });
    const raw = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(raw.toString());
    expect(parsed.members[0].member).toBe('alice');
    expect(parsed.members[1].member).toBe('codex');
  });

  test('non-JSON: output 비어있으면 stderr fallback 출력', () => {
    const jobDir = path.join(tmpDir, 'job-results-3');
    setupResultsFixture(jobDir, {
      claude: { member: 'claude', state: 'error', exitCode: 1, output: '', stderr: 'fallback error content' },
    });
    const raw = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    expect(raw.toString().includes('fallback error content')).toBe(true);
  });

  test('non-JSON: output 있으면 output 출력, stderr 미포함', () => {
    const jobDir = path.join(tmpDir, 'job-results-4');
    setupResultsFixture(jobDir, {
      claude: { member: 'claude', state: 'done', exitCode: 0, output: 'primary content', stderr: 'hidden stderr' },
    });
    const raw = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    const out = raw.toString();
    expect(out.includes('primary content')).toBe(true);
    expect(out.includes('hidden stderr')).toBe(false);
  });

  test('--json 출력에서 ANSI 코드 제거됨', () => {
    const jobDir = path.join(tmpDir, 'job-results-5');
    setupResultsFixture(jobDir, {
      claude: { member: 'claude', state: 'done', exitCode: 0, output: '\x1b[31mclean output\x1b[0m', stderr: '' },
    });
    const raw = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(raw.toString());
    expect(parsed.members[0].output).toBe('clean output');
  });
});

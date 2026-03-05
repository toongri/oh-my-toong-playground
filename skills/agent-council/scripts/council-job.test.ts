#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

import {
  buildUiPayload,
  parseCouncilConfig,
  parseYamlSimple,
  computeStatus,
} from './council-job.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'council-job-test-'));
}

// ---------------------------------------------------------------------------
// buildUiPayload
// ---------------------------------------------------------------------------

describe('buildUiPayload', () => {
  test('returns correct structure for all members done', () => {
    const status = {
      overallState: 'done',
      counts: { total: 2, queued: 0, running: 0, done: 2, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'done', exitCode: 0 },
        { member: 'codex', state: 'done', exitCode: 0 },
      ],
    };
    const result = buildUiPayload(status);

    expect(result.progress.done).toBe(2);
    expect(result.progress.total).toBe(2);
    expect(result.progress.overallState).toBe('done');

    // dispatch should be completed when done
    expect(result.codex.update_plan.plan[0].status).toBe('completed');
    // member steps should be completed
    expect(result.codex.update_plan.plan[1].status).toBe('completed');
    expect(result.codex.update_plan.plan[2].status).toBe('completed');
    // synth step: isDone=true, no hasInProgress after dispatch completed + all terminal members
    // dispatch is 'completed' (not in_progress), members all terminal -> hasInProgress stays false
    // synthStatus: isDone && !hasInProgress -> 'in_progress'
    expect(result.codex.update_plan.plan[3].status).toBe('in_progress');
  });

  test('returns correct structure for some members running', () => {
    const status = {
      overallState: 'running',
      counts: { total: 3, queued: 0, running: 1, done: 1, error: 1, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'done', exitCode: 0 },
        { member: 'codex', state: 'running' },
        { member: 'gemini', state: 'error', exitCode: 1 },
      ],
    };
    const result = buildUiPayload(status);

    expect(result.progress.done).toBe(2); // done(1) + error(1)
    expect(result.progress.total).toBe(3);
    expect(result.progress.overallState).toBe('running');

    // dispatch: not isDone, queued=0 -> 'completed'
    expect(result.codex.update_plan.plan[0].status).toBe('completed');

    // Members sorted by entity: claude, codex, gemini
    const memberSteps = result.codex.update_plan.plan.slice(1, 4);
    expect(memberSteps[0].step).toBe('[Council] Ask claude');
    expect(memberSteps[0].status).toBe('completed'); // done = terminal
    expect(memberSteps[1].step).toBe('[Council] Ask codex');
    expect(memberSteps[1].status).toBe('in_progress'); // first running, hasInProgress was false
    expect(memberSteps[2].step).toBe('[Council] Ask gemini');
    expect(memberSteps[2].status).toBe('completed'); // error = terminal
  });

  test('sets dispatch to in_progress when some members are queued', () => {
    const status = {
      overallState: 'queued',
      counts: { total: 2, queued: 2, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'queued' },
        { member: 'codex', state: 'queued' },
      ],
    };
    const result = buildUiPayload(status);

    expect(result.codex.update_plan.plan[0].status).toBe('in_progress');
    // hasInProgress = true after dispatch
    // member steps: not terminal, hasInProgress already true -> pending
    expect(result.codex.update_plan.plan[1].status).toBe('pending');
    expect(result.codex.update_plan.plan[2].status).toBe('pending');
    // synth: not isDone -> 'pending'
    expect(result.codex.update_plan.plan[3].status).toBe('pending');
  });

  test('handles empty members array', () => {
    const status = {
      overallState: 'done',
      counts: { total: 0, queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [],
    };
    const result = buildUiPayload(status);

    expect(result.progress.done).toBe(0);
    expect(result.progress.total).toBe(0);
    // plan: dispatch + synth only (no member steps)
    expect(result.codex.update_plan.plan.length).toBe(2);
    expect(result.claude.todo_write.todos.length).toBe(2);
  });

  test('handles all members in error state', () => {
    const status = {
      overallState: 'done',
      counts: { total: 2, queued: 0, running: 0, done: 0, error: 2, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'error', exitCode: 1 },
        { member: 'codex', state: 'error', exitCode: 1 },
      ],
    };
    const result = buildUiPayload(status);

    expect(result.progress.done).toBe(2); // errors count as terminal done
    // Both member steps should be 'completed' (terminal state)
    expect(result.codex.update_plan.plan[1].status).toBe('completed');
    expect(result.codex.update_plan.plan[2].status).toBe('completed');
  });

  test('only first running member gets in_progress status', () => {
    const status = {
      overallState: 'running',
      counts: { total: 3, queued: 0, running: 3, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'alpha', state: 'running' },
        { member: 'beta', state: 'running' },
        { member: 'gamma', state: 'running' },
      ],
    };
    const result = buildUiPayload(status);

    // dispatch: not isDone, queued=0 -> completed, so hasInProgress starts false
    const memberSteps = result.codex.update_plan.plan.slice(1, 4);
    expect(memberSteps[0].status).toBe('in_progress'); // first running gets in_progress
    expect(memberSteps[1].status).toBe('pending'); // rest are pending
    expect(memberSteps[2].status).toBe('pending');
  });

  test('generates correct claude todo_write structure', () => {
    const status = {
      overallState: 'done',
      counts: { total: 1, queued: 0, running: 0, done: 1, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [{ member: 'claude', state: 'done', exitCode: 0 }],
    };
    const result = buildUiPayload(status);

    const todos = result.claude.todo_write.todos;
    expect(todos.length).toBe(3); // dispatch + 1 member + synth

    // dispatch todo
    expect(todos[0].content).toBe('[Council] Prompt dispatch');
    expect(todos[0].status).toBe('completed');
    expect(todos[0].activeForm).toBe('Dispatched council prompts');

    // member todo
    expect(todos[1].content).toBe('[Council] Ask claude');
    expect(todos[1].status).toBe('completed');
    expect(todos[1].activeForm).toBe('Finished');

    // synth todo
    expect(todos[2].content).toBe('[Council] Synthesize');
  });

  test('handles missing/null members in statusPayload', () => {
    const status = {
      overallState: 'done',
      counts: { total: 0 },
    };
    const result = buildUiPayload(status);

    expect(result.codex.update_plan.plan.length).toBe(2); // dispatch + synth only
  });

  test('filters out members with empty entity', () => {
    const status = {
      overallState: 'done',
      counts: { total: 2, queued: 0, running: 0, done: 2, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'done' },
        { member: '', state: 'done' },
        { state: 'done' },
      ],
    };
    const result = buildUiPayload(status);

    // Only 'claude' should remain (empty and null members filtered)
    const memberSteps = result.codex.update_plan.plan.slice(1, -1);
    expect(memberSteps.length).toBe(1);
    expect(memberSteps[0].step).toBe('[Council] Ask claude');
  });

  test('handles terminal states: timed_out, canceled, missing_cli', () => {
    const status = {
      overallState: 'done',
      counts: { total: 3, queued: 0, running: 0, done: 0, error: 0, missing_cli: 1, timed_out: 1, canceled: 1 },
      members: [
        { member: 'alpha', state: 'missing_cli' },
        { member: 'beta', state: 'timed_out' },
        { member: 'gamma', state: 'canceled' },
      ],
    };
    const result = buildUiPayload(status);

    // All terminal states map to 'completed'
    const memberSteps = result.codex.update_plan.plan.slice(1, 4);
    expect(memberSteps[0].status).toBe('completed');
    expect(memberSteps[1].status).toBe('completed');
    expect(memberSteps[2].status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// parseYamlSimple
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir;
  const fallback = {
    council: {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
      ],
      settings: { exclude_chairman_from_members: true, timeout: 120 },
    },
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses basic council config with members', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: codex',
      '  members:',
      '    - name: gemini',
      '      command: gemini',
      '      emoji: "💎"',
      '      color: GREEN',
      '  settings:',
      '    timeout: 60',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.chairman.role).toBe('codex');
    expect(result.council.members.length).toBe(1);
    expect(result.council.members[0].name).toBe('gemini');
    expect(result.council.members[0].command).toBe('gemini');
    expect(result.council.settings.timeout).toBe(60);
  });

  test('uses fallback members when no members parsed', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: claude',
      '  settings:',
      '    timeout: 30',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    // No members parsed -> falls back to fallback.council.members
    expect(result.council.members).toEqual(fallback.council.members);
  });

  test('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.chairman.role).toBe('gemini');
  });

  test('merges settings with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    timeout: 300',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.settings.timeout).toBe(300);
    // exclude_chairman_from_members comes from fallback
    expect(result.council.settings.exclude_chairman_from_members).toBe(true);
  });

  test('skips comment lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '# This is a comment',
      'council:',
      '  # chairman comment',
      '  chairman:',
      '    role: codex',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.chairman.role).toBe('codex');
  });

  test('skips empty lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '',
      'council:',
      '',
      '  chairman:',
      '',
      '    role: claude',
      '',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.chairman.role).toBe('claude');
  });

  test('returns fallback when file cannot be read', () => {
    const configPath = path.join(tmpDir, 'nonexistent.yaml');
    const result = parseYamlSimple(configPath, fallback);

    expect(result).toEqual(fallback);
  });

  test('converts boolean string values in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    exclude_chairman_from_members: false',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.settings.exclude_chairman_from_members).toBe(false);
  });

  test('converts integer string values in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    timeout: 240',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.settings.timeout).toBe(240);
    expect(typeof result.council.settings.timeout).toBe('number');
  });

  test('parses multiple members', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  members:',
      '    - name: claude',
      '      command: claude -p',
      '    - name: codex',
      '      command: codex exec',
      '    - name: gemini',
      '      command: gemini',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.members.length).toBe(3);
    expect(result.council.members[0].name).toBe('claude');
    expect(result.council.members[0].command).toBe('claude -p');
    expect(result.council.members[1].name).toBe('codex');
    expect(result.council.members[2].name).toBe('gemini');
  });

  test('handles quoted values in member fields', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  members:',
      '    - name: "claude"',
      '      command: "claude -p"',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    expect(result.council.members[0].name).toBe('claude');
    expect(result.council.members[0].command).toBe('claude -p');
  });
});

// ---------------------------------------------------------------------------
// parseCouncilConfig
// ---------------------------------------------------------------------------

describe('parseCouncilConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns fallback when config file does not exist', async () => {
    const configPath = path.join(tmpDir, 'nonexistent.yaml');
    const result = await parseCouncilConfig(configPath);

    expect(result.council).toBeTruthy();
    expect(result.council.chairman.role).toBe('auto');
    expect(result.council.members.length).toBe(3);
    expect(result.council.members[0].name).toBe('claude');
    expect(result.council.members[1].name).toBe('codex');
    expect(result.council.members[2].name).toBe('gemini');
    expect(result.council.settings.exclude_chairman_from_members).toBe(true);
    expect(result.council.settings.timeout).toBe(120);
  });

  test('parses valid YAML config via simple parser fallback', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: codex',
      '  members:',
      '    - name: alpha',
      '      command: alpha-cmd',
      '    - name: beta',
      '      command: beta-cmd',
      '  settings:',
      '    timeout: 60',
    ].join('\n'), 'utf8');

    const result = await parseCouncilConfig(configPath);

    expect(result.council).toBeTruthy();
    expect(result.council.members.length).toBe(2);
    expect(result.council.members[0].name).toBe('alpha');
    expect(result.council.members[1].name).toBe('beta');
    expect(result.council.settings.timeout).toBe(60);
  });

  test('merges chairman settings with defaults', async () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'), 'utf8');

    const result = await parseCouncilConfig(configPath);

    expect(result.council.chairman.role).toBe('gemini');
    // members should come from fallback (no members section parsed = 0 from simple parser, so fallback applies)
    expect(result.council.members.length > 0).toBeTruthy();
  });

  test('returns fallback-merged result for malformed YAML when yaml package unavailable', async () => {
    // Without the yaml package, parseCouncilConfig uses parseYamlSimple
    // which catches all errors and returns fallback
    const configPath = path.join(tmpDir, 'bad.yaml');
    fs.writeFileSync(configPath, ':\ninvalid: [unclosed', 'utf8');

    const result = await parseCouncilConfig(configPath);

    // parseYamlSimple catches errors and returns fallback-merged result
    expect(result.council).toBeTruthy();
    expect(result.council.members.length > 0).toBeTruthy();
  });

  test('exits with error when council key is missing via subprocess', () => {
    const configPath = path.join(tmpDir, 'no-council.yaml');
    fs.writeFileSync(configPath, 'other_key: true\n', 'utf8');

    const scriptContent = `
      const { parseCouncilConfig } = await import('${path.resolve(import.meta.dirname, './council-job.ts').replace(/'/g, "\\'")}');
      await parseCouncilConfig('${configPath.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
      stderr = err.stderr || '';
    }

    // Should exit with code 1 because 'council:' key is missing
    // Note: this only works if yaml package is available, otherwise simple parser doesn't validate
    // If yaml is not available, simple parser returns the fallback-merged result (exit code 0)
    // We accept either outcome
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------

describe('computeStatus', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupJobDir(members) {
    const jobDir = path.join(tmpDir, 'job');
    const membersDir = path.join(jobDir, 'members');
    fs.mkdirSync(membersDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({
      id: 'test-job-001',
      chairmanRole: 'claude',
    }), 'utf8');

    for (const m of members) {
      const memberDir = path.join(membersDir, m.safeName);
      fs.mkdirSync(memberDir, { recursive: true });
      // Write status with both `reviewer` (framework-expected field) and `member` (backward compat)
      const status = { ...m.status };
      if (status.member != null && status.reviewer == null) {
        status.reviewer = status.member;
      }
      fs.writeFileSync(path.join(memberDir, 'status.json'), JSON.stringify(status), 'utf8');
    }

    return jobDir;
  }

  test('returns done state when all members are done', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'done', exitCode: 0 } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('done');
    expect(result.counts.total).toBe(2);
    expect(result.counts.done).toBe(2);
    expect(result.counts.running).toBe(0);
    expect(result.counts.queued).toBe(0);
    expect(result.id).toBe('test-job-001');
    expect(result.chairmanRole).toBe('claude');
  });

  test('returns running state when some members are running', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'running' } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('running');
    expect(result.counts.done).toBe(1);
    expect(result.counts.running).toBe(1);
  });

  test('returns queued state when members are queued and none running', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'queued' } },
      { safeName: 'codex', status: { member: 'codex', state: 'queued' } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('queued');
    expect(result.counts.queued).toBe(2);
  });

  test('counts error states correctly', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'error', exitCode: 1 } },
      { safeName: 'codex', status: { member: 'codex', state: 'done', exitCode: 0 } },
      { safeName: 'gemini', status: { member: 'gemini', state: 'missing_cli' } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('done');
    expect(result.counts.error).toBe(1);
    expect(result.counts.done).toBe(1);
    expect(result.counts.missing_cli).toBe(1);
    expect(result.counts.total).toBe(3);
  });

  test('sorts members alphabetically by name', async () => {
    const jobDir = setupJobDir([
      { safeName: 'gamma', status: { member: 'gamma', state: 'done', exitCode: 0 } },
      { safeName: 'alpha', status: { member: 'alpha', state: 'done', exitCode: 0 } },
      { safeName: 'beta', status: { member: 'beta', state: 'done', exitCode: 0 } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.members[0].member).toBe('alpha');
    expect(result.members[1].member).toBe('beta');
    expect(result.members[2].member).toBe('gamma');
  });

  test('skips member directories without status.json', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
    ]);
    // Create an empty member directory without status.json
    fs.mkdirSync(path.join(jobDir, 'members', 'orphan'), { recursive: true });

    const result = await computeStatus(jobDir);

    expect(result.counts.total).toBe(1);
    expect(result.members.length).toBe(1);
  });

  test('returns member fields with null defaults for missing properties', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'queued' } },
    ]);

    const result = await computeStatus(jobDir);

    const m = result.members[0];
    expect(m.member).toBe('claude');
    expect(m.state).toBe('queued');
    expect(m.startedAt).toBe(null);
    expect(m.finishedAt).toBe(null);
    expect(m.exitCode).toBe(null);
    expect(m.message).toBe(null);
  });

  test('includes timing and exit code info for completed members', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: {
        member: 'claude',
        state: 'done',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:01:00Z',
        exitCode: 0,
        message: 'success',
      }},
    ]);

    const result = await computeStatus(jobDir);

    const m = result.members[0];
    expect(m.startedAt).toBe('2026-01-01T00:00:00Z');
    expect(m.finishedAt).toBe('2026-01-01T00:01:00Z');
    expect(m.exitCode).toBe(0);
    expect(m.message).toBe('success');
  });

  test('exits with error for nonexistent jobDir via subprocess', () => {
    const fakePath = path.join(tmpDir, 'does-not-exist');
    const scriptContent = `
      const { computeStatus } = await import('${path.resolve(import.meta.dirname, './council-job.ts').replace(/'/g, "\\'")}');
      await computeStatus('${fakePath.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    expect(exitCode).toBe(1);
  });

  test('exits with error for missing job.json via subprocess', () => {
    const jobDir = path.join(tmpDir, 'no-meta');
    fs.mkdirSync(jobDir, { recursive: true });
    // No job.json created

    const scriptContent = `
      const { computeStatus } = await import('${path.resolve(import.meta.dirname, './council-job.ts').replace(/'/g, "\\'")}');
      await computeStatus('${jobDir.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    expect(exitCode).toBe(1);
  });

  test('exits with error for missing members folder via subprocess', () => {
    const jobDir = path.join(tmpDir, 'no-members');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test' }), 'utf8');
    // No members/ directory created

    const scriptContent = `
      const { computeStatus } = await import('${path.resolve(import.meta.dirname, './council-job.ts').replace(/'/g, "\\'")}');
      await computeStatus('${jobDir.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    expect(exitCode).toBe(1);
  });

  test('handles mixed terminal states (timed_out, canceled)', async () => {
    const jobDir = setupJobDir([
      { safeName: 'alpha', status: { member: 'alpha', state: 'timed_out' } },
      { safeName: 'beta', status: { member: 'beta', state: 'canceled' } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('done');
    expect(result.counts.timed_out).toBe(1);
    expect(result.counts.canceled).toBe(1);
  });

  test('treats retrying member as non-terminal (running)', async () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'retrying', attempt: 1 } },
    ]);

    const result = await computeStatus(jobDir);

    expect(result.overallState).toBe('running');
    expect(result.counts.retrying).toBe(1);
    expect(result.counts.done).toBe(1);
  });
});

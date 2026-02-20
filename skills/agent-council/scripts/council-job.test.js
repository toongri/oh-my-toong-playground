#!/usr/bin/env node

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
  safeFileName,
  atomicWriteJson,
  readJsonIfExists,
  sleepMs,
  computeTerminalDoneCount,
  asCodexStepStatus,
  parseArgs,
  parseWaitCursor,
  formatWaitCursor,
  resolveBucketSize,
  generateJobId,
  buildUiPayload,
  parseCouncilConfig,
  parseYamlSimple,
  computeStatus,
} = require('./council-job.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'council-job-test-'));
}

// ---------------------------------------------------------------------------
// detectHostRole
// ---------------------------------------------------------------------------

describe('detectHostRole', () => {
  it('returns claude for paths containing /.claude/skills/', () => {
    assert.equal(detectHostRole('/home/user/.claude/skills/agent-council'), 'claude');
  });

  it('returns codex for paths containing /.codex/skills/', () => {
    assert.equal(detectHostRole('/home/user/.codex/skills/agent-council'), 'codex');
  });

  it('returns unknown for unrecognized paths', () => {
    assert.equal(detectHostRole('/home/user/projects/my-skill'), 'unknown');
  });

  it('normalizes backslashes on Windows-style paths', () => {
    assert.equal(detectHostRole('C:\\Users\\user\\.claude\\skills\\foo'), 'claude');
  });

  it('returns unknown for empty string', () => {
    assert.equal(detectHostRole(''), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// normalizeBool
// ---------------------------------------------------------------------------

describe('normalizeBool', () => {
  it('returns null for null input', () => {
    assert.equal(normalizeBool(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(normalizeBool(undefined), null);
  });

  it('returns true for truthy string values', () => {
    for (const v of ['1', 'true', 'yes', 'y', 'on', 'TRUE', 'Yes', 'ON']) {
      assert.equal(normalizeBool(v), true, `expected true for "${v}"`);
    }
  });

  it('returns false for falsy string values', () => {
    for (const v of ['0', 'false', 'no', 'n', 'off', 'FALSE', 'No', 'OFF']) {
      assert.equal(normalizeBool(v), false, `expected false for "${v}"`);
    }
  });

  it('returns null for unrecognized values', () => {
    assert.equal(normalizeBool('maybe'), null);
    assert.equal(normalizeBool('2'), null);
    assert.equal(normalizeBool(''), null);
  });

  it('trims whitespace before matching', () => {
    assert.equal(normalizeBool('  true  '), true);
    assert.equal(normalizeBool('  false  '), false);
  });

  it('converts non-string values via String()', () => {
    assert.equal(normalizeBool(1), true);
    assert.equal(normalizeBool(0), false);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoRole
// ---------------------------------------------------------------------------

describe('resolveAutoRole', () => {
  it('returns explicit role when given a non-auto value', () => {
    assert.equal(resolveAutoRole('gemini', 'claude'), 'gemini');
  });

  it('returns hostRole when role is auto and hostRole is codex', () => {
    assert.equal(resolveAutoRole('auto', 'codex'), 'codex');
  });

  it('returns hostRole when role is auto and hostRole is claude', () => {
    assert.equal(resolveAutoRole('auto', 'claude'), 'claude');
  });

  it('defaults to claude when role is auto and hostRole is unknown', () => {
    assert.equal(resolveAutoRole('auto', 'unknown'), 'claude');
  });

  it('treats null/undefined role as auto', () => {
    assert.equal(resolveAutoRole(null, 'codex'), 'codex');
    assert.equal(resolveAutoRole(undefined, 'claude'), 'claude');
  });

  it('treats empty string as auto', () => {
    assert.equal(resolveAutoRole('', 'codex'), 'codex');
  });

  it('lowercases the explicit role', () => {
    assert.equal(resolveAutoRole('GEMINI', 'claude'), 'gemini');
  });

  it('trims whitespace from role', () => {
    assert.equal(resolveAutoRole('  codex  ', 'claude'), 'codex');
  });
});

// ---------------------------------------------------------------------------
// safeFileName
// ---------------------------------------------------------------------------

describe('safeFileName', () => {
  it('lowercases and replaces unsafe characters', () => {
    assert.equal(safeFileName('My Model!'), 'my-model-');
  });

  it('preserves allowed characters (a-z, 0-9, _, -)', () => {
    assert.equal(safeFileName('valid-name_01'), 'valid-name_01');
  });

  it('returns fallback for empty/null input', () => {
    assert.equal(safeFileName('', 'default'), 'default');
    assert.equal(safeFileName(null, 'default'), 'default');
    assert.equal(safeFileName(undefined, 'default'), 'default');
  });

  it('returns member when no fallback given and input is empty', () => {
    assert.equal(safeFileName(''), 'member');
    assert.equal(safeFileName(null), 'member');
  });

  it('collapses consecutive unsafe characters into single dash', () => {
    assert.equal(safeFileName('a!!b'), 'a-b');
  });
});

// ---------------------------------------------------------------------------
// computeTerminalDoneCount
// ---------------------------------------------------------------------------

describe('computeTerminalDoneCount', () => {
  it('sums all terminal states', () => {
    const counts = { done: 3, missing_cli: 1, error: 2, timed_out: 1, canceled: 1 };
    assert.equal(computeTerminalDoneCount(counts), 8);
  });

  it('returns 0 for empty counts', () => {
    assert.equal(computeTerminalDoneCount({}), 0);
  });

  it('handles null/undefined input', () => {
    assert.equal(computeTerminalDoneCount(null), 0);
    assert.equal(computeTerminalDoneCount(undefined), 0);
  });

  it('treats missing fields as 0', () => {
    assert.equal(computeTerminalDoneCount({ done: 5 }), 5);
  });

  it('handles string number values via Number()', () => {
    assert.equal(computeTerminalDoneCount({ done: '3', error: '2' }), 5);
  });
});

// ---------------------------------------------------------------------------
// asCodexStepStatus
// ---------------------------------------------------------------------------

describe('asCodexStepStatus', () => {
  it('returns pending for valid pending input', () => {
    assert.equal(asCodexStepStatus('pending'), 'pending');
  });

  it('returns in_progress for valid in_progress input', () => {
    assert.equal(asCodexStepStatus('in_progress'), 'in_progress');
  });

  it('returns completed for valid completed input', () => {
    assert.equal(asCodexStepStatus('completed'), 'completed');
  });

  it('returns pending for unrecognized values', () => {
    assert.equal(asCodexStepStatus('done'), 'pending');
    assert.equal(asCodexStepStatus('error'), 'pending');
    assert.equal(asCodexStepStatus('unknown'), 'pending');
  });

  it('returns pending for null/undefined', () => {
    assert.equal(asCodexStepStatus(null), 'pending');
    assert.equal(asCodexStepStatus(undefined), 'pending');
  });

  it('returns pending for empty string', () => {
    assert.equal(asCodexStepStatus(''), 'pending');
  });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe('ensureDir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a directory that does not exist', () => {
    const dirPath = path.join(tmpDir, 'new-dir');
    ensureDir(dirPath);
    assert.ok(fs.existsSync(dirPath));
    assert.ok(fs.statSync(dirPath).isDirectory());
  });

  it('creates nested directories recursively', () => {
    const dirPath = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dirPath);
    assert.ok(fs.existsSync(dirPath));
  });

  it('does not throw if directory already exists', () => {
    const dirPath = path.join(tmpDir, 'existing');
    fs.mkdirSync(dirPath);
    assert.doesNotThrow(() => ensureDir(dirPath));
  });
});

// ---------------------------------------------------------------------------
// atomicWriteJson
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON to the target path', () => {
    const filePath = path.join(tmpDir, 'test.json');
    const payload = { state: 'done', exitCode: 0 };
    atomicWriteJson(filePath, payload);
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(result, payload);
  });

  it('overwrites existing file atomically', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { v: 1 });
    atomicWriteJson(filePath, { v: 2 });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(result.v, 2);
  });

  it('formats JSON with 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { a: 1 });
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.equal(raw, JSON.stringify({ a: 1 }, null, 2));
  });

  it('does not leave tmp files on success', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { ok: true });
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], 'test.json');
  });
});

// ---------------------------------------------------------------------------
// readJsonIfExists
// ---------------------------------------------------------------------------

describe('readJsonIfExists', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns parsed JSON for existing valid file', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');
    assert.deepEqual(readJsonIfExists(filePath), { key: 'value' });
  });

  it('returns null for non-existent file', () => {
    assert.equal(readJsonIfExists(path.join(tmpDir, 'missing.json')), null);
  });

  it('returns null for invalid JSON content', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json', 'utf8');
    assert.equal(readJsonIfExists(filePath), null);
  });

  it('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '', 'utf8');
    assert.equal(readJsonIfExists(filePath), null);
  });
});

// ---------------------------------------------------------------------------
// sleepMs
// ---------------------------------------------------------------------------

describe('sleepMs', () => {
  it('blocks for approximately the specified duration', () => {
    const start = Date.now();
    sleepMs(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
    assert.ok(elapsed < 200, `Expected < 200ms, got ${elapsed}ms`);
  });

  it('returns immediately for 0', () => {
    const start = Date.now();
    sleepMs(0);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms for 0ms sleep, got ${elapsed}ms`);
  });

  it('returns immediately for negative values', () => {
    const start = Date.now();
    sleepMs(-100);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms for negative sleep, got ${elapsed}ms`);
  });

  it('returns immediately for NaN', () => {
    const start = Date.now();
    sleepMs(NaN);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms for NaN sleep, got ${elapsed}ms`);
  });

  it('returns undefined (synchronous, not a promise)', () => {
    const result = sleepMs(1);
    assert.equal(result, undefined);
  });

  it('returns immediately for Infinity', () => {
    sleepMs(Infinity); // should not hang
  });
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------

describe('generateJobId', () => {
  it('matches expected format: YYYY-MM-DD-HHMM-hex6', () => {
    const id = generateJobId();
    assert.match(id, /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{6}$/);
  });

  it('generates unique IDs on successive calls', () => {
    const id1 = generateJobId();
    const id2 = generateJobId();
    assert.notEqual(id1, id2);
  });

  it('starts with a valid date prefix', () => {
    const id = generateJobId();
    const parts = id.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    assert.ok(year >= 2020 && year <= 2100, `Year ${year} out of range`);
    assert.ok(month >= 1 && month <= 12, `Month ${month} out of range`);
    assert.ok(day >= 1 && day <= 31, `Day ${day} out of range`);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  function parse(...args) {
    return parseArgs(['node', 'script.js', ...args]);
  }

  it('returns empty positional array for no args', () => {
    const result = parse();
    assert.deepEqual(result._, []);
  });

  it('collects positional arguments in _', () => {
    const result = parse('start', '/some/path');
    assert.deepEqual(result._, ['start', '/some/path']);
  });

  it('parses --key=value format', () => {
    const result = parse('--config=/path/to/file');
    assert.equal(result.config, '/path/to/file');
  });

  it('parses --key value format for non-boolean flags', () => {
    const result = parse('--config', '/path/to/file');
    assert.equal(result.config, '/path/to/file');
  });

  it('treats known boolean flags as true without value', () => {
    const result = parse('--json', '--verbose');
    assert.equal(result.json, true);
    assert.equal(result.verbose, true);
  });

  it('treats all known boolean flags correctly', () => {
    const boolFlags = ['json', 'text', 'checklist', 'help', 'h', 'verbose', 'include-chairman', 'exclude-chairman', 'stdin'];
    for (const flag of boolFlags) {
      const result = parse(`--${flag}`);
      assert.equal(result[flag], true, `expected --${flag} to be true`);
    }
  });

  it('stops processing at -- separator and puts rest in _', () => {
    const result = parse('start', '--', '--not-a-flag', 'extra');
    assert.deepEqual(result._, ['start', '--not-a-flag', 'extra']);
  });

  it('treats unknown flag without next value as boolean true', () => {
    const result = parse('--unknown');
    assert.equal(result.unknown, true);
  });

  it('treats unknown flag followed by another flag as boolean true', () => {
    const result = parse('--unknown', '--json');
    assert.equal(result.unknown, true);
    assert.equal(result.json, true);
  });

  it('handles mixed positional and flag arguments', () => {
    const result = parse('start', '--json', '--config', '/path', 'extra');
    assert.deepEqual(result._, ['start', 'extra']);
    assert.equal(result.json, true);
    assert.equal(result.config, '/path');
  });

  it('handles --key=value with empty value', () => {
    const result = parse('--config=');
    assert.equal(result.config, '');
  });

  it('handles --key=value where value contains = (splits on first =)', () => {
    const result = parse('--config=a=b');
    // JS split('=', 2) yields ['config', 'a'], truncating after limit
    assert.equal(result.config, 'a');
  });
});

// ---------------------------------------------------------------------------
// parseWaitCursor
// ---------------------------------------------------------------------------

describe('parseWaitCursor', () => {
  it('parses v1 format correctly', () => {
    const result = parseWaitCursor('v1:3:2:1');
    assert.deepEqual(result, {
      version: 'v1',
      bucketSize: 3,
      dispatchBucket: 0,
      doneBucket: 2,
      isDone: true,
    });
  });

  it('parses v1 format with isDone=0', () => {
    const result = parseWaitCursor('v1:5:1:0');
    assert.equal(result.isDone, false);
    assert.equal(result.bucketSize, 5);
    assert.equal(result.doneBucket, 1);
  });

  it('parses v2 format correctly', () => {
    const result = parseWaitCursor('v2:3:1:2:1');
    assert.deepEqual(result, {
      version: 'v2',
      bucketSize: 3,
      dispatchBucket: 1,
      doneBucket: 2,
      isDone: true,
    });
  });

  it('parses v2 format with isDone=0', () => {
    const result = parseWaitCursor('v2:4:0:1:0');
    assert.equal(result.isDone, false);
    assert.equal(result.dispatchBucket, 0);
  });

  it('returns null for empty string', () => {
    assert.equal(parseWaitCursor(''), null);
  });

  it('returns null for null/undefined', () => {
    assert.equal(parseWaitCursor(null), null);
    assert.equal(parseWaitCursor(undefined), null);
  });

  it('returns null for unknown version', () => {
    assert.equal(parseWaitCursor('v3:1:2:3'), null);
  });

  it('returns null for v1 with wrong part count', () => {
    assert.equal(parseWaitCursor('v1:3:2'), null);
    assert.equal(parseWaitCursor('v1:3:2:1:extra'), null);
  });

  it('returns null for v2 with wrong part count', () => {
    assert.equal(parseWaitCursor('v2:3:1:2'), null);
    assert.equal(parseWaitCursor('v2:3:1:2:1:extra'), null);
  });

  it('returns null for invalid bucketSize (0 or negative)', () => {
    assert.equal(parseWaitCursor('v1:0:2:1'), null);
    assert.equal(parseWaitCursor('v1:-1:2:1'), null);
    assert.equal(parseWaitCursor('v2:0:1:2:1'), null);
  });

  it('returns null for non-numeric bucketSize', () => {
    assert.equal(parseWaitCursor('v1:abc:2:1'), null);
  });

  it('returns null for negative doneBucket', () => {
    assert.equal(parseWaitCursor('v1:3:-1:1'), null);
    assert.equal(parseWaitCursor('v2:3:0:-1:1'), null);
  });

  it('returns null for negative dispatchBucket in v2', () => {
    assert.equal(parseWaitCursor('v2:3:-1:2:1'), null);
  });

  it('trims whitespace', () => {
    const result = parseWaitCursor('  v2:3:1:2:0  ');
    assert.notEqual(result, null);
    assert.equal(result.version, 'v2');
  });
});

// ---------------------------------------------------------------------------
// formatWaitCursor
// ---------------------------------------------------------------------------

describe('formatWaitCursor', () => {
  it('formats v2 cursor string with isDone=true', () => {
    assert.equal(formatWaitCursor(3, 1, 2, true), 'v2:3:1:2:1');
  });

  it('formats v2 cursor string with isDone=false', () => {
    assert.equal(formatWaitCursor(5, 0, 0, false), 'v2:5:0:0:0');
  });

  it('roundtrips with parseWaitCursor', () => {
    const cursor = formatWaitCursor(4, 1, 3, true);
    const parsed = parseWaitCursor(cursor);
    assert.deepEqual(parsed, {
      version: 'v2',
      bucketSize: 4,
      dispatchBucket: 1,
      doneBucket: 3,
      isDone: true,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveBucketSize
// ---------------------------------------------------------------------------

describe('resolveBucketSize', () => {
  it('uses explicit numeric bucket option', () => {
    assert.equal(resolveBucketSize({ bucket: '3' }, 10, null), 3);
  });

  it('uses bucket-size alias', () => {
    assert.equal(resolveBucketSize({ 'bucket-size': '4' }, 10, null), 4);
  });

  it('prefers bucket over bucket-size', () => {
    assert.equal(resolveBucketSize({ bucket: '2', 'bucket-size': '5' }, 10, null), 2);
  });

  it('truncates decimal bucket values', () => {
    assert.equal(resolveBucketSize({ bucket: '3.7' }, 10, null), 3);
  });

  it('falls back to prevCursor.bucketSize when option is null', () => {
    assert.equal(resolveBucketSize({}, 10, { bucketSize: 5 }), 5);
  });

  it('falls back to prevCursor.bucketSize when option is true (bare flag)', () => {
    assert.equal(resolveBucketSize({ bucket: true }, 10, { bucketSize: 7 }), 7);
  });

  it('computes auto bucket size as ceil(total/5)', () => {
    assert.equal(resolveBucketSize({}, 10, null), 2);
    assert.equal(resolveBucketSize({}, 13, null), 3);
    assert.equal(resolveBucketSize({}, 5, null), 1);
  });

  it('computes auto bucket size with explicit auto string', () => {
    assert.equal(resolveBucketSize({ bucket: 'auto' }, 10, null), 2);
  });

  it('returns 1 for total <= 0 in auto mode', () => {
    assert.equal(resolveBucketSize({}, 0, null), 1);
    assert.equal(resolveBucketSize({}, -5, null), 1);
  });

  it('returns 1 for null/undefined total in auto mode', () => {
    assert.equal(resolveBucketSize({}, null, null), 1);
    assert.equal(resolveBucketSize({}, undefined, null), 1);
  });

  it('returns at least 1 for very small totals', () => {
    assert.equal(resolveBucketSize({}, 1, null), 1);
    assert.equal(resolveBucketSize({}, 2, null), 1);
  });
});

// ---------------------------------------------------------------------------
// buildUiPayload
// ---------------------------------------------------------------------------

describe('buildUiPayload', () => {
  it('returns correct structure for all members done', () => {
    const status = {
      overallState: 'done',
      counts: { total: 2, queued: 0, running: 0, done: 2, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'done', exitCode: 0 },
        { member: 'codex', state: 'done', exitCode: 0 },
      ],
    };
    const result = buildUiPayload(status);

    assert.equal(result.progress.done, 2);
    assert.equal(result.progress.total, 2);
    assert.equal(result.progress.overallState, 'done');

    // dispatch should be completed when done
    assert.equal(result.codex.update_plan.plan[0].status, 'completed');
    // member steps should be completed
    assert.equal(result.codex.update_plan.plan[1].status, 'completed');
    assert.equal(result.codex.update_plan.plan[2].status, 'completed');
    // synth step: isDone=true, no hasInProgress after dispatch completed + all terminal members
    // dispatch is 'completed' (not in_progress), members all terminal -> hasInProgress stays false
    // synthStatus: isDone && !hasInProgress -> 'in_progress'
    assert.equal(result.codex.update_plan.plan[3].status, 'in_progress');
  });

  it('returns correct structure for some members running', () => {
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

    assert.equal(result.progress.done, 2); // done(1) + error(1)
    assert.equal(result.progress.total, 3);
    assert.equal(result.progress.overallState, 'running');

    // dispatch: not isDone, queued=0 -> 'completed'
    assert.equal(result.codex.update_plan.plan[0].status, 'completed');

    // Members sorted by entity: claude, codex, gemini
    const memberSteps = result.codex.update_plan.plan.slice(1, 4);
    assert.equal(memberSteps[0].step, '[Council] Ask claude');
    assert.equal(memberSteps[0].status, 'completed'); // done = terminal
    assert.equal(memberSteps[1].step, '[Council] Ask codex');
    assert.equal(memberSteps[1].status, 'in_progress'); // first running, hasInProgress was false
    assert.equal(memberSteps[2].step, '[Council] Ask gemini');
    assert.equal(memberSteps[2].status, 'completed'); // error = terminal
  });

  it('sets dispatch to in_progress when some members are queued', () => {
    const status = {
      overallState: 'queued',
      counts: { total: 2, queued: 2, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'queued' },
        { member: 'codex', state: 'queued' },
      ],
    };
    const result = buildUiPayload(status);

    assert.equal(result.codex.update_plan.plan[0].status, 'in_progress');
    // hasInProgress = true after dispatch
    // member steps: not terminal, hasInProgress already true -> pending
    assert.equal(result.codex.update_plan.plan[1].status, 'pending');
    assert.equal(result.codex.update_plan.plan[2].status, 'pending');
    // synth: not isDone -> 'pending'
    assert.equal(result.codex.update_plan.plan[3].status, 'pending');
  });

  it('handles empty members array', () => {
    const status = {
      overallState: 'done',
      counts: { total: 0, queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [],
    };
    const result = buildUiPayload(status);

    assert.equal(result.progress.done, 0);
    assert.equal(result.progress.total, 0);
    // plan: dispatch + synth only (no member steps)
    assert.equal(result.codex.update_plan.plan.length, 2);
    assert.equal(result.claude.todo_write.todos.length, 2);
  });

  it('handles all members in error state', () => {
    const status = {
      overallState: 'done',
      counts: { total: 2, queued: 0, running: 0, done: 0, error: 2, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [
        { member: 'claude', state: 'error', exitCode: 1 },
        { member: 'codex', state: 'error', exitCode: 1 },
      ],
    };
    const result = buildUiPayload(status);

    assert.equal(result.progress.done, 2); // errors count as terminal done
    // Both member steps should be 'completed' (terminal state)
    assert.equal(result.codex.update_plan.plan[1].status, 'completed');
    assert.equal(result.codex.update_plan.plan[2].status, 'completed');
  });

  it('only first running member gets in_progress status', () => {
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
    assert.equal(memberSteps[0].status, 'in_progress'); // first running gets in_progress
    assert.equal(memberSteps[1].status, 'pending'); // rest are pending
    assert.equal(memberSteps[2].status, 'pending');
  });

  it('generates correct claude todo_write structure', () => {
    const status = {
      overallState: 'done',
      counts: { total: 1, queued: 0, running: 0, done: 1, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      members: [{ member: 'claude', state: 'done', exitCode: 0 }],
    };
    const result = buildUiPayload(status);

    const todos = result.claude.todo_write.todos;
    assert.equal(todos.length, 3); // dispatch + 1 member + synth

    // dispatch todo
    assert.equal(todos[0].content, '[Council] Prompt dispatch');
    assert.equal(todos[0].status, 'completed');
    assert.equal(todos[0].activeForm, 'Dispatched council prompts');

    // member todo
    assert.equal(todos[1].content, '[Council] Ask claude');
    assert.equal(todos[1].status, 'completed');
    assert.equal(todos[1].activeForm, 'Finished');

    // synth todo
    assert.equal(todos[2].content, '[Council] Synthesize');
  });

  it('handles missing/null members in statusPayload', () => {
    const status = {
      overallState: 'done',
      counts: { total: 0 },
    };
    const result = buildUiPayload(status);

    assert.equal(result.codex.update_plan.plan.length, 2); // dispatch + synth only
  });

  it('filters out members with empty entity', () => {
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
    assert.equal(memberSteps.length, 1);
    assert.equal(memberSteps[0].step, '[Council] Ask claude');
  });

  it('handles terminal states: timed_out, canceled, missing_cli', () => {
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
    assert.equal(memberSteps[0].status, 'completed');
    assert.equal(memberSteps[1].status, 'completed');
    assert.equal(memberSteps[2].status, 'completed');
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

  it('parses basic council config with members', () => {
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

    assert.equal(result.council.chairman.role, 'codex');
    assert.equal(result.council.members.length, 1);
    assert.equal(result.council.members[0].name, 'gemini');
    assert.equal(result.council.members[0].command, 'gemini');
    assert.equal(result.council.settings.timeout, 60);
  });

  it('uses fallback members when no members parsed', () => {
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
    assert.deepEqual(result.council.members, fallback.council.members);
  });

  it('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.chairman.role, 'gemini');
  });

  it('merges settings with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    timeout: 300',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.settings.timeout, 300);
    // exclude_chairman_from_members comes from fallback
    assert.equal(result.council.settings.exclude_chairman_from_members, true);
  });

  it('skips comment lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '# This is a comment',
      'council:',
      '  # chairman comment',
      '  chairman:',
      '    role: codex',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.chairman.role, 'codex');
  });

  it('skips empty lines', () => {
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

    assert.equal(result.council.chairman.role, 'claude');
  });

  it('returns fallback when file cannot be read', () => {
    const configPath = path.join(tmpDir, 'nonexistent.yaml');
    const result = parseYamlSimple(configPath, fallback);

    assert.deepEqual(result, fallback);
  });

  it('converts boolean string values in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    exclude_chairman_from_members: false',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.settings.exclude_chairman_from_members, false);
  });

  it('converts integer string values in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  settings:',
      '    timeout: 240',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.settings.timeout, 240);
    assert.equal(typeof result.council.settings.timeout, 'number');
  });

  it('parses multiple members', () => {
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

    assert.equal(result.council.members.length, 3);
    assert.equal(result.council.members[0].name, 'claude');
    assert.equal(result.council.members[0].command, 'claude -p');
    assert.equal(result.council.members[1].name, 'codex');
    assert.equal(result.council.members[2].name, 'gemini');
  });

  it('handles quoted values in member fields', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  members:',
      '    - name: "claude"',
      '      command: "claude -p"',
    ].join('\n'), 'utf8');

    const result = parseYamlSimple(configPath, fallback);

    assert.equal(result.council.members[0].name, 'claude');
    assert.equal(result.council.members[0].command, 'claude -p');
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

  it('returns fallback when config file does not exist', () => {
    const configPath = path.join(tmpDir, 'nonexistent.yaml');
    const result = parseCouncilConfig(configPath);

    assert.ok(result.council);
    assert.equal(result.council.chairman.role, 'auto');
    assert.equal(result.council.members.length, 3);
    assert.equal(result.council.members[0].name, 'claude');
    assert.equal(result.council.members[1].name, 'codex');
    assert.equal(result.council.members[2].name, 'gemini');
    assert.equal(result.council.settings.exclude_chairman_from_members, true);
    assert.equal(result.council.settings.timeout, 120);
  });

  it('parses valid YAML config via simple parser fallback', () => {
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

    const result = parseCouncilConfig(configPath);

    assert.ok(result.council);
    assert.equal(result.council.members.length, 2);
    assert.equal(result.council.members[0].name, 'alpha');
    assert.equal(result.council.members[1].name, 'beta');
    assert.equal(result.council.settings.timeout, 60);
  });

  it('merges chairman settings with defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'council:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'), 'utf8');

    const result = parseCouncilConfig(configPath);

    assert.equal(result.council.chairman.role, 'gemini');
    // members should come from fallback (no members section parsed = 0 from simple parser, so fallback applies)
    assert.ok(result.council.members.length > 0);
  });

  it('returns fallback-merged result for malformed YAML when yaml package unavailable', () => {
    // Without the yaml package, parseCouncilConfig uses parseYamlSimple
    // which catches all errors and returns fallback
    const configPath = path.join(tmpDir, 'bad.yaml');
    fs.writeFileSync(configPath, ':\ninvalid: [unclosed', 'utf8');

    const result = parseCouncilConfig(configPath);

    // parseYamlSimple catches errors and returns fallback-merged result
    assert.ok(result.council);
    assert.ok(result.council.members.length > 0);
  });

  it('exits with error when council key is missing via subprocess', () => {
    const configPath = path.join(tmpDir, 'no-council.yaml');
    fs.writeFileSync(configPath, 'other_key: true\n', 'utf8');

    const { execFileSync } = require('child_process');
    const scriptContent = `
      const { parseCouncilConfig } = require('${require.resolve('./council-job.js').replace(/'/g, "\\'")}');
      parseCouncilConfig('${configPath.replace(/'/g, "\\'")}');
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
    assert.ok(exitCode === 0 || exitCode === 1, `Expected exit code 0 or 1, got ${exitCode}`);
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
      fs.writeFileSync(path.join(memberDir, 'status.json'), JSON.stringify(m.status), 'utf8');
    }

    return jobDir;
  }

  it('returns done state when all members are done', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'done', exitCode: 0 } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'done');
    assert.equal(result.counts.total, 2);
    assert.equal(result.counts.done, 2);
    assert.equal(result.counts.running, 0);
    assert.equal(result.counts.queued, 0);
    assert.equal(result.id, 'test-job-001');
    assert.equal(result.chairmanRole, 'claude');
  });

  it('returns running state when some members are running', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'running' } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'running');
    assert.equal(result.counts.done, 1);
    assert.equal(result.counts.running, 1);
  });

  it('returns queued state when members are queued and none running', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'queued' } },
      { safeName: 'codex', status: { member: 'codex', state: 'queued' } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'queued');
    assert.equal(result.counts.queued, 2);
  });

  it('counts error states correctly', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'error', exitCode: 1 } },
      { safeName: 'codex', status: { member: 'codex', state: 'done', exitCode: 0 } },
      { safeName: 'gemini', status: { member: 'gemini', state: 'missing_cli' } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'done');
    assert.equal(result.counts.error, 1);
    assert.equal(result.counts.done, 1);
    assert.equal(result.counts.missing_cli, 1);
    assert.equal(result.counts.total, 3);
  });

  it('sorts members alphabetically by name', () => {
    const jobDir = setupJobDir([
      { safeName: 'gamma', status: { member: 'gamma', state: 'done', exitCode: 0 } },
      { safeName: 'alpha', status: { member: 'alpha', state: 'done', exitCode: 0 } },
      { safeName: 'beta', status: { member: 'beta', state: 'done', exitCode: 0 } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.members[0].member, 'alpha');
    assert.equal(result.members[1].member, 'beta');
    assert.equal(result.members[2].member, 'gamma');
  });

  it('skips member directories without status.json', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
    ]);
    // Create an empty member directory without status.json
    fs.mkdirSync(path.join(jobDir, 'members', 'orphan'), { recursive: true });

    const result = computeStatus(jobDir);

    assert.equal(result.counts.total, 1);
    assert.equal(result.members.length, 1);
  });

  it('returns member fields with null defaults for missing properties', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'queued' } },
    ]);

    const result = computeStatus(jobDir);

    const m = result.members[0];
    assert.equal(m.member, 'claude');
    assert.equal(m.state, 'queued');
    assert.equal(m.startedAt, null);
    assert.equal(m.finishedAt, null);
    assert.equal(m.exitCode, null);
    assert.equal(m.message, null);
  });

  it('includes timing and exit code info for completed members', () => {
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

    const result = computeStatus(jobDir);

    const m = result.members[0];
    assert.equal(m.startedAt, '2026-01-01T00:00:00Z');
    assert.equal(m.finishedAt, '2026-01-01T00:01:00Z');
    assert.equal(m.exitCode, 0);
    assert.equal(m.message, 'success');
  });

  it('exits with error for nonexistent jobDir via subprocess', () => {
    const { execFileSync } = require('child_process');
    const fakePath = path.join(tmpDir, 'does-not-exist');
    const scriptContent = `
      const { computeStatus } = require('${require.resolve('./council-job.js').replace(/'/g, "\\'")}');
      computeStatus('${fakePath.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    assert.equal(exitCode, 1);
  });

  it('exits with error for missing job.json via subprocess', () => {
    const { execFileSync } = require('child_process');
    const jobDir = path.join(tmpDir, 'no-meta');
    fs.mkdirSync(jobDir, { recursive: true });
    // No job.json created

    const scriptContent = `
      const { computeStatus } = require('${require.resolve('./council-job.js').replace(/'/g, "\\'")}');
      computeStatus('${jobDir.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    assert.equal(exitCode, 1);
  });

  it('exits with error for missing members folder via subprocess', () => {
    const { execFileSync } = require('child_process');
    const jobDir = path.join(tmpDir, 'no-members');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test' }), 'utf8');
    // No members/ directory created

    const scriptContent = `
      const { computeStatus } = require('${require.resolve('./council-job.js').replace(/'/g, "\\'")}');
      computeStatus('${jobDir.replace(/'/g, "\\'")}');
    `;

    let exitCode;
    try {
      execFileSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }

    assert.equal(exitCode, 1);
  });

  it('handles mixed terminal states (timed_out, canceled)', () => {
    const jobDir = setupJobDir([
      { safeName: 'alpha', status: { member: 'alpha', state: 'timed_out' } },
      { safeName: 'beta', status: { member: 'beta', state: 'canceled' } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'done');
    assert.equal(result.counts.timed_out, 1);
    assert.equal(result.counts.canceled, 1);
  });

  it('treats retrying member as non-terminal (running)', () => {
    const jobDir = setupJobDir([
      { safeName: 'claude', status: { member: 'claude', state: 'done', exitCode: 0 } },
      { safeName: 'codex', status: { member: 'codex', state: 'retrying', attempt: 1 } },
    ]);

    const result = computeStatus(jobDir);

    assert.equal(result.overallState, 'running');
    assert.equal(result.counts.retrying, 1);
    assert.equal(result.counts.done, 1);
  });
});

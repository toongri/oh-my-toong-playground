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

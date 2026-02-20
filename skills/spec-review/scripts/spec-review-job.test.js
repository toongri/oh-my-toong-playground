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
} = require('./spec-review-job.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'job-test-'));
}

// ---------------------------------------------------------------------------
// detectHostRole
// ---------------------------------------------------------------------------

describe('detectHostRole', () => {
  it('returns claude when path contains /.claude/skills/', () => {
    assert.equal(detectHostRole('/home/user/.claude/skills/spec-review'), 'claude');
  });

  it('returns codex when path contains /.codex/skills/', () => {
    assert.equal(detectHostRole('/home/user/.codex/skills/spec-review'), 'codex');
  });

  it('returns unknown for unrecognized paths', () => {
    assert.equal(detectHostRole('/home/user/projects/spec-review'), 'unknown');
  });

  it('normalizes backslashes on Windows-style paths', () => {
    assert.equal(detectHostRole('C:\\Users\\dev\\.claude\\skills\\review'), 'claude');
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

  for (const truthy of ['1', 'true', 'yes', 'y', 'on', 'TRUE', 'Yes', 'ON']) {
    it(`returns true for "${truthy}"`, () => {
      assert.equal(normalizeBool(truthy), true);
    });
  }

  for (const falsy of ['0', 'false', 'no', 'n', 'off', 'FALSE', 'No', 'OFF']) {
    it(`returns false for "${falsy}"`, () => {
      assert.equal(normalizeBool(falsy), false);
    });
  }

  it('returns null for unrecognized string', () => {
    assert.equal(normalizeBool('maybe'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(normalizeBool(''), null);
  });

  it('handles numeric 1 (non-string)', () => {
    assert.equal(normalizeBool(1), true);
  });

  it('handles numeric 0 (non-string)', () => {
    assert.equal(normalizeBool(0), false);
  });

  it('trims whitespace', () => {
    assert.equal(normalizeBool('  true  '), true);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoRole
// ---------------------------------------------------------------------------

describe('resolveAutoRole', () => {
  it('returns explicit role when provided', () => {
    assert.equal(resolveAutoRole('gemini', 'claude'), 'gemini');
  });

  it('returns codex when role is auto and hostRole is codex', () => {
    assert.equal(resolveAutoRole('auto', 'codex'), 'codex');
  });

  it('returns claude when role is auto and hostRole is claude', () => {
    assert.equal(resolveAutoRole('auto', 'claude'), 'claude');
  });

  it('returns claude when role is auto and hostRole is unknown', () => {
    assert.equal(resolveAutoRole('auto', 'unknown'), 'claude');
  });

  it('falls through to hostRole when role is empty string', () => {
    assert.equal(resolveAutoRole('', 'codex'), 'codex');
  });

  it('falls through to hostRole when role is null', () => {
    assert.equal(resolveAutoRole(null, 'codex'), 'codex');
  });

  it('returns claude when role is undefined', () => {
    assert.equal(resolveAutoRole(undefined, 'claude'), 'claude');
  });

  it('normalizes role to lowercase', () => {
    assert.equal(resolveAutoRole('CLAUDE', 'codex'), 'claude');
  });

  it('trims whitespace from role', () => {
    assert.equal(resolveAutoRole('  gemini  ', 'claude'), 'gemini');
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

  it('creates a new directory', () => {
    const dir = path.join(tmpDir, 'new-dir');
    ensureDir(dir);
    assert.ok(fs.existsSync(dir));
    assert.ok(fs.statSync(dir).isDirectory());
  });

  it('creates nested directories recursively', () => {
    const dir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dir);
    assert.ok(fs.existsSync(dir));
  });

  it('does not throw if directory already exists', () => {
    const dir = path.join(tmpDir, 'existing');
    fs.mkdirSync(dir);
    assert.doesNotThrow(() => ensureDir(dir));
  });
});

// ---------------------------------------------------------------------------
// safeFileName
// ---------------------------------------------------------------------------

describe('safeFileName', () => {
  it('converts name to lowercase with safe characters', () => {
    assert.equal(safeFileName('MyReviewer'), 'myreviewer');
  });

  it('replaces special characters with hyphens', () => {
    assert.equal(safeFileName('hello world!'), 'hello-world-');
  });

  it('returns fallback "reviewer" for empty string', () => {
    assert.equal(safeFileName(''), 'reviewer');
  });

  it('returns fallback "reviewer" for null', () => {
    assert.equal(safeFileName(null), 'reviewer');
  });

  it('returns fallback "reviewer" for undefined', () => {
    assert.equal(safeFileName(undefined), 'reviewer');
  });

  it('uses custom fallback when provided', () => {
    assert.equal(safeFileName('', 'custom'), 'custom');
  });

  it('preserves hyphens and underscores', () => {
    assert.equal(safeFileName('my-review_name'), 'my-review_name');
  });

  it('handles string with only special characters', () => {
    assert.equal(safeFileName('!!!'), '-');
  });

  it('returns fallback for whitespace-only string', () => {
    assert.equal(safeFileName('   '), 'reviewer');
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

  it('reads and parses existing JSON file', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');
    const result = readJsonIfExists(filePath);
    assert.deepEqual(result, { key: 'value' });
  });

  it('returns null for non-existent file', () => {
    const result = readJsonIfExists(path.join(tmpDir, 'missing.json'));
    assert.equal(result, null);
  });

  it('returns null for invalid JSON content', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json', 'utf8');
    const result = readJsonIfExists(filePath);
    assert.equal(result, null);
  });

  it('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '', 'utf8');
    const result = readJsonIfExists(filePath);
    assert.equal(result, null);
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

  it('returns immediately for zero', () => {
    const start = Date.now();
    sleepMs(0);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
  });

  it('returns immediately for negative value', () => {
    const start = Date.now();
    sleepMs(-100);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
  });

  it('returns immediately for NaN', () => {
    const start = Date.now();
    sleepMs(NaN);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
  });

  it('returns immediately for Infinity', () => {
    const start = Date.now();
    sleepMs(Infinity);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
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

  it('returns 0 for null input', () => {
    assert.equal(computeTerminalDoneCount(null), 0);
  });

  it('returns 0 for undefined input', () => {
    assert.equal(computeTerminalDoneCount(undefined), 0);
  });

  it('handles partial counts', () => {
    assert.equal(computeTerminalDoneCount({ done: 5 }), 5);
  });

  it('coerces string numbers', () => {
    assert.equal(computeTerminalDoneCount({ done: '3', error: '2' }), 5);
  });
});

// ---------------------------------------------------------------------------
// asCodexStepStatus
// ---------------------------------------------------------------------------

describe('asCodexStepStatus', () => {
  it('returns pending for "pending"', () => {
    assert.equal(asCodexStepStatus('pending'), 'pending');
  });

  it('returns in_progress for "in_progress"', () => {
    assert.equal(asCodexStepStatus('in_progress'), 'in_progress');
  });

  it('returns completed for "completed"', () => {
    assert.equal(asCodexStepStatus('completed'), 'completed');
  });

  it('returns pending for unknown value', () => {
    assert.equal(asCodexStepStatus('running'), 'pending');
  });

  it('returns pending for empty string', () => {
    assert.equal(asCodexStepStatus(''), 'pending');
  });

  it('returns pending for null', () => {
    assert.equal(asCodexStepStatus(null), 'pending');
  });

  it('returns pending for undefined', () => {
    assert.equal(asCodexStepStatus(undefined), 'pending');
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const result = parseArgs(['node', 'script', 'start', 'hello']);
    assert.deepEqual(result._, ['start', 'hello']);
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['node', 'script', '--json', '--verbose']);
    assert.equal(result.json, true);
    assert.equal(result.verbose, true);
  });

  it('parses key=value pairs', () => {
    const result = parseArgs(['node', 'script', '--config=/path/to/file']);
    assert.equal(result.config, '/path/to/file');
  });

  it('parses key-value pairs with space separator', () => {
    const result = parseArgs(['node', 'script', '--config', '/path/to/file']);
    assert.equal(result.config, '/path/to/file');
  });

  it('stops parsing at --', () => {
    const result = parseArgs(['node', 'script', '--json', '--', 'rest', 'args']);
    assert.equal(result.json, true);
    assert.deepEqual(result._, ['rest', 'args']);
  });

  it('treats known boolean flags as true without next arg consumption', () => {
    const result = parseArgs(['node', 'script', '--help', 'start']);
    assert.equal(result.help, true);
    assert.deepEqual(result._, ['start']);
  });

  it('treats unknown flag without value as true', () => {
    const result = parseArgs(['node', 'script', '--unknown', '--json']);
    assert.equal(result.unknown, true);
    assert.equal(result.json, true);
  });

  it('returns empty positional array when no positional args', () => {
    const result = parseArgs(['node', 'script', '--json']);
    assert.deepEqual(result._, []);
  });

  it('parses --include-chairman as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--include-chairman']);
    assert.equal(result['include-chairman'], true);
  });

  it('parses --exclude-chairman as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--exclude-chairman']);
    assert.equal(result['exclude-chairman'], true);
  });

  it('parses --stdin as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--stdin']);
    assert.equal(result.stdin, true);
  });

  it('parses --h as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--h']);
    assert.equal(result.h, true);
  });

  it('parses mixed positional and flag arguments', () => {
    const result = parseArgs(['node', 'script', 'start', '--json', '--config', 'myfile', 'extra']);
    assert.equal(result.json, true);
    assert.equal(result.config, 'myfile');
    assert.deepEqual(result._, ['start', 'extra']);
  });

  it('handles empty argv (only node and script)', () => {
    const result = parseArgs(['node', 'script']);
    assert.deepEqual(result._, []);
  });

  it('unknown flag followed by another flag is treated as boolean true', () => {
    const result = parseArgs(['node', 'script', '--foo', '--bar', 'val']);
    assert.equal(result.foo, true);
    assert.equal(result.bar, 'val');
  });
});

// ---------------------------------------------------------------------------
// parseWaitCursor
// ---------------------------------------------------------------------------

describe('parseWaitCursor', () => {
  describe('v1 format', () => {
    it('parses valid v1 cursor', () => {
      const result = parseWaitCursor('v1:5:3:0');
      assert.deepEqual(result, {
        version: 'v1',
        bucketSize: 5,
        dispatchBucket: 0,
        doneBucket: 3,
        isDone: false,
      });
    });

    it('parses v1 cursor with isDone=1', () => {
      const result = parseWaitCursor('v1:10:7:1');
      assert.equal(result.isDone, true);
    });

    it('returns null for v1 with invalid bucketSize (0)', () => {
      assert.equal(parseWaitCursor('v1:0:3:0'), null);
    });

    it('returns null for v1 with negative bucketSize', () => {
      assert.equal(parseWaitCursor('v1:-1:3:0'), null);
    });

    it('returns null for v1 with negative doneBucket', () => {
      assert.equal(parseWaitCursor('v1:5:-1:0'), null);
    });

    it('returns null for v1 with wrong number of parts', () => {
      assert.equal(parseWaitCursor('v1:5:3'), null);
    });
  });

  describe('v2 format', () => {
    it('parses valid v2 cursor', () => {
      const result = parseWaitCursor('v2:5:1:3:0');
      assert.deepEqual(result, {
        version: 'v2',
        bucketSize: 5,
        dispatchBucket: 1,
        doneBucket: 3,
        isDone: false,
      });
    });

    it('parses v2 cursor with isDone=1', () => {
      const result = parseWaitCursor('v2:10:1:7:1');
      assert.equal(result.isDone, true);
    });

    it('returns null for v2 with invalid bucketSize (0)', () => {
      assert.equal(parseWaitCursor('v2:0:1:3:0'), null);
    });

    it('returns null for v2 with negative dispatchBucket', () => {
      assert.equal(parseWaitCursor('v2:5:-1:3:0'), null);
    });

    it('returns null for v2 with negative doneBucket', () => {
      assert.equal(parseWaitCursor('v2:5:1:-1:0'), null);
    });

    it('returns null for v2 with wrong number of parts', () => {
      assert.equal(parseWaitCursor('v2:5:1:3'), null);
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      assert.equal(parseWaitCursor(''), null);
    });

    it('returns null for null', () => {
      assert.equal(parseWaitCursor(null), null);
    });

    it('returns null for undefined', () => {
      assert.equal(parseWaitCursor(undefined), null);
    });

    it('returns null for unknown version', () => {
      assert.equal(parseWaitCursor('v3:5:3:0'), null);
    });

    it('trims whitespace', () => {
      const result = parseWaitCursor('  v2:5:1:3:0  ');
      assert.notEqual(result, null);
      assert.equal(result.version, 'v2');
    });

    it('returns null for non-numeric bucketSize', () => {
      assert.equal(parseWaitCursor('v1:abc:3:0'), null);
    });
  });
});

// ---------------------------------------------------------------------------
// formatWaitCursor
// ---------------------------------------------------------------------------

describe('formatWaitCursor', () => {
  it('formats v2 cursor string with isDone=false', () => {
    assert.equal(formatWaitCursor(5, 1, 3, false), 'v2:5:1:3:0');
  });

  it('formats v2 cursor string with isDone=true', () => {
    assert.equal(formatWaitCursor(10, 1, 7, true), 'v2:10:1:7:1');
  });

  it('formats with zero values', () => {
    assert.equal(formatWaitCursor(1, 0, 0, false), 'v2:1:0:0:0');
  });

  it('roundtrips with parseWaitCursor', () => {
    const cursor = formatWaitCursor(5, 1, 3, true);
    const parsed = parseWaitCursor(cursor);
    assert.equal(parsed.bucketSize, 5);
    assert.equal(parsed.dispatchBucket, 1);
    assert.equal(parsed.doneBucket, 3);
    assert.equal(parsed.isDone, true);
  });
});

// ---------------------------------------------------------------------------
// resolveBucketSize
// ---------------------------------------------------------------------------

describe('resolveBucketSize', () => {
  it('returns explicit bucket size from options.bucket', () => {
    assert.equal(resolveBucketSize({ bucket: '3' }, 10, null), 3);
  });

  it('returns explicit bucket size from options["bucket-size"]', () => {
    assert.equal(resolveBucketSize({ 'bucket-size': '4' }, 10, null), 4);
  });

  it('prefers options.bucket over options["bucket-size"]', () => {
    assert.equal(resolveBucketSize({ bucket: '3', 'bucket-size': '4' }, 10, null), 3);
  });

  it('truncates decimal bucket size', () => {
    assert.equal(resolveBucketSize({ bucket: '3.7' }, 10, null), 3);
  });

  it('uses prevCursor bucketSize when options not set', () => {
    const prevCursor = { bucketSize: 7 };
    assert.equal(resolveBucketSize({}, 10, prevCursor), 7);
  });

  it('uses prevCursor bucketSize when bucket is true (flag without value)', () => {
    const prevCursor = { bucketSize: 7 };
    assert.equal(resolveBucketSize({ bucket: true }, 10, prevCursor), 7);
  });

  it('auto-computes bucket size as ceil(total/5)', () => {
    assert.equal(resolveBucketSize({}, 10, null), 2);
  });

  it('auto-computes with minimum of 1', () => {
    assert.equal(resolveBucketSize({}, 3, null), 1);
  });

  it('returns 1 when total is 0', () => {
    assert.equal(resolveBucketSize({}, 0, null), 1);
  });

  it('returns 1 when total is null', () => {
    assert.equal(resolveBucketSize({}, null, null), 1);
  });

  it('handles auto string for bucket', () => {
    assert.equal(resolveBucketSize({ bucket: 'auto' }, 15, null), 3);
  });

  it('handles AUTO string (case insensitive)', () => {
    assert.equal(resolveBucketSize({ bucket: 'AUTO' }, 20, null), 4);
  });
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------

describe('generateJobId', () => {
  it('returns a string', () => {
    assert.equal(typeof generateJobId(), 'string');
  });

  it('matches expected format: YYYY-MM-DD-HHmm-hex', () => {
    const id = generateJobId();
    assert.match(id, /^\d{4}-\d{2}-\d{2}-\d{4,6}-[0-9a-f]{6}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      ids.add(generateJobId());
    }
    assert.equal(ids.size, 10);
  });

  it('starts with current date', () => {
    const id = generateJobId();
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(id.startsWith(today), `Expected "${id}" to start with "${today}"`);
  });
});

#!/usr/bin/env node

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

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
  parseChunkReviewConfig,
  parseYamlSimple,
  computeStatus,
  detectCliType,
  buildAugmentedCommand,
} = require('./chunk-review-job.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-job-test-'));
}

// ---------------------------------------------------------------------------
// detectHostRole
// ---------------------------------------------------------------------------

describe('detectHostRole', () => {
  it('returns claude when path contains /.claude/skills/', () => {
    assert.equal(detectHostRole('/home/user/.claude/skills/code-review'), 'claude');
  });

  it('returns codex when path contains /.codex/skills/', () => {
    assert.equal(detectHostRole('/home/user/.codex/skills/code-review'), 'codex');
  });

  it('returns unknown for unrecognized paths', () => {
    assert.equal(detectHostRole('/home/user/projects/code-review'), 'unknown');
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
    assert.ok(elapsed < 1000, `Expected < 1000ms, got ${elapsed}ms`);
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

  it('parses --blocking as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--blocking']);
    assert.equal(result.blocking, true);
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

  it('handles --key=value where value contains =', () => {
    const result = parseArgs(['node', 'script', '--config=a=b']);
    assert.equal(result.config, 'a=b');
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

});

// ---------------------------------------------------------------------------
// parseYamlSimple
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir;
  const fallback = {
    'chunk-review': {
      chairman: { role: 'auto' },
      reviewers: [
        { name: 'claude', command: 'claude -p', emoji: '\u{1F9E0}', color: 'CYAN' },
      ],
      settings: { exclude_chairman_from_reviewers: true, timeout: 300 },
    },
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses basic key-value in chairman section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].chairman.role, 'gemini');
  });

  it('parses reviewers array with multiple entries', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: alice',
      '      command: alice-cli',
      '    - name: bob',
      '      command: bob-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].reviewers.length, 2);
    assert.equal(result['chunk-review'].reviewers[0].name, 'alice');
    assert.equal(result['chunk-review'].reviewers[0].command, 'alice-cli');
    assert.equal(result['chunk-review'].reviewers[1].name, 'bob');
  });

  it('parses settings section with type coercion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 300',
      '    exclude_chairman_from_reviewers: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].settings.timeout, 300);
    assert.equal(result['chunk-review'].settings.exclude_chairman_from_reviewers, false);
  });

  it('skips comment lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      '# This is a comment',
      'chunk-review:',
      '  chairman:',
      '    # Another comment',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].chairman.role, 'codex');
  });

  it('falls back to default reviewers when none defined', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: auto',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.deepEqual(result['chunk-review'].reviewers, fallback['chunk-review'].reviewers);
  });

  it('returns fallback on read error (non-existent file)', () => {
    const result = parseYamlSimple(path.join(tmpDir, 'missing.yaml'), fallback);
    assert.deepEqual(result, fallback);
  });

  it('merges chairman with fallback defaults', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    name: custom',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].chairman.name, 'custom');
    assert.equal(result['chunk-review'].chairman.role, 'auto');
  });

  it('handles "members:" as alias for reviewers section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].reviewers.length, 1);
    assert.equal(result['chunk-review'].reviewers[0].name, 'alice');
  });

  it('strips quotes from reviewer name values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: "quoted-name"',
      '      command: some-cmd',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].reviewers[0].name, 'quoted-name');
  });

  it('skips empty lines', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '',
      '  chairman:',
      '',
      '    role: codex',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].chairman.role, 'codex');
  });

  it('coerces "true" string to boolean true in settings', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    verbose: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.strictEqual(result['chunk-review'].settings.verbose, true);
  });

  it('parses hyphen keys in settings section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    bucket-size: 50',
      '    exclude-chairman: true',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.strictEqual(result['chunk-review'].settings['bucket-size'], 50);
    assert.strictEqual(result['chunk-review'].settings['exclude-chairman'], true);
  });

  it('parses hyphen keys in reviewer properties', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: alice',
      '      effort-level: high',
      '      output-format: json',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].reviewers[0]['effort-level'], 'high');
    assert.equal(result['chunk-review'].reviewers[0]['output-format'], 'json');
  });

  it('parses values containing colons', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    command: gemini --flag=value:123',
      '  reviewers:',
      '    - name: alice',
      '      command: claude --endpoint=http://localhost:8080',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    assert.equal(result['chunk-review'].chairman.command, 'gemini --flag=value:123');
    assert.equal(result['chunk-review'].reviewers[0].command, 'claude --endpoint=http://localhost:8080');
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

  it('returns fallback when config file does not exist', () => {
    const result = parseChunkReviewConfig(path.join(tmpDir, 'missing.yaml'));
    assert.ok(result['chunk-review']);
    assert.ok(Array.isArray(result['chunk-review'].reviewers));
    assert.ok(result['chunk-review'].reviewers.length > 0);
    assert.equal(result['chunk-review'].chairman.role, 'auto');
  });

  it('fallback contains default reviewers (claude, codex, gemini)', () => {
    const result = parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const names = result['chunk-review'].reviewers.map(r => r.name);
    assert.ok(names.includes('claude'));
    assert.ok(names.includes('codex'));
    assert.ok(names.includes('gemini'));
  });

  it('fallback contains default settings', () => {
    const result = parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    assert.equal(result['chunk-review'].settings.exclude_chairman_from_reviewers, true);
    assert.equal(result['chunk-review'].settings.timeout, 300);
  });

  it('parses valid config via simple parser (yaml module unavailable)', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: gemini',
      '  reviewers:',
      '    - name: alice',
      '      command: alice-cli',
      '  settings:',
      '    timeout: 600',
    ].join('\n'));
    const result = parseChunkReviewConfig(configPath);
    assert.equal(result['chunk-review'].chairman.role, 'gemini');
    assert.equal(result['chunk-review'].reviewers.length, 1);
    assert.equal(result['chunk-review'].reviewers[0].name, 'alice');
    assert.equal(result['chunk-review'].settings.timeout, 600);
  });

  it('merges settings with defaults from fallback', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 999',
    ].join('\n'));
    const result = parseChunkReviewConfig(configPath);
    assert.equal(result['chunk-review'].settings.timeout, 999);
    assert.equal(result['chunk-review'].settings.exclude_chairman_from_reviewers, true);
  });

  it('returns structure with chunk-review top-level key', () => {
    const result = parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const keys = Object.keys(result);
    assert.deepEqual(keys, ['chunk-review']);
  });
});

// ---------------------------------------------------------------------------
// buildUiPayload
// ---------------------------------------------------------------------------

describe('buildUiPayload', () => {
  it('returns progress, codex, and claude keys', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 1, done: 1, queued: 0, running: 0, error: 0 },
      reviewers: [{ reviewer: 'alice', state: 'done', exitCode: 0 }],
    };
    const result = buildUiPayload(payload);
    assert.ok(result.progress);
    assert.ok(result.codex);
    assert.ok(result.claude);
  });

  it('reports correct progress done/total', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 3, done: 1, error: 1, queued: 0, running: 1, missing_cli: 0, timed_out: 0, canceled: 0 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'error' },
        { reviewer: 'carol', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.progress.done, 2);
    assert.equal(result.progress.total, 3);
  });

  it('marks dispatch as completed when no queued reviewers', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 1, queued: 0, running: 1 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.codex.update_plan.plan[0].status, 'completed');
  });

  it('marks dispatch as in_progress when queued reviewers exist', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 1, running: 1 },
      reviewers: [
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'queued' },
      ],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.codex.update_plan.plan[0].status, 'in_progress');
  });

  it('marks terminal-state reviewers as completed', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 3, done: 1, error: 1, missing_cli: 1, queued: 0, running: 0 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'error' },
        { reviewer: 'carol', state: 'missing_cli' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    for (const step of reviewerSteps) {
      assert.equal(step.status, 'completed');
    }
  });

  it('marks first running reviewer as in_progress when dispatch completed', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 0, running: 2 },
      reviewers: [
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    assert.equal(reviewerSteps[0].status, 'in_progress');
    assert.equal(reviewerSteps[1].status, 'pending');
  });

  it('handles empty reviewers array', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0, done: 0, queued: 0, running: 0 },
      reviewers: [],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.progress.done, 0);
    assert.equal(result.progress.total, 0);
    assert.equal(result.codex.update_plan.plan.length, 2);
  });

  it('all reviewers done sets synth to in_progress', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 2, queued: 0, running: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'done' },
      ],
    };
    const result = buildUiPayload(payload);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    assert.equal(synthStep.status, 'in_progress');
  });

  it('all reviewers error sets synth to in_progress (all terminal, isDone)', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 0, queued: 0, running: 0, error: 2 },
      reviewers: [
        { reviewer: 'alice', state: 'error' },
        { reviewer: 'bob', state: 'error' },
      ],
    };
    const result = buildUiPayload(payload);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    assert.equal(synthStep.status, 'in_progress');
  });

  it('synth is pending when not all done', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 1, queued: 0, running: 1 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    const plan = result.codex.update_plan.plan;
    const synthStep = plan[plan.length - 1];
    assert.equal(synthStep.status, 'pending');
  });

  it('claude todos have content, status, and activeForm fields', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 1, done: 1, queued: 0, running: 0 },
      reviewers: [{ reviewer: 'alice', state: 'done' }],
    };
    const result = buildUiPayload(payload);
    for (const todo of result.claude.todo_write.todos) {
      assert.ok('content' in todo);
      assert.ok('status' in todo);
      assert.ok('activeForm' in todo);
    }
  });

  it('reviewer labels contain [Chunk Review] prefix', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      reviewers: [{ reviewer: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    const reviewerStep = result.codex.update_plan.plan[1];
    assert.ok(reviewerStep.step.startsWith('[Chunk Review]'));
  });

  it('sorts reviewers alphabetically', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 3, done: 0, queued: 0, running: 3 },
      reviewers: [
        { reviewer: 'carol', state: 'running' },
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    assert.ok(reviewerSteps[0].step.includes('alice'));
    assert.ok(reviewerSteps[1].step.includes('bob'));
    assert.ok(reviewerSteps[2].step.includes('carol'));
  });

  it('filters out reviewers with null/empty entity', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 2, done: 1, queued: 0, running: 0 },
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: null, state: 'done' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    assert.equal(reviewerSteps.length, 1);
  });

  it('handles missing counts gracefully', () => {
    const payload = {
      overallState: 'done',
      reviewers: [],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.progress.done, 0);
    assert.equal(result.progress.total, 0);
  });

  it('handles missing reviewers gracefully', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0 },
    };
    const result = buildUiPayload(payload);
    assert.equal(result.codex.update_plan.plan.length, 2);
  });

  it('hasInProgress propagation: dispatch in_progress prevents reviewer in_progress', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 1, running: 1 },
      reviewers: [
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'queued' },
      ],
    };
    const result = buildUiPayload(payload);
    const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
    assert.equal(reviewerSteps[0].status, 'pending');
    assert.equal(reviewerSteps[1].status, 'pending');
  });

  it('overallState is propagated in progress', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      reviewers: [{ reviewer: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    assert.equal(result.progress.overallState, 'running');
  });
});

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------

describe('computeStatus', () => {
  let tmpDir;

  function setupJob(jobDir, jobJson, reviewers) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(jobJson));
    const reviewersDir = path.join(jobDir, 'reviewers');
    fs.mkdirSync(reviewersDir, { recursive: true });
    for (const [name, status] of Object.entries(reviewers)) {
      const dir = path.join(reviewersDir, name);
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

  it('returns done overallState when all reviewers are terminal', () => {
    const jobDir = path.join(tmpDir, 'job1');
    setupJob(jobDir, { id: 'test-1' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.overallState, 'done');
    assert.equal(result.counts.total, 2);
    assert.equal(result.counts.done, 2);
    assert.equal(result.counts.running, 0);
  });

  it('returns running overallState when some reviewers are running', () => {
    const jobDir = path.join(tmpDir, 'job2');
    setupJob(jobDir, { id: 'test-2' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'running' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.overallState, 'running');
    assert.equal(result.counts.running, 1);
    assert.equal(result.counts.done, 1);
  });

  it('returns queued overallState when only queued (no running)', () => {
    const jobDir = path.join(tmpDir, 'job3');
    setupJob(jobDir, { id: 'test-3' }, {
      alice: { reviewer: 'alice', state: 'queued' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.overallState, 'queued');
    assert.equal(result.counts.queued, 1);
  });

  it('counts error states correctly', () => {
    const jobDir = path.join(tmpDir, 'job4');
    setupJob(jobDir, { id: 'test-4' }, {
      alice: { reviewer: 'alice', state: 'error', exitCode: 1 },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
      carol: { reviewer: 'carol', state: 'missing_cli' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.overallState, 'done');
    assert.equal(result.counts.error, 1);
    assert.equal(result.counts.missing_cli, 1);
    assert.equal(result.counts.done, 1);
  });

  it('skips reviewer directories without status.json', () => {
    const jobDir = path.join(tmpDir, 'job7');
    setupJob(jobDir, { id: 'test-7' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    fs.mkdirSync(path.join(jobDir, 'reviewers', 'bob'));
    const result = computeStatus(jobDir);
    assert.equal(result.counts.total, 1);
    assert.equal(result.reviewers.length, 1);
  });

  it('sorts reviewers alphabetically by name', () => {
    const jobDir = path.join(tmpDir, 'job8');
    setupJob(jobDir, { id: 'test-8' }, {
      carol: { reviewer: 'carol', state: 'done' },
      alice: { reviewer: 'alice', state: 'done' },
      bob: { reviewer: 'bob', state: 'done' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.reviewers[0].reviewer, 'alice');
    assert.equal(result.reviewers[1].reviewer, 'bob');
    assert.equal(result.reviewers[2].reviewer, 'carol');
  });

  it('includes reviewer metadata (startedAt, finishedAt, exitCode, message)', () => {
    const jobDir = path.join(tmpDir, 'job9');
    setupJob(jobDir, { id: 'test-9' }, {
      alice: {
        reviewer: 'alice',
        state: 'done',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:01:00Z',
        exitCode: 0,
        message: 'success',
      },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.reviewers[0].startedAt, '2026-01-01T00:00:00Z');
    assert.equal(result.reviewers[0].finishedAt, '2026-01-01T00:01:00Z');
    assert.equal(result.reviewers[0].exitCode, 0);
    assert.equal(result.reviewers[0].message, 'success');
  });

  it('returns null for missing reviewer metadata fields', () => {
    const jobDir = path.join(tmpDir, 'job10');
    setupJob(jobDir, { id: 'test-10' }, {
      alice: { reviewer: 'alice', state: 'running' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.reviewers[0].startedAt, null);
    assert.equal(result.reviewers[0].finishedAt, null);
    assert.equal(result.reviewers[0].exitCode, null);
    assert.equal(result.reviewers[0].message, null);
  });

  it('includes jobDir and id in result', () => {
    const jobDir = path.join(tmpDir, 'job11');
    setupJob(jobDir, { id: 'test-11' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.id, 'test-11');
    assert.ok(result.jobDir.endsWith('job11'));
  });

  it('includes chairmanRole from job.json', () => {
    const jobDir = path.join(tmpDir, 'job12');
    setupJob(jobDir, { id: 'test-12', chairmanRole: 'claude' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.chairmanRole, 'claude');
  });

  it('treats retrying reviewer as non-terminal (running)', () => {
    const jobDir = path.join(tmpDir, 'job13');
    setupJob(jobDir, { id: 'test-13' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'retrying' },
    });
    const result = computeStatus(jobDir);
    assert.equal(result.overallState, 'running');
    assert.equal(result.counts.retrying, 1);
    assert.equal(result.counts.done, 1);
  });

  it('transitions stale queued reviewer to error when queuedAt exceeds threshold', () => {
    const jobDir = path.join(tmpDir, 'job-stale');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-stale', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    assert.equal(alice.state, 'error');
    assert.equal(result.counts.error, 1);
    assert.equal(result.counts.queued, 0);
  });

  it('does not transition queued reviewer that is within staleness threshold', () => {
    const jobDir = path.join(tmpDir, 'job-fresh');
    const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-fresh', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: freshTime },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    assert.equal(alice.state, 'queued');
    assert.equal(result.counts.queued, 1);
  });

  it('uses 120s minimum threshold when timeoutSec is 0', () => {
    const jobDir = path.join(tmpDir, 'job-zero-timeout');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-zero', settings: { timeoutSec: 0 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
    });
    // threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    assert.equal(alice.state, 'error');
  });

  it('uses file mtime as fallback when queuedAt is missing', () => {
    const jobDir = path.join(tmpDir, 'job-no-queued-at');
    setupJob(jobDir, { id: 'test-mtime', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued' },
    });
    // Force the file mtime to be old
    const statusPath = path.join(jobDir, 'reviewers', 'alice', 'status.json');
    const oldTime = new Date(Date.now() - 200_000);
    fs.utimesSync(statusPath, oldTime, oldTime);
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    assert.equal(alice.state, 'error');
  });

  it('writes error details to status.json on staleness transition', () => {
    const jobDir = path.join(tmpDir, 'job-stale-write');
    const staleTime = new Date(Date.now() - 200_000).toISOString();
    setupJob(jobDir, { id: 'test-write', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
    });
    computeStatus(jobDir);
    const statusPath = path.join(jobDir, 'reviewers', 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(written.state, 'error');
    assert.ok(written.error.includes('stale'), `Expected error message to contain "stale", got: ${written.error}`);
  });
});

// ---------------------------------------------------------------------------
// detectCliType
// ---------------------------------------------------------------------------

describe('detectCliType', () => {
  it('returns "claude" for "claude -p"', () => {
    assert.equal(detectCliType('claude -p'), 'claude');
  });

  it('returns "codex" for "codex exec"', () => {
    assert.equal(detectCliType('codex exec'), 'codex');
  });

  it('returns "gemini" for bare "gemini"', () => {
    assert.equal(detectCliType('gemini'), 'gemini');
  });

  it('returns "unknown" for unrecognized command', () => {
    assert.equal(detectCliType('my-script'), 'unknown');
  });

  it('returns "unknown" for null', () => {
    assert.equal(detectCliType(null), 'unknown');
  });

  it('returns "unknown" for empty string', () => {
    assert.equal(detectCliType(''), 'unknown');
  });

  it('returns "unknown" for undefined', () => {
    assert.equal(detectCliType(undefined), 'unknown');
  });

  it('returns "claude" when command has leading whitespace', () => {
    assert.equal(detectCliType('  claude --model opus'), 'claude');
  });
});

// ---------------------------------------------------------------------------
// buildAugmentedCommand
// ---------------------------------------------------------------------------

describe('buildAugmentedCommand', () => {
  it('claude: appends --model and --output-format, sets env for effort_level', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: 'opus', effort_level: 'high', output_format: 'json' },
      'claude',
    );
    assert.equal(result.command, 'claude -p --model opus --output-format json');
    assert.deepEqual(result.env, { CLAUDECODE: '', CLAUDE_CODE_EFFORT_LEVEL: 'high' });
  });

  it('codex: appends -m, -c for effort, --json for output_format', () => {
    const result = buildAugmentedCommand(
      { command: 'codex exec', model: 'o3', effort_level: 'high', output_format: 'json' },
      'codex',
    );
    assert.equal(result.command, 'codex exec -m o3 -c model_reasoning_effort=high --json');
    assert.deepEqual(result.env, {});
  });

  it('gemini: appends --model, ignores effort_level', () => {
    const result = buildAugmentedCommand(
      { command: 'gemini', model: 'gemini-2.5-pro', effort_level: 'high' },
      'gemini',
    );
    assert.equal(result.command, 'gemini --model gemini-2.5-pro');
    assert.deepEqual(result.env, {});
  });

  it('gemini: appends --output-format for json', () => {
    const result = buildAugmentedCommand(
      { command: 'gemini', output_format: 'json' },
      'gemini',
    );
    assert.equal(result.command, 'gemini --output-format json');
    assert.deepEqual(result.env, {});
  });

  // CLAUDECODE: '' is intentional — it prevents Claude CLI nested session errors.
  // buildAugmentedCommand always injects this env override for 'claude' CLI type
  // (see job.js buildAugmentedCommand), so it is not an "extra" field but a
  // required guard that must appear in every claude-type env expectation.
  it('no fields present: returns command unchanged with empty env', () => {
    const result = buildAugmentedCommand({ command: 'claude -p' }, 'claude');
    assert.equal(result.command, 'claude -p');
    assert.deepEqual(result.env, { CLAUDECODE: '' });
  });

  it('falsy values (empty string, null): treated as absent', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: '', effort_level: null },
      'claude',
    );
    assert.equal(result.command, 'claude -p');
    assert.deepEqual(result.env, { CLAUDECODE: '' });
  });

  it('falsy values (undefined): treated as absent', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', model: undefined, effort_level: undefined, output_format: undefined },
      'claude',
    );
    assert.equal(result.command, 'claude -p');
    assert.deepEqual(result.env, { CLAUDECODE: '' });
  });

  it('unknown CLI type: only appends --model, ignores effort and output_format', () => {
    const result = buildAugmentedCommand(
      { command: 'my-script', model: 'gpt-4', effort_level: 'high', output_format: 'json' },
      'unknown',
    );
    assert.equal(result.command, 'my-script --model gpt-4');
    assert.deepEqual(result.env, {});
  });

  it('output_format "text" is ignored (no flag appended)', () => {
    const result = buildAugmentedCommand(
      { command: 'claude -p', output_format: 'text' },
      'claude',
    );
    assert.equal(result.command, 'claude -p');
    assert.deepEqual(result.env, { CLAUDECODE: '' });
  });

  it('codex output_format non-json still appends --json', () => {
    const result = buildAugmentedCommand(
      { command: 'codex exec', output_format: 'stream' },
      'codex',
    );
    assert.equal(result.command, 'codex exec --json');
    assert.deepEqual(result.env, {});
  });

  it('claude: unsets CLAUDECODE env to prevent nested session error', () => {
    const result = buildAugmentedCommand({ command: 'claude -p' }, 'claude');
    assert.equal(result.env.CLAUDECODE, '');
  });

  it('non-claude: does not include CLAUDECODE in env', () => {
    const result = buildAugmentedCommand({ command: 'gemini' }, 'gemini');
    assert.equal(result.env.CLAUDECODE, undefined);
  });
});

// ---------------------------------------------------------------------------
// cmdClean — path traversal guard (Fix A)
// ---------------------------------------------------------------------------

describe('cmdClean path traversal guard', () => {
  const SCRIPT = path.join(__dirname, 'chunk-review-job.js');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a path outside the configured jobs directory', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const outsidePath = path.join(tmpDir, 'not-jobs', 'evil');
    fs.mkdirSync(outsidePath, { recursive: true });

    assert.throws(
      () => {
        execFileSync(process.execPath, [
          SCRIPT, 'clean', '--jobs-dir', jobsDir, outsidePath,
        ], { stdio: 'pipe' });
      },
      (err) => {
        assert.equal(err.status, 1);
        assert.ok(
          err.stderr.toString().includes('refusing to delete path outside jobs directory'),
          `Expected stderr to mention path guard, got: ${err.stderr.toString()}`,
        );
        return true;
      },
    );

    // The outside directory must still exist (not deleted)
    assert.ok(fs.existsSync(outsidePath), 'outside path should NOT have been deleted');
  });

  it('accepts and cleans a path inside the configured jobs directory', () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const jobDir = path.join(jobsDir, 'chunk-review-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'dummy.txt'), 'test');

    const result = execFileSync(process.execPath, [
      SCRIPT, 'clean', '--jobs-dir', jobsDir, jobDir,
    ], { stdio: 'pipe' });

    assert.ok(
      result.toString().includes('cleaned:'),
      `Expected stdout to include "cleaned:", got: ${result.toString()}`,
    );
    assert.ok(!fs.existsSync(jobDir), 'job directory should have been deleted');
  });
});

// ---------------------------------------------------------------------------
// spawnWorkers — safe name collision detection (Fix B)
// ---------------------------------------------------------------------------

describe('spawnWorkers safe name collision detection', () => {
  const SCRIPT = path.join(__dirname, 'chunk-review-job.js');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits with error when two reviewers produce the same safe name', () => {
    // Create a config where two reviewers collide:
    // "Alice!" and "alice?" both produce safe name "alice-"
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: none',
      '  reviewers:',
      '    - name: "Alice!"',
      '      command: echo test1',
      '    - name: "alice?"',
      '      command: echo test2',
      '  settings:',
      '    exclude_chairman_from_reviewers: false',
      '    timeout: 10',
    ].join('\n'));

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    assert.throws(
      () => {
        execFileSync(process.execPath, [
          SCRIPT, 'start',
          '--config', configPath,
          '--jobs-dir', jobsDir,
          '--chairman', 'none',
          'test prompt',
        ], { stdio: 'pipe' });
      },
      (err) => {
        assert.equal(err.status, 1);
        assert.ok(
          err.stderr.toString().includes('reviewer name collision'),
          `Expected stderr to mention collision, got: ${err.stderr.toString()}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// --exclude-chairman=false boolean parsing (Bug fix)
// ---------------------------------------------------------------------------

describe('--exclude-chairman=false keeps chairman in reviewers', () => {
  const SCRIPT = path.join(__dirname, 'chunk-review-job.js');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--exclude-chairman=false does NOT exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  reviewers:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_reviewers: true',
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
    const reviewerNames = output.reviewers.map(r => r.name);
    assert.ok(
      reviewerNames.includes('claude'),
      `Expected chairman "claude" to be included in reviewers, got: ${JSON.stringify(reviewerNames)}`,
    );
    assert.equal(output.settings.excludeChairmanFromReviewers, false);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  it('--exclude-chairman (no value) DOES exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  reviewers:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_reviewers: false',
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
    const reviewerNames = output.reviewers.map(r => r.name);
    assert.ok(
      !reviewerNames.includes('claude'),
      `Expected chairman "claude" to be excluded from reviewers, got: ${JSON.stringify(reviewerNames)}`,
    );
    assert.equal(output.settings.excludeChairmanFromReviewers, true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });

  it('--exclude-chairman=true DOES exclude the chairman reviewer', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: claude',
      '  reviewers:',
      '    - name: claude',
      '      command: echo claude',
      '    - name: gemini',
      '      command: echo gemini',
      '  settings:',
      '    exclude_chairman_from_reviewers: false',
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
    const reviewerNames = output.reviewers.map(r => r.name);
    assert.ok(
      !reviewerNames.includes('claude'),
      `Expected chairman "claude" to be excluded from reviewers, got: ${JSON.stringify(reviewerNames)}`,
    );
    assert.equal(output.settings.excludeChairmanFromReviewers, true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });
});

#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
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
  parseSpecReviewConfig,
  parseYamlSimple,
  computeStatus,
  resolveContextDir,
} from './spec-review-job.ts';

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
  test('returns claude when path contains /.claude/skills/', () => {
    expect(detectHostRole('/home/user/.claude/skills/spec-review')).toBe('claude');
  });

  test('returns codex when path contains /.codex/skills/', () => {
    expect(detectHostRole('/home/user/.codex/skills/spec-review')).toBe('codex');
  });

  test('returns unknown for unrecognized paths', () => {
    expect(detectHostRole('/home/user/projects/spec-review')).toBe('unknown');
  });

  test('normalizes backslashes on Windows-style paths', () => {
    expect(detectHostRole('C:\\Users\\dev\\.claude\\skills\\review')).toBe('claude');
  });

  test('returns unknown for empty string', () => {
    expect(detectHostRole('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// normalizeBool
// ---------------------------------------------------------------------------

describe('normalizeBool', () => {
  test('returns null for null input', () => {
    expect(normalizeBool(null)).toBe(null);
  });

  test('returns null for undefined input', () => {
    expect(normalizeBool(undefined)).toBe(null);
  });

  for (const truthy of ['1', 'true', 'yes', 'y', 'on', 'TRUE', 'Yes', 'ON']) {
    test(`returns true for "${truthy}"`, () => {
      expect(normalizeBool(truthy)).toBe(true);
    });
  }

  for (const falsy of ['0', 'false', 'no', 'n', 'off', 'FALSE', 'No', 'OFF']) {
    test(`returns false for "${falsy}"`, () => {
      expect(normalizeBool(falsy)).toBe(false);
    });
  }

  test('returns null for unrecognized string', () => {
    expect(normalizeBool('maybe')).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(normalizeBool('')).toBe(null);
  });

  test('handles numeric 1 (non-string)', () => {
    expect(normalizeBool(1)).toBe(true);
  });

  test('handles numeric 0 (non-string)', () => {
    expect(normalizeBool(0)).toBe(false);
  });

  test('trims whitespace', () => {
    expect(normalizeBool('  true  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoRole
// ---------------------------------------------------------------------------

describe('resolveAutoRole', () => {
  test('returns explicit role when provided', () => {
    expect(resolveAutoRole('gemini', 'claude')).toBe('gemini');
  });

  test('returns codex when role is auto and hostRole is codex', () => {
    expect(resolveAutoRole('auto', 'codex')).toBe('codex');
  });

  test('returns claude when role is auto and hostRole is claude', () => {
    expect(resolveAutoRole('auto', 'claude')).toBe('claude');
  });

  test('returns claude when role is auto and hostRole is unknown', () => {
    expect(resolveAutoRole('auto', 'unknown')).toBe('claude');
  });

  test('falls through to hostRole when role is empty string', () => {
    expect(resolveAutoRole('', 'codex')).toBe('codex');
  });

  test('falls through to hostRole when role is null', () => {
    expect(resolveAutoRole(null, 'codex')).toBe('codex');
  });

  test('returns claude when role is undefined', () => {
    expect(resolveAutoRole(undefined, 'claude')).toBe('claude');
  });

  test('normalizes role to lowercase', () => {
    expect(resolveAutoRole('CLAUDE', 'codex')).toBe('claude');
  });

  test('trims whitespace from role', () => {
    expect(resolveAutoRole('  gemini  ', 'claude')).toBe('gemini');
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

  test('creates a new directory', () => {
    const dir = path.join(tmpDir, 'new-dir');
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBeTruthy();
    expect(fs.statSync(dir).isDirectory()).toBeTruthy();
  });

  test('creates nested directories recursively', () => {
    const dir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBeTruthy();
  });

  test('does not throw if directory already exists', () => {
    const dir = path.join(tmpDir, 'existing');
    fs.mkdirSync(dir);
    expect(() => ensureDir(dir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// safeFileName
// ---------------------------------------------------------------------------

describe('safeFileName', () => {
  test('converts name to lowercase with safe characters', () => {
    expect(safeFileName('MyReviewer')).toBe('myreviewer');
  });

  test('replaces special characters with hyphens', () => {
    expect(safeFileName('hello world!')).toBe('hello-world-');
  });

  test('returns fallback "reviewer" for empty string', () => {
    expect(safeFileName('')).toBe('reviewer');
  });

  test('returns fallback "reviewer" for null', () => {
    expect(safeFileName(null)).toBe('reviewer');
  });

  test('returns fallback "reviewer" for undefined', () => {
    expect(safeFileName(undefined)).toBe('reviewer');
  });

  test('uses custom fallback when provided', () => {
    expect(safeFileName('', 'custom')).toBe('custom');
  });

  test('preserves hyphens and underscores', () => {
    expect(safeFileName('my-review_name')).toBe('my-review_name');
  });

  test('handles string with only special characters', () => {
    expect(safeFileName('!!!')).toBe('-');
  });

  test('returns fallback for whitespace-only string', () => {
    expect(safeFileName('   ')).toBe('reviewer');
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

  test('writes valid JSON to the target path', () => {
    const filePath = path.join(tmpDir, 'test.json');
    const payload = { state: 'done', exitCode: 0 };
    atomicWriteJson(filePath, payload);
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(result).toEqual(payload);
  });

  test('overwrites existing file atomically', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { v: 1 });
    atomicWriteJson(filePath, { v: 2 });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(result.v).toBe(2);
  });

  test('formats JSON with 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { a: 1 });
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  test('does not leave tmp files on success', () => {
    const filePath = path.join(tmpDir, 'test.json');
    atomicWriteJson(filePath, { ok: true });
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe('test.json');
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

  test('reads and parses existing JSON file', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');
    const result = readJsonIfExists(filePath);
    expect(result).toEqual({ key: 'value' });
  });

  test('returns null for non-existent file', () => {
    const result = readJsonIfExists(path.join(tmpDir, 'missing.json'));
    expect(result).toBe(null);
  });

  test('returns null for invalid JSON content', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json', 'utf8');
    const result = readJsonIfExists(filePath);
    expect(result).toBe(null);
  });

  test('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '', 'utf8');
    const result = readJsonIfExists(filePath);
    expect(result).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// sleepMs
// ---------------------------------------------------------------------------

describe('sleepMs', () => {
  test('blocks for approximately the specified duration', () => {
    const start = Date.now();
    sleepMs(50);
    const elapsed = Date.now() - start;
    expect(elapsed >= 40).toBe(true);
    expect(elapsed < 200).toBe(true);
  });

  test('returns immediately for zero', () => {
    const start = Date.now();
    sleepMs(0);
    const elapsed = Date.now() - start;
    expect(elapsed < 50).toBe(true);
  });

  test('returns immediately for negative value', () => {
    const start = Date.now();
    sleepMs(-100);
    const elapsed = Date.now() - start;
    expect(elapsed < 50).toBe(true);
  });

  test('returns immediately for NaN', () => {
    const start = Date.now();
    sleepMs(NaN);
    const elapsed = Date.now() - start;
    expect(elapsed < 50).toBe(true);
  });

  test('returns immediately for Infinity', () => {
    const start = Date.now();
    sleepMs(Infinity);
    const elapsed = Date.now() - start;
    expect(elapsed < 50).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeTerminalDoneCount
// ---------------------------------------------------------------------------

describe('computeTerminalDoneCount', () => {
  test('sums all terminal states', () => {
    const counts = { done: 3, missing_cli: 1, error: 2, timed_out: 1, canceled: 1 };
    expect(computeTerminalDoneCount(counts)).toBe(8);
  });

  test('returns 0 for empty counts', () => {
    expect(computeTerminalDoneCount({})).toBe(0);
  });

  test('returns 0 for null input', () => {
    expect(computeTerminalDoneCount(null)).toBe(0);
  });

  test('returns 0 for undefined input', () => {
    expect(computeTerminalDoneCount(undefined)).toBe(0);
  });

  test('handles partial counts', () => {
    expect(computeTerminalDoneCount({ done: 5 })).toBe(5);
  });

  test('coerces string numbers', () => {
    expect(computeTerminalDoneCount({ done: '3', error: '2' })).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// asCodexStepStatus
// ---------------------------------------------------------------------------

describe('asCodexStepStatus', () => {
  test('returns pending for "pending"', () => {
    expect(asCodexStepStatus('pending')).toBe('pending');
  });

  test('returns in_progress for "in_progress"', () => {
    expect(asCodexStepStatus('in_progress')).toBe('in_progress');
  });

  test('returns completed for "completed"', () => {
    expect(asCodexStepStatus('completed')).toBe('completed');
  });

  test('returns pending for unknown value', () => {
    expect(asCodexStepStatus('running')).toBe('pending');
  });

  test('returns pending for empty string', () => {
    expect(asCodexStepStatus('')).toBe('pending');
  });

  test('returns pending for null', () => {
    expect(asCodexStepStatus(null)).toBe('pending');
  });

  test('returns pending for undefined', () => {
    expect(asCodexStepStatus(undefined)).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  test('parses positional arguments', () => {
    const result = parseArgs(['node', 'script', 'start', 'hello']);
    expect(result._).toEqual(['start', 'hello']);
  });

  test('parses boolean flags', () => {
    const result = parseArgs(['node', 'script', '--json', '--verbose']);
    expect(result.json).toBe(true);
    expect(result.verbose).toBe(true);
  });

  test('parses key=value pairs', () => {
    const result = parseArgs(['node', 'script', '--config=/path/to/file']);
    expect(result.config).toBe('/path/to/file');
  });

  test('parses key-value pairs with space separator', () => {
    const result = parseArgs(['node', 'script', '--config', '/path/to/file']);
    expect(result.config).toBe('/path/to/file');
  });

  test('stops parsing at --', () => {
    const result = parseArgs(['node', 'script', '--json', '--', 'rest', 'args']);
    expect(result.json).toBe(true);
    expect(result._).toEqual(['rest', 'args']);
  });

  test('treats known boolean flags as true without next arg consumption', () => {
    const result = parseArgs(['node', 'script', '--help', 'start']);
    expect(result.help).toBe(true);
    expect(result._).toEqual(['start']);
  });

  test('treats unknown flag without value as true', () => {
    const result = parseArgs(['node', 'script', '--unknown', '--json']);
    expect(result.unknown).toBe(true);
    expect(result.json).toBe(true);
  });

  test('returns empty positional array when no positional args', () => {
    const result = parseArgs(['node', 'script', '--json']);
    expect(result._).toEqual([]);
  });

  test('parses --include-chairman as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--include-chairman']);
    expect(result['include-chairman']).toBe(true);
  });

  test('parses --exclude-chairman as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--exclude-chairman']);
    expect(result['exclude-chairman']).toBe(true);
  });

  test('parses --stdin as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--stdin']);
    expect(result.stdin).toBe(true);
  });

  test('parses --h as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--h']);
    expect(result.h).toBe(true);
  });

  test('parses mixed positional and flag arguments', () => {
    const result = parseArgs(['node', 'script', 'start', '--json', '--config', 'myfile', 'extra']);
    expect(result.json).toBe(true);
    expect(result.config).toBe('myfile');
    expect(result._).toEqual(['start', 'extra']);
  });

  test('handles empty argv (only node and script)', () => {
    const result = parseArgs(['node', 'script']);
    expect(result._).toEqual([]);
  });

  test('unknown flag followed by another flag is treated as boolean true', () => {
    const result = parseArgs(['node', 'script', '--foo', '--bar', 'val']);
    expect(result.foo).toBe(true);
    expect(result.bar).toBe('val');
  });

  test('handles --key=value where value contains =', () => {
    const result = parseArgs(['node', 'script', '--config=a=b']);
    expect(result.config).toBe('a=b');
  });
});

// ---------------------------------------------------------------------------
// parseWaitCursor
// ---------------------------------------------------------------------------

describe('parseWaitCursor', () => {
  describe('v1 format', () => {
    test('parses valid v1 cursor', () => {
      const result = parseWaitCursor('v1:5:3:0');
      expect(result).toEqual({
        version: 'v1',
        bucketSize: 5,
        dispatchBucket: 0,
        doneBucket: 3,
        isDone: false,
      });
    });

    test('parses v1 cursor with isDone=1', () => {
      const result = parseWaitCursor('v1:10:7:1');
      expect(result.isDone).toBe(true);
    });

    test('returns null for v1 with invalid bucketSize (0)', () => {
      expect(parseWaitCursor('v1:0:3:0')).toBe(null);
    });

    test('returns null for v1 with negative bucketSize', () => {
      expect(parseWaitCursor('v1:-1:3:0')).toBe(null);
    });

    test('returns null for v1 with negative doneBucket', () => {
      expect(parseWaitCursor('v1:5:-1:0')).toBe(null);
    });

    test('returns null for v1 with wrong number of parts', () => {
      expect(parseWaitCursor('v1:5:3')).toBe(null);
    });
  });

  describe('v2 format', () => {
    test('parses valid v2 cursor', () => {
      const result = parseWaitCursor('v2:5:1:3:0');
      expect(result).toEqual({
        version: 'v2',
        bucketSize: 5,
        dispatchBucket: 1,
        doneBucket: 3,
        isDone: false,
      });
    });

    test('parses v2 cursor with isDone=1', () => {
      const result = parseWaitCursor('v2:10:1:7:1');
      expect(result.isDone).toBe(true);
    });

    test('returns null for v2 with invalid bucketSize (0)', () => {
      expect(parseWaitCursor('v2:0:1:3:0')).toBe(null);
    });

    test('returns null for v2 with negative dispatchBucket', () => {
      expect(parseWaitCursor('v2:5:-1:3:0')).toBe(null);
    });

    test('returns null for v2 with negative doneBucket', () => {
      expect(parseWaitCursor('v2:5:1:-1:0')).toBe(null);
    });

    test('returns null for v2 with wrong number of parts', () => {
      expect(parseWaitCursor('v2:5:1:3')).toBe(null);
    });
  });

  describe('edge cases', () => {
    test('returns null for empty string', () => {
      expect(parseWaitCursor('')).toBe(null);
    });

    test('returns null for null', () => {
      expect(parseWaitCursor(null)).toBe(null);
    });

    test('returns null for undefined', () => {
      expect(parseWaitCursor(undefined)).toBe(null);
    });

    test('returns null for unknown version', () => {
      expect(parseWaitCursor('v3:5:3:0')).toBe(null);
    });

    test('trims whitespace', () => {
      const result = parseWaitCursor('  v2:5:1:3:0  ');
      expect(result).not.toBe(null);
      expect(result.version).toBe('v2');
    });

    test('returns null for non-numeric bucketSize', () => {
      expect(parseWaitCursor('v1:abc:3:0')).toBe(null);
    });
  });
});

// ---------------------------------------------------------------------------
// formatWaitCursor
// ---------------------------------------------------------------------------

describe('formatWaitCursor', () => {
  test('formats v2 cursor string with isDone=false', () => {
    expect(formatWaitCursor(5, 1, 3, false)).toBe('v2:5:1:3:0');
  });

  test('formats v2 cursor string with isDone=true', () => {
    expect(formatWaitCursor(10, 1, 7, true)).toBe('v2:10:1:7:1');
  });

  test('formats with zero values', () => {
    expect(formatWaitCursor(1, 0, 0, false)).toBe('v2:1:0:0:0');
  });

  test('roundtrips with parseWaitCursor', () => {
    const cursor = formatWaitCursor(5, 1, 3, true);
    const parsed = parseWaitCursor(cursor);
    expect(parsed.bucketSize).toBe(5);
    expect(parsed.dispatchBucket).toBe(1);
    expect(parsed.doneBucket).toBe(3);
    expect(parsed.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveBucketSize
// ---------------------------------------------------------------------------

describe('resolveBucketSize', () => {
  test('returns explicit bucket size from options.bucket', () => {
    expect(resolveBucketSize({ bucket: '3' }, 10, null)).toBe(3);
  });

  test('returns explicit bucket size from options["bucket-size"]', () => {
    expect(resolveBucketSize({ 'bucket-size': '4' }, 10, null)).toBe(4);
  });

  test('prefers options.bucket over options["bucket-size"]', () => {
    expect(resolveBucketSize({ bucket: '3', 'bucket-size': '4' }, 10, null)).toBe(3);
  });

  test('truncates decimal bucket size', () => {
    expect(resolveBucketSize({ bucket: '3.7' }, 10, null)).toBe(3);
  });

  test('uses prevCursor bucketSize when options not set', () => {
    const prevCursor = { bucketSize: 7 };
    expect(resolveBucketSize({}, 10, prevCursor)).toBe(7);
  });

  test('uses prevCursor bucketSize when bucket is true (flag without value)', () => {
    const prevCursor = { bucketSize: 7 };
    expect(resolveBucketSize({ bucket: true }, 10, prevCursor)).toBe(7);
  });

  test('auto-computes bucket size as ceil(total/5)', () => {
    expect(resolveBucketSize({}, 10, null)).toBe(2);
  });

  test('auto-computes with minimum of 1', () => {
    expect(resolveBucketSize({}, 3, null)).toBe(1);
  });

  test('returns 1 when total is 0', () => {
    expect(resolveBucketSize({}, 0, null)).toBe(1);
  });

  test('returns 1 when total is null', () => {
    expect(resolveBucketSize({}, null, null)).toBe(1);
  });

  test('handles auto string for bucket', () => {
    expect(resolveBucketSize({ bucket: 'auto' }, 15, null)).toBe(3);
  });

  test('handles AUTO string (case insensitive)', () => {
    expect(resolveBucketSize({ bucket: 'AUTO' }, 20, null)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------

describe('generateJobId', () => {
  test('returns a string', () => {
    expect(typeof generateJobId()).toBe('string');
  });

  test('matches expected format: YYYY-MM-DD-HHmm-hex', () => {
    const id = generateJobId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4,6}-[0-9a-f]{6}$/);
  });

  test('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      ids.add(generateJobId());
    }
    expect(ids.size).toBe(10);
  });

  test('starts with current date', () => {
    const id = generateJobId();
    const today = new Date().toISOString().slice(0, 10);
    expect(id.startsWith(today)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseYamlSimple
// ---------------------------------------------------------------------------

describe('parseYamlSimple', () => {
  let tmpDir;
  const fallback = {
    'spec-review': {
      chairman: { role: 'auto' },
      reviewers: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
      ],
      context: {},
      settings: { exclude_chairman_from_reviewers: true, timeout: 180 },
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

  test('parses reviewers array with multiple entries', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  reviewers:',
      '    - name: alice',
      '      command: alice-cli',
      '    - name: bob',
      '      command: bob-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].reviewers.length).toBe(2);
    expect(result['spec-review'].reviewers[0].name).toBe('alice');
    expect(result['spec-review'].reviewers[0].command).toBe('alice-cli');
    expect(result['spec-review'].reviewers[1].name).toBe('bob');
  });

  test('parses context section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  context:',
      '    shared_context_dir: .omt/ctx',
      '    specs_dir: .omt/specs',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].context.shared_context_dir).toBe('.omt/ctx');
    expect(result['spec-review'].context.specs_dir).toBe('.omt/specs');
  });

  test('parses settings section with type coercion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  settings:',
      '    timeout: 300',
      '    exclude_chairman_from_reviewers: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].settings.timeout).toBe(300);
    expect(result['spec-review'].settings.exclude_chairman_from_reviewers).toBe(false);
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
    expect(result['spec-review'].reviewers).toEqual(fallback['spec-review'].reviewers);
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

  test('handles "members:" as alias for reviewers section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].reviewers.length).toBe(1);
    expect(result['spec-review'].reviewers[0].name).toBe('alice');
  });

  test('strips quotes from reviewer name values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'spec-review:',
      '  reviewers:',
      '    - name: "quoted-name"',
      '      command: some-cmd',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['spec-review'].reviewers[0].name).toBe('quoted-name');
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
    expect(Array.isArray(result['spec-review'].reviewers)).toBeTruthy();
    expect(result['spec-review'].reviewers.length > 0).toBeTruthy();
    expect(result['spec-review'].chairman.role).toBe('auto');
  });

  test('fallback contains default reviewers (claude, codex, gemini)', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const names = result['spec-review'].reviewers.map(r => r.name);
    expect(names.includes('claude')).toBeTruthy();
    expect(names.includes('codex')).toBeTruthy();
    expect(names.includes('gemini')).toBeTruthy();
  });

  test('fallback contains default settings', async () => {
    const result = await parseSpecReviewConfig(path.join(tmpDir, 'nope.yaml'));
    expect(result['spec-review'].settings.exclude_chairman_from_reviewers).toBe(true);
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
      '  reviewers:',
      '    - name: alice',
      '      command: alice-cli',
      '  context:',
      '    shared_context_dir: .omt/custom-ctx',
      '  settings:',
      '    timeout: 600',
    ].join('\n'));
    const result = await parseSpecReviewConfig(configPath);
    expect(result['spec-review'].chairman.role).toBe('gemini');
    expect(result['spec-review'].reviewers.length).toBe(1);
    expect(result['spec-review'].reviewers[0].name).toBe('alice');
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
    expect(result['spec-review'].settings.exclude_chairman_from_reviewers).toBe(true);
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
      reviewers: [{ reviewer: 'alice', state: 'done', exitCode: 0 }],
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
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'error' },
        { reviewer: 'carol', state: 'running' },
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
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'running' },
      ],
    };
    const result = buildUiPayload(payload);
    expect(result.codex.update_plan.plan[0].status).toBe('completed');
  });

  test('marks dispatch as in_progress when queued reviewers exist', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 2, done: 0, queued: 1, running: 1 },
      reviewers: [
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'queued' },
      ],
    };
    const result = buildUiPayload(payload);
    expect(result.codex.update_plan.plan[0].status).toBe('in_progress');
  });

  test('marks terminal-state reviewers as completed', () => {
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
      expect(step.status).toBe('completed');
    }
  });

  test('marks first running reviewer as in_progress when dispatch completed', () => {
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
    expect(reviewerSteps[0].status).toBe('in_progress');
    expect(reviewerSteps[1].status).toBe('pending');
  });

  test('handles empty reviewers array', () => {
    const payload = {
      overallState: 'done',
      counts: { total: 0, done: 0, queued: 0, running: 0 },
      reviewers: [],
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
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'done' },
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
      reviewers: [
        { reviewer: 'alice', state: 'error' },
        { reviewer: 'bob', state: 'error' },
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
      reviewers: [
        { reviewer: 'alice', state: 'done' },
        { reviewer: 'bob', state: 'running' },
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
      reviewers: [{ reviewer: 'alice', state: 'done' }],
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
      reviewers: [{ reviewer: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Spec Review]')).toBeTruthy();
  });

  test('sorts reviewers alphabetically', () => {
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
    expect(reviewerSteps[0].step.includes('alice')).toBeTruthy();
    expect(reviewerSteps[1].step.includes('bob')).toBeTruthy();
    expect(reviewerSteps[2].step.includes('carol')).toBeTruthy();
  });

  test('filters out reviewers with null/empty entity', () => {
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
    expect(reviewerSteps.length).toBe(1);
  });

  test('handles missing counts gracefully', () => {
    const payload = {
      overallState: 'done',
      reviewers: [],
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
      reviewers: [
        { reviewer: 'alice', state: 'running' },
        { reviewer: 'bob', state: 'queued' },
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
      reviewers: [{ reviewer: 'alice', state: 'running' }],
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

  test('returns done overallState when all reviewers are terminal', () => {
    const jobDir = path.join(tmpDir, 'job1');
    setupJob(jobDir, { id: 'test-1', specName: 'my-spec' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
    });
    const result = computeStatus(jobDir);
    expect(result.overallState).toBe('done');
    expect(result.counts.total).toBe(2);
    expect(result.counts.done).toBe(2);
    expect(result.counts.running).toBe(0);
  });

  test('returns running overallState when some reviewers are running', () => {
    const jobDir = path.join(tmpDir, 'job2');
    setupJob(jobDir, { id: 'test-2' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'running' },
    });
    const result = computeStatus(jobDir);
    expect(result.overallState).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('returns queued overallState when only queued (no running)', () => {
    const jobDir = path.join(tmpDir, 'job3');
    setupJob(jobDir, { id: 'test-3' }, {
      alice: { reviewer: 'alice', state: 'queued' },
    });
    const result = computeStatus(jobDir);
    expect(result.overallState).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('counts error states correctly', () => {
    const jobDir = path.join(tmpDir, 'job4');
    setupJob(jobDir, { id: 'test-4' }, {
      alice: { reviewer: 'alice', state: 'error', exitCode: 1 },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
      carol: { reviewer: 'carol', state: 'missing_cli' },
    });
    const result = computeStatus(jobDir);
    expect(result.overallState).toBe('done');
    expect(result.counts.error).toBe(1);
    expect(result.counts.missing_cli).toBe(1);
    expect(result.counts.done).toBe(1);
  });

  test('includes specName from job.json', () => {
    const jobDir = path.join(tmpDir, 'job5');
    setupJob(jobDir, { id: 'test-5', specName: 'auth-flow' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    expect(result.specName).toBe('auth-flow');
  });

  test('returns null specName when not in job.json', () => {
    const jobDir = path.join(tmpDir, 'job6');
    setupJob(jobDir, { id: 'test-6' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    expect(result.specName).toBe(null);
  });

  test('skips reviewer directories without status.json', () => {
    const jobDir = path.join(tmpDir, 'job7');
    setupJob(jobDir, { id: 'test-7' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    fs.mkdirSync(path.join(jobDir, 'reviewers', 'bob'));
    const result = computeStatus(jobDir);
    expect(result.counts.total).toBe(1);
    expect(result.reviewers.length).toBe(1);
  });

  test('sorts reviewers alphabetically by name', () => {
    const jobDir = path.join(tmpDir, 'job8');
    setupJob(jobDir, { id: 'test-8' }, {
      carol: { reviewer: 'carol', state: 'done' },
      alice: { reviewer: 'alice', state: 'done' },
      bob: { reviewer: 'bob', state: 'done' },
    });
    const result = computeStatus(jobDir);
    expect(result.reviewers[0].reviewer).toBe('alice');
    expect(result.reviewers[1].reviewer).toBe('bob');
    expect(result.reviewers[2].reviewer).toBe('carol');
  });

  test('includes reviewer metadata (startedAt, finishedAt, exitCode, message)', () => {
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
    expect(result.reviewers[0].startedAt).toBe('2026-01-01T00:00:00Z');
    expect(result.reviewers[0].finishedAt).toBe('2026-01-01T00:01:00Z');
    expect(result.reviewers[0].exitCode).toBe(0);
    expect(result.reviewers[0].message).toBe('success');
  });

  test('returns null for missing reviewer metadata fields', () => {
    const jobDir = path.join(tmpDir, 'job10');
    setupJob(jobDir, { id: 'test-10' }, {
      alice: { reviewer: 'alice', state: 'running' },
    });
    const result = computeStatus(jobDir);
    expect(result.reviewers[0].startedAt).toBe(null);
    expect(result.reviewers[0].finishedAt).toBe(null);
    expect(result.reviewers[0].exitCode).toBe(null);
    expect(result.reviewers[0].message).toBe(null);
  });

  test('includes jobDir and id in result', () => {
    const jobDir = path.join(tmpDir, 'job11');
    setupJob(jobDir, { id: 'test-11' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    expect(result.id).toBe('test-11');
    expect(result.jobDir.endsWith('job11')).toBeTruthy();
  });

  test('includes chairmanRole from job.json', () => {
    const jobDir = path.join(tmpDir, 'job12');
    setupJob(jobDir, { id: 'test-12', chairmanRole: 'claude' }, {
      alice: { reviewer: 'alice', state: 'done' },
    });
    const result = computeStatus(jobDir);
    expect(result.chairmanRole).toBe('claude');
  });

  test('treats retrying reviewer as non-terminal (running)', () => {
    const jobDir = path.join(tmpDir, 'job13');
    setupJob(jobDir, { id: 'test-13' }, {
      alice: { reviewer: 'alice', state: 'done', exitCode: 0 },
      bob: { reviewer: 'bob', state: 'retrying' },
    });
    const result = computeStatus(jobDir);
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

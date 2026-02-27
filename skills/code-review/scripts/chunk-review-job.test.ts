#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

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
  parseChunkReviewConfig,
  parseYamlSimple,
  computeStatus,
  detectCliType,
  buildAugmentedCommand,
  gcStaleJobs,
} from './chunk-review-job.ts';

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
  test('returns claude when path contains /.claude/skills/', () => {
    expect(detectHostRole('/home/user/.claude/skills/code-review')).toBe('claude');
  });

  test('returns codex when path contains /.codex/skills/', () => {
    expect(detectHostRole('/home/user/.codex/skills/code-review')).toBe('codex');
  });

  test('returns unknown for unrecognized paths', () => {
    expect(detectHostRole('/home/user/projects/code-review')).toBe('unknown');
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
    expect(elapsed < 1000).toBe(true);
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

  test('parses --blocking as boolean flag', () => {
    const result = parseArgs(['node', 'script', '--blocking']);
    expect(result.blocking).toBe(true);
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

  test('parses reviewers array with multiple entries', () => {
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
    expect(result['chunk-review'].reviewers.length).toBe(2);
    expect(result['chunk-review'].reviewers[0].name).toBe('alice');
    expect(result['chunk-review'].reviewers[0].command).toBe('alice-cli');
    expect(result['chunk-review'].reviewers[1].name).toBe('bob');
  });

  test('parses settings section with type coercion', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  settings:',
      '    timeout: 300',
      '    exclude_chairman_from_reviewers: false',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].settings.timeout).toBe(300);
    expect(result['chunk-review'].settings.exclude_chairman_from_reviewers).toBe(false);
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

  test('falls back to default reviewers when none defined', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  chairman:',
      '    role: auto',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].reviewers).toEqual(fallback['chunk-review'].reviewers);
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

  test('handles "members:" as alias for reviewers section', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  members:',
      '    - name: alice',
      '      command: alice-cli',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].reviewers.length).toBe(1);
    expect(result['chunk-review'].reviewers[0].name).toBe('alice');
  });

  test('strips quotes from reviewer name values', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: "quoted-name"',
      '      command: some-cmd',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].reviewers[0].name).toBe('quoted-name');
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

  test('parses hyphen keys in reviewer properties', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'chunk-review:',
      '  reviewers:',
      '    - name: alice',
      '      effort-level: high',
      '      output-format: json',
    ].join('\n'));
    const result = parseYamlSimple(configPath, fallback);
    expect(result['chunk-review'].reviewers[0]['effort-level']).toBe('high');
    expect(result['chunk-review'].reviewers[0]['output-format']).toBe('json');
  });

  test('parses values containing colons', () => {
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
    expect(result['chunk-review'].chairman.command).toBe('gemini --flag=value:123');
    expect(result['chunk-review'].reviewers[0].command).toBe('claude --endpoint=http://localhost:8080');
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
    expect(Array.isArray(result['chunk-review'].reviewers)).toBeTruthy();
    expect(result['chunk-review'].reviewers.length > 0).toBeTruthy();
    expect(result['chunk-review'].chairman.role).toBe('auto');
  });

  test('fallback contains default reviewers (claude, codex, gemini)', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    const names = result['chunk-review'].reviewers.map(r => r.name);
    expect(names.includes('claude')).toBeTruthy();
    expect(names.includes('codex')).toBeTruthy();
    expect(names.includes('gemini')).toBeTruthy();
  });

  test('fallback contains default settings', async () => {
    const result = await parseChunkReviewConfig(path.join(tmpDir, 'nope.yaml'));
    expect(result['chunk-review'].settings.exclude_chairman_from_reviewers).toBe(true);
    expect(result['chunk-review'].settings.timeout).toBe(300);
  });

  test('parses valid config via simple parser (yaml module unavailable)', async () => {
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
    const result = await parseChunkReviewConfig(configPath);
    expect(result['chunk-review'].chairman.role).toBe('gemini');
    expect(result['chunk-review'].reviewers.length).toBe(1);
    expect(result['chunk-review'].reviewers[0].name).toBe('alice');
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
    expect(result['chunk-review'].settings.exclude_chairman_from_reviewers).toBe(true);
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

  test('reviewer labels contain [Chunk Review] prefix', () => {
    const payload = {
      overallState: 'running',
      counts: { total: 1, done: 0, queued: 0, running: 1 },
      reviewers: [{ reviewer: 'alice', state: 'running' }],
    };
    const result = buildUiPayload(payload);
    const reviewerStep = result.codex.update_plan.plan[1];
    expect(reviewerStep.step.startsWith('[Chunk Review]')).toBeTruthy();
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
    setupJob(jobDir, { id: 'test-1' }, {
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

  test('transitions stale queued reviewer to error when queuedAt exceeds threshold', () => {
    const jobDir = path.join(tmpDir, 'job-stale');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-stale', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.queued).toBe(0);
  });

  test('does not transition queued reviewer that is within staleness threshold', () => {
    const jobDir = path.join(tmpDir, 'job-fresh');
    const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-fresh', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: freshTime },
    });
    // threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    expect(alice.state).toBe('queued');
    expect(result.counts.queued).toBe(1);
  });

  test('uses 120s minimum threshold when timeoutSec is 0', () => {
    const jobDir = path.join(tmpDir, 'job-zero-timeout');
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-zero', settings: { timeoutSec: 0 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
    });
    // threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    expect(alice.state).toBe('error');
  });

  test('uses file mtime as fallback when queuedAt is missing', () => {
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
    expect(alice.state).toBe('error');
  });

  test('writes error details to status.json on staleness transition', () => {
    const jobDir = path.join(tmpDir, 'job-stale-write');
    const staleTime = new Date(Date.now() - 200_000).toISOString();
    setupJob(jobDir, { id: 'test-write', settings: { timeoutSec: 30 } }, {
      alice: { reviewer: 'alice', state: 'queued', queuedAt: staleTime },
    });
    computeStatus(jobDir);
    const statusPath = path.join(jobDir, 'reviewers', 'alice', 'status.json');
    const written = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(written.state).toBe('error');
    expect(written.error.includes('stale')).toBe(true);
  });

  // ---- Running worker staleness ----

  test('preserves normal running worker within threshold', () => {
    const jobDir = path.join(tmpDir, 'job-run-fresh');
    const recentStart = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    setupJob(jobDir, { id: 'test-run-fresh', settings: { timeoutSec: 60 } }, {
      alice: { reviewer: 'alice', state: 'running', startedAt: recentStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 10s < 120s → not stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    expect(alice.state).toBe('running');
    expect(result.counts.running).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  test('transitions stale running worker to error when startedAt exceeds threshold', () => {
    const jobDir = path.join(tmpDir, 'job-run-stale');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale', settings: { timeoutSec: 60 } }, {
      alice: { reviewer: 'alice', state: 'running', startedAt: staleStart },
      bob: { reviewer: 'bob', state: 'done', exitCode: 0 },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    expect(alice.state).toBe('error');
    expect(result.counts.error).toBe(1);
    expect(result.counts.running).toBe(0);
  });

  test('CAS guard: does not transition if running worker changed state during re-read', () => {
    const jobDir = path.join(tmpDir, 'job-run-cas');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-cas', settings: { timeoutSec: 60 } }, {
      alice: { reviewer: 'alice', state: 'running', startedAt: staleStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    // Simulate race: spawn a background process that overwrites the file to 'done'
    // during the 250ms CAS sleep window (Atomics.wait blocks the event loop,
    // so setTimeout won't fire — only an external process can write the file).
    const statusPath = path.join(jobDir, 'reviewers', 'alice', 'status.json');
    const donePayload = JSON.stringify({ reviewer: 'alice', state: 'done', startedAt: staleStart, exitCode: 0 });
    Bun.spawn(['bash', '-c', `sleep 0.1 && printf '%s' '${donePayload}' > "${statusPath}"`]);
    const result = computeStatus(jobDir);
    const alice = result.reviewers.find(r => r.reviewer === 'alice');
    // CAS re-read sees 'done' → preserves 'done', does NOT overwrite with error
    expect(alice.state).toBe('done');
    expect(result.counts.error).toBe(0);
  });

  test('writes error details to status.json on running staleness transition', () => {
    const jobDir = path.join(tmpDir, 'job-run-stale-write');
    const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    setupJob(jobDir, { id: 'test-run-stale-write', settings: { timeoutSec: 60 } }, {
      alice: { reviewer: 'alice', state: 'running', startedAt: staleStart },
    });
    // running threshold = (60 + 60) * 1000 = 120_000ms; 200s > 120s → stale
    computeStatus(jobDir);
    const statusPath = path.join(jobDir, 'reviewers', 'alice', 'status.json');
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
  const SCRIPT = path.join(import.meta.dirname, 'chunk-review-job.ts');
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

    // Clean WITHOUT --jobs-dir (simulates chunk-review.sh cleanup behavior)
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
  const SCRIPT = path.join(import.meta.dirname, 'chunk-review-job.ts');
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('exits with error when two reviewers produce the same safe name', () => {
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
      expect(err.stderr.toString().includes('reviewer name collision')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// --exclude-chairman=false boolean parsing (Bug fix)
// ---------------------------------------------------------------------------

describe('--exclude-chairman=false keeps chairman in reviewers', () => {
  const SCRIPT = path.join(import.meta.dirname, 'chunk-review-job.ts');
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
    expect(reviewerNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromReviewers).toBe(false);

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
    expect(!reviewerNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromReviewers).toBe(true);

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
      '--include-chairman=false',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const reviewerNames = output.reviewers.map(r => r.name);
    // --exclude-chairman=false overrides config to false (don't exclude)
    // --include-chairman=false means no force-include
    // So excludeChairmanFromReviewers=false, includeChairman=false → chairman included
    expect(reviewerNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromReviewers).toBe(false);

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
    expect(!reviewerNames.includes('claude')).toBe(true);
    expect(output.settings.excludeChairmanFromReviewers).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });
});

// ---------------------------------------------------------------------------
// --include-chairman=false boolean parsing (Bug fix: Boolean("false")===true)
// ---------------------------------------------------------------------------

describe('--include-chairman=false normalizeBool parsing', () => {
  const SCRIPT = path.join(import.meta.dirname, 'chunk-review-job.ts');
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
      '--include-chairman=false',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const reviewerNames = output.reviewers.map(r => r.name);
    // --include-chairman=false → includeChairman should be false
    // excludeChairmanOverride should be null (fallback to config default: true)
    // So chairman should be excluded
    expect(!reviewerNames.includes('claude')).toBe(true);

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
      '--include-chairman=true',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const reviewerNames = output.reviewers.map(r => r.name);
    // --include-chairman=true → includeChairman=true, force-include chairman
    expect(reviewerNames.includes('claude')).toBe(true);

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
      '--include-chairman',
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const reviewerNames = output.reviewers.map(r => r.name);
    // --include-chairman (boolean flag) → true → force-include
    expect(reviewerNames.includes('claude')).toBe(true);

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
      '--json',
      'test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const reviewerNames = output.reviewers.map(r => r.name);
    // No flag → config default (exclude=true), no force-include → chairman excluded
    expect(!reviewerNames.includes('claude')).toBe(true);

    // cleanup spawned workers
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir], { stdio: 'pipe' }); } catch {}
  });
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe('cmdResults', () => {
  const SCRIPT = path.join(import.meta.dirname, 'chunk-review-job.ts');
  let tmpDir: string;

  function setupJobFixture(
    jobDir: string,
    reviewers: Record<string, { reviewer: string; state: string; exitCode: number; output: string; stderr: string }>,
    opts?: { prompt?: string },
  ) {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ id: 'test-results' }));
    if (opts?.prompt) {
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), opts.prompt);
    }
    const reviewersDir = path.join(jobDir, 'reviewers');
    fs.mkdirSync(reviewersDir, { recursive: true });
    for (const [name, data] of Object.entries(reviewers)) {
      const dir = path.join(reviewersDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'status.json'),
        JSON.stringify({ reviewer: data.reviewer, state: data.state, exitCode: data.exitCode }),
      );
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

  test('--json 출력에서 prompt, stderr 필드가 제거됨', () => {
    const jobDir = path.join(tmpDir, 'job-qa1');
    const largeStderr = 'x'.repeat(33000);
    const largePrompt = 'p'.repeat(30000);
    setupJobFixture(
      jobDir,
      { 'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'review output', stderr: largeStderr } },
      { prompt: largePrompt },
    );

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed).not.toHaveProperty('prompt');
    expect(parsed.reviewers[0]).not.toHaveProperty('stderr');
    expect(parsed.reviewers[0].output).toBe('review output');
    expect(parsed.reviewers[0].reviewer).toBe('claude');
    expect(parsed.reviewers[0].state).toBe('done');
    expect(parsed.reviewers[0].exitCode).toBe(0);
    expect(parsed.id).toBe('test-results');
    expect(parsed.jobDir).toBe(path.resolve(jobDir));
  });

  test('3 reviewers --json 출력이 30000자 미만', () => {
    const jobDir = path.join(tmpDir, 'job-qa2');
    setupJobFixture(
      jobDir,
      {
        'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'claude review', stderr: 'x'.repeat(33000) },
        'codex-0': { reviewer: 'codex', state: 'done', exitCode: 0, output: 'codex review', stderr: 'x'.repeat(33000) },
        'gemini-0': { reviewer: 'gemini', state: 'error', exitCode: 1, output: 'gemini review', stderr: 'x'.repeat(33000) },
      },
      { prompt: 'p'.repeat(30000) },
    );

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--json', jobDir], { stdio: 'pipe' });
    const output = result.toString();

    expect(output.length).toBeLessThan(30000);
    const parsed = JSON.parse(output);
    expect(parsed.reviewers).toHaveLength(3);
  });

  test('non-JSON: output 비어있으면 stderr fallback 출력', () => {
    const jobDir = path.join(tmpDir, 'job-qa3');
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'error', exitCode: 1, output: '', stderr: 'stderr-fallback-content' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    const stdout = result.toString();

    expect(stdout).toContain('stderr-fallback-content');
  });

  test('non-JSON: output 있으면 output 출력, stderr 미포함', () => {
    const jobDir = path.join(tmpDir, 'job-qa4');
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'primary-output-content', stderr: 'hidden-stderr-content' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', jobDir], { stdio: 'pipe' });
    const stdout = result.toString();

    expect(stdout).toContain('primary-output-content');
    expect(stdout).not.toContain('hidden-stderr-content');
  });

  test('--manifest: done reviewer의 outputFile이 /tmp에 존재하고 내용 일치', () => {
    const jobDir = path.join(tmpDir, 'job-manifest1');
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'claude review output here', stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed.id).toBe('test-results');
    expect(parsed.reviewers).toHaveLength(1);
    expect(parsed.reviewers[0].reviewer).toBe('claude');
    expect(parsed.reviewers[0].state).toBe('done');
    expect(parsed.reviewers[0].exitCode).toBe(0);
    expect(parsed.reviewers[0].outputFile).toBeTruthy();
    expect(parsed.reviewers[0].outputFile).toMatch(/^\/.*chunk-review-.*\.txt$/);

    const fileContent = fs.readFileSync(parsed.reviewers[0].outputFile, 'utf8');
    expect(fileContent).toBe('claude review output here');

    // Cleanup tmp file
    fs.unlinkSync(parsed.reviewers[0].outputFile);
  });

  test('--manifest: failed/non_retryable reviewer의 outputFile이 null', () => {
    const jobDir = path.join(tmpDir, 'job-manifest2');
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'valid output', stderr: '' },
      'codex-0': { reviewer: 'codex', state: 'error', exitCode: 1, output: '', stderr: 'some error' },
      'gemini-0': { reviewer: 'gemini', state: 'non_retryable', exitCode: 42, output: '', stderr: 'quota exceeded' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    expect(parsed.reviewers).toHaveLength(3);

    const claude = parsed.reviewers.find((r: any) => r.reviewer === 'claude');
    const codex = parsed.reviewers.find((r: any) => r.reviewer === 'codex');
    const gemini = parsed.reviewers.find((r: any) => r.reviewer === 'gemini');

    expect(claude.outputFile).toBeTruthy();
    expect(codex.outputFile).toBeNull();
    expect(gemini.outputFile).toBeNull();

    // Cleanup tmp file
    fs.unlinkSync(claude.outputFile);
  });

  test('--manifest: JSON schema 검증 (id, reviewers 필드 구조)', () => {
    const jobDir = path.join(tmpDir, 'job-manifest3');
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: 'output A', stderr: '' },
      'codex-0': { reviewer: 'codex', state: 'done', exitCode: 0, output: 'output B', stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const parsed = JSON.parse(result.toString());

    // Top-level schema
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('reviewers');
    expect(Array.isArray(parsed.reviewers)).toBe(true);

    // Must NOT have jobDir (unlike --json mode)
    expect(parsed).not.toHaveProperty('jobDir');

    // Each reviewer must have exactly the expected fields
    for (const r of parsed.reviewers) {
      expect(r).toHaveProperty('reviewer');
      expect(r).toHaveProperty('state');
      expect(r).toHaveProperty('exitCode');
      expect(r).toHaveProperty('message');
      expect(r).toHaveProperty('outputFile');
      // Must NOT have output inline (unlike --json mode)
      expect(r).not.toHaveProperty('output');
    }

    // Cleanup tmp files
    for (const r of parsed.reviewers) {
      if (r.outputFile) fs.unlinkSync(r.outputFile);
    }
  });

  test('--manifest: stdout가 경량 (30KB 미만, output 인라인 없음)', () => {
    const jobDir = path.join(tmpDir, 'job-manifest4');
    const largeOutput = 'x'.repeat(50000);
    setupJobFixture(jobDir, {
      'claude-0': { reviewer: 'claude', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
      'codex-0': { reviewer: 'codex', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
      'gemini-0': { reviewer: 'gemini', state: 'done', exitCode: 0, output: largeOutput, stderr: '' },
    });

    const result = execFileSync(process.execPath, [SCRIPT, 'results', '--manifest', jobDir], { stdio: 'pipe' });
    const output = result.toString();

    // Manifest stdout must be tiny regardless of output size
    expect(output.length).toBeLessThan(2000);

    const parsed = JSON.parse(output);
    expect(parsed.reviewers).toHaveLength(3);

    // Each outputFile must contain the large output
    for (const r of parsed.reviewers) {
      expect(r.outputFile).toBeTruthy();
      const content = fs.readFileSync(r.outputFile, 'utf8');
      expect(content.length).toBe(50000);
      fs.unlinkSync(r.outputFile);
    }
  });
});

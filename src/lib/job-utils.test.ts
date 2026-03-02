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
} from './job-utils.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'job-utils-test-'));
}

// ---------------------------------------------------------------------------
// detectHostRole
// ---------------------------------------------------------------------------

describe('detectHostRole', () => {
  test('returns claude for paths containing /.claude/skills/', () => {
    expect(detectHostRole('/home/user/.claude/skills/agent-council')).toBe('claude');
  });

  test('returns codex for paths containing /.codex/skills/', () => {
    expect(detectHostRole('/home/user/.codex/skills/agent-council')).toBe('codex');
  });

  test('returns unknown for unrecognized paths', () => {
    expect(detectHostRole('/home/user/projects/my-skill')).toBe('unknown');
  });

  test('normalizes backslashes on Windows-style paths', () => {
    expect(detectHostRole('C:\\Users\\user\\.claude\\skills\\foo')).toBe('claude');
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

  test('returns true for truthy string values', () => {
    for (const v of ['1', 'true', 'yes', 'y', 'on', 'TRUE', 'Yes', 'ON']) {
      expect(normalizeBool(v)).toBe(true);
    }
  });

  test('returns false for falsy string values', () => {
    for (const v of ['0', 'false', 'no', 'n', 'off', 'FALSE', 'No', 'OFF']) {
      expect(normalizeBool(v)).toBe(false);
    }
  });

  test('returns null for unrecognized values', () => {
    expect(normalizeBool('maybe')).toBe(null);
    expect(normalizeBool('2')).toBe(null);
    expect(normalizeBool('')).toBe(null);
  });

  test('trims whitespace before matching', () => {
    expect(normalizeBool('  true  ')).toBe(true);
    expect(normalizeBool('  false  ')).toBe(false);
  });

  test('converts non-string values via String()', () => {
    expect(normalizeBool(1)).toBe(true);
    expect(normalizeBool(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoRole
// ---------------------------------------------------------------------------

describe('resolveAutoRole', () => {
  test('returns explicit role when given a non-auto value', () => {
    expect(resolveAutoRole('gemini', 'claude')).toBe('gemini');
  });

  test('returns hostRole when role is auto and hostRole is codex', () => {
    expect(resolveAutoRole('auto', 'codex')).toBe('codex');
  });

  test('returns hostRole when role is auto and hostRole is claude', () => {
    expect(resolveAutoRole('auto', 'claude')).toBe('claude');
  });

  test('defaults to claude when role is auto and hostRole is unknown', () => {
    expect(resolveAutoRole('auto', 'unknown')).toBe('claude');
  });

  test('treats null/undefined role as auto', () => {
    expect(resolveAutoRole(null, 'codex')).toBe('codex');
    expect(resolveAutoRole(undefined, 'claude')).toBe('claude');
  });

  test('treats empty string as auto', () => {
    expect(resolveAutoRole('', 'codex')).toBe('codex');
  });

  test('lowercases the explicit role', () => {
    expect(resolveAutoRole('GEMINI', 'claude')).toBe('gemini');
  });

  test('trims whitespace from role', () => {
    expect(resolveAutoRole('  codex  ', 'claude')).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// safeFileName
// ---------------------------------------------------------------------------

describe('safeFileName', () => {
  test('lowercases and replaces unsafe characters', () => {
    expect(safeFileName('My Model!')).toBe('my-model-');
  });

  test('preserves allowed characters (a-z, 0-9, _, -)', () => {
    expect(safeFileName('valid-name_01')).toBe('valid-name_01');
  });

  test('returns fallback for empty/null input', () => {
    expect(safeFileName('', 'default')).toBe('default');
    expect(safeFileName(null, 'default')).toBe('default');
    expect(safeFileName(undefined, 'default')).toBe('default');
  });

  test('returns member when no fallback given and input is empty', () => {
    expect(safeFileName('')).toBe('member');
    expect(safeFileName(null)).toBe('member');
  });

  test('collapses consecutive unsafe characters into single dash', () => {
    expect(safeFileName('a!!b')).toBe('a-b');
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

  test('handles null/undefined input', () => {
    expect(computeTerminalDoneCount(null)).toBe(0);
    expect(computeTerminalDoneCount(undefined)).toBe(0);
  });

  test('treats missing fields as 0', () => {
    expect(computeTerminalDoneCount({ done: 5 })).toBe(5);
  });

  test('handles string number values via Number()', () => {
    expect(computeTerminalDoneCount({ done: '3', error: '2' })).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// asCodexStepStatus
// ---------------------------------------------------------------------------

describe('asCodexStepStatus', () => {
  test('returns pending for valid pending input', () => {
    expect(asCodexStepStatus('pending')).toBe('pending');
  });

  test('returns in_progress for valid in_progress input', () => {
    expect(asCodexStepStatus('in_progress')).toBe('in_progress');
  });

  test('returns completed for valid completed input', () => {
    expect(asCodexStepStatus('completed')).toBe('completed');
  });

  test('returns pending for unrecognized values', () => {
    expect(asCodexStepStatus('done')).toBe('pending');
    expect(asCodexStepStatus('error')).toBe('pending');
    expect(asCodexStepStatus('unknown')).toBe('pending');
  });

  test('returns pending for null/undefined', () => {
    expect(asCodexStepStatus(null)).toBe('pending');
    expect(asCodexStepStatus(undefined)).toBe('pending');
  });

  test('returns pending for empty string', () => {
    expect(asCodexStepStatus('')).toBe('pending');
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

  test('creates a directory that does not exist', () => {
    const dirPath = path.join(tmpDir, 'new-dir');
    ensureDir(dirPath);
    expect(fs.existsSync(dirPath)).toBeTruthy();
    expect(fs.statSync(dirPath).isDirectory()).toBeTruthy();
  });

  test('creates nested directories recursively', () => {
    const dirPath = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dirPath);
    expect(fs.existsSync(dirPath)).toBeTruthy();
  });

  test('does not throw if directory already exists', () => {
    const dirPath = path.join(tmpDir, 'existing');
    fs.mkdirSync(dirPath);
    expect(() => ensureDir(dirPath)).not.toThrow();
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

  test('returns parsed JSON for existing valid file', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');
    expect(readJsonIfExists(filePath)).toEqual({ key: 'value' });
  });

  test('returns null for non-existent file', () => {
    expect(readJsonIfExists(path.join(tmpDir, 'missing.json'))).toBe(null);
  });

  test('returns null for invalid JSON content', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json', 'utf8');
    expect(readJsonIfExists(filePath)).toBe(null);
  });

  test('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '', 'utf8');
    expect(readJsonIfExists(filePath)).toBe(null);
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

  test('returns immediately for 0', () => {
    const start = Date.now();
    sleepMs(0);
    const elapsed = Date.now() - start;
    expect(elapsed < 50).toBe(true);
  });

  test('returns immediately for negative values', () => {
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

  test('returns undefined (synchronous, not a promise)', () => {
    const result = sleepMs(1);
    expect(result).toBe(undefined);
  });

  test('returns immediately for Infinity', () => {
    sleepMs(Infinity); // should not hang
  });
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------

describe('generateJobId', () => {
  test('matches expected format: YYYY-MM-DD-HHMM-hex6', () => {
    const id = generateJobId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{6}$/);
  });

  test('generates unique IDs on successive calls', () => {
    const id1 = generateJobId();
    const id2 = generateJobId();
    expect(id1).not.toBe(id2);
  });

  test('starts with a valid date prefix', () => {
    const id = generateJobId();
    const parts = id.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    expect(year >= 2020 && year <= 2100).toBe(true);
    expect(month >= 1 && month <= 12).toBe(true);
    expect(day >= 1 && day <= 31).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  function parse(...args) {
    return parseArgs(['node', 'script.js', ...args]);
  }

  test('returns empty positional array for no args', () => {
    const result = parse();
    expect(result._).toEqual([]);
  });

  test('collects positional arguments in _', () => {
    const result = parse('start', '/some/path');
    expect(result._).toEqual(['start', '/some/path']);
  });

  test('parses --key=value format', () => {
    const result = parse('--config=/path/to/file');
    expect(result.config).toBe('/path/to/file');
  });

  test('parses --key value format for non-boolean flags', () => {
    const result = parse('--config', '/path/to/file');
    expect(result.config).toBe('/path/to/file');
  });

  test('treats known boolean flags as true without value', () => {
    const result = parse('--json', '--verbose');
    expect(result.json).toBe(true);
    expect(result.verbose).toBe(true);
  });

  test('treats all known boolean flags correctly', () => {
    const boolFlags = ['json', 'text', 'checklist', 'help', 'h', 'verbose', 'include-chairman', 'exclude-chairman', 'stdin'];
    for (const flag of boolFlags) {
      const result = parse(`--${flag}`);
      expect(result[flag]).toBe(true);
    }
  });

  test('stops processing at -- separator and puts rest in _', () => {
    const result = parse('start', '--', '--not-a-flag', 'extra');
    expect(result._).toEqual(['start', '--not-a-flag', 'extra']);
  });

  test('treats unknown flag without next value as boolean true', () => {
    const result = parse('--unknown');
    expect(result.unknown).toBe(true);
  });

  test('treats unknown flag followed by another flag as boolean true', () => {
    const result = parse('--unknown', '--json');
    expect(result.unknown).toBe(true);
    expect(result.json).toBe(true);
  });

  test('handles mixed positional and flag arguments', () => {
    const result = parse('start', '--json', '--config', '/path', 'extra');
    expect(result._).toEqual(['start', 'extra']);
    expect(result.json).toBe(true);
    expect(result.config).toBe('/path');
  });

  test('handles --key=value with empty value', () => {
    const result = parse('--config=');
    expect(result.config).toBe('');
  });

  test('handles --key=value where value contains = (preserves full value)', () => {
    const result = parse('--config=a=b');
    // indexOf('=') + slice() preserves everything after the first =
    expect(result.config).toBe('a=b');
  });
});

// ---------------------------------------------------------------------------
// parseWaitCursor
// ---------------------------------------------------------------------------

describe('parseWaitCursor', () => {
  test('parses v1 format correctly', () => {
    const result = parseWaitCursor('v1:3:2:1');
    expect(result).toEqual({
      version: 'v1',
      bucketSize: 3,
      dispatchBucket: 0,
      doneBucket: 2,
      isDone: true,
    });
  });

  test('parses v1 format with isDone=0', () => {
    const result = parseWaitCursor('v1:5:1:0');
    expect(result.isDone).toBe(false);
    expect(result.bucketSize).toBe(5);
    expect(result.doneBucket).toBe(1);
  });

  test('parses v2 format correctly', () => {
    const result = parseWaitCursor('v2:3:1:2:1');
    expect(result).toEqual({
      version: 'v2',
      bucketSize: 3,
      dispatchBucket: 1,
      doneBucket: 2,
      isDone: true,
    });
  });

  test('parses v2 format with isDone=0', () => {
    const result = parseWaitCursor('v2:4:0:1:0');
    expect(result.isDone).toBe(false);
    expect(result.dispatchBucket).toBe(0);
  });

  test('returns null for empty string', () => {
    expect(parseWaitCursor('')).toBe(null);
  });

  test('returns null for null/undefined', () => {
    expect(parseWaitCursor(null)).toBe(null);
    expect(parseWaitCursor(undefined)).toBe(null);
  });

  test('returns null for unknown version', () => {
    expect(parseWaitCursor('v3:1:2:3')).toBe(null);
  });

  test('returns null for v1 with wrong part count', () => {
    expect(parseWaitCursor('v1:3:2')).toBe(null);
    expect(parseWaitCursor('v1:3:2:1:extra')).toBe(null);
  });

  test('returns null for v2 with wrong part count', () => {
    expect(parseWaitCursor('v2:3:1:2')).toBe(null);
    expect(parseWaitCursor('v2:3:1:2:1:extra')).toBe(null);
  });

  test('returns null for invalid bucketSize (0 or negative)', () => {
    expect(parseWaitCursor('v1:0:2:1')).toBe(null);
    expect(parseWaitCursor('v1:-1:2:1')).toBe(null);
    expect(parseWaitCursor('v2:0:1:2:1')).toBe(null);
  });

  test('returns null for non-numeric bucketSize', () => {
    expect(parseWaitCursor('v1:abc:2:1')).toBe(null);
  });

  test('returns null for negative doneBucket', () => {
    expect(parseWaitCursor('v1:3:-1:1')).toBe(null);
    expect(parseWaitCursor('v2:3:0:-1:1')).toBe(null);
  });

  test('returns null for negative dispatchBucket in v2', () => {
    expect(parseWaitCursor('v2:3:-1:2:1')).toBe(null);
  });

  test('trims whitespace', () => {
    const result = parseWaitCursor('  v2:3:1:2:0  ');
    expect(result).not.toBe(null);
    expect(result.version).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// formatWaitCursor
// ---------------------------------------------------------------------------

describe('formatWaitCursor', () => {
  test('formats v2 cursor string with isDone=true', () => {
    expect(formatWaitCursor(3, 1, 2, true)).toBe('v2:3:1:2:1');
  });

  test('formats v2 cursor string with isDone=false', () => {
    expect(formatWaitCursor(5, 0, 0, false)).toBe('v2:5:0:0:0');
  });

  test('roundtrips with parseWaitCursor', () => {
    const cursor = formatWaitCursor(4, 1, 3, true);
    const parsed = parseWaitCursor(cursor);
    expect(parsed).toEqual({
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
  test('uses explicit numeric bucket option', () => {
    expect(resolveBucketSize({ bucket: '3' }, 10, null)).toBe(3);
  });

  test('uses bucket-size alias', () => {
    expect(resolveBucketSize({ 'bucket-size': '4' }, 10, null)).toBe(4);
  });

  test('prefers bucket over bucket-size', () => {
    expect(resolveBucketSize({ bucket: '2', 'bucket-size': '5' }, 10, null)).toBe(2);
  });

  test('truncates decimal bucket values', () => {
    expect(resolveBucketSize({ bucket: '3.7' }, 10, null)).toBe(3);
  });

  test('falls back to prevCursor.bucketSize when option is null', () => {
    expect(resolveBucketSize({}, 10, { bucketSize: 5 })).toBe(5);
  });

  test('falls back to prevCursor.bucketSize when option is true (bare flag)', () => {
    expect(resolveBucketSize({ bucket: true }, 10, { bucketSize: 7 })).toBe(7);
  });

  test('computes auto bucket size as ceil(total/5)', () => {
    expect(resolveBucketSize({}, 10, null)).toBe(2);
    expect(resolveBucketSize({}, 13, null)).toBe(3);
    expect(resolveBucketSize({}, 5, null)).toBe(1);
  });

  test('computes auto bucket size with explicit auto string', () => {
    expect(resolveBucketSize({ bucket: 'auto' }, 10, null)).toBe(2);
  });

  test('returns 1 for total <= 0 in auto mode', () => {
    expect(resolveBucketSize({}, 0, null)).toBe(1);
    expect(resolveBucketSize({}, -5, null)).toBe(1);
  });

  test('returns 1 for null/undefined total in auto mode', () => {
    expect(resolveBucketSize({}, null, null)).toBe(1);
    expect(resolveBucketSize({}, undefined, null)).toBe(1);
  });

  test('returns at least 1 for very small totals', () => {
    expect(resolveBucketSize({}, 1, null)).toBe(1);
    expect(resolveBucketSize({}, 2, null)).toBe(1);
  });
});

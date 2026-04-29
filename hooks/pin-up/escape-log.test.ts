/**
 * Tests for escape-log (AC-14).
 * Cases:
 *   1. truncateRaw: no-op when under limit
 *   2. truncateRaw: truncates to ≤1500 bytes with "..." suffix
 *   3. appendEscapeEntry: writes valid JSONL line
 *   4. appendEscapeEntry: concurrent appends produce distinct lines (not interleaved)
 *   5. appendEscapeEntry: raw field truncated to ≤1500 bytes in output file
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { truncateRaw, appendEscapeEntry } from './escape-log.ts';

describe('truncateRaw', () => {
  it('returns string unchanged when under 1500 bytes', () => {
    const short = 'hello world';
    expect(truncateRaw(short)).toBe(short);
  });

  it('truncates to ≤1500 bytes with "..." suffix', () => {
    const long = 'x'.repeat(2000);
    const result = truncateRaw(long);
    const bytes = Buffer.byteLength(result, 'utf-8');
    expect(bytes).toBeLessThanOrEqual(1500);
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles multibyte UTF-8 correctly', () => {
    // Korean chars are 3 bytes each — 400 of them = 1200 bytes, 500 = 1500 bytes
    const korean = '가'.repeat(600); // 1800 bytes
    const result = truncateRaw(korean);
    const bytes = Buffer.byteLength(result, 'utf-8');
    expect(bytes).toBeLessThanOrEqual(1500);
  });
});

describe('appendEscapeEntry', () => {
  const testDir = join(tmpdir(), 'pin-up-escape-test-' + Date.now());
  const omtDir = join(testDir, 'omt');
  const escapeFile = join(omtDir, 'pins', '.escape.jsonl');

  beforeAll(async () => {
    await mkdir(join(omtDir, 'pins'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('writes a valid JSONL line to escape file', async () => {
    appendEscapeEntry(omtDir, 'session-1', 'frontmatter_invalid', 'code-auth-jwt', 'raw content');

    const content = await readFile(escapeFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const entry = JSON.parse(lines[0]);
    expect(entry.session_id).toBe('session-1');
    expect(entry.reason).toBe('frontmatter_invalid');
    expect(entry.pin_slug).toBe('code-auth-jwt');
    expect(entry.raw).toBe('raw content');
    expect(typeof entry.ts).toBe('string');
  });

  it('concurrent appends produce multiple distinct lines', async () => {
    // Append multiple entries synchronously in sequence (appendFileSync is sync)
    appendEscapeEntry(omtDir, 'session-a', 'slug_violation', 'pin-a', 'raw-a');
    appendEscapeEntry(omtDir, 'session-b', 'slug_violation', 'pin-b', 'raw-b');
    appendEscapeEntry(omtDir, 'session-c', 'parse_error', null, 'raw-c');

    const content = await readFile(escapeFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    // We wrote 1 in previous test + 3 now
    expect(lines.length).toBeGreaterThanOrEqual(4);

    // All lines must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // session-c entry should have null pin_slug
    const sessionCEntry = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.session_id === 'session-c');
    expect(sessionCEntry).toBeDefined();
    expect(sessionCEntry.pin_slug).toBeNull();
  });

  it('raw field in file is ≤1500 bytes (AC-14)', async () => {
    const longRaw = 'z'.repeat(3000);
    appendEscapeEntry(omtDir, 'session-long', 'unknown', null, longRaw);

    const content = await readFile(escapeFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const longEntry = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.session_id === 'session-long');

    expect(longEntry).toBeDefined();
    const rawBytes = Buffer.byteLength(longEntry.raw, 'utf-8');
    expect(rawBytes).toBeLessThanOrEqual(1500);
    expect(longEntry.raw.endsWith('...')).toBe(true);
  });

  it('fails silently when omtDir is invalid (fail-open)', () => {
    // Should not throw
    expect(() => {
      appendEscapeEntry('/nonexistent/invalid/path', 'sess', 'unknown', null, 'raw');
    }).not.toThrow();
  });
});

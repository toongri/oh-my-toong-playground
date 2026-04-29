/**
 * Tests for pin-session-start scanner (AC-1.6, AC-2).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanPins } from './scanner.ts';

describe('scanPins', () => {
  const testDir = join(tmpdir(), 'pin-session-start-scanner-' + Date.now());
  const omtDir = join(testDir, 'omt');
  const pinsDir = join(omtDir, 'pins');

  beforeAll(async () => {
    await mkdir(pinsDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty result when pins/ is empty', () => {
    const result = scanPins(omtDir);
    expect(result.count).toBe(0);
    expect(result.recentSlugs).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('returns fail-open empty result for nonexistent omtDir', () => {
    const result = scanPins('/nonexistent/omt/path');
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('counts .md files and returns up to 3 recent slugs', async () => {
    await writeFile(join(pinsDir, 'code-auth-jwt.md'), 'body', 'utf-8');
    await writeFile(join(pinsDir, 'slack-deploy-ratelimit.md'), 'body', 'utf-8');
    await writeFile(join(pinsDir, 'notion-onboarding-guide.md'), 'body', 'utf-8');

    const result = scanPins(omtDir);
    expect(result.count).toBe(3);
    expect(result.recentSlugs).toHaveLength(3);
    expect(result.truncated).toBe(false);

    // slugs should not have .md extension
    for (const slug of result.recentSlugs) {
      expect(slug.endsWith('.md')).toBe(false);
    }
  });

  it('ignores hidden files (starting with .)', async () => {
    await writeFile(join(pinsDir, '.cursor.json'), '{}', 'utf-8');
    await writeFile(join(pinsDir, '.escape.jsonl'), '', 'utf-8');

    const result = scanPins(omtDir);
    // Should still be 3 (the 3 .md files from previous test, not hidden files)
    expect(result.count).toBe(3);
  });

  it('returns truncated=true and count only when >30 pins', async () => {
    // Create 28 more pins to exceed 30 threshold (already have 3)
    for (let i = 0; i < 28; i++) {
      await writeFile(join(pinsDir, `code-extra-pin${i.toString().padStart(3, '0')}.md`), 'body', 'utf-8');
    }

    const result = scanPins(omtDir);
    expect(result.count).toBeGreaterThan(30);
    expect(result.truncated).toBe(true);
    expect(result.recentSlugs).toHaveLength(0);
  });
});

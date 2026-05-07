/**
 * Tests for pin-session-start scanner (AC-1.6, AC-2).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
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
  });

  it('returns fail-open empty result for nonexistent omtDir', () => {
    const result = scanPins('/nonexistent/omt/path');
    expect(result.count).toBe(0);
  });

  it('counts .md files only', async () => {
    await writeFile(join(pinsDir, 'code-auth-jwt.md'), 'body', 'utf-8');
    await writeFile(join(pinsDir, 'slack-deploy-ratelimit.md'), 'body', 'utf-8');
    await writeFile(join(pinsDir, 'notion-onboarding-guide.md'), 'body', 'utf-8');

    const result = scanPins(omtDir);
    expect(result.count).toBe(3);
  });

  it('ignores hidden files (starting with .)', async () => {
    await writeFile(join(pinsDir, '.cursor.json'), '{}', 'utf-8');
    await writeFile(join(pinsDir, '.escape.jsonl'), '', 'utf-8');

    const result = scanPins(omtDir);
    // Should still be 3 (the 3 .md files from previous test, not hidden files)
    expect(result.count).toBe(3);
  });

  // --- Typo guard: nonexistent omtDir must not be created on disk ---

  describe('typo guard: nonexistent omtDir is not created', () => {
    let tempBase: string;
    let bogusOmtDir: string;

    beforeEach(() => {
      tempBase = mkdtempSync(join(tmpdir(), 'scanner-typo-'));
      // Derive a child path that does NOT exist
      bogusOmtDir = join(tempBase, 'nonexistent-omt');
    });

    afterEach(() => {
      rmSync(tempBase, { recursive: true, force: true });
    });

    it('does not create bogusOmtDir when omtDir does not exist', () => {
      const result = scanPins(bogusOmtDir);

      expect(result.count).toBe(0);
      expect(existsSync(bogusOmtDir)).toBe(false);
    });
  });

  // --- Self-heal: omtDir exists but pins/ is absent ---

  describe('self-heal: creates pins/ when omtDir exists but pins/ is absent', () => {
    let tempBase: string;
    let selfHealOmtDir: string;

    beforeEach(() => {
      tempBase = mkdtempSync(join(tmpdir(), 'scanner-selfheal-'));
      selfHealOmtDir = join(tempBase, 'omt');
      // Create omtDir but NOT pins/ — this is the self-heal scenario
      mkdirSync(selfHealOmtDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempBase, { recursive: true, force: true });
    });

    it('creates pins/ directory and returns { count: 0 }', () => {
      const result = scanPins(selfHealOmtDir);

      expect(existsSync(join(selfHealOmtDir, 'pins'))).toBe(true);
      expect(result.count).toBe(0);
    });
  });

  // --- EEXIST fail-open: pins path occupied by a file, not a directory ---

  describe('EEXIST fail-open: pins path is a file', () => {
    let tempBase: string;
    let eexistOmtDir: string;

    beforeEach(() => {
      tempBase = mkdtempSync(join(tmpdir(), 'scanner-eexist-'));
      eexistOmtDir = join(tempBase, 'omt');
      // Create omtDir so the self-heal branch runs, but put a file at pins path
      mkdirSync(eexistOmtDir, { recursive: true });
      // Pre-create a FILE at the location where pins/ directory would go
      writeFileSync(join(eexistOmtDir, 'pins'), 'not-a-directory');
    });

    afterEach(() => {
      rmSync(tempBase, { recursive: true, force: true });
    });

    it('returns { count: 0 } and does not throw when pins path is a file', () => {
      expect(() => {
        const result = scanPins(eexistOmtDir);
        expect(result.count).toBe(0);
      }).not.toThrow();
    });
  });
});

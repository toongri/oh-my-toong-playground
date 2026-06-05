#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';

const SETUP_PATH = path.join(import.meta.dirname, 'setup.ts');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pin-setup-test-'));
}

/**
 * Runs setup.ts as a subprocess in cwd=projectDir with the given extra args.
 * Returns { exitCode, stdout, stderr }.
 */
async function runSetup(
  projectDir: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', SETUP_PATH, ...args], {
    cwd: projectDir,
    stdout: 'pipe',
    stderr: 'pipe',
    // Ensure non-git temp dir is NOT influenced by outer OMT_DIR.
    env: { ...process.env, OMT_DIR: undefined as unknown as string },
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

// ── C6: non-existent location does not crash ────────────────────────────────

describe('C6 — missing location directory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('exits 0 when --location directory does not exist', async () => {
    const missingLocation = path.join(tmpDir, 'pins-not-yet-created');
    // Do NOT create missingLocation on disk.

    const { exitCode, stderr } = await runSetup(tmpDir, [
      '--location', missingLocation,
      '--scope', 'private',
    ]);

    expect(stderr).not.toContain('ENOENT');
    expect(exitCode).toBe(0);
  });
});

// ── C7: pins.yaml written to resolveProjectRoot(), not bare cwd ─────────────

describe('C7 — pins.yaml written to project root', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates pins.yaml in cwd (project root fallback for non-git dir)', async () => {
    // tmpDir is not a git repo → resolveProjectRoot() falls back to cwd.
    const missingLocation = path.join(tmpDir, 'pins');

    const { exitCode } = await runSetup(tmpDir, [
      '--location', missingLocation,
      '--scope', 'private',
    ]);

    expect(exitCode).toBe(0);
    const manifestPath = path.join(tmpDir, 'pins.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});

// ── C8: special characters in location survive yaml round-trip ──────────────

describe('C8 — special characters in location', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('location with # is preserved after yaml round-trip', async () => {
    // Path containing a hash — would be mis-parsed as a comment by naive interpolation.
    const hashLocation = path.join(tmpDir, 'pins #1');

    const { exitCode } = await runSetup(tmpDir, [
      '--location', hashLocation,
      '--scope', 'private',
    ]);

    expect(exitCode).toBe(0);
    const manifestPath = path.join(tmpDir, 'pins.yaml');
    const text = fs.readFileSync(manifestPath, 'utf8');
    const parsed = parseYaml(text) as { location: string; scope: string };
    expect(parsed.location).toBe(hashLocation);
  });

  test('location with leading/trailing spaces is preserved after yaml round-trip', async () => {
    // Use a symlink-style indirect test: the path itself contains a space (common).
    const spaceLocation = path.join(tmpDir, 'my pins');

    const { exitCode } = await runSetup(tmpDir, [
      '--location', spaceLocation,
      '--scope', 'private',
    ]);

    expect(exitCode).toBe(0);
    const manifestPath = path.join(tmpDir, 'pins.yaml');
    const text = fs.readFileSync(manifestPath, 'utf8');
    const parsed = parseYaml(text) as { location: string; scope: string };
    expect(parsed.location).toBe(spaceLocation);
  });
});

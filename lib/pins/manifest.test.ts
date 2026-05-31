import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveManifest } from './manifest.ts';

let dirsToClean: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pins-manifest-test-'));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirsToClean) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirsToClean = [];
});

describe('precedence', () => {
  test('returns project-root pins.yaml when both project-root and user-root have one', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    writeFileSync(join(projectRoot, 'pins.yaml'), 'location: project-pins\nscope: project-scope\n');
    writeFileSync(join(userRoot, 'pins.yaml'), 'location: user-pins\nscope: user-scope\n');

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.manifest.location).toBe('project-pins');
    expect(result.manifest.scope).toBe('project-scope');
  });

  test('falls back to user-root pins.yaml when only user-root has one', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    writeFileSync(join(userRoot, 'pins.yaml'), 'location: user-pins\nscope: user-scope\n');

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.manifest.location).toBe('user-pins');
    expect(result.manifest.scope).toBe('user-scope');
  });
});

describe('absent signal', () => {
  test('returns absent when neither project-root nor user-root has a pins.yaml', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('absent');
  });

  test('does not throw when neither manifest exists', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    const call = () => resolveManifest({ projectRoot, userRoot });

    await expect(call()).resolves.toBeDefined();
  });

  test('does not create any file when absent', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    await resolveManifest({ projectRoot, userRoot });

    const { readdirSync } = await import('fs');
    expect(readdirSync(projectRoot)).toHaveLength(0);
    expect(readdirSync(userRoot)).toHaveLength(0);
  });
});

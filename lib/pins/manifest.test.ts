import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
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

describe('git field', () => {
  test('git: true in yaml → manifest.git === true', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    writeFileSync(join(projectRoot, 'pins.yaml'), 'location: some-pins\nscope: some-scope\ngit: true\n');

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.manifest.git).toBe(true);
  });

  test('no git field in yaml → manifest.git === false', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    writeFileSync(join(projectRoot, 'pins.yaml'), 'location: some-pins\nscope: some-scope\n');

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.manifest.git).toBe(false);
  });

  test('non-boolean git in yaml (e.g. "yes") → manifest.git === false', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    writeFileSync(join(projectRoot, 'pins.yaml'), 'location: some-pins\nscope: some-scope\ngit: "yes"\n');

    const result = await resolveManifest({ projectRoot, userRoot });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.manifest.git).toBe(false);
  });
});

describe('read failure propagation', () => {
  test('pins.yaml exists as a directory (EISDIR) → throws instead of returning absent', async () => {
    const projectRoot = makeTmpDir();
    const userRoot = makeTmpDir();

    // Place a directory at the pins.yaml path to trigger EISDIR on readFile
    const { mkdirSync } = await import('fs');
    mkdirSync(join(projectRoot, 'pins.yaml'));

    await expect(resolveManifest({ projectRoot, userRoot })).rejects.toThrow();
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

  test('absent resolution creates no dir', async () => {
    // Simulate OMT_DIR unset: use a tmp dir as cwd base so the derived
    // ~/.omt/<project> path is known and verifiably absent.
    const savedOmtDir = process.env.OMT_DIR;
    const savedCwd = process.cwd();

    const tmpCwd = makeTmpDir();
    // Derive what resolveOmtDir() would compute for this cwd (non-git dir):
    // basename(tmpCwd) → ~/.omt/<basename>
    const derivedDir = join(homedir(), '.omt', tmpCwd.split('/').pop()!);

    try {
      delete process.env.OMT_DIR;
      process.chdir(tmpCwd);

      // Pre-condition: derived dir must not exist before the call
      const existedBefore = existsSync(derivedDir);

      const result = await resolveManifest();

      expect(result.kind).toBe('absent');
      // If the dir didn't exist before, it must still not exist after
      if (!existedBefore) {
        expect(existsSync(derivedDir)).toBe(false);
      }
    } finally {
      process.chdir(savedCwd);
      if (savedOmtDir !== undefined) {
        process.env.OMT_DIR = savedOmtDir;
      } else {
        delete process.env.OMT_DIR;
      }
      // Clean up derivedDir if it was unexpectedly created
      if (!existsSync(derivedDir) === false) {
        rmSync(derivedDir, { recursive: true, force: true });
      }
    }
  });
});

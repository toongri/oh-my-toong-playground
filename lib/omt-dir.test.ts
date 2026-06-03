import { rm, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { basename, dirname, resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

import { getOmtDir, resolveOmtDir, resolveProjectRoot } from './omt-dir.ts';

const testTmpBase = join(tmpdir(), 'omt-dir-test-' + Date.now());

beforeAll(async () => {
  await mkdir(testTmpBase, { recursive: true });
});

afterAll(async () => {
  await rm(testTmpBase, { recursive: true, force: true });
});

describe('getOmtDir', () => {
  let originalOmtDir: string | undefined;
  let originalCwd: string;
  let createdOmtDirs: string[] = [];
  let preExistingDirs: Set<string>;

  beforeEach(() => {
    originalOmtDir = process.env.OMT_DIR;
    originalCwd = process.cwd();
    createdOmtDirs = [];
    const omtBase = `${homedir()}/.omt`;
    preExistingDirs = new Set(
      existsSync(omtBase)
        ? readdirSync(omtBase).map(d => `${omtBase}/${d}`)
        : []
    );
  });

  afterEach(async () => {
    if (originalOmtDir === undefined) {
      delete process.env.OMT_DIR;
    } else {
      process.env.OMT_DIR = originalOmtDir;
    }
    process.chdir(originalCwd);

    for (const dir of createdOmtDirs) {
      if (
        dir.startsWith(`${homedir()}/.omt/`) &&
        !preExistingDirs.has(dir) &&
        existsSync(dir)
      ) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('env var present: returns OMT_DIR and creates directory', () => {
    const envDir = join(testTmpBase, 'from-env-var');
    process.env.OMT_DIR = envDir;

    const result = getOmtDir();

    expect(result).toBe(envDir);
    expect(existsSync(envDir)).toBe(true);
  });

  it('env var absent with git repo: returns $HOME/.omt/{repo-name}', () => {
    delete process.env.OMT_DIR;

    // Use this repo itself as a known git directory
    const repoDir = join(import.meta.dir, '..');
    process.chdir(repoDir);

    const result = getOmtDir();
    createdOmtDirs.push(result);

    // Should be under $HOME/.omt/
    expect(result.startsWith(`${homedir()}/.omt/`)).toBe(true);
    expect(existsSync(result)).toBe(true);

    // Derive expected name using the same logic as omt-dir.ts and session-start.sh
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();

    let expectedName: string;
    if (gitCommonDir !== '.git') {
      // Worktree or subdirectory: resolve relative path against cwd
      const resolved = resolve(repoDir, gitCommonDir);
      expectedName = basename(dirname(resolved));
    } else {
      const toplevel = execSync('git rev-parse --show-toplevel', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      expectedName = basename(toplevel);
    }
    expectedName = expectedName.replace(/ /g, '-');

    expect(result).toBe(`${homedir()}/.omt/${expectedName}`);
  });

  it('env var absent without git: falls back to basename(cwd)', async () => {
    delete process.env.OMT_DIR;

    // Create a temp dir that is NOT a git repo
    const nonGitDir = join(testTmpBase, 'non-git-dir');
    await mkdir(nonGitDir, { recursive: true });
    process.chdir(nonGitDir);

    const result = getOmtDir();
    createdOmtDirs.push(result);

    const expectedName = basename(nonGitDir).replace(/ /g, '-');
    expect(result).toBe(`${homedir()}/.omt/${expectedName}`);
    expect(existsSync(result)).toBe(true);
  });

  it('path equivalence with session-start.sh logic: standard repo', () => {
    delete process.env.OMT_DIR;

    const repoDir = join(import.meta.dir, '..');
    process.chdir(repoDir);

    // Replicate session-start.sh lines 52-68 manually
    let gitCommonDir: string;
    try {
      gitCommonDir = execSync('git rev-parse --git-common-dir', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
    } catch {
      gitCommonDir = '';
    }

    let shellProjectName: string;
    if (gitCommonDir && gitCommonDir !== '.git') {
      const resolved = resolve(repoDir, gitCommonDir);
      shellProjectName = basename(dirname(resolved));
    } else if (gitCommonDir === '.git') {
      const toplevel = execSync('git rev-parse --show-toplevel', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      shellProjectName = basename(toplevel);
    } else {
      shellProjectName = basename(repoDir);
    }
    shellProjectName = shellProjectName.replace(/ /g, '-');

    const expectedPath = `${homedir()}/.omt/${shellProjectName}`;
    const result = getOmtDir();
    createdOmtDirs.push(result);

    expect(result).toBe(expectedPath);
  });

  it('env var absent from git repo subdirectory: returns correct $HOME/.omt/{repo-name}', async () => {
    delete process.env.OMT_DIR;

    // Use a subdirectory of this repo — git rev-parse --git-common-dir returns relative "../.git"
    const subDir = join(import.meta.dir, '..', 'lib');
    process.chdir(subDir);

    const result = getOmtDir();
    createdOmtDirs.push(result);

    // Derive expected name: resolve relative gitCommonDir against subDir
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: subDir,
      encoding: 'utf-8',
    }).trim();

    let expectedName: string;
    if (gitCommonDir !== '.git') {
      const resolved = resolve(subDir, gitCommonDir);
      expectedName = basename(dirname(resolved));
    } else {
      const toplevel = execSync('git rev-parse --show-toplevel', {
        cwd: subDir,
        encoding: 'utf-8',
      }).trim();
      expectedName = basename(toplevel);
    }
    expectedName = expectedName.replace(/ /g, '-');

    expect(result).toBe(`${homedir()}/.omt/${expectedName}`);
    // Must not be the home directory itself (the bug: basename(dirname("../.git")) === "..")
    expect(result).not.toBe(`${homedir()}/.omt/..`);
    expect(existsSync(result)).toBe(true);
  });

  it('spaces in directory name are replaced with hyphens', async () => {
    delete process.env.OMT_DIR;

    // Create a non-git dir with spaces in name
    const spacedDir = join(testTmpBase, 'my project name');
    await mkdir(spacedDir, { recursive: true });
    process.chdir(spacedDir);

    const result = getOmtDir();
    createdOmtDirs.push(result);

    expect(result).toBe(`${homedir()}/.omt/my-project-name`);
    expect(existsSync(result)).toBe(true);
  });
});

describe('no-mkdir sibling path matches getOmtDir', () => {
  let originalOmtDir: string | undefined;
  let originalCwd: string;
  let createdOmtDirs: string[] = [];
  let preExistingDirs: Set<string>;

  beforeEach(() => {
    originalOmtDir = process.env.OMT_DIR;
    originalCwd = process.cwd();
    createdOmtDirs = [];
    const omtBase = `${homedir()}/.omt`;
    preExistingDirs = new Set(
      existsSync(omtBase)
        ? readdirSync(omtBase).map(d => `${omtBase}/${d}`)
        : []
    );
  });

  afterEach(async () => {
    if (originalOmtDir === undefined) {
      delete process.env.OMT_DIR;
    } else {
      process.env.OMT_DIR = originalOmtDir;
    }
    process.chdir(originalCwd);

    for (const dir of createdOmtDirs) {
      if (
        dir.startsWith(`${homedir()}/.omt/`) &&
        !preExistingDirs.has(dir) &&
        existsSync(dir)
      ) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('OMT_DIR set: returns same path as getOmtDir without creating a new directory', () => {
    const envDir = join(testTmpBase, 'resolve-env-branch');
    process.env.OMT_DIR = envDir;

    // Precondition: dir does NOT exist yet
    expect(existsSync(envDir)).toBe(false);

    const resolved = resolveOmtDir();

    // resolveOmtDir must NOT have created the directory (no-mkdir contract)
    expect(existsSync(envDir)).toBe(false);

    const fromGetOmtDir = getOmtDir();
    createdOmtDirs.push(fromGetOmtDir);

    // Path must match
    expect(resolved).toBe(fromGetOmtDir);
    expect(resolved).toBe(envDir);
  });

  it('OMT_DIR unset: returns same path as getOmtDir without creating directory', async () => {
    delete process.env.OMT_DIR;

    // Use a non-git tmp dir so the derived name is deterministic and won't pre-exist
    const nonGitDir = join(testTmpBase, 'resolve-non-git-' + Date.now());
    await mkdir(nonGitDir, { recursive: true });
    process.chdir(nonGitDir);

    const expectedName = basename(nonGitDir).replace(/ /g, '-');
    const expectedPath = `${homedir()}/.omt/${expectedName}`;

    // Precondition: expected dir does NOT exist before we call resolveOmtDir
    expect(existsSync(expectedPath)).toBe(false);

    const resolved = resolveOmtDir();

    // resolveOmtDir must NOT have created the directory (no-mkdir contract)
    expect(existsSync(expectedPath)).toBe(false);

    // Path must match what getOmtDir would return
    const fromGetOmtDir = getOmtDir();
    createdOmtDirs.push(fromGetOmtDir);

    expect(resolved).toBe(fromGetOmtDir);
    expect(resolved).toBe(expectedPath);
  });

  it('custom cwd: resolveOmtDir(customCwd) uses customCwd for derivation, not process.cwd()', async () => {
    delete process.env.OMT_DIR;

    // Create two distinct non-git tmp dirs
    const customCwd = join(testTmpBase, 'custom-cwd-dir-' + Date.now());
    const processCwdDir = join(testTmpBase, 'process-cwd-dir-' + Date.now());
    await mkdir(customCwd, { recursive: true });
    await mkdir(processCwdDir, { recursive: true });

    // Set process.cwd() to processCwdDir — different from customCwd
    process.chdir(processCwdDir);

    const customName = basename(customCwd).replace(/ /g, '-');
    const expectedPath = `${homedir()}/.omt/${customName}`;

    const resolved = resolveOmtDir(customCwd);

    // Must use customCwd, not process.cwd()
    expect(resolved).toBe(expectedPath);
    expect(resolved).not.toBe(`${homedir()}/.omt/${basename(processCwdDir).replace(/ /g, '-')}`);

    // Must NOT create the directory
    expect(existsSync(expectedPath)).toBe(false);
  });
});

describe('resolveProjectRoot', () => {
  it('git repo subdirectory: returns the worktree top-level', () => {
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      cwd: import.meta.dir,
      encoding: 'utf-8',
    }).trim();

    // A nested subdirectory of this repo must still resolve to the repo root
    const subDir = join(import.meta.dir, 'pins');
    expect(resolveProjectRoot(subDir)).toBe(repoRoot);
  });

  it('non-git directory: falls back to the given cwd', async () => {
    const nonGitDir = join(testTmpBase, 'resolve-project-root-non-git-' + Date.now());
    await mkdir(nonGitDir, { recursive: true });

    expect(resolveProjectRoot(nonGitDir)).toBe(nonGitDir);
  });
});

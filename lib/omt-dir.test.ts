import { rm, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { basename, dirname, resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

import { getOmtDir } from './omt-dir.ts';

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

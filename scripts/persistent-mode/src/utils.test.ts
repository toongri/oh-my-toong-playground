import {
  getProjectRoot,
  ensureDir,
  readFileOrNull,
  writeFileSafe,
  deleteFile,
  generateAttemptId,
} from './utils.js';
import { mkdir, rm, writeFile, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('getProjectRoot', () => {
  const testDir = join(tmpdir(), 'utils-test-' + Date.now());
  const projectDir = join(testDir, 'project');

  beforeAll(async () => {
    await mkdir(projectDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should find project root by .git directory', async () => {
    const gitProject = join(testDir, 'git-project');
    await mkdir(join(gitProject, '.git'), { recursive: true });

    const result = getProjectRoot(gitProject);

    expect(result).toBe(gitProject);
  });

  it('should find project root by CLAUDE.md file', async () => {
    const claudeProject = join(testDir, 'claude-project');
    await mkdir(claudeProject, { recursive: true });
    await writeFile(join(claudeProject, 'CLAUDE.md'), '# Project');

    const result = getProjectRoot(claudeProject);

    expect(result).toBe(claudeProject);
  });

  it('should find project root by package.json file', async () => {
    const npmProject = join(testDir, 'npm-project');
    await mkdir(npmProject, { recursive: true });
    await writeFile(join(npmProject, 'package.json'), '{}');

    const result = getProjectRoot(npmProject);

    expect(result).toBe(npmProject);
  });

  it('should strip .claude/sisyphus suffix', async () => {
    const project = join(testDir, 'nested-project');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(join(project, '.claude', 'sisyphus'), { recursive: true });

    const result = getProjectRoot(join(project, '.claude', 'sisyphus'));

    expect(result).toBe(project);
  });

  it('should strip .claude suffix', async () => {
    const project = join(testDir, 'claude-dir-project');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(join(project, '.claude'), { recursive: true });

    const result = getProjectRoot(join(project, '.claude'));

    expect(result).toBe(project);
  });

  it('should search parent directories for project root', async () => {
    const rootProject = join(testDir, 'root-project');
    const deepPath = join(rootProject, 'src', 'lib', 'utils');
    await mkdir(join(rootProject, '.git'), { recursive: true });
    await mkdir(deepPath, { recursive: true });

    const result = getProjectRoot(deepPath);

    expect(result).toBe(rootProject);
  });

  it('should return stripped directory as fallback when no markers found', () => {
    const noMarkersPath = '/tmp/no-markers/deep/path/.claude/sisyphus';

    const result = getProjectRoot(noMarkersPath);

    expect(result).toBe('/tmp/no-markers/deep/path');
  });
});

describe('ensureDir', () => {
  const testDir = join(tmpdir(), 'ensure-dir-test-' + Date.now());

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create directory if it does not exist', () => {
    const newDir = join(testDir, 'new-dir');

    ensureDir(newDir);

    expect(existsSync(newDir)).toBe(true);
  });

  it('should create nested directories', () => {
    const nestedDir = join(testDir, 'a', 'b', 'c');

    ensureDir(nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
  });

  it('should not throw if directory already exists', async () => {
    const existingDir = join(testDir, 'existing');
    await mkdir(existingDir, { recursive: true });

    expect(() => ensureDir(existingDir)).not.toThrow();
  });
});

describe('readFileOrNull', () => {
  const testDir = join(tmpdir(), 'read-file-test-' + Date.now());

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return file content when file exists', async () => {
    const filePath = join(testDir, 'existing.txt');
    await writeFile(filePath, 'file content');

    const result = readFileOrNull(filePath);

    expect(result).toBe('file content');
  });

  it('should return null when file does not exist', () => {
    const result = readFileOrNull(join(testDir, 'nonexistent.txt'));

    expect(result).toBeNull();
  });

  it('should return null for directory path', async () => {
    const dirPath = join(testDir, 'some-dir');
    await mkdir(dirPath, { recursive: true });

    const result = readFileOrNull(dirPath);

    expect(result).toBeNull();
  });
});

describe('writeFileSafe', () => {
  const testDir = join(tmpdir(), 'write-file-test-' + Date.now());

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should write content to file', () => {
    const filePath = join(testDir, 'output.txt');

    writeFileSafe(filePath, 'test content');

    expect(readFileOrNull(filePath)).toBe('test content');
  });

  it('should create parent directories if needed', () => {
    const filePath = join(testDir, 'nested', 'dir', 'file.txt');

    writeFileSafe(filePath, 'nested content');

    expect(readFileOrNull(filePath)).toBe('nested content');
  });

  it('should overwrite existing file', async () => {
    const filePath = join(testDir, 'overwrite.txt');
    await mkdir(testDir, { recursive: true });
    await writeFile(filePath, 'old content');

    writeFileSafe(filePath, 'new content');

    expect(readFileOrNull(filePath)).toBe('new content');
  });
});

describe('deleteFile', () => {
  const testDir = join(tmpdir(), 'delete-file-test-' + Date.now());

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should delete existing file', async () => {
    const filePath = join(testDir, 'to-delete.txt');
    await writeFile(filePath, 'content');

    deleteFile(filePath);

    expect(existsSync(filePath)).toBe(false);
  });

  it('should not throw when file does not exist', () => {
    const nonExistent = join(testDir, 'nonexistent.txt');

    expect(() => deleteFile(nonExistent)).not.toThrow();
  });
});

describe('generateAttemptId', () => {
  it('should return sessionId when provided and not default', () => {
    const result = generateAttemptId('session-123', '/some/dir');

    expect(result).toBe('session-123');
  });

  it('should generate hash when sessionId is default', () => {
    const result = generateAttemptId('default', '/some/dir');

    expect(result).not.toBe('default');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should generate hash when sessionId is empty', () => {
    const result = generateAttemptId('', '/some/dir');

    expect(result).not.toBe('');
    expect(typeof result).toBe('string');
  });

  it('should generate consistent hash for same directory', () => {
    const result1 = generateAttemptId('', '/some/dir');
    const result2 = generateAttemptId('', '/some/dir');

    expect(result1).toBe(result2);
  });

  it('should generate different hash for different directories', () => {
    const result1 = generateAttemptId('', '/dir1');
    const result2 = generateAttemptId('', '/dir2');

    expect(result1).not.toBe(result2);
  });
});

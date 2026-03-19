import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import {
  readRalphState,
  updateRalphState,
  cleanupRalphState,
  getBlockCount,
  incrementBlockCount,
  cleanupBlockCountFiles,
  MAX_BLOCK_COUNT,
} from './state.ts';
import type { RalphState } from './types.ts';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Ralph state management', () => {
  const testDir = join(tmpdir(), 'state-test-ralph-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const omtDir = join(testDir, 'omt');
  const sessionId = 'test-session';

  const savedOmtDir = process.env.OMT_DIR;

  beforeAll(async () => {
    await mkdir(omtDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    process.env.OMT_DIR = omtDir;
    // Clean up state files before each test
    const stateFile = join(omtDir, `ralph-state-${sessionId}.json`);
    try { await rm(stateFile, { force: true }); } catch {}
  });

  afterEach(() => {
    if (savedOmtDir === undefined) {
      delete process.env.OMT_DIR;
    } else {
      process.env.OMT_DIR = savedOmtDir;
    }
  });

  describe('readRalphState', () => {
    it('should return null when state file does not exist', () => {
      const result = readRalphState(projectRoot, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should read active ralph state from session-specific file', async () => {
      const state: RalphState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(
        join(omtDir, `ralph-state-${sessionId}.json`),
        JSON.stringify(state)
      );

      const result = readRalphState(projectRoot, sessionId);

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.iteration).toBe(2);
      expect(result?.prompt).toBe('Test task');
    });

    it('should return null when state is inactive', async () => {
      const state: RalphState = {
        active: false,
        iteration: 5,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Completed task',
      };
      await writeFile(
        join(omtDir, `ralph-state-${sessionId}.json`),
        JSON.stringify(state)
      );

      const result = readRalphState(projectRoot, sessionId);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      await writeFile(
        join(omtDir, `ralph-state-${sessionId}.json`),
        'invalid json {'
      );

      const result = readRalphState(projectRoot, sessionId);

      expect(result).toBeNull();
    });
  });

  describe('updateRalphState', () => {
    it('should write state to session-specific file', async () => {
      const state: RalphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Updated task',
        oracle_feedback: ['Feedback 1'],
      };

      updateRalphState(projectRoot, sessionId, state);

      const content = await readFile(
        join(omtDir, `ralph-state-${sessionId}.json`),
        'utf8'
      );
      const parsed = JSON.parse(content);
      expect(parsed.iteration).toBe(3);
      expect(parsed.oracle_feedback).toContain('Feedback 1');
    });

    it('should create directory if it does not exist', async () => {
      const newOmtDir = join(testDir, 'new-omt');
      process.env.OMT_DIR = newOmtDir;
      const state: RalphState = {
        active: true,
        iteration: 1,
        max_iterations: 5,
        completion_promise: 'DONE',
        prompt: 'New task',
      };

      updateRalphState(projectRoot, sessionId, state);

      const stateFile = join(newOmtDir, `ralph-state-${sessionId}.json`);
      expect(existsSync(stateFile)).toBe(true);
    });
  });

  describe('cleanupRalphState', () => {
    it('should delete session-specific state file', async () => {
      const stateFile = join(omtDir, `ralph-state-${sessionId}.json`);
      await writeFile(stateFile, '{}');

      cleanupRalphState(projectRoot, sessionId);

      expect(existsSync(stateFile)).toBe(false);
    });

    it('should not throw when file does not exist', () => {
      expect(() => cleanupRalphState(projectRoot, 'nonexistent')).not.toThrow();
    });
  });
});

describe('Block counting', () => {
  const testDir = join(tmpdir(), 'state-test-block-count-' + Date.now());
  const stateDir = join(testDir, 'state');
  const attemptId = 'attempt-123';

  beforeAll(async () => {
    await mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up block count files before each test
    try { await rm(join(stateDir, `block-count-${attemptId}`), { force: true }); } catch {}
  });

  describe('MAX_BLOCK_COUNT', () => {
    it('should be 5', () => {
      expect(MAX_BLOCK_COUNT).toBe(5);
    });
  });

  describe('getBlockCount', () => {
    it('should return 0 when file does not exist', () => {
      const result = getBlockCount(stateDir, 'nonexistent');

      expect(result).toBe(0);
    });

    it('should return count from file', async () => {
      await writeFile(join(stateDir, `block-count-${attemptId}`), '3');

      const result = getBlockCount(stateDir, attemptId);

      expect(result).toBe(3);
    });

    it('should return 0 for invalid content', async () => {
      await writeFile(join(stateDir, `block-count-${attemptId}`), 'not a number');

      const result = getBlockCount(stateDir, attemptId);

      expect(result).toBe(0);
    });
  });

  describe('incrementBlockCount', () => {
    it('should increment from 0 when no file exists', () => {
      incrementBlockCount(stateDir, attemptId);

      expect(getBlockCount(stateDir, attemptId)).toBe(1);
    });

    it('should increment existing count', async () => {
      await writeFile(join(stateDir, `block-count-${attemptId}`), '2');

      incrementBlockCount(stateDir, attemptId);

      expect(getBlockCount(stateDir, attemptId)).toBe(3);
    });

    it('should create state directory if needed', async () => {
      const newStateDir = join(testDir, 'new-state');

      incrementBlockCount(newStateDir, attemptId);

      expect(existsSync(newStateDir)).toBe(true);
    });
  });

  describe('cleanupBlockCountFiles', () => {
    it('should delete block count file', async () => {
      await writeFile(join(stateDir, `block-count-${attemptId}`), '3');

      cleanupBlockCountFiles(stateDir, attemptId);

      expect(existsSync(join(stateDir, `block-count-${attemptId}`))).toBe(false);
    });

    it('should not throw when files do not exist', () => {
      expect(() => cleanupBlockCountFiles(stateDir, 'nonexistent')).not.toThrow();
    });
  });
});

import {
  readRalphState,
  updateRalphState,
  cleanupRalphState,
  readUltraworkState,
  updateUltraworkState,
  cleanupUltraworkState,
  getAttemptCount,
  incrementAttempts,
  resetAttempts,
  getTodoCount,
  saveTodoCount,
  cleanupAttemptFiles,
  MAX_TODO_CONTINUATION_ATTEMPTS,
} from './state.js';
import type { RalphState, UltraworkState } from './types.js';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('Ralph state management', () => {
  const testDir = join(tmpdir(), 'state-test-ralph-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const sisyphusDir = join(projectRoot, '.claude', 'sisyphus');
  const sessionId = 'test-session';

  beforeAll(async () => {
    await mkdir(sisyphusDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up state files before each test
    const stateFile = join(sisyphusDir, `ralph-state-${sessionId}.json`);
    try { await rm(stateFile, { force: true }); } catch {}
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
        join(sisyphusDir, `ralph-state-${sessionId}.json`),
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
        join(sisyphusDir, `ralph-state-${sessionId}.json`),
        JSON.stringify(state)
      );

      const result = readRalphState(projectRoot, sessionId);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      await writeFile(
        join(sisyphusDir, `ralph-state-${sessionId}.json`),
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
        join(sisyphusDir, `ralph-state-${sessionId}.json`),
        'utf8'
      );
      const parsed = JSON.parse(content);
      expect(parsed.iteration).toBe(3);
      expect(parsed.oracle_feedback).toContain('Feedback 1');
    });

    it('should create directory if it does not exist', async () => {
      const newProjectRoot = join(testDir, 'new-project');
      const state: RalphState = {
        active: true,
        iteration: 1,
        max_iterations: 5,
        completion_promise: 'DONE',
        prompt: 'New task',
      };

      updateRalphState(newProjectRoot, sessionId, state);

      const stateFile = join(newProjectRoot, '.claude', 'sisyphus', `ralph-state-${sessionId}.json`);
      expect(existsSync(stateFile)).toBe(true);
    });
  });

  describe('cleanupRalphState', () => {
    it('should delete session-specific state file', async () => {
      const stateFile = join(sisyphusDir, `ralph-state-${sessionId}.json`);
      await writeFile(stateFile, '{}');

      cleanupRalphState(projectRoot, sessionId);

      expect(existsSync(stateFile)).toBe(false);
    });

    it('should not throw when file does not exist', () => {
      expect(() => cleanupRalphState(projectRoot, 'nonexistent')).not.toThrow();
    });
  });
});

describe('Ultrawork state management', () => {
  const testDir = join(tmpdir(), 'state-test-ultrawork-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const sisyphusDir = join(projectRoot, '.claude', 'sisyphus');
  const sessionId = 'ultra-session';

  beforeAll(async () => {
    await mkdir(sisyphusDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up state files before each test
    const stateFile = join(sisyphusDir, `ultrawork-state-${sessionId}.json`);
    try { await rm(stateFile, { force: true }); } catch {}
  });

  describe('readUltraworkState', () => {
    it('should return null when state file does not exist', () => {
      const result = readUltraworkState(projectRoot, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should read active ultrawork state from project location', async () => {
      const state: UltraworkState = {
        active: true,
        reinforcement_count: 3,
        original_prompt: 'Original task',
      };
      await writeFile(
        join(sisyphusDir, `ultrawork-state-${sessionId}.json`),
        JSON.stringify(state)
      );

      const result = readUltraworkState(projectRoot, sessionId);

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.reinforcement_count).toBe(3);
    });

    it('should return null when state is inactive', async () => {
      const state: UltraworkState = {
        active: false,
        reinforcement_count: 5,
        original_prompt: 'Completed',
      };
      await writeFile(
        join(sisyphusDir, `ultrawork-state-${sessionId}.json`),
        JSON.stringify(state)
      );

      const result = readUltraworkState(projectRoot, sessionId);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      await writeFile(
        join(sisyphusDir, `ultrawork-state-${sessionId}.json`),
        'not json'
      );

      const result = readUltraworkState(projectRoot, sessionId);

      expect(result).toBeNull();
    });
  });

  describe('updateUltraworkState', () => {
    it('should write state to session-specific file', async () => {
      const state: UltraworkState = {
        active: true,
        reinforcement_count: 5,
        original_prompt: 'Updated prompt',
        last_checked_at: '2024-01-22T10:00:00Z',
      };

      updateUltraworkState(projectRoot, sessionId, state);

      const content = await readFile(
        join(sisyphusDir, `ultrawork-state-${sessionId}.json`),
        'utf8'
      );
      const parsed = JSON.parse(content);
      expect(parsed.reinforcement_count).toBe(5);
      expect(parsed.last_checked_at).toBe('2024-01-22T10:00:00Z');
    });
  });

  describe('cleanupUltraworkState', () => {
    it('should delete session-specific state files', async () => {
      const stateFile = join(sisyphusDir, `ultrawork-state-${sessionId}.json`);
      await writeFile(stateFile, '{}');

      cleanupUltraworkState(projectRoot, sessionId);

      expect(existsSync(stateFile)).toBe(false);
    });

    it('should not throw when files do not exist', () => {
      expect(() => cleanupUltraworkState(projectRoot, 'nonexistent')).not.toThrow();
    });
  });
});

describe('Attempt counting', () => {
  const testDir = join(tmpdir(), 'state-test-attempts-' + Date.now());
  const stateDir = join(testDir, 'state');
  const attemptId = 'attempt-123';

  beforeAll(async () => {
    await mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up attempt files before each test
    try { await rm(join(stateDir, `todo-attempts-${attemptId}`), { force: true }); } catch {}
    try { await rm(join(stateDir, `todo-count-${attemptId}`), { force: true }); } catch {}
  });

  describe('MAX_TODO_CONTINUATION_ATTEMPTS', () => {
    it('should be 5', () => {
      expect(MAX_TODO_CONTINUATION_ATTEMPTS).toBe(5);
    });
  });

  describe('getAttemptCount', () => {
    it('should return 0 when file does not exist', () => {
      const result = getAttemptCount(stateDir, 'nonexistent');

      expect(result).toBe(0);
    });

    it('should return count from file', async () => {
      await writeFile(join(stateDir, `todo-attempts-${attemptId}`), '3');

      const result = getAttemptCount(stateDir, attemptId);

      expect(result).toBe(3);
    });

    it('should return 0 for invalid content', async () => {
      await writeFile(join(stateDir, `todo-attempts-${attemptId}`), 'not a number');

      const result = getAttemptCount(stateDir, attemptId);

      expect(result).toBe(0);
    });
  });

  describe('incrementAttempts', () => {
    it('should increment from 0 when no file exists', () => {
      incrementAttempts(stateDir, attemptId);

      expect(getAttemptCount(stateDir, attemptId)).toBe(1);
    });

    it('should increment existing count', async () => {
      await writeFile(join(stateDir, `todo-attempts-${attemptId}`), '2');

      incrementAttempts(stateDir, attemptId);

      expect(getAttemptCount(stateDir, attemptId)).toBe(3);
    });

    it('should create state directory if needed', async () => {
      const newStateDir = join(testDir, 'new-state');

      incrementAttempts(newStateDir, attemptId);

      expect(existsSync(newStateDir)).toBe(true);
    });
  });

  describe('resetAttempts', () => {
    it('should delete attempt file', async () => {
      await writeFile(join(stateDir, `todo-attempts-${attemptId}`), '5');

      resetAttempts(stateDir, attemptId);

      expect(existsSync(join(stateDir, `todo-attempts-${attemptId}`))).toBe(false);
    });

    it('should not throw when file does not exist', () => {
      expect(() => resetAttempts(stateDir, 'nonexistent')).not.toThrow();
    });
  });

  describe('getTodoCount', () => {
    it('should return -1 when file does not exist', () => {
      const result = getTodoCount(stateDir, 'nonexistent');

      expect(result).toBe(-1);
    });

    it('should return count from file', async () => {
      await writeFile(join(stateDir, `todo-count-${attemptId}`), '7');

      const result = getTodoCount(stateDir, attemptId);

      expect(result).toBe(7);
    });
  });

  describe('saveTodoCount', () => {
    it('should save count to file', () => {
      saveTodoCount(stateDir, attemptId, 10);

      expect(getTodoCount(stateDir, attemptId)).toBe(10);
    });

    it('should create state directory if needed', async () => {
      const newStateDir = join(testDir, 'new-state-count');

      saveTodoCount(newStateDir, attemptId, 5);

      expect(existsSync(newStateDir)).toBe(true);
    });
  });

  describe('cleanupAttemptFiles', () => {
    it('should delete both attempt and count files', async () => {
      await writeFile(join(stateDir, `todo-attempts-${attemptId}`), '3');
      await writeFile(join(stateDir, `todo-count-${attemptId}`), '5');

      cleanupAttemptFiles(stateDir, attemptId);

      expect(existsSync(join(stateDir, `todo-attempts-${attemptId}`))).toBe(false);
      expect(existsSync(join(stateDir, `todo-count-${attemptId}`))).toBe(false);
    });

    it('should not throw when files do not exist', () => {
      expect(() => cleanupAttemptFiles(stateDir, 'nonexistent')).not.toThrow();
    });
  });
});

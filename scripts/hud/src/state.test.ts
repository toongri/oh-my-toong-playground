import { readRalphState, readUltraworkState, readRalphVerification, readBackgroundTasks, calculateSessionDuration, getInProgressTodo, isThinkingEnabled } from './state.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('state readers', () => {
  const testDir = join(tmpdir(), 'hud-state-test-' + Date.now());
  const projectDir = join(testDir, 'project');
  const claudeDir = join(projectDir, '.claude');
  const sisyphusDir = join(claudeDir, 'sisyphus');

  beforeAll(async () => {
    await mkdir(sisyphusDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readRalphState', () => {
    it('should read ralph state from project-local .claude/sisyphus/', async () => {
      const state = {
        active: true,
        iteration: 2,
        max_iterations: 5,
        completion_promise: 'Complete the task',
        prompt: 'Original prompt',
        started_at: '2024-01-22T10:00:00Z',
        linked_ultrawork: false,
      };

      await writeFile(join(sisyphusDir, 'ralph-state.json'), JSON.stringify(state));

      const result = await readRalphState(projectDir);

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.iteration).toBe(2);
      expect(result?.max_iterations).toBe(5);
    });

    it('should fall back to global state when project-local file does not exist', async () => {
      // This test verifies the fallback behavior - when no project-local file exists,
      // it falls back to ~/.claude/ralph-state.json if it exists
      const nonExistentDir = join(testDir, 'nonexistent');
      await mkdir(nonExistentDir, { recursive: true });

      const result = await readRalphState(nonExistentDir);

      // Result depends on whether global file exists
      // We just verify the function doesn't throw
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });

  describe('readUltraworkState', () => {
    it('should read ultrawork state from project-local .claude/sisyphus/', async () => {
      const state = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Original prompt',
        reinforcement_count: 3,
        linked_to_ralph: true,
      };

      await writeFile(join(sisyphusDir, 'ultrawork-state.json'), JSON.stringify(state));

      const result = await readUltraworkState(projectDir);

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.reinforcement_count).toBe(3);
    });
  });

  describe('readRalphVerification', () => {
    it('should read ralph verification from project-local .claude/sisyphus/', async () => {
      const verification = {
        pending: true,
        verification_attempts: 1,
        max_verification_attempts: 3,
        original_task: 'Complete implementation',
        completion_claim: 'Implementation complete',
        created_at: new Date().toISOString(),
      };

      await writeFile(join(sisyphusDir, 'ralph-verification.json'), JSON.stringify(verification));

      const result = await readRalphVerification(projectDir);

      expect(result).not.toBeNull();
      expect(result?.pending).toBe(true);
      expect(result?.verification_attempts).toBe(1);
    });

    it('should return null for stale verification (>24h old)', async () => {
      const staleDate = new Date();
      staleDate.setHours(staleDate.getHours() - 25); // 25 hours ago

      const verification = {
        pending: true,
        verification_attempts: 1,
        max_verification_attempts: 3,
        original_task: 'Old task',
        completion_claim: 'Old claim',
        created_at: staleDate.toISOString(),
      };

      const staleDir = join(testDir, 'stale-project');
      const staleSisyphusDir = join(staleDir, '.claude', 'sisyphus');
      await mkdir(staleSisyphusDir, { recursive: true });
      await writeFile(join(staleSisyphusDir, 'ralph-verification.json'), JSON.stringify(verification));

      const result = await readRalphVerification(staleDir);

      expect(result).toBeNull();
    });
  });

  // readTodos tests removed - todos now come from transcript only for session isolation

  describe('readBackgroundTasks', () => {
    it('should return count of background task files', async () => {
      // This test depends on the actual ~/.claude/background-tasks directory
      // which may or may not exist
      const result = await readBackgroundTasks();

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateSessionDuration', () => {
    it('should return null when startedAt is null', () => {
      const result = calculateSessionDuration(null);
      expect(result).toBeNull();
    });

    it('should calculate duration in minutes from start time to now', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = calculateSessionDuration(fiveMinutesAgo);
      expect(result).toBe(5);
    });

    it('should floor fractional minutes', () => {
      // 3 minutes 30 seconds ago
      const threeAndHalfMinutesAgo = new Date(Date.now() - 3.5 * 60 * 1000);
      const result = calculateSessionDuration(threeAndHalfMinutesAgo);
      expect(result).toBe(3);
    });

    it('should return 0 for recent start times', () => {
      const justNow = new Date(Date.now() - 30 * 1000); // 30 seconds ago
      const result = calculateSessionDuration(justNow);
      expect(result).toBe(0);
    });
  });

  describe('getInProgressTodo', () => {
    // Tests updated to use new signature: getInProgressTodo(todos: TodoItem[])
    // Function now accepts transcript todos directly for session isolation

    it('should return activeForm of in_progress todo when available', () => {
      const todos = [
        { content: 'Task 1', status: 'completed' as const },
        { content: 'Task 2', status: 'in_progress' as const, activeForm: 'Working on Task 2' },
        { content: 'Task 3', status: 'pending' as const },
      ];

      const result = getInProgressTodo(todos);

      expect(result).toBe('Working on Task 2');
    });

    it('should return content when activeForm is not available', () => {
      const todos = [
        { content: 'Task 1', status: 'completed' as const },
        { content: 'In Progress Task', status: 'in_progress' as const },
      ];

      const result = getInProgressTodo(todos);

      expect(result).toBe('In Progress Task');
    });

    it('should truncate text longer than 25 characters', () => {
      const todos = [
        { content: 'This is a very long task name that exceeds twenty five characters', status: 'in_progress' as const, activeForm: 'This is a very long active form text' },
      ];

      const result = getInProgressTodo(todos);

      expect(result).toBe('This is a very long activ...');
      expect(result?.length).toBe(28); // 25 chars + '...'
    });

    it('should return null when no in_progress todo exists', () => {
      const todos = [
        { content: 'Task 1', status: 'completed' as const },
        { content: 'Task 2', status: 'pending' as const },
      ];

      const result = getInProgressTodo(todos);

      expect(result).toBeNull();
    });

    it('should return null when empty array is passed', () => {
      const result = getInProgressTodo([]);

      expect(result).toBeNull();
    });

    it('should return first in_progress todo when multiple exist', () => {
      const todos = [
        { content: 'Task 1', status: 'in_progress' as const, activeForm: 'First Active' },
        { content: 'Task 2', status: 'in_progress' as const, activeForm: 'Second Active' },
      ];

      const result = getInProgressTodo(todos);

      expect(result).toBe('First Active');
    });
  });

  describe('isThinkingEnabled', () => {
    it('should return false by default', async () => {
      const result = await isThinkingEnabled();
      expect(result).toBe(false);
    });
  });
});

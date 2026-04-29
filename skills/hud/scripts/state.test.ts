import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readRalphState, readBackgroundTasks, calculateSessionDuration, isThinkingEnabled, readTasks, getActiveTaskForm } from './state.ts';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('state readers', () => {
  const testDir = join(tmpdir(), 'hud-state-test-' + Date.now());
  const projectDir = join(testDir, 'project');
  const omtDir = join(testDir, 'omt');

  beforeAll(async () => {
    await mkdir(omtDir, { recursive: true });
    process.env.OMT_DIR = omtDir;
  });

  afterAll(async () => {
    delete process.env.OMT_DIR;
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readRalphState', () => {
    it('should read session-specific ralph state from project-local .omt/', async () => {
      const state = {
        active: true,
        iteration: 2,
        max_iterations: 5,
        completion_promise: 'Complete the task',
        prompt: 'Original prompt',
        started_at: '2024-01-22T10:00:00Z',
              };

      // Session-specific file: ralph-state-test-session.json
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(state));

      const result = await readRalphState(projectDir, 'test-session');

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.iteration).toBe(2);
      expect(result?.max_iterations).toBe(5);
    });

    it('should use default session ID when not provided', async () => {
      const state = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Default session prompt',
        started_at: '2024-01-22T10:00:00Z',
              };

      // Default session file: ralph-state-default.json
      await writeFile(join(omtDir, 'ralph-state-default.json'), JSON.stringify(state));

      const result = await readRalphState(projectDir);

      expect(result).not.toBeNull();
      expect(result?.iteration).toBe(3);
    });

    it('should return null when session-specific file does not exist', async () => {
      const result = await readRalphState('', 'non-existent-session');

      expect(result).toBeNull();
    });

    it('should NOT read other sessions ralph state files', async () => {
      const state = {
        active: true,
        iteration: 5,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Other session task',
        started_at: '2024-01-22T10:00:00Z',
              };

      // Create ralph state for a different session
      await writeFile(join(omtDir, 'ralph-state-other-session.json'), JSON.stringify(state));

      // Try to read with a different session ID
      const result = await readRalphState(projectDir, 'my-session');

      expect(result).toBeNull();
    });
  });

  // readRalphVerification tests removed - verification is now part of ralph-state (oracle_feedback field)

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

  describe('isThinkingEnabled', () => {
    it('should return false by default', async () => {
      const result = await isThinkingEnabled();
      expect(result).toBe(false);
    });
  });

  describe('readTasks', () => {
    // Use real ~/.claude/tasks/ with unique session IDs to avoid interference
    const tasksBaseDir = join(homedir(), '.claude', 'tasks');
    const testSessionId = `hud-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let testSessionDir: string;

    beforeAll(async () => {
      testSessionDir = join(tasksBaseDir, testSessionId);
      await mkdir(testSessionDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(testSessionDir, { recursive: true, force: true });
    });

    it('should return completed and total counts from session task directory', async () => {
      // Create task files
      await writeFile(join(testSessionDir, 'task-1.json'), JSON.stringify({
        id: 'task-1', subject: 'Task 1', status: 'completed'
      }));
      await writeFile(join(testSessionDir, 'task-2.json'), JSON.stringify({
        id: 'task-2', subject: 'Task 2', status: 'in_progress'
      }));
      await writeFile(join(testSessionDir, 'task-3.json'), JSON.stringify({
        id: 'task-3', subject: 'Task 3', status: 'pending'
      }));

      const result = await readTasks(testSessionId);

      expect(result).not.toBeNull();
      expect(result?.completed).toBe(1);
      expect(result?.total).toBe(3);
    });

    it('should return null when no tasks exist', async () => {
      const emptySessionId = `hud-test-empty-${Date.now()}`;
      const emptySessionDir = join(tasksBaseDir, emptySessionId);
      await mkdir(emptySessionDir, { recursive: true });

      try {
        const result = await readTasks(emptySessionId);
        expect(result).toBeNull();
      } finally {
        await rm(emptySessionDir, { recursive: true, force: true });
      }
    });

    it('should return null when session directory does not exist', async () => {
      const result = await readTasks(`non-existent-session-${Date.now()}`);

      expect(result).toBeNull();
    });
  });

  describe('getActiveTaskForm', () => {
    // Use real ~/.claude/tasks/ with unique session IDs to avoid interference
    const tasksBaseDir = join(homedir(), '.claude', 'tasks');
    const testSessionId = `hud-activeform-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let testSessionDir: string;

    beforeAll(async () => {
      testSessionDir = join(tasksBaseDir, testSessionId);
      await mkdir(testSessionDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(testSessionDir, { recursive: true, force: true });
    });

    it('should return activeForm of first in_progress task', async () => {
      await writeFile(join(testSessionDir, 'task-1.json'), JSON.stringify({
        id: 'task-1', subject: 'Pending task', status: 'pending', activeForm: 'Pending form'
      }));
      await writeFile(join(testSessionDir, 'task-2.json'), JSON.stringify({
        id: 'task-2', subject: 'In progress task', status: 'in_progress', activeForm: 'Running the test'
      }));

      const result = await getActiveTaskForm(testSessionId);

      expect(result).toBe('Running the test');
    });

    it('should truncate activeForm longer than 25 chars with ellipsis', async () => {
      const truncSessionId = `hud-trunc-test-${Date.now()}`;
      const truncSessionDir = join(tasksBaseDir, truncSessionId);
      await mkdir(truncSessionDir, { recursive: true });

      try {
        await writeFile(join(truncSessionDir, 'task-1.json'), JSON.stringify({
          id: 'task-1',
          subject: 'Long task',
          status: 'in_progress',
          activeForm: 'This is a very long active form description'
        }));

        const result = await getActiveTaskForm(truncSessionId);

        expect(result).toBe('This is a very long activ...');
        expect(result?.length).toBe(28);
      } finally {
        await rm(truncSessionDir, { recursive: true, force: true });
      }
    });

    it('should return null when no in_progress task exists', async () => {
      const noInProgressId = `hud-no-progress-test-${Date.now()}`;
      const noInProgressDir = join(tasksBaseDir, noInProgressId);
      await mkdir(noInProgressDir, { recursive: true });

      try {
        await writeFile(join(noInProgressDir, 'task-1.json'), JSON.stringify({
          id: 'task-1', subject: 'Pending', status: 'pending', activeForm: 'Form'
        }));
        await writeFile(join(noInProgressDir, 'task-2.json'), JSON.stringify({
          id: 'task-2', subject: 'Completed', status: 'completed', activeForm: 'Done'
        }));

        const result = await getActiveTaskForm(noInProgressId);

        expect(result).toBeNull();
      } finally {
        await rm(noInProgressDir, { recursive: true, force: true });
      }
    });

    it('should return null when in_progress task has no activeForm', async () => {
      const noFormId = `hud-no-form-test-${Date.now()}`;
      const noFormDir = join(tasksBaseDir, noFormId);
      await mkdir(noFormDir, { recursive: true });

      try {
        await writeFile(join(noFormDir, 'task-1.json'), JSON.stringify({
          id: 'task-1', subject: 'In progress without form', status: 'in_progress'
        }));

        const result = await getActiveTaskForm(noFormId);

        expect(result).toBeNull();
      } finally {
        await rm(noFormDir, { recursive: true, force: true });
      }
    });

    it('should return null when session directory does not exist', async () => {
      const result = await getActiveTaskForm(`non-existent-form-session-${Date.now()}`);

      expect(result).toBeNull();
    });
  });
});

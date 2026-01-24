import { readRalphState, readUltraworkState, readBackgroundTasks, calculateSessionDuration, isThinkingEnabled } from './state.js';
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
    it('should read session-specific ralph state from project-local .claude/sisyphus/', async () => {
      const state = {
        active: true,
        iteration: 2,
        max_iterations: 5,
        completion_promise: 'Complete the task',
        prompt: 'Original prompt',
        started_at: '2024-01-22T10:00:00Z',
        linked_ultrawork: false,
      };

      // Session-specific file: ralph-state-test-session.json
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(state));

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
        linked_ultrawork: false,
      };

      // Default session file: ralph-state-default.json
      await writeFile(join(sisyphusDir, 'ralph-state-default.json'), JSON.stringify(state));

      const result = await readRalphState(projectDir);

      expect(result).not.toBeNull();
      expect(result?.iteration).toBe(3);
    });

    it('should return null when session-specific file does not exist', async () => {
      const nonExistentDir = join(testDir, 'nonexistent');
      await mkdir(nonExistentDir, { recursive: true });

      const result = await readRalphState(nonExistentDir, 'non-existent-session');

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
        linked_ultrawork: false,
      };

      // Create ralph state for a different session
      await writeFile(join(sisyphusDir, 'ralph-state-other-session.json'), JSON.stringify(state));

      // Try to read with a different session ID
      const result = await readRalphState(projectDir, 'my-session');

      expect(result).toBeNull();
    });
  });

  describe('readUltraworkState', () => {
    it('should read session-specific ultrawork state from project-local .claude/sisyphus/', async () => {
      const state = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Original prompt',
        reinforcement_count: 3,
        linked_to_ralph: true,
      };

      // Session-specific file: ultrawork-state-test-session.json
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(state));

      const result = await readUltraworkState(projectDir, 'test-session');

      expect(result).not.toBeNull();
      expect(result?.active).toBe(true);
      expect(result?.reinforcement_count).toBe(3);
    });

    it('should use default session ID when not provided', async () => {
      const state = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Default session prompt',
        reinforcement_count: 5,
        linked_to_ralph: false,
      };

      // Default session file: ultrawork-state-default.json
      await writeFile(join(sisyphusDir, 'ultrawork-state-default.json'), JSON.stringify(state));

      const result = await readUltraworkState(projectDir);

      expect(result).not.toBeNull();
      expect(result?.reinforcement_count).toBe(5);
    });

    it('should return null when session-specific file does not exist', async () => {
      const nonExistentDir = join(testDir, 'nonexistent-ultrawork');
      await mkdir(nonExistentDir, { recursive: true });

      const result = await readUltraworkState(nonExistentDir, 'non-existent-session');

      expect(result).toBeNull();
    });

    it('should NOT read other sessions ultrawork state files', async () => {
      const state = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Other session task',
        reinforcement_count: 7,
        linked_to_ralph: true,
      };

      // Create ultrawork state for a different session
      await writeFile(join(sisyphusDir, 'ultrawork-state-other-session.json'), JSON.stringify(state));

      // Try to read with a different session ID
      const result = await readUltraworkState(projectDir, 'my-session');

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
});

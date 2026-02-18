import { makeDecision, DecisionContext } from './decision.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('makeDecision', () => {
  const testDir = join(tmpdir(), 'persistent-mode-decision-test-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const omtDir = join(projectRoot, '.omt');
  const stateDir = join(omtDir, 'state');

  beforeAll(async () => {
    await mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up state files between tests
    await rm(omtDir, { recursive: true, force: true });
    await mkdir(stateDir, { recursive: true });
  });

  const createContext = (overrides: Partial<DecisionContext> = {}): DecisionContext => ({
    projectRoot,
    sessionId: 'test-session',
    transcriptPath: null,
    incompleteTodoCount: 0,
    ...overrides,
  });

  describe('no blocking conditions', () => {
    it('should return continue: true when no state files and no incomplete todos', () => {
      const context = createContext();

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should return continue: true when all todos are completed', () => {
      const context = createContext({ incompleteTodoCount: 0 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });
  });

  describe('Priority 1: Ralph Loop with Oracle Verification', () => {
    it('should block and return continuation message when ralph is active without oracle approval', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      // Iteration stays at 1 because Oracle not called yet (no rejection feedback)
      expect(result.reason).toContain('ITERATION 1/10');
      expect(result.reason).toContain('Test task');
    });

    it('should preserve iteration when blocking without oracle rejection (Oracle not called)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      makeDecision(context);

      // Iteration should NOT increment - just a reminder to call Oracle
      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
      expect(updatedState.iteration).toBe(3);
    });

    it('should allow stop when max iterations reached', async () => {
      const ralphState = {
        active: true,
        iteration: 10, // At max
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup ralph state when max iterations reached', async () => {
      const ralphState = {
        active: true,
        iteration: 10,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(false);
    });

    it('should allow stop when oracle approval is detected in transcript', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // Create transcript with oracle approval
      const transcriptPath = join(testDir, 'transcript.jsonl');
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const context = createContext({ transcriptPath });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup ralph state when oracle approval detected', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const transcriptPath = join(testDir, 'transcript.jsonl');
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const context = createContext({ transcriptPath });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(false);
    });

    it('should include previous oracle feedback in continuation message', async () => {
      const ralphState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
        oracle_feedback: ['Missing unit tests', 'Code not refactored'],
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Previous Oracle Feedback');
      expect(result.reason).toContain('Missing unit tests');
      expect(result.reason).toContain('Code not refactored');
    });

    it('should capture new rejection feedback when detected', async () => {
      const ralphState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
        oracle_feedback: [],
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // Create transcript with oracle rejection
      const transcriptPath = join(testDir, 'rejection-transcript.jsonl');
      await writeFile(transcriptPath, 'Oracle rejected because: issue: Tests are failing');

      const context = createContext({ transcriptPath });

      makeDecision(context);

      // Check that feedback was captured
      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
      expect(updatedState.oracle_feedback).toContain('Tests are failing');
    });

    describe('tasks completion check before Oracle approval', () => {
      it('should block when tasks incomplete even if oracle approval present', async () => {
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Create transcript with oracle approval
        const transcriptPath = join(testDir, 'oracle-approved-transcript.jsonl');
        await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

        // But tasks are incomplete
        const context = createContext({ transcriptPath, incompleteTodoCount: 3 });

        const result = makeDecision(context);

        // Should block because tasks incomplete, even though Oracle approved
        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-loop-continuation>');
      });

      it('should increment iteration when blocking due to incomplete tasks', async () => {
        const ralphState = {
          active: true,
          iteration: 2,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks incomplete, no oracle approval
        const context = createContext({ incompleteTodoCount: 5 });

        makeDecision(context);

        const { readFileSync } = await import('fs');
        const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
        expect(updatedState.iteration).toBe(3);
      });

      it('should allow stop when max iterations reached even with incomplete tasks', async () => {
        const ralphState = {
          active: true,
          iteration: 10, // At max
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks incomplete, but max iterations reached
        const context = createContext({ incompleteTodoCount: 5 });

        const result = makeDecision(context);

        // Should pass because max iterations is escape hatch regardless of tasks
        expect(result).toEqual({ continue: true });
      });

      it('should only check Oracle approval after tasks are complete', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Oracle approved AND tasks complete
        const transcriptPath = join(testDir, 'tasks-complete-oracle-approved.jsonl');
        await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

        const context = createContext({ transcriptPath, incompleteTodoCount: 0 });

        const result = makeDecision(context);

        // Should pass because tasks complete AND oracle approved
        expect(result).toEqual({ continue: true });
      });

      it('should block when tasks complete but Oracle not called yet', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks complete but no oracle approval (Oracle not called yet)
        const context = createContext({ incompleteTodoCount: 0 });

        const result = makeDecision(context);

        // Should block because Oracle hasn't approved yet
        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-loop-continuation>');
      });

      it('should NOT increment iteration when Oracle not called yet (no rejection feedback)', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks complete, Oracle not called yet (no transcript with rejection)
        const context = createContext({ incompleteTodoCount: 0 });

        makeDecision(context);

        // Iteration should NOT increment - just a reminder to call Oracle
        const { readFileSync } = await import('fs');
        const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
        expect(updatedState.iteration).toBe(3); // Should stay the same
      });

      it('should capture Oracle rejection feedback when tasks complete but Oracle rejected', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
          oracle_feedback: [],
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks complete but Oracle rejected
        const transcriptPath = join(testDir, 'oracle-rejected-transcript.jsonl');
        await writeFile(transcriptPath, 'Oracle rejected because: issue: Code needs cleanup');

        const context = createContext({ transcriptPath, incompleteTodoCount: 0 });

        makeDecision(context);

        const { readFileSync } = await import('fs');
        const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
        expect(updatedState.oracle_feedback).toContain('Code needs cleanup');
        expect(updatedState.iteration).toBe(4);
      });

      it('should INCREMENT iteration when Oracle was called AND rejected', async () => {
        const ralphState = {
          active: true,
          iteration: 5,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
          oracle_feedback: [],
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // Tasks complete, Oracle called but rejected
        const transcriptPath = join(testDir, 'oracle-rejected-transcript2.jsonl');
        await writeFile(transcriptPath, 'Oracle rejected because: issue: Missing documentation');

        const context = createContext({ transcriptPath, incompleteTodoCount: 0 });

        makeDecision(context);

        // Iteration SHOULD increment because Oracle was called and rejected
        const { readFileSync } = await import('fs');
        const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
        expect(updatedState.iteration).toBe(6);
      });
    });
  });

  describe('Priority 2: Baseline todo-continuation', () => {
    it('should block and return todo-continuation message when incomplete todos exist (no ralph/ultrawork)', () => {
      const context = createContext({ incompleteTodoCount: 5 });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<todo-continuation>');
      expect(result.reason).toContain('INCOMPLETE TASKS DETECTED - 5 remaining');
      expect(result.reason).toContain('Check your todo list with TaskList');
    });

    it('should create attempt files when blocking for baseline todos', async () => {
      const context = createContext({ incompleteTodoCount: 2 });

      makeDecision(context);

      const { existsSync } = await import('fs');
      const attemptFile = join(stateDir, 'block-count-test-session');
      expect(existsSync(attemptFile)).toBe(true);
    });

    it('should allow stop after max continuation attempts (escape hatch)', async () => {
      // Set attempt count to max
      await writeFile(join(stateDir, 'block-count-test-session'), '5');

      const context = createContext({ incompleteTodoCount: 3 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup attempt files when escape hatch triggers', async () => {
      // Set attempt count to max
      await writeFile(join(stateDir, 'block-count-test-session'), '5');

      const context = createContext({ incompleteTodoCount: 3 });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(stateDir, 'block-count-test-session'))).toBe(false);
    });

    it('should allow stop when no incomplete todos', () => {
      const context = createContext({ incompleteTodoCount: 0 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });
  });

  describe('message size limits (truncation)', () => {
    describe('prompt truncation', () => {
      it('should truncate prompt to 2000 characters with structural suffix when exceeding limit', async () => {
        const longPrompt = 'A'.repeat(2500); // 2500 chars, exceeds 2000 limit
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: longPrompt,
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        // Should contain truncated prompt (2000 chars + '...[truncated from 2500 chars]')
        const truncatedPrompt = 'A'.repeat(2000) + '...[truncated from 2500 chars]';
        expect(result.reason).toContain(truncatedPrompt);
        // Should NOT contain the full 2500 char prompt
        expect(result.reason).not.toContain(longPrompt);
      });

      it('should not truncate prompt when under 2000 characters', async () => {
        const shortPrompt = 'A'.repeat(1500); // Under limit
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: shortPrompt,
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain(shortPrompt);
        expect(result.reason).not.toContain('...[truncated from');
      });

      it('should not truncate prompt when exactly 2000 characters', async () => {
        const exactPrompt = 'A'.repeat(2000); // Exactly at limit
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: exactPrompt,
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain(exactPrompt);
        expect(result.reason).not.toContain('...[truncated from');
      });
    });

    describe('oracleFeedback truncation', () => {
      it('should truncate each feedback item to 500 characters with structural suffix', async () => {
        const longFeedback = 'B'.repeat(600); // 600 chars, exceeds 500 limit
        const ralphState = {
          active: true,
          iteration: 2,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
          oracle_feedback: [longFeedback],
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        // Should contain truncated feedback (500 chars + '...[truncated from 600 chars]')
        const truncatedFeedback = 'B'.repeat(500) + '...[truncated from 600 chars]';
        expect(result.reason).toContain(truncatedFeedback);
        // Should NOT contain full 600 char feedback
        expect(result.reason).not.toContain(longFeedback);
      });

      it('should keep only the most recent 3 feedback items', async () => {
        const ralphState = {
          active: true,
          iteration: 5,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
          oracle_feedback: [
            'Feedback 1 - oldest',
            'Feedback 2 - old',
            'Feedback 3 - recent',
            'Feedback 4 - more recent',
            'Feedback 5 - most recent',
          ],
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        // Should NOT contain oldest feedback items (1 and 2)
        expect(result.reason).not.toContain('Feedback 1 - oldest');
        expect(result.reason).not.toContain('Feedback 2 - old');
        // Should contain only the 3 most recent
        expect(result.reason).toContain('Feedback 3 - recent');
        expect(result.reason).toContain('Feedback 4 - more recent');
        expect(result.reason).toContain('Feedback 5 - most recent');
      });

      it('should handle both truncation and limit together', async () => {
        const longFeedback1 = 'X'.repeat(600);
        const longFeedback2 = 'Y'.repeat(700);
        const ralphState = {
          active: true,
          iteration: 4,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
          oracle_feedback: [
            'Old feedback - should be dropped',
            longFeedback1,
            'Short feedback',
            longFeedback2,
          ],
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        // Oldest should be dropped (only 3 kept)
        expect(result.reason).not.toContain('Old feedback - should be dropped');
        // Kept items should be truncated with structural suffix
        expect(result.reason).toContain('X'.repeat(500) + '...[truncated from 600 chars]');
        expect(result.reason).toContain('Short feedback');
        expect(result.reason).toContain('Y'.repeat(500) + '...[truncated from 700 chars]');
      });
    });

    describe('prompt duplication removal', () => {
      it('should contain prompt only once in continuation message', async () => {
        const testPrompt = 'UNIQUE_PROMPT_FOR_DUPLICATION_TEST';
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: testPrompt,
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        // Count occurrences of the prompt in the message
        const occurrences = result.reason!.split(testPrompt).length - 1;
        expect(occurrences).toBe(1);
      });

      it('should not contain "Original task:" section in continuation message', async () => {
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).not.toContain('Original task:');
      });

      it('should contain prompt in Oracle spawn instruction with "Verify task completion:" prefix', async () => {
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext();

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('Verify task completion: Test task');
      });
    });
  });

  describe('priority ordering', () => {
    it('should check ralph before baseline todos', async () => {
      // Ralph active with incomplete todos
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify({
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Ralph task',
      }));

      const context = createContext({ incompleteTodoCount: 5 });

      const result = makeDecision(context);

      // Should block with ralph message (priority 1)
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).not.toContain('<todo-continuation>');
    });

    it('should use baseline todo-continuation when no ralph active', () => {
      // No ralph, just incomplete todos
      const context = createContext({ incompleteTodoCount: 3 });

      const result = makeDecision(context);

      // Should block with todo-continuation message (priority 2)
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<todo-continuation>');
    });
  });
});

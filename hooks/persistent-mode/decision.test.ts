import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { makeDecision, DecisionContext } from './decision.ts';
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
    lastAssistantMessage: null,
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
    it('should block when ralph active but DONE not detected (branch 5)', async () => {
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

      // Branch 5: no transcript = no DONE detected → block
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).toContain('truly done');
    });

    it('should increment iteration when DONE not detected (branch 5)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      // Branch 5: no transcript = no DONE → block, iteration incremented
      expect(result.decision).toBe('block');
      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
      expect(updatedState.iteration).toBe(4);
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

    it('should allow stop when DONE and oracle approval detected in transcript (branch 3)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup ralph state when DONE and oracle approval detected (branch 3)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(false);
    });

    describe('tasks completion check before Oracle approval', () => {
      it('should block when tasks incomplete even if DONE and oracle approval present', async () => {
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // But tasks are incomplete
        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>', incompleteTodoCount: 3 });

        const result = makeDecision(context);

        // Should block because tasks incomplete (branch 2), even though DONE + Oracle approved
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

      it('should only check Oracle approval after tasks are complete (branch 3)', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // DONE + Oracle approved AND tasks complete
        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>', incompleteTodoCount: 0 });

        const result = makeDecision(context);

        // Should pass because tasks complete AND DONE + oracle approved (branch 3)
        expect(result).toEqual({ continue: true });
      });

      it('should block when tasks complete and DONE detected but Oracle not called yet (branch 4)', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // DONE detected but no VERIFIED_COMPLETE
        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>', incompleteTodoCount: 0 });

        const result = makeDecision(context);

        // Should block with oracle verification message (branch 4)
        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
      });

      it('should ALWAYS increment iteration when DONE detected but no VERIFIED_COMPLETE (branch 4)', async () => {
        const ralphState = {
          active: true,
          iteration: 3,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        // DONE detected, no VERIFIED_COMPLETE
        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>', incompleteTodoCount: 0 });

        makeDecision(context);

        // Branch 4: iteration ALWAYS increments
        const { readFileSync } = await import('fs');
        const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
        expect(updatedState.iteration).toBe(4);
      });

      it('should increment iteration from higher value when DONE but no VERIFIED_COMPLETE (branch 4)', async () => {
        const ralphState = {
          active: true,
          iteration: 5,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>', incompleteTodoCount: 0 });

        makeDecision(context);

        // Branch 4: Iteration ALWAYS increments
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
      expect(result.reason).toContain('Review your remaining tasks');
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

        // Need DONE in message to hit branch 4 (oracle verification)
        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
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

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
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

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
        expect(result.reason).toContain(exactPrompt);
        expect(result.reason).not.toContain('...[truncated from');
      });
    });

    describe('prompt duplication removal', () => {
      it('should contain prompt only once in oracle verification message', async () => {
        const testPrompt = 'UNIQUE_PROMPT_FOR_DUPLICATION_TEST';
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: testPrompt,
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
        // Count occurrences of the prompt in the message
        const occurrences = result.reason!.split(testPrompt).length - 1;
        expect(occurrences).toBe(1);
      });

      it('should not contain "Original task:" section in oracle verification message', async () => {
        const ralphState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test task',
        };
        await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
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

        const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

        const result = makeDecision(context);

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('<ralph-oracle-verification>');
        expect(result.reason).toContain('Verify task completion: Test task');
      });
    });
  });

  describe('5-branch decision tree (branches 3-5)', () => {
    it('should continue and cleanup state when DONE and VERIFIED_COMPLETE detected (branch 3)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });

      // State should be cleaned up
      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(false);
    });

    it('should continue and cleanup state when VERIFIED_COMPLETE detected without DONE (branch 3)', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });

      // State should be cleaned up
      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(false);
    });

    it('should block with oracle verification message when DONE detected but no VERIFIED_COMPLETE (branch 4)', async () => {
      const ralphState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-oracle-verification>');
      expect(result.reason).toContain('DONE detected');
      expect(result.reason).toContain('Spawn Oracle');
    });

    it('should block with continuation when DONE not detected (branch 5)', async () => {
      const ralphState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // No transcript = no DONE detected
      const context = createContext();

      const result = makeDecision(context);

      // Branch 5: no DONE → block with continuation
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).toContain('truly done');

      // State should still exist
      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'ralph-state-test-session.json'))).toBe(true);
    });

    it('should increment iteration and include original task when DONE not detected (branch 5)', async () => {
      const ralphState = {
        active: true,
        iteration: 4,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // Message without DONE
      const context = createContext({ lastAssistantMessage: 'some random content without promise tag' });

      const result = makeDecision(context);

      // Branch 5: no DONE → block, iteration incremented
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).toContain('ITERATION 5/10');
      expect(result.reason).toContain('truly done');
      expect(result.reason).toContain('meaningful progress');
      expect(result.reason).toContain('different approaches');
      expect(result.reason).toContain('<promise>DONE</promise>');
      expect(result.reason).toContain('Original task: Test task');

      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(omtDir, 'ralph-state-test-session.json'), 'utf8'));
      expect(updatedState.iteration).toBe(5);
    });
  });

  describe('buildOracleVerificationMessage content', () => {
    it('should contain ralph-oracle-verification wrapper tag', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-oracle-verification>');
      expect(result.reason).toContain('</ralph-oracle-verification>');
    });

    it('should contain "DONE detected" text', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.reason).toContain('DONE detected');
    });

    it('should contain "Spawn Oracle" instruction', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.reason).toContain('Spawn Oracle');
    });

    it('should contain VERIFIED_COMPLETE output instruction', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.reason).toContain('<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');
    });

    it('should contain iteration and maxIterations', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      // Branch 4 always increments: 3 → 4
      expect(result.reason).toContain('ITERATION 4/10');
    });

    it('should contain prompt in Oracle spawn instruction', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Implement the feature',
      };
      await writeFile(join(omtDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext({ lastAssistantMessage: '<promise>DONE</promise>' });

      const result = makeDecision(context);

      expect(result.reason).toContain('Verify task completion: Implement the feature');
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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import { makeDecision, DecisionContext } from './decision.ts';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('makeDecision', () => {
  const testDir = join(tmpdir(), 'persistent-mode-decision-test-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const omtDir = join(testDir, 'omt');
  const stateDir = join(omtDir, 'state');

  const savedOmtDir = process.env.OMT_DIR;

  beforeAll(async () => {
    await mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    process.env.OMT_DIR = omtDir;
    // Clean up state files between tests
    await rm(omtDir, { recursive: true, force: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (savedOmtDir === undefined) {
      delete process.env.OMT_DIR;
    } else {
      process.env.OMT_DIR = savedOmtDir;
    }
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

  describe('Priority 1.5: Deep Interview Protection', () => {
    it('makeDecision blocks with deep-interview-continuation when state active and no token', async () => {
      const deepInterviewState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'deep-interview-active-state-test-session.json'),
        JSON.stringify(deepInterviewState)
      );

      const context = createContext({ lastAssistantMessage: 'some message without done token' });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<deep-interview-continuation>');
    });

    it('makeDecision prioritizes ralph over deep-interview when both active', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Ralph task',
      };
      await writeFile(
        join(omtDir, 'ralph-state-test-session.json'),
        JSON.stringify(ralphState)
      );
      const deepInterviewState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'deep-interview-active-state-test-session.json'),
        JSON.stringify(deepInterviewState)
      );

      const context = createContext();

      const result = makeDecision(context);

      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).not.toContain('<deep-interview-continuation>');
    });

    it('makeDecision cleans up deep-interview state when token present in lastAssistantMessage', async () => {
      const deepInterviewState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'deep-interview-active-state-test-session.json'),
        JSON.stringify(deepInterviewState)
      );

      const context = createContext({ lastAssistantMessage: 'Interview complete. <deep-interview-done/>' });

      const result = makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'deep-interview-active-state-test-session.json'))).toBe(false);
      expect(result.reason ?? '').not.toContain('<deep-interview-continuation>');
    });

    it('makeDecision deletes active:false terminal marker via raw reader (no done-token required)', async () => {
      // Seed an active:false terminal marker — the normal readDeepInterviewState folds this to null,
      // so without the raw reader the delete branch never fires and the file orphans.
      const deepInterviewState = { active: false, sessionId: 'test-session' };
      const markerPath = join(omtDir, 'deep-interview-active-state-test-session.json');
      await writeFile(markerPath, JSON.stringify(deepInterviewState));

      // No done-token in the message — the fix must use the raw reader to detect active:false.
      const context = createContext({ lastAssistantMessage: 'some message without done token' });

      const result = makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(markerPath)).toBe(false);
      expect(result.reason ?? '').not.toContain('<deep-interview-continuation>');
    });

    it('makeDecision preserves active:true marker and emits continuation (no done-token)', async () => {
      // An active interview with no done-token must still be blocked and the marker kept.
      const deepInterviewState = { active: true, sessionId: 'test-session' };
      const markerPath = join(omtDir, 'deep-interview-active-state-test-session.json');
      await writeFile(markerPath, JSON.stringify(deepInterviewState));

      const context = createContext({ lastAssistantMessage: 'some message without done token' });

      const result = makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(markerPath)).toBe(true);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<deep-interview-continuation>');
    });
  });

  describe('Priority 1.5: Prometheus State Protection', () => {
    it('makeDecision blocks with prometheus-continuation when state active and no token', async () => {
      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'some message without done token' });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<prometheus-continuation>');
    });

    it('makeDecision cleans up prometheus state when token present in lastAssistantMessage', async () => {
      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'Plan complete. <prometheus-done/>' });

      const result = makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(omtDir, 'prometheus-state-test-session.json'))).toBe(false);
      expect(result.reason ?? '').not.toContain('<prometheus-continuation>');
    });

    it('makeDecision allows stop after MAX_BLOCK_COUNT token-less blocks (bounded escape)', async () => {
      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'no token here' });

      // First call should block (prometheus active, no token, below ceiling)
      const firstResult = makeDecision(context);
      expect(firstResult.decision).toBe('block');

      // Drive blockCount to ceiling (MAX_BLOCK_COUNT = 5; first call already incremented to 1)
      for (let i = 1; i < 5; i++) {
        makeDecision(context);
      }
      // This call is at/past ceiling — must NOT block
      const escapedResult = makeDecision(context);
      expect(escapedResult.decision).not.toBe('block');
    });

    it('makeDecision prioritizes ralph over prometheus when both active', async () => {
      const ralphState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Ralph task',
      };
      await writeFile(
        join(omtDir, 'ralph-state-test-session.json'),
        JSON.stringify(ralphState)
      );
      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext();

      const result = makeDecision(context);

      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).not.toContain('<prometheus-continuation>');
    });

    it('(regression) todo block-count pre-loaded to MAX does not shorten prometheus protection', async () => {
      // Seed the shared todo counter key (block-count-${attemptId}) to MAX_BLOCK_COUNT
      // so that if prometheus wrongly shares it, it would escape immediately.
      await writeFile(join(stateDir, 'block-count-test-session'), '5');

      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'working on it, no done token' });

      const result = makeDecision(context);

      // Prometheus uses its own counter key so the pre-loaded todo counter must NOT trigger escape.
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<prometheus-continuation>');
    });

    it('(regression) prometheus-specific counter reaches MAX_BLOCK_COUNT → escape', async () => {
      // Pre-load prometheus-specific counter to MAX_BLOCK_COUNT
      await writeFile(join(stateDir, 'block-count-prometheus-test-session'), '5');

      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'working on it, no done token' });

      const result = makeDecision(context);

      // Prometheus counter at ceiling → escape allowed
      expect(result.decision).not.toBe('block');
      expect(result).toEqual({ continue: true });
    });

    it('(regression) done-token cleanup also deletes prometheus-specific counter file', async () => {
      // Pre-load prometheus-specific counter to simulate in-progress session
      await writeFile(join(stateDir, 'block-count-prometheus-test-session'), '3');

      const prometheusState = { active: true, sessionId: 'test-session' };
      await writeFile(
        join(omtDir, 'prometheus-state-test-session.json'),
        JSON.stringify(prometheusState)
      );

      const context = createContext({ lastAssistantMessage: 'All done. <prometheus-done/>' });

      makeDecision(context);

      const { existsSync } = await import('fs');
      // Prometheus state file deleted
      expect(existsSync(join(omtDir, 'prometheus-state-test-session.json'))).toBe(false);
      // Prometheus-specific counter file also deleted
      expect(existsSync(join(stateDir, 'block-count-prometheus-test-session'))).toBe(false);
    });
  });

  describe('Priority 1.4: Goal autonomous pursuit loop', () => {
    const goalPath = join(omtDir, 'goal-state-test-session.json');

    const writeGoal = async (state: Record<string, unknown>) => {
      await writeFile(goalPath, JSON.stringify(state));
    };

    const readGoalFile = async (): Promise<Record<string, unknown>> => {
      const { readFileSync } = await import('fs');
      return JSON.parse(readFileSync(goalPath, 'utf8'));
    };

    it('ralph takes priority over goal', async () => {
      await writeFile(
        join(omtDir, 'ralph-state-test-session.json'),
        JSON.stringify({
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Ralph task',
        })
      );
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 1,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).not.toContain('[GOAL - ITERATION');
    });

    it('goal yields for any non-pursuing phase incl fresh entry', async () => {
      await writeGoal({
        active: true,
        phase: 'planning',
        objective_verdict: '',
        iteration: 0,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result).toEqual({ continue: true });
      // No iteration++ for non-pursuing phase
      const after = await readGoalFile();
      expect(after.iteration).toBe(0);
    });

    it('goal blocks when objective unmet incl absent verdict during pursuit', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        // objective_verdict intentionally absent
        iteration: 2,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('[GOAL - ITERATION 3/10]');
      const after = await readGoalFile();
      expect(after.iteration).toBe(3);
    });

    it('goal does not block when objective verdict is APPROVE', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'APPROVE',
        iteration: 2,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result).toEqual({ continue: true });
      // No iteration++ on APPROVE-yield
      const after = await readGoalFile();
      expect(after.iteration).toBe(2);
    });

    it('budget exhaustion soft-stops without completing', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'REQUEST_CHANGES',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      const after = await readGoalFile();
      expect(after.phase).toBe('budget_limited');
      expect(after.active).toBe(false);
      expect(after.budget_limit_notified).toBe(true);
      // No iteration++ on cap path
      expect(after.iteration).toBe(10);
    });

    it('complete wins when max_iterations and APPROVE coincide', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'APPROVE',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
        completion_evidence_paths: ['artifacts/report.md'],
      });

      const result = makeDecision(createContext());

      expect(result).toEqual({ continue: true });
      const after = await readGoalFile();
      expect(after.phase).toBe('complete');
      expect(after.active).toBe(false);
    });

    it('goal pursuit ignores shared block-count hatch', async () => {
      // Block-count already at the baseline escape-hatch limit (5)
      await writeFile(join(stateDir, 'block-count-test-session'), '5');
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 3,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

      // Goal still blocks even though shared block-count is maxed out
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('[GOAL - ITERATION 4/10]');
      const after = await readGoalFile();
      expect(after.iteration).toBe(4);
    });

    it('goal active suppresses baseline todo branch', async () => {
      await writeGoal({
        active: true,
        phase: 'planning',
        objective_verdict: '',
        iteration: 0,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext({ incompleteTodoCount: 5 }));

      // Yields without firing baseline todo-continuation
      expect(result).toEqual({ continue: true });
      expect(result.reason ?? '').not.toContain('<todo-continuation>');
    });

    it('goal does not yield to inactive/stale ralph', async () => {
      // Stale ralph state with active:false must not starve goal pursuit
      await writeFile(
        join(omtDir, 'ralph-state-test-session.json'),
        JSON.stringify({
          active: false,
          iteration: 2,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Stale ralph task',
        })
      );
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 1,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('[GOAL - ITERATION 2/10]');
      expect(result.reason).not.toContain('<ralph-loop-continuation>');
    });

    it('continuation has untrusted_objective wrap', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 1,
        max_iterations: 10,
        outcome: 'SENTINEL_OBJECTIVE_TEXT',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<untrusted_objective>');
      expect(result.reason).toContain('</untrusted_objective>');
      expect(result.reason).toContain('SENTINEL_OBJECTIVE_TEXT');
    });

    it('continuation has iteration and tokens-not-measured', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 4,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('[GOAL - ITERATION 5/10]');
      expect(result.reason!.toLowerCase()).toContain('not measured');
    });

    it('continuation is behavioral steering without audit rubric', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 1,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      const reason = result.reason!;
      // behavioral steering: next concrete action + proxy-signal refusal + when-uncertain-keep-going
      expect(reason.toLowerCase()).toContain('next');
      expect(reason.toLowerCase()).toContain('proxy');
      expect(reason.toLowerCase()).toContain('uncertain');
      // NO audit rubric leaked into the continuation (ADR-5: rubric lives in argus)
      expect(reason.toLowerCase()).not.toContain('prompt-to-artifact');
      expect(reason.toLowerCase()).not.toContain('verify-the-verifier');
    });

    it('continuation has complete-blocked gate', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: '',
        iteration: 1,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      const reason = result.reason!.toLowerCase();
      expect(reason).toContain('complete');
      expect(reason).toContain('blocked');
    });

    it('budget_limit message forbids new work and completion', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'REQUEST_CHANGES',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext());

      expect(result.decision).toBe('block');
      const reason = result.reason!.toLowerCase();
      // forbid starting new work
      expect(reason).toContain('new');
      // require a progress summary + next step
      expect(reason).toContain('summary');
      expect(reason).toContain('next');
      // explicitly do NOT complete
      expect(reason).toContain('not');
      expect(reason).toContain('complete');
    });

    // Oracle-mandated safety tests (beyond the plan's enumerated ACs)

    it('goal at cap with APPROVE but no evidence soft-stops not completes', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'APPROVE',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
        completion_evidence_paths: [], // APPROVE but NO evidence
      });

      const result = makeDecision(createContext());

      // M2: APPROVE without evidence at cap → budget_limited, NOT complete
      expect(result.decision).toBe('block');
      const after = await readGoalFile();
      expect(after.phase).toBe('budget_limited');
      expect(after.active).toBe(false);
    });

    it('goal suppresses baseline todo for terminal goal-state', async () => {
      // Terminal goal-state file (active:false, complete) still present on disk
      await writeGoal({
        active: false,
        phase: 'complete',
        objective_verdict: 'APPROVE',
        iteration: 5,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext({ incompleteTodoCount: 4 }));

      // M3: terminal goal-state owns lifecycle → yields, no todo-block
      expect(result).toEqual({ continue: true });
      expect(result.reason ?? '').not.toContain('<todo-continuation>');
    });

    // B2: a lingering/terminal goal-state must not strip an unrelated active
    // deep-interview's continuation loop.
    it('terminal goal-state does not suppress an active deep-interview', async () => {
      await writeGoal({
        active: false,
        phase: 'complete',
        objective_verdict: 'APPROVE',
        iteration: 5,
        max_iterations: 10,
        outcome: 'goal objective text',
      });
      await writeFile(
        join(omtDir, 'deep-interview-active-state-test-session.json'),
        JSON.stringify({ active: true, sessionId: 'test-session' })
      );

      const result = makeDecision(createContext({ lastAssistantMessage: 'no done token' }));

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<deep-interview-continuation>');
    });

    it('non-pursuing active goal-state does not suppress an active deep-interview', async () => {
      await writeGoal({
        active: true,
        phase: 'planning',
        objective_verdict: '',
        iteration: 0,
        max_iterations: 10,
        outcome: 'goal objective text',
      });
      await writeFile(
        join(omtDir, 'deep-interview-active-state-test-session.json'),
        JSON.stringify({ active: true, sessionId: 'test-session' })
      );

      const result = makeDecision(createContext({ lastAssistantMessage: 'no done token' }));

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<deep-interview-continuation>');
    });

    // B5: a non-array completion_evidence (corrupted state) is NOT valid evidence.
    it('complete-wins rejects non-array completion_evidence (B5)', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'APPROVE',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
        completion_evidence_paths: 'x', // non-array (corrupted)
      });

      const result = makeDecision(createContext());

      // Treated as no evidence → budget_limited soft-stop, NOT complete
      expect(result.decision).toBe('block');
      const after = await readGoalFile();
      expect(after.phase).toBe('budget_limited');
      expect(after.active).toBe(false);
    });

    it('complete-wins still fires on APPROVE + array evidence at cap', async () => {
      await writeGoal({
        active: true,
        phase: 'pursuing',
        objective_verdict: 'APPROVE',
        iteration: 10,
        max_iterations: 10,
        outcome: 'goal objective text',
        completion_evidence_paths: ['artifacts/report.md'],
      });

      const result = makeDecision(createContext());

      expect(result).toEqual({ continue: true });
      const after = await readGoalFile();
      expect(after.phase).toBe('complete');
      expect(after.active).toBe(false);
    });

    // Schema-guard regression tests

    it('malformed active goal-state does NOT suppress baseline-todo (fails schema guard)', async () => {
      // {active:true, phase:"pursuit"} fails the phase guard → readGoalStateRaw returns null
      // → goalRaw is null → goalSuppressesBaselineTodo stays false → todo branch fires.
      await writeGoal({
        active: true,
        phase: 'pursuit', // typo'd — not a valid GoalPhase
        // max_iterations intentionally omitted to also fail that guard
      });

      const result = makeDecision(createContext({ incompleteTodoCount: 3 }));

      // Baseline-todo continuation FIRES (not suppressed by malformed goal)
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<todo-continuation>');
    });

    it('VALID terminal goal-state (active:false, valid phase) still suppresses baseline-todo (M3 preserved)', async () => {
      // A well-formed terminal state passes the schema guard → readGoalStateRaw returns the
      // object → goalSuppressesBaselineTodo = true → baseline-todo does NOT fire (M3).
      await writeGoal({
        active: false,
        phase: 'complete',
        objective_verdict: 'APPROVE',
        iteration: 5,
        max_iterations: 10,
        outcome: 'goal objective text',
      });

      const result = makeDecision(createContext({ incompleteTodoCount: 4 }));

      // M3: terminal goal-state suppresses baseline-todo
      expect(result).toEqual({ continue: true });
      expect(result.reason ?? '').not.toContain('<todo-continuation>');
    });

    // B-4: a SUSTAINED updateGoalState write failure on the iteration++ block path
    // must not block the AI forever. The read path stays healthy (file readable) while
    // only the write fails, so the on-disk iteration never advances and the cap is
    // never reached. The block-count is reused as a write-failure escape.
    describe('write-failure escape on iteration++ block path', () => {
      it('escapes after MAX_BLOCK_COUNT turns when iteration write fails every turn, never completing', async () => {
        await writeGoal({
          active: true,
          phase: 'pursuing',
          objective_verdict: 'REQUEST_CHANGES', // not APPROVE → iteration++ block path
          iteration: 1,
          max_iterations: 100, // cap never reached
          outcome: 'goal objective text',
        });
        // Force updateGoalState's writeFileSync to throw ONLY for the goal-state file, so the
        // on-disk iteration never advances while readGoalStateRaw and the sibling block-count
        // writes stay healthy. A mocked writer is deterministic regardless of uid; chmod 0444
        // is silently bypassed by root (common in CI containers), letting the write succeed.
        const realWriteFileSync = fs.writeFileSync;
        const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(((path: any, ...rest: any[]) => {
          if (path === goalPath) throw new Error('simulated goal-state write failure');
          return (realWriteFileSync as any)(path, ...rest);
        }) as any);

        try {
          // MAX_BLOCK_COUNT = 5: turns 1..5 block (incrementing the stuck-counter),
          // turn 6 sees blockCount >= 5 and escapes.
          for (let i = 0; i < 5; i++) {
            const blocked = makeDecision(createContext());
            expect(blocked.decision).toBe('block');
          }

          const escaped = makeDecision(createContext());
          expect(escaped).toEqual({ continue: true });
        } finally {
          writeSpy.mockRestore();
        }

        // Never false-completed: phase stays pursuing, file untouched by the escape.
        const after = await readGoalFile();
        expect(after.phase).toBe('pursuing');
        expect(after.active).toBe(true);
        expect(after.iteration).toBe(1); // never advanced (write kept failing)
      });

      it('does NOT escape early when writes SUCCEED, no matter how many turns', async () => {
        await writeGoal({
          active: true,
          phase: 'pursuing',
          objective_verdict: 'REQUEST_CHANGES', // not APPROVE → iteration++ block path
          iteration: 1,
          max_iterations: 100, // cap never reached within the loop
          outcome: 'goal objective text',
        });

        // Run well past MAX_BLOCK_COUNT (5) — 7 turns. Writes succeed each turn, so the
        // stuck-counter is reset every turn and the escape NEVER fires.
        for (let i = 0; i < 7; i++) {
          const result = makeDecision(createContext());
          expect(result.decision).toBe('block');
        }

        // iteration advanced once per turn; goal still pursuing (no spurious escape/complete).
        const after = await readGoalFile();
        expect(after.iteration).toBe(8); // 1 + 7 turns
        expect(after.phase).toBe('pursuing');
        expect(after.active).toBe(true);
      });
    });
  });
});

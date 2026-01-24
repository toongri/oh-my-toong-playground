import { makeDecision, DecisionContext } from './decision.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('makeDecision', () => {
  const testDir = join(tmpdir(), 'persistent-mode-decision-test-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const sisyphusDir = join(projectRoot, '.claude', 'sisyphus');
  const stateDir = join(sisyphusDir, 'state');

  beforeAll(async () => {
    await mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up state files between tests
    await rm(sisyphusDir, { recursive: true, force: true });
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
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).toContain('ITERATION 2/10');
      expect(result.reason).toContain('Test task');
    });

    it('should increment iteration in ralph state when blocking', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      makeDecision(context);

      // Read state file and check iteration was incremented
      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(sisyphusDir, 'ralph-state-test-session.json'), 'utf8'));
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
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      const context = createContext();

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup ralph and ultrawork state when max iterations reached', async () => {
      const ralphState = {
        active: true,
        iteration: 10,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      const ultraworkState = {
        active: true,
        reinforcement_count: 5,
        original_prompt: 'Test ultrawork',
      };
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      const context = createContext();

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(sisyphusDir, 'ralph-state-test-session.json'))).toBe(false);
      expect(existsSync(join(sisyphusDir, 'ultrawork-state-test-session.json'))).toBe(false);
    });

    it('should allow stop when oracle approval is detected in transcript', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // Create transcript with oracle approval
      const transcriptPath = join(testDir, 'transcript.jsonl');
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const context = createContext({ transcriptPath });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup states when oracle approval detected', async () => {
      const ralphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify({ active: true }));

      const transcriptPath = join(testDir, 'transcript.jsonl');
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const context = createContext({ transcriptPath });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(sisyphusDir, 'ralph-state-test-session.json'))).toBe(false);
      expect(existsSync(join(sisyphusDir, 'ultrawork-state-test-session.json'))).toBe(false);
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
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

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
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify(ralphState));

      // Create transcript with oracle rejection
      const transcriptPath = join(testDir, 'rejection-transcript.jsonl');
      await writeFile(transcriptPath, 'Oracle rejected because: issue: Tests are failing');

      const context = createContext({ transcriptPath });

      makeDecision(context);

      // Check that feedback was captured
      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(sisyphusDir, 'ralph-state-test-session.json'), 'utf8'));
      expect(updatedState.oracle_feedback).toContain('Tests are failing');
    });
  });

  describe('Priority 2: Ultrawork Mode with incomplete todos', () => {
    it('should block and return ultrawork message when ultrawork is active and todos incomplete', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 0,
        original_prompt: 'Implement feature X',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      const context = createContext({ incompleteTodoCount: 3 });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ultrawork-persistence>');
      expect(result.reason).toContain('Reinforcement #1');
      expect(result.reason).toContain('3 incomplete todos remain');
      expect(result.reason).toContain('Implement feature X');
    });

    it('should increment reinforcement count when blocking', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 2,
        original_prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      const context = createContext({ incompleteTodoCount: 1 });

      makeDecision(context);

      const { readFileSync } = await import('fs');
      const updatedState = JSON.parse(readFileSync(join(sisyphusDir, 'ultrawork-state-test-session.json'), 'utf8'));
      expect(updatedState.reinforcement_count).toBe(3);
    });

    it('should not block ultrawork when no incomplete todos', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 2,
        original_prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      const context = createContext({ incompleteTodoCount: 0 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should allow stop after max continuation attempts (escape hatch)', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 5,
        original_prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      // Set attempt count to max and todo count to same value (so no reset)
      await writeFile(join(stateDir, 'todo-attempts-test-session'), '5');
      await writeFile(join(stateDir, 'todo-count-test-session'), '3');

      const context = createContext({ incompleteTodoCount: 3 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });

    it('should cleanup ultrawork state when escape hatch triggers', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 5,
        original_prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      // Set attempt count to max and todo count to same value (so no reset)
      await writeFile(join(stateDir, 'todo-attempts-test-session'), '5');
      await writeFile(join(stateDir, 'todo-count-test-session'), '3');

      const context = createContext({ incompleteTodoCount: 3 });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(sisyphusDir, 'ultrawork-state-test-session.json'))).toBe(false);
    });

    it('should cleanup ultrawork state when all todos completed', async () => {
      const ultraworkState = {
        active: true,
        reinforcement_count: 2,
        original_prompt: 'Test task',
      };
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify(ultraworkState));

      const context = createContext({ incompleteTodoCount: 0 });

      makeDecision(context);

      const { existsSync } = await import('fs');
      expect(existsSync(join(sisyphusDir, 'ultrawork-state-test-session.json'))).toBe(false);
    });
  });

  describe('Priority 3: Todo Continuation (baseline)', () => {
    it('should block and return todo message when incomplete todos exist', () => {
      const context = createContext({ incompleteTodoCount: 5 });

      const result = makeDecision(context);

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<todo-continuation>');
      expect(result.reason).toContain('5 remaining');
    });

    it('should increment attempts when blocking', async () => {
      const context = createContext({ incompleteTodoCount: 2 });

      makeDecision(context);

      const { readFileSync, existsSync } = await import('fs');
      const attemptFile = join(stateDir, 'todo-attempts-test-session');
      expect(existsSync(attemptFile)).toBe(true);
      expect(readFileSync(attemptFile, 'utf8')).toBe('1');
    });

    it('should allow stop after max continuation attempts', async () => {
      // Set attempt count to max and todo count to same value (so no reset)
      await writeFile(join(stateDir, 'todo-attempts-test-session'), '5');
      await writeFile(join(stateDir, 'todo-count-test-session'), '2');

      const context = createContext({ incompleteTodoCount: 2 });

      const result = makeDecision(context);

      expect(result).toEqual({ continue: true });
    });
  });

  describe('progress detection (attempt reset)', () => {
    it('should reset attempts when todo count changes', async () => {
      // Set previous count and attempts
      await writeFile(join(stateDir, 'todo-count-test-session'), '5');
      await writeFile(join(stateDir, 'todo-attempts-test-session'), '3');

      // New count is different
      const context = createContext({ incompleteTodoCount: 4 });

      makeDecision(context);

      const { readFileSync, existsSync } = await import('fs');
      // Attempts should be reset (deleted), then incremented to 1
      expect(readFileSync(join(stateDir, 'todo-attempts-test-session'), 'utf8')).toBe('1');
      // New count should be saved
      expect(readFileSync(join(stateDir, 'todo-count-test-session'), 'utf8')).toBe('4');
    });

    it('should not reset attempts when todo count is unchanged', async () => {
      // Set previous count and attempts
      await writeFile(join(stateDir, 'todo-count-test-session'), '5');
      await writeFile(join(stateDir, 'todo-attempts-test-session'), '3');

      const context = createContext({ incompleteTodoCount: 5 }); // Same count

      makeDecision(context);

      const { readFileSync } = await import('fs');
      // Attempts should be incremented from 3 to 4
      expect(readFileSync(join(stateDir, 'todo-attempts-test-session'), 'utf8')).toBe('4');
    });
  });

  describe('priority ordering', () => {
    it('should check ralph before ultrawork', async () => {
      // Both ralph and ultrawork active
      await writeFile(join(sisyphusDir, 'ralph-state-test-session.json'), JSON.stringify({
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'Ralph task',
      }));
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify({
        active: true,
        reinforcement_count: 0,
        original_prompt: 'Ultrawork task',
      }));

      const context = createContext({ incompleteTodoCount: 5 });

      const result = makeDecision(context);

      // Should block with ralph message (priority 1)
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ralph-loop-continuation>');
      expect(result.reason).not.toContain('<ultrawork-persistence>');
    });

    it('should check ultrawork before baseline todos', async () => {
      // Ultrawork active with incomplete todos
      await writeFile(join(sisyphusDir, 'ultrawork-state-test-session.json'), JSON.stringify({
        active: true,
        reinforcement_count: 0,
        original_prompt: 'Ultrawork task',
      }));

      const context = createContext({ incompleteTodoCount: 5 });

      const result = makeDecision(context);

      // Should block with ultrawork message (priority 2)
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('<ultrawork-persistence>');
      expect(result.reason).not.toContain('<todo-continuation>');
    });
  });
});

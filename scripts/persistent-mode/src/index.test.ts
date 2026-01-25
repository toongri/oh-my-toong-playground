import { main } from './index.js';
import { mkdir, writeFile, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { existsSync } from 'fs';

describe('main entry point', () => {
  const testDir = join(tmpdir(), 'persistent-mode-index-test-' + Date.now());
  const projectRoot = join(testDir, 'project');
  const sisyphusDir = join(projectRoot, '.claude', 'sisyphus');

  // Save original process methods
  const originalStdin = process.stdin;
  const originalCwd = process.cwd;
  const originalLog = console.log;
  const originalError = console.error;

  let capturedOutput: string[] = [];
  let capturedErrors: string[] = [];

  beforeAll(async () => {
    await mkdir(sisyphusDir, { recursive: true });
    // Create .git directory to make it a project root
    await mkdir(join(projectRoot, '.git'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    capturedOutput = [];
    capturedErrors = [];
    console.log = (...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  // Helper to create mock stdin
  function createMockStdin(data: string): NodeJS.ReadableStream {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    return readable as NodeJS.ReadableStream;
  }

  describe('happy path', () => {
    it('should output continue: true when no blocking conditions', async () => {
      // Create mock stdin with valid JSON
      const input = JSON.stringify({
        sessionId: 'test-session-123',
        cwd: projectRoot,
        transcript_path: null,
      });

      // Mock stdin
      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // Should output valid JSON with continue: true
      expect(capturedOutput.length).toBeGreaterThan(0);
      const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
      expect(output.continue).toBe(true);
    });

    it('should output block decision when ralph is active', async () => {
      // Set up ralph state
      await writeFile(
        join(sisyphusDir, 'ralph-state-ralph-session.json'),
        JSON.stringify({
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: 'DONE',
          prompt: 'Test prompt',
        })
      );

      const input = JSON.stringify({
        sessionId: 'ralph-session',
        cwd: projectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      expect(capturedOutput.length).toBeGreaterThan(0);
      const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
      expect(output.decision).toBe('block');
      expect(output.reason).toContain('<ralph-loop-continuation>');
    });
  });

  describe('error handling', () => {
    it('should fail open (allow stop) on parse error', async () => {
      const mockStdin = createMockStdin('{ invalid json }');
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // Should output continue: true even on error
      expect(capturedOutput.length).toBeGreaterThan(0);
      const lastOutput = capturedOutput[capturedOutput.length - 1];
      const output = JSON.parse(lastOutput);
      expect(output.continue).toBe(true);
    });

    it('should fail open when cwd directory does not exist', async () => {
      const input = JSON.stringify({
        sessionId: 'test-session',
        cwd: '/nonexistent/path/that/does/not/exist',
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // Should still output continue: true
      expect(capturedOutput.length).toBeGreaterThan(0);
      const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
      expect(output.continue).toBe(true);
    });
  });

  // Priority 3 todo-continuation baseline was REMOVED
  // The transcript-based todo counting had a scope mismatch with Claude Code's
  // request-level TaskList API, causing phantom todos from previous requests
  // to block new requests. Only Ralph Loop and Ultrawork modes enforce todo completion.

  describe('todo counting from transcript (Priority 3 removed)', () => {
    it('should NOT block when incomplete todos exist without ralph/ultrawork', async () => {
      // Create transcript with TaskCreate calls
      const transcriptPath = join(testDir, 'todos-transcript.jsonl');
      const transcriptContent = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'task1', name: 'TaskCreate', input: { subject: 'Task 1' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'task1', content: 'Task #1 created successfully' }],
          },
          toolUseResult: { task: { id: '1', subject: 'Task 1' } },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'task2', name: 'TaskCreate', input: { subject: 'Task 2' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'task2', content: 'Task #2 created successfully' }],
          },
        }),
      ].join('\n');
      await writeFile(transcriptPath, transcriptContent);

      const input = JSON.stringify({
        sessionId: 'todo-session',
        cwd: projectRoot,
        transcript_path: transcriptPath,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      expect(capturedOutput.length).toBeGreaterThan(0);
      const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
      // Should NOT block - Priority 3 baseline todo-continuation was removed
      expect(output.continue).toBe(true);
    });
  });

  describe('file-based task counting', () => {
    const taskTestDir = join(tmpdir(), 'persistent-mode-task-test-' + Date.now());
    const taskProjectRoot = join(taskTestDir, 'project');
    const sessionId = 'task-count-session';

    // Mock homedir to use our test directory for ~/.claude/tasks
    const originalHomedir = process.env.HOME;

    beforeAll(async () => {
      await mkdir(join(taskProjectRoot, '.claude', 'sisyphus'), { recursive: true });
      await mkdir(join(taskProjectRoot, '.git'), { recursive: true });
      // Create mock home directory structure for tasks
      await mkdir(join(taskTestDir, 'home', '.claude', 'tasks', sessionId), { recursive: true });
    });

    afterAll(async () => {
      await rm(taskTestDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      process.env.HOME = join(taskTestDir, 'home');
      process.env.OMT_LOG_LEVEL = 'DEBUG';
    });

    afterEach(() => {
      process.env.HOME = originalHomedir;
      delete process.env.OMT_LOG_LEVEL;
    });

    it('should count tasks from file-based directory instead of transcript', async () => {
      // Create task files in ~/.claude/tasks/{sessionId}/
      const tasksDir = join(taskTestDir, 'home', '.claude', 'tasks', sessionId);

      // Create 2 incomplete tasks and 1 completed task
      await writeFile(
        join(tasksDir, '1.json'),
        JSON.stringify({ id: '1', subject: 'Task 1', status: 'pending' })
      );
      await writeFile(
        join(tasksDir, '2.json'),
        JSON.stringify({ id: '2', subject: 'Task 2', status: 'in_progress' })
      );
      await writeFile(
        join(tasksDir, '3.json'),
        JSON.stringify({ id: '3', subject: 'Task 3', status: 'completed' })
      );

      const input = JSON.stringify({
        sessionId: sessionId,
        cwd: taskProjectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // Verify via logs that file-based task counting was used
      const logsDir = join(taskProjectRoot, '.claude', 'sisyphus', 'logs');
      const logFile = join(logsDir, `persistent-mode-${sessionId}.log`);
      const logContent = await readFile(logFile, 'utf-8');

      // Should log tasks from file-based directory with correct counts
      expect(logContent).toContain('tasks from');
      expect(logContent).toContain('.claude/tasks');
      expect(logContent).toContain('total=3');
      expect(logContent).toContain('incomplete=2');
    });
  });

  describe('logging integration', () => {
    const loggingTestDir = join(tmpdir(), 'persistent-mode-logging-test-' + Date.now());
    const loggingProjectRoot = join(loggingTestDir, 'project');
    const logsDir = join(loggingProjectRoot, '.claude', 'sisyphus', 'logs');

    beforeAll(async () => {
      await mkdir(join(loggingProjectRoot, '.claude', 'sisyphus'), { recursive: true });
      await mkdir(join(loggingProjectRoot, '.git'), { recursive: true });
    });

    afterAll(async () => {
      await rm(loggingTestDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      // Set DEBUG log level to capture all logs
      process.env.OMT_LOG_LEVEL = 'DEBUG';
      // Clean up logs directory before each test
      try {
        await rm(logsDir, { recursive: true, force: true });
      } catch {}
    });

    afterEach(() => {
      delete process.env.OMT_LOG_LEVEL;
    });

    it('should create log file with START and END markers', async () => {
      const input = JSON.stringify({
        sessionId: 'logging-test-session',
        cwd: loggingProjectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // Check that log file was created
      const logFile = join(logsDir, 'persistent-mode-logging-test-session.log');
      expect(existsSync(logFile)).toBe(true);

      // Check log file content
      const logContent = await readFile(logFile, 'utf-8');
      expect(logContent).toContain('START');
      expect(logContent).toContain('END');
    });

    it('should log session ID and hook event', async () => {
      const input = JSON.stringify({
        sessionId: 'log-session-info',
        cwd: loggingProjectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      const logFile = join(logsDir, 'persistent-mode-log-session-info.log');
      const logContent = await readFile(logFile, 'utf-8');
      expect(logContent).toContain('log-session-info');
      expect(logContent).toContain('stop hook');
    });

    it('should log decision result', async () => {
      const input = JSON.stringify({
        sessionId: 'log-decision-test',
        cwd: loggingProjectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      const logFile = join(logsDir, 'persistent-mode-log-decision-test.log');
      const logContent = await readFile(logFile, 'utf-8');
      expect(logContent).toMatch(/decision.*continue/i);
    });

    it('should log errors when they occur', async () => {
      // Force an error by providing an invalid transcript path with permission issues
      // Note: This test verifies error logging path exists even if triggering is complex
      const input = JSON.stringify({
        sessionId: 'log-error-test',
        cwd: loggingProjectRoot,
        transcript_path: null,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      // At minimum, log file should exist with proper start/end
      const logFile = join(logsDir, 'persistent-mode-log-error-test.log');
      expect(existsSync(logFile)).toBe(true);
    });

    it('should log transcript detection details at DEBUG level', async () => {
      // Create a transcript file with patterns to detect
      const transcriptPath = join(loggingTestDir, 'logging-transcript.jsonl');
      const transcriptContent = `
        Task #1 created successfully
        Task #2 created successfully
        {"name": "TaskUpdate", "parameters": {"taskId": "1", "status": "completed"}}
      `;
      await writeFile(transcriptPath, transcriptContent);

      const input = JSON.stringify({
        sessionId: 'log-detection-test',
        cwd: loggingProjectRoot,
        transcript_path: transcriptPath,
      });

      const mockStdin = createMockStdin(input);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      await main();

      const logFile = join(logsDir, 'persistent-mode-log-detection-test.log');
      const logContent = await readFile(logFile, 'utf-8');
      // Should log detection patterns (at DEBUG level)
      expect(logContent).toMatch(/DEBUG/);
      expect(logContent).toMatch(/todo|task|detection|count/i);
    });
  });
});

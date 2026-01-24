import { main } from './index.js';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

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

  describe('todo counting from transcript', () => {
    it('should count incomplete todos and block when present', async () => {
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
            content: [{ type: 'tool_result', tool_use_id: 'task1', content: 'Task #1 created' }],
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
            content: [{ type: 'tool_result', tool_use_id: 'task2', content: 'Task #2 created' }],
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
      // Should block because of incomplete todos
      expect(output.decision).toBe('block');
      expect(output.reason).toContain('remaining');
    });
  });
});

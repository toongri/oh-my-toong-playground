import { readStdin, parseInput } from './stdin.js';
import type { HookInput, ParsedInput } from './types.js';
import { PassThrough } from 'stream';

// Save original stdin
const originalStdin = process.stdin;

function mockStdin(data: string): void {
  const mockStream = new PassThrough();
  Object.defineProperty(process, 'stdin', {
    value: mockStream,
    writable: true,
    configurable: true,
  });
  // Write data and end the stream
  mockStream.end(data);
}

function restoreStdin(): void {
  Object.defineProperty(process, 'stdin', {
    value: originalStdin,
    writable: true,
    configurable: true,
  });
}

describe('readStdin', () => {
  afterEach(() => {
    restoreStdin();
  });

  it('should read stdin data as string', async () => {
    const input = '{"sessionId": "test-session", "cwd": "/test/dir"}';
    mockStdin(input);

    const result = await readStdin();

    expect(result).toBe(input);
  });

  it('should return empty string for empty input', async () => {
    mockStdin('');

    const result = await readStdin();

    expect(result).toBe('');
  });

  it('should handle multi-chunk input', async () => {
    const mockStream = new PassThrough();
    Object.defineProperty(process, 'stdin', {
      value: mockStream,
      writable: true,
      configurable: true,
    });

    // Simulate chunked input
    mockStream.write('{"session');
    mockStream.write('Id": "chunked"}');
    mockStream.end();

    const result = await readStdin();

    expect(result).toBe('{"sessionId": "chunked"}');
  });
});

describe('parseInput', () => {
  it('should parse valid JSON with sessionId', () => {
    const input: HookInput = {
      sessionId: 'session-123',
      cwd: '/test/dir',
      transcript_path: '/path/to/transcript.jsonl',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.sessionId).toBe('session-123');
    expect(result.directory).toBe('/test/dir');
    expect(result.transcriptPath).toBe('/path/to/transcript.jsonl');
  });

  it('should support snake_case session_id', () => {
    const input: HookInput = {
      session_id: 'session-456',
      cwd: '/test/dir',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.sessionId).toBe('session-456');
  });

  it('should prefer sessionId over session_id', () => {
    const input: HookInput = {
      sessionId: 'preferred',
      session_id: 'fallback',
      cwd: '/test/dir',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.sessionId).toBe('preferred');
  });

  it('should use default sessionId when not provided', () => {
    const input: HookInput = {
      cwd: '/test/dir',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.sessionId).toBe('default');
  });

  it('should use process.cwd() when cwd not provided', () => {
    const input: HookInput = {
      sessionId: 'session-123',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.directory).toBe(process.cwd());
  });

  it('should set transcriptPath to null when not provided', () => {
    const input: HookInput = {
      sessionId: 'session-123',
      cwd: '/test/dir',
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.transcriptPath).toBeNull();
  });

  it('should handle invalid JSON gracefully with defaults', () => {
    const result = parseInput('{ invalid json }');

    expect(result.sessionId).toBe('default');
    expect(result.directory).toBe(process.cwd());
    expect(result.transcriptPath).toBeNull();
  });

  it('should handle empty string with defaults', () => {
    const result = parseInput('');

    expect(result.sessionId).toBe('default');
    expect(result.directory).toBe(process.cwd());
    expect(result.transcriptPath).toBeNull();
  });
});

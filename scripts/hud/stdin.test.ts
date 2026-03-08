import { describe, it, expect, afterEach } from 'bun:test';
import { readStdin } from './stdin.ts';
import type { StdinInput } from './types.ts';
import { Readable, PassThrough } from 'stream';

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

  it('should parse valid JSON input', async () => {
    const input: StdinInput = {
      hook_event_name: 'test_hook',
      session_id: 'session-123',
      transcript_path: '/path/to/transcript.jsonl',
      cwd: '/current/working/dir',
      context_window: {
        used_percentage: 42,
        total_input_tokens: 5000,
        context_window_size: 200000,
      },
    };

    mockStdin(JSON.stringify(input));

    const result = await readStdin();

    expect(result).not.toBeNull();
    expect(result?.hook_event_name).toBe('test_hook');
    expect(result?.session_id).toBe('session-123');
    expect(result?.context_window.used_percentage).toBe(42);
  });

  it('should parse input with optional workspace field', async () => {
    const input: StdinInput = {
      hook_event_name: 'test_hook',
      session_id: 'session-456',
      transcript_path: '/path/to/transcript.jsonl',
      cwd: '/current/working/dir',
      workspace: { project_dir: '/project/root' },
      context_window: {
        used_percentage: 75,
        total_input_tokens: 10000,
        context_window_size: 200000,
      },
    };

    mockStdin(JSON.stringify(input));

    const result = await readStdin();

    expect(result).not.toBeNull();
    expect(result?.workspace?.project_dir).toBe('/project/root');
  });

  it('should return null for invalid JSON', async () => {
    mockStdin('{ invalid json }');

    const result = await readStdin();

    expect(result).toBeNull();
  });

  it('should return null for empty input', async () => {
    mockStdin('');

    const result = await readStdin();

    expect(result).toBeNull();
  });
});

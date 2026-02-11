import { parseInput } from './stdin.js';

describe('parseInput', () => {
  it('parses snake_case field names', () => {
    const raw = JSON.stringify({
      tool_name: 'Bash',
      tool_response: 'output text',
      session_id: 'sess-123',
      cwd: '/home/user',
    });

    const result = parseInput(raw);

    expect(result.toolName).toBe('Bash');
    expect(result.toolOutput).toBe('output text');
    expect(result.sessionId).toBe('sess-123');
    expect(result.cwd).toBe('/home/user');
  });

  it('parses camelCase field names', () => {
    const raw = JSON.stringify({
      toolName: 'Edit',
      toolOutput: 'edit result',
      sessionId: 'sess-456',
      directory: '/tmp',
    });

    const result = parseInput(raw);

    expect(result.toolName).toBe('Edit');
    expect(result.toolOutput).toBe('edit result');
    expect(result.sessionId).toBe('sess-456');
    expect(result.cwd).toBe('/tmp');
  });

  it('returns defaults for missing fields', () => {
    const raw = JSON.stringify({});

    const result = parseInput(raw);

    expect(result.toolName).toBe('');
    expect(result.toolOutput).toBe('');
    expect(result.sessionId).toBe('unknown');
    expect(result.cwd).toBe('');
  });

  it('returns defaults for invalid JSON', () => {
    const raw = 'not json at all';

    const result = parseInput(raw);

    expect(result.toolName).toBe('');
    expect(result.toolOutput).toBe('');
    expect(result.sessionId).toBe('unknown');
    expect(result.cwd).toBe('');
  });

  it('prefers snake_case over camelCase when both present', () => {
    const raw = JSON.stringify({
      tool_name: 'Bash',
      toolName: 'Edit',
      tool_response: 'snake output',
      toolOutput: 'camel output',
    });

    const result = parseInput(raw);

    expect(result.toolName).toBe('Bash');
    expect(result.toolOutput).toBe('snake output');
  });
});

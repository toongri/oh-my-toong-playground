import { buildResponse } from './index.js';

describe('buildResponse', () => {
  it('returns hookSpecificOutput with additionalContext when message is generated', () => {
    const result = buildResponse('Bash', 'error: compilation failed', 1);

    expect(result).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Command failed. Please investigate the error and fix before continuing.',
      },
    });
  });

  it('returns only continue:true when no message is generated', () => {
    const result = buildResponse('Bash', 'Build succeeded. All tests passed.', 1);

    expect(result).toEqual({ continue: true });
  });

  it('returns only continue:true for unknown tools', () => {
    const result = buildResponse('UnknownTool', 'some output', 1);

    expect(result).toEqual({ continue: true });
  });

  it('includes message for Edit failures', () => {
    const result = buildResponse('Edit', 'error writing file', 1);

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toBe(
      'Edit operation failed. Verify file exists and content matches exactly.'
    );
  });

  it('includes message for Read with high count', () => {
    const result = buildResponse('Read', 'file contents', 15);

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toBe(
      'Extensive reading (15 files). Consider using Grep for pattern searches.'
    );
  });

  it('does not include hookSpecificOutput when message is empty', () => {
    const result = buildResponse('Read', 'file contents', 5);

    expect(result).toEqual({ continue: true });
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

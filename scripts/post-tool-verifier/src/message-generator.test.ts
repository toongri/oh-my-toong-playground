import { generateMessage } from './message-generator.js';

describe('generateMessage', () => {
  describe('Bash tool', () => {
    it('returns failure message when output contains error patterns', () => {
      const message = generateMessage('Bash', 'error: something broke', 'sess', 1);
      expect(message).toBe('Command failed. Please investigate the error and fix before continuing.');
    });

    it('returns failure message for "fatal:" pattern', () => {
      const message = generateMessage('Bash', 'fatal: not a git repository', 'sess', 1);
      expect(message).toBe('Command failed. Please investigate the error and fix before continuing.');
    });

    it('returns empty string for successful bash output', () => {
      const message = generateMessage('Bash', 'Build succeeded. All tests passed.', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('Edit tool', () => {
    it('returns failure message when output contains error', () => {
      const message = generateMessage('Edit', 'error: file not writable', 'sess', 1);
      expect(message).toBe('Edit operation failed. Verify file exists and content matches exactly.');
    });

    it('returns empty string for successful edit', () => {
      const message = generateMessage('Edit', 'File updated successfully', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('Write tool', () => {
    it('returns failure message when output contains permission denied', () => {
      const message = generateMessage('Write', 'Permission denied: /root/file.txt', 'sess', 1);
      expect(message).toBe('Write operation failed. Check file permissions and directory existence.');
    });

    it('returns empty string for successful write', () => {
      const message = generateMessage('Write', 'File written successfully', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('TodoWrite tool', () => {
    it('returns message when todo is created', () => {
      const message = generateMessage('TodoWrite', 'Todo item created successfully', 'sess', 1);
      expect(message).toBe('Todo list updated. Proceed with next task on the list.');
    });

    it('returns message when todo is added', () => {
      const message = generateMessage('TodoWrite', 'Task added to list', 'sess', 1);
      expect(message).toBe('Todo list updated. Proceed with next task on the list.');
    });

    it('returns message when todo is completed', () => {
      const message = generateMessage('TodoWrite', 'Task marked as completed', 'sess', 1);
      expect(message).toBe('Task marked complete. Continue with remaining todos.');
    });

    it('returns message when todo is done', () => {
      const message = generateMessage('TodoWrite', 'Item done', 'sess', 1);
      expect(message).toBe('Task marked complete. Continue with remaining todos.');
    });

    it('returns message when todo is in_progress', () => {
      const message = generateMessage('TodoWrite', 'Status set to in_progress', 'sess', 1);
      expect(message).toBe('Task marked in progress. Focus on completing this task.');
    });
  });

  describe('Read tool', () => {
    it('returns warning when read count exceeds 10', () => {
      const message = generateMessage('Read', 'file contents here', 'sess', 11);
      expect(message).toBe('Extensive reading (11 files). Consider using Grep for pattern searches.');
    });

    it('returns empty string when read count is 10 or less', () => {
      const message = generateMessage('Read', 'file contents here', 'sess', 10);
      expect(message).toBe('');
    });
  });

  describe('Grep tool', () => {
    it('returns message when no matches found (0)', () => {
      const message = generateMessage('Grep', '0', 'sess', 1);
      expect(message).toBe('No matches found. Verify pattern syntax or try broader search.');
    });

    it('returns message when output says no matches', () => {
      const message = generateMessage('Grep', 'no matches', 'sess', 1);
      expect(message).toBe('No matches found. Verify pattern syntax or try broader search.');
    });

    it('returns empty string when matches exist', () => {
      const message = generateMessage('Grep', 'src/index.ts:5: const foo = bar;', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('Glob tool', () => {
    it('returns message when output is empty', () => {
      const message = generateMessage('Glob', '', 'sess', 1);
      expect(message).toBe('No files matched pattern. Verify glob syntax and directory.');
    });

    it('returns message when output says no files', () => {
      const message = generateMessage('Glob', 'no files found', 'sess', 1);
      expect(message).toBe('No files matched pattern. Verify glob syntax and directory.');
    });

    it('returns empty string when files are found', () => {
      const message = generateMessage('Glob', 'src/index.ts\nsrc/main.ts', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('unknown tools', () => {
    it('returns empty string for unknown tool names', () => {
      const message = generateMessage('UnknownTool', 'some output', 'sess', 1);
      expect(message).toBe('');
    });
  });

  describe('Task tool is NOT handled', () => {
    it('returns empty string for Task tool (TaskOutput logic removed)', () => {
      const message = generateMessage('Task', 'task started running', 'sess', 6);
      expect(message).toBe('');
    });
  });
});

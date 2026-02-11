import { detectBashFailure, detectWriteFailure } from './detectors.js';

export function generateMessage(
  toolName: string,
  toolOutput: string,
  _sessionId: string,
  toolCount: number,
): string {
  if (toolName === 'Bash') {
    if (detectBashFailure(toolOutput)) {
      return 'Command failed. Please investigate the error and fix before continuing.';
    }
  } else if (toolName === 'Edit') {
    if (detectWriteFailure(toolOutput)) {
      return 'Edit operation failed. Verify file exists and content matches exactly.';
    }
  } else if (toolName === 'Write') {
    if (detectWriteFailure(toolOutput)) {
      return 'Write operation failed. Check file permissions and directory existence.';
    }
  } else if (toolName === 'TodoWrite') {
    const outputLower = toolOutput.toLowerCase();
    if (/created|added/.test(outputLower)) {
      return 'Todo list updated. Proceed with next task on the list.';
    } else if (/completed|done/.test(outputLower)) {
      return 'Task marked complete. Continue with remaining todos.';
    } else if (/in_progress/.test(outputLower)) {
      return 'Task marked in progress. Focus on completing this task.';
    }
  } else if (toolName === 'Read') {
    if (toolCount > 10) {
      return `Extensive reading (${toolCount} files). Consider using Grep for pattern searches.`;
    }
  } else if (toolName === 'Grep') {
    if (/^0$|no matches/.test(toolOutput)) {
      return 'No matches found. Verify pattern syntax or try broader search.';
    }
  } else if (toolName === 'Glob') {
    if (!toolOutput.trim() || /no files/.test(toolOutput.toLowerCase())) {
      return 'No files matched pattern. Verify glob syntax and directory.';
    }
  }

  return '';
}

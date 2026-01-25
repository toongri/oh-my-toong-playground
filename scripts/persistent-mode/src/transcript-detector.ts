import { TranscriptDetection } from './types.js';
import { readFileOrNull } from './utils.js';
import { logDebug } from '../../lib/dist/logging.js';

// Pattern matchers
const PROMISE_PATTERN = /<promise>\s*DONE\s*<\/promise>/i;
const ORACLE_APPROVED_PATTERN = /<oracle-approved>.*VERIFIED_COMPLETE.*<\/oracle-approved>/i;
const ORACLE_REJECTION_PATTERNS = [
  /oracle.*rejected/i,
  /verification.*failed/i,
  /issues?\s*found/i,
  /not\s+complete/i
];
const FEEDBACK_PATTERN = /(issue|problem|reason):\s*([^\n]+)/gi;

// TaskCreate/TaskUpdate patterns for todo counting
const TASK_CREATE_PATTERN = /"name":\s*"TaskCreate"[\s\S]*?"subject":\s*"([^"]+)"/g;
const TASK_UPDATE_PATTERN = /"name":\s*"TaskUpdate"[\s\S]*?"taskId":\s*"(\d+)"[\s\S]*?"status":\s*"([^"]+)"/g;

export function detectCompletionPromise(transcriptPath: string | null): boolean {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  const detected = PROMISE_PATTERN.test(content);
  if (detected) {
    logDebug('detected completion promise <promise>DONE</promise>');
  }
  return detected;
}

export function detectOracleApproval(transcriptPath: string | null): boolean {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  const detected = ORACLE_APPROVED_PATTERN.test(content);
  if (detected) {
    logDebug('detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved>');
  }
  return detected;
}

export function detectOracleRejection(transcriptPath: string | null): string | null {
  if (!transcriptPath) return null;
  const content = readFileOrNull(transcriptPath);
  if (!content) return null;

  // Check for rejection indicators
  const hasRejection = ORACLE_REJECTION_PATTERNS.some(pattern => pattern.test(content));
  if (!hasRejection) return null;

  logDebug('detected oracle rejection pattern');

  // Extract feedback
  const feedbackMatches: string[] = [];
  let match;
  while ((match = FEEDBACK_PATTERN.exec(content)) !== null) {
    feedbackMatches.push(match[2].trim());
    if (feedbackMatches.length >= 5) break;
  }

  if (feedbackMatches.length > 0) {
    logDebug(`extracted rejection feedback: ${feedbackMatches.join(', ')}`);
  }

  return feedbackMatches.length > 0 ? feedbackMatches.join(' ') : '';
}

export function countIncompleteTodos(transcriptPath: string | null, originalPrompt?: string): number {
  if (!transcriptPath) return 0;
  let content = readFileOrNull(transcriptPath);
  if (!content) return 0;

  // If originalPrompt is provided, find its last occurrence and only parse content after that
  if (originalPrompt) {
    const lastIndex = content.lastIndexOf(originalPrompt);
    if (lastIndex !== -1) {
      content = content.slice(lastIndex);
      logDebug(`filtering content from originalPrompt position ${lastIndex}`);
    } else {
      logDebug(`originalPrompt not found in transcript, using full content`);
    }
  }

  // Track todos by ID
  const todos = new Map<string, string>(); // id -> status

  // Parse TaskCreate results to get actual task IDs
  // Look for "Task #N created successfully" pattern in tool results
  const createResultPattern = /Task #(\d+) created successfully/g;
  let createMatch;
  while ((createMatch = createResultPattern.exec(content)) !== null) {
    const [, taskId] = createMatch;
    // TaskCreate always creates pending tasks
    todos.set(taskId, 'pending');
  }

  if (todos.size > 0) {
    logDebug(`detected ${todos.size} TaskCreate result(s)`);
  }

  // Parse TaskUpdate calls to update status
  // Look for patterns like: TaskUpdate with taskId and status
  const updatePattern = /"name":\s*"TaskUpdate"[\s\S]*?"taskId":\s*"(\d+)"[\s\S]*?"status":\s*"([^"]+)"/g;
  let updateMatch;
  let updateCount = 0;
  while ((updateMatch = updatePattern.exec(content)) !== null) {
    const [, taskId, status] = updateMatch;
    // Update task status if we know about this task
    if (todos.has(taskId)) {
      todos.set(taskId, status);
      updateCount++;
    }
  }

  if (updateCount > 0) {
    logDebug(`detected ${updateCount} TaskUpdate(s) affecting tracked tasks`);
  }

  // Count incomplete (pending or in_progress)
  let incomplete = 0;
  for (const status of todos.values()) {
    if (status === 'pending' || status === 'in_progress') {
      incomplete++;
    }
  }

  logDebug(`todo count: ${todos.size} total, ${incomplete} incomplete`);

  return incomplete;
}

export function analyzeTranscript(transcriptPath: string | null): TranscriptDetection {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath),
    hasOracleApproval: detectOracleApproval(transcriptPath),
    oracleRejectionFeedback: detectOracleRejection(transcriptPath),
    incompleteTodoCount: countIncompleteTodos(transcriptPath)
  };
}

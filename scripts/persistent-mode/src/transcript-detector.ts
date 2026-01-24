import { TranscriptDetection } from './types.js';
import { readFileOrNull } from './utils.js';

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
  return PROMISE_PATTERN.test(content);
}

export function detectOracleApproval(transcriptPath: string | null): boolean {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  return ORACLE_APPROVED_PATTERN.test(content);
}

export function detectOracleRejection(transcriptPath: string | null): string | null {
  if (!transcriptPath) return null;
  const content = readFileOrNull(transcriptPath);
  if (!content) return null;

  // Check for rejection indicators
  const hasRejection = ORACLE_REJECTION_PATTERNS.some(pattern => pattern.test(content));
  if (!hasRejection) return null;

  // Extract feedback
  const feedbackMatches: string[] = [];
  let match;
  while ((match = FEEDBACK_PATTERN.exec(content)) !== null) {
    feedbackMatches.push(match[2].trim());
    if (feedbackMatches.length >= 5) break;
  }

  return feedbackMatches.length > 0 ? feedbackMatches.join(' ') : '';
}

export function countIncompleteTodos(transcriptPath: string | null): number {
  if (!transcriptPath) return 0;
  const content = readFileOrNull(transcriptPath);
  if (!content) return 0;

  // Track todos by ID
  const todos = new Map<string, string>(); // id -> status
  let autoId = 0;

  // Parse TaskCreate calls
  const createPattern = /"name":\s*"TaskCreate"[\s\S]*?"subject":\s*"[^"]*"/g;
  const creates = content.match(createPattern) || [];
  for (const _ of creates) {
    // TaskCreate always creates pending tasks
    todos.set(`auto-${autoId++}`, 'pending');
  }

  // Parse TaskUpdate calls to update status
  // Look for patterns like: TaskUpdate with taskId and status
  const updatePattern = /"name":\s*"TaskUpdate"[\s\S]*?"taskId":\s*"(\d+)"[\s\S]*?"status":\s*"([^"]+)"/g;
  let updateMatch;
  while ((updateMatch = updatePattern.exec(content)) !== null) {
    const [, taskId, status] = updateMatch;
    // Find the task and update its status
    // Since we don't have exact ID mapping, we'll use the taskId directly
    todos.set(taskId, status);
  }

  // Count incomplete (pending or in_progress)
  let incomplete = 0;
  for (const status of todos.values()) {
    if (status === 'pending' || status === 'in_progress') {
      incomplete++;
    }
  }

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

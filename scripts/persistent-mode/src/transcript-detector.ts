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

export function analyzeTranscript(transcriptPath: string | null): TranscriptDetection {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath),
    hasOracleApproval: detectOracleApproval(transcriptPath),
    oracleRejectionFeedback: detectOracleRejection(transcriptPath),
    incompleteTodoCount: 0  // Deprecated: now using file-based task counting
  };
}

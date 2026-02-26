import { TranscriptDetection, RalphState } from './types.ts';
import { readFileOrNull } from './utils.ts';
import { logDebug } from '../../lib/logging.ts';

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

export function detectOracleApproval(transcriptPath: string | null, startedAt?: string): boolean {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;

  // If no started_at, fall back to full content scan (backward compat)
  if (!startedAt) {
    const detected = ORACLE_APPROVED_PATTERN.test(content);
    if (detected) {
      logDebug('detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved>');
    }
    return detected;
  }

  // JSONL-aware filtering: only check lines after started_at
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: { timestamp?: string };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // Skip unparseable lines
    }

    // Skip lines without timestamp or before started_at
    if (!entry.timestamp || entry.timestamp < startedAt) continue;

    if (ORACLE_APPROVED_PATTERN.test(trimmed)) {
      logDebug('detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved> (after started_at)');
      return true;
    }
  }

  return false;
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

export function analyzeTranscript(transcriptPath: string | null, ralphState?: RalphState | null): TranscriptDetection {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath),
    hasOracleApproval: detectOracleApproval(transcriptPath, ralphState?.started_at),
    oracleRejectionFeedback: detectOracleRejection(transcriptPath),
    incompleteTodoCount: 0  // Deprecated: now using file-based task counting
  };
}

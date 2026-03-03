import { TranscriptDetection, RalphState } from './types.ts';
import { readFileOrNull } from './utils.ts';
import { logDebug } from '../../lib/logging.ts';

// Pattern matchers
const PROMISE_PATTERN = /<promise>\s*DONE\s*<\/promise>/i;
const ORACLE_APPROVED_PATTERN = /<oracle-approved>.*VERIFIED_COMPLETE.*<\/oracle-approved>/i;

export function detectCompletionPromise(transcriptPath: string | null, startedAt?: string): boolean {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;

  // If no started_at, fall back to full content scan (backward compat)
  if (!startedAt) {
    const detected = PROMISE_PATTERN.test(content);
    if (detected) {
      logDebug('detected completion promise <promise>DONE</promise>');
    }
    return detected;
  }

  // JSONL-aware filtering: only check lines after started_at
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: { timestamp?: string; type?: string };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // Skip unparseable lines
    }

    // Skip lines without timestamp or before started_at
    if (!entry.timestamp || new Date(entry.timestamp) < new Date(startedAt)) continue;

    // Only check assistant messages (skip system/user to avoid false positives)
    if (entry.type !== 'assistant') continue;

    if (PROMISE_PATTERN.test(trimmed)) {
      logDebug('detected completion promise <promise>DONE</promise> (after started_at)');
      return true;
    }
  }

  return false;
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

    let entry: { timestamp?: string; type?: string };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // Skip unparseable lines
    }

    // Skip lines without timestamp or before started_at
    if (!entry.timestamp || new Date(entry.timestamp) < new Date(startedAt)) continue;

    // Only check assistant messages (skip system/user to avoid false positives)
    if (entry.type !== 'assistant') continue;

    if (ORACLE_APPROVED_PATTERN.test(trimmed)) {
      logDebug('detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved> (after started_at)');
      return true;
    }
  }

  return false;
}

export function analyzeTranscript(transcriptPath: string | null, ralphState?: RalphState | null): TranscriptDetection {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath, ralphState?.started_at),
    hasOracleApproval: detectOracleApproval(transcriptPath, ralphState?.started_at),
  };
}

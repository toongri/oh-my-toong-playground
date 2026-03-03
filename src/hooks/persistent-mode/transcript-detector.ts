import { TranscriptDetection } from './types.ts';
import { logDebug } from '../../lib/logging.ts';

// Pattern matchers
const PROMISE_PATTERN = /<promise>\s*DONE\s*<\/promise>/i;
const ORACLE_APPROVED_PATTERN = /<oracle-approved>.*VERIFIED_COMPLETE.*<\/oracle-approved>/i;

export function detectCompletionPromise(lastAssistantMessage: string | null): boolean {
  if (!lastAssistantMessage) return false;

  const detected = PROMISE_PATTERN.test(lastAssistantMessage);
  if (detected) {
    logDebug('detected completion promise <promise>DONE</promise>');
  }
  return detected;
}

export function detectOracleApproval(lastAssistantMessage: string | null): boolean {
  if (!lastAssistantMessage) return false;

  const detected = ORACLE_APPROVED_PATTERN.test(lastAssistantMessage);
  if (detected) {
    logDebug('detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved>');
  }
  return detected;
}

export function analyzeTranscript(lastAssistantMessage: string | null): TranscriptDetection {
  return {
    hasCompletionPromise: detectCompletionPromise(lastAssistantMessage),
    hasOracleApproval: detectOracleApproval(lastAssistantMessage),
  };
}

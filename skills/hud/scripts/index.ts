import { readStdin } from './stdin.ts';
import { readRalphState, readBackgroundTasks, calculateSessionDuration, isThinkingEnabled, readTasks, getActiveTaskForm } from './state.ts';
import { parseTranscript } from './transcript.ts';
import { fetchRateLimits } from './usage-api.ts';
import { formatStatusLineV2, formatMinimalStatus } from './formatter.ts';
import { initLogger, logInfo, logError, logStart, logEnd } from '@lib/logging';
import { getOmtDir } from '../../lib/omt-dir';
import type { HudDataV2 } from './types.ts';

/**
 * Convert regular spaces to non-breaking spaces for terminal alignment.
 * Terminal emulators may collapse or trim regular spaces, but non-breaking
 * spaces (U+00A0) preserve alignment in status lines.
 */
function toNonBreakingSpaces(text: string): string {
  return text.replace(/ /g, '\u00A0');
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

export async function main(): Promise<void> {
  try {
    // Read stdin JSON from Claude Code
    const input = await readStdin();

    if (!input) {
      // Minimal fallback when no input
      console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
      return;
    }

    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id || 'default';

    // Initialize logging
    initLogger('hud', getOmtDir(), sessionId);
    logStart();
    logInfo(`Input: transcript_path=${input.transcript_path}, cwd=${cwd}`);

    // Gather data from all sources in parallel (individual failures don't block others)
    const functionNames = [
      'readRalphState', 'readBackgroundTasks', 'parseTranscript',
      'fetchRateLimits', 'isThinkingEnabled', 'readTasks', 'getActiveTaskForm',
    ];
    const results = await Promise.allSettled([
      readRalphState(cwd, sessionId),
      readBackgroundTasks(),
      input.transcript_path
        ? parseTranscript(input.transcript_path)
        : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null }),
      fetchRateLimits(),
      isThinkingEnabled(),
      readTasks(sessionId),
      getActiveTaskForm(sessionId),
    ]);

    // Log rejected results with function names
    results.forEach((result, index) => {
      if (!isFulfilled(result)) {
        logError(`HUD data source failed: ${functionNames[index]} - ${result.reason}`);
      }
    });

    // Extract values with type-safe fallbacks for rejected promises
    const ralph = isFulfilled(results[0]) ? results[0].value : null;
    const backgroundTasks = isFulfilled(results[1]) ? results[1].value : 0;
    const transcriptData = isFulfilled(results[2])
      ? results[2].value
      : { runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null };
    const rateLimits = isFulfilled(results[3]) ? results[3].value : null;
    const thinkingActive = isFulfilled(results[4]) ? results[4].value : false;
    const todos = isFulfilled(results[5]) ? results[5].value : null;
    const inProgressTodo = isFulfilled(results[6]) ? results[6].value : null;

    // Log transcript parsing results
    logInfo(`Transcript parsed: runningAgents=${transcriptData.runningAgents}`);

    const hudData: HudDataV2 = {
      contextPercent: input.context_window?.used_percentage ?? null,
      ralph,
      runningAgents: transcriptData.runningAgents,
      backgroundTasks,
      activeSkill: transcriptData.activeSkill,
      rateLimits,
      agents: transcriptData.agents,
      sessionDuration: calculateSessionDuration(transcriptData.sessionStartedAt),
      thinkingActive,
      todos,
      inProgressTodo,
    };

    // Format and output with non-breaking spaces for terminal alignment
    console.log(toNonBreakingSpaces(formatStatusLineV2(hudData)));
    logEnd();
  } catch (error) {
    // Log error and graceful fallback
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`HUD error: ${errorMessage}`);
    console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
  }
}

// Run main only when executed directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

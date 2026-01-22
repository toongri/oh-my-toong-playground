import { readStdin } from './stdin.js';
import { readRalphState, readUltraworkState, readRalphVerification, readTodos, readBackgroundTasks, calculateSessionDuration, getInProgressTodo, isThinkingEnabled } from './state.js';
import { parseTranscript } from './transcript.js';
import { fetchRateLimits } from './usage-api.js';
import { formatStatusLineV2, formatMinimalStatus } from './formatter.js';
import type { HudDataV2 } from './types.js';

export async function main(): Promise<void> {
  try {
    // Read stdin JSON from Claude Code
    const input = await readStdin();

    if (!input) {
      // Minimal fallback when no input
      console.log(formatMinimalStatus(null));
      return;
    }

    const cwd = input.cwd || process.cwd();

    // Gather data from all sources in parallel
    const [
      ralph,
      ultrawork,
      ralphVerification,
      todos,
      backgroundTasks,
      transcriptData,
      rateLimits,
      inProgressTodo,
      thinkingActive,
    ] = await Promise.all([
      readRalphState(cwd),
      readUltraworkState(cwd),
      readRalphVerification(cwd),
      readTodos(cwd),
      readBackgroundTasks(),
      input.transcript_path
        ? parseTranscript(input.transcript_path)
        : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null }),
      fetchRateLimits(),
      getInProgressTodo(cwd),
      isThinkingEnabled(),
    ]);

    const hudData: HudDataV2 = {
      contextPercent: input.context_window?.used_percentage ?? null,
      ralph,
      ultrawork,
      ralphVerification,
      todos,
      runningAgents: transcriptData.runningAgents,
      backgroundTasks,
      activeSkill: transcriptData.activeSkill,
      rateLimits,
      agents: transcriptData.agents,
      sessionDuration: calculateSessionDuration(transcriptData.sessionStartedAt),
      thinkingActive,
      inProgressTodo,
    };

    // Format and output
    console.log(formatStatusLineV2(hudData));
  } catch (error) {
    // Graceful fallback on any error
    console.log(formatMinimalStatus(null));
  }
}

// Run main only when executed directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

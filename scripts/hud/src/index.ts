import { readStdin } from './stdin.js';
import { readRalphState, readUltraworkState, readRalphVerification, readBackgroundTasks, calculateSessionDuration, getInProgressTodo, isThinkingEnabled } from './state.js';
import { parseTranscript } from './transcript.js';
import { fetchRateLimits } from './usage-api.js';
import { formatStatusLineV2, formatMinimalStatus } from './formatter.js';
import type { HudDataV2 } from './types.js';

/**
 * Convert regular spaces to non-breaking spaces for terminal alignment.
 * Terminal emulators may collapse or trim regular spaces, but non-breaking
 * spaces (U+00A0) preserve alignment in status lines.
 */
function toNonBreakingSpaces(text: string): string {
  return text.replace(/ /g, '\u00A0');
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

    // Gather data from all sources in parallel
    const [
      ralph,
      ultrawork,
      ralphVerification,
      backgroundTasks,
      transcriptData,
      rateLimits,
      thinkingActive,
    ] = await Promise.all([
      readRalphState(cwd),
      readUltraworkState(cwd),
      readRalphVerification(cwd),
      readBackgroundTasks(),
      input.transcript_path
        ? parseTranscript(input.transcript_path)
        : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null, todos: [] }),
      fetchRateLimits(),
      isThinkingEnabled(),
    ]);

    // Get in-progress todo from transcript todos (synchronous, session-isolated)
    const inProgressTodo = getInProgressTodo(transcriptData.todos);

    // Use ONLY transcript-based todos for session isolation
    // File-based todos are not used to prevent accumulation from past sessions
    const transcriptTodos = transcriptData.todos;
    let todos: { completed: number; total: number } | null = null;

    if (transcriptTodos.length > 0) {
      const completed = transcriptTodos.filter(t => t.status === 'completed').length;
      todos = { completed, total: transcriptTodos.length };
    }

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

    // Format and output with non-breaking spaces for terminal alignment
    console.log(toNonBreakingSpaces(formatStatusLineV2(hudData)));
  } catch (error) {
    // Graceful fallback on any error
    console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
  }
}

// Run main only when executed directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

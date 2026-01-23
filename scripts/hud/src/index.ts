import { readStdin } from './stdin.js';
import { readRalphState, readUltraworkState, readRalphVerification, readTodos, readBackgroundTasks, calculateSessionDuration, getInProgressTodo, isThinkingEnabled } from './state.js';
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
      fileTodos,
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
        : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null, todos: [] }),
      fetchRateLimits(),
      getInProgressTodo(cwd),
      isThinkingEnabled(),
    ]);

    // Prefer transcript todos over file-based todos
    // Transcript todos are session-specific; file todos may include stale data from other sessions
    const transcriptTodos = transcriptData.todos;
    let todos: { completed: number; total: number } | null = null;

    if (transcriptTodos.length > 0) {
      // Use transcript-based todos (current session only)
      const completed = transcriptTodos.filter(t => t.status === 'completed').length;
      todos = { completed, total: transcriptTodos.length };
    } else {
      // Fallback to file-based todos (legacy behavior)
      todos = fileTodos;
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

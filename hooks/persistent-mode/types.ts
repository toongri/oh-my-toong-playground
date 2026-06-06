// Hook input from Claude Code
export interface HookInput {
  sessionId?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  last_assistant_message?: string;
}

// Parsed hook input
export interface ParsedInput {
  sessionId: string;
  directory: string;
  lastAssistantMessage: string | null;
}

// Ralph state file structure
export interface RalphState {
  active: boolean;
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  prompt: string;
  started_at?: string;
}

/**
 * Minimal contract the persistent-mode hook reads from the deep-interview
 * state file. The on-disk file may carry additional fields at runtime
 * (e.g. current phase, interview rounds, ambiguity scores, ontology
 * snapshots) written by the interview skill itself; only `active` is
 * consulted here. Writers must merge rather than overwrite — replacing
 * the file with this minimal shape discards in-flight interview data.
 */
export interface DeepInterviewState {
  active: boolean;
  sessionId: string;
}

/**
 * Minimal contract the persistent-mode hook reads from the prometheus
 * state file. The on-disk file may carry additional fields at runtime
 * (e.g. phase, plan_path, resume_summary, started_at) written by the
 * prometheus skill itself; only `active` is consulted here. Writers must
 * merge rather than overwrite — replacing the file with this minimal shape
 * discards in-flight prometheus data.
 */
export interface PrometheusState {
  active: boolean;
}

/**
 * Minimal contract the persistent-mode hook reads from the goal-state file
 * written by `skills/goal/scripts/goal-state.ts`. The on-disk file carries
 * many additional SKILL-only fields (outcome, verification_surface, etc.);
 * the hook only consults this subset. `active === false` means a terminal
 * state (complete/blocked/budget_limited) — the hook must treat it as null
 * so it never blocks on a finished goal.
 */
export interface GoalState {
  active: boolean;
  phase: string;
  objective_verdict: string;
  iteration: number;
  max_iterations: number;
}

// Hook output format
export interface HookOutput {
  decision?: 'block' | 'continue';
  continue?: boolean;
  reason?: string;
}

// Todo item from transcript parsing
export interface TodoItem {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// Transcript detection results
export interface TranscriptDetection {
  hasCompletionPromise: boolean;
  hasOracleApproval: boolean;
}

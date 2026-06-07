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
 * written by the prometheus skill itself; only `active` is consulted here.
 * Writers must merge rather than overwrite.
 */
export interface PrometheusState {
  active: boolean;
  sessionId: string;
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

// Hook input from Claude Code
export interface HookInput {
  sessionId?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
}

// Parsed hook input
export interface ParsedInput {
  sessionId: string;
  directory: string;
  transcriptPath: string | null;
}

// Ralph state file structure
export interface RalphState {
  active: boolean;
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  prompt: string;
  oracle_feedback?: string[];
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
  oracleRejectionFeedback: string | null;
  incompleteTodoCount: number;
}

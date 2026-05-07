export interface HookInput {
  sessionId?: string;
  session_id?: string;
  cwd?: string;
}

export interface ScanResult {
  count: number;
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
  continue?: boolean;
}

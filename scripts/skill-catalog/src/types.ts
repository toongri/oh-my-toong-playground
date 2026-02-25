// Hook input from Claude Code (SessionStart)
export interface HookInput {
  sessionId?: string;
  session_id?: string;
  cwd?: string;
}

// Parsed hook input
export interface ParsedInput {
  sessionId: string;
  cwd: string;
}

// Hashmap skill entry — rich metadata for delegation evaluation
export interface HashmapSkillEntry {
  description: string;
  criteria: string;
  alwaysAvailable: boolean;
  examples: string[];
}

// Catalog entry — either hashmap-enriched or discovered-only
export interface CatalogEntry {
  name: string;
  description?: string;
  criteria?: string;
  examples?: string[];
  discoveredOnly: boolean;
}

// Hook output format
export interface HookOutput {
  continue: true;
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

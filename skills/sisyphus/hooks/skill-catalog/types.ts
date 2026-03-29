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

// Situation — a task context that determines which skills are relevant
export interface Situation {
  id: string;
  label: string;
  reasoning: string;
}

// Hashmap skill entry — metadata for availability evaluation
export interface HashmapSkillEntry {
  description: string;
  pluginId?: string;
  situationIds: string[];
}

// Catalog entry — either hashmap-enriched or discovered-only
export interface CatalogEntry {
  name: string;
  description?: string;
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

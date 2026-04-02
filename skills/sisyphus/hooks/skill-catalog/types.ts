// Hook input from Claude Code (UserPromptSubmit)
export interface HookInput {
  sessionId?: string;
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
}

// Parsed hook input
export interface ParsedInput {
  sessionId: string;
  cwd: string;
  hookEventName: string;
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
  situationIds?: string[];
}

// Hook output format
export interface HookOutput {
  continue: true;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
}

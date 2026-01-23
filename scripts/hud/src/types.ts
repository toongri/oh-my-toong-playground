// stdin JSON schema from Claude Code
export interface StdinInput {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  cwd: string;
  workspace?: { project_dir: string };
  context_window: {
    used_percentage: number;
    total_input_tokens: number;
    context_window_size: number;
  };
}

// ralph-state.json
export interface RalphState {
  active: boolean;
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  prompt: string;
  started_at: string;
  linked_ultrawork: boolean;
}

// ultrawork-state.json
export interface UltraworkState {
  active: boolean;
  started_at: string;
  original_prompt: string;
  reinforcement_count: number;
  last_checked_at?: string;
  linked_to_ralph: boolean;
}

// ralph-verification.json
export interface RalphVerification {
  pending: boolean;
  verification_attempts: number;
  max_verification_attempts: number;
  original_task: string;
  completion_claim: string;
  oracle_feedback?: string;
  created_at: string;
}

// todos.json
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface TodosState {
  todos: TodoItem[];
}

// Aggregated HUD data
export interface HudData {
  contextPercent: number | null;
  ralph: RalphState | null;
  ultrawork: UltraworkState | null;
  ralphVerification: RalphVerification | null;
  todos: { completed: number; total: number } | null;
  runningAgents: number;
  backgroundTasks: number;
  activeSkill: string | null;
}

// Transcript parsing result
export interface TranscriptData {
  runningAgents: number;
  activeSkill: string | null;
  todos: TodoItem[];  // Todos extracted from TodoWrite/TaskCreate calls
}

// OAuth usage API response
export interface UsageResponse {
  five_hour: UsageLimit | null;
  seven_day: UsageLimit | null;
  seven_day_oauth_apps: UsageLimit | null;
  seven_day_opus: UsageLimit | null;
}

export interface UsageLimit {
  utilization: number;
  resets_at: string | null;
}

// Processed rate limit data for display
export interface RateLimitData {
  fiveHour: { percent: number; resetIn: string } | null;
  sevenDay: { percent: number; resetIn: string } | null;
}

// Agent information from transcript
export interface AgentInfo {
  type: 'M' | 'S';  // Main or Subagent
  model: 'o' | 's' | 'h';  // opus, sonnet, haiku
  id: string;
}

// Todo statistics
export interface TodoStats {
  completed: number;
  total: number;
}

// Enhanced HUD data (extends existing)
export interface HudDataV2 {
  contextPercent: number | null;
  ralph: RalphState | null;
  ultrawork: UltraworkState | null;
  ralphVerification: RalphVerification | null;
  todos: TodoStats | null;
  runningAgents: number;
  backgroundTasks: number;
  activeSkill: string | null;
  // New fields
  rateLimits: RateLimitData | null;
  agents: AgentInfo[];
  sessionDuration: number | null;  // in minutes
  thinkingActive: boolean;
  inProgressTodo: string | null;
}

// ANSI color codes
export const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
} as const;

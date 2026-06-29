/**
 * Agent driver interface for headless CLI invocations.
 *
 * Each CLI (opencode, claude, codex) has a thin driver that:
 * 1. Parses structured stdout (NDJSON or single JSON) into TerminalSignal + sessionID + text.
 * 2. Builds initial and resume commands for multi-turn pump.
 *
 * Total wall-clock = timeoutSec × maxTurns; production yaml authors must keep within
 * CI/runtime caps.
 */

export type TerminalSignal =
  | 'stop'              // model ended cleanly, deliverable expected
  | 'tool-calls'        // opencode mid-step (more steps follow); claude tool_use; codex item.completed without turn.completed
  | 'pause_turn'        // claude server-tool loop cap (theoretical for -p)
  | 'error'             // explicit error event in stream
  | 'unknown_pause';    // no terminal event seen; heuristic fallback

export interface ParseResult {
  sessionID: string | null;
  terminal: TerminalSignal;
  text: string;            // concatenated agent_message/text events only (NDJSON noise stripped)
  rawEvents: unknown[];    // for events-turn-N.jsonl audit log
  usage?: Record<string, number>; // token counts from turn.completed; undefined when no turn.completed seen
}

export interface InitialCommandOpts {
  prompt: string;
  baseCommand: string;
  baseArgs: string[];
  workerEnv: Record<string, string>;
}

export interface ResumeCommandOpts {
  sessionID: string;
  prompt: string;
  baseCommand: string;
  baseArgs: string[];
  workerEnv: Record<string, string>;
}

export interface BuiltCommand {
  program: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentDriver {
  readonly cli: 'opencode' | 'claude' | 'codex';
  initialCommand(opts: InitialCommandOpts): BuiltCommand;
  resumeCommand(opts: ResumeCommandOpts): BuiltCommand;
  parseStdout(stdout: string): ParseResult | null;  // null = parse failure → caller triggers multi_turn_degraded
}

export type CliType = 'opencode' | 'claude' | 'codex' | 'gemini' | 'unknown';

/**
 * Factory returning the driver for a detected CLI type, or null when no driver
 * applies (caller must fall back to runWithRetry single-turn path).
 *
 * NOTE: actual driver instances are wired up later (T3/T4/T5). For now, this is
 * a stub that returns null for all inputs except those handled by drivers.
 * Drivers will be registered here by their implementing modules.
 */
export function pickDriver(cliType: CliType): AgentDriver | null {
  // Drivers register themselves by importing this module and pushing into REGISTRY.
  // For now (T2-only land), the registry is empty.
  const driver = REGISTRY.get(cliType);
  return driver ?? null;
}

const REGISTRY = new Map<CliType, AgentDriver>();

/** Registration helper for driver modules to call at module load time. */
export function registerDriver(cliType: CliType, driver: AgentDriver): void {
  REGISTRY.set(cliType, driver);
}

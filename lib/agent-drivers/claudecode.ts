/**
 * Claude CLI agent driver.
 *
 * Parses single-JSON stdout from `claude --output-format json -p ...`
 * and builds initial/resume commands for the multi-turn pump.
 *
 * stop_reason → TerminalSignal mapping:
 *   end_turn   → 'stop'
 *   tool_use   → 'tool-calls'
 *   pause_turn → 'pause_turn'
 *   refusal    → 'error'
 *   everything else (max_tokens, stop_sequence, model_context_window_exceeded, unknown) → 'unknown_pause'
 */

import type {
  AgentDriver,
  ParseResult,
  TerminalSignal,
  InitialCommandOpts,
  ResumeCommandOpts,
  BuiltCommand,
} from './types';
import { registerDriver } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stopReasonToSignal(stopReason: string): TerminalSignal {
  switch (stopReason) {
    case 'end_turn':   return 'stop';
    case 'tool_use':   return 'tool-calls';
    case 'pause_turn': return 'pause_turn';
    case 'refusal':    return 'error';
    default:           return 'unknown_pause';
  }
}

/** Strip existing --resume <value> pair from args array. */
function stripResumePair(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--resume') {
      i += 2; // skip flag and its value
    } else {
      out.push(args[i]);
      i++;
    }
  }
  return out;
}

/** Strip existing --output-format <value> pair from args array. */
function stripOutputFormatPair(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--output-format') {
      i += 2;
    } else {
      out.push(args[i]);
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const claudeDriver: AgentDriver = {
  cli: 'claude',

  parseStdout(stdout: string): ParseResult | null {
    if (!stdout || !stdout.trim()) return null;

    // Parse the first non-empty line as JSON.
    const firstLine = stdout.split('\n').find(l => l.trim().length > 0);
    if (!firstLine) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(firstLine) as Record<string, unknown>;
    } catch {
      return null;
    }

    const text = typeof parsed.result === 'string' ? parsed.result : '';
    const sessionID = typeof parsed.session_id === 'string' ? parsed.session_id : null;
    const stopReason = typeof parsed.stop_reason === 'string' ? parsed.stop_reason : '';
    const terminal = stopReasonToSignal(stopReason);

    return { sessionID, terminal, text, rawEvents: [parsed] };
  },

  initialCommand(opts: InitialCommandOpts): BuiltCommand {
    return { program: opts.baseCommand, args: [...opts.baseArgs], env: opts.workerEnv };
  },

  resumeCommand(opts: ResumeCommandOpts): BuiltCommand {
    // Strip existing --resume pair and --output-format pair, then re-inject both.
    const stripped = stripOutputFormatPair(stripResumePair([...opts.baseArgs]));
    const args = [...stripped, '--resume', opts.sessionID, '--output-format', 'json'];
    return { program: opts.baseCommand, args, env: opts.workerEnv };
  },
};

registerDriver('claude', claudeDriver);

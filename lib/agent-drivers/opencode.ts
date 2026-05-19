/**
 * opencode AgentDriver — NDJSON stream parser + command builders.
 *
 * Parses line-by-line NDJSON from opencode --format json stdout.
 * Non-JSON lines (e.g. "exit=0") are collected as _unparseable for audit;
 * they do NOT cause a null return unless the stream is catastrophically broken.
 *
 * null return contract: ONLY when the last non-blank line is a truncated JSON
 * (contains '{' but fails JSON.parse AND has no trailing newline after it).
 * All other partial-parse scenarios return a valid ParseResult.
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
// Internal event shape (partial — only fields we use)
// ---------------------------------------------------------------------------

interface OpencodeEvent {
  type: string;
  sessionID?: string;
  part?: {
    text?: string;
    reason?: string;
  };
}

// ---------------------------------------------------------------------------
// parseStdout
// ---------------------------------------------------------------------------

function parseStdout(stdout: string): ParseResult | null {
  // Detect truncated last line: no trailing newline + last line contains '{' but is not valid JSON.
  const endsWithNewline = stdout.endsWith('\n');
  const rawLines = stdout.split('\n');

  // Determine if the last line is truncated mid-event.
  // A "truncated" last line: non-blank, not valid JSON, contains '{'.
  if (!endsWithNewline) {
    const lastLine = rawLines[rawLines.length - 1];
    if (lastLine && lastLine.includes('{')) {
      // Attempt parse; if it fails this is a truncated mid-event → catastrophic
      try {
        JSON.parse(lastLine);
        // parsed fine — not truncated, continue
      } catch {
        return null;
      }
    }
  }

  const events: OpencodeEvent[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as OpencodeEvent;
      events.push(parsed);
    } catch {
      // non-JSON lines (e.g. "exit=0") silently skipped — audit caller can inspect rawEvents
    }
  }

  // Catastrophic: no lines parsed as JSON
  if (events.length === 0) return null;

  // Extract sessionID: prefer the first step_finish event's sessionID (the terminal event
  // most reliably identifies the session), fall back to the first event with any sessionID.
  let sessionID: string | null = null;
  for (const ev of events) {
    if (ev.type === 'step_finish' && ev.sessionID) {
      sessionID = ev.sessionID;
      break;
    }
  }
  if (!sessionID) {
    for (const ev of events) {
      if (ev.sessionID) {
        sessionID = ev.sessionID;
        break;
      }
    }
  }

  // Concatenate text from type==='text' events
  let text = '';
  for (const ev of events) {
    if (ev.type === 'text' && ev.part?.text) {
      text += ev.part.text;
    }
  }

  // Classify terminal signal
  let terminal: TerminalSignal = 'unknown_pause';
  let sawStopFinish = false;
  let sawToolCallsFinish = false;
  let sawError = false;

  for (const ev of events) {
    if (ev.type === 'step_finish') {
      if (ev.part?.reason === 'stop') {
        sawStopFinish = true;
      } else if (ev.part?.reason === 'tool-calls') {
        sawToolCallsFinish = true;
      }
    } else if (ev.type === 'error') {
      sawError = true;
    }
  }

  if (sawStopFinish) {
    terminal = 'stop';
  } else if (sawToolCallsFinish) {
    terminal = 'tool-calls';
  } else if (sawError) {
    terminal = 'error';
  }
  // else: unknown_pause (default)

  return {
    sessionID,
    terminal,
    text,
    rawEvents: events as unknown[],
  };
}

// ---------------------------------------------------------------------------
// initialCommand
// ---------------------------------------------------------------------------

function initialCommand(opts: InitialCommandOpts): BuiltCommand {
  return {
    program: opts.baseCommand,
    args: [...opts.baseArgs],
    env: opts.workerEnv,
  };
}

// ---------------------------------------------------------------------------
// resumeCommand
// ---------------------------------------------------------------------------

/** Strip any existing --flagName <value> pair from args (returns new array). */
function stripFormatPair(args: string[], flagName: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === flagName) {
      i += 2; // skip flag + value
    } else {
      out.push(args[i]);
      i++;
    }
  }
  return out;
}

function resumeCommand(opts: ResumeCommandOpts): BuiltCommand {
  // Strip existing --session pair from baseArgs (replace, not duplicate).
  let stripped: string[] = [];
  const baseArgs = opts.baseArgs;
  for (let i = 0; i < baseArgs.length; i++) {
    if (baseArgs[i] === '--session') {
      i++; // skip the value too
      continue;
    }
    stripped.push(baseArgs[i]);
  }

  // Ensure --format json is present with exactly the right value.
  // Strip any existing --format <value> pair, then unconditionally append --format json.
  stripped = stripFormatPair(stripped, '--format');
  const args = [...stripped, '--session', opts.sessionID, '--format', 'json'];

  return {
    program: opts.baseCommand,
    args,
    env: opts.workerEnv,
  };
}

// ---------------------------------------------------------------------------
// Driver export + registration
// ---------------------------------------------------------------------------

export const opencodeDriver: AgentDriver = {
  cli: 'opencode',
  parseStdout,
  initialCommand,
  resumeCommand,
};

registerDriver('opencode', opencodeDriver);

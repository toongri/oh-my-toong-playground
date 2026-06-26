/**
 * Codex AgentDriver for headless multi-turn pump.
 *
 * Parses line-by-line NDJSON from `codex exec --json` output.
 * Resume uses the subcommand form: `codex exec resume <thread_id>`.
 */

import {
  AgentDriver,
  ParseResult,
  TerminalSignal,
  registerDriver,
  InitialCommandOpts,
  ResumeCommandOpts,
  BuiltCommand,
} from './types';

export const codexDriver: AgentDriver = {
  cli: 'codex',

  parseStdout(stdout: string): ParseResult | null {
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');

    const rawEvents: unknown[] = [];
    let parseErrors = 0;

    for (const line of lines) {
      try {
        rawEvents.push(JSON.parse(line));
      } catch {
        parseErrors++;
      }
    }

    // Catastrophic: no valid JSON lines parsed
    if (rawEvents.length === 0) return null;

    let sessionID: string | null = null;
    const textParts: string[] = [];
    let hasTurnCompleted = false;
    let hasTurnFailed = false;
    let hasItemCompleted = false;
    let usage: Record<string, number> | undefined;

    for (const event of rawEvents) {
      if (!event || typeof event !== 'object') continue;
      const ev = event as Record<string, unknown>;

      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') {
        sessionID = ev.thread_id;
      }

      if (ev.type === 'turn.completed') {
        hasTurnCompleted = true;
        if (ev.usage && typeof ev.usage === 'object') {
          usage = ev.usage as Record<string, number>;
        }
      }

      if (ev.type === 'turn.failed') {
        hasTurnFailed = true;
      }

      if (ev.type === 'item.completed') {
        hasItemCompleted = true;
        const item = ev.item as Record<string, unknown> | undefined;
        if (item && item.type === 'agent_message' && typeof item.text === 'string') {
          textParts.push(item.text);
        }
      }
    }

    let terminal: TerminalSignal;
    if (hasTurnCompleted) {
      terminal = 'stop';
    } else if (hasTurnFailed) {
      terminal = 'error';
    } else if (hasItemCompleted) {
      terminal = 'tool-calls';
    } else {
      terminal = 'unknown_pause';
    }

    return {
      sessionID,
      terminal,
      text: textParts.join(''),
      rawEvents,
      usage,
    };
  },

  initialCommand(opts: InitialCommandOpts): BuiltCommand {
    const args = [...opts.baseArgs];
    if (!args.includes('--skip-git-repo-check')) {
      args.push('--skip-git-repo-check');
    }
    return {
      program: opts.baseCommand,
      args,
      env: opts.workerEnv,
    };
  },

  resumeCommand(opts: ResumeCommandOpts): BuiltCommand {
    // P2-3: preserve all baseArgs by injecting 'resume <id>' right after 'exec'.
    // codex resume form: `codex exec resume <id> [args...]`.
    const baseArgs = opts.baseArgs;
    const execIdx = baseArgs.indexOf('exec');
    const args = execIdx >= 0
      ? [
          ...baseArgs.slice(0, execIdx + 1),
          'resume', opts.sessionID,
          ...baseArgs.slice(execIdx + 1),
        ]
      : ['exec', 'resume', opts.sessionID, ...baseArgs];

    if (!args.includes('--skip-git-repo-check')) {
      args.push('--skip-git-repo-check');
    }

    return {
      program: opts.baseCommand,
      args,
      env: opts.workerEnv,
    };
  },
};

registerDriver('codex', codexDriver);

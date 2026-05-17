#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

import { initLogger, logInfo, logError, logStart, logEnd } from '@lib/logging';
import { parseArgs, exitWithError } from '@lib/job-utils';
import { getOmtDir } from '@lib/omt-dir';
import { detectCliType } from '@lib/generic-job';
import type { MultiTurnConfig } from '@lib/worker-utils';
import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt,
  runOnce as sharedRunOnce,
  runWithRetry as sharedRunWithRetry,
  runMultiTurn as sharedRunMultiTurn,
  type RunWithRetryOpts,
  type RunMultiTurnOpts,
} from '@lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, '../prompts');

// ---------------------------------------------------------------------------
// Wrappers (council uses member/jobDir interface)
// ---------------------------------------------------------------------------

async function runOnce({ command, prompt, member, safeMember, jobDir, timeoutSec, attempt }: {
  command: string; prompt: string; member: string; safeMember: string;
  jobDir: string; timeoutSec: number; attempt: number;
}) {
  const memberDir = path.join(jobDir, 'members', safeMember);

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(memberDir, 'status.json');
    const payload = {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command, attempt,
    };
    atomicWriteJson(statusPath, payload);
    return payload;
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  return sharedRunOnce({
    program, args, prompt, member, memberDir,
    command, timeoutSec, attempt, promptsDir: PROMPTS_DIR,
  });
}

interface CouncilRunWithRetryOpts extends Omit<RunWithRetryOpts, 'program' | 'args' | 'memberDir'> {
  safeMember: string;
  jobDir: string;
}

async function runWithRetry(opts: CouncilRunWithRetryOpts) {
  const { command, member, safeMember, jobDir, timeoutSec, sleepFn, ...rest } = opts;
  const memberDir = path.join(jobDir, 'members', safeMember);

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(memberDir, 'status.json');
    const payload = {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    };
    atomicWriteJson(statusPath, payload);
    return payload;
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  return sharedRunWithRetry({
    program, args, member, memberDir,
    command, timeoutSec, promptsDir: PROMPTS_DIR,
    sleepFn: sleepFn ?? sleepMsAsync,
    ...rest,
  });
}

interface CouncilRunMultiTurnOpts extends Omit<RunMultiTurnOpts, 'program' | 'args' | 'memberDir'> {
  safeMember: string;
  jobDir: string;
}

async function councilRunMultiTurn(opts: CouncilRunMultiTurnOpts) {
  const { command, member, safeMember, jobDir, timeoutSec, sleepFn, ...rest } = opts;
  const memberDir = path.join(jobDir, 'members', safeMember);

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(memberDir, 'status.json');
    const payload = {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    };
    atomicWriteJson(statusPath, payload);
    return payload;
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  return sharedRunMultiTurn({
    program, args, member, memberDir,
    command, timeoutSec, promptsDir: PROMPTS_DIR,
    sleepFn: sleepFn ?? sleepMsAsync,
    ...rest,
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  // Initialize persistent logging
  const jobId = jobDir ? path.basename(String(jobDir)).replace(/^council-/, '') : 'unknown';
  initLogger('council-job-worker', getOmtDir(), jobId);
  logStart();

  // Parse --env args: collect KEY=VALUE pairs
  const workerEnv: Record<string, string> = {};
  const rawArgs = process.argv.slice(2);
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--env' && i + 1 < rawArgs.length) {
      const eqIdx = rawArgs[i + 1].indexOf('=');
      if (eqIdx > 0) {
        workerEnv[rawArgs[i + 1].slice(0, eqIdx)] = rawArgs[i + 1].slice(eqIdx + 1);
      }
      i++;
    }
  }

  if (!jobDir) { logError('missing --job-dir'); logEnd(); exitWithError('worker: missing --job-dir'); }
  if (!member) { logError('missing --member'); logEnd(); exitWithError('worker: missing --member'); }
  if (!command) { logError('missing --command'); logEnd(); exitWithError('worker: missing --command'); }

  logInfo(`worker start: member=${member} command=${command} timeout=${timeoutSec}`);

  const promptPath = path.join(jobDir as string, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  // Load multi_turn config from council.config.yaml (skill-local, then project root)
  const skillConfigPath = path.resolve(import.meta.dirname, '../council.config.yaml');
  let multiTurn: MultiTurnConfig | undefined;
  try {
    const raw = fs.readFileSync(skillConfigPath, 'utf8');
    const config = parseYaml(raw) as Record<string, unknown>;
    const councilSection = config['council'] as Record<string, unknown> | undefined;
    const mt = councilSection?.['multi_turn'] as Record<string, unknown> | undefined;
    if (mt && typeof mt['max_turns'] === 'number' && typeof mt['deliverable_sentinel'] === 'string') {
      multiTurn = {
        maxTurns: mt['max_turns'] as number,
        deliverableSentinel: mt['deliverable_sentinel'] as string,
      };
    }
  } catch { /* yaml absent or malformed — proceed without multi_turn (falls back to runWithRetry) */ }

  const cliType = detectCliType(command as string) as 'opencode' | 'claude' | 'codex' | 'gemini' | 'unknown';

  councilRunMultiTurn({
    command: command as string, prompt, member: member as string, safeMember: member as string,
    jobDir: jobDir as string, timeoutSec, workerEnv, cliType, multiTurn,
  }).then((result) => {
    logInfo(`worker done: member=${member} state=${result.state}`);
    logEnd();
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (import.meta.main) {
  main();
}

export { splitCommand, atomicWriteJson, sleepMsAsync as sleepMs, assemblePrompt, runOnce, runWithRetry };

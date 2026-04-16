#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import { initLogger, logInfo, logError, logStart, logEnd } from '@lib/logging';
import { parseArgs, exitWithError } from '@lib/job-utils';
import { getOmtDir } from '@lib/omt-dir';
import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt as sharedAssemblePrompt,
  runOnce as sharedRunOnce,
  runWithRetry as sharedRunWithRetry,
  MAX_RETRIES,
  BASE_DELAY_MS,
} from '@lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, 'prompts');
const FALLBACK_FILE = 'reviewer.md';

// ---------------------------------------------------------------------------
// Spec-review wrappers (reviewer.md fallback default)
// ---------------------------------------------------------------------------

function assemblePrompt({ promptsDir, entityName, rawPrompt, reviewContent, fallbackFile }) {
  return sharedAssemblePrompt({
    promptsDir, entityName, rawPrompt, reviewContent,
    fallbackFile: fallbackFile || FALLBACK_FILE,
  });
}

function runOnce(opts) {
  return sharedRunOnce({
    ...opts,
    fallbackFile: opts.fallbackFile || FALLBACK_FILE,
    promptsDir: PROMPTS_DIR,
  });
}

function runWithRetry(opts) {
  return sharedRunWithRetry({
    ...opts,
    fallbackFile: opts.fallbackFile || FALLBACK_FILE,
    promptsDir: PROMPTS_DIR,
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
  const jobId = jobDir ? path.basename(String(jobDir)).replace(/^spec-review-/, '') : 'unknown';
  initLogger('spec-review-worker', getOmtDir(), jobId);
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

  const membersRoot = path.join(jobDir as string, 'members');
  const memberDir = path.join(membersRoot, member as string);

  const promptPath = path.join(jobDir as string, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const tokens = splitCommand(command as string);
  if (!tokens || tokens.length === 0) {
    logError(`invalid command string: ${command}`);
    const statusPath = path.join(memberDir, 'status.json');
    atomicWriteJson(statusPath, {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    });
    logEnd();
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  runWithRetry({
    program, args, prompt, member: member as string, memberDir, command: command as string, timeoutSec, workerEnv,
  }).then((result) => {
    logInfo(`worker done: member=${member} state=${result.state} exitCode=${result.exitCode}`);
    logEnd();
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (import.meta.main) {
  main();
}

export {
  splitCommand,
  atomicWriteJson,
  assemblePrompt,
  runOnce,
  runWithRetry,
  sleepMsAsync as sleepMs,
  MAX_RETRIES,
  BASE_DELAY_MS,
};

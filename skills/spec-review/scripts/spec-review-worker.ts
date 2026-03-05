#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import { initLogger, logInfo, logError, logStart, logEnd } from '../../../src/lib/logging';
import { parseArgs, exitWithError } from '../../../src/lib/job-utils';
import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt,
  runOnce as sharedRunOnce,
  runWithRetry as sharedRunWithRetry,
  MAX_RETRIES,
  BASE_DELAY_MS,
} from '../../../lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, '../prompts');

// Wrappers that default promptsDir to this worker's PROMPTS_DIR
function runOnce(opts) {
  return sharedRunOnce({ promptsDir: PROMPTS_DIR, ...opts });
}

function runWithRetry(opts) {
  return sharedRunWithRetry({ promptsDir: PROMPTS_DIR, ...opts });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const reviewer = options.reviewer;
  const safeReviewer = options['safe-reviewer'];
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  // Initialize persistent logging
  const projectRoot = path.resolve(import.meta.dirname, '../../..');
  const jobId = jobDir ? path.basename(String(jobDir)).replace(/^spec-review-/, '') : 'unknown';
  initLogger('spec-review-worker', projectRoot, jobId);
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
  if (!reviewer) { logError('missing --reviewer'); logEnd(); exitWithError('worker: missing --reviewer'); }
  if (!safeReviewer) { logError('missing --safe-reviewer'); logEnd(); exitWithError('worker: missing --safe-reviewer'); }
  if (!command) { logError('missing --command'); logEnd(); exitWithError('worker: missing --command'); }

  logInfo(`worker start: reviewer=${reviewer} command=${command} timeout=${timeoutSec}`);

  const reviewersRoot = path.join(jobDir as string, 'reviewers');
  const reviewerDir = path.join(reviewersRoot, safeReviewer as string);

  const promptPath = path.join(jobDir as string, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const tokens = splitCommand(command as string);
  if (!tokens || tokens.length === 0) {
    logError(`invalid command string: ${command}`);
    const statusPath = path.join(reviewerDir, 'status.json');
    atomicWriteJson(statusPath, {
      reviewer, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    });
    logEnd();
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  runWithRetry({
    program, args, prompt, reviewer: reviewer as string, reviewerDir, command: command as string, timeoutSec, workerEnv,
    promptsDir: PROMPTS_DIR,
  }).then((result) => {
    logInfo(`worker done: reviewer=${reviewer} state=${result.state} exitCode=${result.exitCode}`);
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

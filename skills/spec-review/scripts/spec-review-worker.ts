#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

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
// Utility functions
// ---------------------------------------------------------------------------

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }

    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) {
      out[key.slice(2)] = rawValue;
      continue;
    }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key.slice(2)] = true;
      continue;
    }
    out[key.slice(2)] = next;
    i++;
  }
  return out;
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

  if (!jobDir) exitWithError('worker: missing --job-dir');
  if (!reviewer) exitWithError('worker: missing --reviewer');
  if (!safeReviewer) exitWithError('worker: missing --safe-reviewer');
  if (!command) exitWithError('worker: missing --command');

  const reviewersRoot = path.join(jobDir, 'reviewers');
  const reviewerDir = path.join(reviewersRoot, safeReviewer);

  const promptPath = path.join(jobDir, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(reviewerDir, 'status.json');
    atomicWriteJson(statusPath, {
      reviewer, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  runWithRetry({
    program, args, prompt, reviewer, reviewerDir, command, timeoutSec,
    promptsDir: PROMPTS_DIR,
  }).then((result) => {
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

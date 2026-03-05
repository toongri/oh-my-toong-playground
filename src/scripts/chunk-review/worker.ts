#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import { initLogger, logInfo, logError, logStart, logEnd } from '../../lib/logging';
import {
  splitCommand,
  atomicWriteJson,
  sleepMsAsync,
  assemblePrompt as sharedAssemblePrompt,
  runOnce as sharedRunOnce,
  runWithRetry as sharedRunWithRetry,
  MAX_RETRIES,
  BASE_DELAY_MS,
} from '../../lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, 'prompts');
const FALLBACK_FILE = 'reviewer.md';

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
// Chunk-review wrappers (reviewer.md fallback default)
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
  });
}

function runWithRetry(opts) {
  return sharedRunWithRetry({
    ...opts,
    fallbackFile: opts.fallbackFile || FALLBACK_FILE,
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
  const projectRoot = path.resolve(import.meta.dirname, '../../..');
  const jobId = jobDir ? path.basename(jobDir).replace(/^chunk-review-/, '') : 'unknown';
  initLogger('chunk-review-worker', projectRoot, jobId);
  logStart();

  // Parse --env args: collect KEY=VALUE pairs
  const workerEnv = {};
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

  const reviewersRoot = path.join(jobDir, 'reviewers');
  const memberDir = path.join(reviewersRoot, member);

  const promptPath = path.join(jobDir, 'prompt.txt');
  const promptContent = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const EXECUTION_INSTRUCTION = 'Execute the diff command from REVIEW CONTENT. Review ONLY the files listed in Review Scope. Produce your full analysis following system instructions.';

  const tokens = splitCommand(command);
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
    program, args, prompt: EXECUTION_INSTRUCTION, reviewContent: promptContent, member, memberDir, command, timeoutSec, workerEnv,
    promptsDir: PROMPTS_DIR,
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
  atomicWriteJson as atomicWriteJson,
  assemblePrompt,
  runOnce,
  runWithRetry,
  sleepMsAsync as sleepMs,
  MAX_RETRIES,
  BASE_DELAY_MS,
};

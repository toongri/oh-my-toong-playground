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
} from '../../../lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, '../prompts');

// ---------------------------------------------------------------------------
// Backward-compatible wrappers (council uses member/safeMember/jobDir interface)
// ---------------------------------------------------------------------------

async function runOnce({ command, prompt, member, safeMember, jobDir, timeoutSec, attempt }) {
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

  const result = await sharedRunOnce({
    program, args, prompt, reviewer: member, reviewerDir: memberDir,
    command, timeoutSec, attempt, promptsDir: PROMPTS_DIR,
  });
  // Add backward-compatible 'member' alias for 'reviewer'
  if (result.reviewer !== undefined && result.member === undefined) {
    result.member = result.reviewer;
  }
  return result;
}

async function runWithRetry(opts) {
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

  // Wrap sleepFn to patch retrying status.json with backward-compatible 'member' field
  const statusPath = path.join(memberDir, 'status.json');
  const patchedSleepFn = async (ms) => {
    try {
      const raw = fs.readFileSync(statusPath, 'utf8');
      const status = JSON.parse(raw);
      if (status.state === 'retrying' && status.member === undefined) {
        status.member = member;
        atomicWriteJson(statusPath, status);
      }
    } catch { /* ignore */ }
    return sleepFn ? sleepFn(ms) : sleepMsAsync(ms);
  };

  const result = await sharedRunWithRetry({
    program, args, reviewer: member, reviewerDir: memberDir,
    command, timeoutSec, promptsDir: PROMPTS_DIR,
    sleepFn: patchedSleepFn,
    ...rest,
  });
  // Add backward-compatible 'member' alias
  if (result.reviewer !== undefined && result.member === undefined) {
    result.member = result.reviewer;
  }
  return result;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const safeMember = options['safe-member'];
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  // Initialize persistent logging
  const projectRoot = path.resolve(import.meta.dirname, '../../..');
  const jobId = jobDir ? path.basename(String(jobDir)).replace(/^council-/, '') : 'unknown';
  initLogger('council-job-worker', projectRoot, jobId);
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
  if (!safeMember) { logError('missing --safe-member'); logEnd(); exitWithError('worker: missing --safe-member'); }
  if (!command) { logError('missing --command'); logEnd(); exitWithError('worker: missing --command'); }

  logInfo(`worker start: member=${member} command=${command} timeout=${timeoutSec}`);

  const promptPath = path.join(jobDir as string, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  runWithRetry({ command: command as string, prompt, member: member as string, safeMember: safeMember as string, jobDir: jobDir as string, timeoutSec, workerEnv }).then((result) => {
    logInfo(`worker done: member=${member} state=${result.state}`);
    logEnd();
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (import.meta.main) {
  main();
}

export { splitCommand, atomicWriteJson, sleepMsAsync as sleepMs, assemblePrompt, runOnce, runWithRetry };

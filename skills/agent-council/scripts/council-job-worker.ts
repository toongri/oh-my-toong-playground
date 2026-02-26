#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import {
  splitCommand,
  atomicWriteJsonAsync,
  sleepMsAsync,
  assemblePrompt,
  runOnce as sharedRunOnce,
  runWithRetry as sharedRunWithRetry,
} from '../../../lib/worker-utils';

const PROMPTS_DIR = path.resolve(import.meta.dirname, '../prompts');

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
    atomicWriteJsonAsync(statusPath, payload);
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
    atomicWriteJsonAsync(statusPath, payload);
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
        atomicWriteJsonAsync(statusPath, status);
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

  if (!jobDir) exitWithError('worker: missing --job-dir');
  if (!member) exitWithError('worker: missing --member');
  if (!safeMember) exitWithError('worker: missing --safe-member');
  if (!command) exitWithError('worker: missing --command');

  const promptPath = path.join(jobDir, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  runWithRetry({ command, prompt, member, safeMember, jobDir, timeoutSec }).then((result) => {
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (import.meta.main) {
  main();
}

export { splitCommand, atomicWriteJsonAsync as atomicWriteJson, sleepMsAsync as sleepMs, assemblePrompt, runOnce, runWithRetry };

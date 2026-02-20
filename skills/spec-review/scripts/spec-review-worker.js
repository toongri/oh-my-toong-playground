#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('../../shared/lib/worker-core.js');

const { splitCommand, atomicWriteJson, sleepMs, MAX_RETRIES, BASE_DELAY_MS } = core;

function runOnce({ program, args, prompt, reviewer, reviewerDir, command, timeoutSec, attempt, spawnFn }) {
  return core.runOnce({
    program, args, prompt,
    entityName: reviewer, entityKey: 'reviewer', entityDir: reviewerDir,
    command, timeoutSec, attempt, spawnFn,
  });
}

function runWithRetry({ program, args, prompt, reviewer, reviewerDir, command, timeoutSec, spawnFn, sleepFn }) {
  return core.runWithRetry({
    program, args, prompt,
    entityName: reviewer, entityKey: 'reviewer', entityDir: reviewerDir,
    command, timeoutSec, spawnFn, sleepFn,
  });
}

function main() {
  const options = core.parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const reviewer = options.reviewer;
  const safeReviewer = options['safe-reviewer'];
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  if (!jobDir) core.exitWithError('worker: missing --job-dir');
  if (!reviewer) core.exitWithError('worker: missing --reviewer');
  if (!safeReviewer) core.exitWithError('worker: missing --safe-reviewer');
  if (!command) core.exitWithError('worker: missing --command');

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
  }).then((result) => {
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  splitCommand,
  atomicWriteJson,
  runOnce,
  runWithRetry,
  sleepMs,
  MAX_RETRIES,
  BASE_DELAY_MS,
};

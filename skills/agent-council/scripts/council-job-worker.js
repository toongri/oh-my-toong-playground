#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('../../shared/lib/worker-core.js');

const { splitCommand, atomicWriteJson, sleepMs } = core;

function runOnce({ command, prompt, member, safeMember, jobDir, timeoutSec, attempt }) {
  const memberDir = path.join(jobDir, 'members', safeMember);
  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(memberDir, 'status.json');
    const payload = {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command, attempt,
    };
    atomicWriteJson(statusPath, payload);
    return Promise.resolve(payload);
  }
  return core.runOnce({
    program: tokens[0], args: tokens.slice(1), prompt,
    entityName: member, entityKey: 'member', entityDir: memberDir,
    command, timeoutSec, attempt,
  });
}

function runWithRetry({ command, prompt, member, safeMember, jobDir, timeoutSec, sleepFn }) {
  const memberDir = path.join(jobDir, 'members', safeMember);
  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    const statusPath = path.join(memberDir, 'status.json');
    const payload = {
      member, state: 'error', message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    };
    atomicWriteJson(statusPath, payload);
    return Promise.resolve(payload);
  }
  return core.runWithRetry({
    program: tokens[0], args: tokens.slice(1), prompt,
    entityName: member, entityKey: 'member', entityDir: memberDir,
    command, timeoutSec, sleepFn,
  });
}

function main() {
  const options = core.parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const safeMember = options['safe-member'];
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  if (!jobDir) core.exitWithError('worker: missing --job-dir');
  if (!member) core.exitWithError('worker: missing --member');
  if (!safeMember) core.exitWithError('worker: missing --safe-member');
  if (!command) core.exitWithError('worker: missing --command');

  const promptPath = path.join(jobDir, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  runWithRetry({ command, prompt, member, safeMember, jobDir, timeoutSec }).then((result) => {
    process.exit(result.state === 'done' ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { splitCommand, atomicWriteJson, sleepMs, runOnce, runWithRetry };

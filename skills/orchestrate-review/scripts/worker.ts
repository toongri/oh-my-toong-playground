#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import { initLogger, logInfo, logError, logStart, logEnd } from '@lib/logging';
import { exitWithError, parseArgs } from '@lib/job-utils';
import { getOmtDir } from '@lib/omt-dir';
import { splitCommand, atomicWriteJson, runOneTurn } from '@lib/worker-utils';
import { detectCliType } from '@lib/generic-job';
import type { CliType } from '@lib/agent-drivers/types';

const PROMPTS_DIR = path.resolve(import.meta.dirname, 'prompts');

/** Type-predicate over CliType's members — narrows detectCliType's `string` return without an `as` assertion. */
function isCliType(value: string): value is CliType {
  return value === 'opencode' || value === 'claude' || value === 'codex' || value === 'gemini' || value === 'unknown';
}

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;

  const jobId = jobDir ? path.basename(String(jobDir)).replace(/^chunk-review-/, '') : 'unknown';
  initLogger('chunk-review-worker', getOmtDir(), jobId);
  logStart();

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

  if (typeof jobDir !== 'string' || !jobDir) { logError('missing --job-dir'); logEnd(); exitWithError('worker: missing --job-dir'); }
  if (typeof member !== 'string' || !member) { logError('missing --member'); logEnd(); exitWithError('worker: missing --member'); }
  if (typeof command !== 'string' || !command) { logError('missing --command'); logEnd(); exitWithError('worker: missing --command'); }

  logInfo(`worker start: member=${member} command=${command} timeout=${timeoutSec}`);

  const membersRoot = path.join(jobDir, 'members');
  const memberDir = path.join(membersRoot, member);

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

  const detectedCliType = detectCliType(command);
  const cliType: CliType = isCliType(detectedCliType) ? detectedCliType : 'unknown';

  runOneTurn({
    program, args, prompt: EXECUTION_INSTRUCTION, reviewContent: promptContent, member, memberDir, command, timeoutSec, workerEnv,
    cliType,
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

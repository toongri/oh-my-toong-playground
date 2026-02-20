#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

const NON_RETRYABLE_STATES = new Set(['missing_cli', 'timed_out', 'canceled']);

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

function splitCommand(command) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  for (const ch of String(command || '')) {
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (!inSingle && ch === '\\') {
      escapeNext = true;
      continue;
    }

    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  if (inSingle || inDouble) return null;
  return tokens;
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the command once and return a result object with state info.
 *
 * @param {object} opts
 * @param {string} opts.program
 * @param {string[]} opts.args
 * @param {string} opts.prompt
 * @param {string} opts.reviewer
 * @param {string} opts.reviewerDir
 * @param {string} opts.command
 * @param {number} opts.timeoutSec
 * @param {number} opts.attempt
 * @param {Function} [opts.spawnFn] - injectable spawn (for testing)
 * @returns {Promise<object>} result with state, exitCode, etc.
 */
function runOnce(opts) {
  const {
    program, args, prompt, reviewer, reviewerDir, command,
    timeoutSec, attempt, spawnFn = spawn,
  } = opts;

  const statusPath = path.join(reviewerDir, 'status.json');
  const outPath = path.join(reviewerDir, 'output.txt');
  const errPath = path.join(reviewerDir, 'error.txt');

  return new Promise((resolve) => {
    atomicWriteJson(statusPath, {
      reviewer, state: 'running', startedAt: new Date().toISOString(),
      command, pid: null, attempt,
    });

    const outStream = fs.createWriteStream(outPath, { flags: 'w' });
    const errStream = fs.createWriteStream(errPath, { flags: 'w' });

    let child;
    try {
      child = spawnFn(program, [...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      const result = {
        reviewer, state: 'error',
        message: error && error.message ? error.message : 'Failed to spawn command',
        finishedAt: new Date().toISOString(), command, attempt,
      };
      atomicWriteJson(statusPath, result);
      try { outStream.end(); errStream.end(); } catch { /* ignore */ }
      resolve(result);
      return;
    }

    // Write prompt to stdin
    if (child.stdin) {
      child.stdin.on('error', () => { /* ignore pipe errors */ });
      child.stdin.write(prompt);
      child.stdin.end();
    }

    atomicWriteJson(statusPath, {
      reviewer, state: 'running', startedAt: new Date().toISOString(),
      command, pid: child.pid, attempt,
    });

    if (child.stdout) child.stdout.pipe(outStream);
    if (child.stderr) child.stderr.pipe(errStream);

    let timeoutHandle = null;
    let timeoutTriggered = false;
    if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
      timeoutHandle = setTimeout(() => {
        timeoutTriggered = true;
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* ignore */ }
      }, timeoutSec * 1000);
      timeoutHandle.unref();
    }

    const finalize = (payload) => {
      try { outStream.end(); errStream.end(); } catch { /* ignore */ }
      atomicWriteJson(statusPath, payload);
      resolve(payload);
    };

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const isMissing = error && error.code === 'ENOENT';
      finalize({
        reviewer, state: isMissing ? 'missing_cli' : 'error',
        message: error && error.message ? error.message : 'Process error',
        finishedAt: new Date().toISOString(), command,
        exitCode: null, pid: child.pid, attempt,
      });
    });

    child.on('exit', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
      const canceled = !timedOut && signal === 'SIGTERM';
      finalize({
        reviewer,
        state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
        message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
        finishedAt: new Date().toISOString(), command,
        exitCode: typeof code === 'number' ? code : null,
        signal: signal || null, pid: child.pid, attempt,
      });
    });
  });
}

/**
 * Run with retry logic. Retries up to MAX_RETRIES times on retryable failures.
 *
 * @param {object} opts - same as runOnce, minus attempt (managed internally)
 * @param {Function} [opts.sleepFn] - injectable sleep (for testing)
 * @returns {Promise<object>}
 */
async function runWithRetry(opts) {
  const { sleepFn = sleepMs, ...runOpts } = opts;
  let result;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    result = await runOnce({ ...runOpts, attempt });

    if (result.state === 'done' || NON_RETRYABLE_STATES.has(result.state)) {
      return result;
    }

    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
      await sleepFn(delay);
    }
  }

  return result;
}

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

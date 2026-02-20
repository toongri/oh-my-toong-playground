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
 * Run a single attempt of the command.
 * Returns a Promise that resolves to the final status payload (never rejects).
 */
function runOnce({ command, prompt, member, safeMember, jobDir, timeoutSec, attempt }) {
  return new Promise((resolve) => {
    const membersRoot = path.join(jobDir, 'members');
    const memberDir = path.join(membersRoot, safeMember);
    const statusPath = path.join(memberDir, 'status.json');
    const outPath = path.join(memberDir, 'output.txt');
    const errPath = path.join(memberDir, 'error.txt');

    const tokens = splitCommand(command);
    if (!tokens || tokens.length === 0) {
      const payload = {
        member,
        state: 'error',
        message: 'Invalid command string',
        finishedAt: new Date().toISOString(),
        command,
        attempt,
      };
      atomicWriteJson(statusPath, payload);
      return resolve(payload);
    }

    const program = tokens[0];
    const args = tokens.slice(1);

    atomicWriteJson(statusPath, {
      member,
      state: 'running',
      startedAt: new Date().toISOString(),
      command,
      pid: null,
      attempt,
    });

    const outStream = fs.createWriteStream(outPath, { flags: 'w' });
    const errStream = fs.createWriteStream(errPath, { flags: 'w' });

    let child;
    try {
      child = spawn(program, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      const payload = {
        member,
        state: 'error',
        message: error && error.message ? error.message : 'Failed to spawn command',
        finishedAt: new Date().toISOString(),
        command,
        attempt,
      };
      atomicWriteJson(statusPath, payload);
      return resolve(payload);
    }

    // Write prompt to stdin
    if (child.stdin) {
      child.stdin.on('error', () => {
        // ignore broken pipe
      });
      child.stdin.write(prompt);
      child.stdin.end();
    }

    atomicWriteJson(statusPath, {
      member,
      state: 'running',
      startedAt: new Date().toISOString(),
      command,
      pid: child.pid,
      attempt,
    });

    if (child.stdout) child.stdout.pipe(outStream);
    if (child.stderr) child.stderr.pipe(errStream);

    let timeoutHandle = null;
    let timeoutTriggered = false;
    if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
      timeoutHandle = setTimeout(() => {
        timeoutTriggered = true;
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch {
          // ignore
        }
      }, timeoutSec * 1000);
      timeoutHandle.unref();
    }

    const finalize = (payload) => {
      try {
        outStream.end();
        errStream.end();
      } catch {
        // ignore
      }
      atomicWriteJson(statusPath, payload);
      resolve(payload);
    };

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const isMissing = error && error.code === 'ENOENT';
      finalize({
        member,
        state: isMissing ? 'missing_cli' : 'error',
        message: error && error.message ? error.message : 'Process error',
        finishedAt: new Date().toISOString(),
        command,
        exitCode: null,
        pid: child.pid,
        attempt,
      });
    });

    child.on('exit', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
      const canceled = !timedOut && signal === 'SIGTERM';
      finalize({
        member,
        state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
        message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
        finishedAt: new Date().toISOString(),
        command,
        exitCode: typeof code === 'number' ? code : null,
        signal: signal || null,
        pid: child.pid,
        attempt,
      });
    });
  });
}

/**
 * Run the command with retry logic.
 * Retries up to MAX_RETRIES times on retryable failures.
 * sleepFn is injectable for testing.
 */
async function runWithRetry({ command, prompt, member, safeMember, jobDir, timeoutSec, sleepFn }) {
  const sleep = sleepFn || sleepMs;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await runOnce({
      command,
      prompt,
      member,
      safeMember,
      jobDir,
      timeoutSec,
      attempt,
    });

    // Success or non-retryable: return immediately
    if (result.state === 'done' || NON_RETRYABLE_STATES.has(result.state)) {
      return result;
    }

    // Last attempt: return the error result
    if (attempt >= MAX_RETRIES) {
      return result;
    }

    // Retry with exponential backoff + jitter
    const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
    await sleep(delay);
  }
}

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

if (require.main === module) {
  main();
}

module.exports = { splitCommand, atomicWriteJson, sleepMs, runOnce, runWithRetry };

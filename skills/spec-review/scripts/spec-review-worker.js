#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

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
  const statusPath = path.join(reviewerDir, 'status.json');
  const outPath = path.join(reviewerDir, 'output.txt');
  const errPath = path.join(reviewerDir, 'error.txt');

  const promptPath = path.join(jobDir, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    atomicWriteJson(statusPath, {
      reviewer,
      state: 'error',
      message: 'Invalid command string',
      finishedAt: new Date().toISOString(),
      command,
    });
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  atomicWriteJson(statusPath, {
    reviewer,
    state: 'running',
    startedAt: new Date().toISOString(),
    command,
    pid: null,
  });

  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  const errStream = fs.createWriteStream(errPath, { flags: 'w' });

  let child;
  try {
    child = spawn(program, [...args, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (error) {
    atomicWriteJson(statusPath, {
      reviewer,
      state: 'error',
      message: error && error.message ? error.message : 'Failed to spawn command',
      finishedAt: new Date().toISOString(),
      command,
    });
    process.exit(1);
  }

  atomicWriteJson(statusPath, {
    reviewer,
    state: 'running',
    startedAt: new Date().toISOString(),
    command,
    pid: child.pid,
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
  };

  child.on('error', (error) => {
    const isMissing = error && error.code === 'ENOENT';
    finalize({
      reviewer,
      state: isMissing ? 'missing_cli' : 'error',
      message: error && error.message ? error.message : 'Process error',
      finishedAt: new Date().toISOString(),
      command,
      exitCode: null,
      pid: child.pid,
    });
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
    const canceled = !timedOut && signal === 'SIGTERM';
    finalize({
      reviewer,
      state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
      message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
      finishedAt: new Date().toISOString(),
      command,
      exitCode: typeof code === 'number' ? code : null,
      signal: signal || null,
      pid: child.pid,
    });
    process.exit(code === 0 ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const PROJECT_ROOT = path.resolve(SKILL_DIR, '../..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'chunk-review-worker.js');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'chunk-review.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'chunk-review.config.yaml');

const UI_STRINGS = {
  dispatch: {
    completed: 'Dispatched review prompts',
    inProgress: 'Dispatching review prompts',
  },
  synthesize: {
    completed: 'Chunk review results ready',
    inProgress: 'Ready to synthesize',
    pending: 'Waiting to synthesize',
  },
};

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function detectHostRole(skillDir) {
  const normalized = skillDir.replace(/\\/g, '/');
  if (normalized.includes('/.claude/skills/')) return 'claude';
  if (normalized.includes('/.codex/skills/')) return 'codex';
  return 'unknown';
}

function normalizeBool(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

function resolveAutoRole(role, hostRole) {
  const roleLc = String(role || '').trim().toLowerCase();
  if (roleLc && roleLc !== 'auto') return roleLc;
  if (hostRole === 'codex') return 'codex';
  if (hostRole === 'claude') return 'claude';
  return 'claude';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFileName(name, fallback) {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return cleaned || (fallback || 'reviewer');
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  const msNum = Number(ms);
  if (!Number.isFinite(msNum) || msNum <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.trunc(msNum));
}

function computeTerminalDoneCount(counts) {
  const c = counts || {};
  return (
    Number(c.done || 0) +
    Number(c.missing_cli || 0) +
    Number(c.error || 0) +
    Number(c.timed_out || 0) +
    Number(c.canceled || 0)
  );
}

function asCodexStepStatus(value) {
  const v = String(value || '');
  if (v === 'pending' || v === 'in_progress' || v === 'completed') return v;
  return 'pending';
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  const booleanFlags = new Set([
    'json',
    'text',
    'checklist',
    'help',
    'h',
    'verbose',
    'include-chairman',
    'exclude-chairman',
    'stdin',
    'blocking',
  ]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }

    const eqIdx = a.indexOf('=');
    if (eqIdx !== -1) {
      out[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
      continue;
    }

    const normalizedKey = a.slice(2);
    if (booleanFlags.has(normalizedKey)) {
      out[normalizedKey] = true;
      continue;
    }

    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[normalizedKey] = true;
      continue;
    }
    out[normalizedKey] = next;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wait cursor utilities
// ---------------------------------------------------------------------------

function parseWaitCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  const version = parts[0];
  if (version === 'v1' && parts.length === 4) {
    const bucketSize = Number(parts[1]);
    const doneBucket = Number(parts[2]);
    const isDone = parts[3] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket: 0, doneBucket, isDone };
  }
  if (version === 'v2' && parts.length === 5) {
    const bucketSize = Number(parts[1]);
    const dispatchBucket = Number(parts[2]);
    const doneBucket = Number(parts[3]);
    const isDone = parts[4] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(dispatchBucket) || dispatchBucket < 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket, doneBucket, isDone };
  }
  return null;
}

function formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone) {
  return `v2:${bucketSize}:${dispatchBucket}:${doneBucket}:${isDone ? 1 : 0}`;
}

function resolveBucketSize(options, total, prevCursor) {
  const raw = options.bucket != null ? options.bucket : options['bucket-size'];

  if (raw == null || raw === true) {
    if (prevCursor && prevCursor.bucketSize) return prevCursor.bucketSize;
  } else {
    const asString = String(raw).trim().toLowerCase();
    if (asString !== 'auto') {
      const num = Number(asString);
      if (!Number.isFinite(num) || num <= 0) exitWithError(`wait: invalid --bucket: ${raw}`);
      return Math.trunc(num);
    }
  }

  const totalNum = Number(total || 0);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return 1;
  return Math.max(1, Math.ceil(totalNum / 5));
}

// ---------------------------------------------------------------------------
// Job ID generation
// ---------------------------------------------------------------------------

function generateJobId() {
  return `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)}-${crypto
    .randomBytes(3)
    .toString('hex')}`;
}

// ---------------------------------------------------------------------------
// CLI detection & augmented command construction
// ---------------------------------------------------------------------------

function detectCliType(command) {
  if (!command) return 'unknown';
  const firstToken = String(command).trim().split(/\s+/)[0];
  if (['claude', 'gemini', 'codex'].includes(firstToken)) return firstToken;
  return 'unknown';
}

function buildAugmentedCommand(reviewer, cliType) {
  const parts = [String(reviewer.command)];
  const env = {};

  // model
  if (reviewer.model) {
    if (cliType === 'codex') {
      parts.push('-m', String(reviewer.model));
    } else {
      parts.push('--model', String(reviewer.model));
    }
  }

  // nested session guard
  if (cliType === 'claude') {
    env.CLAUDECODE = '';
  }

  // effort_level
  if (reviewer.effort_level) {
    if (cliType === 'claude') {
      env.CLAUDE_CODE_EFFORT_LEVEL = String(reviewer.effort_level);
    } else if (cliType === 'codex') {
      parts.push('-c', `model_reasoning_effort=${reviewer.effort_level}`);
    }
    // gemini/unknown: ignored
  }

  // output_format
  if (reviewer.output_format && reviewer.output_format !== 'text') {
    if (cliType === 'claude' || cliType === 'gemini') {
      parts.push('--output-format', String(reviewer.output_format));
    } else if (cliType === 'codex') {
      parts.push('--json');
    }
    // unknown: ignored
  }

  return { command: parts.join(' '), env };
}

// ---------------------------------------------------------------------------
// Worker spawning
// ---------------------------------------------------------------------------

function spawnWorkers({ reviewers, workerPath, jobDir, reviewersDir, timeoutSec }) {
  // Detect safe name collisions before spawning
  const safeNames = new Map();
  for (const reviewer of reviewers) {
    const name = String(reviewer.name);
    const safeName = safeFileName(name, 'reviewer');
    if (safeNames.has(safeName)) {
      exitWithError(`start: reviewer name collision — "${name}" and "${safeNames.get(safeName)}" both map to safe name "${safeName}"`);
    }
    safeNames.set(safeName, name);
  }

  for (const reviewer of reviewers) {
    const name = String(reviewer.name);
    const safeName = safeFileName(name, 'reviewer');
    const reviewerDir = path.join(reviewersDir, safeName);
    ensureDir(reviewerDir);

    atomicWriteJson(path.join(reviewerDir, 'status.json'), {
      reviewer: name,
      state: 'queued',
      queuedAt: new Date().toISOString(),
      command: String(reviewer.command),
    });

    const cliType = detectCliType(reviewer.command);
    const augmented = buildAugmentedCommand(reviewer, cliType);

    const workerArgs = [
      workerPath,
      '--job-dir', jobDir,
      '--reviewer', name,
      '--safe-reviewer', safeName,
      '--command', augmented.command,
    ];
    for (const [key, value] of Object.entries(augmented.env)) {
      workerArgs.push('--env', `${key}=${value}`);
    }
    if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
      workerArgs.push('--timeout', String(timeoutSec));
    }

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  }
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

function computeStatus(jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError(`job.json not found: ${path.join(resolvedJobDir, 'job.json')}`);

  const reviewersRoot = path.join(resolvedJobDir, 'reviewers');
  if (!fs.existsSync(reviewersRoot)) exitWithError(`reviewers folder not found: ${reviewersRoot}`);

  // Staleness threshold: Math.max(2 * timeoutSec, 120) seconds
  const timeoutSec = (jobMeta.settings && Number.isFinite(Number(jobMeta.settings.timeoutSec)))
    ? Number(jobMeta.settings.timeoutSec)
    : 0;
  const stalenessThresholdMs = Math.max(2 * timeoutSec, 120) * 1000;

  const reviewers = [];
  for (const entry of fs.readdirSync(reviewersRoot)) {
    const statusPath = path.join(reviewersRoot, entry, 'status.json');
    let status = readJsonIfExists(statusPath);
    if (!status) continue;

    // Staleness check for queued reviewers
    if (status.state === 'queued') {
      let queuedTs;
      if (status.queuedAt) {
        queuedTs = new Date(status.queuedAt).getTime();
      } else {
        // Fallback to file mtime
        try { queuedTs = fs.statSync(statusPath).mtimeMs; } catch { queuedTs = Date.now(); }
      }
      const elapsed = Date.now() - queuedTs;
      if (elapsed > stalenessThresholdMs) {
        // CAS pattern: sleep then re-read to avoid race with worker startup
        sleepMs(250);
        const recheck = readJsonIfExists(statusPath);
        if (recheck && recheck.state === 'queued') {
          const errorPayload = {
            ...recheck,
            state: 'error',
            error: `Worker stale: no progress for ${Math.round(elapsed / 1000)} seconds`,
          };
          atomicWriteJson(statusPath, errorPayload);
          status = errorPayload;
        } else if (recheck) {
          status = recheck;
        }
      }
    }

    reviewers.push({ safeName: entry, ...status });
  }

  const totals = { queued: 0, running: 0, retrying: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 };
  for (const r of reviewers) {
    const state = String(r.state || 'unknown');
    if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
  }

  const allDone = totals.running === 0 && totals.queued === 0 && totals.retrying === 0;
  const overallState = allDone ? 'done' : (totals.running > 0 || totals.retrying > 0) ? 'running' : 'queued';

  return {
    jobDir: resolvedJobDir,
    id: jobMeta.id || null,
    chairmanRole: jobMeta.chairmanRole || null,
    overallState,
    counts: { total: reviewers.length, ...totals },
    reviewers: reviewers
      .map((r) => ({
        reviewer: r.reviewer,
        state: r.state,
        startedAt: r.startedAt || null,
        finishedAt: r.finishedAt || null,
        exitCode: r.exitCode != null ? r.exitCode : null,
        message: r.message || null,
      }))
      .sort((a, b) => String(a.reviewer).localeCompare(String(b.reviewer))),
  };
}

// ---------------------------------------------------------------------------
// UI payload
// ---------------------------------------------------------------------------

function buildUiPayload(statusPayload) {
  const counts = statusPayload.counts || {};
  const done = computeTerminalDoneCount(counts);
  const total = Number(counts.total || 0);
  const isDone = String(statusPayload.overallState || '') === 'done';

  const queued = Number(counts.queued || 0);
  const running = Number(counts.running || 0);

  const reviewersArray = Array.isArray(statusPayload.reviewers) ? statusPayload.reviewers : [];
  const sortedReviewers = reviewersArray
    .map((r) => ({
      entity: r && r.reviewer != null ? String(r.reviewer) : '',
      state: r && r.state != null ? String(r.state) : 'unknown',
      exitCode: r && r.exitCode != null ? r.exitCode : null,
    }))
    .filter((r) => r.entity)
    .sort((a, b) => a.entity.localeCompare(b.entity));

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled']);
  const dispatchStatus = asCodexStepStatus(isDone ? 'completed' : queued > 0 ? 'in_progress' : 'completed');
  let hasInProgress = dispatchStatus === 'in_progress';

  const reviewerSteps = sortedReviewers.map((r) => {
    const state = r.state || 'unknown';
    const isTerminal = terminalStates.has(state);

    let status;
    if (isTerminal) {
      status = 'completed';
    } else if (!hasInProgress && running > 0 && state === 'running') {
      status = 'in_progress';
      hasInProgress = true;
    } else {
      status = 'pending';
    }

    const label = `[Chunk Review] Ask ${r.entity}`;
    return { label, status: asCodexStepStatus(status) };
  });

  const synthStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const codexPlan = [
    { step: '[Chunk Review] Prompt dispatch', status: dispatchStatus },
    ...reviewerSteps.map((s) => ({ step: s.label, status: s.status })),
    { step: '[Chunk Review] Synthesize', status: synthStatus },
  ];

  const claudeTodos = [
    {
      content: '[Chunk Review] Prompt dispatch',
      status: dispatchStatus,
      activeForm: dispatchStatus === 'completed'
        ? UI_STRINGS.dispatch.completed
        : UI_STRINGS.dispatch.inProgress,
    },
    ...reviewerSteps.map((s) => ({
      content: s.label,
      status: s.status,
      activeForm: s.status === 'completed' ? 'Finished' : 'Awaiting response',
    })),
    {
      content: '[Chunk Review] Synthesize',
      status: synthStatus,
      activeForm:
        synthStatus === 'completed'
          ? UI_STRINGS.synthesize.completed
          : synthStatus === 'in_progress'
            ? UI_STRINGS.synthesize.inProgress
            : UI_STRINGS.synthesize.pending,
    },
  ];

  return {
    progress: { done, total, overallState: String(statusPayload.overallState || '') },
    codex: { update_plan: { plan: codexPlan } },
    claude: { todo_write: { todos: claudeTodos } },
  };
}

// ---------------------------------------------------------------------------
// Wait payload
// ---------------------------------------------------------------------------

function asWaitPayload(statusPayload) {
  const reviewersArray = Array.isArray(statusPayload.reviewers) ? statusPayload.reviewers : [];

  return {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    chairmanRole: statusPayload.chairmanRole,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    reviewers: reviewersArray.map((r) => ({
      reviewer: r.reviewer,
      state: r.state,
      exitCode: r.exitCode != null ? r.exitCode : null,
      message: r.message || null,
    })),
    ui: buildUiPayload(statusPayload),
  };
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function cmdStatus(options, jobDir) {
  const payload = computeStatus(jobDir);

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    process.stdout.write(`Chunk Review${headerId}\n`);
    process.stdout.write(
      `Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`
    );
    for (const r of payload.reviewers) {
      const state = String(r.state || '');
      const mark =
        state === 'done'
          ? '[x]'
          : state === 'running' || state === 'queued'
            ? '[ ]'
            : state
              ? '[!]'
              : '[ ]';
      const exitInfo = r.exitCode != null ? ` (exit ${r.exitCode})` : '';
      process.stdout.write(`${mark} ${r.reviewer} \u2014 ${state}${exitInfo}\n`);
    }
    return;
  }

  const wantText = Boolean(options.text) && !options.json;
  if (wantText) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`reviewers ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const r of payload.reviewers) {
        process.stdout.write(`- ${r.reviewer}: ${r.state}${r.exitCode != null ? ` (exit ${r.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function cmdWait(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const cursorFilePath = path.join(resolvedJobDir, '.wait_cursor');
  const prevCursorRaw =
    options.cursor != null
      ? String(options.cursor)
      : fs.existsSync(cursorFilePath)
        ? String(fs.readFileSync(cursorFilePath, 'utf8')).trim()
        : '';
  const prevCursor = parseWaitCursor(prevCursorRaw);

  const intervalMsRaw = options['interval-ms'] != null ? options['interval-ms'] : 250;
  const intervalMs = Math.max(50, Math.trunc(Number(intervalMsRaw)));
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) exitWithError(`wait: invalid --interval-ms: ${intervalMsRaw}`);

  const timeoutMsRaw = options['timeout-ms'] != null ? options['timeout-ms'] : 600000;
  const timeoutMs = Math.trunc(Number(timeoutMsRaw));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) exitWithError(`wait: invalid --timeout-ms: ${timeoutMsRaw}`);

  let payload = computeStatus(jobDir);
  const bucketSize = resolveBucketSize(options, payload.counts.total, prevCursor);

  const doneCount = computeTerminalDoneCount(payload.counts);
  const isDone = payload.overallState === 'done';
  const total = Number(payload.counts.total || 0);
  const queued = Number(payload.counts.queued || 0);
  const dispatchBucket = queued === 0 && total > 0 ? 1 : 0;
  const doneBucket = Math.floor(doneCount / bucketSize);
  const cursor = formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone);

  if (!prevCursor) {
    fs.writeFileSync(cursorFilePath, cursor, 'utf8');
    process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor }, null, 2)}\n`);
    return;
  }

  const start = Date.now();
  while (cursor === prevCursorRaw) {
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
    sleepMs(intervalMs);
    payload = computeStatus(jobDir);
    const d = computeTerminalDoneCount(payload.counts);
    const doneFlag = payload.overallState === 'done';
    const totalCount = Number(payload.counts.total || 0);
    const queuedCount = Number(payload.counts.queued || 0);
    const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
    const doneB = Math.floor(d / bucketSize);
    const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
    if (nextCursor !== prevCursorRaw) {
      fs.writeFileSync(cursorFilePath, nextCursor, 'utf8');
      process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor: nextCursor }, null, 2)}\n`);
      return;
    }
  }

  const finalPayload = computeStatus(jobDir);
  const finalDone = computeTerminalDoneCount(finalPayload.counts);
  const finalDoneFlag = finalPayload.overallState === 'done';
  const finalTotal = Number(finalPayload.counts.total || 0);
  const finalQueued = Number(finalPayload.counts.queued || 0);
  const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
  const finalDoneBucket = Math.floor(finalDone / bucketSize);
  const finalCursor = formatWaitCursor(bucketSize, finalDispatchBucket, finalDoneBucket, finalDoneFlag);
  fs.writeFileSync(cursorFilePath, finalCursor, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...asWaitPayload(finalPayload), cursor: finalCursor }, null, 2)}\n`);
}

function cmdResults(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  const reviewersRoot = path.join(resolvedJobDir, 'reviewers');

  const reviewers = [];
  if (fs.existsSync(reviewersRoot)) {
    for (const entry of fs.readdirSync(reviewersRoot)) {
      const statusPath = path.join(reviewersRoot, entry, 'status.json');
      const outputPath = path.join(reviewersRoot, entry, 'output.txt');
      const errorPath = path.join(reviewersRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      reviewers.push({ safeName: entry, ...status, output, stderr });
    }
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          jobDir: resolvedJobDir,
          id: jobMeta ? jobMeta.id : null,
          prompt: fs.existsSync(path.join(resolvedJobDir, 'prompt.txt'))
            ? fs.readFileSync(path.join(resolvedJobDir, 'prompt.txt'), 'utf8')
            : null,
          reviewers: reviewers
            .map((r) => ({
              reviewer: r.reviewer,
              state: r.state,
              exitCode: r.exitCode != null ? r.exitCode : null,
              message: r.message || null,
              output: r.output,
              stderr: r.stderr,
            }))
            .sort((a, b) => String(a.reviewer).localeCompare(String(b.reviewer))),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  for (const r of reviewers.sort((a, b) => String(a.reviewer).localeCompare(String(b.reviewer)))) {
    process.stdout.write(`\n=== ${r.reviewer} (${r.state}) ===\n`);
    if (r.message) process.stdout.write(`${r.message}\n`);
    process.stdout.write(r.output || '');
    if (!r.output && r.stderr) {
      process.stdout.write('\n');
      process.stdout.write(r.stderr);
    }
    process.stdout.write('\n');
  }
}

function cmdStop(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const reviewersRoot = path.join(resolvedJobDir, 'reviewers');
  if (!fs.existsSync(reviewersRoot)) exitWithError(`No reviewers folder found: ${reviewersRoot}`);

  let stoppedAny = false;
  for (const entry of fs.readdirSync(reviewersRoot)) {
    const statusPath = path.join(reviewersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (!status) continue;
    if (status.state !== 'running') continue;
    if (!status.pid) continue;

    try {
      process.kill(Number(status.pid), 'SIGTERM');
      stoppedAny = true;
    } catch {
      // ignore
    }
  }

  process.stdout.write(stoppedAny ? `stop: sent SIGTERM to running reviewers\n` : `stop: no running reviewers\n`);
}

function cmdClean(options, jobDir) {
  const jobsDir = path.resolve(
    options['jobs-dir'] || process.env.CHUNK_REVIEW_JOBS_DIR || path.join(PROJECT_ROOT, '.omt', 'jobs')
  );
  const resolvedJobDir = path.resolve(jobDir);

  // Path traversal guard: ensure target is under the configured jobs directory
  const relative = path.relative(jobsDir, resolvedJobDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    exitWithError(`clean: refusing to delete path outside jobs directory: ${resolvedJobDir} (jobsDir: ${jobsDir})`);
  }

  fs.rmSync(resolvedJobDir, { recursive: true, force: true });
  process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// ---------------------------------------------------------------------------
// Chunk-review-specific config parsing
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

function parseChunkReviewConfig(configPath) {
  const fallback = {
    'chunk-review': {
      chairman: { role: 'auto' },
      reviewers: [
        { name: 'claude', command: 'claude -p', emoji: '\u{1F9E0}', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '\u{1F916}', color: 'BLUE' },
        { name: 'gemini', command: 'gemini', emoji: '\u{1F48E}', color: 'GREEN' },
      ],
      settings: { exclude_chairman_from_reviewers: true, timeout: 300 },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  let YAML;
  try {
    YAML = require('yaml');
  } catch {
    return parseYamlSimple(configPath, fallback);
  }

  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    exitWithError(`Invalid YAML in ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    exitWithError(`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`);
  }
  if (!parsed['chunk-review']) {
    exitWithError(`Invalid config in ${configPath}: missing required top-level key 'chunk-review:'`);
  }
  if (typeof parsed['chunk-review'] !== 'object' || Array.isArray(parsed['chunk-review'])) {
    exitWithError(`Invalid config in ${configPath}: 'chunk-review' must be a mapping/object`);
  }

  const merged = {
    'chunk-review': {
      chairman: { ...fallback['chunk-review'].chairman },
      reviewers: Array.isArray(fallback['chunk-review'].reviewers) ? [...fallback['chunk-review'].reviewers] : [],
      settings: { ...fallback['chunk-review'].settings },
    },
  };

  const chunkReview = parsed['chunk-review'];

  if (chunkReview.chairman != null) {
    if (typeof chunkReview.chairman !== 'object' || Array.isArray(chunkReview.chairman)) {
      exitWithError(`Invalid config in ${configPath}: 'chunk-review.chairman' must be a mapping/object`);
    }
    merged['chunk-review'].chairman = { ...merged['chunk-review'].chairman, ...chunkReview.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(chunkReview, 'reviewers')) {
    if (!Array.isArray(chunkReview.reviewers)) {
      exitWithError(`Invalid config in ${configPath}: 'chunk-review.reviewers' must be a list/array`);
    }
    merged['chunk-review'].reviewers = chunkReview.reviewers;
  }

  if (chunkReview.settings != null) {
    if (typeof chunkReview.settings !== 'object' || Array.isArray(chunkReview.settings)) {
      exitWithError(`Invalid config in ${configPath}: 'chunk-review.settings' must be a mapping/object`);
    }
    merged['chunk-review'].settings = { ...merged['chunk-review'].settings, ...chunkReview.settings };
  }

  return merged;
}

// Limitations: Flat key-value pairs only. Does not support nested objects,
// multi-line strings, YAML arrays, anchors, flow mappings, or block scalars.
// Install the 'yaml' package for full YAML support.
function parseYamlSimple(configPath, fallback) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    const result = { 'chunk-review': { chairman: {}, reviewers: [], settings: {} } };
    let currentSection = null;
    let currentReviewer = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === 'chunk-review:') continue;
      if (trimmed === 'chairman:') { currentSection = 'chairman'; continue; }
      if (trimmed === 'reviewers:' || trimmed === 'members:') { currentSection = 'reviewers'; continue; }
      if (trimmed === 'settings:') { currentSection = 'settings'; continue; }

      if (currentSection === 'reviewers' && trimmed.startsWith('- name:')) {
        if (currentReviewer) result['chunk-review'].reviewers.push(currentReviewer);
        currentReviewer = { name: trimmed.replace('- name:', '').trim().replace(/"/g, '') };
        continue;
      }

      if (currentReviewer && currentSection === 'reviewers') {
        const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (match) {
          currentReviewer[match[1]] = match[2].replace(/^"(.*)"$/, '$1').trim();
        }
        continue;
      }

      if (currentSection === 'chairman' || currentSection === 'settings') {
        const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (match) {
          let value = match[2].replace(/^"(.*)"$/, '$1').trim();
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          result['chunk-review'][currentSection][match[1]] = value;
        }
      }
    }

    if (currentReviewer) result['chunk-review'].reviewers.push(currentReviewer);

    if (result['chunk-review'].reviewers.length === 0) {
      result['chunk-review'].reviewers = fallback['chunk-review'].reviewers;
    }
    result['chunk-review'].chairman = { ...fallback['chunk-review'].chairman, ...result['chunk-review'].chairman };
    result['chunk-review'].settings = { ...fallback['chunk-review'].settings, ...result['chunk-review'].settings };

    return result;
  } catch (e) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Chunk-review-specific start command
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(`Chunk Review (job mode)

Usage:
  chunk-review-job.sh start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  chunk-review-job.sh start --stdin
  chunk-review-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  chunk-review-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  chunk-review-job.sh results [--json] <jobDir>
  chunk-review-job.sh stop <jobDir>
  chunk-review-job.sh clean <jobDir>

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

function cmdStart(options, prompt) {
  const configPath = options.config || process.env.CHUNK_REVIEW_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.CHUNK_REVIEW_JOBS_DIR || path.join(PROJECT_ROOT, '.omt', 'jobs');

  ensureDir(jobsDir);

  const hostRole = detectHostRole(SKILL_DIR);
  const config = parseChunkReviewConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.CHUNK_REVIEW_CHAIRMAN || config['chunk-review'].chairman.role || 'auto';
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairmanValue = normalizeBool(options['include-chairman']);
  const includeChairman = includeChairmanValue === true;
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? normalizeBool(options['exclude-chairman']) : includeChairmanValue === true ? false : null;

  const excludeSetting = normalizeBool(config['chunk-review'].settings.exclude_chairman_from_reviewers);
  const excludeChairmanFromReviewers =
    excludeChairmanOverride != null ? excludeChairmanOverride : excludeSetting != null ? excludeSetting : true;

  const timeoutSetting = Number(config['chunk-review'].settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedReviewers = config['chunk-review'].reviewers || [];
  const reviewers = requestedReviewers.filter((r) => {
    if (!r || !r.name || !r.command) return false;
    const nameLc = String(r.name).toLowerCase();
    if (excludeChairmanFromReviewers && !includeChairman && nameLc === chairmanRole) return false;
    return true;
  });

  if (reviewers.length === 0) exitWithError('start: no reviewers remaining after filtering');

  const jobId = generateJobId();
  const jobDir = path.join(jobsDir, `chunk-review-${jobId}`);
  const reviewersDir = path.join(jobDir, 'reviewers');
  ensureDir(reviewersDir);

  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), String(prompt), 'utf8');

  const jobMeta = {
    id: `chunk-review-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    hostRole,
    chairmanRole,
    settings: {
      excludeChairmanFromReviewers,
      timeoutSec: timeoutSec || null,
    },
    reviewers: reviewers.map((r) => ({
      name: String(r.name),
      command: String(r.command),
      emoji: r.emoji ? String(r.emoji) : null,
      color: r.color ? String(r.color) : null,
      model: r.model || null,
      effort_level: r.effort_level || null,
      output_format: r.output_format || null,
    })),
  };
  atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  spawnWorkers({
    reviewers,
    workerPath: WORKER_PATH,
    jobDir,
    reviewersDir,
    timeoutSec,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv);
  const [command, ...rest] = options._;

  if (!command || options.help || options.h) {
    printHelp();
    return;
  }

  if (command === 'start') {
    let prompt;
    if (options.stdin) {
      prompt = fs.readFileSync(0, 'utf8');
    } else {
      prompt = rest.join(' ').trim();
    }
    if (!prompt) exitWithError('start: missing prompt');
    cmdStart(options, prompt);
    return;
  }
  if (command === 'status') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('status: missing jobDir');
    cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('wait: missing jobDir');
    cmdWait(options, jobDir);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('results: missing jobDir');
    cmdResults(options, jobDir);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('stop: missing jobDir');
    cmdStop(options, jobDir);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('clean: missing jobDir');
    cmdClean(options, jobDir);
    return;
  }

  exitWithError(`Unknown command: ${command}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
  safeFileName,
  atomicWriteJson,
  readJsonIfExists,
  sleepMs,
  computeTerminalDoneCount,
  asCodexStepStatus,
  parseArgs,
  parseWaitCursor,
  formatWaitCursor,
  resolveBucketSize,
  generateJobId,
  buildUiPayload,
  parseChunkReviewConfig,
  parseYamlSimple,
  computeStatus,
  detectCliType,
  buildAugmentedCommand,
};

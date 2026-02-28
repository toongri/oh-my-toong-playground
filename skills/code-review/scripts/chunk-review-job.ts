#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import {
  exitWithError,
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
  safeFileName as _safeFileName,
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
} from '../../../lib/job-utils';

import { initLogger, logInfo, logStart, logEnd } from '../../../lib/logging';

// Chunk-review default fallback is 'reviewer' (shared module defaults to 'member')
function safeFileName(name, fallback) {
  return _safeFileName(name, fallback || 'reviewer');
}

const SCRIPT_DIR = import.meta.dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const PROJECT_ROOT = path.resolve(SKILL_DIR, '../..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'chunk-review-worker.ts');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'chunk-review.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'chunk-review.config.yaml');

const GC_MAX_AGE_MS = 3_600_000; // 1 hour

function gcStaleJobs(jobsDir: string): void {
  try {
    const resolvedJobsDir = fs.realpathSync(jobsDir);
    const entries = fs.readdirSync(jobsDir);
    for (const entry of entries) {
      if (!/^chunk-review-/.test(entry)) continue;

      const candidatePath = path.join(jobsDir, entry);

      // Path traversal guard — resolve symlinks before comparing
      let realCandidatePath: string;
      try {
        realCandidatePath = fs.realpathSync(candidatePath);
      } catch {
        continue;
      }
      const relative = path.relative(resolvedJobsDir, realCandidatePath);
      const isUnder = !relative.startsWith('..') && !path.isAbsolute(relative);
      if (!isUnder) continue;

      let jobMeta: any;
      try {
        jobMeta = readJsonIfExists(path.join(candidatePath, 'job.json'));
      } catch {
        continue;
      }
      if (!jobMeta || !jobMeta.createdAt) continue;

      const createdAtMs = new Date(jobMeta.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) continue;

      const age = Date.now() - createdAtMs;
      if (age > GC_MAX_AGE_MS) {
        fs.rmSync(candidatePath, { recursive: true, force: true });
      }
    }
  } catch {
    // GC is best-effort — never block cmdStart
  }
}

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
// Chunk-review custom boolean flags for parseArgs
// ---------------------------------------------------------------------------

const CHUNK_REVIEW_BOOLEAN_FLAGS = new Set([
  'json', 'text', 'checklist', 'help', 'h', 'verbose', 'manifest',
  'include-chairman', 'exclude-chairman', 'stdin', 'blocking',
]);

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

    // Staleness check for running reviewers
    if (status.state === 'running' && status.startedAt) {
      const startedTs = new Date(status.startedAt).getTime();
      const runningElapsed = Date.now() - startedTs;
      const runningThresholdMs = (timeoutSec + 60) * 1000;
      if (runningElapsed > runningThresholdMs) {
        // CAS pattern: sleep then re-read to avoid race with legitimate completion
        sleepMs(250);
        const recheck = readJsonIfExists(statusPath);
        if (recheck && recheck.state === 'running') {
          const errorPayload = {
            ...recheck,
            state: 'error',
            error: `Worker stale: running for ${Math.round(runningElapsed / 1000)} seconds without completion`,
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

  const totals = { queued: 0, running: 0, retrying: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0, non_retryable: 0 };
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

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled', 'non_retryable']);
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
// Logging helper for non-start commands (extract jobId from jobDir path)
// ---------------------------------------------------------------------------

function initLoggerFromJobDir(jobDir: string): void {
  const jobId = path.basename(jobDir).replace(/^chunk-review-/, '');
  initLogger('chunk-review-job', PROJECT_ROOT, jobId);
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function cmdStatus(options, jobDir) {
  initLoggerFromJobDir(jobDir);
  logInfo(`status: ${path.resolve(jobDir)}`);
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
  initLoggerFromJobDir(jobDir);
  logInfo(`wait: ${path.resolve(jobDir)}`);
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

// ---------------------------------------------------------------------------
// Manifest builder (shared by cmdResults --manifest and cmdCollect)
// ---------------------------------------------------------------------------

function buildManifest(jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  const reviewersRoot = path.join(resolvedJobDir, 'reviewers');

  const jobId = jobMeta ? jobMeta.id : 'unknown';
  const reviewers = [];
  if (fs.existsSync(reviewersRoot)) {
    for (const entry of fs.readdirSync(reviewersRoot)) {
      const statusPath = path.join(reviewersRoot, entry, 'status.json');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const outputPath = path.join(reviewersRoot, entry, 'output.txt');
      const hasOutput = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      reviewers.push({
        reviewer: status.reviewer,
        outputFilePath: hasOutput ? outputPath : null,
        errorMessage: hasOutput ? null : (status.message || status.state),
        _safeName: entry,
      });
    }
  }

  return {
    id: jobId,
    reviewers: reviewers
      .map(({ _safeName, ...rest }) => rest)
      .sort((a, b) => String(a.reviewer).localeCompare(String(b.reviewer))),
  };
}

function cmdResults(options, jobDir) {
  initLoggerFromJobDir(jobDir);
  logInfo(`results: ${path.resolve(jobDir)}`);
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

  if (options.manifest) {
    const manifest = buildManifest(jobDir);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          jobDir: resolvedJobDir,
          id: jobMeta ? jobMeta.id : null,
          reviewers: reviewers
            .map((r) => ({
              reviewer: r.reviewer,
              state: r.state,
              exitCode: r.exitCode != null ? r.exitCode : null,
              message: r.message || null,
              output: r.output,
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

// ---------------------------------------------------------------------------
// Collect: poll until done then return manifest
// ---------------------------------------------------------------------------

const COLLECT_POLL_INTERVAL_MS = 5000;
const COLLECT_TIMEOUT_HARDCAP_MS = 300000;

function cmdCollect(options, jobDir) {
  initLoggerFromJobDir(jobDir);
  logInfo(`collect: ${path.resolve(jobDir)}`);

  const timeoutMsRaw = options['timeout-ms'] != null ? Number(options['timeout-ms']) : 150000;
  const timeoutMs = Math.min(
    Math.max(0, Number.isFinite(timeoutMsRaw) ? Math.trunc(timeoutMsRaw) : 150000),
    COLLECT_TIMEOUT_HARDCAP_MS,
  );

  const start = Date.now();
  while (true) {
    const status = computeStatus(jobDir);
    if (status.overallState === 'done') {
      const manifest = buildManifest(jobDir);
      process.stdout.write(
        `${JSON.stringify({ overallState: 'done', ...manifest }, null, 2)}\n`,
      );
      return;
    }
    if (Date.now() - start >= timeoutMs) {
      process.stdout.write(
        `${JSON.stringify({ overallState: status.overallState, id: status.id, counts: status.counts }, null, 2)}\n`,
      );
      return;
    }
    sleepMs(COLLECT_POLL_INTERVAL_MS);
  }
}

function cmdStop(_options, jobDir) {
  initLoggerFromJobDir(jobDir);
  logInfo(`stop: ${path.resolve(jobDir)}`);
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
  initLoggerFromJobDir(jobDir);
  logInfo(`clean: ${path.resolve(jobDir)}`);
  const resolvedJobDir = path.resolve(jobDir);

  // Primary: use explicit jobs-dir from options/env/default
  const configuredJobsDir = path.resolve(
    options['jobs-dir'] || process.env.CHUNK_REVIEW_JOBS_DIR || path.join(PROJECT_ROOT, '.omt', 'jobs')
  );

  // Path traversal guard: check if target is under the configured jobs directory
  const relative = path.relative(configuredJobsDir, resolvedJobDir);
  const isUnderConfigured = !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isUnderConfigured) {
    // Fallback: accept if jobDir contains job.json (proves it's a real job directory)
    const jobJsonPath = path.join(resolvedJobDir, 'job.json');
    if (!fs.existsSync(jobJsonPath)) {
      exitWithError(`clean: refusing to delete path outside jobs directory: ${resolvedJobDir} (jobsDir: ${configuredJobsDir})`);
    }
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

async function parseChunkReviewConfig(configPath) {
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
    YAML = await import('yaml').then(m => m.default);
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
  chunk-review-job.sh collect [--timeout-ms N] <jobDir>
  chunk-review-job.sh results [--json|--manifest] <jobDir>
  chunk-review-job.sh stop <jobDir>
  chunk-review-job.sh clean <jobDir>

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

async function cmdStart(options, prompt) {
  const configPath = options.config || process.env.CHUNK_REVIEW_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.CHUNK_REVIEW_JOBS_DIR || path.join(PROJECT_ROOT, '.omt', 'jobs');

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir);

  const hostRole = detectHostRole(SKILL_DIR);
  const config = await parseChunkReviewConfig(configPath);
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
  initLogger('chunk-review-job', PROJECT_ROOT, jobId);
  logStart();
  logInfo(`GC: stale jobs cleaned`);
  logInfo(`config: ${configPath}, chairman: ${chairmanRole}, reviewers: ${reviewers.length}`);

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
  logInfo(`workers spawned: ${reviewers.map(r => String(r.name)).join(', ')}`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
  logEnd();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv, CHUNK_REVIEW_BOOLEAN_FLAGS);
  const [command, ...rest] = options._;

  if (!command || options.help || options.h) {
    printHelp();
    return;
  }

  if (command === 'start') {
    let prompt;
    if (options['prompt-file']) {
      const filePath = String(options['prompt-file']);
      try {
        prompt = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        exitWithError(`start: cannot read --prompt-file: ${filePath}`);
      }
    } else if (options.stdin) {
      prompt = fs.readFileSync(0, 'utf8');
    } else {
      prompt = rest.join(' ').trim();
    }
    if (!prompt) exitWithError('start: missing prompt');
    await cmdStart(options, prompt);
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
  if (command === 'collect') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('collect: missing jobDir');
    cmdCollect(options, jobDir);
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

if (import.meta.main) {
  main();
}

export {
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
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
} from '../../../lib/job-utils';

export { safeFileName };

export {
  buildUiPayload,
  buildManifest,
  parseChunkReviewConfig,
  parseYamlSimple,
  computeStatus,
  detectCliType,
  buildAugmentedCommand,
  gcStaleJobs,
};

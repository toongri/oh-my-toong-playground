#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'spec-review-worker.js');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'spec-review.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'spec-review.config.yaml');

const UI_STRINGS = {
  dispatch: {
    completed: 'Dispatched review prompts',
    inProgress: 'Dispatching review prompts',
  },
  synthesize: {
    completed: 'Spec review results ready',
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

    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) {
      out[key.slice(2)] = rawValue;
      continue;
    }

    const normalizedKey = key.slice(2);
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
// Worker spawning
// ---------------------------------------------------------------------------

function spawnWorkers({ reviewers, workerPath, jobDir, reviewersDir, timeoutSec }) {
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

    const workerArgs = [
      workerPath,
      '--job-dir',
      jobDir,
      '--reviewer',
      name,
      '--safe-reviewer',
      safeName,
      '--command',
      String(reviewer.command),
    ];
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

  const reviewers = [];
  for (const entry of fs.readdirSync(reviewersRoot)) {
    const statusPath = path.join(reviewersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (status) reviewers.push({ safeName: entry, ...status });
  }

  const totals = { queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 };
  for (const r of reviewers) {
    const state = String(r.state || 'unknown');
    if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
  }

  const allDone = totals.running === 0 && totals.queued === 0;
  const overallState = allDone ? 'done' : totals.running > 0 ? 'running' : 'queued';

  return {
    jobDir: resolvedJobDir,
    id: jobMeta.id || null,
    chairmanRole: jobMeta.chairmanRole || null,
    overallState,
    counts: { total: reviewers.length, ...totals },
    specName: jobMeta.specName || null,
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

    const label = `[Spec Review] Ask ${r.entity}`;
    return { label, status: asCodexStepStatus(status) };
  });

  const synthStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const codexPlan = [
    { step: '[Spec Review] Prompt dispatch', status: dispatchStatus },
    ...reviewerSteps.map((s) => ({ step: s.label, status: s.status })),
    { step: '[Spec Review] Synthesize', status: synthStatus },
  ];

  const claudeTodos = [
    {
      content: '[Spec Review] Prompt dispatch',
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
      content: '[Spec Review] Synthesize',
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
    specName: statusPayload.specName,
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
    const extraInfo = payload.specName ? ` [spec: ${payload.specName}]` : '';
    process.stdout.write(`Spec Review${headerId}${extraInfo}\n`);
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

  const timeoutMsRaw = options['timeout-ms'] != null ? options['timeout-ms'] : 0;
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
          specName: jobMeta ? jobMeta.specName : null,
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

function cmdClean(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  fs.rmSync(resolvedJobDir, { recursive: true, force: true });
  process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// ---------------------------------------------------------------------------
// Spec-review-specific config parsing
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

function parseSpecReviewConfig(configPath) {
  const fallback = {
    'spec-review': {
      chairman: { role: 'auto' },
      reviewers: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '🤖', color: 'BLUE' },
        { name: 'gemini', command: 'gemini', emoji: '💎', color: 'GREEN' },
      ],
      context: {},
      settings: { exclude_chairman_from_reviewers: true, timeout: 180 },
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
  if (!parsed['spec-review']) {
    exitWithError(`Invalid config in ${configPath}: missing required top-level key 'spec-review:'`);
  }
  if (typeof parsed['spec-review'] !== 'object' || Array.isArray(parsed['spec-review'])) {
    exitWithError(`Invalid config in ${configPath}: 'spec-review' must be a mapping/object`);
  }

  const merged = {
    'spec-review': {
      chairman: { ...fallback['spec-review'].chairman },
      reviewers: Array.isArray(fallback['spec-review'].reviewers) ? [...fallback['spec-review'].reviewers] : [],
      context: { ...fallback['spec-review'].context },
      settings: { ...fallback['spec-review'].settings },
    },
  };

  const specReview = parsed['spec-review'];

  if (specReview.chairman != null) {
    if (typeof specReview.chairman !== 'object' || Array.isArray(specReview.chairman)) {
      exitWithError(`Invalid config in ${configPath}: 'spec-review.chairman' must be a mapping/object`);
    }
    merged['spec-review'].chairman = { ...merged['spec-review'].chairman, ...specReview.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(specReview, 'reviewers')) {
    if (!Array.isArray(specReview.reviewers)) {
      exitWithError(`Invalid config in ${configPath}: 'spec-review.reviewers' must be a list/array`);
    }
    merged['spec-review'].reviewers = specReview.reviewers;
  }

  if (specReview.context != null) {
    if (typeof specReview.context !== 'object' || Array.isArray(specReview.context)) {
      exitWithError(`Invalid config in ${configPath}: 'spec-review.context' must be a mapping/object`);
    }
    merged['spec-review'].context = { ...merged['spec-review'].context, ...specReview.context };
  }

  if (specReview.settings != null) {
    if (typeof specReview.settings !== 'object' || Array.isArray(specReview.settings)) {
      exitWithError(`Invalid config in ${configPath}: 'spec-review.settings' must be a mapping/object`);
    }
    merged['spec-review'].settings = { ...merged['spec-review'].settings, ...specReview.settings };
  }

  return merged;
}

function parseYamlSimple(configPath, fallback) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    const result = { 'spec-review': { chairman: {}, reviewers: [], context: {}, settings: {} } };
    let currentSection = null;
    let currentReviewer = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === 'spec-review:') continue;
      if (trimmed === 'chairman:') { currentSection = 'chairman'; continue; }
      if (trimmed === 'reviewers:' || trimmed === 'members:') { currentSection = 'reviewers'; continue; }
      if (trimmed === 'context:') { currentSection = 'context'; continue; }
      if (trimmed === 'settings:') { currentSection = 'settings'; continue; }

      if (currentSection === 'reviewers' && trimmed.startsWith('- name:')) {
        if (currentReviewer) result['spec-review'].reviewers.push(currentReviewer);
        currentReviewer = { name: trimmed.replace('- name:', '').trim().replace(/"/g, '') };
        continue;
      }

      if (currentReviewer && currentSection === 'reviewers') {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
        if (match) {
          currentReviewer[match[1]] = match[2];
        }
        continue;
      }

      if (currentSection === 'chairman' || currentSection === 'settings' || currentSection === 'context') {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
        if (match) {
          let value = match[2];
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          result['spec-review'][currentSection][match[1]] = value;
        }
      }
    }

    if (currentReviewer) result['spec-review'].reviewers.push(currentReviewer);

    if (result['spec-review'].reviewers.length === 0) {
      result['spec-review'].reviewers = fallback['spec-review'].reviewers;
    }
    result['spec-review'].chairman = { ...fallback['spec-review'].chairman, ...result['spec-review'].chairman };
    result['spec-review'].settings = { ...fallback['spec-review'].settings, ...result['spec-review'].settings };
    result['spec-review'].context = { ...fallback['spec-review'].context, ...result['spec-review'].context };

    return result;
  } catch (e) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Spec-review-specific functions
// ---------------------------------------------------------------------------

function findProjectRoot() {
  let current = SKILL_DIR;
  const root = path.parse(current).root;

  while (current !== root) {
    const omtDir = path.join(current, '.omt');
    if (fs.existsSync(omtDir) && fs.statSync(omtDir).isDirectory()) {
      return current;
    }

    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }

    current = path.dirname(current);
  }

  const normalized = SKILL_DIR.replace(/\\/g, '/');
  const skillsMatch = normalized.match(/^(.+?)\/.claude\/skills\//);
  if (skillsMatch) {
    return skillsMatch[1];
  }

  return null;
}

function gatherSpecContext(specName, config) {
  const parts = [];
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    return { context: '', files: [] };
  }

  const contextConfig = config['spec-review'].context || {};
  const sharedContextDir = contextConfig.shared_context_dir || '.omt/specs/context';
  const specsDir = contextConfig.specs_dir || '.omt/specs';

  const contextDir = path.join(projectRoot, sharedContextDir);
  const specDir = path.join(projectRoot, specsDir, specName);

  const files = [];

  if (fs.existsSync(contextDir)) {
    try {
      const contextFiles = fs.readdirSync(contextDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      for (const fileName of contextFiles) {
        const filePath = path.join(contextDir, fileName);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          parts.push(`## Shared Context: ${fileName}\n\n${content}`);
          files.push(filePath);
        } catch (e) {
          // Skip unreadable files
        }
      }
    } catch (e) {
      // Skip if can't read directory
    }
  }

  const specPath = path.join(specDir, 'spec.md');
  if (fs.existsSync(specPath)) {
    try {
      const content = fs.readFileSync(specPath, 'utf8');
      parts.push(`## Current Spec: ${specName}/spec.md\n\n${content}`);
      files.push(specPath);
    } catch (e) {
      // Skip unreadable files
    }
  }

  const recordsDir = path.join(specDir, 'records');
  if (fs.existsSync(recordsDir)) {
    try {
      const recordFiles = fs.readdirSync(recordsDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      for (const recordFile of recordFiles) {
        const recordPath = path.join(recordsDir, recordFile);
        try {
          const content = fs.readFileSync(recordPath, 'utf8');
          parts.push(`## Decision Record: ${recordFile}\n\n${content}`);
          files.push(recordPath);
        } catch (e) {
          // Skip unreadable files
        }
      }
    } catch (e) {
      // Skip if can't read directory
    }
  }

  return {
    context: parts.join('\n\n---\n\n'),
    files,
  };
}

// ---------------------------------------------------------------------------
// Spec-review-specific start command
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(`Spec Review (job mode)

Usage:
  spec-review-job.sh start [--config path] [--chairman auto|claude|codex|...] [--spec <spec-name>] [--jobs-dir path] [--json] "question"
  spec-review-job.sh start --stdin
  spec-review-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  spec-review-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  spec-review-job.sh results [--json] <jobDir>
  spec-review-job.sh stop <jobDir>
  spec-review-job.sh clean <jobDir>

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - --spec auto-loads context from .omt/specs/<spec-name>/ (spec.md, records/*.md) + shared context
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

function cmdStart(options, prompt) {
  const configPath = options.config || process.env.SPEC_REVIEW_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.SPEC_REVIEW_JOBS_DIR || path.join(SKILL_DIR, '.jobs');

  ensureDir(jobsDir);

  const hostRole = detectHostRole(SKILL_DIR);
  const config = parseSpecReviewConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.SPEC_REVIEW_CHAIRMAN || config['spec-review'].chairman.role || 'auto';
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairman = Boolean(options['include-chairman']);
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? true : options['include-chairman'] != null ? false : null;

  const excludeSetting = normalizeBool(config['spec-review'].settings.exclude_chairman_from_reviewers);
  const excludeChairmanFromReviewers =
    excludeChairmanOverride != null ? excludeChairmanOverride : excludeSetting != null ? excludeSetting : true;

  const timeoutSetting = Number(config['spec-review'].settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedReviewers = config['spec-review'].reviewers || [];
  const reviewers = requestedReviewers.filter((r) => {
    if (!r || !r.name || !r.command) return false;
    const nameLc = String(r.name).toLowerCase();
    if (excludeChairmanFromReviewers && !includeChairman && nameLc === chairmanRole) return false;
    return true;
  });

  const specName = options.spec || null;
  let specContext = { context: '', files: [] };
  if (specName) {
    specContext = gatherSpecContext(specName, config);
  }

  let finalPrompt = prompt;
  if (specContext.context) {
    finalPrompt = `# Spec Review Context

${specContext.context}

---

# Review Question

${prompt}`;
  }

  const jobId = generateJobId();
  const jobDir = path.join(jobsDir, `spec-review-${jobId}`);
  const reviewersDir = path.join(jobDir, 'reviewers');
  ensureDir(reviewersDir);

  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), String(finalPrompt), 'utf8');

  const jobMeta = {
    id: `spec-review-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    hostRole,
    chairmanRole,
    specName,
    specContextFiles: specContext.files,
    settings: {
      excludeChairmanFromReviewers,
      timeoutSec: timeoutSec || null,
    },
    reviewers: reviewers.map((r) => ({
      name: String(r.name),
      command: String(r.command),
      emoji: r.emoji ? String(r.emoji) : null,
      color: r.color ? String(r.color) : null,
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
};

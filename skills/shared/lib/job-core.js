#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Re-export exitWithError from worker-core (identical implementation)
const { exitWithError } = require('./worker-core.js');

// ---------------------------------------------------------------------------
// Pure utility functions (no entity-specific terminology)
// ---------------------------------------------------------------------------

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
  return cleaned || (fallback || 'entity');
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
// Argument parsing (more complex than worker-core's version: has booleanFlags)
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
// Entity-parameterized functions
//
// These functions use an `entityConfig` object:
//   entityKey       - field name in status.json (e.g. 'member' or 'reviewer')
//   entitiesDirName - directory name under jobDir (e.g. 'members' or 'reviewers')
//   uiLabel         - UI label prefix (e.g. '[Council]' or '[Spec Review]')
//   skillName       - full skill name (e.g. 'Agent Council' or 'Spec Review')
//   safeNameFallback- fallback for safeFileName (e.g. 'member' or 'reviewer')
// ---------------------------------------------------------------------------

/**
 * Compute the status payload for a job directory.
 *
 * @param {string} jobDir
 * @param {object} entityConfig
 * @param {function} [extraMetadataFn] - optional (jobMeta) => object for extra fields
 * @returns {object}
 */
function computeStatusPayload(jobDir, entityConfig, extraMetadataFn) {
  const resolvedJobDir = path.resolve(jobDir);
  if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError(`job.json not found: ${path.join(resolvedJobDir, 'job.json')}`);

  const entitiesRoot = path.join(resolvedJobDir, entityConfig.entitiesDirName);
  if (!fs.existsSync(entitiesRoot)) exitWithError(`${entityConfig.entitiesDirName} folder not found: ${entitiesRoot}`);

  const entities = [];
  for (const entry of fs.readdirSync(entitiesRoot)) {
    const statusPath = path.join(entitiesRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (status) entities.push({ safeName: entry, ...status });
  }

  const totals = { queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 };
  for (const e of entities) {
    const state = String(e.state || 'unknown');
    if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
  }

  const allDone = totals.running === 0 && totals.queued === 0;
  const overallState = allDone ? 'done' : totals.running > 0 ? 'running' : 'queued';

  const ek = entityConfig.entityKey;

  const base = {
    jobDir: resolvedJobDir,
    id: jobMeta.id || null,
    chairmanRole: jobMeta.chairmanRole || null,
    overallState,
    counts: { total: entities.length, ...totals },
    [entityConfig.entitiesDirName]: entities
      .map((e) => ({
        [ek]: e[ek],
        state: e.state,
        startedAt: e.startedAt || null,
        finishedAt: e.finishedAt || null,
        exitCode: e.exitCode != null ? e.exitCode : null,
        message: e.message || null,
      }))
      .sort((a, b) => String(a[ek]).localeCompare(String(b[ek]))),
  };

  if (extraMetadataFn) {
    Object.assign(base, extraMetadataFn(jobMeta));
  }

  return base;
}

/**
 * Build UI payload (codex plan + claude todos) from a status payload.
 *
 * @param {object} statusPayload
 * @param {object} entityConfig
 * @param {object} [uiStrings] - optional override for dispatch/synthesize activeForm strings
 * @returns {object}
 */
function buildUiPayload(statusPayload, entityConfig, uiStrings) {
  const counts = statusPayload.counts || {};
  const done = computeTerminalDoneCount(counts);
  const total = Number(counts.total || 0);
  const isDone = String(statusPayload.overallState || '') === 'done';

  const queued = Number(counts.queued || 0);
  const running = Number(counts.running || 0);

  const ek = entityConfig.entityKey;
  const entitiesArray = Array.isArray(statusPayload[entityConfig.entitiesDirName])
    ? statusPayload[entityConfig.entitiesDirName]
    : [];
  const sortedEntities = entitiesArray
    .map((e) => ({
      entity: e && e[ek] != null ? String(e[ek]) : '',
      state: e && e.state != null ? String(e.state) : 'unknown',
      exitCode: e && e.exitCode != null ? e.exitCode : null,
    }))
    .filter((e) => e.entity)
    .sort((a, b) => a.entity.localeCompare(b.entity));

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled']);
  const dispatchStatus = asCodexStepStatus(isDone ? 'completed' : queued > 0 ? 'in_progress' : 'completed');
  let hasInProgress = dispatchStatus === 'in_progress';

  const uiLabel = entityConfig.uiLabel;

  const entitySteps = sortedEntities.map((e) => {
    const state = e.state || 'unknown';
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

    const label = `${uiLabel} Ask ${e.entity}`;
    return { label, status: asCodexStepStatus(status) };
  });

  const synthStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const dispatchStrings = (uiStrings && uiStrings.dispatch) || {};
  const synthStrings = (uiStrings && uiStrings.synthesize) || {};

  const codexPlan = [
    { step: `${uiLabel} Prompt dispatch`, status: dispatchStatus },
    ...entitySteps.map((s) => ({ step: s.label, status: s.status })),
    { step: `${uiLabel} Synthesize`, status: synthStatus },
  ];

  const claudeTodos = [
    {
      content: `${uiLabel} Prompt dispatch`,
      status: dispatchStatus,
      activeForm: dispatchStatus === 'completed'
        ? (dispatchStrings.completed || 'Dispatched prompts')
        : (dispatchStrings.inProgress || 'Dispatching prompts'),
    },
    ...entitySteps.map((s) => ({
      content: s.label,
      status: s.status,
      activeForm: s.status === 'completed' ? 'Finished' : 'Awaiting response',
    })),
    {
      content: `${uiLabel} Synthesize`,
      status: synthStatus,
      activeForm:
        synthStatus === 'completed'
          ? (synthStrings.completed || 'Results ready')
          : synthStatus === 'in_progress'
            ? (synthStrings.inProgress || 'Ready to synthesize')
            : (synthStrings.pending || 'Waiting to synthesize'),
    },
  ];

  return {
    progress: { done, total, overallState: String(statusPayload.overallState || '') },
    codex: { update_plan: { plan: codexPlan } },
    claude: { todo_write: { todos: claudeTodos } },
  };
}

/**
 * Build the wait payload from a status payload.
 *
 * @param {object} statusPayload
 * @param {object} entityConfig
 * @param {function} buildUiPayloadFn - (statusPayload) => uiPayload
 * @param {function} [extraWaitFieldsFn] - optional (statusPayload) => object for extra fields
 * @returns {object}
 */
function asWaitPayload(statusPayload, entityConfig, buildUiPayloadFn, extraWaitFieldsFn) {
  const ek = entityConfig.entityKey;
  const entitiesArray = Array.isArray(statusPayload[entityConfig.entitiesDirName])
    ? statusPayload[entityConfig.entitiesDirName]
    : [];

  const base = {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    chairmanRole: statusPayload.chairmanRole,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    [entityConfig.entitiesDirName]: entitiesArray.map((e) => ({
      [ek]: e[ek],
      state: e.state,
      exitCode: e.exitCode != null ? e.exitCode : null,
      message: e.message || null,
    })),
    ui: buildUiPayloadFn(statusPayload),
  };

  if (extraWaitFieldsFn) {
    Object.assign(base, extraWaitFieldsFn(statusPayload));
  }

  return base;
}

// ---------------------------------------------------------------------------
// Command implementations (parameterized by entityConfig)
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} jobDir
 * @param {object} entityConfig
 * @param {function} computeStatusFn - (jobDir) => statusPayload
 * @param {object} [statusLabels] - optional { headerPrefix, textEntitiesLabel }
 */
function cmdStatus(options, jobDir, entityConfig, computeStatusFn, statusLabels) {
  const payload = computeStatusFn(jobDir);

  const ek = entityConfig.entityKey;
  const headerPrefix = (statusLabels && statusLabels.headerPrefix) || entityConfig.skillName;
  const textEntitiesLabel = (statusLabels && statusLabels.textEntitiesLabel) || entityConfig.entitiesDirName;

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    const extraInfo = (statusLabels && statusLabels.checklistExtraFn)
      ? statusLabels.checklistExtraFn(payload)
      : '';
    process.stdout.write(`${headerPrefix}${headerId}${extraInfo}\n`);
    process.stdout.write(
      `Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`
    );
    for (const e of payload[entityConfig.entitiesDirName]) {
      const state = String(e.state || '');
      const mark =
        state === 'done'
          ? '[x]'
          : state === 'running' || state === 'queued'
            ? '[ ]'
            : state
              ? '[!]'
              : '[ ]';
      const exitInfo = e.exitCode != null ? ` (exit ${e.exitCode})` : '';
      process.stdout.write(`${mark} ${e[ek]} \u2014 ${state}${exitInfo}\n`);
    }
    return;
  }

  const wantText = Boolean(options.text) && !options.json;
  if (wantText) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`${textEntitiesLabel} ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const e of payload[entityConfig.entitiesDirName]) {
        process.stdout.write(`- ${e[ek]}: ${e.state}${e.exitCode != null ? ` (exit ${e.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {object} options
 * @param {string} jobDir
 * @param {object} entityConfig
 * @param {function} computeStatusFn
 * @param {function} asWaitPayloadFn - (statusPayload) => waitPayload
 */
function cmdWait(options, jobDir, entityConfig, computeStatusFn, asWaitPayloadFn) {
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

  let payload = computeStatusFn(jobDir);
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
    process.stdout.write(`${JSON.stringify({ ...asWaitPayloadFn(payload), cursor }, null, 2)}\n`);
    return;
  }

  const start = Date.now();
  while (cursor === prevCursorRaw) {
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
    sleepMs(intervalMs);
    payload = computeStatusFn(jobDir);
    const d = computeTerminalDoneCount(payload.counts);
    const doneFlag = payload.overallState === 'done';
    const totalCount = Number(payload.counts.total || 0);
    const queuedCount = Number(payload.counts.queued || 0);
    const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
    const doneB = Math.floor(d / bucketSize);
    const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
    if (nextCursor !== prevCursorRaw) {
      fs.writeFileSync(cursorFilePath, nextCursor, 'utf8');
      process.stdout.write(`${JSON.stringify({ ...asWaitPayloadFn(payload), cursor: nextCursor }, null, 2)}\n`);
      return;
    }
  }

  const finalPayload = computeStatusFn(jobDir);
  const finalDone = computeTerminalDoneCount(finalPayload.counts);
  const finalDoneFlag = finalPayload.overallState === 'done';
  const finalTotal = Number(finalPayload.counts.total || 0);
  const finalQueued = Number(finalPayload.counts.queued || 0);
  const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
  const finalDoneBucket = Math.floor(finalDone / bucketSize);
  const finalCursor = formatWaitCursor(bucketSize, finalDispatchBucket, finalDoneBucket, finalDoneFlag);
  fs.writeFileSync(cursorFilePath, finalCursor, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...asWaitPayloadFn(finalPayload), cursor: finalCursor }, null, 2)}\n`);
}

/**
 * @param {object} options
 * @param {string} jobDir
 * @param {object} entityConfig
 * @param {function} [extraResultFieldsFn] - optional (jobMeta) => object for extra JSON fields
 */
function cmdResults(options, jobDir, entityConfig, extraResultFieldsFn) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  const entitiesRoot = path.join(resolvedJobDir, entityConfig.entitiesDirName);

  const ek = entityConfig.entityKey;

  const entities = [];
  if (fs.existsSync(entitiesRoot)) {
    for (const entry of fs.readdirSync(entitiesRoot)) {
      const statusPath = path.join(entitiesRoot, entry, 'status.json');
      const outputPath = path.join(entitiesRoot, entry, 'output.txt');
      const errorPath = path.join(entitiesRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      entities.push({ safeName: entry, ...status, output, stderr });
    }
  }

  if (options.json) {
    const extraFields = extraResultFieldsFn ? extraResultFieldsFn(jobMeta) : {};
    process.stdout.write(
      `${JSON.stringify(
        {
          jobDir: resolvedJobDir,
          id: jobMeta ? jobMeta.id : null,
          ...extraFields,
          prompt: fs.existsSync(path.join(resolvedJobDir, 'prompt.txt'))
            ? fs.readFileSync(path.join(resolvedJobDir, 'prompt.txt'), 'utf8')
            : null,
          [entityConfig.entitiesDirName]: entities
            .map((e) => ({
              [ek]: e[ek],
              state: e.state,
              exitCode: e.exitCode != null ? e.exitCode : null,
              message: e.message || null,
              output: e.output,
              stderr: e.stderr,
            }))
            .sort((a, b) => String(a[ek]).localeCompare(String(b[ek]))),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  for (const e of entities.sort((a, b) => String(a[ek]).localeCompare(String(b[ek])))) {
    process.stdout.write(`\n=== ${e[ek]} (${e.state}) ===\n`);
    if (e.message) process.stdout.write(`${e.message}\n`);
    process.stdout.write(e.output || '');
    if (!e.output && e.stderr) {
      process.stdout.write('\n');
      process.stdout.write(e.stderr);
    }
    process.stdout.write('\n');
  }
}

function cmdStop(_options, jobDir, entityConfig) {
  const resolvedJobDir = path.resolve(jobDir);
  const entitiesRoot = path.join(resolvedJobDir, entityConfig.entitiesDirName);
  if (!fs.existsSync(entitiesRoot)) exitWithError(`No ${entityConfig.entitiesDirName} folder found: ${entitiesRoot}`);

  let stoppedAny = false;
  for (const entry of fs.readdirSync(entitiesRoot)) {
    const statusPath = path.join(entitiesRoot, entry, 'status.json');
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

  process.stdout.write(stoppedAny ? `stop: sent SIGTERM to running ${entityConfig.entitiesDirName}\n` : `stop: no running ${entityConfig.entitiesDirName}\n`);
}

function cmdClean(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  fs.rmSync(resolvedJobDir, { recursive: true, force: true });
  process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// ---------------------------------------------------------------------------
// Shared start logic helpers
// ---------------------------------------------------------------------------

function generateJobId() {
  return `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)}-${crypto
    .randomBytes(3)
    .toString('hex')}`;
}

function spawnWorkers({ entities, entityConfig, workerPath, jobDir, entitiesDir, timeoutSec }) {
  for (const entity of entities) {
    const name = String(entity.name);
    const safeName = safeFileName(name, entityConfig.safeNameFallback);
    const entityDir = path.join(entitiesDir, safeName);
    ensureDir(entityDir);

    atomicWriteJson(path.join(entityDir, 'status.json'), {
      [entityConfig.entityKey]: name,
      state: 'queued',
      queuedAt: new Date().toISOString(),
      command: String(entity.command),
    });

    const workerArgs = [
      workerPath,
      '--job-dir',
      jobDir,
      `--${entityConfig.entityKey}`,
      name,
      `--safe-${entityConfig.entityKey}`,
      safeName,
      '--command',
      String(entity.command),
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
// Main routing helper
// ---------------------------------------------------------------------------

/**
 * Standard main() routing for job scripts.
 *
 * @param {object} handlers - { printHelp, cmdStart, cmdStatus, cmdWait, cmdResults, cmdStop, cmdClean }
 */
function mainRouter(handlers) {
  const options = parseArgs(process.argv);
  const [command, ...rest] = options._;

  if (!command || options.help || options.h) {
    handlers.printHelp();
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
    handlers.cmdStart(options, prompt);
    return;
  }
  if (command === 'status') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('status: missing jobDir');
    handlers.cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('wait: missing jobDir');
    handlers.cmdWait(options, jobDir);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('results: missing jobDir');
    handlers.cmdResults(options, jobDir);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('stop: missing jobDir');
    handlers.cmdStop(options, jobDir);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('clean: missing jobDir');
    handlers.cmdClean(options, jobDir);
    return;
  }

  exitWithError(`Unknown command: ${command}`);
}

module.exports = {
  // Pure utilities
  exitWithError,
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

  // Wait cursor
  parseWaitCursor,
  formatWaitCursor,
  resolveBucketSize,

  // Entity-parameterized
  computeStatusPayload,
  buildUiPayload,
  asWaitPayload,

  // Commands
  cmdStatus,
  cmdWait,
  cmdResults,
  cmdStop,
  cmdClean,

  // Start helpers
  generateJobId,
  spawnWorkers,

  // Main routing
  mainRouter,
};

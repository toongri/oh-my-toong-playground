/**
 * Generic job orchestration framework.
 *
 * Extracted from scripts/chunk-review/job.ts (the most mature implementation).
 * All functions are parameterized via JobConfig for entity terminology, job prefix,
 * UI labels, and YAML config key.
 *
 * Consumers import initLogger directly from lib/logging.ts.
 * Shared primitives (atomicWriteJson, sleepMs, etc.) are imported from lib/job-utils.ts.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import {
  exitWithError,
  ensureDir,
  safeFileName as _safeFileName,
  atomicWriteJson,
  readJsonIfExists,
  sleepMs,
  computeTerminalDoneCount,
  asCodexStepStatus,
  parseWaitCursor,
  formatWaitCursor,
  resolveBucketSize,
} from './job-utils';

// ---------------------------------------------------------------------------
// JobConfig type
// ---------------------------------------------------------------------------

export interface JobConfig {
  /** e.g. 'reviewer' or 'member' */
  entitySingular: string;
  /** e.g. 'reviewers' or 'members' */
  entityPlural: string;
  /** directory name under jobDir, e.g. 'reviewers' or 'members' */
  entityDirName: string;
  /** prefix for job directory names, e.g. 'chunk-review-' or 'council-' */
  jobPrefix: string;
  /** UI label prefix, e.g. '[Chunk Review]' or '[Council]' */
  uiLabel: string;
  /** top-level YAML key in config files, e.g. 'chunk-review' or 'council' */
  configTopLevelKey: string;
  /** optional feature flags for consumers */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// safeFileName wrapper (defaults to entitySingular fallback)
// ---------------------------------------------------------------------------

export function safeFileName(name: string, fallback: string = 'member'): string {
  return _safeFileName(name, fallback);
}

// ---------------------------------------------------------------------------
// CLI detection & augmented command construction
// ---------------------------------------------------------------------------

export function detectCliType(command: unknown): string {
  if (!command) return 'unknown';
  const firstToken = String(command).trim().split(/\s+/)[0];
  if (['claude', 'gemini', 'codex'].includes(firstToken)) return firstToken;
  return 'unknown';
}

export function buildAugmentedCommand(
  entity: {
    command: unknown;
    model?: unknown;
    effort_level?: unknown;
    output_format?: unknown;
  },
  cliType: string,
): { command: string; env: Record<string, string> } {
  const parts = [String(entity.command)];
  const env: Record<string, string> = {};

  // model
  if (entity.model) {
    if (cliType === 'codex') {
      parts.push('-m', String(entity.model));
    } else {
      parts.push('--model', String(entity.model));
    }
  }

  // nested session guard
  if (cliType === 'claude') {
    env.CLAUDECODE = '';
  }

  // effort_level
  if (entity.effort_level) {
    if (cliType === 'claude') {
      env.CLAUDE_CODE_EFFORT_LEVEL = String(entity.effort_level);
    } else if (cliType === 'codex') {
      parts.push('-c', `model_reasoning_effort=${entity.effort_level}`);
    }
    // gemini/unknown: ignored
  }

  // output_format
  if (entity.output_format && entity.output_format !== 'text') {
    if (cliType === 'claude' || cliType === 'gemini') {
      parts.push('--output-format', String(entity.output_format));
    } else if (cliType === 'codex') {
      parts.push('--json');
    }
    // unknown: ignored
  }

  return { command: parts.join(' '), env };
}

// ---------------------------------------------------------------------------
// GC stale jobs
// ---------------------------------------------------------------------------

const GC_MAX_AGE_MS = 3_600_000; // 1 hour

export function gcStaleJobs(jobsDir: string, config: JobConfig): void {
  try {
    const resolvedJobsDir = fs.realpathSync(jobsDir);
    const prefix = config.jobPrefix;
    const entries = fs.readdirSync(jobsDir);
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;

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
      if (!jobMeta || !(jobMeta as any).createdAt) continue;

      const createdAtMs = new Date((jobMeta as any).createdAt).getTime();
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

// ---------------------------------------------------------------------------
// Worker spawning
// ---------------------------------------------------------------------------

export function spawnWorkers({
  entities,
  workerPath,
  jobDir,
  entitiesDir,
  timeoutSec,
  config,
}: {
  entities: any[];
  workerPath: string;
  jobDir: string;
  entitiesDir: string;
  timeoutSec: number;
  config: JobConfig;
}): void {
  // Validate names and detect case-insensitive collisions before spawning
  const seenLower = new Map<string, string>();
  for (const entity of entities) {
    const name = String(entity.name);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      exitWithError(
        `start: ${config.entitySingular} name must contain only alphanumeric, underscore, or hyphen characters: "${name}"`,
      );
    }
    const lower = name.toLowerCase();
    if (seenLower.has(lower)) {
      exitWithError(
        `start: ${config.entitySingular} name collision (case-insensitive) — "${name}" and "${seenLower.get(lower)}"`,
      );
    }
    seenLower.set(lower, name);
  }

  for (const entity of entities) {
    const name = String(entity.name);
    const entityDir = path.join(entitiesDir, name);
    ensureDir(entityDir);

    atomicWriteJson(path.join(entityDir, 'status.json'), {
      member: name,
      state: 'queued',
      queuedAt: new Date().toISOString(),
      command: String(entity.command),
    });

    const cliType = detectCliType(entity.command);
    const augmented = buildAugmentedCommand(entity, cliType);

    const workerArgs = [
      workerPath,
      '--job-dir', jobDir,
      '--member', name,
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

// ---------------------------------------------------------------------------
// Heartbeat staleness thresholds
// ---------------------------------------------------------------------------

/** Running entity is stale if lastHeartbeat is older than this. */
export const HEARTBEAT_STALE_THRESHOLD_MS = 60_000;

/** Grace period for running entity with no heartbeat yet (startedAt/mtime fallback). */
export const HEARTBEAT_GRACE_PERIOD_MS = 120_000;

export async function computeStatus(
  jobDir: string,
  config: JobConfig,
): Promise<{
  jobDir: string;
  id: string | null;
  chairmanRole: string | null;
  overallState: string;
  counts: Record<string, number>;
  members: any[];
}> {
  const resolvedJobDir = path.resolve(jobDir);
  if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json')) as any;
  if (!jobMeta) exitWithError(`job.json not found: ${path.join(resolvedJobDir, 'job.json')}`);

  const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);
  if (!fs.existsSync(entitiesRoot)) exitWithError(`${config.entityDirName} folder not found: ${entitiesRoot}`);

  // Staleness threshold: Math.max(2 * timeoutSec, 120) seconds
  const timeoutSec = (jobMeta.settings && Number.isFinite(Number(jobMeta.settings.timeoutSec)))
    ? Number(jobMeta.settings.timeoutSec)
    : 0;
  const stalenessThresholdMs = Math.max(2 * timeoutSec, 120) * 1000;

  const members: any[] = [];
  for (const entry of fs.readdirSync(entitiesRoot)) {
    const statusPath = path.join(entitiesRoot, entry, 'status.json');
    let status = readJsonIfExists(statusPath) as any;
    if (!status) continue;

    // Staleness check for queued entities
    if (status.state === 'queued') {
      let queuedTs: number;
      if (status.queuedAt) {
        queuedTs = new Date(status.queuedAt).getTime();
      } else {
        // Fallback to file mtime
        try { queuedTs = fs.statSync(statusPath).mtimeMs; } catch { queuedTs = Date.now(); }
      }
      const elapsed = Date.now() - queuedTs;
      if (elapsed > stalenessThresholdMs) {
        // CAS pattern: sleep then re-read to avoid race with worker startup
        await sleepMs(250);
        const recheck = readJsonIfExists(statusPath) as any;
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

    // Staleness check for running entities (heartbeat-based)
    if (status.state === 'running') {
      let isStale = false;
      let startTs: number;
      if (status.lastHeartbeat) {
        // heartbeat present: stale if older than HEARTBEAT_STALE_THRESHOLD_MS
        const heartbeatAge = Date.now() - new Date(status.lastHeartbeat).getTime();
        isStale = heartbeatAge > HEARTBEAT_STALE_THRESHOLD_MS;
        startTs = new Date(status.lastHeartbeat).getTime();
      } else {
        // no heartbeat yet: grace period based on startedAt or file mtime
        if (status.startedAt) {
          startTs = new Date(status.startedAt).getTime();
        } else {
          try { startTs = fs.statSync(statusPath).mtimeMs; } catch { startTs = Date.now(); }
        }
        isStale = (Date.now() - startTs) > HEARTBEAT_GRACE_PERIOD_MS;
      }

      if (isStale) {
        // CAS pattern: sleep then re-read to avoid race with legitimate completion
        await sleepMs(250);
        const recheck = readJsonIfExists(statusPath) as any;
        if (recheck && recheck.state === 'running') {
          // Recompute elapsed using recheck fields (post-CAS)
          let recheckStartTs: number;
          if (recheck.lastHeartbeat) {
            recheckStartTs = new Date(recheck.lastHeartbeat).getTime();
          } else if (recheck.startedAt) {
            recheckStartTs = new Date(recheck.startedAt).getTime();
          } else {
            try { recheckStartTs = fs.statSync(statusPath).mtimeMs; } catch { recheckStartTs = startTs; }
          }
          const elapsed = Math.round((Date.now() - recheckStartTs) / 1000);
          const errorPayload = {
            ...recheck,
            state: 'error',
            error: recheck.lastHeartbeat
              ? `Worker stale: no heartbeat for ${elapsed} seconds`
              : `Worker stale: running for ${elapsed} seconds without heartbeat`,
          };
          atomicWriteJson(statusPath, errorPayload);
          status = errorPayload;
        } else if (recheck) {
          status = recheck;
        }
      }
    }

    members.push({ safeName: entry, ...status });
  }

  const totals: Record<string, number> = {
    queued: 0, running: 0, retrying: 0, done: 0, error: 0,
    missing_cli: 0, timed_out: 0, canceled: 0, non_retryable: 0,
  };
  for (const r of members) {
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
    counts: { total: members.length, ...totals },
    members: members
      .map((r) => ({
        member: r.member,
        state: r.state,
        startedAt: r.startedAt || null,
        finishedAt: r.finishedAt || null,
        exitCode: r.exitCode != null ? r.exitCode : null,
        message: r.message || null,
      }))
      .sort((a, b) => String(a.member).localeCompare(String(b.member))),
  };
}

// ---------------------------------------------------------------------------
// UI payload
// ---------------------------------------------------------------------------

const UI_STRINGS = {
  dispatch: {
    completed: 'Dispatched review prompts',
    inProgress: 'Dispatching review prompts',
  },
  synthesize: {
    completed: 'Results ready',
    inProgress: 'Ready to synthesize',
    pending: 'Waiting to synthesize',
  },
};

export function buildUiPayload(
  statusPayload: {
    overallState?: string;
    counts?: Record<string, number>;
    members?: any[];
  },
  config: JobConfig,
): {
  progress: { done: number; total: number; overallState: string };
  codex: { update_plan: { plan: any[] } };
  claude: { todo_write: { todos: any[] } };
} {
  const counts = statusPayload.counts || {};
  const done = computeTerminalDoneCount(counts);
  const total = Number(counts.total || 0);
  const isDone = String(statusPayload.overallState || '') === 'done';

  const queued = Number(counts.queued || 0);
  const running = Number(counts.running || 0);

  const membersArray = Array.isArray(statusPayload.members) ? statusPayload.members : [];
  const sortedMembers = membersArray
    .map((r) => ({
      entity: r && r.member != null ? String(r.member) : '',
      state: r && r.state != null ? String(r.state) : 'unknown',
      exitCode: r && r.exitCode != null ? r.exitCode : null,
    }))
    .filter((r) => r.entity)
    .sort((a, b) => a.entity.localeCompare(b.entity));

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled', 'non_retryable']);
  const dispatchStatus = asCodexStepStatus(isDone ? 'completed' : queued > 0 ? 'in_progress' : 'completed');
  let hasInProgress = dispatchStatus === 'in_progress';

  const memberSteps = sortedMembers.map((r) => {
    const state = r.state || 'unknown';
    const isTerminal = terminalStates.has(state);

    let status: string;
    if (isTerminal) {
      status = 'completed';
    } else if (!hasInProgress && running > 0 && state === 'running') {
      status = 'in_progress';
      hasInProgress = true;
    } else {
      status = 'pending';
    }

    const label = `${config.uiLabel} Ask ${r.entity}`;
    return { label, status: asCodexStepStatus(status) };
  });

  const synthStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const codexPlan = [
    { step: `${config.uiLabel} Prompt dispatch`, status: dispatchStatus },
    ...memberSteps.map((s) => ({ step: s.label, status: s.status })),
    { step: `${config.uiLabel} Synthesize`, status: synthStatus },
  ];

  const claudeTodos = [
    {
      content: `${config.uiLabel} Prompt dispatch`,
      status: dispatchStatus,
      activeForm: dispatchStatus === 'completed'
        ? UI_STRINGS.dispatch.completed
        : UI_STRINGS.dispatch.inProgress,
    },
    ...memberSteps.map((s) => ({
      content: s.label,
      status: s.status,
      activeForm: s.status === 'completed' ? 'Finished' : 'Awaiting response',
    })),
    {
      content: `${config.uiLabel} Synthesize`,
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
// Wait payload (internal helper)
// ---------------------------------------------------------------------------

function asWaitPayload(statusPayload: any, config: JobConfig): any {
  const membersArray = Array.isArray(statusPayload.members) ? statusPayload.members : [];

  return {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    chairmanRole: statusPayload.chairmanRole,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    [config.entityPlural]: membersArray.map((r: any) => ({
      member: r.member,
      state: r.state,
      exitCode: r.exitCode != null ? r.exitCode : null,
      message: r.message || null,
    })),
    ui: buildUiPayload(statusPayload, config),
  };
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

export function buildManifest(
  jobDir: string,
  config: JobConfig,
): { id: string; [key: string]: any } {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json')) as any;
  const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);

  const jobId = jobMeta ? jobMeta.id : 'unknown';
  const entities: any[] = [];
  if (fs.existsSync(entitiesRoot)) {
    for (const entry of fs.readdirSync(entitiesRoot)) {
      const statusPath = path.join(entitiesRoot, entry, 'status.json');
      const status = readJsonIfExists(statusPath) as any;
      if (!status) continue;
      const outputPath = path.join(entitiesRoot, entry, 'output.txt');
      const outputExists = fs.existsSync(outputPath);
      entities.push({
        member: status.member,
        outputFilePath: outputExists ? outputPath : null,
        errorMessage: outputExists ? null : (status.message || status.state),
        _safeName: entry,
      });
    }
  }

  return {
    id: jobId,
    [config.entityPlural]: entities
      .map(({ _safeName, ...rest }: any) => rest)
      .sort((a: any, b: any) => String(a.member).localeCompare(String(b.member))),
  };
}

// ---------------------------------------------------------------------------
// Command: wait
// ---------------------------------------------------------------------------

export async function cmdWait(
  options: Record<string, unknown>,
  jobDir: string,
  config: JobConfig,
): Promise<void> {
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

  let payload = await computeStatus(jobDir, config);
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
    process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload, config), cursor }, null, 2)}\n`);
    return;
  }

  const start = Date.now();
  while (cursor === prevCursorRaw) {
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
    await sleepMs(intervalMs);
    payload = await computeStatus(jobDir, config);
    const d = computeTerminalDoneCount(payload.counts);
    const doneFlag = payload.overallState === 'done';
    const totalCount = Number(payload.counts.total || 0);
    const queuedCount = Number(payload.counts.queued || 0);
    const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
    const doneB = Math.floor(d / bucketSize);
    const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
    if (nextCursor !== prevCursorRaw) {
      fs.writeFileSync(cursorFilePath, nextCursor, 'utf8');
      process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload, config), cursor: nextCursor }, null, 2)}\n`);
      return;
    }
  }

  const finalPayload = await computeStatus(jobDir, config);
  const finalDone = computeTerminalDoneCount(finalPayload.counts);
  const finalDoneFlag = finalPayload.overallState === 'done';
  const finalTotal = Number(finalPayload.counts.total || 0);
  const finalQueued = Number(finalPayload.counts.queued || 0);
  const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
  const finalDoneBucket = Math.floor(finalDone / bucketSize);
  const finalCursor = formatWaitCursor(bucketSize, finalDispatchBucket, finalDoneBucket, finalDoneFlag);
  fs.writeFileSync(cursorFilePath, finalCursor, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...asWaitPayload(finalPayload, config), cursor: finalCursor }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Command: results
// ---------------------------------------------------------------------------

export function cmdResults(
  options: Record<string, unknown>,
  jobDir: string,
  config: JobConfig,
): void {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json')) as any;
  const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);

  const reviewers: any[] = [];
  if (fs.existsSync(entitiesRoot)) {
    for (const entry of fs.readdirSync(entitiesRoot)) {
      const statusPath = path.join(entitiesRoot, entry, 'status.json');
      const outputPath = path.join(entitiesRoot, entry, 'output.txt');
      const errorPath = path.join(entitiesRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath) as any;
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      reviewers.push({ safeName: entry, ...status, output, stderr });
    }
  }

  if (options.manifest) {
    const manifest = buildManifest(jobDir, config);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          jobDir: resolvedJobDir,
          id: jobMeta ? jobMeta.id : null,
          [config.entityPlural]: reviewers
            .map((r) => ({
              member: r.member,
              state: r.state,
              exitCode: r.exitCode != null ? r.exitCode : null,
              message: r.message || null,
              output: r.output,
            }))
            .sort((a, b) => String(a.member).localeCompare(String(b.member))),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  for (const r of reviewers.sort((a, b) => String(a.member).localeCompare(String(b.member)))) {
    process.stdout.write(`\n=== ${r.member} (${r.state}) ===\n`);
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
// Command: stop
// ---------------------------------------------------------------------------

export function cmdStop(
  _options: Record<string, unknown>,
  jobDir: string,
  config: JobConfig,
): void {
  const resolvedJobDir = path.resolve(jobDir);
  const entitiesRoot = path.join(resolvedJobDir, config.entityDirName);
  if (!fs.existsSync(entitiesRoot)) exitWithError(`No ${config.entityDirName} folder found: ${entitiesRoot}`);

  let stoppedAny = false;
  for (const entry of fs.readdirSync(entitiesRoot)) {
    const statusPath = path.join(entitiesRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath) as any;
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

  process.stdout.write(stoppedAny ? `stop: sent SIGTERM to running ${config.entityPlural}\n` : `stop: no running ${config.entityPlural}\n`);
}

// ---------------------------------------------------------------------------
// Command: clean
// ---------------------------------------------------------------------------

export function cmdClean(
  options: Record<string, unknown>,
  jobDir: string,
  config: JobConfig,
  defaultJobsDir: string,
): void {
  const resolvedJobDir = path.resolve(jobDir);

  // Primary: use explicit jobs-dir from options/env/default
  const configuredJobsDir = path.resolve(
    (options['jobs-dir'] as string | undefined) || defaultJobsDir,
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
// Command: collect — blocking poll until done
// ---------------------------------------------------------------------------

const COLLECT_POLL_INTERVAL_MS = 5000;
const COLLECT_TIMEOUT_HARDCAP_MS = 300000;

export async function cmdCollect(
  options: Record<string, unknown>,
  jobDir: string,
  config: JobConfig,
): Promise<void> {
  const timeoutMsRaw = options['timeout-ms'] != null ? Number(options['timeout-ms']) : 150000;
  const timeoutMs = Math.min(
    Math.max(0, Number.isFinite(timeoutMsRaw) ? Math.trunc(timeoutMsRaw) : 150000),
    COLLECT_TIMEOUT_HARDCAP_MS,
  );

  const start = Date.now();
  while (true) {
    const status = await computeStatus(jobDir, config);
    if (status.overallState === 'done') {
      const manifest = buildManifest(jobDir, config);
      process.stdout.write(
        `${JSON.stringify({ overallState: 'done', ...manifest }, null, 2)}\n`,
      );
      return;
    }
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
      process.stdout.write(
        `${JSON.stringify({ overallState: status.overallState, id: status.id, counts: status.counts }, null, 2)}\n`,
      );
      return;
    }
    await sleepMs(COLLECT_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// parseYamlSimple — parameterized by configTopLevelKey
// Limitations: Flat key-value pairs only. Does not support nested objects,
// multi-line strings, YAML arrays, anchors, flow mappings, or block scalars.
// Install the 'yaml' package for full YAML support.
// ---------------------------------------------------------------------------

export function parseYamlSimple(
  configPath: string,
  fallback: Record<string, any>,
  config: JobConfig,
): Record<string, any> {
  const topKey = config.configTopLevelKey;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    const result: Record<string, any> = {
      [topKey]: { chairman: {}, members: [], settings: {} },
    };
    let currentSection: string | null = null;
    let currentMember: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === `${topKey}:`) continue;
      if (trimmed === 'chairman:') { currentSection = 'chairman'; continue; }
      if (trimmed === 'members:') { currentSection = 'members'; continue; }
      if (trimmed === 'settings:') { currentSection = 'settings'; continue; }

      if (currentSection === 'members' && trimmed.startsWith('- name:')) {
        if (currentMember) result[topKey].members.push(currentMember);
        currentMember = { name: trimmed.replace('- name:', '').trim().replace(/"/g, '') };
        continue;
      }

      if (currentMember && currentSection === 'members') {
        const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (match) {
          currentMember[match[1]] = match[2].replace(/^"(.*)"$/, '$1').trim().replace(/\s+#.*$/, '');
        }
        continue;
      }

      if (currentSection === 'chairman' || currentSection === 'settings') {
        const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (match) {
          let value: unknown = match[2].replace(/^"(.*)"$/, '$1').trim().replace(/\s+#.*$/, '');
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
          result[topKey][currentSection][match[1]] = value;
        }
      }
    }

    if (currentMember) result[topKey].members.push(currentMember);

    const fallbackSection = fallback[topKey] || {};
    if (result[topKey].members.length === 0) {
      result[topKey].members = fallbackSection.members || [];
    }
    result[topKey].chairman = { ...(fallbackSection.chairman || {}), ...result[topKey].chairman };
    result[topKey].settings = { ...(fallbackSection.settings || {}), ...result[topKey].settings };

    return result;
  } catch (e) {
    return fallback;
  }
}

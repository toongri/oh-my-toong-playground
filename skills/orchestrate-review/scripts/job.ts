#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import {
  exitWithError,
  detectHostRole,
  ensureDir,
  safeFileName as _safeFileName,
  atomicWriteJson,
  computeTerminalDoneCount,
  parseArgs,
  generateJobId,
  findProjectRoot,
  resolveChairmanExclusion,
} from '@lib/job-utils';

import { initLogger, logInfo, logStart, logEnd } from '@lib/logging';
import { getOmtDir } from '@lib/omt-dir';

import {
  type JobConfig,
  assertMembersOrExit,
  detectCliType,
  buildAugmentedCommand,
  gcStaleJobs as _gcStaleJobs,
  computeStatus as _computeStatus,
  buildUiPayload as _buildUiPayload,
  spawnWorkers as _spawnWorkers,
  cmdResults as _cmdResults,
  cmdStop as _cmdStop,
  cmdClean as _cmdClean,
  cmdCollect as _cmdCollect,
  buildManifest as _buildManifest,
  parseYamlSimple as _parseYamlSimple,
  cmdResumeMember as _cmdResumeMember,
} from '@lib/generic-job';

export { cmdResumeMember } from '@lib/generic-job';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = import.meta.dirname;
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'worker.ts');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'orchestrate-review.config.yaml');
const REPO_CONFIG_FILE = path.join(PROJECT_ROOT, 'orchestrate-review.config.yaml');

const DEFAULT_JOBS_DIR = process.env.CHUNK_REVIEW_JOBS_DIR || path.join(getOmtDir(), 'jobs');

// ---------------------------------------------------------------------------
// JobConfig for chunk-review
// ---------------------------------------------------------------------------

const CHUNK_REVIEW_JOB_CONFIG: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'chunk-review-',
  uiLabel: '[Chunk Review]',
  configTopLevelKey: 'chunk-review',
};

// ---------------------------------------------------------------------------
// Chunk-review custom boolean flags for parseArgs
// ---------------------------------------------------------------------------

const CHUNK_REVIEW_BOOLEAN_FLAGS = new Set([
  'json', 'text', 'checklist', 'help', 'h', 'verbose', 'manifest',
  'include-chairman', 'exclude-chairman', 'stdin', 'blocking',
]);

// ---------------------------------------------------------------------------
// Wrapper functions — pre-apply CHUNK_REVIEW_JOB_CONFIG for test compatibility
// ---------------------------------------------------------------------------

function safeFileName(name: string, fallback?: string): string {
  return _safeFileName(name, fallback || 'member');
}

function gcStaleJobs(jobsDir: string): void {
  _gcStaleJobs(jobsDir, CHUNK_REVIEW_JOB_CONFIG);
}

async function computeStatus(jobDir: string) {
  return _computeStatus(jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function buildUiPayload(statusPayload: Parameters<typeof _buildUiPayload>[0]) {
  return _buildUiPayload(statusPayload, CHUNK_REVIEW_JOB_CONFIG);
}

function buildManifest(jobDir: string) {
  return _buildManifest(jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function parseYamlSimple(configPath: string, fallback: Record<string, any>) {
  return _parseYamlSimple(configPath, fallback, CHUNK_REVIEW_JOB_CONFIG);
}

// ---------------------------------------------------------------------------
// Logging helper for non-start commands (extract jobId from jobDir path)
// ---------------------------------------------------------------------------

function initLoggerFromJobDir(jobDir: string): void {
  const jobId = path.basename(jobDir).replace(/^chunk-review-/, '');
  initLogger('chunk-review-job', getOmtDir(), jobId);
}

// ---------------------------------------------------------------------------
// Command implementations (chunk-review-specific with logging)
// ---------------------------------------------------------------------------

async function cmdStatus(options: Record<string, unknown>, jobDir: string): Promise<void> {
  initLoggerFromJobDir(jobDir);
  logInfo(`status: ${path.resolve(jobDir)}`);
  const payload = await computeStatus(jobDir);

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    process.stdout.write(`Chunk Review${headerId}\n`);
    process.stdout.write(
      `Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`
    );
    for (const r of payload.members) {
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
      process.stdout.write(`${mark} ${r.member} \u2014 ${state}${exitInfo}\n`);
    }
    return;
  }

  const wantText = Boolean(options.text) && !options.json;
  if (wantText) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`members ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const r of payload.members) {
        process.stdout.write(`- ${r.member}: ${r.state}${r.exitCode != null ? ` (exit ${r.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function cmdResults(options: Record<string, unknown>, jobDir: string): void {
  initLoggerFromJobDir(jobDir);
  logInfo(`results: ${path.resolve(jobDir)}`);
  _cmdResults(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

async function cmdCollect(options: Record<string, unknown>, jobDir: string): Promise<void> {
  initLoggerFromJobDir(jobDir);
  logInfo(`collect: ${path.resolve(jobDir)}`);
  await _cmdCollect(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function cmdStop(options: Record<string, unknown>, jobDir: string): void {
  initLoggerFromJobDir(jobDir);
  logInfo(`stop: ${path.resolve(jobDir)}`);
  _cmdStop(options, jobDir, CHUNK_REVIEW_JOB_CONFIG);
}

function cmdClean(options: Record<string, unknown>, jobDir: string): void {
  initLoggerFromJobDir(jobDir);
  logInfo(`clean: ${path.resolve(jobDir)}`);
  const configuredJobsDir = path.resolve(
    (options['jobs-dir'] as string | undefined) || process.env.CHUNK_REVIEW_JOBS_DIR || DEFAULT_JOBS_DIR,
  );
  _cmdClean(options, jobDir, CHUNK_REVIEW_JOB_CONFIG, configuredJobsDir);
}

// ---------------------------------------------------------------------------
// Chunk-review-specific config parsing
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile(): string {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

async function parseChunkReviewConfig(configPath: string): Promise<Record<string, any>> {
  const fallback = {
    'chunk-review': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '\u{1F9E0}', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '\u{1F916}', color: 'BLUE' },
      ],
      settings: { exclude_chairman_from_members: true, timeout: 300 },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  let YAML: any;
  try {
    YAML = await import('yaml').then((m: any) => m.default);
  } catch {
    return parseYamlSimple(configPath, fallback);
  }

  let parsed: any;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error: any) {
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

  const merged: Record<string, any> = {
    'chunk-review': {
      chairman: { ...fallback['chunk-review'].chairman },
      members: Array.isArray(fallback['chunk-review'].members) ? [...fallback['chunk-review'].members] : [],
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

  if (Object.prototype.hasOwnProperty.call(chunkReview, 'members')) {
    if (!Array.isArray(chunkReview.members)) {
      exitWithError(`Invalid config in ${configPath}: 'chunk-review.members' must be a list/array`);
    }
    merged['chunk-review'].members = chunkReview.members;
  }

  if (chunkReview.settings != null) {
    if (typeof chunkReview.settings !== 'object' || Array.isArray(chunkReview.settings)) {
      exitWithError(`Invalid config in ${configPath}: 'chunk-review.settings' must be a mapping/object`);
    }
    merged['chunk-review'].settings = { ...merged['chunk-review'].settings, ...chunkReview.settings };
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Chunk-review-specific start command
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stdout.write(`Chunk Review (job mode)

Usage:
  job.ts start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  job.ts start --stdin
  job.ts status [--json|--text|--checklist] [--verbose] <jobDir>
  job.ts collect [--timeout-ms N] <jobDir>
  job.ts results [--json|--manifest] <jobDir>
  job.ts stop <jobDir>
  job.ts clean <jobDir>

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
`);
}

async function cmdStart(options: Record<string, unknown>, prompt: string): Promise<void> {
  const configPath = (options.config as string | undefined) || process.env.CHUNK_REVIEW_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    (options['jobs-dir'] as string | undefined) || process.env.CHUNK_REVIEW_JOBS_DIR || path.join(getOmtDir(), 'jobs');

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir);

  const hostRole = detectHostRole(SKILL_DIR);
  const config = await parseChunkReviewConfig(configPath);
  const chairmanRoleRaw = (options.chairman as string | undefined) || process.env.CHUNK_REVIEW_CHAIRMAN || config['chunk-review'].chairman.role || 'auto';

  const { chairmanRole, excludeChairmanFromMembers, filterMember } = resolveChairmanExclusion({
    options,
    configExcludeSetting: config['chunk-review'].settings.exclude_chairman_from_members,
    hostRole,
    chairmanRoleRaw,
  });

  const timeoutSetting = Number(config['chunk-review'].settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride!) && timeoutOverride! > 0 ? timeoutOverride! : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedMembers = config['chunk-review'].members || [];
  const members = requestedMembers.filter(filterMember);

  assertMembersOrExit(members, CHUNK_REVIEW_JOB_CONFIG, configPath);

  const jobId = generateJobId();
  initLogger('chunk-review-job', getOmtDir(), jobId);
  logStart();
  logInfo(`GC: stale jobs cleaned`);
  logInfo(`config: ${configPath}, chairman: ${chairmanRole}, members: ${members.length}`);

  const jobDir = path.join(jobsDir, `chunk-review-${jobId}`);
  const membersDir = path.join(jobDir, 'members');
  ensureDir(membersDir);

  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), String(prompt), 'utf8');

  const jobMeta = {
    id: `chunk-review-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    hostRole,
    chairmanRole,
    settings: {
      excludeChairmanFromMembers,
      timeoutSec: timeoutSec || null,
    },
    members: members.map((r: any) => ({
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

  _spawnWorkers({
    entities: members,
    workerPath: WORKER_PATH,
    jobDir,
    entitiesDir: membersDir,
    timeoutSec,
    config: CHUNK_REVIEW_JOB_CONFIG,
  });
  logInfo(`workers spawned: ${members.map((r: any) => String(r.name)).join(', ')}`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
  logEnd();
}

// ---------------------------------------------------------------------------
// resume-member: implemented in @lib/generic-job (cmdResumeMember)
// re-exported for backward compat via `export { cmdResumeMember } from '@lib/generic-job'`
// (see import block above)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv, CHUNK_REVIEW_BOOLEAN_FLAGS);
  const [command, ...rest] = options._;

  if (!command || options.help || options.h) {
    printHelp();
    return;
  }

  if (command === 'start') {
    let prompt: string;
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
    await cmdStatus(options, jobDir);
    return;
  }
  if (command === 'collect') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('collect: missing jobDir');
    await cmdCollect(options, jobDir);
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
  if (command === 'resume-member') {
    const jobDirArg = options.job as string | undefined;
    if (!jobDirArg) exitWithError('--job required');
    const nameArg = options.member as string | undefined;
    if (!nameArg) exitWithError('--member required');
    const promptArg = options.prompt as string | undefined;
    if (!promptArg) exitWithError('--prompt required');
    try {
      await _cmdResumeMember(jobDirArg, nameArg, promptArg, CHUNK_REVIEW_JOB_CONFIG);
    } catch (e: unknown) {
      exitWithError(e instanceof Error ? e.message : String(e));
    }
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
} from '@lib/job-utils';

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

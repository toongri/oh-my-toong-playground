#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  exitWithError,
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
  atomicWriteJson,
  readJsonIfExists,
  computeTerminalDoneCount,
  parseArgs,
  generateJobId,
  findProjectRoot as _findProjectRoot,
} from '@lib/job-utils';

import {
  type JobConfig,
  type CmdResultsHooks,
  type CmdWaitHooks,
  computeStatus as _computeStatus,
  buildUiPayload as _buildUiPayload,
  spawnWorkers as _spawnWorkers,
  cmdResults as _cmdResults,
  cmdWait as _cmdWait,
  cmdStop as _cmdStop,
  cmdClean as _cmdClean,
  cmdCollect as _cmdCollect,
  gcStaleJobs,
  parseYamlSimple as frameworkParseYamlSimple,
} from '@lib/generic-job';

import { getOmtDir } from '@lib/omt-dir';

// ---------------------------------------------------------------------------
// Job configuration
// ---------------------------------------------------------------------------

const JOB_CONFIG: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'spec-review-',
  uiLabel: '[Spec Review]',
  configTopLevelKey: 'spec-review',
};

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = import.meta.dirname;
const PROJECT_ROOT = findProjectRoot();
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'worker.ts');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'spec-review.config.yaml');
const REPO_CONFIG_FILE = path.join(PROJECT_ROOT, 'spec-review.config.yaml');

// ---------------------------------------------------------------------------
// Spec-review wrappers — pre-apply JOB_CONFIG so callers/tests need no config arg
// ---------------------------------------------------------------------------

// computeStatus: wraps framework version and adds specName (spec-review-specific)
const computeStatus = async (jobDir: string): Promise<any> => {
  const status = await _computeStatus(jobDir, JOB_CONFIG);
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json')) as any;
  return {
    ...status,
    specName: jobMeta ? (jobMeta.specName || null) : null,
  };
};

// buildUiPayload: wraps framework version with JOB_CONFIG
const buildUiPayload = (statusPayload: any): any => _buildUiPayload(statusPayload, JOB_CONFIG);

// parseYamlSimple: wraps framework version with JOB_CONFIG and context extraSection
function parseYamlSimple(configPath: string, fallback: Record<string, any>): Record<string, any> {
  return frameworkParseYamlSimple(configPath, fallback, JOB_CONFIG, ['context']);
}

// ---------------------------------------------------------------------------
// Spec-review-specific config parsing
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile(): string {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

async function parseSpecReviewConfig(configPath: string): Promise<Record<string, any>> {
  const fallback: Record<string, any> = {
    'spec-review': {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '🤖', color: 'BLUE' },
        { name: 'gemini', command: 'gemini', emoji: '💎', color: 'GREEN' },
      ],
      context: {},
      settings: { exclude_chairman_from_members: true, timeout: 180 },
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
  if (!parsed['spec-review']) {
    exitWithError(`Invalid config in ${configPath}: missing required top-level key 'spec-review:'`);
  }
  if (typeof parsed['spec-review'] !== 'object' || Array.isArray(parsed['spec-review'])) {
    exitWithError(`Invalid config in ${configPath}: 'spec-review' must be a mapping/object`);
  }

  const merged: Record<string, any> = {
    'spec-review': {
      chairman: { ...fallback['spec-review'].chairman },
      members: Array.isArray(fallback['spec-review'].members) ? [...fallback['spec-review'].members] : [],
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

  const specReviewMembers = specReview.members;
  if (specReviewMembers !== undefined) {
    if (!Array.isArray(specReviewMembers)) {
      exitWithError(`Invalid config in ${configPath}: 'spec-review.members' must be a list/array`);
    }
    merged['spec-review'].members = specReviewMembers;
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

// ---------------------------------------------------------------------------
// Spec-review-specific functions
// ---------------------------------------------------------------------------

function findProjectRoot(scriptDir: string = SCRIPT_DIR): string {
  return _findProjectRoot(scriptDir);
}

function resolveContextDir(rawPath: string, projectRoot: string): string | null {
  let resolved = rawPath;

  // Expand ${OMT_PROJECT} if present in path
  if (resolved.includes('${OMT_PROJECT}')) {
    const omtProject = process.env.OMT_PROJECT;
    if (!omtProject) return null;
    resolved = resolved.replace(/\$\{OMT_PROJECT\}/g, omtProject);
  }

  // Expand ~ to home directory
  if (resolved.startsWith('~/')) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  } else if (!path.isAbsolute(resolved)) {
    // Relative path: join with projectRoot
    resolved = path.join(projectRoot, resolved);
  }

  return resolved;
}

function gatherSpecContext(specName: string, config: Record<string, any>): { context: string; files: string[] } {
  const parts: string[] = [];
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    return { context: '', files: [] };
  }

  const contextConfig = config['spec-review'].context || {};
  const sharedContextDirRaw = contextConfig.shared_context_dir || '~/.omt/${OMT_PROJECT}/context';
  // Strip legacy ".omt/" prefix to prevent double path (~/.omt/project/.omt/specs/)
  const specsDir = (contextConfig.specs_dir || 'specs').replace(/^\.omt\//, '');

  const contextDir = resolveContextDir(sharedContextDirRaw, projectRoot);
  const specDir = path.join(getOmtDir(), specsDir, specName);

  const files: string[] = [];

  if (contextDir && fs.existsSync(contextDir)) {
    try {
      const contextFiles = fs.readdirSync(contextDir)
        .filter((f: string) => f.endsWith('.md'))
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
        .filter((f: string) => f.endsWith('.md'))
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

function printHelp(): void {
  process.stdout.write(`Spec Review (job mode)

Usage:
  job.ts start [--config path] [--chairman auto|claude|codex|...] [--spec <spec-name>] [--jobs-dir path] [--json] "question"
  job.ts start --stdin
  job.ts status [--json|--text|--checklist] [--verbose] <jobDir>
  job.ts wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  job.ts collect [--timeout-ms N] <jobDir>
  job.ts results [--json] <jobDir>
  job.ts stop <jobDir>
  job.ts clean <jobDir>

Notes:
  - start returns immediately and runs reviewers in parallel via detached Node workers
  - --spec auto-loads context from $OMT_DIR/specs/<spec-name>/ (spec.md, records/*.md) + shared context
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

// ---------------------------------------------------------------------------
// Hook definitions for framework cmdResults / cmdWait
// ---------------------------------------------------------------------------

const RESULTS_HOOKS: CmdResultsHooks = {
  extraTopLevel: (jobDir, jobMeta) => ({
    specName: jobMeta?.specName || null,
    prompt: fs.existsSync(path.join(jobDir, 'prompt.txt'))
      ? fs.readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8')
      : null,
  }),
  extraMemberFields: (member) => ({
    stderr: member.stderr || '',
  }),
};

const WAIT_HOOKS: CmdWaitHooks = {
  defaultTimeoutMs: 0,
  transformPayload: (payload) => {
    const jobMeta = readJsonIfExists(path.join(path.resolve(payload.jobDir), 'job.json')) as any;
    return { ...payload, specName: jobMeta?.specName || null };
  },
};

async function cmdStart(options: Record<string, unknown>, prompt: string): Promise<void> {
  const configPath = (options.config || process.env.SPEC_REVIEW_CONFIG || resolveDefaultConfigFile()) as string;
  const jobsDir =
    (options['jobs-dir'] || process.env.SPEC_REVIEW_JOBS_DIR || path.join(getOmtDir(), 'jobs')) as string;

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir, JOB_CONFIG);

  const hostRole = detectHostRole(SCRIPT_DIR);
  const config = await parseSpecReviewConfig(configPath);
  const chairmanRoleRaw = (options.chairman || process.env.SPEC_REVIEW_CHAIRMAN || config['spec-review'].chairman.role || 'auto') as string;
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairmanValue = normalizeBool(options['include-chairman']);
  const includeChairman = includeChairmanValue === true;
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? normalizeBool(options['exclude-chairman']) : includeChairmanValue === true ? false : null;

  const excludeSetting = normalizeBool(config['spec-review'].settings.exclude_chairman_from_members);
  const excludeChairmanFromMembers =
    excludeChairmanOverride != null ? excludeChairmanOverride : excludeSetting != null ? excludeSetting : true;

  const timeoutSetting = Number(config['spec-review'].settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride!) && timeoutOverride! > 0 ? timeoutOverride! : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedMembers = config['spec-review'].members || [];
  const members = requestedMembers.filter((r: any) => {
    if (!r || !r.name || !r.command) return false;
    const nameLc = String(r.name).toLowerCase();
    if (excludeChairmanFromMembers && !includeChairman && nameLc === chairmanRole) return false;
    return true;
  });

  const specName = (options.spec || null) as string | null;
  let specContext: { context: string; files: string[] } = { context: '', files: [] };
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
  const membersDir = path.join(jobDir, 'members');
  ensureDir(membersDir);

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
    config: JOB_CONFIG,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
}

// ---------------------------------------------------------------------------
// cmdStatus (spec-review-specific — adds specName to checklist output)
// ---------------------------------------------------------------------------

async function cmdStatus(options: Record<string, unknown>, jobDir: string): Promise<void> {
  const payload = await computeStatus(jobDir);

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    const extraInfo = payload.specName ? ` [spec: ${payload.specName}]` : '';
    process.stdout.write(`Spec Review${headerId}${extraInfo}\n`);
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
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
      prompt = (rest as string[]).join(' ').trim();
    }
    if (!prompt) exitWithError('start: missing prompt');
    await cmdStart(options, prompt);
    return;
  }
  if (command === 'status') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('status: missing jobDir');
    await cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('wait: missing jobDir');
    await _cmdWait(options, jobDir, JOB_CONFIG, WAIT_HOOKS);
    return;
  }
  if (command === 'collect') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('collect: missing jobDir');
    await _cmdCollect(options, jobDir, JOB_CONFIG);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('results: missing jobDir');
    _cmdResults(options, jobDir, JOB_CONFIG, RESULTS_HOOKS);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('stop: missing jobDir');
    _cmdStop(options, jobDir, JOB_CONFIG);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0] as string;
    if (!jobDir) exitWithError('clean: missing jobDir');
    const defaultJobsDir = (options['jobs-dir'] as string | undefined)
      || process.env.SPEC_REVIEW_JOBS_DIR
      || path.join(getOmtDir(), 'jobs');
    _cmdClean(options, jobDir, JOB_CONFIG, defaultJobsDir);
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
  computeTerminalDoneCount,
  parseArgs,
  generateJobId,
} from '@lib/job-utils';

export { buildUiPayload, parseSpecReviewConfig, parseYamlSimple, computeStatus, resolveContextDir, findProjectRoot };

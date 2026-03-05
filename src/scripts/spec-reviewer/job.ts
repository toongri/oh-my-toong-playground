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
} from '../../lib/job-utils';

import {
  type JobConfig,
  computeStatus as _computeStatus,
  buildUiPayload as _buildUiPayload,
  spawnWorkers as _spawnWorkers,
  cmdWait as _cmdWait,
  cmdResults as _cmdResults,
  cmdStop as _cmdStop,
  cmdClean as _cmdClean,
  cmdCollect as _cmdCollect,
  gcStaleJobs,
} from '../../lib/generic-job';

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
const WORKER_PATH = path.join(SCRIPT_DIR, 'worker.ts');

const SKILL_CONFIG_FILE = path.join(SCRIPT_DIR, 'spec-reviewer.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SCRIPT_DIR, '../../..'), 'spec-reviewer.config.yaml');

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

// parseYamlSimple: wraps framework version with JOB_CONFIG
function parseYamlSimple(configPath: string, fallback: Record<string, any>): Record<string, any> {
  // Framework parseYamlSimple doesn't handle 'context' section, so use local implementation
  // which is spec-review-specific (has context: section support).
  return _parseYamlSimpleWithContext(configPath, fallback);
}

// ---------------------------------------------------------------------------
// Spec-review-specific parseYamlSimple (adds context: section support)
// ---------------------------------------------------------------------------

function _parseYamlSimpleWithContext(configPath: string, fallback: Record<string, any>): Record<string, any> {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    const result: Record<string, any> = { 'spec-review': { chairman: {}, members: [], context: {}, settings: {} } };
    let currentSection: string | null = null;
    let currentMember: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === 'spec-review:') continue;
      if (trimmed === 'chairman:') { currentSection = 'chairman'; continue; }
      if (trimmed === 'reviewers:' || trimmed === 'members:') { currentSection = 'members'; continue; }
      if (trimmed === 'context:') { currentSection = 'context'; continue; }
      if (trimmed === 'settings:') { currentSection = 'settings'; continue; }

      if (currentSection === 'members' && trimmed.startsWith('- name:')) {
        if (currentMember) result['spec-review'].members.push(currentMember);
        currentMember = { name: trimmed.replace('- name:', '').trim().replace(/"/g, '') };
        continue;
      }

      if (currentMember && currentSection === 'members') {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
        if (match) {
          currentMember[match[1]] = match[2];
        }
        continue;
      }

      if (currentSection === 'chairman' || currentSection === 'settings' || currentSection === 'context') {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
        if (match) {
          let value: unknown = match[2];
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
          result['spec-review'][currentSection][match[1]] = value;
        }
      }
    }

    if (currentMember) result['spec-review'].members.push(currentMember);

    const fallbackSection = fallback['spec-review'] || {};
    if (result['spec-review'].members.length === 0) {
      result['spec-review'].members = fallbackSection.members || [];
    }
    result['spec-review'].chairman = { ...(fallbackSection.chairman || {}), ...result['spec-review'].chairman };
    result['spec-review'].settings = { ...(fallbackSection.settings || {}), ...result['spec-review'].settings };
    result['spec-review'].context = { ...(fallbackSection.context || {}), ...result['spec-review'].context };

    return result;
  } catch (e) {
    return fallback;
  }
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
      settings: { exclude_chairman_from_reviewers: true, timeout: 180 },
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

  const specReviewMembers = specReview.members ?? specReview.reviewers;
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

function findProjectRoot(): string | null {
  let current = SCRIPT_DIR;
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

  const normalized = SCRIPT_DIR.replace(/\\/g, '/');
  const scriptsMatch = normalized.match(/^(.+?)\/.claude\/scripts\//);
  if (scriptsMatch) {
    return scriptsMatch[1];
  }

  return null;
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
  const specsDir = contextConfig.specs_dir || '.omt/specs';

  const contextDir = resolveContextDir(sharedContextDirRaw, projectRoot);
  const specDir = path.join(projectRoot, specsDir, specName);

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
  spec-review-job.sh start [--config path] [--chairman auto|claude|codex|...] [--spec <spec-name>] [--jobs-dir path] [--json] "question"
  spec-review-job.sh start --stdin
  spec-review-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  spec-review-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  spec-review-job.sh collect [--timeout-ms N] <jobDir>
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

// ---------------------------------------------------------------------------
// Wait payload (spec-review-specific — adds specName field)
// ---------------------------------------------------------------------------

function asWaitPayload(statusPayload: any): any {
  const membersArray = Array.isArray(statusPayload.members) ? statusPayload.members : [];

  return {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    chairmanRole: statusPayload.chairmanRole,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    specName: statusPayload.specName,
    members: membersArray.map((r: any) => ({
      member: r.member,
      state: r.state,
      exitCode: r.exitCode != null ? r.exitCode : null,
      message: r.message || null,
    })),
    ui: buildUiPayload(statusPayload),
  };
}

async function cmdStart(options: Record<string, unknown>, prompt: string): Promise<void> {
  const configPath = (options.config || process.env.SPEC_REVIEW_CONFIG || resolveDefaultConfigFile()) as string;
  const jobsDir =
    (options['jobs-dir'] || process.env.SPEC_REVIEW_JOBS_DIR || path.join(SCRIPT_DIR, '.jobs')) as string;

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir, JOB_CONFIG);

  const hostRole = detectHostRole(SCRIPT_DIR);
  const config = await parseSpecReviewConfig(configPath);
  const chairmanRoleRaw = (options.chairman || process.env.SPEC_REVIEW_CHAIRMAN || config['spec-review'].chairman.role || 'auto') as string;
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairman = normalizeBool(options['include-chairman']);
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? true : options['include-chairman'] != null ? false : null;

  const excludeSetting = normalizeBool(config['spec-review'].settings.exclude_chairman_from_reviewers);
  const excludeChairmanFromReviewers =
    excludeChairmanOverride != null ? excludeChairmanOverride : excludeSetting != null ? excludeSetting : true;

  const timeoutSetting = Number(config['spec-review'].settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride!) && timeoutOverride! > 0 ? timeoutOverride! : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedMembers = config['spec-review'].members || [];
  const members = requestedMembers.filter((r: any) => {
    if (!r || !r.name || !r.command) return false;
    const nameLc = String(r.name).toLowerCase();
    if (excludeChairmanFromReviewers && !includeChairman && nameLc === chairmanRole) return false;
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
      excludeChairmanFromReviewers,
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
// cmdWait (spec-review-specific — adds specName to wait payload)
// ---------------------------------------------------------------------------

async function cmdWait(options: Record<string, unknown>, jobDir: string): Promise<void> {
  // We override the wait payload to include specName, so we implement our own cmdWait
  // rather than delegating to the framework's cmdWait.
  const { parseWaitCursor, formatWaitCursor, resolveBucketSize, sleepMs } = await import('../../lib/job-utils');

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

  let payload = await computeStatus(jobDir);
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
    await sleepMs(intervalMs);
    payload = await computeStatus(jobDir);
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

  const finalPayload = await computeStatus(jobDir);
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
// cmdResults (spec-review-specific — adds specName and prompt to JSON output)
// ---------------------------------------------------------------------------

function cmdResults(options: Record<string, unknown>, jobDir: string): void {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json')) as any;
  const membersRoot = path.join(resolvedJobDir, 'members');

  const members: any[] = [];
  if (fs.existsSync(membersRoot)) {
    for (const entry of fs.readdirSync(membersRoot)) {
      const statusPath = path.join(membersRoot, entry, 'status.json');
      const outputPath = path.join(membersRoot, entry, 'output.txt');
      const errorPath = path.join(membersRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath) as any;
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      members.push({ safeName: entry, ...status, output, stderr });
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
          members: members
            .map((r) => ({
              member: r.member,
              state: r.state,
              exitCode: r.exitCode != null ? r.exitCode : null,
              message: r.message || null,
              output: r.output,
              stderr: r.stderr,
            }))
            .sort((a, b) => String(a.member).localeCompare(String(b.member))),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  for (const r of members.sort((a, b) => String(a.member).localeCompare(String(b.member)))) {
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
    await cmdWait(options, jobDir);
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
    cmdResults(options, jobDir);
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
    _cmdClean(options, jobDir, JOB_CONFIG, path.join(SCRIPT_DIR, '.jobs'));
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
} from '../../lib/job-utils';

export { buildUiPayload, parseSpecReviewConfig, parseYamlSimple, computeStatus, resolveContextDir };

#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import {
  exitWithError,
  detectHostRole,
  normalizeBool,
  resolveAutoRole,
  ensureDir,
  atomicWriteJson,
  readJsonIfExists,
  parseArgs,
  generateJobId,
} from '../../../lib/job-utils';

import {
  type JobConfig,
  computeStatus as frameworkComputeStatus,
  buildUiPayload as frameworkBuildUiPayload,
  spawnWorkers as frameworkSpawnWorkers,
  cmdWait as frameworkCmdWait,
  cmdResults as frameworkCmdResults,
  cmdStop as frameworkCmdStop,
  cmdClean as frameworkCmdClean,
  cmdCollect as frameworkCmdCollect,
  gcStaleJobs,
  buildAugmentedCommand,
  detectCliType,
  parseYamlSimple as frameworkParseYamlSimple,
  buildManifest,
  safeFileName,
} from '../../../lib/generic-job';

// ---------------------------------------------------------------------------
// Council JobConfig
// ---------------------------------------------------------------------------

const COUNCIL_CONFIG: JobConfig = {
  entitySingular: 'member',
  entityPlural: 'members',
  entityDirName: 'members',
  jobPrefix: 'council-',
  uiLabel: '[Council]',
  configTopLevelKey: 'council',
};

const SCRIPT_DIR = import.meta.dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'council-job-worker.ts');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'council.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'council.config.yaml');

// ---------------------------------------------------------------------------
// Council-specific config parsing (preserved)
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

async function parseCouncilConfig(configPath) {
  const fallback = {
    council: {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '🤖', color: 'BLUE' },
        { name: 'gemini', command: 'gemini', emoji: '💎', color: 'GREEN' },
      ],
      settings: { exclude_chairman_from_members: true, timeout: 120 },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  let YAML;
  try {
    YAML = await import('yaml').then(m => m.default);
  } catch {
    // Fallback: use framework parseYamlSimple, then map reviewers -> members
    const raw = frameworkParseYamlSimple(configPath, {
      council: {
        chairman: fallback.council.chairman,
        reviewers: fallback.council.members,
        settings: fallback.council.settings,
      },
    }, COUNCIL_CONFIG);
    const rawCouncil = raw.council as any;
    return {
      council: {
        chairman: rawCouncil.chairman || fallback.council.chairman,
        members: rawCouncil.reviewers || fallback.council.members,
        settings: rawCouncil.settings || fallback.council.settings,
      },
    };
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
  if (!parsed.council) {
    exitWithError(`Invalid config in ${configPath}: missing required top-level key 'council:'`);
  }
  if (typeof parsed.council !== 'object' || Array.isArray(parsed.council)) {
    exitWithError(`Invalid config in ${configPath}: 'council' must be a mapping/object`);
  }

  const merged = {
    council: {
      chairman: { ...fallback.council.chairman },
      members: Array.isArray(fallback.council.members) ? [...fallback.council.members] : [],
      settings: { ...fallback.council.settings },
    },
  };

  const council = parsed.council;

  if (council.chairman != null) {
    if (typeof council.chairman !== 'object' || Array.isArray(council.chairman)) {
      exitWithError(`Invalid config in ${configPath}: 'council.chairman' must be a mapping/object`);
    }
    merged.council.chairman = { ...merged.council.chairman, ...council.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(council, 'members')) {
    if (!Array.isArray(council.members)) {
      exitWithError(`Invalid config in ${configPath}: 'council.members' must be a list/array`);
    }
    merged.council.members = council.members;
  }

  if (council.settings != null) {
    if (typeof council.settings !== 'object' || Array.isArray(council.settings)) {
      exitWithError(`Invalid config in ${configPath}: 'council.settings' must be a mapping/object`);
    }
    merged.council.settings = { ...merged.council.settings, ...council.settings };
  }

  return merged;
}

// Council-specific parseYamlSimple wrapper: adapts members <-> reviewers terminology
function parseYamlSimple(configPath: string, fallback: Record<string, any>): Record<string, any> {
  // Framework uses 'reviewers' internally; translate council's 'members' in fallback
  const councilFallback = fallback[COUNCIL_CONFIG.configTopLevelKey] || {};
  const adaptedFallback = {
    [COUNCIL_CONFIG.configTopLevelKey]: {
      chairman: councilFallback.chairman || {},
      reviewers: councilFallback.members || councilFallback.reviewers || [],
      settings: councilFallback.settings || {},
    },
  };
  const raw = frameworkParseYamlSimple(configPath, adaptedFallback, COUNCIL_CONFIG);
  // Map result back: reviewers -> members
  const rawSection = raw[COUNCIL_CONFIG.configTopLevelKey] as any;
  return {
    [COUNCIL_CONFIG.configTopLevelKey]: {
      chairman: rawSection.chairman,
      members: rawSection.reviewers,
      settings: rawSection.settings,
    },
  };
}

// ---------------------------------------------------------------------------
// Council-specific computeStatus wrapper (maps reviewers -> members in output)
// ---------------------------------------------------------------------------

// Arrow function wrapping framework's computeStatus — adapts `reviewers` field to council's `members`.
const computeStatus = async (jobDir: string): Promise<{
  jobDir: string;
  id: string | null;
  chairmanRole: string | null;
  overallState: string;
  counts: Record<string, number>;
  members: any[];
}> => {
  const result = await frameworkComputeStatus(jobDir, COUNCIL_CONFIG);
  // Framework returns `reviewers` array — remap to `members` for council terminology.
  const { reviewers, ...rest } = result as any;
  return {
    ...rest,
    members: (reviewers || []).map((r: any) => ({
      member: r.member,
      state: r.state,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      exitCode: r.exitCode,
      message: r.message,
    })),
  };
};

// Council-specific UI strings
const COUNCIL_UI_STRINGS = {
  dispatch: {
    completed: 'Dispatched council prompts',
    inProgress: 'Dispatching council prompts',
  },
  synthesize: {
    completed: 'Council results ready',
    inProgress: 'Ready to synthesize',
    pending: 'Waiting to synthesize',
  },
};

// ---------------------------------------------------------------------------
// Council-specific buildUiPayload wrapper (accepts members[] in statusPayload)
// ---------------------------------------------------------------------------

// Arrow function wrapping framework's buildUiPayload — adapts `members` field and patches UI strings.
const buildUiPayload = (statusPayload: {
  overallState?: string;
  counts?: Record<string, number>;
  members?: any[];
}): {
  progress: { done: number; total: number; overallState: string };
  codex: { update_plan: { plan: any[] } };
  claude: { todo_write: { todos: any[] } };
} => {
  // Framework expects `reviewers` field; map council's `members` -> `reviewers`
  const adapted = {
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    reviewers: (statusPayload.members || []).map((m: any) => ({
      member: m && m.member != null ? m.member : null,
      state: m && m.state != null ? m.state : 'unknown',
      exitCode: m && m.exitCode != null ? m.exitCode : null,
    })),
  };
  const result = frameworkBuildUiPayload(adapted, COUNCIL_CONFIG);

  // Patch dispatch and synth activeForm strings with council-specific wording
  const todos = result.claude.todo_write.todos;
  if (todos.length > 0) {
    const dispatchTodo = todos[0];
    if (dispatchTodo.activeForm === 'Dispatched review prompts') {
      dispatchTodo.activeForm = COUNCIL_UI_STRINGS.dispatch.completed;
    } else if (dispatchTodo.activeForm === 'Dispatching review prompts') {
      dispatchTodo.activeForm = COUNCIL_UI_STRINGS.dispatch.inProgress;
    }
    const synthTodo = todos[todos.length - 1];
    if (synthTodo.activeForm === 'Results ready') {
      synthTodo.activeForm = COUNCIL_UI_STRINGS.synthesize.completed;
    }
    // 'Ready to synthesize' and 'Waiting to synthesize' match between framework and council
  }

  return result;
};

// ---------------------------------------------------------------------------
// Council-specific start command
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(`Agent Council (job mode)

Usage:
  council-job.sh start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  council-job.sh start --stdin
  council-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  council-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  council-job.sh collect [--timeout-ms N] <jobDir>
  council-job.sh results [--json] <jobDir>
  council-job.sh stop <jobDir>
  council-job.sh clean <jobDir>

Notes:
  - start returns immediately and runs members in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

async function cmdStatus(options, jobDir) {
  const payload = await computeStatus(jobDir);

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const { computeTerminalDoneCount } = await import('../../../lib/job-utils');
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    process.stdout.write(`Agent Council${headerId}\n`);
    process.stdout.write(
      `Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`
    );
    for (const m of payload.members) {
      const state = String(m.state || '');
      const mark =
        state === 'done'
          ? '[x]'
          : state === 'running' || state === 'queued'
            ? '[ ]'
            : state
              ? '[!]'
              : '[ ]';
      const exitInfo = m.exitCode != null ? ` (exit ${m.exitCode})` : '';
      process.stdout.write(`${mark} ${m.member} \u2014 ${state}${exitInfo}\n`);
    }
    return;
  }

  const wantText = Boolean(options.text) && !options.json;
  if (wantText) {
    const { computeTerminalDoneCount } = await import('../../../lib/job-utils');
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`members ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const m of payload.members) {
        process.stdout.write(`- ${m.member}: ${m.state}${m.exitCode != null ? ` (exit ${m.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function cmdStart(options, prompt) {
  const configPath = options.config || process.env.COUNCIL_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.COUNCIL_JOBS_DIR || path.join(SKILL_DIR, '.jobs');

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir, COUNCIL_CONFIG);

  const hostRole = detectHostRole(SKILL_DIR);
  const config = await parseCouncilConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.COUNCIL_CHAIRMAN || config.council.chairman.role || 'auto';
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairman = normalizeBool(options['include-chairman']);
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? true : options['include-chairman'] != null ? false : null;

  const excludeSetting = normalizeBool(config.council.settings.exclude_chairman_from_members);
  const excludeChairmanFromMembers =
    excludeChairmanOverride != null ? excludeChairmanOverride : excludeSetting != null ? excludeSetting : true;

  const timeoutSetting = Number(config.council.settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedMembers = config.council.members || [];
  const members = requestedMembers.filter((m) => {
    if (!m || !m.name || !m.command) return false;
    const nameLc = String(m.name).toLowerCase();
    if (excludeChairmanFromMembers && !includeChairman && nameLc === chairmanRole) return false;
    return true;
  });

  const jobId = generateJobId();
  const jobDir = path.join(jobsDir, `council-${jobId}`);
  const membersDir = path.join(jobDir, 'members');
  ensureDir(membersDir);

  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), String(prompt), 'utf8');

  const jobMeta = {
    id: `council-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    hostRole,
    chairmanRole,
    settings: {
      excludeChairmanFromMembers,
      timeoutSec: timeoutSec || null,
    },
    members: members.map((m) => ({
      name: String(m.name),
      command: String(m.command),
      emoji: m.emoji ? String(m.emoji) : null,
      color: m.color ? String(m.color) : null,
      model: m.model || null,
      effort_level: m.effort_level || null,
      output_format: m.output_format || null,
    })),
  };
  atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  // Use framework spawnWorkers — it calls detectCliType + buildAugmentedCommand internally
  frameworkSpawnWorkers({
    entities: members,
    workerPath: WORKER_PATH,
    jobDir,
    entitiesDir: membersDir,
    timeoutSec,
    config: COUNCIL_CONFIG,
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

async function main() {
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
    await cmdStart(options, prompt);
    return;
  }
  if (command === 'status') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('status: missing jobDir');
    await cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('wait: missing jobDir');
    const waitOptions = { ...options, 'timeout-ms': options['timeout-ms'] ?? 0 };
    await frameworkCmdWait(waitOptions, jobDir, COUNCIL_CONFIG);
    return;
  }
  if (command === 'collect') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('collect: missing jobDir');
    await frameworkCmdCollect(options, jobDir, COUNCIL_CONFIG);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('results: missing jobDir');
    frameworkCmdResults(options, jobDir, COUNCIL_CONFIG);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('stop: missing jobDir');
    frameworkCmdStop(options, jobDir, COUNCIL_CONFIG);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('clean: missing jobDir');
    const defaultJobsDir = options['jobs-dir'] as string | undefined
      || process.env.COUNCIL_JOBS_DIR
      || path.join(SKILL_DIR, '.jobs');
    frameworkCmdClean(options, jobDir, COUNCIL_CONFIG, defaultJobsDir);
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
  safeFileName,
  atomicWriteJson,
  readJsonIfExists,
  parseArgs,
  generateJobId,
} from '../../../lib/job-utils';

export {
  buildUiPayload,
  parseCouncilConfig,
  parseYamlSimple,
  computeStatus,
  COUNCIL_CONFIG,
};

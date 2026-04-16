#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

import {
  exitWithError,
  ensureDir,
  atomicWriteJson,
  readJsonIfExists,
  parseArgs,
  generateJobId,
  computeTerminalDoneCount,
  findProjectRoot,
} from '@lib/job-utils';

import {
  type JobConfig,
  computeStatus as frameworkComputeStatus,
  spawnWorkers as frameworkSpawnWorkers,
  cmdWait as frameworkCmdWait,
  cmdResults as frameworkCmdResults,
  cmdStop as frameworkCmdStop,
  cmdClean as frameworkCmdClean,
  cmdCollect as frameworkCmdCollect,
  gcStaleJobs,
  parseYamlSimple as frameworkParseYamlSimple,
} from '@lib/generic-job';

import { getOmtDir } from '@lib/omt-dir';

// ---------------------------------------------------------------------------
// Review JobConfig
// ---------------------------------------------------------------------------

const REVIEW_CONFIG: JobConfig = {
  entitySingular: 'reviewer',
  entityPlural: 'reviewers',
  entityDirName: 'reviewers',
  jobPrefix: 'slides-review-',
  uiLabel: '[Review]',
  configTopLevelKey: 'review',
};

const SCRIPT_DIR = import.meta.dirname;
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'worker.ts');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'review.config.yaml');
const REPO_CONFIG_FILE = path.join(PROJECT_ROOT, 'review.config.yaml');

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(`Slides Review (job mode)

Usage:
  job.ts start [--config path] [--jobs-dir path] [--json] --stdin
  job.ts start [--config path] [--jobs-dir path] [--json] "prompt"
  job.ts status [--json|--text] <jobDir>
  job.ts collect [--timeout-ms N] <jobDir>
  job.ts results [--json] <jobDir>
  job.ts stop <jobDir>
  job.ts clean <jobDir>
`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStart(options, prompt) {
  const configPath = options.config || process.env.REVIEW_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.REVIEW_JOBS_DIR || path.join(getOmtDir(), 'jobs');

  ensureDir(jobsDir);
  gcStaleJobs(jobsDir, REVIEW_CONFIG);

  const config = frameworkParseYamlSimple(configPath, {
    review: {
      members: [
        { name: 'gemini', command: 'gemini', emoji: '💎', color: 'GREEN', output_format: 'text' },
      ],
      settings: { timeout: 120 },
    },
  }, REVIEW_CONFIG);

  const reviewConfig = config[REVIEW_CONFIG.configTopLevelKey] as any;
  const members = (reviewConfig.members || []).filter((m) => m && m.name && m.command);
  const timeoutSec = Number(reviewConfig.settings?.timeout || 0);

  const jobId = generateJobId();
  const jobDir = path.join(jobsDir, `slides-review-${jobId}`);
  const reviewersDir = path.join(jobDir, 'reviewers');
  ensureDir(reviewersDir);

  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), String(prompt), 'utf8');

  const jobMeta = {
    id: `slides-review-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    settings: {
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

  frameworkSpawnWorkers({
    entities: members,
    workerPath: WORKER_PATH,
    jobDir,
    entitiesDir: reviewersDir,
    timeoutSec,
    config: REVIEW_CONFIG,
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
    const payload = await frameworkComputeStatus(jobDir, REVIEW_CONFIG);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (command === 'collect') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('collect: missing jobDir');
    await frameworkCmdCollect(options, jobDir, REVIEW_CONFIG);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('results: missing jobDir');
    frameworkCmdResults(options, jobDir, REVIEW_CONFIG);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('stop: missing jobDir');
    frameworkCmdStop(options, jobDir, REVIEW_CONFIG);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('clean: missing jobDir');
    const defaultJobsDir = options['jobs-dir'] as string | undefined
      || process.env.REVIEW_JOBS_DIR
      || path.join(getOmtDir(), 'jobs');
    frameworkCmdClean(options, jobDir, REVIEW_CONFIG, defaultJobsDir);
    return;
  }

  exitWithError(`Unknown command: ${command}`);
}

if (import.meta.main) {
  main();
}

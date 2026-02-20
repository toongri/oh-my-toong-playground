#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('../../shared/lib/job-core.js');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'council-job-worker.js');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'council.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'council.config.yaml');

const ENTITY_CONFIG = {
  entityKey: 'member',
  entitiesDirName: 'members',
  uiLabel: '[Council]',
  skillName: 'Agent Council',
  safeNameFallback: 'member',
};

const UI_STRINGS = {
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

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

function parseCouncilConfig(configPath) {
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
    YAML = require('yaml');
  } catch {
    // yaml 패키지가 없으면 간단한 파서 사용
    return parseYamlSimple(configPath, fallback);
  }

  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    core.exitWithError(`Invalid YAML in ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    core.exitWithError(`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`);
  }
  if (!parsed.council) {
    core.exitWithError(`Invalid config in ${configPath}: missing required top-level key 'council:'`);
  }
  if (typeof parsed.council !== 'object' || Array.isArray(parsed.council)) {
    core.exitWithError(`Invalid config in ${configPath}: 'council' must be a mapping/object`);
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
      core.exitWithError(`Invalid config in ${configPath}: 'council.chairman' must be a mapping/object`);
    }
    merged.council.chairman = { ...merged.council.chairman, ...council.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(council, 'members')) {
    if (!Array.isArray(council.members)) {
      core.exitWithError(`Invalid config in ${configPath}: 'council.members' must be a list/array`);
    }
    merged.council.members = council.members;
  }

  if (council.settings != null) {
    if (typeof council.settings !== 'object' || Array.isArray(council.settings)) {
      core.exitWithError(`Invalid config in ${configPath}: 'council.settings' must be a mapping/object`);
    }
    merged.council.settings = { ...merged.council.settings, ...council.settings };
  }

  return merged;
}

// yaml 패키지 없이 간단한 YAML 파싱 (기본적인 구조만 지원)
function parseYamlSimple(configPath, fallback) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    const result = { council: { chairman: {}, members: [], settings: {} } };
    let currentSection = null;
    let currentMember = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === 'council:') continue;
      if (trimmed === 'chairman:') { currentSection = 'chairman'; continue; }
      if (trimmed === 'members:') { currentSection = 'members'; continue; }
      if (trimmed === 'settings:') { currentSection = 'settings'; continue; }

      if (currentSection === 'members' && trimmed.startsWith('- name:')) {
        if (currentMember) result.council.members.push(currentMember);
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

      if (currentSection === 'chairman' || currentSection === 'settings') {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
        if (match) {
          let value = match[2];
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          result.council[currentSection][match[1]] = value;
        }
      }
    }

    if (currentMember) result.council.members.push(currentMember);

    // 기본값 병합
    if (result.council.members.length === 0) {
      result.council.members = fallback.council.members;
    }
    result.council.chairman = { ...fallback.council.chairman, ...result.council.chairman };
    result.council.settings = { ...fallback.council.settings, ...result.council.settings };

    return result;
  } catch (e) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Council-specific command implementations
// ---------------------------------------------------------------------------

function computeStatus(jobDir) {
  return core.computeStatusPayload(jobDir, ENTITY_CONFIG);
}

function buildCouncilUiPayload(statusPayload) {
  return core.buildUiPayload(statusPayload, ENTITY_CONFIG, UI_STRINGS);
}

function councilAsWaitPayload(statusPayload) {
  return core.asWaitPayload(statusPayload, ENTITY_CONFIG, buildCouncilUiPayload);
}

function printHelp() {
  process.stdout.write(`Agent Council (job mode)

Usage:
  council-job.sh start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  council-job.sh start --stdin
  council-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  council-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  council-job.sh results [--json] <jobDir>
  council-job.sh stop <jobDir>
  council-job.sh clean <jobDir>

Notes:
  - start returns immediately and runs members in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs, so you don't spam tool cells
`);
}

function cmdStart(options, prompt) {
  const configPath = options.config || process.env.COUNCIL_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.COUNCIL_JOBS_DIR || path.join(SKILL_DIR, '.jobs');

  core.ensureDir(jobsDir);

  const hostRole = core.detectHostRole(SKILL_DIR);
  const config = parseCouncilConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.COUNCIL_CHAIRMAN || config.council.chairman.role || 'auto';
  const chairmanRole = core.resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairman = Boolean(options['include-chairman']);
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? true : options['include-chairman'] != null ? false : null;

  const excludeSetting = core.normalizeBool(config.council.settings.exclude_chairman_from_members);
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

  const jobId = core.generateJobId();
  const jobDir = path.join(jobsDir, `council-${jobId}`);
  const membersDir = path.join(jobDir, 'members');
  core.ensureDir(membersDir);

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
    })),
  };
  core.atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  core.spawnWorkers({
    entities: members,
    entityConfig: ENTITY_CONFIG,
    workerPath: WORKER_PATH,
    jobDir,
    entitiesDir: membersDir,
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
  core.mainRouter({
    printHelp,
    cmdStart,
    cmdStatus: (options, jobDir) => core.cmdStatus(options, jobDir, ENTITY_CONFIG, computeStatus),
    cmdWait: (options, jobDir) => core.cmdWait(options, jobDir, ENTITY_CONFIG, computeStatus, councilAsWaitPayload),
    cmdResults: (options, jobDir) => core.cmdResults(options, jobDir, ENTITY_CONFIG),
    cmdStop: (options, jobDir) => core.cmdStop(options, jobDir, ENTITY_CONFIG),
    cmdClean: (options, jobDir) => core.cmdClean(options, jobDir),
  });
}

if (require.main === module) {
  main();
}

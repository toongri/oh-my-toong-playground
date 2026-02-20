#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('../../shared/lib/job-core.js');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'spec-review-worker.js');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'spec-review.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'spec-review.config.yaml');

const ENTITY_CONFIG = {
  entityKey: 'reviewer',
  entitiesDirName: 'reviewers',
  uiLabel: '[Spec Review]',
  skillName: 'Spec Review',
  safeNameFallback: 'reviewer',
};

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
    core.exitWithError(`Invalid YAML in ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    core.exitWithError(`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`);
  }
  if (!parsed['spec-review']) {
    core.exitWithError(`Invalid config in ${configPath}: missing required top-level key 'spec-review:'`);
  }
  if (typeof parsed['spec-review'] !== 'object' || Array.isArray(parsed['spec-review'])) {
    core.exitWithError(`Invalid config in ${configPath}: 'spec-review' must be a mapping/object`);
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
      core.exitWithError(`Invalid config in ${configPath}: 'spec-review.chairman' must be a mapping/object`);
    }
    merged['spec-review'].chairman = { ...merged['spec-review'].chairman, ...specReview.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(specReview, 'reviewers')) {
    if (!Array.isArray(specReview.reviewers)) {
      core.exitWithError(`Invalid config in ${configPath}: 'spec-review.reviewers' must be a list/array`);
    }
    merged['spec-review'].reviewers = specReview.reviewers;
  }

  if (specReview.context != null) {
    if (typeof specReview.context !== 'object' || Array.isArray(specReview.context)) {
      core.exitWithError(`Invalid config in ${configPath}: 'spec-review.context' must be a mapping/object`);
    }
    merged['spec-review'].context = { ...merged['spec-review'].context, ...specReview.context };
  }

  if (specReview.settings != null) {
    if (typeof specReview.settings !== 'object' || Array.isArray(specReview.settings)) {
      core.exitWithError(`Invalid config in ${configPath}: 'spec-review.settings' must be a mapping/object`);
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
  // Look for .omt directory starting from skill directory and going up
  let current = SKILL_DIR;
  const root = path.parse(current).root;

  while (current !== root) {
    const omtDir = path.join(current, '.omt');
    if (fs.existsSync(omtDir) && fs.statSync(omtDir).isDirectory()) {
      return current;
    }

    // Also check for .git as fallback project root indicator
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }

    current = path.dirname(current);
  }

  // Fallback: try common patterns
  const normalized = SKILL_DIR.replace(/\\/g, '/');
  const skillsMatch = normalized.match(/^(.+?)\/.claude\/skills\//);
  if (skillsMatch) {
    return skillsMatch[1];
  }

  return null;
}

// Gather spec context from .omt/specs/ directory
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

  // 1. Gather ALL *.md files from shared_context_dir
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

  // 2. Gather spec.md from {specs_dir}/{specName}/
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

  // 3. Gather decision records from {specs_dir}/{specName}/records/
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
// Spec-review-specific command implementations
// ---------------------------------------------------------------------------

function computeStatus(jobDir) {
  return core.computeStatusPayload(jobDir, ENTITY_CONFIG, (jobMeta) => ({
    specName: jobMeta.specName || null,
  }));
}

function buildSpecReviewUiPayload(statusPayload) {
  return core.buildUiPayload(statusPayload, ENTITY_CONFIG, UI_STRINGS);
}

function specReviewAsWaitPayload(statusPayload) {
  return core.asWaitPayload(statusPayload, ENTITY_CONFIG, buildSpecReviewUiPayload, (sp) => ({
    specName: sp.specName,
  }));
}

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

  core.ensureDir(jobsDir);

  const hostRole = core.detectHostRole(SKILL_DIR);
  const config = parseSpecReviewConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.SPEC_REVIEW_CHAIRMAN || config['spec-review'].chairman.role || 'auto';
  const chairmanRole = core.resolveAutoRole(chairmanRoleRaw, hostRole);

  const includeChairman = Boolean(options['include-chairman']);
  const excludeChairmanOverride =
    options['exclude-chairman'] != null ? true : options['include-chairman'] != null ? false : null;

  const excludeSetting = core.normalizeBool(config['spec-review'].settings.exclude_chairman_from_reviewers);
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

  // Handle spec context
  const specName = options.spec || null;
  let specContext = { context: '', files: [] };
  if (specName) {
    specContext = gatherSpecContext(specName, config);
  }

  // Build final prompt with spec context
  let finalPrompt = prompt;
  if (specContext.context) {
    finalPrompt = `# Spec Review Context

${specContext.context}

---

# Review Question

${prompt}`;
  }

  const jobId = core.generateJobId();
  const jobDir = path.join(jobsDir, `spec-review-${jobId}`);
  const reviewersDir = path.join(jobDir, 'reviewers');
  core.ensureDir(reviewersDir);

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
  core.atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  core.spawnWorkers({
    entities: reviewers,
    entityConfig: ENTITY_CONFIG,
    workerPath: WORKER_PATH,
    jobDir,
    entitiesDir: reviewersDir,
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

const STATUS_LABELS = {
  checklistExtraFn: (payload) => payload.specName ? ` [spec: ${payload.specName}]` : '',
};

function main() {
  core.mainRouter({
    printHelp,
    cmdStart,
    cmdStatus: (options, jobDir) => core.cmdStatus(options, jobDir, ENTITY_CONFIG, computeStatus, STATUS_LABELS),
    cmdWait: (options, jobDir) => core.cmdWait(options, jobDir, ENTITY_CONFIG, computeStatus, specReviewAsWaitPayload),
    cmdResults: (options, jobDir) => core.cmdResults(options, jobDir, ENTITY_CONFIG, (jobMeta) => ({
      specName: jobMeta ? jobMeta.specName : null,
    })),
    cmdStop: (options, jobDir) => core.cmdStop(options, jobDir, ENTITY_CONFIG),
    cmdClean: (options, jobDir) => core.cmdClean(options, jobDir),
  });
}

if (require.main === module) {
  main();
}

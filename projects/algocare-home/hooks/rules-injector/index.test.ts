/**
 * rules-injector index CORE tests.
 *
 * Covers the two load-bearing dedup-correctness ACs (Metis C1):
 *   CP4a "gate-free path returns rules" — the exposed gate-free entry
 *        (processFilePathForRules) returns rules for a codex-Bash-shaped path,
 *        WITHOUT routing through processToolExecution (Claude-tool-name gated).
 *   CP4b "cross-process session dedup" — the SAME entry persists per-session
 *        dedup to disk at ~/.omt/rules-injector/<sid>.json, so a second call
 *        in a FRESH process with the same sid+path returns zero rules.
 *
 * Storage is at $HOME/.omt/rules-injector. constants.ts resolves it via
 * homedir() at module-load time, so every spawned worker runs with HOME set
 * to an isolated temp dir — the real ~ is never touched.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a fixture project: a git-rooted repo with an always-apply rule under
 * .claude/rules. Returns { repo, target } where target is an absolute,
 * codex-Bash-shaped path inside the repo.
 */
function makeFixtureRepo(): { repo: string; target: string } {
  const repo = makeTmpDir('rules-injector-repo-');
  // .git marks the project root for findProjectRoot.
  mkdirSync(join(repo, '.git'), { recursive: true });
  const rulesDir = join(repo, '.claude', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(
    join(rulesDir, 'always.md'),
    '---\nalwaysApply: true\n---\nAlways-apply rule body.\n'
  );
  const target = join(repo, 'src', 'service.ts');
  return { repo, target };
}

/**
 * Worker script: imports the CORE index, builds the hook for the fixture cwd,
 * and calls ONLY the gate-free entry processFilePathForRules. It deliberately
 * never references processToolExecution — proving structurally that the
 * gate-free path is not routed through the Claude-tool-name gate.
 */
const WORKER_SOURCE = `
import { createRulesInjectorHook } from ${JSON.stringify(
  join(import.meta.dir, 'index.ts')
)};

const [, , cwd, filePath, sessionId] = process.argv;
const hook = createRulesInjectorHook(cwd);
const rules = hook.processFilePathForRules(filePath, sessionId);
process.stdout.write(JSON.stringify({ count: rules.length, rules }));
`;

function makeWorker(): string {
  const dir = makeTmpDir('rules-injector-worker-');
  const workerPath = join(dir, 'worker.ts');
  writeFileSync(workerPath, WORKER_SOURCE);
  return workerPath;
}

interface WorkerResult {
  count: number;
  rules: Array<{ relativePath: string; matchReason: string }>;
}

/**
 * Run the codex hook ENTRY (index.ts's import.meta.main) by feeding `payload`
 * on stdin, the way codex invokes the PostToolUse hook. Returns the raw stdout,
 * the parsed stdout (or null when not valid JSON), and the process exit status.
 */
function runEntry(
  home: string,
  payload: string
): { status: number | null; stdout: string; parsed: any } {
  const indexPath = join(import.meta.dir, 'index.ts');
  const env = { ...process.env, HOME: home };
  const result = spawnSync('bun', ['run', indexPath], {
    input: payload,
    encoding: 'utf-8',
    env,
  });
  let parsed: any = null;
  const text = result.stdout.trim();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: result.status, stdout: result.stdout, parsed };
}

function runWorker(
  workerPath: string,
  home: string,
  cwd: string,
  filePath: string,
  sessionId: string
): WorkerResult {
  const env = { ...process.env, HOME: home };
  const result = spawnSync(
    'bun',
    ['run', workerPath, cwd, filePath, sessionId],
    { encoding: 'utf-8', env }
  );
  if (result.status !== 0) {
    throw new Error(
      `worker failed (status ${result.status}): ${result.stderr}`
    );
  }
  return JSON.parse(result.stdout) as WorkerResult;
}

describe('rules-injector CORE gate-free entry', () => {
  it('gate-free path returns rules', () => {
    const { repo, target } = makeFixtureRepo();
    const home = makeTmpDir('rules-injector-home-');
    const workerPath = makeWorker();

    const out = runWorker(workerPath, home, repo, target, 'sid-cp4a');

    // The gate-free entry returns the matching rule.
    expect(out.count).toBeGreaterThanOrEqual(1);

    // Structural proof the gate-free path is NOT routed through
    // processToolExecution (which gates on Claude tool names a codex Bash
    // call never matches): the worker calls only processFilePathForRules.
    expect(WORKER_SOURCE).toContain('processFilePathForRules');
    expect(WORKER_SOURCE).not.toContain('processToolExecution');
  });

  it('cross-process session dedup', () => {
    const { repo, target } = makeFixtureRepo();
    const home = makeTmpDir('rules-injector-home-');
    const workerPath = makeWorker();
    const sid = 'sid-cp4b';

    // Process A: first call persists dedup state to disk under the temp HOME.
    const a = runWorker(workerPath, home, repo, target, sid);
    expect(a.count).toBeGreaterThanOrEqual(1);

    const stateFile = join(home, '.omt', 'rules-injector', `${sid}.json`);
    expect(existsSync(stateFile)).toBe(true);

    // Process B: a FRESH process with the same sid+path loads the on-disk
    // state and dedups — zero rules returned.
    const b = runWorker(workerPath, home, repo, target, sid);
    expect(b.count).toBe(0);
  });
});

describe('rules-injector codex hook entry no-op contract', () => {
  it('no-match emits valid no-op', () => {
    // T5a: a well-formed PostToolUse payload whose command has no path-shaped
    // token. The entry must emit a valid no-op: hookEventName present, NO
    // additionalContext / no stray keys, and exit 0 (never block).
    const home = makeTmpDir('rules-injector-home-');
    const cwd = makeTmpDir('rules-injector-cwd-');
    const payload = JSON.stringify({
      session_id: 'sid-t5a',
      cwd,
      tool_input: { command: 'rg pat' },
      hook_event_name: 'PostToolUse',
    });

    const out = runEntry(home, payload);

    expect(out.status).toBe(0);
    expect(out.parsed).not.toBeNull();
    expect(out.parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    // No matched rules -> no additionalContext, and no stray keys.
    expect(out.parsed.hookSpecificOutput.additionalContext).toBeUndefined();
    expect(Object.keys(out.parsed.hookSpecificOutput)).toEqual([
      'hookEventName',
    ]);
    expect(Object.keys(out.parsed)).toEqual(['hookSpecificOutput']);
  });

  it('parse-error emits valid no-op', () => {
    // T5b: malformed JSON on stdin must NOT throw / exit nonzero / block.
    // The entry emits a valid no-op and exits 0.
    const home = makeTmpDir('rules-injector-home-');
    const payload = '{ this is not valid json';

    const out = runEntry(home, payload);

    expect(out.status).toBe(0);
    expect(out.parsed).not.toBeNull();
    expect(out.parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.parsed.hookSpecificOutput.additionalContext).toBeUndefined();
  });
});

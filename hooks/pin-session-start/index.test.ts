/**
 * Integration tests for pin-session-start entrypoint (AC-1.6, T16).
 *
 * Cases:
 *   C1. OMT_DIR env 미설정 → cwd 기반 self-compute로 정상 SessionStart 출력
 *   C2. 빈 pins/ 디렉토리 → bootstrap block 생성 (pins:0 + guidance lines)
 *   C3. pins/ 1개 .md → hookSpecificOutput 생성 (SessionStart, token budget)
 *   T16-A. absent manifest stays passive — no pins.yaml → passive suggestion; no file/dir created
 *   T16-B. manifest present → index summary injected as additionalContext (valid JSON, bounded)
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HOOK_PATH = join(import.meta.dir, 'index.ts');

function runHook(
  omtDir: string | undefined,
  options?: { inputOverride?: Record<string, unknown>; homeOverride?: string; cwd?: string },
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Fully unset OMT_DIR by deleting
  delete env.OMT_DIR;
  if (omtDir !== undefined) {
    env.OMT_DIR = omtDir;
  }
  env.HOME = options?.homeOverride ?? makeTmpDir();

  const input = { sessionId: 'test-session', ...(options?.inputOverride ?? {}) };
  return spawnSync('bun', ['run', HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env,
    cwd: options?.cwd,
  });
}

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = join(tmpdir(), 'pin-session-start-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Create a valid pin .md at pinsDir/<filename> */
function writePin(pinsDir: string, filename: string, id: string, type = 'code', tags = 'test'): void {
  const content = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    'source: github',
    'authority: test',
    'source_url: https://example.com',
    'tier: "1"',
    `tags: ${tags}`,
    'sensitivity: shared',
    'status: active',
    'updated_at: 2025-01-01T00:00:00Z',
    'checked_at: 2025-01-01T00:00:00Z',
    'created_at: 2025-01-01T00:00:00Z',
    'relations: []',
    '---',
    '',
    '## 맥락',
    'test body',
    '',
    '## 증거',
    '',
    '## 영향',
    '',
    '## 메모',
    '',
  ].join('\n');
  writeFileSync(join(pinsDir, filename), content, 'utf-8');
}

describe('pin-session-start entrypoint', () => {
  it('C1: OMT_DIR env 미설정 → cwd 기반 self-compute로 정상 SessionStart 출력', () => {
    // HOME을 tmp로 가둬 $HOME/.omt 자가 계산이 호스트 OMT 디렉토리를 건드리지 않게 함
    const fakeHome = makeTmpDir();
    const cwd = makeTmpDir();
    spawnSync('git', ['init'], { cwd });

    const result = runHook(undefined, {
      inputOverride: { cwd },
      homeOverride: fakeHome,
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(String(result.stdout).trim());
    // env가 없어도 self-compute로 OMT_DIR을 결정해 정상 출력해야 함
    expect(output).toBeDefined();
    // Valid JSON — at minimum an object (may be empty or have hookSpecificOutput)
    expect(typeof output).toBe('object');
  });

  it('C2: 빈 pins/ 디렉토리 → bootstrap block 생성 (pins:0 + guidance lines)', () => {
    const omtDir = makeTmpDir();
    mkdirSync(join(omtDir, 'pins'), { recursive: true });

    const result = runHook(omtDir);

    expect(result.status).toBe(0);

    const output = JSON.parse(String(result.stdout).trim());
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain('pin-query');
    expect(ctx).toContain('pin-record');
    expect(ctx).not.toContain('select-pin');
    expect(ctx).not.toContain('write-pin');
  });

  it('C3: pins/ 1개 .md → hookSpecificOutput SessionStart 생성 + token budget ≤80', () => {
    const omtDir = makeTmpDir();
    const pinsDir = join(omtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });
    writeFileSync(join(pinsDir, 'code-auth-jwt.md'), '# code-auth-jwt\n\ntoken verification pin\n', 'utf-8');

    const result = runHook(omtDir);

    expect(result.status).toBe(0);

    const output = JSON.parse(String(result.stdout).trim());
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    // Word count budget
    const wordCount = ctx.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(80);
  });

  it('T16-A: absent manifest stays passive — no pins.yaml → passive suggestion; no file/dir created', () => {
    // Both omtDir (userRoot) and cwd (projectRoot) have no pins.yaml
    const omtDir = makeTmpDir();
    const projectCwd = makeTmpDir();
    spawnSync('git', ['init'], { cwd: projectCwd });

    const before = readdirSync(omtDir);
    const beforeCwd = readdirSync(projectCwd);

    const result = runHook(omtDir, { inputOverride: { cwd: projectCwd } });

    expect(result.status).toBe(0);

    // Output must be valid JSON
    const raw = String(result.stdout).trim();
    const output = JSON.parse(raw);
    expect(typeof output).toBe('object');

    // When manifest is absent: must inject passive setup suggestion
    const ctx: string | undefined = output.hookSpecificOutput?.additionalContext;
    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
    // Must contain passive suggestion keywords (pins setup guidance)
    const ctxStr = ctx as string;
    expect(
      ctxStr.includes('pins.yaml') || ctxStr.includes('pin-setup') || ctxStr.includes('pin'),
    ).toBe(true);

    // No file/dir must be created in omtDir beyond what was there before
    const after = readdirSync(omtDir);
    expect(after.sort()).toEqual(before.sort());

    // No file/dir created in projectCwd
    const afterCwd = readdirSync(projectCwd);
    // .git exists because we ran git init — filter it out
    const newFiles = afterCwd.filter((f) => !beforeCwd.includes(f) && f !== '.git');
    expect(newFiles).toHaveLength(0);
  });

  it('C4: OMT_DIR unset, input.cwd differs from process.cwd → uses input.cwd for user manifest lookup', () => {
    // The bug: when OMT_DIR is unset, resolveManifest was called with userRoot derived from
    // process.cwd() (hook's own cwd), not from input.cwd (the Claude session's cwd).
    // Fix: hook must pass userRoot = resolveOmtDir(input.cwd).

    const fakeHome = makeTmpDir();
    // The "Claude session" cwd — this is what we want userRoot derived from
    const sessionCwd = makeTmpDir();
    spawnSync('git', ['init'], { cwd: sessionCwd });

    // Create a pins.yaml in the OMT dir for sessionCwd.
    // Since sessionCwd is not a standard git repo, resolveOmtDir(sessionCwd) falls
    // back to basename(sessionCwd). Under fakeHome, that path is fakeHome/.omt/<name>.
    const sessionCwdName = sessionCwd.split('/').pop()!;
    const userOmtDir = join(fakeHome, '.omt', sessionCwdName);
    mkdirSync(userOmtDir, { recursive: true });
    const pinsDir = join(userOmtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });
    writeFileSync(join(userOmtDir, 'pins.yaml'), `location: ${pinsDir}\nscope: user\n`, 'utf-8');

    // The hook process runs from a different cwd (a separate tmp dir that has no pins)
    const hookProcessCwd = makeTmpDir();

    const result = runHook(undefined, {
      inputOverride: { cwd: sessionCwd },
      homeOverride: fakeHome,
      cwd: hookProcessCwd,
    });

    expect(result.status).toBe(0);

    const output = JSON.parse(String(result.stdout).trim());
    // Because the manifest was found via input.cwd-derived userRoot, we expect index output
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    // Index was found → must contain scope:user (not passive suggestion)
    expect(ctx).toContain('scope:user');
  });

  it('T16-B: manifest present → index summary injected as additionalContext (valid JSON, bounded)', () => {
    const omtDir = makeTmpDir();
    const pinsDir = join(omtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });

    // Write a valid pin
    writePin(pinsDir, 'code-auth-jwt.md', 'code-auth-jwt', 'code', 'auth,jwt');

    // Write pins.yaml manifest in omtDir (userRoot)
    writeFileSync(join(omtDir, 'pins.yaml'), `location: ${pinsDir}\nscope: user\n`, 'utf-8');

    const result = runHook(omtDir);

    expect(result.status).toBe(0);

    const output = JSON.parse(String(result.stdout).trim());
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeGreaterThan(0);

    // Index summary must include count and location
    expect(ctx).toContain('pins:1');
    expect(ctx).toContain('scope:user');

    // Bounded — word count must be reasonable (< 200 words)
    const wordCount = ctx.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(200);

    // Must still include guidance (current skill vocabulary)
    expect(ctx).toContain('pin-query');
    expect(ctx).toContain('pin-record');
    expect(ctx).not.toContain('select-pin');
    expect(ctx).not.toContain('write-pin');
  });
});

/**
 * Integration tests for pin-session-start entrypoint (AC-1.6).
 *
 * 3 cases:
 *   C1. OMT_DIR env 미설정 → cwd 기반 self-compute로 정상 SessionStart 출력
 *   C2. 빈 pins/ 디렉토리 → bootstrap block 생성 (pins:0 + 3 guidance lines)
 *   C3. pins/ 1개 .md → hookSpecificOutput 생성 (SessionStart, token budget)
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HOOK_PATH = join(import.meta.dir, 'index.ts');

function runHook(
  omtDir: string | undefined,
  options?: { inputOverride?: Record<string, unknown>; homeOverride?: string },
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // OMT_DIR を完全に unset するには削除する
  delete env.OMT_DIR;
  if (omtDir !== undefined) {
    env.OMT_DIR = omtDir;
  }
  if (options?.homeOverride) {
    env.HOME = options.homeOverride;
  }

  const input = { sessionId: 'test-session', ...(options?.inputOverride ?? {}) };
  return spawnSync('bun', ['run', HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env,
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

describe('pin-session-start entrypoint', () => {
  it('C1: OMT_DIR env 미설정 → cwd 기반 self-compute로 정상 SessionStart 출력', () => {
    // HOME 을 tmp 로 가둬 $HOME/.omt 자가 계산이 호스트 OMT 디렉토리를 건드리지 않게 함
    const fakeHome = makeTmpDir();
    const cwd = makeTmpDir();
    spawnSync('git', ['init'], { cwd });

    const result = runHook(undefined, {
      inputOverride: { cwd },
      homeOverride: fakeHome,
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    // env가 없어도 self-compute로 OMT_DIR을 결정해 정상 출력해야 함
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('pins:');
  });

  it('C2: 빈 pins/ 디렉토리 → bootstrap block 생성 (pins:0 + 3 guidance lines)', () => {
    const omtDir = makeTmpDir();
    mkdirSync(join(omtDir, 'pins'), { recursive: true });

    const result = runHook(omtDir);

    expect(result.status).toBe(0);

    const output = JSON.parse(result.stdout.trim());
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain('pins:0');
    expect(ctx).toContain('select-pin');
    expect(ctx).toContain('write-pin');
    expect(ctx).toContain('supersedes');
  });

  it('C3: pins/ 1개 .md → hookSpecificOutput SessionStart 생성 + token budget ≤80', () => {
    const omtDir = makeTmpDir();
    const pinsDir = join(omtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });
    writeFileSync(join(pinsDir, 'code-auth-jwt.md'), '# code-auth-jwt\n\ntoken verification pin\n', 'utf-8');

    const result = runHook(omtDir);

    expect(result.status).toBe(0);

    const output = JSON.parse(result.stdout.trim());
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');

    const ctx: string = output.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('pins:1');

    // AC-2 token budget: word count < 80
    const wordCount = ctx.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(80);
  });
});

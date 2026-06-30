import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseInput, main } from './index.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseInput', () => {
  it('유효한 JSON에서 cwd와 sessionId를 파싱한다', () => {
    const result = parseInput('{"sessionId": "abc123", "cwd": "/tmp/project"}');
    expect(result.sessionId).toBe('abc123');
    expect(result.cwd).toBe('/tmp/project');
    expect(result.hookEventName).toBe('UserPromptSubmit');
  });

  it('유효하지 않은 JSON이면 기본값으로 폴백한다', () => {
    const result = parseInput('not-json');
    expect(result.sessionId).toBe('default');
    expect(result.cwd).toBe(process.cwd());
    expect(result.hookEventName).toBe('UserPromptSubmit');
  });

  it('snake_case session_id를 처리한다', () => {
    const result = parseInput('{"session_id": "snake123"}');
    expect(result.sessionId).toBe('snake123');
  });

  it('session_id보다 sessionId를 우선한다', () => {
    const result = parseInput('{"sessionId": "camel", "session_id": "snake"}');
    expect(result.sessionId).toBe('camel');
  });

  it('hook_event_name이 전달되면 해당 값을 사용한다', () => {
    const result = parseInput('{"hook_event_name": "TestEvent"}');
    expect(result.hookEventName).toBe('TestEvent');
  });
});

describe('main (통합)', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let consoleOutput: string[];
  let originalLog: typeof console.log;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-catalog-integration-'));
    originalHome = process.env.HOME;
    originalLog = console.log;
    consoleOutput = [];
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    };
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    console.log = originalLog;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('플러그인 활성화 시 plain-text 카탈로그를 출력한다', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('<skill-catalog>');
    expect(joined).toContain('</skill-catalog>');
    expect(joined).toContain('superpowers:test-driven-development');
  });

  it('플러그인 활성화 시 스킬 디렉토리 없어도 plugin 스킬 포함', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('superpowers:test-driven-development');
  });

  it('plain-text 출력에 Load Skills 헤더가 포함된다', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    await main();

    const joined = consoleOutput.join('\n');
    expect(joined).toContain('## Load Skills');
  });

  it('stdin 미패치 상태에서도 hang 없이 카탈로그를 출력한다', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    // stdin을 전혀 패치하지 않음 — 이전 구현은 stdin 'end' 이벤트를 기다리며 hang
    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('<skill-catalog>');
    expect(joined).toContain('</skill-catalog>');
  });

  it('main stdout is byte-identical across two consecutive invocations (AC1c)', async () => {
    // Controls: fake HOME with two known enabled plugins + no skill dirs,
    // so both invocations see the same environment and filesystem state.
    // This test documents the guarantee that Set/Map iteration order in
    // readEnabledPlugins / buildCatalog never introduces session-to-session variance.
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'frontend-design@claude-plugins-official': true,
        },
      }),
    );
    process.env.HOME = fakeHome;

    // First invocation — consoleOutput is captured via the shared beforeEach console.log patch
    consoleOutput = [];
    await main();
    const first = [...consoleOutput];

    // Second invocation
    consoleOutput = [];
    await main();
    const second = [...consoleOutput];

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });
});

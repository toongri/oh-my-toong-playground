import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseInput, main } from './index.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

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

  function createMockStdin(data: string): NodeJS.ReadableStream {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    return readable as NodeJS.ReadableStream;
  }

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

  it('유효한 입력에서 additionalContext가 포함된 JSON을 출력한다', async () => {
    const projectDir = join(tempDir, 'project');
    const skillsDir = join(projectDir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'my-skill'), { recursive: true });

    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    const mockStdin = createMockStdin(JSON.stringify({ sessionId: 'test', cwd: projectDir }));
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const output = JSON.parse(consoleOutput[consoleOutput.length - 1]);
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(output.hookSpecificOutput.additionalContext).toContain('<skill-catalog>');
    expect(output.hookSpecificOutput.additionalContext).toContain('</skill-catalog>');
    expect(output.hookSpecificOutput.additionalContext).toContain('superpowers:test-driven-development');
    expect(output.hookSpecificOutput.additionalContext).toContain('my-skill');
  });

  it('플러그인 활성화 시 스킬 디렉토리 없어도 plugin 스킬 포함', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    const mockStdin = createMockStdin(JSON.stringify({ sessionId: 'test', cwd: join(tempDir, 'nonexistent') }));
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const output = JSON.parse(consoleOutput[consoleOutput.length - 1]);
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput.additionalContext).toContain('superpowers:test-driven-development');
  });

  it('additionalContext에 Load Skills 헤더가 포함된다', async () => {
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    process.env.HOME = fakeHome;

    const mockStdin = createMockStdin(JSON.stringify({ sessionId: 'test', cwd: join(tempDir, 'nonexistent') }));
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    await main();

    const output = JSON.parse(consoleOutput[consoleOutput.length - 1]);
    expect(output.hookSpecificOutput.additionalContext).toContain('## Load Skills');
  });

  it('fail-open: stdin 오류 시 continue:true를 출력한다', async () => {
    const readable = new Readable({
      read() {
        process.nextTick(() => this.destroy(new Error('stdin broken')));
      },
    });
    Object.defineProperty(process, 'stdin', {
      value: readable,
      writable: true,
      configurable: true,
    });

    await main();

    expect(consoleOutput.length).toBeGreaterThan(0);
    const lastOutput = consoleOutput[consoleOutput.length - 1];
    const output = JSON.parse(lastOutput);
    expect(output.continue).toBe(true);
  });
});

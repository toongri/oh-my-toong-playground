import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseInput, main } from './index.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

describe('parseInput', () => {
  it('parses valid JSON with cwd and sessionId', () => {
    const result = parseInput('{"sessionId": "abc123", "cwd": "/tmp/project"}');
    expect(result.sessionId).toBe('abc123');
    expect(result.cwd).toBe('/tmp/project');
  });

  it('falls back to defaults on invalid JSON', () => {
    const result = parseInput('not-json');
    expect(result.sessionId).toBe('default');
    expect(result.cwd).toBe(process.cwd());
  });

  it('handles session_id snake_case variant', () => {
    const result = parseInput('{"session_id": "snake123"}');
    expect(result.sessionId).toBe('snake123');
  });

  it('prefers sessionId over session_id', () => {
    const result = parseInput('{"sessionId": "camel", "session_id": "snake"}');
    expect(result.sessionId).toBe('camel');
  });
});

describe('main (integration)', () => {
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

  it('outputs valid JSON with additionalContext on valid input', async () => {
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
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
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

  it('fail-open: outputs continue:true on broken stdin', async () => {
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

/**
 * codex AgentDriver fixture-replay tests.
 *
 * All fixtures are committed under __fixtures__/codex-*.ndjson.
 * Tests use Korean displayNames per repo convention; method names in English backticks.
 */

import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { codexDriver } from './codex';

const FIXTURES = path.join(import.meta.dir, '__fixtures__');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('codex AgentDriver', () => {
  // -------------------------------------------------------------------------
  // parseStdout — fixture-replay
  // -------------------------------------------------------------------------

  test('`parseStdout` - 센티넬 포함 turn.completed 픽스처에서 stop 분류 및 UUID 추출 (AC-A6)', () => {
    const stdout = readFixture('codex-turn-completed-with-sentinel.ndjson');
    const result = codexDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.sessionID).toBe('019e3152-c43b-7e03-8ada-4620be171fa7');
    expect(result!.text).toContain('## Verdict');
    expect(result!.terminal).toBe('stop');
  });

  test('`parseStdout` - 단순 turn.completed 픽스처에서 stop 분류 및 텍스트 추출', () => {
    const stdout = readFixture('codex-trivial.ndjson');
    const result = codexDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.sessionID).toBe('019e3152-c43b-7e03-8ada-4620be171fa7');
    expect(result!.terminal).toBe('stop');
    expect(result!.text).toBe(
      'We discussed that my previous response should be summarized as a single sentence.',
    );
  });

  test('`parseStdout` - turn.failed 픽스처에서 error 분류 (AC-A7)', () => {
    const stdout = readFixture('codex-turn-failed.ndjson');
    const result = codexDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.sessionID).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result!.terminal).toBe('error');
  });

  // -------------------------------------------------------------------------
  // parseStdout — synthesized NDJSON
  // -------------------------------------------------------------------------

  test('`parseStdout` - turn.completed 없는 mid-progress는 tool-calls 반환', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'partial response' } }),
    ].join('\n');
    const result = codexDriver.parseStdout(lines);
    expect(result).not.toBeNull();
    expect(result!.terminal).toBe('tool-calls');
    expect(result!.sessionID).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  test('`parseStdout` - 터미널 이벤트 없이 thread.started만 있을 때 unknown_pause 반환', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'ffffffff-0000-1111-2222-333333333333' }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_0', type: 'agent_message' } }),
    ].join('\n');
    const result = codexDriver.parseStdout(lines);
    expect(result).not.toBeNull();
    expect(result!.terminal).toBe('unknown_pause');
  });

  test('`parseStdout` - agent_message 아닌 item.completed는 text에서 제외', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: '11111111-2222-3333-4444-555555555555' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'tool_call_output', text: 'tool output content' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'agent reply' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n');
    const result = codexDriver.parseStdout(lines);
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain('tool output content');
    expect(result!.text).toContain('agent reply');
    expect(result!.terminal).toBe('stop');
  });

  test('`parseStdout` - 완전히 잘못된 입력은 null 반환', () => {
    const result = codexDriver.parseStdout('garbage\nnot json at all\n{}broken');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // initialCommand
  // -------------------------------------------------------------------------

  test('`initialCommand` - --skip-git-repo-check 없으면 주입', () => {
    const result = codexDriver.initialCommand({
      prompt: 'prompt-content',
      baseCommand: 'codex',
      baseArgs: ['exec', '--json', 'prompt-content'],
      workerEnv: {},
    });
    expect(result.program).toBe('codex');
    expect(result.args).toContain('--skip-git-repo-check');
  });

  test('`initialCommand` - --skip-git-repo-check 이미 있으면 중복 없음', () => {
    const result = codexDriver.initialCommand({
      prompt: 'prompt-content',
      baseCommand: 'codex',
      baseArgs: ['exec', '--json', '--skip-git-repo-check', 'prompt-content'],
      workerEnv: {},
    });
    expect(result.args.filter((a) => a === '--skip-git-repo-check').length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // resumeCommand
  // -------------------------------------------------------------------------

  test('`resumeCommand` - exec resume 서브커맨드 형식 사용', () => {
    const result = codexDriver.resumeCommand({
      sessionID: '019e3152-c43b-7e03-8ada-4620be171fa7',
      prompt: 'continue',
      baseCommand: 'codex',
      baseArgs: ['exec', '--json', 'prompt-content'],
      workerEnv: {},
    });
    expect(result.program).toBe('codex');
    expect(result.args[0]).toBe('exec');
    expect(result.args[1]).toBe('resume');
    expect(result.args[2]).toBe('019e3152-c43b-7e03-8ada-4620be171fa7');
  });

  test('`resumeCommand` - --json과 --skip-git-repo-check 포함', () => {
    const result = codexDriver.resumeCommand({
      sessionID: '019e3152-c43b-7e03-8ada-4620be171fa7',
      prompt: 'continue',
      baseCommand: 'codex',
      baseArgs: ['exec', '--json', 'prompt-content'],
      workerEnv: {},
    });
    expect(result.args).toContain('--json');
    expect(result.args).toContain('--skip-git-repo-check');
  });

  test('`resumeCommand` - baseArgs의 -c 오버라이드 보존', () => {
    const result = codexDriver.resumeCommand({
      sessionID: '019e3152-c43b-7e03-8ada-4620be171fa7',
      prompt: 'continue',
      baseCommand: 'codex',
      baseArgs: ['exec', '-c', 'model_provider=oss', '--json', 'prompt-content'],
      workerEnv: { MY_VAR: 'val' },
    });
    const idx = result.args.indexOf('-c');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(result.args[idx + 1]).toBe('model_provider=oss');
    expect(result.env).toMatchObject({ MY_VAR: 'val' });
  });
});

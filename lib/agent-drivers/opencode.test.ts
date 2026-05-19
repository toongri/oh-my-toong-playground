/**
 * opencode AgentDriver fixture-replay tests.
 *
 * All fixtures are committed under __fixtures__/opencode-*.ndjson.
 * Tests use Korean displayNames per repo convention; method names in English backticks.
 */

import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { opencodeDriver } from './opencode';

const FIXTURES = path.join(import.meta.dir, '__fixtures__');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('opencode AgentDriver', () => {
  // -------------------------------------------------------------------------
  // parseStdout — happy path
  // -------------------------------------------------------------------------

  test('`parseStdout` - 센티넬 포함 픽스처에서 stop 분류 및 세션ID 추출', () => {
    const stdout = readFixture('opencode-with-sentinel.ndjson');
    const result = opencodeDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.sessionID).toBe('ses_sentinel');
    expect(result!.terminal).toBe('stop');
    expect(result!.text).toContain('## Verdict');
  });

  test('`parseStdout` - step_finish 없는 픽스처는 unknown_pause 반환', () => {
    const stdout = readFixture('opencode-narrative-only.ndjson');
    const result = opencodeDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.sessionID).toBe('ses_narrative_repro');
    expect(result!.terminal).toBe('unknown_pause');
    // Should include all 7 text events concatenated
    expect(result!.text).toContain('code-review intent');
    expect(result!.text).toContain('Two verified defects');
  });

  test('`parseStdout` - multi-step 픽스처에서 텍스트 추출 및 터미널 분류', () => {
    const stdout = readFixture('opencode-multi-step.ndjson');
    const result = opencodeDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    // step_finish absent (line 3 is "exit=0", non-JSON) → unknown_pause
    expect(result!.terminal).toBe('unknown_pause');
    // text should contain the model's response
    expect(result!.text.length).toBeGreaterThan(0);
    expect(result!.text).toContain('7');
  });

  test('`parseStdout` - tool-calls 픽스처에서 tool-calls 터미널 분류', () => {
    const stdout = readFixture('opencode-tooluse.ndjson');
    const result = opencodeDriver.parseStdout(stdout);
    expect(result).not.toBeNull();
    // fixture has step_finish with reason:"tool-calls"
    expect(result!.terminal).toBe('tool-calls');
    // text from the second step's text event
    expect(result!.text).toContain('hello-from-bash');
  });

  // -------------------------------------------------------------------------
  // parseStdout — error / degraded
  // -------------------------------------------------------------------------

  test('`parseStdout` - 말형성(malformed) NDJSON 마지막 줄 잘림 시 null 반환', () => {
    const stdout = readFixture('opencode-malformed-ndjson.txt');
    // Last line is truncated mid-JSON with no trailing newline → catastrophic failure
    const result = opencodeDriver.parseStdout(stdout);
    expect(result).toBeNull();
  });

  test('`parseStdout` - sessionID 없는 픽스처는 null이 아닌 ParseResult 반환, sessionID는 null', () => {
    const stdout = readFixture('opencode-no-session-id.ndjson');
    const result = opencodeDriver.parseStdout(stdout);
    // parse must succeed (non-null)
    expect(result).not.toBeNull();
    // but sessionID is unrecoverable
    expect(result!.sessionID).toBeNull();
    // terminal should still be classified from step_finish
    expect(result!.terminal).toBe('stop');
  });

  // -------------------------------------------------------------------------
  // resumeCommand
  // -------------------------------------------------------------------------

  test('`resumeCommand` - --session과 --format json 주입', () => {
    const result = opencodeDriver.resumeCommand({
      sessionID: 'ses_xyz',
      prompt: 'continue',
      baseCommand: 'opencode',
      baseArgs: ['run', '--prompt', 'hi'],
      workerEnv: {},
    });
    expect(result.program).toBe('opencode');
    expect(result.args).toContain('--session');
    expect(result.args).toContain('ses_xyz');
    expect(result.args).toContain('--format');
    expect(result.args).toContain('json');
    // original args preserved
    expect(result.args).toContain('run');
    expect(result.args).toContain('--prompt');
    expect(result.args).toContain('hi');
  });

  test('`resumeCommand` - 기존 --session 쌍 교체 (중복 없음)', () => {
    const result = opencodeDriver.resumeCommand({
      sessionID: 'ses_new',
      prompt: 'continue',
      baseCommand: 'opencode',
      baseArgs: ['run', '--session', 'ses_old', '--format', 'json'],
      workerEnv: { MY_VAR: 'val' },
    });
    // old session replaced, no duplicate
    const sessionIdx = result.args.indexOf('--session');
    expect(sessionIdx).toBeGreaterThanOrEqual(0);
    expect(result.args[sessionIdx + 1]).toBe('ses_new');
    // only one --session
    expect(result.args.filter((a) => a === '--session').length).toBe(1);
    // env passed through
    expect(result.env).toMatchObject({ MY_VAR: 'val' });
  });

  // -------------------------------------------------------------------------
  // resumeCommand — --format value check (regression)
  // -------------------------------------------------------------------------

  test('`resumeCommand` - baseArgs에 --format text가 있으면 --format json으로 교체', () => {
    const result = opencodeDriver.resumeCommand({
      sessionID: 'ses_abc',
      prompt: 'continue',
      baseCommand: 'opencode',
      baseArgs: ['run', '--format', 'text'],
      workerEnv: {},
    });
    // exactly one --format
    expect(result.args.filter((a) => a === '--format').length).toBe(1);
    // value is json, not text
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
    expect(result.args).not.toContain('text');
  });

  test('`resumeCommand` - baseArgs에 --format json이 이미 있으면 중복 없이 1개만 유지', () => {
    const result = opencodeDriver.resumeCommand({
      sessionID: 'ses_abc',
      prompt: 'continue',
      baseCommand: 'opencode',
      baseArgs: ['run', '--format', 'json'],
      workerEnv: {},
    });
    // idempotent: exactly one --format json, no duplicates
    expect(result.args.filter((a) => a === '--format').length).toBe(1);
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
  });

  test('`resumeCommand` - baseArgs에 --format 없으면 --format json 추가', () => {
    const result = opencodeDriver.resumeCommand({
      sessionID: 'ses_abc',
      prompt: 'continue',
      baseCommand: 'opencode',
      baseArgs: ['run', '--prompt', 'hi'],
      workerEnv: {},
    });
    expect(result.args).toContain('--format');
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
  });

  // -------------------------------------------------------------------------
  // initialCommand
  // -------------------------------------------------------------------------

  test('`initialCommand` - baseCommand/baseArgs/workerEnv 기본 전달 + --format json 강제', () => {
    const result = opencodeDriver.initialCommand({
      prompt: 'hello',
      baseCommand: 'opencode',
      baseArgs: ['run', '--format', 'json', '--prompt', 'hello'],
      workerEnv: { OPENCODE_TOKEN: 'tok' },
    });
    expect(result.program).toBe('opencode');
    // --format json stripped and re-appended → idempotent, still present once at end
    expect(result.args.filter((a) => a === '--format').length).toBe(1);
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
    expect(result.args).toContain('run');
    expect(result.args).toContain('--prompt');
    expect(result.args).toContain('hello');
    expect(result.env).toMatchObject({ OPENCODE_TOKEN: 'tok' });
  });

  test('`initialCommand` - --format 없는 baseArgs에 --format json 추가', () => {
    const result = opencodeDriver.initialCommand({
      prompt: 'hello',
      baseCommand: 'opencode',
      baseArgs: ['exec'],
      workerEnv: {},
    });
    expect(result.args).toContain('--format');
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
  });

  test('`initialCommand` - baseArgs에 --format text가 있으면 --format json으로 교체', () => {
    const result = opencodeDriver.initialCommand({
      prompt: 'hello',
      baseCommand: 'opencode',
      baseArgs: ['exec', '--format', 'text'],
      workerEnv: {},
    });
    expect(result.args.filter((a) => a === '--format').length).toBe(1);
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
    expect(result.args).not.toContain('text');
  });

  test('`initialCommand` - baseArgs에 --format json이 이미 있으면 중복 없이 1개만 유지 (멱등)', () => {
    const result = opencodeDriver.initialCommand({
      prompt: 'hello',
      baseCommand: 'opencode',
      baseArgs: ['exec', '--format', 'json'],
      workerEnv: {},
    });
    expect(result.args.filter((a) => a === '--format').length).toBe(1);
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
  });

  test('`initialCommand` - 다른 인자 보존 + --format json 추가', () => {
    const result = opencodeDriver.initialCommand({
      prompt: 'hello',
      baseCommand: 'opencode',
      baseArgs: ['exec', '--model', 'opus-4'],
      workerEnv: { OPENCODE_TOKEN: 'tok' },
    });
    expect(result.program).toBe('opencode');
    expect(result.args).toContain('exec');
    expect(result.args).toContain('--model');
    expect(result.args).toContain('opus-4');
    expect(result.args).toContain('--format');
    const fmtIdx = result.args.indexOf('--format');
    expect(result.args[fmtIdx + 1]).toBe('json');
    expect(result.env).toMatchObject({ OPENCODE_TOKEN: 'tok' });
  });
});

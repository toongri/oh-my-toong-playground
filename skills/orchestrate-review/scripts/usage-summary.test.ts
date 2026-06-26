#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { summarizeUsage } from './usage-summary.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'usage-summary-test-'));
}

function makeFixture(
  tmpDir: string,
  members: Array<{ name: string; status: Record<string, unknown> }>,
): void {
  const membersDir = path.join(tmpDir, 'members');
  for (const m of members) {
    fs.mkdirSync(path.join(membersDir, m.name), { recursive: true });
    fs.writeFileSync(
      path.join(membersDir, m.name, 'status.json'),
      JSON.stringify(m.status),
    );
  }
}

// ---------------------------------------------------------------------------
// F3-unit: summarizeUsage
// ---------------------------------------------------------------------------

describe('`summarizeUsage` (F3-unit)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('알려진 픽스처로 두 멤버의 `usage`를 합산한다', () => {
    makeFixture(tmpDir, [
      { name: 'alice', status: { member: 'alice', state: 'done', usage: { input_tokens: 100, output_tokens: 50 } } },
      { name: 'bob',   status: { member: 'bob',   state: 'done', usage: { input_tokens: 200, output_tokens: 80 } } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(2);
    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.output_tokens).toBe(130);
  });

  test('`usage` 필드가 없는 멤버는 0으로 기여하며 예외를 던지지 않는다', () => {
    makeFixture(tmpDir, [
      { name: 'charlie', status: { member: 'charlie', state: 'error' } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(1);
    expect(result.usage).toEqual({});
  });

  test('`null` `usage`는 0으로 기여하며 예외를 던지지 않는다', () => {
    makeFixture(tmpDir, [
      { name: 'dana', status: { member: 'dana', state: 'error', usage: null } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(1);
    expect(result.usage).toEqual({});
  });

  test('`members` 디렉터리가 없어도 예외를 던지지 않고 빈 집계를 반환한다', () => {
    // tmpDir exists but members/ subdir does not
    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });

  test('`members` 디렉터리가 비어 있으면 빈 집계를 반환한다', () => {
    fs.mkdirSync(path.join(tmpDir, 'members'));

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });

  test('`usage`가 있는 멤버와 없는 멤버가 섞여 있을 때 숫자 필드만 합산한다', () => {
    makeFixture(tmpDir, [
      { name: 'alice', status: { member: 'alice', state: 'done', usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 } } },
      { name: 'bob',   status: { member: 'bob',   state: 'done', usage: { input_tokens: 200 } } },
      { name: 'charlie', status: { member: 'charlie', state: 'done' } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(3);
    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.output_tokens).toBe(50);
    expect(result.usage.cached_input_tokens).toBe(20);
  });

  test('`status.json`이 없는 멤버 디렉터리는 조용히 건너뛰고 `memberCount`를 증가시키지 않는다', () => {
    const membersDir = path.join(tmpDir, 'members');
    fs.mkdirSync(path.join(membersDir, 'ghost'), { recursive: true });
    // no status.json written

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });
});

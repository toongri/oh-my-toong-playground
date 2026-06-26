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

describe('summarizeUsage (F3-unit)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sums usage across two members with known fixture', () => {
    makeFixture(tmpDir, [
      { name: 'alice', status: { member: 'alice', state: 'done', usage: { input_tokens: 100, output_tokens: 50 } } },
      { name: 'bob',   status: { member: 'bob',   state: 'done', usage: { input_tokens: 200, output_tokens: 80 } } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(2);
    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.output_tokens).toBe(130);
  });

  test('member missing usage field contributes 0 (no throw)', () => {
    makeFixture(tmpDir, [
      { name: 'charlie', status: { member: 'charlie', state: 'error' } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(1);
    expect(result.usage).toEqual({});
  });

  test('null usage contributes 0 (no throw)', () => {
    makeFixture(tmpDir, [
      { name: 'dana', status: { member: 'dana', state: 'error', usage: null } },
    ]);

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(1);
    expect(result.usage).toEqual({});
  });

  test('missing members dir does not throw, returns zero aggregate', () => {
    // tmpDir exists but members/ subdir does not
    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });

  test('empty members dir produces zero aggregate', () => {
    fs.mkdirSync(path.join(tmpDir, 'members'));

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });

  test('mixed members — some with usage, some without — sums only present numeric fields', () => {
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

  test('member dir lacking status.json is skipped silently, does not increment memberCount', () => {
    const membersDir = path.join(tmpDir, 'members');
    fs.mkdirSync(path.join(membersDir, 'ghost'), { recursive: true });
    // no status.json written

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });
});

#!/usr/bin/env bun
/**
 * F3-flow: proves the usage-summary harvest must precede clean, and clean must precede return.
 *
 * Three tests together establish the ordering constraint:
 *   1. summarizeUsage on a fixture job dir returns a known non-zero aggregate (harvest works).
 *   2. summarizeUsage on the SAME fixture after members/ is deleted returns 0
 *      (harvest is impossible post-clean — proves the window closes).
 *   3. SKILL.md conductor execution steps mention "Find Token Usage" (the label appended
 *      to the returned text) BEFORE the `clean` teardown reference — enforcing the prose
 *      correctly sequences harvest → clean → return (final response).
 *
 * Tests 1 & 2 are green from the start (summarizeUsage already implemented in T3).
 * Test 3 is the RED gate: it fails until SKILL.md wires usage-summary before clean before return.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { summarizeUsage } from './usage-summary.ts';

const SKILL_MD_PATH = path.resolve(path.dirname(import.meta.path), '../SKILL.md');

// Known fixture token totals (alice + bob)
const FIXTURE_INPUT_TOKENS = 300; // 100 + 200
const FIXTURE_OUTPUT_TOKENS = 130; // 50 + 80
const FIXTURE_CACHED_TOKENS = 20; // alice only

function makeJobFixture(dir: string): void {
  const membersDir = path.join(dir, 'members');
  const members = [
    {
      name: 'alice',
      usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 },
    },
    {
      name: 'bob',
      usage: { input_tokens: 200, output_tokens: 80 },
    },
  ];
  for (const m of members) {
    fs.mkdirSync(path.join(membersDir, m.name), { recursive: true });
    fs.writeFileSync(
      path.join(membersDir, m.name, 'status.json'),
      JSON.stringify({ member: m.name, state: 'done', usage: m.usage }),
    );
  }
}

describe('F3-flow: usage-summary 하베스트는 clean보다 먼저 실행돼야 한다', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-flow-test-'));
    makeJobFixture(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('`summarizeUsage`는 members/ 삭제 전에 알려진 비-0 합산값을 반환한다', () => {
    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(2);
    expect(result.usage.input_tokens).toBe(FIXTURE_INPUT_TOKENS);
    expect(result.usage.output_tokens).toBe(FIXTURE_OUTPUT_TOKENS);
    expect(result.usage.cached_input_tokens).toBe(FIXTURE_CACHED_TOKENS);
  });

  test('`summarizeUsage`는 members/ 삭제 후 빈 합산값을 반환한다 (clean 시뮬레이션)', () => {
    // Mirror generic-job.ts:867 — rmSync on the members subdir simulates what clean does
    // to the data summarizeUsage reads. The job dir shell survives; only member data is gone.
    fs.rmSync(path.join(tmpDir, 'members'), { recursive: true, force: true });

    const result = summarizeUsage(tmpDir);

    expect(result.memberCount).toBe(0);
    expect(result.usage).toEqual({});
  });

  test('SKILL.md 지휘자 단계에서 "Find Token Usage"는 `clean` 앞에, `clean`은 최종 return 앞에 위치한다', () => {
    const skill = fs.readFileSync(SKILL_MD_PATH, 'utf8');

    // "Find Token Usage" is the labelled block the conductor appends to returned text.
    // It must appear inside the CRITICAL: Execution Constraint section, before the clean step.
    const execConstraintStart = skill.indexOf('## CRITICAL: Execution Constraint');
    expect(execConstraintStart).toBeGreaterThan(-1);

    // Search only within the execution-constraint block (up to the next ## heading)
    const nextHeadingPos = skill.indexOf('\n## ', execConstraintStart + 1);
    const execSection = nextHeadingPos > -1
      ? skill.slice(execConstraintStart, nextHeadingPos)
      : skill.slice(execConstraintStart);

    const findTokenUsagePos = execSection.indexOf('Find Token Usage');
    expect(findTokenUsagePos).toBeGreaterThan(-1);

    // clean must appear in this section, AFTER the Find Token Usage step
    const cleanAfterPos = execSection.indexOf('`clean`', findTokenUsagePos);
    expect(cleanAfterPos).toBeGreaterThan(-1);
    expect(findTokenUsagePos).toBeLessThan(cleanAfterPos);

    // The final "Return" step must appear AFTER the clean step — teardown before return
    const returnAfterCleanPos = execSection.indexOf('Return', cleanAfterPos);
    expect(returnAfterCleanPos).toBeGreaterThan(-1);
    expect(cleanAfterPos).toBeLessThan(returnAfterCleanPos);
  });
});

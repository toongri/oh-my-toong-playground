#!/usr/bin/env bun

import { describe, test, expect } from 'bun:test';
import path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.join(import.meta.dirname, 'job.ts');

describe('resume-member subcommand', () => {
  test('resume-member without jobDir exits with error containing missing jobDir', () => {
    let exitCode = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member'], { stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status;
      output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }
    expect(exitCode).not.toBe(0);
    expect(output).toContain('missing jobDir');
  });

  test('resume-member with 2 of 3 args exits with error containing missing prompt', () => {
    let exitCode = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member', '/tmp/x', 'mymember'], { stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status;
      output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }
    expect(exitCode).not.toBe(0);
    expect(output).toContain('missing prompt');
  });

  test('resume-member with 1 of 3 args exits with error containing missing member name', () => {
    let exitCode = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member', '/tmp/x'], { stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status;
      output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }
    expect(exitCode).not.toBe(0);
    expect(output).toContain('missing member name');
  });

  test('resume-member에서 --json 등 flag-like 토큰을 prompt로 전달하면 missing prompt로 거부되지 않는다', () => {
    // 회귀 테스트: parseArgs가 --json을 소비하여 prompt가 빈 문자열이 되는 버그 방지.
    // process.argv.slice(5)로 raw argv에서 prompt를 캡처하므로 --json이 그대로 전달된다.
    let exitCode = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'resume-member', '/tmp/no-such-dir', 'mymember', '--json'], { stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status;
      output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }
    // Should fail (nonexistent jobDir -> no resumable session), but NOT with "missing prompt"
    expect(exitCode).not.toBe(0);
    expect(output).not.toContain('missing prompt');
  });
});

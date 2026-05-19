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
});

#!/usr/bin/env bun

import { describe, test, expect } from 'bun:test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';

const SCRIPT = path.join(import.meta.dirname, 'job.ts');

describe('start subcommand — empty members', () => {
  test('start with config that filters to zero members exits non-zero and writes no job.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-review-test-'));
    const configPath = path.join(tmpDir, 'review.config.yaml');
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    // Config with no valid members (missing `command` field → all filtered out)
    fs.writeFileSync(configPath, [
      'review:',
      '  members:',
      '    - name: gemini',
      '  settings:',
      '    timeout: 10',
    ].join('\n'), 'utf8');

    let exitCode = 0;
    let output = '';
    try {
      execFileSync(
        process.execPath,
        [SCRIPT, 'start', '--config', configPath, '--jobs-dir', jobsDir, 'test prompt'],
        { stdio: 'pipe' },
      );
    } catch (e: any) {
      exitCode = e.status;
      output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }

    expect(exitCode).not.toBe(0);
    expect(output).toContain('to dispatch');

    const jobEntries = fs.readdirSync(jobsDir).filter((e) => e.startsWith('slides-review-'));
    const hasJobJson = jobEntries.some((entry) =>
      fs.existsSync(path.join(jobsDir, entry, 'job.json')),
    );
    expect(hasJobJson).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

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

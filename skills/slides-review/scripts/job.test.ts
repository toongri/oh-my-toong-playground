#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
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

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slides-review-job-test-'));
}

function writeConfig(configPath: string) {
  fs.writeFileSync(configPath, [
    'review:',
    '  members:',
    '    - name: tester',
    '      command: echo done',
    '  settings:',
    '    timeout: 10',
  ].join('\n'), 'utf8');
}

describe('slides-review job lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('start creates jobDir and job.json with env field on each member', () => {
    const configPath = path.join(tmpDir, 'review.config.yaml');
    writeConfig(configPath);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'slides review test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());

    expect(typeof output.jobDir).toBe('string');
    expect(path.basename(output.jobDir).startsWith('slides-review-')).toBe(true);
    expect(fs.existsSync(output.jobDir)).toBe(true);

    const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, 'job.json'), 'utf8'));
    expect(Array.isArray(jobJson.members)).toBe(true);
    expect(jobJson.members[0].name).toBe('tester');
    // env field must be present on each member (defaults to empty object)
    expect(jobJson.members[0].env).toEqual({});

    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });
});

describe('config fallback-settings merge', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('partial config with members-only (no settings) uses default timeout 120', () => {
    const configPath = path.join(tmpDir, 'review.config.yaml');
    // Only members, no settings key at all
    fs.writeFileSync(configPath, [
      'review:',
      '  members:',
      '    - name: tester',
      '      command: echo done',
    ].join('\n'), 'utf8');

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'regression test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, 'job.json'), 'utf8'));

    // Default timeout must be preserved even when settings is omitted from config
    expect(jobJson.settings.timeoutSec).toBe(120);

    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });

  test('partial config with members and settings.timeout overrides default', () => {
    const configPath = path.join(tmpDir, 'review.config.yaml');
    fs.writeFileSync(configPath, [
      'review:',
      '  members:',
      '    - name: tester',
      '      command: echo done',
      '  settings:',
      '    timeout: 60',
    ].join('\n'), 'utf8');

    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'override test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, 'job.json'), 'utf8'));

    expect(jobJson.settings.timeoutSec).toBe(60);

    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });

  test('no config file at all uses default timeout 120', () => {
    const configPath = path.join(tmpDir, 'nonexistent.config.yaml');
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'no config test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());
    const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, 'job.json'), 'utf8'));

    expect(jobJson.settings.timeoutSec).toBe(120);

    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
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

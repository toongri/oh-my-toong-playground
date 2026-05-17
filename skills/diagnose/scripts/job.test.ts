#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const SCRIPT = path.join(import.meta.dirname, 'job.ts');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diagnose-job-test-'));
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

describe('diagnose job lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('start creates jobDir and job.json with expected fields', () => {
    const configPath = path.join(tmpDir, 'diagnose.config.yaml');
    writeConfig(configPath);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'diagnose test prompt',
    ], { stdio: 'pipe' });

    const output = JSON.parse(result.toString());

    // jobDir exists and starts with expected prefix
    expect(typeof output.jobDir).toBe('string');
    expect(path.basename(output.jobDir).startsWith('diagnose-')).toBe(true);
    expect(fs.existsSync(output.jobDir)).toBe(true);

    // job.json exists with correct fields
    const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, 'job.json'), 'utf8'));
    expect(typeof jobJson.id).toBe('string');
    expect(jobJson.id.startsWith('diagnose-')).toBe(true);
    expect(Array.isArray(jobJson.members)).toBe(true);
    expect(jobJson.members[0].name).toBe('tester');

    // prompt.txt written
    const prompt = fs.readFileSync(path.join(output.jobDir, 'prompt.txt'), 'utf8');
    expect(prompt).toBe('diagnose test prompt');

    // reviewers directory created
    expect(fs.existsSync(path.join(output.jobDir, 'reviewers'))).toBe(true);

    // cleanup
    try { execFileSync(process.execPath, [SCRIPT, 'stop', output.jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', output.jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });

  test('clean removes jobDir', () => {
    const configPath = path.join(tmpDir, 'diagnose.config.yaml');
    writeConfig(configPath);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const startResult = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'clean lifecycle test',
    ], { stdio: 'pipe' });

    const { jobDir } = JSON.parse(startResult.toString());
    expect(fs.existsSync(jobDir)).toBe(true);

    // stop workers first, then clean
    try { execFileSync(process.execPath, [SCRIPT, 'stop', jobDir], { stdio: 'pipe' }); } catch {}
    execFileSync(process.execPath, [SCRIPT, 'clean', jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' });

    expect(fs.existsSync(jobDir)).toBe(false);
  });

  test('start returns plain jobDir path without --json flag', () => {
    const configPath = path.join(tmpDir, 'diagnose.config.yaml');
    writeConfig(configPath);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const result = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      'plain output test',
    ], { stdio: 'pipe' });

    const jobDir = result.toString().trim();
    expect(path.isAbsolute(jobDir)).toBe(true);
    expect(fs.existsSync(jobDir)).toBe(true);
    expect(path.basename(jobDir).startsWith('diagnose-')).toBe(true);

    try { execFileSync(process.execPath, [SCRIPT, 'stop', jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });

  test('start fails fast when no valid reviewers are configured', () => {
    const configPath = path.join(tmpDir, 'diagnose.config.yaml');
    fs.writeFileSync(configPath, [
      'review:',
      '  members:',
      '    - name: typo-member',
      '      commmand: echo done',
      '  settings:',
      '    timeout: 10',
    ].join('\n'), 'utf8');
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [
        SCRIPT, 'start',
        '--config', configPath,
        '--jobs-dir', jobsDir,
        'guard test prompt',
      ], { stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status;
      stderr = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('no valid reviewers');
  });

  test('status returns JSON with members after start', () => {
    const configPath = path.join(tmpDir, 'diagnose.config.yaml');
    writeConfig(configPath);
    const jobsDir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    const startResult = execFileSync(process.execPath, [
      SCRIPT, 'start',
      '--config', configPath,
      '--jobs-dir', jobsDir,
      '--json',
      'status test',
    ], { stdio: 'pipe' });

    const { jobDir } = JSON.parse(startResult.toString());

    const statusResult = execFileSync(process.execPath, [
      SCRIPT, 'status', jobDir,
    ], { stdio: 'pipe' });

    const status = JSON.parse(statusResult.toString());
    expect(Array.isArray(status.members)).toBe(true);
    expect(typeof status.overallState).toBe('string');
    expect(typeof status.counts).toBe('object');

    try { execFileSync(process.execPath, [SCRIPT, 'stop', jobDir], { stdio: 'pipe' }); } catch {}
    try { execFileSync(process.execPath, [SCRIPT, 'clean', jobDir, '--jobs-dir', jobsDir], { stdio: 'pipe' }); } catch {}
  });
});

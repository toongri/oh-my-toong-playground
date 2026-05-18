#!/usr/bin/env bun

import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('main - logging lifecycle', () => {
  const WORKER_PATH = path.join(import.meta.dirname, 'worker.ts');

  test('creates a log file in logs/ after successful run', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-log-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'members', 'claude');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), 'test prompt', 'utf8');

      const proc = Bun.spawn(
        ['bun', WORKER_PATH, '--job-dir', jobDir, '--member', 'claude', '--command', 'true'],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, OMT_DIR: tmpDir } },
      );
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const logFile = path.join(tmpDir, 'logs', 'spec-review-worker-job.log');
      expect(fs.existsSync(logFile)).toBe(true);
      const content = fs.readFileSync(logFile, 'utf8');
      expect(content.includes('========== START ==========')).toBe(true);
      expect(content.includes('========== END ==========')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('passes --env KEY=VALUE to spawned subprocess environment', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-env-test-'));
    try {
      const jobDir = path.join(tmpDir, 'job');
      const memberDir = path.join(jobDir, 'members', 'claude');
      const outFile = path.join(tmpDir, 'env-output.txt');
      fs.mkdirSync(memberDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'prompt.txt'), '', 'utf8');

      const command = `sh -c 'echo $MY_ENV_VAR > ${outFile}'`;

      const proc = Bun.spawn(
        [
          'bun', WORKER_PATH,
          '--job-dir', jobDir,
          '--member', 'claude',
          '--command', command,
          '--env', 'MY_ENV_VAR=env-test-value',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      await proc.exited;

      const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      expect(output.trim()).toBe('env-test-value');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

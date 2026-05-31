import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readPrometheusState,
  setPrometheusState,
  clearPrometheusState,
  resolveStatePath,
} from './prometheus-state.ts';

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'prometheus-state-test-'));
  process.env.OMT_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalOmtDir !== undefined) {
    process.env.OMT_DIR = originalOmtDir;
  } else {
    delete process.env.OMT_DIR;
  }
  if (originalSessionId !== undefined) {
    process.env.OMT_SESSION_ID = originalSessionId;
  } else {
    delete process.env.OMT_SESSION_ID;
  }
});

describe('prometheus state', () => {
  test('prometheus roundtrip', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    setPrometheusState('test-session', {
      phase: 'S3',
      plan_path: `${tmpDir}/plans/my-plan.md`,
      resume_summary: 'paused after interview',
    });
    const state = readPrometheusState('test-session');
    expect(state).not.toBeNull();
    expect(state!.active).toBe(true);
    expect(state!.phase).toBe('S3');
    expect(state!.plan_path).toBe(`${tmpDir}/plans/my-plan.md`);
    expect(state!.resume_summary).toBe('paused after interview');
  });

  test('prometheus inactive returns null', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    // absent file
    expect(readPrometheusState('test-session')).toBeNull();

    // file with active:false
    const { writeFileSync } = require('fs');
    const path = resolveStatePath('test-session');
    writeFileSync(path, JSON.stringify({ active: false, phase: 'S1', plan_path: '', resume_summary: '', started_at: '2024-01-01T00:00:00' }), 'utf8');
    expect(readPrometheusState('test-session')).toBeNull();
  });

  test('prometheus clear removes file', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    setPrometheusState('test-session', { phase: 'S1', plan_path: '', resume_summary: '' });
    const path = resolveStatePath('test-session');
    expect(existsSync(path)).toBe(true);
    clearPrometheusState('test-session');
    expect(existsSync(path)).toBe(false);
  });

  test('prometheus state path literal', () => {
    process.env.OMT_SESSION_ID = 'my-session';
    const path = resolveStatePath('my-session');
    expect(path).toBe(`${tmpDir}/prometheus-state-my-session.json`);
  });

  test('prometheus resume_summary control-char normalized', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    const dirty = 'line1\nline2\ttabbed\x01control';
    setPrometheusState('test-session', {
      phase: 'S2',
      plan_path: '',
      resume_summary: dirty,
    });
    const state = readPrometheusState('test-session');
    expect(state).not.toBeNull();
    // No characters in U+0000-U+001F should remain
    const hasBadChars = /[\x00-\x1F]/.test(state!.resume_summary);
    expect(hasBadChars).toBe(false);
  });

  test('prometheus started_at seeded and preserved', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    setPrometheusState('test-session', { phase: 'S1', plan_path: '', resume_summary: '' });
    const first = readPrometheusState('test-session');
    expect(first).not.toBeNull();
    const firstStartedAt = first!.started_at;

    // Second set call
    setPrometheusState('test-session', { phase: 'S2', plan_path: '', resume_summary: '' });
    const second = readPrometheusState('test-session');
    expect(second!.started_at).toBe(firstStartedAt);

    // Format: no milliseconds, matches local ISO-8601 date+time
    expect(firstStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('prometheus session id fallback', () => {
    delete process.env.OMT_SESSION_ID;
    const sessionId = process.env.OMT_SESSION_ID || 'default';
    const path = resolveStatePath(sessionId);
    expect(path).toBe(`${tmpDir}/prometheus-state-default.json`);
  });

  test('prometheus phase-only update preserves prior plan_path and resume_summary', () => {
    process.env.OMT_SESSION_ID = 'test-session';

    // First write: full fields
    setPrometheusState('test-session', {
      phase: 'S2',
      plan_path: `${tmpDir}/plans/my-plan.md`,
      resume_summary: 'paused at interview',
    });
    const first = readPrometheusState('test-session');
    expect(first).not.toBeNull();
    const firstStartedAt = first!.started_at;

    // Second write: phase only, omitting plan_path and resume_summary
    setPrometheusState('test-session', { phase: 'S4' });

    const second = readPrometheusState('test-session');
    expect(second).not.toBeNull();
    expect(second!.phase).toBe('S4');
    expect(second!.plan_path).toBe(`${tmpDir}/plans/my-plan.md`);
    expect(second!.resume_summary).toBe('paused at interview');
    expect(second!.started_at).toBe(firstStartedAt);
  });
});

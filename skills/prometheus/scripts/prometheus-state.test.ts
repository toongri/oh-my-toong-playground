import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
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

/** Seed the state file as the PreToolUse hook would (create-if-absent skeleton). */
function seedFile(sessionId: string): string {
  const path = resolveStatePath(sessionId);
  if (!existsSync(path)) {
    writeFileSync(
      path,
      JSON.stringify({
        active: true,
        phase: 'S0',
        plan_path: '',
        resume_summary: '',
        started_at: new Date().toISOString().slice(0, 19),
        last_touched_at: new Date().toISOString().slice(0, 19),
      }),
      'utf8'
    );
  }
  return path;
}

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
    seedFile('test-session');
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
    const path = resolveStatePath('test-session');
    writeFileSync(path, JSON.stringify({ active: false, phase: 'S1', plan_path: '', resume_summary: '', started_at: '2024-01-01T00:00:00' }), 'utf8');
    expect(readPrometheusState('test-session')).toBeNull();
  });

  test('prometheus clear removes file', () => {
    process.env.OMT_SESSION_ID = 'test-session';
    seedFile('test-session');
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
    seedFile('test-session');
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
    seedFile('test-session');
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
    seedFile('test-session');

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

  // --- (A5) prometheus-state refreshes last_touched_at on every write ---
  test('(A5) prometheus-state refreshes last_touched_at on every write', async () => {
    process.env.OMT_SESSION_ID = 'test-session';
    seedFile('test-session');
    setPrometheusState('test-session', { phase: 'S1', plan_path: '', resume_summary: '' });
    const first = readPrometheusState('test-session');
    expect(first).not.toBeNull();
    const firstLta = first!.last_touched_at;
    expect(firstLta).toBeTruthy();
    // Wait 1 second to ensure timestamp advances
    await new Promise((r) => setTimeout(r, 1100));
    setPrometheusState('test-session', { phase: 'S2', plan_path: '', resume_summary: '' });
    const second = readPrometheusState('test-session');
    expect(second!.last_touched_at).not.toBe(firstLta);
    expect(second!.last_touched_at > firstLta).toBe(true);
    expect(second!.last_touched_at >= second!.started_at).toBe(true);
  });

  // --- (ADR-7-prom) prometheus CLI refuses to create when file absent ---
  test('(ADR-7-prom) setPrometheusState refuses when file absent — exits non-zero', () => {
    process.env.OMT_SESSION_ID = 'absent-session';
    // No file seeded — must throw because process.exit(1) is called
    expect(() => setPrometheusState('absent-session', { phase: 'S1' })).toThrow();
    expect(existsSync(resolveStatePath('absent-session'))).toBe(false);
  });
});

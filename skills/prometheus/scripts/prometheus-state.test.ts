import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
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

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const promScript = join(import.meta.dir, 'prometheus-state.ts');

/** Returns a current-time ISO-8601 string with timezone offset. */
function nowIsoP(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const tzOffset = -d.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzM = pad(Math.abs(tzOffset) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${tzSign}${tzH}:${tzM}`
  );
}

/** Write a live prometheus state with the given sid and plan_path. */
function writeLivePromState(sid: string, planPath: string): void {
  const path = `${tmpDir}/prometheus-state-${sid}.json`;
  const now = nowIsoP();
  writeFileSync(
    path,
    JSON.stringify({
      active: true,
      phase: 'S3',
      plan_path: planPath,
      resume_summary: '',
      started_at: now,
      last_touched_at: now,
    }),
    'utf8'
  );
}

/** Write a pristine prometheus state (S0, plan_path empty). */
function writePristinePromState(sid: string): void {
  const path = `${tmpDir}/prometheus-state-${sid}.json`;
  const now = nowIsoP();
  writeFileSync(
    path,
    JSON.stringify({
      active: true,
      phase: 'S0',
      plan_path: '',
      resume_summary: '',
      started_at: now,
      last_touched_at: now,
    }),
    'utf8'
  );
}

function runPromCli(args: string, env?: Record<string, string>): string {
  return execSync(`bun ${promScript} ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('adoption: list-others + adopt (prometheus CLI)', () => {
  // (F2-prom) list-others surfaces ACTIVE-live candidate, purpose = plan_path or phase
  test('F2-prom: list-others shows A with plan_path as purpose, excludes self B', () => {
    process.env.OMT_SESSION_ID = 'B';
    writeLivePromState('A', `${tmpDir}/plans/myplan.md`);
    writePristinePromState('B');
    const out = runPromCli('list-others', { OMT_SESSION_ID: 'B' });
    expect(out).toContain('A');
    expect(out).toContain('myplan.md');
    // Self B must not appear
    const lines = out.trim().split('\n').filter(Boolean);
    expect(lines.some((l) => l.includes('prometheus-state-B') || l.startsWith('B '))).toBe(false);
  });

  // (F2-prom) purpose shows phase when plan_path is empty
  test('F2-prom: list-others shows phase as purpose when plan_path is empty', () => {
    // writeLivePromState with empty planPath: plan_path='', phase='S3' → purpose is phase
    writeLivePromState('PA', '');
    const out = runPromCli('list-others', { OMT_SESSION_ID: 'PB' });
    expect(out).toContain('PA');
    expect(out).toContain('S3');
  });

  // (label) candidate line has all 4 fields
  test('label: list-others prometheus candidate line has sid + purpose + started_at + idle-seconds', () => {
    writeLivePromState('labelProm', `${tmpDir}/plans/z.md`);
    const out = runPromCli('list-others', { OMT_SESSION_ID: 'xSession' });
    expect(out).toContain('labelProm');
    expect(out).toContain('z.md');
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).toMatch(/\d+s/);
  });

  // (F3-cli) adopt re-keys via prometheus CLI
  test('F3-cli: prometheus adopt --src A moves A into B; A absent, B holds content', () => {
    writeLivePromState('A', `${tmpDir}/plans/myplan.md`);
    writePristinePromState('B');
    runPromCli('adopt --src A', { OMT_SESSION_ID: 'B' });
    expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
    const b = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-B.json`, 'utf8'));
    expect(b.plan_path).toBe(`${tmpDir}/plans/myplan.md`);
    const log = readFileSync(`${tmpDir}/adoption.log`, 'utf8');
    expect(log).toContain('prometheus');
    expect(log).toContain('A -> B');
  });

  // (F6-cli) adopt refused when current B is ACTIVE non-pristine
  test('F6-cli: prometheus adopt refused on ACTIVE non-pristine current B', () => {
    writeLivePromState('A', `${tmpDir}/plans/a.md`);
    writeLivePromState('B', `${tmpDir}/plans/b.md`);  // non-pristine (phase S3)
    const aContent = readFileSync(`${tmpDir}/prometheus-state-A.json`, 'utf8');
    const bContent = readFileSync(`${tmpDir}/prometheus-state-B.json`, 'utf8');
    expect(() => runPromCli('adopt --src A', { OMT_SESSION_ID: 'B' })).toThrow();
    expect(readFileSync(`${tmpDir}/prometheus-state-A.json`, 'utf8')).toBe(aContent);
    expect(readFileSync(`${tmpDir}/prometheus-state-B.json`, 'utf8')).toBe(bContent);
  });

  // (plan-path-warn) adopt with unresolvable plan_path: exit 0 + stderr warning
  test('plan-path-warn: adopt exits 0 and warns on stderr when plan_path does not resolve', () => {
    writeLivePromState('pwSrc', '/nonexistent/plan.md');
    writePristinePromState('pwDst');
    // Capture stdout+stderr merged; should exit 0 (no throw)
    const merged = execSync(
      `bun ${promScript} adopt --src pwSrc 2>&1`,
      {
        encoding: 'utf8',
        env: { ...process.env, OMT_SESSION_ID: 'pwDst', OMT_DIR: tmpDir },
        shell: '/bin/sh',
      }
    );
    // Source must be renamed away
    expect(existsSync(`${tmpDir}/prometheus-state-pwSrc.json`)).toBe(false);
    // Warning must be present in output
    expect(merged).toMatch(/warn|warning|plan_path|not found|does not exist/i);
  });

  // (dormancy-prom) adopted-away source cannot write via set
  test('dormancy-prom: after adoption, session A write is refused (no-create)', () => {
    writeLivePromState('A', `${tmpDir}/plans/plan.md`);
    writePristinePromState('B');
    runPromCli('adopt --src A', { OMT_SESSION_ID: 'B' });
    expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
    // Session A tries to write — must fail
    expect(() =>
      runPromCli('set --phase S2', { OMT_SESSION_ID: 'A' })
    ).toThrow();
    expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
  });
});

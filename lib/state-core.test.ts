/**
 * Tests for lib/state-core.ts
 *
 * Covers all 20 ACs from the state-lifecycle-and-ralph-retirement.md TODO 1.
 * Tests are hermetic: OMT_DIR is pointed at a mktemp fixture; real ~/.omt is never touched.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// -- module under test (imported after each describe sets up env) --
import {
  nowStamp,
  isSafeSessionId,
  resolveSessionIdOrThrow,
  mergeWithHeartbeat,
  ACTIVE_IDLE_TTL_SECONDS,
  TERMINAL_TTL_SECONDS,
  isStateLive,
  STATE_PREFIX,
  listOthers,
  adopt,
} from './state-core.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOmtDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'state-core-test-'));
  return dir;
}

function writeState(dir: string, filename: string, state: object): void {
  writeFileSync(join(dir, filename), JSON.stringify(state, null, 2));
}

function readState(dir: string, filename: string): object {
  return JSON.parse(readFileSync(join(dir, filename), 'utf8'));
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function isoSecondsAgo(seconds: number): string {
  const d = new Date(Date.now() - seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tzOffset = -d.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzM = pad(Math.abs(tzOffset) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tzSign}${tzH}:${tzM}`;
}

// ---------------------------------------------------------------------------
// (B4) isSafeSessionId
// ---------------------------------------------------------------------------

describe('isSafeSessionId (B4)', () => {
  test('accepts a UUID-style id', () => {
    expect(isSafeSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('accepts a ses_... style id', () => {
    expect(isSafeSessionId('ses_abc123XYZ')).toBe(true);
  });

  test('accepts alphanumeric with hyphens and underscores', () => {
    expect(isSafeSessionId('AbcDef_123-xyz')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(isSafeSessionId('')).toBe(false);
  });

  test('rejects string with only a space', () => {
    expect(isSafeSessionId(' ')).toBe(false);
  });

  test('rejects path traversal attempt ../escape', () => {
    expect(isSafeSessionId('../escape')).toBe(false);
  });

  test('rejects slash in id a/b', () => {
    expect(isSafeSessionId('a/b')).toBe(false);
  });

  test('rejects dot in id a.b', () => {
    expect(isSafeSessionId('a.b')).toBe(false);
  });

  test('rejects a 500-char string', () => {
    expect(isSafeSessionId('a'.repeat(500))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (B2) resolveSessionIdOrThrow
// ---------------------------------------------------------------------------

describe('resolveSessionIdOrThrow (B2)', () => {
  const origEnv = process.env.OMT_SESSION_ID;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.OMT_SESSION_ID;
    } else {
      process.env.OMT_SESSION_ID = origEnv;
    }
  });

  test('throws when OMT_SESSION_ID is unset', () => {
    delete process.env.OMT_SESSION_ID;
    expect(() => resolveSessionIdOrThrow()).toThrow();
  });

  test('throws when OMT_SESSION_ID is unsafe (../escape)', () => {
    process.env.OMT_SESSION_ID = '../escape';
    expect(() => resolveSessionIdOrThrow()).toThrow();
  });

  test('returns the id when OMT_SESSION_ID is valid', () => {
    process.env.OMT_SESSION_ID = 'valid-session-123';
    expect(resolveSessionIdOrThrow()).toBe('valid-session-123');
  });
});

// ---------------------------------------------------------------------------
// (A5) mergeWithHeartbeat
// ---------------------------------------------------------------------------

describe('mergeWithHeartbeat (A5)', () => {
  test('refreshes last_touched_at and preserves prior fields', () => {
    const prior = {
      active: true,
      started_at: '2020-01-01T00:00:00+00:00',
      last_touched_at: '2020-01-01T00:00:00+00:00',
      outcome: 'x',
    };
    const result = mergeWithHeartbeat(prior, {});
    expect(result.outcome).toBe('x');
    expect(result.active).toBe(true);
    // last_touched_at must be strictly after the prior value
    expect(result.last_touched_at > prior.last_touched_at).toBe(true);
    // last_touched_at must be at or after started_at
    expect(result.last_touched_at >= prior.started_at).toBe(true);
  });

  test('partial fields override prior fields', () => {
    const prior = { outcome: 'old', active: true, last_touched_at: '2020-01-01T00:00:00+00:00' };
    const result = mergeWithHeartbeat(prior, { outcome: 'new' });
    expect(result.outcome).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

describe('TTL constants', () => {
  test('ACTIVE_IDLE_TTL_SECONDS is 21600 (6 hours)', () => {
    expect(ACTIVE_IDLE_TTL_SECONDS).toBe(21600);
  });

  test('TERMINAL_TTL_SECONDS is 1800 (30 minutes)', () => {
    expect(TERMINAL_TTL_SECONDS).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// isStateLive
// ---------------------------------------------------------------------------

describe('isStateLive', () => {
  test('active state with fresh heartbeat is live', () => {
    const now = nowEpoch();
    const parsed = { active: true, last_touched_at: isoSecondsAgo(60) };
    expect(isStateLive(parsed, now)).toBe(true);
  });

  test('active state with 7h idle is NOT live', () => {
    const now = nowEpoch();
    const parsed = { active: true, last_touched_at: isoSecondsAgo(7 * 3600) };
    expect(isStateLive(parsed, now)).toBe(false);
  });

  test('terminal (active:false) state with 10min idle is live', () => {
    const now = nowEpoch();
    const parsed = { active: false, last_touched_at: isoSecondsAgo(600) };
    expect(isStateLive(parsed, now)).toBe(true);
  });

  test('terminal state with 35min idle is NOT live', () => {
    const now = nowEpoch();
    const parsed = { active: false, last_touched_at: isoSecondsAgo(35 * 60) };
    expect(isStateLive(parsed, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STATE_PREFIX
// ---------------------------------------------------------------------------

describe('STATE_PREFIX', () => {
  test('goal prefix is goal-state-', () => {
    expect(STATE_PREFIX['goal']).toBe('goal-state-');
  });

  test('prometheus prefix is prometheus-state-', () => {
    expect(STATE_PREFIX['prometheus']).toBe('prometheus-state-');
  });

  test('deep-interview prefix is deep-interview-active-state-', () => {
    expect(STATE_PREFIX['deep-interview']).toBe('deep-interview-active-state-');
  });
});

// ---------------------------------------------------------------------------
// (AD-list-1..6) listOthers
// ---------------------------------------------------------------------------

describe('listOthers (AD-list-1..6)', () => {
  let omtDir: string;
  const origOmtDir = process.env.OMT_DIR;
  const origSid = process.env.OMT_SESSION_ID;

  beforeEach(() => {
    omtDir = makeOmtDir();
    process.env.OMT_DIR = omtDir;
    process.env.OMT_SESSION_ID = 'B';
  });

  afterEach(() => {
    if (origOmtDir === undefined) delete process.env.OMT_DIR;
    else process.env.OMT_DIR = origOmtDir;
    if (origSid === undefined) delete process.env.OMT_SESSION_ID;
    else process.env.OMT_SESSION_ID = origSid;
    rmSync(omtDir, { recursive: true, force: true });
  });

  // AD-list-1
  test('lists an ACTIVE-live other-session candidate with purpose + integer idle age', () => {
    writeState(omtDir, 'goal-state-A.json', {
      active: true,
      outcome: 'ship X',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'pursuing',
      iteration: 1,
    });
    const results = listOthers('goal');
    const candidate = results.find((r) => r.sid === 'A');
    expect(candidate).toBeDefined();
    expect(candidate!.purpose).toBe('ship X');
    expect(typeof candidate!.idleSeconds).toBe('number');
    expect(candidate!.idleSeconds).toBeGreaterThanOrEqual(0);
    expect(candidate!.startedAt).toBeTruthy();
  });

  // AD-list-2
  test('excludes the current session own file', () => {
    writeState(omtDir, 'goal-state-A.json', {
      active: true,
      outcome: 'ship X',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'pursuing',
      iteration: 1,
    });
    writeState(omtDir, 'goal-state-B.json', {
      active: true,
      outcome: 'my goal',
      started_at: isoSecondsAgo(100),
      last_touched_at: isoSecondsAgo(30),
      phase: 'planning',
      iteration: 0,
    });
    const results = listOthers('goal');
    expect(results.find((r) => r.sid === 'B')).toBeUndefined();
  });

  // AD-list-3
  test('excludes a stale candidate (active, 7h idle)', () => {
    writeState(omtDir, 'goal-state-C.json', {
      active: true,
      outcome: 'stale goal',
      started_at: isoSecondsAgo(8 * 3600),
      last_touched_at: isoSecondsAgo(7 * 3600 + 1),
      phase: 'pursuing',
      iteration: 1,
    });
    const results = listOthers('goal');
    expect(results.find((r) => r.sid === 'C')).toBeUndefined();
  });

  // AD-list-4
  test('excludes a TERMINAL candidate (active:false)', () => {
    writeState(omtDir, 'goal-state-D.json', {
      active: false,
      outcome: 'done goal',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'complete',
      iteration: 1,
    });
    const results = listOthers('goal');
    expect(results.find((r) => r.sid === 'D')).toBeUndefined();
  });

  // AD-list-5
  test('skips a malformed candidate without throwing', () => {
    writeFileSync(join(omtDir, 'goal-state-E.json'), '{not json');
    writeState(omtDir, 'goal-state-A.json', {
      active: true,
      outcome: 'ship X',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'pursuing',
      iteration: 1,
    });
    let results: Array<{ sid: string }> = [];
    expect(() => {
      results = listOthers('goal');
    }).not.toThrow();
    expect(results.find((r) => r.sid === 'E')).toBeUndefined();
    expect(results.find((r) => r.sid === 'A')).toBeDefined();
  });

  // AD-list-6
  test('prometheus purpose falls back to phase when plan_path is empty', () => {
    writeState(omtDir, 'prometheus-state-A.json', {
      active: true,
      plan_path: '',
      phase: 'S2',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
    });
    const results = listOthers('prometheus');
    const candidate = results.find((r) => r.sid === 'A');
    expect(candidate).toBeDefined();
    expect(candidate!.purpose).toBe('S2');
  });
});

// ---------------------------------------------------------------------------
// adopt (F3, F3b, F6, r3-terminal, r3-malformed, r1, r7, r4, r5, AD-log, DI-prefix)
// ---------------------------------------------------------------------------

describe('adopt', () => {
  let omtDir: string;
  const origOmtDir = process.env.OMT_DIR;
  const origSid = process.env.OMT_SESSION_ID;

  beforeEach(() => {
    omtDir = makeOmtDir();
    process.env.OMT_DIR = omtDir;
    process.env.OMT_SESSION_ID = 'B';
  });

  afterEach(() => {
    if (origOmtDir === undefined) delete process.env.OMT_DIR;
    else process.env.OMT_DIR = origOmtDir;
    if (origSid === undefined) delete process.env.OMT_SESSION_ID;
    else process.env.OMT_SESSION_ID = origSid;
    rmSync(omtDir, { recursive: true, force: true });
  });

  function liveSourceState(overrides: object = {}): object {
    return {
      active: true,
      outcome: 'src goal',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'pursuing',
      iteration: 2,
      ...overrides,
    };
  }

  function pristineGoalState(): object {
    return {
      active: true,
      outcome: '',
      started_at: isoSecondsAgo(10),
      last_touched_at: isoSecondsAgo(5),
      phase: 'planning',
      iteration: 0,
    };
  }

  // F3 — adopt over a pristine current re-keys content (source gone)
  test('(F3) adopt over a pristine current: source file is gone after adopt', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    adopt('goal', 'A');
    expect(existsSync(join(omtDir, 'goal-state-A.json'))).toBe(false);
  });

  // F3b — target holds the source content (except last_touched_at)
  test('(F3b) adopt target holds source content (except last_touched_at)', () => {
    const srcState = liveSourceState();
    writeState(omtDir, 'goal-state-A.json', srcState);
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    const srcLastTouched = (srcState as { last_touched_at: string }).last_touched_at;
    adopt('goal', 'A');
    const target = readState(omtDir, 'goal-state-B.json') as Record<string, unknown>;
    // Content fields match source
    expect(target['outcome']).toBe('src goal');
    expect(target['iteration']).toBe(2);
    // last_touched_at is re-stamped (different from source pre-adopt value)
    expect(target['last_touched_at']).not.toBe(srcLastTouched);
  });

  // F6 — adopt refused when current is ACTIVE non-pristine
  test('(F6) adopt refused when current is ACTIVE non-pristine; both files unmutated', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    const currentState = {
      active: true,
      outcome: 'current work',
      started_at: isoSecondsAgo(100),
      last_touched_at: isoSecondsAgo(10),
      phase: 'pursuing',
      iteration: 3,
    };
    writeState(omtDir, 'goal-state-B.json', currentState);
    const srcBefore = readFileSync(join(omtDir, 'goal-state-A.json'), 'utf8');
    const curBefore = readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8');
    expect(() => adopt('goal', 'A')).toThrow();
    expect(readFileSync(join(omtDir, 'goal-state-A.json'), 'utf8')).toBe(srcBefore);
    expect(readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8')).toBe(curBefore);
  });

  // r3-terminal — adopt over a TERMINAL current succeeds
  test('(r3-terminal) adopt over a TERMINAL current succeeds', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    writeState(omtDir, 'goal-state-B.json', {
      active: false,
      outcome: 'old done',
      started_at: isoSecondsAgo(500),
      last_touched_at: isoSecondsAgo(10),
      phase: 'complete',
      iteration: 1,
    });
    adopt('goal', 'A');
    expect(existsSync(join(omtDir, 'goal-state-A.json'))).toBe(false);
    const target = readState(omtDir, 'goal-state-B.json') as Record<string, unknown>;
    expect(target['outcome']).toBe('src goal');
  });

  // r3-malformed — adopt refused when current is malformed
  test('(r3-malformed) adopt refused when current is malformed, with guidance message', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    writeFileSync(join(omtDir, 'goal-state-B.json'), '{not json');
    let errorMsg = '';
    try {
      adopt('goal', 'A');
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    expect(errorMsg).toMatch(/inspect|remov/i);
    // Source must be unmutated
    expect(existsSync(join(omtDir, 'goal-state-A.json'))).toBe(true);
  });

  // r1 — self-adopt refused
  test('(r1) self-adopt refused', () => {
    writeState(omtDir, 'goal-state-B.json', liveSourceState());
    const before = readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8');
    expect(() => adopt('goal', 'B')).toThrow();
    expect(readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8')).toBe(before);
  });

  // r7 — adopt of a TERMINAL source refused
  test('(r7) adopt of a TERMINAL source refused', () => {
    writeState(omtDir, 'goal-state-A.json', {
      active: false,
      outcome: 'done',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      phase: 'complete',
      iteration: 1,
    });
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    const srcBefore = readFileSync(join(omtDir, 'goal-state-A.json'), 'utf8');
    expect(() => adopt('goal', 'A')).toThrow();
    expect(readFileSync(join(omtDir, 'goal-state-A.json'), 'utf8')).toBe(srcBefore);
  });

  // r4 — lost race: source vanishes between list and adopt
  test('(r4) lost race (source vanishes) → throws, no mutation', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    const curBefore = readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8');
    // Simulate another adopter winning: remove source before our adopt
    rmSync(join(omtDir, 'goal-state-A.json'));
    expect(() => adopt('goal', 'A')).toThrow();
    expect(existsSync(join(omtDir, 'goal-state-A.json'))).toBe(false);
    expect(readFileSync(join(omtDir, 'goal-state-B.json'), 'utf8')).toBe(curBefore);
    // No extra files
    const files = require('fs').readdirSync(omtDir) as string[];
    expect(files.filter((f: string) => f.startsWith('goal-state-')).sort()).toEqual(['goal-state-B.json']);
  });

  // r5 — post-adopt heartbeat advanced on renamed-to file
  test('(r5) post-adopt heartbeat advanced on the renamed-to file', () => {
    const srcState = liveSourceState();
    const srcLastTouched = (srcState as { last_touched_at: string }).last_touched_at;
    writeState(omtDir, 'goal-state-A.json', srcState);
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    adopt('goal', 'A');
    const target = readState(omtDir, 'goal-state-B.json') as Record<string, unknown>;
    expect(target['last_touched_at'] as string > srcLastTouched).toBe(true);
  });

  // AD-log — adoption appends one audit line
  test('(AD-log) adoption appends one audit line to adoption.log', () => {
    writeState(omtDir, 'goal-state-A.json', liveSourceState());
    writeState(omtDir, 'goal-state-B.json', pristineGoalState());
    adopt('goal', 'A');
    const logPath = join(omtDir, 'adoption.log');
    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, 'utf8');
    const lastLine = logContent.trim().split('\n').at(-1) ?? '';
    // Format: <ISO ts> <type> <srcSid> -> <curSid>
    expect(lastLine).toMatch(/^[\dT:+\-Z]+ goal A -> B$/);
  });

  // DI-prefix — deep-interview adoption resolves the deep-interview-active-state- prefix
  test('(DI-prefix) deep-interview adoption resolves the correct prefix', () => {
    writeState(omtDir, 'deep-interview-active-state-A.json', {
      active: true,
      current_phase: 'deep-interview',
      started_at: isoSecondsAgo(300),
      last_touched_at: isoSecondsAgo(60),
      state: {
        initial_idea: 'diving skills',
        interview_id: 'uid-123',
      },
    });
    // Current B: missing rich state object = pristine deep-interview
    writeState(omtDir, 'deep-interview-active-state-B.json', {
      active: true,
      current_phase: 'deep-interview',
      started_at: isoSecondsAgo(10),
      last_touched_at: isoSecondsAgo(5),
    });

    // listOthers includes A
    const candidates = listOthers('deep-interview');
    const candidate = candidates.find((c) => c.sid === 'A');
    expect(candidate).toBeDefined();
    expect(candidate!.purpose).toBe('diving skills');

    // adopt renames to deep-interview-active-state-B.json
    adopt('deep-interview', 'A');
    expect(existsSync(join(omtDir, 'deep-interview-active-state-A.json'))).toBe(false);
    expect(existsSync(join(omtDir, 'deep-interview-active-state-B.json'))).toBe(true);
    const target = readState(omtDir, 'deep-interview-active-state-B.json') as Record<string, unknown>;
    const stateObj = target['state'] as Record<string, unknown> | undefined;
    expect(stateObj?.['initial_idea']).toBe('diving skills');
  });
});

// ---------------------------------------------------------------------------
// nowStamp format
// ---------------------------------------------------------------------------

describe('nowStamp', () => {
  test('emits ISO-seconds string parseable by BSD date -j -f', () => {
    const stamp = nowStamp();
    // Must match YYYY-MM-DDTHH:MM:SS±HH:MM or ...Z
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/);
  });

  test('two successive stamps are non-decreasing', async () => {
    const s1 = nowStamp();
    await new Promise((r) => setTimeout(r, 5));
    const s2 = nowStamp();
    expect(s2 >= s1).toBe(true);
  });
});

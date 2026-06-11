import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readGoalState,
  setGoalState,
  setBudgetLimited,
  setBlocked,
  requestComplete,
  setVerdict,
  deriveStatus,
  resolveStatePath,
  readGoalGet,
  type GoalPhase,
} from './goal-state.ts';

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = 'test-session';

/** Seed the state file as the PreToolUse hook would (create-if-absent skeleton). */
function seedGoalFile(sessionId: string): void {
  const path = resolveStatePath(sessionId);
  if (!existsSync(path)) {
    writeFileSync(
      path,
      JSON.stringify({
        active: true,
        phase: 'planning',
        iteration: 0,
        max_iterations: 10,
        started_at: new Date().toISOString().slice(0, 19),
        last_touched_at: new Date().toISOString().slice(0, 19),
        outcome: '',
        verification_surface: '',
        constraints: '',
        boundaries: '',
        blocked_stop: '',
        plan_path: '',
        resume_summary: '',
        budget_limit_notified: false,
        blocked_reason: '',
        completion_evidence_paths: [],
        objective_verdict: 'absent',
        schema_version: 1,
      }),
      'utf8'
    );
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'goal-state-test-'));
  process.env.OMT_DIR = tmpDir;
  process.env.OMT_SESSION_ID = S;
  seedGoalFile(S);
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

function rawState(): any {
  return rawStateOf(S);
}

describe('goal state', () => {
  // AC #1
  test('merge-write preserves prior fields and never re-seeds started_at', () => {
    // First write: a full set of content/loop-control slots
    setGoalState(S, {
      phase: 'planning',
      outcome: 'ship feature X',
      verification_surface: 'all tests green',
      constraints: 'no new deps',
      boundaries: 'do not touch billing',
      max_iterations: 7,
      blocked_stop: 'when API key revoked',
      plan_path: `${tmpDir}/plans/goal-x.md`,
      resume_summary: 'kicked off',
    });
    const first = readGoalState(S)!;
    const firstStartedAt = first.started_at;
    expect(firstStartedAt).toBeTruthy();

    // Second write: phase only, omitting every slot — prior fields must survive
    setGoalState(S, { phase: 'pursuing' });
    const second = readGoalState(S)!;

    expect(second.phase).toBe('pursuing');
    expect(second.outcome).toBe('ship feature X');
    expect(second.verification_surface).toBe('all tests green');
    expect(second.constraints).toBe('no new deps');
    expect(second.boundaries).toBe('do not touch billing');
    expect(second.max_iterations).toBe(7);
    expect(second.blocked_stop).toBe('when API key revoked');
    expect(second.plan_path).toBe(`${tmpDir}/plans/goal-x.md`);
    expect(second.resume_summary).toBe('kicked off');
    // started_at seeded once, never re-seeded
    expect(second.started_at).toBe(firstStartedAt);
  });

  // AC #2 — each field on its OWN assertion so a missing field self-names
  test('schema enumerates all required fields', () => {
    setGoalState(S, { phase: 'planning' });
    const s = rawState();
    // content slots
    expect(s).toHaveProperty('outcome');
    expect(s).toHaveProperty('verification_surface');
    expect(s).toHaveProperty('constraints');
    expect(s).toHaveProperty('boundaries');
    // loop-control slots
    expect(s).toHaveProperty('max_iterations');
    expect(s).toHaveProperty('blocked_stop');
    // FSM / control
    expect(s).toHaveProperty('phase');
    expect(s).toHaveProperty('iteration');
    expect(s).toHaveProperty('started_at');
    expect(s).toHaveProperty('active');
    expect(s).toHaveProperty('objective_verdict');
    expect(s).toHaveProperty('plan_path');
    expect(s).toHaveProperty('resume_summary');
    expect(s).toHaveProperty('budget_limit_notified');
    expect(s).toHaveProperty('blocked_reason');
    expect(s).toHaveProperty('completion_evidence_paths');
    expect(s).toHaveProperty('schema_version');
    expect(s).toHaveProperty('last_touched_at');
  });

  // AC #3 — name omits literal parens so bun's `-t` regex (the plan's exact
  // verification string `...max_iterations (default 10, override honored)`)
  // matches; bun treats `-t` as a regex, where `(...)` is a group, not literal.
  test('entry seeds phase planning and concrete max_iterations default 10, override honored', () => {
    // Default entry: no max_iterations supplied
    setGoalState(S, { phase: 'planning' });
    const def = readGoalState(S)!;
    expect(def.phase).toBe('planning');
    expect(def.max_iterations).toBe(10);
    expect(Number.isFinite(def.max_iterations)).toBe(true);

    // Override honored on a fresh session
    const S2 = 'override-session';
    seedGoalFile(S2);
    setGoalState(S2, { phase: 'planning', max_iterations: 25 });
    const ovr = readGoalState(S2)!;
    expect(ovr.phase).toBe('planning');
    expect(ovr.max_iterations).toBe(25);
  });

  // AC #4 — structural narrow-gate
  test('complete only via request-complete; set-verdict is the only verdict writer; system-only sets budget_limited/blocked', () => {
    // (a) set() cannot produce phase=complete — it only accepts planning/pursuing
    setGoalState(S, { phase: 'planning' });
    expect(() => setGoalState(S, { phase: 'complete' as any })).toThrow();
    expect(readGoalState(S)!.phase).not.toBe('complete');

    // (b) set() does not write objective_verdict (no verdict param accepted)
    setVerdict(S, 'REQUEST_CHANGES');
    setGoalState(S, { phase: 'pursuing' });
    expect(readGoalState(S)!.objective_verdict).toBe('REQUEST_CHANGES');

    // (c) set-verdict is the verdict writer
    setVerdict(S, 'APPROVE');
    expect(readGoalState(S)!.objective_verdict).toBe('APPROVE');

    // (d) request-complete is the ONLY path to phase=complete; gated on evidence
    const S2 = 'gate-session';
    seedGoalFile(S2);
    setGoalState(S2, { phase: 'pursuing' });
    // no completion evidence yet -> gate refuses, stays non-complete
    expect(requestComplete(S2)).toBe(false);
    expect(readGoalState(S2)!.phase).not.toBe('complete');
    // supply evidence, then request-complete succeeds
    setGoalState(S2, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/proof.txt`] });
    setVerdict(S2, 'APPROVE');
    expect(requestComplete(S2)).toBe(true);
    // complete is terminal (active:false) so readGoalState returns null; assert on raw
    expect(rawStateOf(S2).phase).toBe('complete');
    expect(rawStateOf(S2).active).toBe(false);

    // (e) system-only setters drive their own terminal phases
    const S3 = 'sys-session';
    seedGoalFile(S3);
    setGoalState(S3, { phase: 'pursuing' });
    setBudgetLimited(S3);
    expect(readGoalState(S3)).toBeNull(); // active:false reads as null
    expect(rawStateOf(S3).phase).toBe('budget_limited');

    const S4 = 'blk-session';
    seedGoalFile(S4);
    setGoalState(S4, { phase: 'pursuing' });
    setBlocked(S4, 'API key revoked');
    expect(rawStateOf(S4).phase).toBe('blocked');
    expect(rawStateOf(S4).blocked_reason).toBe('API key revoked');
  });

  // AC #5 — complete-wins
  test('request-complete wins over prior budget_limited when verdict APPROVE', () => {
    setGoalState(S, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/done.md`] });
    setVerdict(S, 'APPROVE');
    setBudgetLimited(S);
    expect(rawState().phase).toBe('budget_limited');

    // APPROVE-backed request-complete must win over the prior budget_limited
    expect(requestComplete(S)).toBe(true);
    expect(rawState().phase).toBe('complete');
    expect(rawState().active).toBe(false);
  });

  // AC #6 — phase enum exhaustive, status 1:1
  test('phase enum exhaustive and status derives 1:1', () => {
    const phases: GoalPhase[] = ['planning', 'pursuing', 'budget_limited', 'blocked', 'complete'];
    for (const p of phases) {
      expect(deriveStatus({ phase: p })).toBe(p);
    }
    // status is exactly the phase token (1:1), nothing collapses
    const seen = new Set(phases.map((p) => deriveStatus({ phase: p })));
    expect(seen.size).toBe(phases.length);
  });

  // AC #7 — verdict round-trip; unset is absent
  test('objective verdict stored and read back; unset is absent', () => {
    setGoalState(S, { phase: 'planning' });
    // unset reads absent
    expect(readGoalState(S)!.objective_verdict).toBe('absent');

    setVerdict(S, 'COMMENT');
    expect(readGoalState(S)!.objective_verdict).toBe('COMMENT');
    setVerdict(S, 'APPROVE');
    expect(readGoalState(S)!.objective_verdict).toBe('APPROVE');
    setVerdict(S, 'absent');
    expect(readGoalState(S)!.objective_verdict).toBe('absent');
  });

  // AC #8 — planning resets verdict
  test('phase planning resets objective_verdict to absent', () => {
    setGoalState(S, { phase: 'pursuing' });
    setVerdict(S, 'APPROVE');
    expect(readGoalState(S)!.objective_verdict).toBe('APPROVE');

    // Re-plan: a stale APPROVE must not survive
    setGoalState(S, { phase: 'planning' });
    expect(readGoalState(S)!.objective_verdict).toBe('absent');
  });

  // AC #9 — terminal phases set active false
  test('terminal phases set active false', () => {
    // complete
    const Sc = 'c';
    seedGoalFile(Sc);
    setGoalState(Sc, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/p`] });
    setVerdict(Sc, 'APPROVE');
    requestComplete(Sc);
    expect(rawStateOf(Sc).active).toBe(false);

    // budget_limited
    const Sb = 'b';
    seedGoalFile(Sb);
    setGoalState(Sb, { phase: 'pursuing' });
    setBudgetLimited(Sb);
    expect(rawStateOf(Sb).active).toBe(false);

    // blocked
    const Sk = 'k';
    seedGoalFile(Sk);
    setGoalState(Sk, { phase: 'pursuing' });
    setBlocked(Sk, 'no path');
    expect(rawStateOf(Sk).active).toBe(false);

    // non-terminal stays active
    const Sp = 'p';
    seedGoalFile(Sp);
    setGoalState(Sp, { phase: 'pursuing' });
    expect(rawStateOf(Sp).active).toBe(true);
  });

  // AC #10 — blocked never complete
  test('blocked transition never sets complete', () => {
    setGoalState(S, { phase: 'pursuing' });
    setBlocked(S, 'B1: no actionable story');
    expect(rawState().phase).toBe('blocked');
    expect(rawState().phase).not.toBe('complete');
  });

  // A1: request-complete refused when evidence present but verdict is not APPROVE
  test('request-complete refused when evidence present but verdict is not APPROVE', () => {
    setGoalState(S, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/a.md`] });
    // verdict intentionally left as 'absent' (default)
    expect(requestComplete(S)).toBe(false);
    expect(rawState().phase).toBe('pursuing');
    expect(rawState().active).toBe(true);
  });

  // A1: request-complete refused when completion_evidence_paths is not an array
  test('request-complete refused when completion_evidence_paths is not an array', () => {
    // Manually write a state where completion_evidence_paths is a string (corrupted)
    writeFileSync(
      resolveStatePath(S),
      JSON.stringify({
        phase: 'pursuing',
        active: true,
        objective_verdict: 'APPROVE',
        completion_evidence_paths: 'x',
        started_at: '2026-01-01T00:00:00',
        iteration: 0,
        max_iterations: 10,
        schema_version: 1,
        outcome: '',
        verification_surface: '',
        constraints: '',
        boundaries: '',
        blocked_stop: '',
        plan_path: '',
        resume_summary: '',
        budget_limit_notified: false,
        blocked_reason: '',
      }),
      'utf8'
    );
    expect(requestComplete(S)).toBe(false);
    expect(rawState().phase).toBe('pursuing');
    expect(rawState().active).toBe(true);
  });

  // A1: request-complete succeeds with APPROVE and array evidence
  test('request-complete succeeds with APPROVE and array evidence', () => {
    setGoalState(S, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/a.md`] });
    setVerdict(S, 'APPROVE');
    expect(requestComplete(S)).toBe(true);
    expect(rawState().phase).toBe('complete');
    expect(rawState().active).toBe(false);
  });

  // A3: set --max-iterations rejects non-numeric input
  test('set --max-iterations rejects non-numeric input', () => {
    setGoalState(S, { phase: 'pursuing' });
    const prior = rawState().max_iterations;
    const script = join(import.meta.dir, 'goal-state.ts');
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });
    expect(() => run('set --phase pursuing --max-iterations ten')).toThrow();
    // state must be unchanged (prior max_iterations preserved)
    expect(rawState().max_iterations).toBe(prior);
  });

  // A3: set --max-iterations rejects zero / negative
  test('set --max-iterations rejects zero or negative', () => {
    setGoalState(S, { phase: 'pursuing', max_iterations: 5 });
    const script = join(import.meta.dir, 'goal-state.ts');
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });
    expect(() => run('set --phase pursuing --max-iterations 0')).toThrow();
    expect(rawState().max_iterations).toBe(5);
    expect(() => run('set --phase pursuing --max-iterations -3')).toThrow();
    expect(rawState().max_iterations).toBe(5);
  });

  // A4: set-verdict rejects an out-of-enum verdict
  test('set-verdict rejects an out-of-enum verdict', () => {
    setGoalState(S, { phase: 'pursuing' });
    const script = join(import.meta.dir, 'goal-state.ts');
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });
    expect(() => run('set-verdict --verdict APPROVED')).toThrow();
    // objective_verdict must remain 'absent' (not updated to invalid value)
    expect(rawState().objective_verdict).toBe('absent');
  });

  // CLI completion path — exercises the actual script end-to-end, proving the
  // `--completion-evidence` flag is wired so request-complete is reachable.
  test('CLI set --completion-evidence populates evidence so request-complete succeeds', () => {
    const script = join(import.meta.dir, 'goal-state.ts');
    const p1 = `${tmpDir}/a.txt`;
    const p2 = `${tmpDir}/b.txt`;
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });

    run(`set --phase pursuing --completion-evidence ${p1},${p2}`);
    expect(rawState().phase).toBe('pursuing');
    expect(rawState().completion_evidence_paths).toEqual([p1, p2]);

    run('set-verdict --verdict APPROVE');

    // request-complete must exit 0 (no throw) now that evidence is present
    run('request-complete');
    expect(rawState().phase).toBe('complete');
    expect(rawState().active).toBe(false);
    expect(rawState().completion_evidence_paths).toEqual([p1, p2]);
  });

  // C1: a FRESH goal (planning over a terminal/inactive prior) resets the consumed
  // iteration budget — a new objective must never inherit the dead goal's iteration.
  test('C1: fresh goal over a terminal state resets iteration to 0', () => {
    // Seed a terminal (inactive) state with a fully-consumed iteration budget.
    writeFileSync(
      resolveStatePath(S),
      JSON.stringify({
        phase: 'complete',
        active: false,
        objective_verdict: 'APPROVE',
        completion_evidence_paths: [`${tmpDir}/a.md`],
        started_at: '2026-01-01T00:00:00',
        iteration: 10,
        max_iterations: 10,
        schema_version: 1,
        outcome: '',
        verification_surface: '',
        constraints: '',
        boundaries: '',
        blocked_stop: '',
        plan_path: '',
        resume_summary: '',
        budget_limit_notified: false,
        blocked_reason: '',
      }),
      'utf8'
    );
    // No active prior (active:false reads as null) => fresh goal.
    setGoalState(S, { phase: 'planning', max_iterations: 10 });
    expect(rawState().iteration).toBe(0);
  });

  // C1: a FRESH goal must not inherit a prior objective's completion evidence —
  // evidence is only valid from the current pursuit's audit, so planning clears it.
  test('C1: fresh goal over a terminal state with prior evidence resets evidence to []', () => {
    writeFileSync(
      resolveStatePath(S),
      JSON.stringify({
        phase: 'complete',
        active: false,
        objective_verdict: 'APPROVE',
        completion_evidence_paths: [`${tmpDir}/a.md`],
        started_at: '2026-01-01T00:00:00',
        iteration: 3,
        max_iterations: 10,
        schema_version: 1,
        outcome: '',
        verification_surface: '',
        constraints: '',
        boundaries: '',
        blocked_stop: '',
        plan_path: '',
        resume_summary: '',
        budget_limit_notified: false,
        blocked_reason: '',
      }),
      'utf8'
    );
    setGoalState(S, { phase: 'planning' });
    expect(rawState().completion_evidence_paths).toEqual([]);
  });

  // C1: a re-plan loop-back of the SAME active goal preserves the iteration budget —
  // budget accumulates across re-plans (active prior present => re-plan, not fresh).
  test('C1: re-plan over an active pursuing state preserves iteration', () => {
    setGoalState(S, { phase: 'pursuing' });
    // Simulate the hook advancing the pursuit-block counter to 5 on an active goal.
    const cur = rawState();
    writeFileSync(
      resolveStatePath(S),
      JSON.stringify({ ...cur, iteration: 5 }),
      'utf8'
    );
    expect(readGoalState(S)!.active).toBe(true); // active prior => re-plan
    setGoalState(S, { phase: 'planning' });
    expect(rawState().iteration).toBe(5);
  });

  // V_flags: --max-iterations supplied with NO value (parsed as boolean true) must
  // exit non-zero and NOT collapse the budget to max_iterations:1.
  test('V_flags: set --max-iterations with no value exits non-zero and leaves state unchanged', () => {
    setGoalState(S, { phase: 'pursuing', max_iterations: 8 });
    const priorMax = rawState().max_iterations;
    const script = join(import.meta.dir, 'goal-state.ts');
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });
    // --max-iterations is the last token, so parseArgs coerces it to boolean true.
    expect(() => run('set --phase pursuing --max-iterations')).toThrow();
    expect(rawState().max_iterations).toBe(priorMax);
    expect(rawState().max_iterations).not.toBe(1);
  });

  // V_flags: --completion-evidence supplied with NO value (parsed as boolean true)
  // must exit non-zero and NOT persist the bogus ["true"] evidence.
  test('V_flags: set --completion-evidence with no value exits non-zero and persists no evidence', () => {
    setGoalState(S, { phase: 'pursuing' });
    const script = join(import.meta.dir, 'goal-state.ts');
    const run = (cmd: string) =>
      execSync(`bun ${script} ${cmd}`, { encoding: 'utf8', env: process.env });
    expect(() => run('set --phase pursuing --completion-evidence')).toThrow();
    expect(rawState().completion_evidence_paths).not.toEqual(['true']);
    expect(rawState().completion_evidence_paths).toEqual([]);
  });

  // C6: a corrupt on-disk max_iterations (non-number string) must be coerced to the
  // DEFAULT on the next merge-write rather than surviving uncoerced (it would defeat
  // the hook's iteration >= max_iterations comparison).
  test('C6: corrupt non-numeric prior max_iterations is coerced to DEFAULT on next write', () => {
    writeFileSync(
      resolveStatePath(S),
      JSON.stringify({
        phase: 'pursuing',
        active: true,
        objective_verdict: 'absent',
        completion_evidence_paths: [],
        started_at: '2026-01-01T00:00:00',
        iteration: 0,
        max_iterations: 'not-a-number',
        schema_version: 1,
        outcome: '',
        verification_surface: '',
        constraints: '',
        boundaries: '',
        blocked_stop: '',
        plan_path: '',
        resume_summary: '',
        budget_limit_notified: false,
        blocked_reason: '',
      }),
      'utf8'
    );
    // set with no --max-iterations => candidate falls back to the corrupt prior.
    setGoalState(S, { phase: 'pursuing' });
    expect(rawState().max_iterations).toBe(10);
  });
});

// A-4: readGoalState schema guard — mirrors readGoalStateRaw validation so the two
// readers can never disagree on whether a goal is active (finding A-4, 3rd /code-review).
describe('readGoalState schema guard', () => {
  function writeRaw(sessionId: string, obj: object): void {
    writeFileSync(resolveStatePath(sessionId), JSON.stringify(obj), 'utf8');
  }

  const VALID_ACTIVE: object = {
    active: true,
    phase: 'pursuing',
    iteration: 0,
    max_iterations: 10,
    started_at: '2026-01-01T00:00:00',
    outcome: '',
    verification_surface: '',
    constraints: '',
    boundaries: '',
    blocked_stop: '',
    plan_path: '',
    resume_summary: '',
    budget_limit_notified: false,
    blocked_reason: '',
    completion_evidence_paths: [],
    objective_verdict: 'absent',
    schema_version: 1,
  };

  // A-4a: active is string "true" (truthy non-boolean) — must return null, not the object
  test('returns null when active is the string "true" (truthy non-boolean)', () => {
    writeRaw(S, { ...VALID_ACTIVE, active: 'true' });
    expect(readGoalState(S)).toBeNull();
  });

  // A-4b: iteration is a non-numeric string — must return null
  test('returns null when iteration is a non-numeric string', () => {
    writeRaw(S, { ...VALID_ACTIVE, iteration: 'bad' });
    expect(readGoalState(S)).toBeNull();
  });

  // A-4c: iteration is negative — must return null
  test('returns null when iteration is negative', () => {
    writeRaw(S, { ...VALID_ACTIVE, iteration: -1 });
    expect(readGoalState(S)).toBeNull();
  });

  // A-4d: max_iterations is 0 — must return null
  test('returns null when max_iterations is 0', () => {
    writeRaw(S, { ...VALID_ACTIVE, max_iterations: 0 });
    expect(readGoalState(S)).toBeNull();
  });

  // A-4e: phase is an unknown string typo — must return null
  test('returns null when phase is an unknown string ("pursuit" typo)', () => {
    writeRaw(S, { ...VALID_ACTIVE, phase: 'pursuit' });
    expect(readGoalState(S)).toBeNull();
  });

  // A-4f regression: valid active state still returns the state
  test('regression: valid active state is returned normally', () => {
    writeRaw(S, VALID_ACTIVE);
    const state = readGoalState(S);
    expect(state).not.toBeNull();
    expect(state!.active).toBe(true);
    expect(state!.phase).toBe('pursuing');
  });

  // A-4g regression: valid inactive state still returns null (active-fold preserved)
  test('regression: valid inactive state returns null (active-fold preserved)', () => {
    writeRaw(S, { ...VALID_ACTIVE, active: false, phase: 'complete' });
    expect(readGoalState(S)).toBeNull();
  });
});

// helper: read raw JSON for an arbitrary session id under the test OMT_DIR
function rawStateOf(sessionId: string): any {
  return JSON.parse(readFileSync(resolveStatePath(sessionId), 'utf8'));
}

// --- New TODO-3 ACs ---

describe('goal-state hardening: heartbeat + no-create + hard-fail', () => {
  // (A5) goal-state refreshes last_touched_at on every write
  test('(A5) last_touched_at refreshed on every write, >= started_at', async () => {
    // S is already seeded in beforeEach
    setGoalState(S, { phase: 'planning', outcome: 'x' });
    const first = rawState();
    expect(first.last_touched_at).toBeTruthy();
    const firstLta: string = first.last_touched_at;
    // Wait 1 second to ensure timestamp advances
    await new Promise((r) => setTimeout(r, 1100));
    setGoalState(S, { phase: 'pursuing' });
    const second = rawState();
    expect(second.last_touched_at > firstLta).toBe(true);
    expect(second.last_touched_at >= second.started_at).toBe(true);
  });

  // (ADR-7-goal) goal CLI refuses to create when file absent
  test('(ADR-7-goal) setGoalState refuses when state file is absent — exits non-zero', () => {
    const absentSid = 'absent-goal-session';
    // No file seeded — must throw (process.exit(1))
    expect(() => setGoalState(absentSid, { phase: 'planning' })).toThrow();
    expect(existsSync(resolveStatePath(absentSid))).toBe(false);
  });

  // (B2) absent OMT_SESSION_ID via CLI → non-zero exit, no default file
  test('(B2) CLI exits non-zero when OMT_SESSION_ID is empty', () => {
    const script = join(import.meta.dir, 'goal-state.ts');
    const env = { ...process.env, OMT_SESSION_ID: '' };
    expect(() =>
      execSync(
        `bun ${script} set --phase planning --outcome x --verification-surface y --constraints z --boundaries b --max-iterations 10 --blocked-stop s`,
        { encoding: 'utf8', env }
      )
    ).toThrow();
    // No goal-state-default.json should have been created
    const defaultPath = `${tmpDir}/goal-state-default.json`;
    expect(existsSync(defaultPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const script = join(import.meta.dir, 'goal-state.ts');

/** Returns a current-time ISO-8601 string with timezone offset (format used by state-core). */
function nowIso(): string {
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

/** Build a live goal-state file for a given sid (active, recently touched, non-pristine). */
function writeLiveGoalState(sid: string, outcome: string): void {
  const path = `${tmpDir}/goal-state-${sid}.json`;
  const now = nowIso();
  writeFileSync(
    path,
    JSON.stringify({
      active: true,
      phase: 'pursuing',
      iteration: 1,
      max_iterations: 10,
      outcome,
      verification_surface: 'tests pass',
      constraints: '',
      boundaries: '',
      blocked_stop: '',
      plan_path: '',
      resume_summary: '',
      budget_limit_notified: false,
      blocked_reason: '',
      completion_evidence_paths: [],
      objective_verdict: 'absent',
      schema_version: 1,
      started_at: now,
      last_touched_at: now,
    }),
    'utf8'
  );
}

/** Write a pristine goal-state seed for a given sid. */
function writePristineGoalState(sid: string): void {
  const path = `${tmpDir}/goal-state-${sid}.json`;
  const now = nowIso();
  writeFileSync(
    path,
    JSON.stringify({
      active: true,
      phase: 'planning',
      iteration: 0,
      max_iterations: 10,
      outcome: '',
      verification_surface: '',
      constraints: '',
      boundaries: '',
      blocked_stop: '',
      plan_path: '',
      resume_summary: '',
      budget_limit_notified: false,
      blocked_reason: '',
      completion_evidence_paths: [],
      objective_verdict: 'absent',
      schema_version: 1,
      started_at: now,
      last_touched_at: now,
    }),
    'utf8'
  );
}

function runCli(args: string, env?: Record<string, string>): string {
  return execSync(`bun ${script} ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('adoption: list-others + adopt (goal CLI)', () => {
  // (F2-goal) list-others surfaces ACTIVE-live other-session candidate, excludes self
  test('F2-goal: list-others shows other-session A candidate (outcome as purpose), excludes self B', () => {
    writeLiveGoalState('A', 'ship X');
    writePristineGoalState('B');
    const out = runCli('list-others', { OMT_SESSION_ID: 'B' });
    // A must appear with its purpose "ship X"
    expect(out).toContain('A');
    expect(out).toContain('ship X');
    // Self (B) must not appear
    const lines = out.trim().split('\n').filter(Boolean);
    expect(lines.every((l) => !l.includes('goal-state-B'))).toBe(true);
    // B sid must not appear as a candidate
    expect(lines.some((l) => / B[ \t]|^B[ \t]|\tB\t/.test(l) || l.startsWith('B '))).toBe(false);
  });

  // (label) candidate line carries all 4 required fields: short-sid, purpose, started_at, idle seconds
  test('label: list-others output line for A has sid prefix + purpose + started_at + idle-seconds', () => {
    writeLiveGoalState('sidABC12345', 'build feature Y');
    const out = runCli('list-others', { OMT_SESSION_ID: 'otherSession' });
    // sid appears (first 8 chars minimum)
    expect(out).toContain('sidABC12');
    // purpose
    expect(out).toContain('build feature Y');
    // started_at (ISO date pattern)
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
    // idle seconds (integer)
    expect(out).toMatch(/\d+s/);
  });

  // (F3-cli) adopt re-keys: source A gone, target B holds A's content, exit 0
  test('F3-cli: adopt --src A re-keys A into B; A absent, B holds A content', () => {
    writeLiveGoalState('A', 'purpose P');
    writePristineGoalState('B');
    runCli('adopt --src A', { OMT_SESSION_ID: 'B' });
    // A must be gone
    expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
    // B must hold A's content (outcome = "purpose P")
    const b = JSON.parse(readFileSync(`${tmpDir}/goal-state-B.json`, 'utf8'));
    expect(b.outcome).toBe('purpose P');
    // adoption.log must have one entry
    const log = readFileSync(`${tmpDir}/adoption.log`, 'utf8');
    expect(log).toContain('goal');
    expect(log).toContain('A -> B');
  });

  // (F6-cli) adopt refused on ACTIVE non-pristine current; both files unchanged
  test('F6-cli: adopt refused when current B is ACTIVE non-pristine; both files unchanged', () => {
    writeLiveGoalState('A', 'purpose A');
    writeLiveGoalState('B', 'ongoing work');  // non-pristine active
    const aContent = readFileSync(`${tmpDir}/goal-state-A.json`, 'utf8');
    const bContent = readFileSync(`${tmpDir}/goal-state-B.json`, 'utf8');
    // adopt must fail (non-zero exit)
    expect(() => runCli('adopt --src A', { OMT_SESSION_ID: 'B' })).toThrow();
    // Both files must be unchanged
    expect(readFileSync(`${tmpDir}/goal-state-A.json`, 'utf8')).toBe(aContent);
    expect(readFileSync(`${tmpDir}/goal-state-B.json`, 'utf8')).toBe(bContent);
  });

  // (dormancy-goal) adopted-away live source's old-sid write → non-zero, file still absent
  test('dormancy-goal: after adoption, session A write to goal-state-A.json is refused (no-create)', () => {
    writeLiveGoalState('A', 'purpose dormancy');
    writePristineGoalState('B');
    // adopt A into B
    runCli('adopt --src A', { OMT_SESSION_ID: 'B' });
    expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
    // Now session A tries to write — must fail non-zero (no-create semantics)
    expect(() =>
      runCli('set --phase pursuing', { OMT_SESSION_ID: 'A' })
    ).toThrow();
    // File must still be absent
    expect(existsSync(`${tmpDir}/goal-state-A.json`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F2/F10: get subcommand pristine field (RED tests — must fail before implementation)
// ---------------------------------------------------------------------------

describe('get subcommand includes pristine field', () => {
  // (F2-get-pristine) A freshly seeded state (phase=planning, iteration=0, outcome='')
  // must report pristine:true in get output so the SKILL.md gate can distinguish its
  // own seed from a real in-flight pursuit.
  test('F2-get-pristine: get returns pristine:true for a freshly seeded state', () => {
    // S is seeded in beforeEach with phase=planning, iteration=0, outcome=''
    const result = readGoalGet(S);
    expect(result).not.toBeNull();
    expect(result!.pristine).toBe(true);
  });

  // (F2-get-not-pristine-outcome) Once the orchestrator writes a real outcome, the
  // seed is no longer pristine — get must report pristine:false.
  test('F2-get-not-pristine-outcome: get returns pristine:false after outcome is set', () => {
    setGoalState(S, { phase: 'planning', outcome: 'ship feature X' });
    const result = readGoalGet(S);
    expect(result).not.toBeNull();
    expect(result!.pristine).toBe(false);
  });

  // (F2-get-not-pristine-pursuing) Phase=pursuing is not pristine (iteration may be 0
  // but phase has advanced past planning).
  test('F2-get-not-pristine-pursuing: get returns pristine:false when phase is pursuing', () => {
    setGoalState(S, { phase: 'pursuing' });
    const result = readGoalGet(S);
    expect(result).not.toBeNull();
    expect(result!.pristine).toBe(false);
  });

  // (F2-get-cli) CLI `get` subcommand JSON output contains pristine field.
  test('F2-get-cli: CLI get output JSON contains pristine field', () => {
    const out = runCli('get');
    const parsed = JSON.parse(out);
    expect(typeof parsed.pristine).toBe('boolean');
    expect(parsed.pristine).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F10/ADR-7: writeFileNoCreate — no TOCTOU race in merge-write path
// ---------------------------------------------------------------------------

describe('mergeWrite uses writeFileNoCreate (no TOCTOU race)', () => {
  // (F10-no-create-after-adopt) After a rename-away (simulating adopt), the orphaned
  // session's merge-write must throw ENOENT, not silently recreate the file.
  // This is the TOCTOU scenario: rename happens between an existsSync check and a
  // writeFileSync call. writeFileNoCreate collapses check+write to a single open('r+')
  // so the race window does not exist.
  test('F10-no-create-after-adopt: merge-write throws after file is renamed away', () => {
    // Set up a valid state
    setGoalState(S, { phase: 'planning', outcome: 'test' });
    // Simulate adopt-rename: rename the file away WHILE session S still holds reference
    const src = resolveStatePath(S);
    const dst = src + '.adopted';
    const { renameSync } = require('fs');
    renameSync(src, dst);
    // Now try to write — must fail (file absent), not silently recreate
    expect(() => setGoalState(S, { phase: 'pursuing' })).toThrow();
    // The original file path must still be absent (not recreated)
    expect(existsSync(src)).toBe(false);
  });
});

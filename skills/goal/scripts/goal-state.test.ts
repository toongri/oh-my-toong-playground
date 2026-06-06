import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
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
  type GoalPhase,
} from './goal-state.ts';

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = 'test-session';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'goal-state-test-'));
  process.env.OMT_DIR = tmpDir;
  process.env.OMT_SESSION_ID = S;
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
  return JSON.parse(readFileSync(resolveStatePath(S), 'utf8'));
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
    setGoalState(S3, { phase: 'pursuing' });
    setBudgetLimited(S3);
    expect(readGoalState(S3)).toBeNull(); // active:false reads as null
    expect(rawStateOf(S3).phase).toBe('budget_limited');

    const S4 = 'blk-session';
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
    setGoalState(Sc, { phase: 'pursuing', completion_evidence_paths: [`${tmpDir}/p`] });
    setVerdict(Sc, 'APPROVE');
    requestComplete(Sc);
    expect(rawStateOf(Sc).active).toBe(false);

    // budget_limited
    const Sb = 'b';
    setGoalState(Sb, { phase: 'pursuing' });
    setBudgetLimited(Sb);
    expect(rawStateOf(Sb).active).toBe(false);

    // blocked
    const Sk = 'k';
    setGoalState(Sk, { phase: 'pursuing' });
    setBlocked(Sk, 'no path');
    expect(rawStateOf(Sk).active).toBe(false);

    // non-terminal stays active
    const Sp = 'p';
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
});

// helper: read raw JSON for an arbitrary session id under the test OMT_DIR
function rawStateOf(sessionId: string): any {
  return JSON.parse(readFileSync(resolveStatePath(sessionId), 'utf8'));
}

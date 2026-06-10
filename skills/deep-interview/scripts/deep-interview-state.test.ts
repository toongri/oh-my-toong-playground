import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initDeepInterviewState,
  updateDeepInterviewState,
  readDeepInterviewState,
  resolveStatePath,
} from './deep-interview-state.ts';

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const SID = 'T';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'di-state-test-'));
  process.env.OMT_DIR = tmpDir;
  process.env.OMT_SESSION_ID = SID;
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

/** Write a seed-shaped file (what PreToolUse hook creates) */
function writeSeed(sid: string = SID): void {
  const seed = {
    active: true,
    started_at: '2026-01-01T00:00:00+00:00',
    last_touched_at: '2026-01-01T00:00:00+00:00',
  };
  writeFileSync(resolveStatePath(sid), JSON.stringify(seed, null, 2), 'utf8');
}

function rawState(sid: string = SID): Record<string, unknown> {
  return JSON.parse(readFileSync(resolveStatePath(sid), 'utf8')) as Record<string, unknown>;
}

describe('deep-interview state', () => {
  // AC A4/A5 — init overlays into seed; update merges and refreshes heartbeat; single file
  test('A4/A5: init overlays rich shape into seed; update merges and refreshes last_touched_at; one file throughout', async () => {
    writeSeed();

    // init with initial_idea
    initDeepInterviewState(SID, { initial_idea: 'build X' });

    const afterInit = rawState();
    // Seed fields preserved
    expect(afterInit['active']).toBe(true);
    expect(typeof afterInit['started_at']).toBe('string');
    // Rich state overlaid
    expect((afterInit['state'] as Record<string, unknown>)['initial_idea']).toBe('build X');
    expect(afterInit['current_phase']).toBe('deep-interview');
    // Still one file
    const files = require('fs').readdirSync(tmpDir).filter((f: string) => f.startsWith('deep-interview-active-state-'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`deep-interview-active-state-${SID}.json`);

    const ltaBefore = String(afterInit['last_touched_at']);

    // Small delay so last_touched_at advances
    await new Promise((r) => setTimeout(r, 1100));

    // update with current_phase
    updateDeepInterviewState(SID, { current_phase: 'phase2' });

    const afterUpdate = rawState();
    // Rich fields preserved
    expect((afterUpdate['state'] as Record<string, unknown>)['initial_idea']).toBe('build X');
    // current_phase updated
    expect(afterUpdate['current_phase']).toBe('phase2');
    // last_touched_at advanced
    expect(afterUpdate['last_touched_at']).not.toBe(ltaBefore);
    // Still one file
    const files2 = require('fs').readdirSync(tmpDir).filter((f: string) => f.startsWith('deep-interview-active-state-'));
    expect(files2).toHaveLength(1);
  });

  // AC ADR-7-init — init on absent file → non-zero (throws), nothing created
  test('ADR-7-init: init on absent file throws and creates nothing', () => {
    // No seed file
    expect(() => initDeepInterviewState(SID, { initial_idea: 'x' })).toThrow();
    expect(existsSync(resolveStatePath(SID))).toBe(false);
  });

  // AC ADR-7-update — update on absent file → non-zero (throws), nothing created
  test('ADR-7-update: update on absent file throws and creates nothing', () => {
    expect(() => updateDeepInterviewState(SID, { current_phase: 'phase1' })).toThrow();
    expect(existsSync(resolveStatePath(SID))).toBe(false);
  });

  // AC sessionId-free — no sessionId field written
  test('sessionId-free: init output contains no sessionId field', () => {
    writeSeed();
    initDeepInterviewState(SID, { initial_idea: 'build Y' });
    const state = rawState();
    expect(Object.prototype.hasOwnProperty.call(state, 'sessionId')).toBe(false);
    // Also check nested state object
    const nested = state['state'] as Record<string, unknown> | undefined;
    if (nested) {
      expect(Object.prototype.hasOwnProperty.call(nested, 'sessionId')).toBe(false);
    }
  });

  // AC E2c — purpose recorded: .state.initial_idea non-empty after init
  test('E2c: .state.initial_idea is non-empty after init', () => {
    writeSeed();
    initDeepInterviewState(SID, { initial_idea: 'the real idea' });
    const state = rawState();
    const nested = state['state'] as Record<string, unknown>;
    expect(typeof nested['initial_idea']).toBe('string');
    expect((nested['initial_idea'] as string).length).toBeGreaterThan(0);
  });

  // AC A3 (unit half) — resolveStatePath is keyed on sessionId, not on any positional argument
  test('A3: resolveStatePath produces a path keyed on sessionId; a different sid maps to a different path', () => {
    const path = resolveStatePath(SID);
    expect(path).toContain(`deep-interview-active-state-${SID}.json`);
    const otherPath = resolveStatePath('other-session');
    expect(otherPath).not.toBe(path);
    // CLI-surface enforcement (stray positional arg is silently dropped) is covered in
    // the "CLI main()" describe block below via execSync.
  });

  // read returns null for absent file
  test('readDeepInterviewState returns null for absent file', () => {
    expect(readDeepInterviewState(SID)).toBeNull();
  });

  // read returns the raw object for a seed-only file (active but no state object yet)
  test('readDeepInterviewState returns seed content as raw object', () => {
    writeSeed();
    const result = readDeepInterviewState(SID);
    expect(result).not.toBeNull();
    expect(result!['active']).toBe(true);
  });
});

// CLI integration tests — exercise main() via execSync (real binary surface)
describe('deep-interview-state CLI main()', () => {
  const script = join(import.meta.dir, 'deep-interview-state.ts');
  const run = (cmd: string, env?: Record<string, string>) =>
    execSync(`bun ${script} ${cmd}`, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });

  // AC A3 (CLI surface) — stray positional arg must NOT redirect the state file
  test('A3: stray positional arg after subcommand is silently dropped; state lands at canonical sid path only', () => {
    writeSeed();
    // Pass a stray positional: "init EVIL hijack-sid --initial-idea X"
    // parseArgs should take "init" as subcommand, silently drop "EVIL" and "hijack-sid",
    // and write the state keyed on OMT_SESSION_ID (SID = 'T'), not on "hijack-sid".
    run('init EVIL hijack-sid --initial-idea stranded');
    // The canonical file must exist and contain the written idea
    const state = rawState(SID);
    expect((state['state'] as Record<string, unknown>)['initial_idea']).toBe('stranded');
    // No file was created at paths derived from the stray args
    const files = readdirSync(tmpDir);
    const strayFiles = files.filter((f) => f.includes('EVIL') || f.includes('hijack-sid'));
    expect(strayFiles).toHaveLength(0);
  });

  // CLI init subcommand writes rich shape via the real parseArgs + main() path
  test('init subcommand overlays rich shape into seed file via CLI', () => {
    writeSeed();
    run('init --initial-idea "cli test idea" --type greenfield');
    const state = rawState();
    expect((state['state'] as Record<string, unknown>)['initial_idea']).toBe('cli test idea');
    expect((state['state'] as Record<string, unknown>)['type']).toBe('greenfield');
    expect(state['current_phase']).toBe('deep-interview');
  });

  // CLI update subcommand — current_ambiguity must land under state (SKILL.md:93)
  test('update subcommand writes current_ambiguity under state.current_ambiguity', () => {
    writeSeed();
    initDeepInterviewState(SID, { initial_idea: 'seed idea' });
    run('update --current-phase "round2" --current-ambiguity 0.6');
    const state = rawState();
    expect(state['current_phase']).toBe('round2');
    // Must be nested under state per SKILL.md shape, not at the file root
    const nested = state['state'] as Record<string, unknown>;
    expect(nested['current_ambiguity']).toBe(0.6);
    expect(Object.prototype.hasOwnProperty.call(state, 'current_ambiguity')).toBe(false);
  });

  // CLI get subcommand prints parseable JSON to stdout
  test('get subcommand prints parseable JSON to stdout', () => {
    writeSeed();
    initDeepInterviewState(SID, { initial_idea: 'get test' });
    const output = run('get');
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).not.toBeNull();
    expect((parsed['state'] as Record<string, unknown>)['initial_idea']).toBe('get test');
  });

  // CLI absent-file → non-zero exit (mirrors goal-state.test.ts:646-653 pattern)
  test('init on absent file exits non-zero via CLI', () => {
    // No seed written — init must fail
    expect(() => run('init --initial-idea "x"')).toThrow();
    expect(existsSync(resolveStatePath(SID))).toBe(false);
  });

  // CLI absent OMT_SESSION_ID → non-zero exit
  test('CLI exits non-zero when OMT_SESSION_ID is empty', () => {
    expect(() => run('init --initial-idea "x"', { OMT_SESSION_ID: '' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const diScript = join(import.meta.dir, 'deep-interview-state.ts');
function runDi(cmd: string, env?: Record<string, string>): string {
  return execSync(`bun ${diScript} ${cmd}`, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** Returns a current-time ISO-8601 string with timezone offset. */
function nowIsoDi(): string {
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

/** Write a live (non-pristine) deep-interview state for the given sid. */
function writeLiveDiState(sid: string, initialIdea: string): void {
  const path = `${tmpDir}/deep-interview-active-state-${sid}.json`;
  const now = nowIsoDi();
  writeFileSync(
    path,
    JSON.stringify({
      active: true,
      current_phase: 'deep-interview',
      started_at: now,
      last_touched_at: now,
      state: {
        interview_id: 'uuid-' + sid,
        type: 'greenfield',
        initial_idea: initialIdea,
        initial_context_summary: null,
        rounds: [],
        current_ambiguity: 0.5,
        threshold: 0.2,
        codebase_context: null,
        challenge_modes_used: [],
        ontology_snapshots: [],
      },
    }),
    'utf8'
  );
}

/** Write a pristine (seed-only) deep-interview state for the given sid. */
function writePristineDiState(sid: string): void {
  writeSeed(sid);
}

describe('adoption: list-others + adopt (deep-interview CLI)', () => {
  // (F2-di) list-others surfaces ACTIVE-live candidate; purpose = state.initial_idea
  test('F2-di: list-others shows A with initial_idea as purpose, excludes self B', () => {
    writeLiveDiState('diA', 'build DI feature');
    writePristineDiState('diB');
    const out = runDi('list-others', { OMT_SESSION_ID: 'diB' });
    expect(out).toContain('diA');
    expect(out).toContain('build DI feature');
    // Self must not appear
    const lines = out.trim().split('\n').filter(Boolean);
    expect(lines.some((l) => l.includes('diB'))).toBe(false);
  });

  // (label) candidate line has all 4 fields
  test('label: list-others DI candidate line has sid + purpose + started_at + idle-seconds', () => {
    writeLiveDiState('diLabel', 'my DI idea');
    const out = runDi('list-others', { OMT_SESSION_ID: 'diOther' });
    expect(out).toContain('diLabel');
    expect(out).toContain('my DI idea');
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).toMatch(/\d+s/);
  });

  // (F3-cli) adopt re-keys via DI CLI
  test('F3-cli: DI adopt --src A moves A to B; A absent, B holds initial_idea', () => {
    writeLiveDiState('diSrcA', 'adopt DI idea');
    writePristineDiState('diDstB');
    runDi('adopt --src diSrcA', { OMT_SESSION_ID: 'diDstB' });
    expect(existsSync(resolveStatePath('diSrcA'))).toBe(false);
    const b = JSON.parse(readFileSync(resolveStatePath('diDstB'), 'utf8')) as Record<string, unknown>;
    const st = b['state'] as Record<string, unknown>;
    expect(st['initial_idea']).toBe('adopt DI idea');
    const log = readFileSync(`${tmpDir}/adoption.log`, 'utf8');
    expect(log).toContain('deep-interview');
    expect(log).toContain('diSrcA -> diDstB');
  });

  // (F6-cli) adopt refused on ACTIVE non-pristine current
  test('F6-cli: DI adopt refused when current is ACTIVE non-pristine', () => {
    writeLiveDiState('diSrc2', 'source idea');
    writeLiveDiState('diDst2', 'current work');  // non-pristine (has state object)
    const srcContent = readFileSync(resolveStatePath('diSrc2'), 'utf8');
    const dstContent = readFileSync(resolveStatePath('diDst2'), 'utf8');
    expect(() => runDi('adopt --src diSrc2', { OMT_SESSION_ID: 'diDst2' })).toThrow();
    expect(readFileSync(resolveStatePath('diSrc2'), 'utf8')).toBe(srcContent);
    expect(readFileSync(resolveStatePath('diDst2'), 'utf8')).toBe(dstContent);
  });

  // (dormancy-di) adopted-away source cannot write via update
  test('dormancy-di: after adoption, session A update is refused (no-create)', () => {
    writeLiveDiState('diAdoptA', 'idea to adopt');
    writePristineDiState('diAdoptB');
    runDi('adopt --src diAdoptA', { OMT_SESSION_ID: 'diAdoptB' });
    expect(existsSync(resolveStatePath('diAdoptA'))).toBe(false);
    // Session A tries to write — must fail non-zero
    expect(() =>
      runDi('update --current-phase phase2', { OMT_SESSION_ID: 'diAdoptA' })
    ).toThrow();
    expect(existsSync(resolveStatePath('diAdoptA'))).toBe(false);
  });
});

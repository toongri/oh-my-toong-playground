import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeDurableSink } from './durable-sink';

// ---------------------------------------------------------------------------
// F4: durable sink — candidates.json + usage-summary.json per runId
//
// Guards three properties:
//   1. Path determinism: sink writes to EXACTLY ${OMT_DIR}/code-review/<runId>/
//   2. Field completeness: candidates.json has `found`, `deduped`, `dispatched`
//      as separate assertable fields
//   3. D=0 invariant: a zero-dispatch run still writes candidates.json (zeros)
//
// runId is injected (never generated inside writeDurableSink) so tests are
// deterministic without crypto.randomUUID() variance.
// getOmtDir() reads OMT_DIR at call-time, so the hermetic temp-dir env setup
// routes writes to the test fixture dir.
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;

/** Stable run id for path-determinism tests. */
const KNOWN_RUN_ID = 'test-run-abc123';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'durable-sink-test-'));
  process.env.OMT_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalOmtDir !== undefined) {
    process.env.OMT_DIR = originalOmtDir;
  } else {
    delete process.env.OMT_DIR;
  }
});

// ---------------------------------------------------------------------------
// AC 1: path determinism — sink writes to ${OMT_DIR}/code-review/<runId>/
// ---------------------------------------------------------------------------
describe('F4: durable sink path determinism', () => {
  test('candidates.json path resolves to ${OMT_DIR}/code-review/<runId>/candidates.json', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 5, deduped: 3, dispatched: 3 });

    const expectedPath = join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json');
    expect(existsSync(expectedPath)).toBe(true);
  });

  test('usage-summary.json path resolves to ${OMT_DIR}/code-review/<runId>/usage-summary.json', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 5, deduped: 3, dispatched: 3 });

    const expectedPath = join(tmpDir, 'code-review', KNOWN_RUN_ID, 'usage-summary.json');
    expect(existsSync(expectedPath)).toBe(true);
  });

  test('different runIds write to different subdirectories (no cross-run collision)', () => {
    writeDurableSink({ runId: 'run-alpha', found: 2, deduped: 1, dispatched: 1 });
    writeDurableSink({ runId: 'run-beta', found: 3, deduped: 2, dispatched: 2 });

    expect(existsSync(join(tmpDir, 'code-review', 'run-alpha', 'candidates.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'code-review', 'run-beta', 'candidates.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 2: candidates.json field completeness — found, deduped, dispatched
//        each asserted SEPARATELY (catching a partial-write)
// ---------------------------------------------------------------------------
describe('F4: candidates.json field completeness', () => {
  test('candidates.json contains `found` field', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

    const raw = readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.found).toBe(7);
  });

  test('candidates.json contains `deduped` field', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

    const raw = readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.deduped).toBe(4);
  });

  test('candidates.json contains `dispatched` field', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

    const raw = readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.dispatched).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// AC 3: D=0 invariant — a zero-dispatch run still writes candidates.json
//        (a review that found nothing still needs the measurement artifact)
// ---------------------------------------------------------------------------
describe('F4: D=0 invariant', () => {
  test('D=0: candidates.json is written with found=0', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

    const expectedPath = join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json');
    expect(existsSync(expectedPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(expectedPath, 'utf8'));
    expect(parsed.found).toBe(0);
  });

  test('D=0: candidates.json deduped field is zero', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

    const parsed = JSON.parse(
      readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json'), 'utf8')
    );
    expect(parsed.deduped).toBe(0);
  });

  test('D=0: candidates.json dispatched field is zero', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

    const parsed = JSON.parse(
      readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'candidates.json'), 'utf8')
    );
    expect(parsed.dispatched).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC 4: findTokenUsage is persisted in usage-summary.json (optional field)
//        Missing findTokenUsage does NOT block the sink write.
// ---------------------------------------------------------------------------
describe('F4: usage-summary.json', () => {
  test('findTokenUsage is written to usage-summary.json when provided', () => {
    const tokenData = { memberCount: 4, usage: { input_tokens: 1200, output_tokens: 800 } };
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 3, deduped: 2, dispatched: 2, findTokenUsage: tokenData });

    const raw = readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'usage-summary.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.findTokenUsage).toEqual(tokenData);
  });

  test('missing findTokenUsage does not block sink write (usage-summary.json still created)', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 2, deduped: 1, dispatched: 1 });

    const expectedPath = join(tmpDir, 'code-review', KNOWN_RUN_ID, 'usage-summary.json');
    expect(existsSync(expectedPath)).toBe(true);
  });

  test('missing findTokenUsage writes null in usage-summary.json', () => {
    writeDurableSink({ runId: KNOWN_RUN_ID, found: 2, deduped: 1, dispatched: 1 });

    const parsed = JSON.parse(
      readFileSync(join(tmpDir, 'code-review', KNOWN_RUN_ID, 'usage-summary.json'), 'utf8')
    );
    expect(parsed.findTokenUsage).toBeNull();
  });
});

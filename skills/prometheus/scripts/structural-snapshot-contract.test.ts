import { test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Contract tokens: verbatim literals that MUST be present in SKILL.md.
// This test is the static CI gate (plan AC F2).
// Each expect() is a discrete per-token assertion so grep -c "expect(" >= 8.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, '..', 'SKILL.md');
const skillContent = readFileSync(skillPath, 'utf8');

test('contract token present: snapshot name', () => {
  expect(skillContent).toContain('Structural Co-Design Snapshot');
});

test('contract token present: Allocation table header', () => {
  expect(skillContent).toContain(
    '| Unit | Responsibility | Owns State | Interfaces | Must NOT Own |',
  );
});

test('contract token present: Flow table header', () => {
  expect(skillContent).toContain(
    '| Step | Caller | Callee | Data/Command | Side Effect | Failure/Retry Path |',
  );
});

test('contract token present: close-gate literal', () => {
  expect(skillContent).toContain('WITHOUT inventing new ownership or edges');
});

test('contract token present: escape derived-trigger literal', () => {
  expect(skillContent).toContain('no new ownership and no new edges');
});

test('contract token present: Momus framing — architecture ideality exclusion', () => {
  expect(skillContent).toContain('architecture ideality');
});

test('contract token present: Momus framing — feasibility', () => {
  expect(skillContent).toContain('feasibility');
});

test('contract token present: citation convention', () => {
  expect(skillContent).toContain('file:symbol');
});

test('contract token present: State-Machine S2-row pointer', () => {
  expect(skillContent).toContain('(defined below)');
});

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Prose-contract tests for skills/deep-interview/SKILL.md and template.
// Mirrors the presence/absence assertion style of
// skills/ultraresearch/SKILL.test.ts.
//
// RED step (pre-edit state):
//   - new-prose assertions FAIL  (phrases not yet in SKILL.md)
//   - template assertions FAIL   (section not yet in template)
//   - regression-guard assertions PASS (invariants that must never break)
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, 'SKILL.md'), 'utf8');
const template = readFileSync(
  join(import.meta.dir, 'deep-interview-spec-template.md'),
  'utf8'
);

// ---------------------------------------------------------------------------
// NEW-PROSE (must FAIL before T4 edits — RED)
// ---------------------------------------------------------------------------

describe('new-prose: daedalus dispatch', () => {
  test('daedalus dispatch mention is present', () => {
    expect(skillMd).toContain('daedalus');
  });
});

describe('new-prose: design-fork detection', () => {
  test('design-fork detection mention is present', () => {
    expect(skillMd).toContain('fork');
  });
});

describe('new-prose: HOW-readiness gate', () => {
  test('HOW-readiness gate termination condition is present', () => {
    expect(skillMd).toContain('how-readiness');
  });
});

describe('new-prose: section-by-section approval loop', () => {
  test('per-section approval loop is present', () => {
    expect(skillMd).toContain('per-section');
    expect(skillMd).toContain('approval');
  });
});

describe('new-prose: final whole-spec gate', () => {
  test('final whole-spec review gate is present', () => {
    expect(skillMd).toContain('whole spec');
  });
});

describe('new-prose: inline self-review', () => {
  test('inline self-review is present', () => {
    expect(skillMd).toContain('self-review');
  });
});

describe('new-prose: spec-reviewer dispatch', () => {
  test('spec-reviewer dispatch is present', () => {
    expect(skillMd).toContain('spec-reviewer');
  });
});

describe('new-prose: brainstorm-delegation phrase removal', () => {
  test('"explore options or brainstorm" phrase is absent', () => {
    expect(skillMd).not.toContain('explore options or brainstorm');
  });
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD (must PASS before AND after edits — invariant)
// ---------------------------------------------------------------------------

describe('regression-guard', () => {
  test('ambiguity formula is present', () => {
    expect(skillMd).toContain('goal × 0.40 + constraints × 0.30 + criteria × 0.30');
  });

  test('metis is absent from SKILL.md', () => {
    expect(skillMd.toLowerCase()).not.toContain('metis');
  });
});

// ---------------------------------------------------------------------------
// TEMPLATE (must FAIL before T3 edit — RED)
// ---------------------------------------------------------------------------

describe('template: approach and design decisions section', () => {
  test('"## Approach & Design Decisions" is present in template', () => {
    expect(template).toContain('## Approach & Design Decisions');
  });
});

import { describe, test, expect } from 'bun:test';
import { REQUIRED_HEADINGS, validatePlan } from './validate-plan.ts';

// ---------------------------------------------------------------------------
// Self-test: canonical heading list
// ---------------------------------------------------------------------------

test('validator required headings are the 7 canonical literals', () => {
  expect(REQUIRED_HEADINGS).toEqual([
    'TL;DR',
    'Context',
    'Work Objectives',
    'TODOs',
    'Execution Strategy',
    'Verification Strategy',
    'Success Criteria',
  ]);
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    'TL;DR': 'Short summary of the work.',
    'Context': 'Background and motivation for the work.',
    'Work Objectives': 'The concrete goals we want to achieve.',
    'TODOs': '- [ ] Step 1\n- [ ] Step 2',
    'Execution Strategy': 'How we will execute the plan.',
    'Verification Strategy': 'How we verify correctness.',
    'Success Criteria': 'Definition of done.',
  };
  const sections = { ...defaults, ...overrides };
  return REQUIRED_HEADINGS.map((h) => {
    const body = sections[h] ?? `Body for ${h}.`;
    return `## ${h}\n\n${body}\n`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Happy-path
// ---------------------------------------------------------------------------

describe('real-plan fixture passes', () => {
  test('real-plan fixture passes', () => {
    const plan = buildPlan();
    const missing = validatePlan(plan);
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empty section tests — one per required heading
// ---------------------------------------------------------------------------

describe('empty sections', () => {
  test('empty section: TL;DR', () => {
    const plan = buildPlan({ 'TL;DR': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('TL;DR');
  });

  test('empty section: Context', () => {
    const plan = buildPlan({ 'Context': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('Context');
  });

  test('empty section: Work Objectives', () => {
    const plan = buildPlan({ 'Work Objectives': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('Work Objectives');
  });

  test('empty section: TODOs', () => {
    const plan = buildPlan({ 'TODOs': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('TODOs');
  });

  test('empty section: Execution Strategy', () => {
    const plan = buildPlan({ 'Execution Strategy': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('Execution Strategy');
  });

  test('empty section: Verification Strategy', () => {
    const plan = buildPlan({ 'Verification Strategy': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('Verification Strategy');
  });

  test('empty section: Success Criteria', () => {
    const plan = buildPlan({ 'Success Criteria': '' });
    const missing = validatePlan(plan);
    expect(missing).toContain('Success Criteria');
  });
});

// ---------------------------------------------------------------------------
// Policy tests
// ---------------------------------------------------------------------------

describe('validator policy', () => {
  test('validator policy: fenced heading not counted', () => {
    // ## Success Criteria appears ONLY inside a code fence — must NOT count
    const plan =
      buildPlan({ 'Success Criteria': '' })
        .replace(
          '## Success Criteria\n\n\n',
          // Remove the real (empty) heading and replace entire section with
          // a fenced block that contains the heading literal
          '```\n## Success Criteria\nThis is inside a fence.\n```\n',
        );
    const missing = validatePlan(plan);
    expect(missing).toContain('Success Criteria');
  });

  test('validator policy: whitespace-only body empty', () => {
    // Body is only spaces/newlines — counts as empty
    const plan = buildPlan({ 'TODOs': '   \n   \n   ' });
    const missing = validatePlan(plan);
    expect(missing).toContain('TODOs');
  });

  test('validator policy: duplicate heading first occurrence', () => {
    // First occurrence of TODOs has content; second is empty.
    // Validator must use FIRST occurrence → result should NOT list TODOs as missing.
    const plan =
      buildPlan() +
      '\n## TODOs\n\n\n';
    const missing = validatePlan(plan);
    expect(missing).not.toContain('TODOs');
  });
});

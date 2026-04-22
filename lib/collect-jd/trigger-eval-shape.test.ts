import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTriggerEvalShape, type TriggerEvalEntry } from './trigger-eval-shape';

const evalJsonPath = join(process.cwd(), 'skills/collect-jd/evals/trigger-eval.json');

function makePositives(count: number): TriggerEvalEntry[] {
  return Array.from({ length: count }, (_, i) => ({ query: `긍정 쿼리 ${i}`, should_trigger: true }));
}

function makeNegatives(count: number): TriggerEvalEntry[] {
  return Array.from({ length: count }, (_, i) => ({ query: `부정 쿼리 ${i}`, should_trigger: false, expected_skill: 'resume-apply' }));
}

describe('trigger-eval-shape validator', () => {
  it('실제 evals/trigger-eval.json 스펙 통과', () => {
    const raw = readFileSync(evalJsonPath);
    const data = JSON.parse(raw.toString());
    const r = validateTriggerEvalShape(data);
    if (!r.ok) console.error(r.errors);
    expect(r.ok).toBe(true);
  });

  it('positive 10 미만 → POSITIVE_UNDER_MIN', () => {
    const data = [...makePositives(9), ...makeNegatives(10)];
    const r = validateTriggerEvalShape(data);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'POSITIVE_UNDER_MIN')).toBe(true);
  });

  it('negative 10 미만 → NEGATIVE_UNDER_MIN', () => {
    const data = [...makePositives(10), ...makeNegatives(9)];
    const r = validateTriggerEvalShape(data);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'NEGATIVE_UNDER_MIN')).toBe(true);
  });

  it('중복 query → DUPLICATE_QUERY', () => {
    const data: TriggerEvalEntry[] = [
      ...makePositives(10),
      ...makeNegatives(10),
      { query: '긍정 쿼리 0', should_trigger: true },
    ];
    const r = validateTriggerEvalShape(data);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'DUPLICATE_QUERY')).toBe(true);
  });

  it('should_trigger=false 인데 expected_skill 없음 → NEGATIVE_MISSING_EXPECTED_SKILL', () => {
    const data: unknown[] = [
      ...makePositives(10),
      ...makeNegatives(9),
      { query: '이상한 질문', should_trigger: false },
    ];
    const r = validateTriggerEvalShape(data);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'NEGATIVE_MISSING_EXPECTED_SKILL')).toBe(true);
  });

  it('빈 배열 → EMPTY_ARRAY', () => {
    const r = validateTriggerEvalShape([]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'EMPTY_ARRAY')).toBe(true);
  });

  it('배열이 아닌 값 → WRONG_TYPE', () => {
    const r = validateTriggerEvalShape({ query: 'test' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'WRONG_TYPE')).toBe(true);
  });

  it('unknown 필드가 있는 항목 → EXTRA_FIELD', () => {
    const data: unknown[] = [
      ...makePositives(10),
      ...makeNegatives(9),
      { query: '새 질문', should_trigger: false, expected_skill: 'none', unknown_field: 'oops' },
    ];
    const r = validateTriggerEvalShape(data);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'EXTRA_FIELD')).toBe(true);
  });
});

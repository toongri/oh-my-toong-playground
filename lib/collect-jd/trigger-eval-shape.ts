export type TriggerEvalEntry = {
  query: string;
  should_trigger: boolean;
  expected_skill?: string;
};

export type ShapeErrorCode =
  | 'EMPTY_ARRAY'
  | 'POSITIVE_UNDER_MIN'
  | 'NEGATIVE_UNDER_MIN'
  | 'DUPLICATE_QUERY'
  | 'NEGATIVE_MISSING_EXPECTED_SKILL'
  | 'EXTRA_FIELD'
  | 'WRONG_TYPE';

export type ShapeValidationResult = {
  ok: boolean;
  errors: { code: ShapeErrorCode; message: string; index?: number }[];
};

const ALLOWED_FIELDS = new Set(['query', 'should_trigger', 'expected_skill']);
const MIN_POSITIVE = 10;
const MIN_NEGATIVE = 10;

export function validateTriggerEvalShape(data: unknown): ShapeValidationResult {
  const errors: ShapeValidationResult['errors'] = [];

  if (!Array.isArray(data)) {
    errors.push({ code: 'WRONG_TYPE', message: 'data must be an array' });
    return { ok: false, errors };
  }

  if (data.length === 0) {
    errors.push({ code: 'EMPTY_ARRAY', message: 'array must not be empty' });
    return { ok: false, errors };
  }

  const seenQueries = new Map<string, number>();
  let positiveCount = 0;
  let negativeCount = 0;

  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push({ code: 'WRONG_TYPE', message: `item at index ${i} must be an object`, index: i });
      continue;
    }

    const obj = item as Record<string, unknown>;

    // Check for extra fields
    for (const key of Object.keys(obj)) {
      if (!ALLOWED_FIELDS.has(key)) {
        errors.push({ code: 'EXTRA_FIELD', message: `unknown field "${key}" at index ${i}`, index: i });
      }
    }

    // Validate query
    if (typeof obj.query !== 'string') {
      errors.push({ code: 'WRONG_TYPE', message: `"query" at index ${i} must be a string`, index: i });
    } else {
      const normalizedQuery = obj.query.trim().toLowerCase();
      if (seenQueries.has(normalizedQuery)) {
        errors.push({
          code: 'DUPLICATE_QUERY',
          message: `duplicate query "${obj.query}" at index ${i} (first seen at index ${seenQueries.get(normalizedQuery)})`,
          index: i,
        });
      } else {
        seenQueries.set(normalizedQuery, i);
      }
    }

    // Validate should_trigger
    if (typeof obj.should_trigger !== 'boolean') {
      errors.push({ code: 'WRONG_TYPE', message: `"should_trigger" at index ${i} must be a boolean`, index: i });
      continue;
    }

    if (obj.should_trigger) {
      positiveCount++;
    } else {
      negativeCount++;

      // All false entries must have expected_skill field
      if (!Object.prototype.hasOwnProperty.call(obj, 'expected_skill')) {
        errors.push({
          code: 'NEGATIVE_MISSING_EXPECTED_SKILL',
          message: `"expected_skill" field missing at index ${i} (required for should_trigger=false entries)`,
          index: i,
        });
      } else if (typeof obj.expected_skill !== 'string') {
        errors.push({ code: 'WRONG_TYPE', message: `"expected_skill" at index ${i} must be a string`, index: i });
      }
    }
  }

  if (positiveCount < MIN_POSITIVE) {
    errors.push({
      code: 'POSITIVE_UNDER_MIN',
      message: `must have at least ${MIN_POSITIVE} entries with should_trigger=true, found ${positiveCount}`,
    });
  }

  if (negativeCount < MIN_NEGATIVE) {
    errors.push({
      code: 'NEGATIVE_UNDER_MIN',
      message: `must have at least ${MIN_NEGATIVE} entries with should_trigger=false, found ${negativeCount}`,
    });
  }

  return { ok: errors.length === 0, errors };
}

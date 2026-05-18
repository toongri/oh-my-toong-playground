/**
 * Unit tests for serializePin — multi-line attribute escape regression.
 *
 * P2 결함: free-text 필드에 raw newline 포함 시 YAML invalid.
 * serializePin은 모든 free-text 필드를 JSON.stringify로 escape해야 한다.
 */

import { describe, it, expect } from 'bun:test';
import { serializePin } from './index.ts';
import type { PinExtracted } from './types.ts';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the given YAML string has no unescaped newlines inside quoted attribute values. */
function hasNoUnescapedNewlineInValues(yaml: string): boolean {
  // Each frontmatter attribute line looks like: key: "value"
  // After JSON.stringify, embedded newlines appear as \n (2 chars), not real newlines.
  // We check: no line that starts with a YAML key contains a real newline mid-value.
  // Simple approach: every line in the frontmatter block between --- delimiters
  // that matches /^\w+: "/ must be a single physical line (end immediately with a closing quote).
  const lines = yaml.split('\n');
  const fmStart = lines.indexOf('---');
  const fmEnd = lines.indexOf('---', fmStart + 1);
  if (fmStart === -1 || fmEnd === -1) return false;

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  for (const line of fmLines) {
    // Each attribute line must start with key: " and end with "
    // (JSON.stringify wraps in double-quotes and escapes internal ones)
    if (/^\w+: "/.test(line) && !line.endsWith('"')) {
      // The value did not end on this line → unescaped newline leaked into YAML
      return false;
    }
  }
  return true;
}

/** Round-trip check: JSON.parse(`"${raw}"`) equals the raw string. */
function canRoundTrip(raw: string, jsonStringified: string): boolean {
  try {
    return JSON.parse(jsonStringified) === raw;
  } catch {
    return false;
  }
}

// ─── base fixture ─────────────────────────────────────────────────────────────

function makePin(overrides: Partial<PinExtracted> = {}): PinExtracted {
  return {
    slug: 'test-slug',
    source_url: 'src/foo.ts:10',
    authority: 'code',
    tier: 'L1',
    tags: 'foo,bar',
    sensitivity: 'private',
    body: '## 한 줄 요지\ntest body',
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('serializePin', () => {
  it('simple ASCII 필드 → 기존과 동일하게 double-quoted 출력', () => {
    const pin = makePin();
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(result).toContain('slug: "test-slug"');
    expect(result).toContain('source_url: "src/foo.ts:10"');
    expect(result).toContain('authority: "code"');
    expect(result).toContain('tier: "L1"');
    expect(result).toContain('tags: "foo,bar"');
    expect(result).toContain('sensitivity: "private"');
    expect(result).toContain('created_at: "2026-04-30T00:00:00.000Z"');
  });

  it('discovery_context에 raw newline 포함 → YAML에 unescaped newline 없음', () => {
    const pin = makePin({ discovery_context: 'line1\nline2' });
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    // Must not have an unescaped newline inside any quoted attribute value
    expect(hasNoUnescapedNewlineInValues(result)).toBe(true);

    // The escaped value must be round-trippable via JSON.parse
    const discoveryLine = result.split('\n').find((l) => l.startsWith('discovery_context:'));
    expect(discoveryLine).toBeDefined();
    const valueJson = discoveryLine!.replace(/^discovery_context: /, '');
    expect(canRoundTrip('line1\nline2', valueJson)).toBe(true);
  });

  it('source_url에 raw newline 포함 → YAML에 unescaped newline 없음', () => {
    const pin = makePin({ source_url: 'https://example.com\n/path' });
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(hasNoUnescapedNewlineInValues(result)).toBe(true);
  });

  it('authority에 raw newline 포함 → YAML에 unescaped newline 없음', () => {
    const pin = makePin({ authority: 'code\ninjected' });
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(hasNoUnescapedNewlineInValues(result)).toBe(true);
  });

  it('related에 raw newline 포함 → YAML에 unescaped newline 없음', () => {
    const pin = makePin({ related: 'slug-a\nslug-b' });
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(hasNoUnescapedNewlineInValues(result)).toBe(true);
  });

  it('optional 필드 없으면 해당 키가 출력에 없음', () => {
    const pin = makePin();
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(result).not.toContain('related:');
    expect(result).not.toContain('discovery_context:');
  });

  it('optional 필드 있으면 해당 키가 출력에 있음', () => {
    const pin = makePin({
      related: 'other-slug',
      discovery_context: 'some context',
    });
    const result = serializePin('test-slug', pin, '2026-04-30T00:00:00.000Z');

    expect(result).toContain('related: "other-slug"');
    expect(result).toContain('discovery_context: "some context"');
  });
});

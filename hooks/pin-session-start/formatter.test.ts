/**
 * Tests for pin-session-start formatter (AC-2).
 *
 * AC-2 key requirements:
 * - Output contains <pins>...</pins> wrapper
 * - Index line: "pins:N" for all counts (uniform format)
 * - Model 2 guidance lines with keywords: select-pin, write-pin
 * - Always non-empty (even count=0)
 * - Total output ≤80 words (token proxy)
 */

import { describe, it, expect } from 'bun:test';
import { formatPinsContext } from './formatter.ts';
import type { ScanResult } from './types.ts';

describe('formatPinsContext', () => {
  it('returns non-empty string with guidance when count is 0', () => {
    const result = formatPinsContext({ count: 0 });
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('pins:0');
    expect(result).toContain('select-pin');
    expect(result).toContain('write-pin');
  });

  it('contains <pins> wrapper tags', () => {
    const result = formatPinsContext({ count: 1 });
    expect(result).toContain('<pins>');
    expect(result).toContain('</pins>');
  });

  it('includes pins:N index line for normal count', () => {
    const result = formatPinsContext({ count: 2 });
    expect(result).toContain('pins:2');
  });

  it('includes pins:N index line for count above 30 without (>30) or recent:', () => {
    const result = formatPinsContext({ count: 31 });
    expect(result).toContain('pins:31');
    expect(result).not.toContain('(>30)');
    expect(result).not.toContain('recent:');
  });

  it('includes Model 2 guidance keywords (AC-2)', () => {
    const result = formatPinsContext({ count: 1 });
    expect(result).toContain('select-pin');
    expect(result).toContain('write-pin');
  });

  it('output is ≤80 words (AC-2 token budget)', () => {
    const result = formatPinsContext({ count: 3 });
    const wordCount = result.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(80);
  });
});

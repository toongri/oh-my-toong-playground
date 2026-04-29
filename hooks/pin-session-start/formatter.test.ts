/**
 * Tests for pin-session-start formatter (AC-2).
 *
 * AC-2 key requirements:
 * - Output contains <pins>...</pins> wrapper
 * - Index line: "pins:N | recent:slug1,slug2" (≤30) or "pins(>30)" (>30)
 * - Model 2 guidance 3 lines with keywords: select-pin, write-pin, supersedes
 * - Empty when 0 pins
 * - Total output ≤80 words (token proxy)
 */

import { describe, it, expect } from 'bun:test';
import { formatPinsContext } from './formatter.ts';
import type { ScanResult } from './types.ts';

describe('formatPinsContext', () => {
  it('returns empty string when count is 0', () => {
    const result = formatPinsContext({ count: 0, recentSlugs: [], truncated: false });
    expect(result).toBe('');
  });

  it('contains <pins> wrapper tags', () => {
    const result = formatPinsContext({ count: 1, recentSlugs: ['code-auth-jwt'], truncated: false });
    expect(result).toContain('<pins>');
    expect(result).toContain('</pins>');
  });

  it('includes pins:N | recent:slug format for ≤30 pins', () => {
    const result = formatPinsContext({
      count: 2,
      recentSlugs: ['code-auth-jwt', 'slack-deploy-rate'],
      truncated: false,
    });
    expect(result).toContain('pins:2');
    expect(result).toContain('recent:code-auth-jwt,slack-deploy-rate');
  });

  it('includes pins(>30) count only for truncated result', () => {
    const result = formatPinsContext({ count: 35, recentSlugs: [], truncated: true });
    expect(result).toContain('pins(>30)');
    expect(result).not.toContain('recent:');
  });

  it('includes all 3 Model 2 guidance keywords (AC-2)', () => {
    const result = formatPinsContext({ count: 1, recentSlugs: ['code-a-b'], truncated: false });
    expect(result).toContain('select-pin');
    expect(result).toContain('write-pin');
    expect(result).toContain('supersedes');
  });

  it('output is ≤80 words (AC-2 token budget)', () => {
    const result = formatPinsContext({
      count: 3,
      recentSlugs: ['code-auth-jwt', 'slack-ratelimit-api', 'notion-onboarding-docs'],
      truncated: false,
    });
    const wordCount = result.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(80);
  });
});

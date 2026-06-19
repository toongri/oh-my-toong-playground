/**
 * Tests for shouldApplyRule
 *
 * Covers: paths: glob hit/miss, globs: glob hit/miss,
 * alwaysApply override, and no globs defined.
 */

import { test, expect } from 'bun:test';
import { shouldApplyRule } from './matcher.ts';

// --- paths: field (merged into globs by parser; tested here via metadata.globs) ---

test('paths: glob hit — applies when current file matches the pattern', () => {
  const metadata = { globs: 'src/**/*.ts' };

  const result = shouldApplyRule(metadata, '/project/src/utils/helper.ts', '/project');

  expect(result.applies).toBe(true);
  expect(result.reason).toBe('glob: src/**/*.ts');
});

test('paths: glob miss — does not apply when file does not match pattern', () => {
  const metadata = { globs: 'src/**/*.ts' };

  const result = shouldApplyRule(metadata, '/project/docs/readme.md', '/project');

  expect(result.applies).toBe(false);
});

// --- globs: field ---

test('globs: hit — applies when current file matches one of the globs patterns', () => {
  const metadata = { globs: ['**/*.py', '**/*.js'] };

  const result = shouldApplyRule(metadata, '/project/scripts/run.py', '/project');

  expect(result.applies).toBe(true);
  expect(result.reason).toBe('glob: **/*.py');
});

test('globs: miss — does not apply when file matches none of the globs patterns', () => {
  const metadata = { globs: ['**/*.py', '**/*.js'] };

  const result = shouldApplyRule(metadata, '/project/config/settings.yaml', '/project');

  expect(result.applies).toBe(false);
});

// --- alwaysApply ---

test('alwaysApply: true overrides globs — applies even without matching pattern', () => {
  const metadata = { alwaysApply: true };

  const result = shouldApplyRule(metadata, '/project/anything.xyz', '/project');

  expect(result.applies).toBe(true);
  expect(result.reason).toBe('alwaysApply');
});

// --- no globs defined ---

test('no globs defined — does not apply', () => {
  const metadata = {};

  const result = shouldApplyRule(metadata, '/project/src/index.ts', '/project');

  expect(result.applies).toBe(false);
});

// --- null projectRoot ---

test('null projectRoot — uses absolute path for matching', () => {
  const metadata = { globs: '**/src/index.ts' };

  const result = shouldApplyRule(metadata, '/project/src/index.ts', null);

  expect(result.applies).toBe(true);
});

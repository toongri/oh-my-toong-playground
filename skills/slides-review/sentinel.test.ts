#!/usr/bin/env bun

/**
 * Sentinel regex contract test for slides-review.
 *
 * Asserts that:
 * 1. review.config.yaml declares review.multi_turn.deliverable_sentinel
 * 2. The regex matches the checked-in sample fixture
 */

import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

const CONFIG_PATH = path.resolve(import.meta.dirname, 'review.config.yaml');
const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '../../lib/agent-drivers/__fixtures__/sentinel/slides-review-sample.txt',
);

test('review.config.yaml has review.multi_turn.deliverable_sentinel', () => {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(raw) as Record<string, unknown>;

  const review = config['review'] as Record<string, unknown> | undefined;
  expect(review).toBeDefined();

  const multiTurn = review?.['multi_turn'] as Record<string, unknown> | undefined;
  expect(multiTurn).toBeDefined();

  const sentinel = multiTurn?.['deliverable_sentinel'];
  expect(typeof sentinel).toBe('string');
  expect((sentinel as string).length).toBeGreaterThan(0);
});

test('deliverable_sentinel regex matches slides-review-sample.txt', () => {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(raw) as Record<string, unknown>;

  const review = config['review'] as Record<string, unknown>;
  const multiTurn = review['multi_turn'] as Record<string, unknown>;
  const sentinelPattern = multiTurn['deliverable_sentinel'] as string;

  const sentinelRe = new RegExp(sentinelPattern);
  const sample = fs.readFileSync(FIXTURE_PATH, 'utf8');

  expect(sentinelRe.test(sample)).toBe(true);
});

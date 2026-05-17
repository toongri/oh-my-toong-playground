#!/usr/bin/env bun

/**
 * Sentinel regex contract test for agent-council.
 *
 * Asserts that:
 * 1. council.config.yaml declares council.multi_turn.deliverable_sentinel
 * 2. The regex matches the checked-in sample fixture
 */

import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

const CONFIG_PATH = path.resolve(import.meta.dirname, 'council.config.yaml');
const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '../../lib/agent-drivers/__fixtures__/sentinel/agent-council-sample.txt',
);

test('council.config.yaml has council.multi_turn.deliverable_sentinel', () => {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(raw) as Record<string, unknown>;

  const council = config['council'] as Record<string, unknown> | undefined;
  expect(council).toBeDefined();

  const multiTurn = council?.['multi_turn'] as Record<string, unknown> | undefined;
  expect(multiTurn).toBeDefined();

  const sentinel = multiTurn?.['deliverable_sentinel'];
  expect(typeof sentinel).toBe('string');
  expect((sentinel as string).length).toBeGreaterThan(0);
});

test('deliverable_sentinel regex matches agent-council-sample.txt', () => {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(raw) as Record<string, unknown>;

  const council = config['council'] as Record<string, unknown>;
  const multiTurn = council['multi_turn'] as Record<string, unknown>;
  const sentinelPattern = multiTurn['deliverable_sentinel'] as string;

  const sentinelRe = new RegExp(sentinelPattern);
  const sample = fs.readFileSync(FIXTURE_PATH, 'utf8');

  expect(sentinelRe.test(sample)).toBe(true);
});

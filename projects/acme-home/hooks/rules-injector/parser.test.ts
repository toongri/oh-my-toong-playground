/**
 * Tests for parseRuleFrontmatter
 *
 * Covers: valid frontmatter with paths/globs/alwaysApply,
 * missing frontmatter, and alwaysApply:true.
 */

import { test, expect } from 'bun:test';
import { parseRuleFrontmatter } from './parser.ts';

test('parses valid frontmatter with globs field', () => {
  const content = `---
globs: "**/*.ts"
---
Rule body here.`;

  const result = parseRuleFrontmatter(content);

  expect(result.metadata.globs).toBe('**/*.ts');
  expect(result.body).toBe('Rule body here.');
});

test('parses valid frontmatter with paths field (Claude Code alias for globs)', () => {
  const content = `---
paths: "src/**/*.py"
---
Python rule.`;

  const result = parseRuleFrontmatter(content);

  // paths merges into globs
  expect(result.metadata.globs).toBe('src/**/*.py');
  expect(result.body).toBe('Python rule.');
});

test('parses alwaysApply: true', () => {
  const content = `---
alwaysApply: true
---
Always apply this rule.`;

  const result = parseRuleFrontmatter(content);

  expect(result.metadata.alwaysApply).toBe(true);
  expect(result.body).toBe('Always apply this rule.');
});

test('parses alwaysApply: false', () => {
  const content = `---
alwaysApply: false
---
Not always.`;

  const result = parseRuleFrontmatter(content);

  expect(result.metadata.alwaysApply).toBe(false);
});

test('returns empty metadata and raw content when frontmatter is missing', () => {
  const content = 'No frontmatter here, just plain text.';

  const result = parseRuleFrontmatter(content);

  expect(result.metadata).toEqual({});
  expect(result.body).toBe(content);
});

test('returns empty metadata and raw content for empty string', () => {
  const result = parseRuleFrontmatter('');

  expect(result.metadata).toEqual({});
  expect(result.body).toBe('');
});

test('parses globs as inline array', () => {
  const content = `---
globs: ["**/*.ts", "**/*.tsx"]
---
TypeScript rule.`;

  const result = parseRuleFrontmatter(content);

  expect(result.metadata.globs).toEqual(['**/*.ts', '**/*.tsx']);
});

test('parses globs as multi-line YAML array', () => {
  const content = `---
globs:
  - "**/*.ts"
  - "src/**/*.js"
---
Multi-line rule.`;

  const result = parseRuleFrontmatter(content);

  expect(result.metadata.globs).toEqual(['**/*.ts', 'src/**/*.js']);
});

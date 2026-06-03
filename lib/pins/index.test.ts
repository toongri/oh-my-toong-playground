import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildIndex } from './index.ts';
import { serialize } from './entity.ts';
import type { Entity } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pins-index-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeEntity(id: string): Entity {
  return {
    frontmatter: {
      id,
      type: 'concept',
      source: 'notion',
      authority: 'test',
      source_url: 'https://example.com',
      tier: '2',
      tags: 'test',
      sensitivity: 'private',
      status: 'active',
      updated_at: '2024-01-01T00:00:00Z',
      checked_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      relations: [],
    },
    body: '## 무엇\n\ndef\n\n## 왜\n\nwhy\n\n## 어디서\n\nwhere\n\n## 관계\n\nnone',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildIndex', () => {
  test('id set equal', () => {
    const dir = makeTmpDir();
    const ids = ['pin-alpha', 'pin-beta', 'pin-gamma'];
    for (const id of ids) {
      writeFileSync(join(dir, `${id}.md`), serialize(makeEntity(id)));
    }

    const result = buildIndex(dir);

    expect(Object.keys(result.entries).sort()).toEqual(ids.sort());
  });

  test('id unique', () => {
    const dir = makeTmpDir();
    // Write two different files but with the same id — duplicate
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('dup-id')));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('dup-id')));

    const result = buildIndex(dir);

    // Only one entry survives (first-wins deterministic)
    const ids = Object.keys(result.entries);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
    // The duplicate is reported as a skip
    const dupSkip = result.skipped.find((s) => s.reason.includes('dup'));
    expect(dupSkip).toBeDefined();
  });

  test('legacy skip with reason', () => {
    const dir = makeTmpDir();
    // Write a file with no YAML frontmatter fences at all
    writeFileSync(join(dir, 'legacy.md'), 'Just plain text, no frontmatter.');

    const result = buildIndex(dir);

    expect(result.entries['legacy']).toBeUndefined();
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].file).toBe('legacy.md');
    expect(typeof result.skipped[0].reason).toBe('string');
    expect(result.skipped[0].reason.length).toBeGreaterThan(0);
  });

  test('bak excluded', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-real.md'), serialize(makeEntity('real-pin')));
    // .bak sibling — must NOT appear in index or skipped
    writeFileSync(join(dir, 'pin-real.md.bak'), serialize(makeEntity('bak-pin')));

    const result = buildIndex(dir);

    // Only real-pin in entries
    expect(Object.keys(result.entries)).toEqual(['real-pin']);
    // The .bak file must not appear in skipped list either
    const bakInSkipped = result.skipped.find((s) => s.file.endsWith('.bak'));
    expect(bakInSkipped).toBeUndefined();
  });

  test('rebuild idempotent', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-x.md'), serialize(makeEntity('pin-x')));
    writeFileSync(join(dir, 'pin-y.md'), serialize(makeEntity('pin-y')));

    const first = buildIndex(dir);
    const second = buildIndex(dir);

    expect(first).toEqual(second);
  });
});

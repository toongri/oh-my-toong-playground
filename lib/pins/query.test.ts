import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildIndex } from './index.ts';
import { serialize } from './entity.ts';
import type { Entity, EntityType, PinSource } from './types.ts';
import { query } from './query.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pins-query-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeEntity(
  id: string,
  overrides: { type?: EntityType; tags?: string; source?: PinSource } = {},
): Entity {
  return {
    frontmatter: {
      id,
      type: overrides.type ?? 'concept',
      source: overrides.source ?? 'notion',
      authority: 'test',
      source_url: 'https://example.com',
      tier: '2',
      tags: overrides.tags ?? 'general',
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

function writeIndexJson(dir: string): void {
  const idx = buildIndex(dir);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 2));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('query', () => {
  test('match with index — filter by type', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('pin-a', { type: 'code' })));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('pin-b', { type: 'doc' })));
    writeFileSync(join(dir, 'pin-c.md'), serialize(makeEntity('pin-c', { type: 'code' })));
    writeIndexJson(dir);

    const results = query(dir, { type: 'code' });

    expect(results.map((r) => r.frontmatter.id).sort()).toEqual(['pin-a', 'pin-c']);
  });

  test('match with index — filter by tag membership', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('pin-a', { tags: 'alpha,beta' })));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('pin-b', { tags: 'beta,gamma' })));
    writeFileSync(join(dir, 'pin-c.md'), serialize(makeEntity('pin-c', { tags: 'delta' })));
    writeIndexJson(dir);

    const results = query(dir, { tags: ['beta'] });

    expect(results.map((r) => r.frontmatter.id).sort()).toEqual(['pin-a', 'pin-b']);
  });

  test('match with index — filter by source', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('pin-a', { source: 'github' })));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('pin-b', { source: 'slack' })));
    writeFileSync(join(dir, 'pin-c.md'), serialize(makeEntity('pin-c', { source: 'github' })));
    writeIndexJson(dir);

    const results = query(dir, { source: 'github' });

    expect(results.map((r) => r.frontmatter.id).sort()).toEqual(['pin-a', 'pin-c']);
  });

  test('match with index — combined type + tags + source', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'pin-a.md'),
      serialize(makeEntity('pin-a', { type: 'code', tags: 'alpha,beta', source: 'github' })),
    );
    writeFileSync(
      join(dir, 'pin-b.md'),
      serialize(makeEntity('pin-b', { type: 'code', tags: 'alpha', source: 'slack' })),
    );
    writeFileSync(
      join(dir, 'pin-c.md'),
      serialize(makeEntity('pin-c', { type: 'doc', tags: 'alpha,beta', source: 'github' })),
    );
    writeIndexJson(dir);

    const results = query(dir, { type: 'code', tags: ['alpha'], source: 'github' });

    expect(results.map((r) => r.frontmatter.id)).toEqual(['pin-a']);
  });

  test('match with index — orphan pin with no relations is findable by type', () => {
    const dir = makeTmpDir();
    const orphan = makeEntity('orphan', { type: 'decision' });
    // Explicitly ensure no relations
    orphan.frontmatter.relations = [];
    writeFileSync(join(dir, 'orphan.md'), serialize(orphan));
    writeIndexJson(dir);

    const results = query(dir, { type: 'decision' });

    expect(results.map((r) => r.frontmatter.id)).toEqual(['orphan']);
  });

  test('fallback equals index — deleting index.json yields same result set', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('pin-a', { type: 'code', tags: 'x,y', source: 'github' })));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('pin-b', { type: 'doc', tags: 'y', source: 'notion' })));
    writeFileSync(join(dir, 'pin-c.md'), serialize(makeEntity('pin-c', { type: 'code', tags: 'x', source: 'slack' })));
    writeIndexJson(dir);

    const criteria = { type: 'code' as EntityType };
    const withIndex = query(dir, criteria);

    unlinkSync(join(dir, 'index.json'));
    const withoutIndex = query(dir, criteria);

    expect(withoutIndex.map((r) => r.frontmatter.id).sort()).toEqual(
      withIndex.map((r) => r.frontmatter.id).sort(),
    );
  });

  test('fallback equals index — tag filter without index', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pin-a.md'), serialize(makeEntity('pin-a', { tags: 'alpha,beta' })));
    writeFileSync(join(dir, 'pin-b.md'), serialize(makeEntity('pin-b', { tags: 'beta,gamma' })));
    writeFileSync(join(dir, 'pin-c.md'), serialize(makeEntity('pin-c', { tags: 'delta' })));
    writeIndexJson(dir);

    const criteria = { tags: ['beta'] };
    const withIndex = query(dir, criteria);

    unlinkSync(join(dir, 'index.json'));
    const withoutIndex = query(dir, criteria);

    expect(withoutIndex.map((r) => r.frontmatter.id).sort()).toEqual(
      withIndex.map((r) => r.frontmatter.id).sort(),
    );
  });
});

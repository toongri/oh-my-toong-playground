import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { serialize } from './entity.ts';
import type { Entity } from './types.ts';
import { supersede, hardDelete } from './lifecycle.ts';

function makeEntity(id: string): Entity {
  return {
    frontmatter: {
      id,
      type: 'concept',
      source: 'code',
      authority: 'test',
      source_url: 'https://example.com',
      tier: '2',
      tags: 'test',
      sensitivity: 'shared',
      status: 'active',
      updated_at: '2024-01-01T00:00:00Z',
      checked_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      relations: [],
    },
    body: 'test body',
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pins-lifecycle-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('supersede', () => {
  test('old superseded', async () => {
    const oldEntity = makeEntity('old-pin');
    const newEntity = makeEntity('new-pin');
    writeFileSync(join(dir, 'old-pin.md'), serialize(oldEntity));
    writeFileSync(join(dir, 'new-pin.md'), serialize(newEntity));

    await supersede('old-pin', 'new-pin', dir);

    const { parse } = await import('./entity.ts');
    const { readFileSync } = await import('fs');
    const updated = parse(readFileSync(join(dir, 'old-pin.md'), 'utf8'));
    expect(updated.frontmatter.status).toBe('superseded');
  });

  test('superseded_by created', async () => {
    const oldEntity = makeEntity('old-pin');
    const newEntity = makeEntity('new-pin');
    writeFileSync(join(dir, 'old-pin.md'), serialize(oldEntity));
    writeFileSync(join(dir, 'new-pin.md'), serialize(newEntity));

    await supersede('old-pin', 'new-pin', dir);

    const { parse } = await import('./entity.ts');
    const { readFileSync } = await import('fs');
    const updated = parse(readFileSync(join(dir, 'old-pin.md'), 'utf8'));
    const rel = updated.frontmatter.relations.find((r) => r.type === 'superseded_by');
    expect(rel).toBeDefined();
    expect(rel?.target).toBe('new-pin');
  });

  test('both preserved', async () => {
    const oldEntity = makeEntity('old-pin');
    const newEntity = makeEntity('new-pin');
    writeFileSync(join(dir, 'old-pin.md'), serialize(oldEntity));
    writeFileSync(join(dir, 'new-pin.md'), serialize(newEntity));

    await supersede('old-pin', 'new-pin', dir);

    expect(existsSync(join(dir, 'old-pin.md'))).toBe(true);
    expect(existsSync(join(dir, 'new-pin.md'))).toBe(true);
  });
});

describe('hardDelete', () => {
  test('delete requires flag', async () => {
    const entity = makeEntity('pin-to-delete');
    writeFileSync(join(dir, 'pin-to-delete.md'), serialize(entity));

    // Without force — file must remain
    await hardDelete('pin-to-delete', dir, {});
    expect(existsSync(join(dir, 'pin-to-delete.md'))).toBe(true);

    // With force — file must be removed
    await hardDelete('pin-to-delete', dir, { force: true });
    expect(existsSync(join(dir, 'pin-to-delete.md'))).toBe(false);
  });
});

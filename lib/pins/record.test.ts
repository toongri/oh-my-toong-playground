import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from './entity.ts';
import { record } from './record.ts';
import type { Entity } from './types.ts';

function makeEntity(overrides: Partial<Entity['frontmatter']> = {}): Entity {
  return {
    frontmatter: {
      id: 'code-hello-world',
      type: 'code',
      source: 'github',
      tier: '2',
      created_at: '2026-01-01T00:00:00Z',
      authority: 'toong',
      source_url: 'https://github.com/example',
      tags: 'backend',
      sensitivity: 'shared',
      status: 'active',
      updated_at: '2026-01-01T00:00:00Z',
      checked_at: '2026-01-01T00:00:00Z',
      relations: [],
      ...overrides,
    },
    body: '## 한 줄 요지\n\n본문\n\n## SSOT 위치\n\nhttps://github.com/example\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음',
  };
}

let tmpDir: string;
let location: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `pins-record-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  location = join(tmpDir, 'pins');
  mkdirSync(location, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('record', () => {
  test('record writes to manifest location', async () => {
    const entity = makeEntity();
    await record(entity, { location });

    const filePath = join(location, `${entity.frontmatter.id}.md`);
    expect(existsSync(filePath)).toBe(true);

    const contents = readFileSync(filePath, 'utf8');
    const parsed = parse(contents);
    // Re-validates that the written file is parseable and matches the entity
    expect(parsed.frontmatter.id).toBe(entity.frontmatter.id);
    expect(parsed.frontmatter.type).toBe(entity.frontmatter.type);
    expect(parsed.frontmatter.source).toBe(entity.frontmatter.source);
  });

  test('fresh defaults: new record has status=active, updated_at==created_at', async () => {
    // Entity without pre-set status/updated_at — record() must apply defaults
    const entity = makeEntity({
      status: undefined as any,
      updated_at: undefined as any,
    });
    await record(entity, { location });

    const filePath = join(location, `${entity.frontmatter.id}.md`);
    const contents = readFileSync(filePath, 'utf8');
    const parsed = parse(contents);

    expect(parsed.frontmatter.status).toBe('active');
    expect(parsed.frontmatter.updated_at).toBe(parsed.frontmatter.created_at);
  });

  test('update preserves created_at, bumps updated_at', async () => {
    const originalCreatedAt = '2026-01-01T00:00:00Z';
    const entity = makeEntity({ created_at: originalCreatedAt });

    // First write
    await record(entity, { location });

    // Simulate re-record with a later updated_at
    const laterUpdatedAt = '2026-06-01T12:00:00Z';
    const updatedEntity = makeEntity({
      created_at: originalCreatedAt,
      updated_at: laterUpdatedAt,
    });
    await record(updatedEntity, { location });

    const filePath = join(location, `${entity.frontmatter.id}.md`);
    const contents = readFileSync(filePath, 'utf8');
    const parsed = parse(contents);

    // created_at must be preserved from the original
    expect(parsed.frontmatter.created_at).toBe(originalCreatedAt);
    // updated_at must reflect the second write
    expect(parsed.frontmatter.updated_at).toBe(laterUpdatedAt);
  });

  test('invalid entity goes to escape log, no .md written', async () => {
    // Invalid: missing required field 'tier'
    const entity = makeEntity();
    delete (entity.frontmatter as any).tier;

    await record(entity, { location });

    // No .md file written
    const filePath = join(location, `${entity.frontmatter.id}.md`);
    expect(existsSync(filePath)).toBe(false);

    // Escape log must have been written
    const escapeLog = join(location, '.escape.jsonl');
    expect(existsSync(escapeLog)).toBe(true);

    const logContents = readFileSync(escapeLog, 'utf8').trim();
    expect(logContents.length).toBeGreaterThan(0);

    // Each line must be valid JSON
    const lines = logContents.split('\n');
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test('escape entry includes reason', async () => {
    // Invalid: missing required field 'tier' → validator returns reason='missing_field'
    const entity = makeEntity();
    delete (entity.frontmatter as any).tier;

    await record(entity, { location });

    // No .md file written for the invalid entity
    const filePath = join(location, `${entity.frontmatter.id}.md`);
    expect(existsSync(filePath)).toBe(false);

    // Escape log entry must include reason and non-empty message
    const escapeLog = join(location, '.escape.jsonl');
    const firstLine = readFileSync(escapeLog, 'utf8').trim().split('\n')[0];
    const entry = JSON.parse(firstLine);

    expect(entry.reason).toBe('missing_field');
    expect(typeof entry.message).toBe('string');
    expect(entry.message.length).toBeGreaterThan(0);
  });
});

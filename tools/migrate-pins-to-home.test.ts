import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateProject, formatDeleteBlock } from './migrate-pins-to-home.ts';
import type { MigrateSpec, MigrateResult } from './migrate-pins-to-home.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Writes a legacy slug-shaped .md pin (frontmatter `slug:`, NO `type:`).
 * This is the un-indexable orphan shape the migration tool activates.
 */
function writeLegacyPin(dir: string, filename: string, opts: {
  slug: string;
  created_at?: string;
  body?: string;
}): void {
  const {
    slug,
    created_at = '2025-01-15T10:00:00Z',
    body = '## 한 줄 요지\n\n요지\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음',
  } = opts;

  const content = [
    '---',
    `slug: ${slug}`,
    'source_url: https://example.com',
    'authority: someone',
    'tier: "2"',
    'tags: "test"',
    'sensitivity: shared',
    `created_at: ${created_at}`,
    '---',
    '',
    body,
    '',
  ].join('\n');

  writeFileSync(join(dir, filename), content, 'utf8');
}

/** Counts canonical .md pins (excludes .bak and dotfiles), matching buildIndex's filter. */
function countMdPins(dir: string): number {
  return readdirSync(dir).filter(
    (f) => f.endsWith('.md') && !f.endsWith('.bak') && !f.startsWith('.'),
  ).length;
}

/** Returns the sorted set of .bak filenames in a dir. */
function bakFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.bak')).sort();
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let sourceDir: string;
let targetHome: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `migrate-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sourceDir = join(tmpDir, 'source-pins');
  targetHome = join(tmpDir, 'target-home');
  mkdirSync(sourceDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function baseSpec(overrides: Partial<MigrateSpec> = {}): MigrateSpec {
  return {
    name: 'test-project',
    sourcePinsDir: sourceDir,
    targetHome,
    expectedCount: 2,
    ...overrides,
  };
}

// ── AC7.1: idempotent re-run ──────────────────────────────────────────────────

describe('AC7.1 idempotent re-run', () => {
  test('second migrateProject run is a no-op (no extra .bak, stable counts)', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-doc.md', { slug: 'notion-auth-doc' });
    writeLegacyPin(sourceDir, 'code-foo-bar.md', { slug: 'code-foo-bar' });

    const first = await migrateProject(baseSpec());
    expect(first.verified).toBe(true);

    const countAfterFirst = countMdPins(targetHome);
    const baksAfterFirst = bakFiles(targetHome);
    expect(countAfterFirst).toBe(2);
    // One .bak per converted (slug->id) file is EXPECTED, not a violation.
    expect(baksAfterFirst.length).toBe(2);

    const second = await migrateProject(baseSpec());
    expect(second.verified).toBe(true);

    // No additional .bak, no duplicate canonical files, no .bak.bak.
    expect(countMdPins(targetHome)).toBe(countAfterFirst);
    expect(bakFiles(targetHome)).toEqual(baksAfterFirst);
    expect(existsSync(join(targetHome, 'notion-auth-doc.md.bak.bak'))).toBe(false);
  });
});

// ── AC7.2: verify-failure leaves source intact (tool deletes nothing) ─────────

describe('AC7.2 verify-failure leaves source intact', () => {
  test('count mismatch reports failure and never deletes the source', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-doc.md', { slug: 'notion-auth-doc' });
    writeLegacyPin(sourceDir, 'code-foo-bar.md', { slug: 'code-foo-bar' });

    // expectedCount intentionally wrong (real fixture has 2).
    const spec = baseSpec({ expectedCount: 99 });

    // Verify failure must surface: either throw, or return verified:false.
    // It must NOT silently report success.
    let outcome: 'threw' | MigrateResult;
    try {
      outcome = await migrateProject(spec);
    } catch {
      outcome = 'threw';
    }
    if (outcome !== 'threw') {
      expect(outcome.verified).toBe(false);
    }

    // SOURCE dir and its files remain fully present — the tool deleted nothing.
    expect(existsSync(sourceDir)).toBe(true);
    expect(existsSync(join(sourceDir, 'notion-auth-doc.md'))).toBe(true);
    expect(existsSync(join(sourceDir, 'code-foo-bar.md'))).toBe(true);
  });
});

// ── AC5.5: skips cruft (.cursor.json / .escape.jsonl / source .bak) ──────────

describe('AC5.5 skips cruft during relocation', () => {
  test('cruft is not relocated; target .bak from conversion is reader-excluded', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-doc.md', { slug: 'notion-auth-doc' });
    writeLegacyPin(sourceDir, 'code-foo-bar.md', { slug: 'code-foo-bar' });
    // Cruft that must NOT be relocated to the target.
    writeFileSync(join(sourceDir, '.cursor.json'), '{}', 'utf8');
    writeFileSync(join(sourceDir, '.escape.jsonl'), '{}\n', 'utf8');
    writeFileSync(join(sourceDir, 'old.md.bak'), 'stale legacy bak', 'utf8');

    const result = await migrateProject(baseSpec());
    expect(result.verified).toBe(true);

    // Cruft was NOT copied into target.
    expect(existsSync(join(targetHome, '.cursor.json'))).toBe(false);
    expect(existsSync(join(targetHome, '.escape.jsonl'))).toBe(false);
    expect(existsSync(join(targetHome, 'old.md.bak'))).toBe(false);

    // The source .bak's content never leaked in as a canonical pin.
    expect(existsSync(join(targetHome, 'old.md'))).toBe(false);

    // buildIndex count is unaffected by target .bak files produced by conversion.
    expect(countMdPins(targetHome)).toBe(2);
  });
});

// ── manifest co-located + scope/git preservation ─────────────────────────────

describe('manifest write', () => {
  test('co-located manifest defaults to scope:private, git:false when no source manifest', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-doc.md', { slug: 'notion-auth-doc' });
    writeLegacyPin(sourceDir, 'code-foo-bar.md', { slug: 'code-foo-bar' });

    const result = await migrateProject(baseSpec());
    expect(result.verified).toBe(true);

    const manifestPath = join(targetHome, 'pins.yaml');
    expect(existsSync(manifestPath)).toBe(true);
    const { parse: parseYaml } = await import('yaml');
    const { readFileSync } = await import('fs');
    const obj = parseYaml(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(obj.location).toBe(targetHome);
    expect(obj.scope).toBe('private');
    expect(obj.git).toBe(false);
  });

  test('preserves scope/git from source manifest when present', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-doc.md', { slug: 'notion-auth-doc' });
    writeLegacyPin(sourceDir, 'code-foo-bar.md', { slug: 'code-foo-bar' });
    const sourceManifest = join(tmpDir, 'source-pins.yaml');
    writeFileSync(
      sourceManifest,
      'location: /old/path\nscope: shared\ngit: true\n',
      'utf8',
    );

    const result = await migrateProject(baseSpec({ sourceManifest }));
    expect(result.verified).toBe(true);

    const { parse: parseYaml } = await import('yaml');
    const { readFileSync } = await import('fs');
    const obj = parseYaml(readFileSync(join(targetHome, 'pins.yaml'), 'utf8')) as Record<string, unknown>;
    // location rewritten to the new home, scope/git preserved from source.
    expect(obj.location).toBe(targetHome);
    expect(obj.scope).toBe('shared');
    expect(obj.git).toBe(true);
  });
});

// ── collision pair: distinct ids survive (count proof) ───────────────────────

describe('collision pair distinct ids preserved', () => {
  test('same-slug pair keeps distinct ids; count stays 2, skipped is 0', async () => {
    writeLegacyPin(sourceDir, 'notion-auth-foo.md', {
      slug: 'notion-auth-foo',
      body: '## 한 줄 요지\n\nBODY-A\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음',
    });
    writeLegacyPin(sourceDir, 'notion-auth-foo-143022.md', {
      slug: 'notion-auth-foo',
      body: '## 한 줄 요지\n\nBODY-B\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음',
    });

    const result = await migrateProject(baseSpec({ expectedCount: 2 }));
    expect(result.verified).toBe(true);

    // Both distinct canonical files present (no collapse-to-slug).
    expect(existsSync(join(targetHome, 'notion-auth-foo.md'))).toBe(true);
    expect(existsSync(join(targetHome, 'notion-auth-foo-143022.md'))).toBe(true);
    expect(countMdPins(targetHome)).toBe(2);
  });
});

// ── formatDeleteBlock: verbatim, keyed on verified stale paths ────────────────

describe('formatDeleteBlock', () => {
  test('emits rm -r lines keyed on the exact verified source paths', () => {
    const results: MigrateResult[] = [
      {
        name: 'proj-a',
        verified: true,
        actualCount: 2,
        expectedCount: 2,
        stalePaths: ['/home/u/.omt/proj-a/pins', '/home/u/.omt/proj-a/pins.yaml'],
      },
      {
        name: 'proj-b',
        verified: true,
        actualCount: 8,
        expectedCount: 8,
        stalePaths: ['/home/u/.omt/proj-b/pins'],
      },
    ];

    const block = formatDeleteBlock(results);

    expect(block).toContain("rm -r '/home/u/.omt/proj-a/pins'");
    expect(block).toContain("rm -r '/home/u/.omt/proj-a/pins.yaml'");
    expect(block).toContain("rm -r '/home/u/.omt/proj-b/pins'");
  });

  test('excludes stale paths of unverified projects (delete cannot diverge from verified set)', () => {
    const results: MigrateResult[] = [
      {
        name: 'good',
        verified: true,
        actualCount: 2,
        expectedCount: 2,
        stalePaths: ['/home/u/.omt/good/pins'],
      },
      {
        name: 'bad',
        verified: false,
        actualCount: 1,
        expectedCount: 2,
        stalePaths: ['/home/u/.omt/bad/pins'],
      },
    ];

    const block = formatDeleteBlock(results);

    expect(block).toContain("rm -r '/home/u/.omt/good/pins'");
    expect(block).not.toContain('/home/u/.omt/bad/pins');
  });
});

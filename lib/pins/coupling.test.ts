/**
 * 3-way coupling test: schema (tbox.yaml) ↔ serializer (entity.ts) ↔ record SKILL.md
 *
 * Leg 1 (schema ↔ serializer): tbox body_sections match what entity.serialize() emits.
 * Leg 2 (schema ↔ serializer): tbox closure enums match Frontmatter type values.
 * Leg 3 (schema ↔ SKILL.md):   GUARDED — only asserted when skills/record/SKILL.md exists.
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadTbox } from './tbox-loader.ts';
import { serialize } from './entity.ts';
import type { Entity } from './types.ts';

// A full canonical entity covering all sections and enum values.
const FULL_ENTITY: Entity = {
  frontmatter: {
    id: 'code-hello-world',
    type: 'code',
    source: 'github',
    authority: 'toong',
    source_url: 'https://github.com/example',
    tier: '1',
    tags: 'backend',
    sensitivity: 'shared',
    status: 'active',
    updated_at: '2026-01-01T00:00:00Z',
    checked_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    relations: [],
  },
  body: [
    '## 한 줄 요지',
    '',
    '본문',
    '',
    '## SSOT 위치',
    '',
    'https://github.com/example',
    '',
    '## 전후 컨텍스트',
    '',
    '컨텍스트',
    '',
    '## 관련 cross-link',
    '',
    '없음',
  ].join('\n'),
};

describe('3-way coupling', () => {
  // ── Leg 1: tbox.body_sections ↔ entity.serialize() ──────────────────────────

  test('tbox body_sections are all present in serialized entity body', async () => {
    const tbox = await loadTbox();
    const serialized = serialize(FULL_ENTITY);

    for (const section of tbox.body_sections) {
      // Each body_section header must appear as a ## header in the serialized markdown.
      expect(serialized).toContain(`## ${section}`);
    }
  });

  test('tbox body_sections count matches sections in fixture body', async () => {
    const tbox = await loadTbox();
    // The fixture body has exactly the same sections as tbox.body_sections
    const sectionMatches = (FULL_ENTITY.body.match(/^## /gm) ?? []).length;
    expect(sectionMatches).toBe(tbox.body_sections.length);
  });

  // ── Leg 2: tbox enums ↔ entity.ts types ─────────────────────────────────────

  test('tbox status enum matches PinStatus values used by serializer', async () => {
    const tbox = await loadTbox();

    // All PinStatus values used by entity.ts are in tbox
    const knownStatuses: string[] = ['active', 'superseded', 'stale'];
    for (const status of knownStatuses) {
      expect(tbox.enums.status).toContain(status);
    }
    // tbox has exactly these statuses (no drift)
    expect(tbox.enums.status.length).toBe(knownStatuses.length);
  });

  test('tbox sensitivity enum matches Sensitivity values used by serializer', async () => {
    const tbox = await loadTbox();
    const knownSensitivities: string[] = ['private', 'shared'];
    for (const s of knownSensitivities) {
      expect(tbox.enums.sensitivity).toContain(s);
    }
    expect(tbox.enums.sensitivity.length).toBe(knownSensitivities.length);
  });

  test('tbox tier enum matches Tier values used by serializer', async () => {
    const tbox = await loadTbox();
    const knownTiers: string[] = ['1', '2', '3'];
    for (const t of knownTiers) {
      expect(tbox.enums.tier).toContain(t);
    }
    expect(tbox.enums.tier.length).toBe(knownTiers.length);
  });

  test('tbox source enum matches PinSource values used by serializer', async () => {
    const tbox = await loadTbox();
    const knownSources: string[] = ['jira', 'linear', 'slack', 'github', 'notion', 'code', 'person', 'url'];
    for (const s of knownSources) {
      expect(tbox.enums.source).toContain(s);
    }
    expect(tbox.enums.source.length).toBe(knownSources.length);
  });

  // ── Leg 3: tbox ↔ skills/record/SKILL.md (GUARDED) ──────────────────────────
  // This leg only asserts when the file exists.
  // It passes harmlessly until T14 lands and creates the SKILL.md.

  test('SKILL.md documents same body_section headers and enum values (guarded)', async () => {
    const skillPath = join(
      import.meta.dir,
      '../../skills/record/SKILL.md',
    );

    if (!existsSync(skillPath)) {
      // SKILL.md not yet authored — skip this leg.
      console.log('[coupling] skills/record/SKILL.md not found — leg 3 skipped (T14 pending)');
      return;
    }

    const tbox = await loadTbox();
    const skillContent = readFileSync(skillPath, 'utf8');

    // All body_sections must be mentioned in the SKILL.md
    for (const section of tbox.body_sections) {
      expect(skillContent).toContain(section);
    }

    // All status enum values must be mentioned in the SKILL.md
    for (const status of tbox.enums.status) {
      expect(skillContent).toContain(status);
    }
  });
});

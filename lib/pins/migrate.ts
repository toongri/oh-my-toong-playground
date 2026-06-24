/**
 * One-shot, idempotent migration of legacy pin .md files to canonical entities.
 *
 * For each .md file in the target dir:
 *   1. If the frontmatter already has `type` → canonical; skip.
 *   2. Otherwise (legacy): write a .bak sibling, convert via toCanonical, set
 *      checked_at = created_at, then record the canonical entity.
 *
 * Idempotency: already-migrated detection = frontmatter contains `type`.
 * Re-running produces no .bak, no re-write for already-migrated files.
 *
 * Does NOT modify live ~/.omt data — the target dir is parameterized.
 */

import { readdirSync, copyFileSync, existsSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { toCanonical } from './compat.ts';
import { record } from './record.ts';
import type { Entity, Frontmatter } from './types.ts';
import type { FrontmatterSchema } from './legacy-types';

export interface MigrateOptions {
  /** The pins directory to scan (manifest-resolved location). */
  location: string;
}

/**
 * Migrate all legacy .md pins in `location` to canonical shape.
 *
 * Legacy detection: frontmatter has `slug` and NO `type`.
 * Each legacy file gets a .bak sibling written before the canonical rewrite.
 */
export async function migrate(options: MigrateOptions): Promise<void> {
  const { location } = options;

  const entries = readdirSync(location);

  for (const entry of entries) {
    // Only process .md files; skip .bak, .jsonl, etc.
    if (extname(entry) !== '.md') continue;

    // Skip dotfiles — matches buildIndex's !f.startsWith('.') policy.
    if (entry.startsWith('.')) continue;

    const filePath = join(location, entry);
    const content = readFileSync(filePath, 'utf8');

    // Isolate per-file parse errors so a malformed file cannot abort the run.
    let raw: Record<string, unknown> | null;
    try {
      raw = parseFrontmatterRaw(content);
    } catch {
      continue;
    }
    if (raw === null) continue;

    // If `type` is present, this is already canonical — skip.
    if (raw.type !== undefined) continue;

    // Legacy file: must have `slug`.
    if (typeof raw.slug !== 'string') continue;

    const legacy = raw as unknown as FrontmatterSchema;

    // 1. Write .bak sibling (original legacy content preserved).
    const bakPath = join(location, `${entry}.bak`);
    if (!existsSync(bakPath)) {
      copyFileSync(filePath, bakPath);
    }

    // 2. Convert legacy → canonical via compat reader (sets id = slug).
    const compat = toCanonical(legacy);

    // 2b. Collision id-derivation: when this file's stem carries the legacy
    //     collision suffix (`{slug}-HHMMSS` or `{slug}-HHMMSS-N`, produced by
    //     the write-time counter retry), same-slug legacy files would all
    //     collapse to id = slug and overwrite one another. Override the id with
    //     the stem VERBATIM so each lands in its own canonical file.
    const stem = basename(entry, '.md');
    const collisionShape = new RegExp(`^${escapeRegExp(legacy.slug)}-\\d{6}(-\\d+)?$`);
    if (collisionShape.test(stem)) {
      compat.id = stem;
    }

    // 3. Build the Entity: set checked_at = created_at (migration default).
    const frontmatter: Frontmatter = {
      ...(compat as unknown as Frontmatter),
      status: 'active',
      updated_at: compat.created_at,
      checked_at: compat.created_at,
    };

    // Preserve body from original file (strip frontmatter block).
    const body = extractBody(content);

    const entity: Entity = { frontmatter, body };

    // 4. Write canonical via record() (handles validation + atomic write).
    await record(entity, { location });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escapes regex-significant characters so a slug can be interpolated literally
 * into the collision-shape pattern.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the raw YAML frontmatter object from a .md file.
 * Returns null if the file doesn't start with a `---` fence.
 */
function parseFrontmatterRaw(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const raw = Bun.YAML.parse(match[1]);
  if (raw === null || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}

/**
 * Extracts the body (everything after the frontmatter block).
 * Strips any leading blank lines that may follow the closing --- fence.
 */
function extractBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*?)\n?$/);
  if (!match) return '';
  return match[1];
}

/**
 * Query pins by type, tags, and/or source.
 *
 * PRIMARY path: reads index.json from pinsDir if present (avoids re-scanning).
 * FALLBACK path: if index.json is absent, calls buildIndex() in-memory — yields
 * an identical result set to the index path.
 *
 * Relation traversal is NOT the primary path; orphan pins with no relations
 * remain findable by type/tags/source.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { buildIndex } from './index.ts';
import type { EntityType, Frontmatter, PinSource } from './types.ts';

export interface QueryCriteria {
  /** Filter to entries whose frontmatter.type equals this value. */
  type?: EntityType;
  /** Filter to entries whose tags CSV contains ALL of the listed tags. */
  tags?: string[];
  /** Filter to entries whose frontmatter.source equals this value. */
  source?: PinSource;
}

export interface QueryResult {
  id: string;
  frontmatter: Frontmatter;
}

/**
 * Returns all pins in pinsDir that match every criterion supplied.
 * Omitting a criterion means "no restriction on that field".
 *
 * Uses index.json when present; falls back to dir-scan otherwise.
 */
export function query(pinsDir: string, criteria: QueryCriteria): QueryResult[] {
  const results = loadResults(pinsDir);
  return results.filter((r) => matches(r.frontmatter, criteria));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadResults(pinsDir: string): QueryResult[] {
  // PRIMARY: read persisted index.json
  const indexPath = join(pinsDir, 'index.json');
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const idx = JSON.parse(raw) as { entries: Record<string, { id: string; frontmatter: Frontmatter }> };
    return Object.values(idx.entries).map((e) => ({ id: e.id, frontmatter: e.frontmatter }));
  } catch {
    // index.json absent or unreadable — fall through to dir-scan
  }

  // FALLBACK: build in-memory index (same logic as index.ts)
  const built = buildIndex(pinsDir);
  return Object.values(built.entries).map((e) => ({ id: e.id, frontmatter: e.frontmatter }));
}

function matches(fm: Frontmatter, criteria: QueryCriteria): boolean {
  if (criteria.type !== undefined && fm.type !== criteria.type) return false;
  if (criteria.source !== undefined && fm.source !== criteria.source) return false;
  if (criteria.tags !== undefined && criteria.tags.length > 0) {
    const pinTags = fm.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const required of criteria.tags) {
      if (!pinTags.includes(required)) return false;
    }
  }
  return true;
}

/**
 * Query pins by type, tags, and/or source.
 *
 * Scans pinsDir in-memory via buildIndex() on every call. Orphan pins with
 * no relations remain findable by type/tags/source.
 */

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
 */
export function query(pinsDir: string, criteria: QueryCriteria): QueryResult[] {
  const built = buildIndex(pinsDir);
  const results = Object.values(built.entries).map((e) => ({ id: e.id, frontmatter: e.frontmatter }));
  return results.filter((r) => matches(r.frontmatter, criteria));
}

function matches(fm: Frontmatter, criteria: QueryCriteria): boolean {
  if (criteria.type !== undefined && fm.type !== criteria.type) return false;
  if (criteria.source !== undefined && fm.source !== criteria.source) return false;
  if (criteria.tags !== undefined && criteria.tags.length > 0) {
    const pinTags = (fm.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const required of criteria.tags) {
      if (!pinTags.includes(required)) return false;
    }
  }
  return true;
}

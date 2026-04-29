/**
 * Scanner for $OMT_DIR/pins/ directory (AC-1.6, AC-2).
 *
 * Returns count of .md pins, up to 3 recent slug names, and truncated flag.
 * >30 pins: count only, no slug list (AC-2 ≤80 token limit).
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ScanResult } from './types.ts';

const RECENT_SLUG_LIMIT = 3;
const COUNT_ONLY_THRESHOLD = 30;

/**
 * Scan $OMT_DIR/pins/ for .md files.
 * Returns { count, recentSlugs (up to 3 if ≤30 total), truncated }.
 * Fails open (returns empty result) if directory is unreadable.
 */
export function scanPins(omtDir: string): ScanResult {
  const pinsDir = join(omtDir, 'pins');
  try {
    const entries = readdirSync(pinsDir);
    const mdFiles = entries
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .sort((a, b) => {
        // Sort by mtime descending (most recently modified first)
        try {
          const ma = statSync(join(pinsDir, a)).mtime.getTime();
          const mb = statSync(join(pinsDir, b)).mtime.getTime();
          return mb - ma;
        } catch {
          return 0;
        }
      });

    const count = mdFiles.length;

    if (count === 0) {
      return { count: 0, recentSlugs: [], truncated: false };
    }

    if (count > COUNT_ONLY_THRESHOLD) {
      // AC-2: too many pins — emit count only to stay ≤80 tokens
      return { count, recentSlugs: [], truncated: true };
    }

    // Strip .md extension to get slug names
    const recentSlugs = mdFiles
      .slice(0, RECENT_SLUG_LIMIT)
      .map((f) => f.replace(/\.md$/, ''));

    return { count, recentSlugs, truncated: false };
  } catch {
    // Directory missing or unreadable — fail-open
    return { count: 0, recentSlugs: [], truncated: false };
  }
}

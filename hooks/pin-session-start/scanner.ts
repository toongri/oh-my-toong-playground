/**
 * Scanner for $OMT_DIR/pins/ directory (AC-1.6, AC-2).
 *
 * Returns count of .md pins.
 */

import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ScanResult } from './types.ts';

/**
 * Scan $OMT_DIR/pins/ for .md files.
 * Returns { count }.
 * Fails open (returns empty result) if directory is unreadable.
 * On directory absence: if omtDir exists, attempts to create pins/ once (swallows failure).
 */
export function scanPins(omtDir: string): ScanResult {
  const pinsDir = join(omtDir, 'pins');
  try {
    const entries = readdirSync(pinsDir);
    const count = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.')).length;
    return { count };
  } catch {
    // Directory missing or unreadable — fail-open
    // Self-heal: create pins/ if omtDir exists (typo guard: skip if omtDir itself is absent)
    if (existsSync(omtDir)) {
      try {
        mkdirSync(pinsDir, { recursive: true });
      } catch {
        // swallow — fail-open preserved
      }
    }
    return { count: 0 };
  }
}

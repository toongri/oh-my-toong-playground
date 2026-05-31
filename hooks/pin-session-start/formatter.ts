/**
 * Formatter for pin-session-start hook output (AC-2, T16).
 *
 * Two modes:
 *   - absent: passive setup suggestion — no count, no index, just invites setup
 *   - present: compact index summary (id/type/tags, capped) + Model 2 guidance
 *
 * Total output bounded to avoid unbounded context injection.
 */

import type { PinsIndex } from '../../lib/pins/index.ts';

const MODEL2_LINES = [
  'Need context: invoke query to retrieve pins',
  'Acquired info worth pinning? Record it via record (or /wrap-up for whole-session review)',
];

/** Cap for how many index entries to include inline. */
const MAX_INLINE_ENTRIES = 10;

/**
 * Build additionalContext for the absent-manifest case.
 * Passive — no file/dir creation, just a setup invitation.
 */
export function formatAbsentContext(): string {
  const lines = [
    '<pins>',
    'No pins.yaml manifest found — pins knowledge graph not configured.',
    'To set up: invoke setup to initialize pins for this project.',
    ...MODEL2_LINES,
    '</pins>',
  ];
  return lines.join('\n');
}

/**
 * Build additionalContext for the manifest-resolved case.
 * Includes a compact index summary (id, type, tags) capped at MAX_INLINE_ENTRIES.
 */
export function formatIndexContext(index: PinsIndex): string {
  const ids = Object.keys(index.entries);
  const total = ids.length;

  const summaryLines: string[] = [`pins:${total}`];

  const shown = ids.slice(0, MAX_INLINE_ENTRIES);
  for (const id of shown) {
    const entry = index.entries[id];
    const fm = entry.frontmatter;
    const tags = fm.tags ?? '';
    summaryLines.push(`  ${id} [${fm.type}]${tags ? ` tags:${tags}` : ''}`);
  }

  if (total > MAX_INLINE_ENTRIES) {
    summaryLines.push(`  … and ${total - MAX_INLINE_ENTRIES} more`);
  }

  const lines = [
    '<pins>',
    ...summaryLines,
    ...MODEL2_LINES,
    '</pins>',
  ];

  return lines.join('\n');
}

/**
 * Formatter for pin-session-start hook output (AC-2, T16).
 *
 * Two modes:
 *   - absent: passive setup suggestion — no count, no index, just invites setup
 *   - present: single count+location line + Model 2 guidance (no per-entry listing)
 *
 * Total output bounded to avoid unbounded context injection.
 */

import type { PinsIndex } from '@lib/pins/index';
import type { PinsManifest } from '@lib/pins/manifest';

const MODEL2_LINES = [
  'Need context: invoke pin-query to retrieve pins',
  'Acquired info worth pinning? Record it via pin-record (or /pin-wrap-up for whole-session review)',
];

/**
 * Build additionalContext for the absent-manifest case.
 * Passive — no file/dir creation, just a setup invitation.
 */
export function formatAbsentContext(): string {
  const lines = [
    '<pins>',
    'No pins.yaml manifest found — pins knowledge graph not configured.',
    'To set up: invoke pin-setup to initialize pins for this project.',
    ...MODEL2_LINES,
    '</pins>',
  ];
  return lines.join('\n');
}

/**
 * Build additionalContext for the manifest-resolved case.
 * Includes pin count and manifest scope + location on a single line.
 * No per-entry listing — Claude retrieves entries via pin-query when needed.
 */
export function formatIndexContext(index: PinsIndex, settings: PinsManifest): string {
  const total = Object.keys(index.entries).length;

  const lines = [
    '<pins>',
    `pins:${total} (scope:${settings.scope} location:${settings.location})`,
    ...MODEL2_LINES,
  ];
  if (settings.git) {
    lines.push('git-managed: commit pin file changes after recording');
  }
  lines.push('</pins>');

  return lines.join('\n');
}

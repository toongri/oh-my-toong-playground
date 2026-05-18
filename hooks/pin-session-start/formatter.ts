/**
 * Formatter for pin-session-start hook output (AC-2).
 *
 * Output format (within <pins>...</pins> XML wrapper):
 *   <pins>
 *   pins:N
 *   Need context: invoke select-pin first
 *   Acquired info worth finding again later? You MUST emit a <pin> immediately via write-pin
 *   </pins>
 *
 * All counts (0, 1..N) produce the same block. Total output ≤80 tokens (AC-2).
 */

import type { ScanResult } from './types.ts';

const MODEL2_LINES = [
  'Need context: invoke select-pin first',
  'Acquired info worth finding again later? You MUST emit a <pin> immediately via write-pin',
];

/**
 * Build the additionalContext string for hookSpecificOutput.
 */
export function formatPinsContext(result: ScanResult): string {
  const indexLine = `pins:${result.count}`;

  const lines = [
    '<pins>',
    indexLine,
    ...MODEL2_LINES,
    '</pins>',
  ];

  return lines.join('\n');
}

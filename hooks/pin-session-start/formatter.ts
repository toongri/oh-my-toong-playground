/**
 * Formatter for pin-session-start hook output (AC-2).
 *
 * Output format (within <pins>...</pins> XML wrapper):
 *   <pins>
 *   pins:N
 *   컨텍스트 필요 시: 우선 select-pin 스킬 invoke
 *   발견·갱신 시: write-pin 스킬 invoke로 <pin> XML 형식 학습 후 emit
 *   잘못된 indexing: write-pin supersedes 갱신
 *   </pins>
 *
 * All counts (0, 1..N) produce the same block. Total output ≤80 tokens (AC-2).
 */

import type { ScanResult } from './types.ts';

const MODEL2_LINES = [
  '컨텍스트 필요 시: 우선 select-pin 스킬 invoke',
  '발견·갱신 시: write-pin 스킬 invoke로 <pin> XML 형식 학습 후 emit',
  '잘못된 indexing: write-pin supersedes 갱신',
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

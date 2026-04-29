/**
 * Formatter for pin-session-start hook output (AC-2).
 *
 * Output format (within <pins>...</pins> XML wrapper):
 *   <pins>
 *   pins:N | recent:slug1,slug2,slug3
 *   컨텍스트 필요 시: 우선 select-pin 스킬 invoke
 *   발견·갱신 시: write-pin 스킬 invoke로 <pin> XML 형식 학습 후 emit
 *   잘못된 indexing: write-pin supersedes 갱신
 *   </pins>
 *
 * >30 pins: `pins(>30)` — count only, no slug list.
 * 0 pins: returns empty string (no output, AC-2: don't inflate token count).
 * Total output ≤80 tokens (AC-2).
 */

import type { ScanResult } from './types.ts';

const MODEL2_LINES = [
  '컨텍스트 필요 시: 우선 select-pin 스킬 invoke',
  '발견·갱신 시: write-pin 스킬 invoke로 <pin> XML 형식 학습 후 emit',
  '잘못된 indexing: write-pin supersedes 갱신',
];

/**
 * Build the additionalContext string for hookSpecificOutput.
 * Returns empty string when there are no pins (no output to surface).
 */
export function formatPinsContext(result: ScanResult): string {
  if (result.count === 0) {
    return '';
  }

  const indexLine = result.truncated
    ? `pins(>${result.count > 30 ? '30' : result.count})`
    : `pins:${result.count} | recent:${result.recentSlugs.join(',')}`;

  const lines = [
    '<pins>',
    indexLine,
    ...MODEL2_LINES,
    '</pins>',
  ];

  return lines.join('\n');
}

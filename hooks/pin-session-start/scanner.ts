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
    // 1단계: filter
    const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));

    const count = mdFiles.length;

    if (count === 0) {
      return { count: 0, recentSlugs: [], truncated: false };
    }

    // 2단계: count > 30이면 sort 없이 즉시 반환 (AC-2: ≤80 token 제한)
    if (count > COUNT_ONLY_THRESHOLD) {
      return { count, recentSlugs: [], truncated: true };
    }

    // 3단계: Schwartzian transform — 파일당 statSync 1회만 호출
    const recentSlugs = mdFiles
      .map((f) => {
        // 디코레이션: mtime 캐시 (실패 시 0으로 fail-open)
        let m = 0;
        try {
          m = statSync(join(pinsDir, f)).mtime.getTime();
        } catch {
          // stat 실패 시 mtime=0 (정렬 후미로 밀림)
        }
        return { f, m };
      })
      .sort((a, b) => b.m - a.m) // mtime 내림차순 (최근 수정 파일 먼저)
      .slice(0, RECENT_SLUG_LIMIT)
      .map(({ f }) => f.replace(/\.md$/, '')); // 디코레이션 해제 + .md 제거

    return { count, recentSlugs, truncated: false };
  } catch {
    // Directory missing or unreadable — fail-open
    return { count: 0, recentSlugs: [], truncated: false };
  }
}

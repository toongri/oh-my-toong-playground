/**
 * Unit tests for writePinAtomically (atomic wx-flag create + counter retry).
 *
 * RED phase: these tests are written before the implementation exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, readdir, readFile } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writePinAtomically } from './index.ts';

describe('writePinAtomically', () => {
  let testDir: string;
  let omtDir: string;
  let pinsDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), 'pin-atomic-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    omtDir = join(testDir, 'omt');
    pinsDir = join(omtDir, 'pins');
    await mkdir(pinsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('새 slug → 기본 경로에 파일 생성', async () => {
    writePinAtomically(omtDir, 'my-slug', 'content-here');

    expect(existsSync(join(pinsDir, 'my-slug.md'))).toBe(true);
    const content = await readFile(join(pinsDir, 'my-slug.md'), 'utf-8');
    expect(content).toBe('content-here');
  });

  it('이미 존재하는 slug → HHMMSS-counter suffix 파일 생성, 원본 보존', async () => {
    // Pre-create the base file to simulate collision
    writeFileSync(join(pinsDir, 'dup-slug.md'), 'original-content', 'utf-8');

    writePinAtomically(omtDir, 'dup-slug', 'new-content');

    // Original must still exist with original content
    const original = await readFile(join(pinsDir, 'dup-slug.md'), 'utf-8');
    expect(original).toBe('original-content');

    // A second file with suffix must exist
    const files = await readdir(pinsDir);
    const dupFiles = files.filter((f) => f.startsWith('dup-slug') && f.endsWith('.md'));
    expect(dupFiles.length).toBe(2);

    // The suffix file has the new content
    const suffixFile = dupFiles.find((f) => f !== 'dup-slug.md')!;
    const suffixContent = await readFile(join(pinsDir, suffixFile), 'utf-8');
    expect(suffixContent).toBe('new-content');

    // Suffix matches pattern: dup-slug-HHMMSS-N.md or dup-slug-HHMMSS.md
    expect(suffixFile).toMatch(/^dup-slug-\d{6}(-\d+)?\.md$/);
  });

  it('base + HHMMSS 모두 존재 → counter 증가하여 유니크 파일 생성', async () => {
    // Pre-create base and a timestamp variant to force counter increment
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const hhmmss = `${hh}${mm}${ss}`;

    writeFileSync(join(pinsDir, 'counter-slug.md'), 'base', 'utf-8');
    writeFileSync(join(pinsDir, `counter-slug-${hhmmss}.md`), 'suffix-0', 'utf-8');

    writePinAtomically(omtDir, 'counter-slug', 'counter-content');

    const files = await readdir(pinsDir);
    const counterFiles = files.filter((f) => f.startsWith('counter-slug') && f.endsWith('.md'));
    // Should now have 3 files: base, HHMMSS, HHMMSS-N
    expect(counterFiles.length).toBe(3);
  });

  it('1000회 exhaustion → 에러 throw', async () => {
    // Pre-create base + HHMMSS + counter 0..999 to exhaust all slots
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const hhmmss = `${hh}${mm}${ss}`;

    writeFileSync(join(pinsDir, 'exhaust-slug.md'), 'base', 'utf-8');
    writeFileSync(join(pinsDir, `exhaust-slug-${hhmmss}.md`), 'ts', 'utf-8');
    for (let i = 1; i < 1000; i++) {
      writeFileSync(join(pinsDir, `exhaust-slug-${hhmmss}-${i}.md`), `counter-${i}`, 'utf-8');
    }

    expect(() => writePinAtomically(omtDir, 'exhaust-slug', 'overflow')).toThrow(
      /failed to find unique filename for slug exhaust-slug/,
    );
  });
});

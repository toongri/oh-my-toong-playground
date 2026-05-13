/**
 * pin-up Stop hook entrypoint (AC-1.5).
 *
 * 8-step flow:
 * 1. Read stdin → parse HookInput
 * 2. Resolve $OMT_DIR
 * 3. Load cursor state
 * 4. Scan transcript JSONL from byte_offset
 * 5. Validate each extracted pin
 * 6. Write passing pins to $OMT_DIR/pins/{slug}.md
 * 7. Save cursor state
 * 8. JSON stdout {continue: true}
 *
 * Fail-open: any unhandled error → {continue: true} + stderr WARN (AC-4, persistent-mode:51-58 pattern).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import type { HookInput, HookOutput, PinExtracted } from './types.ts';
import { loadCursor, saveCursor, getCursorEntry } from './cursor.ts';
import { scanTranscript } from './extractor.ts';
import { validatePin } from './validator.ts';
import { appendEscapeEntry } from './escape-log.ts';

// ─── OMT_DIR resolver ─────────────────────────────────────────────────────────
// Stop hook runs in a fresh process and CLAUDE_ENV_FILE may not be loaded yet,
// so resolve OMT_DIR independently — same convention as session-start.sh /
// keyword-detector.sh / resume-forge-start.sh.
const OMT_DIR_LIB_SH = join(import.meta.dir, '..', 'lib', 'omt-dir.sh');

function resolveOmtDir(cwd: string): string {
  const envValue = process.env.OMT_DIR;
  if (envValue) return envValue;
  try {
    const stdout = execFileSync(
      'bash',
      ['-c', `source "${OMT_DIR_LIB_SH}" && resolve_omt_dir "$1"`, '--', cwd],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: process.env as NodeJS.ProcessEnv },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

// ─── stdin helpers ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function parseInput(raw: string): HookInput {
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return { transcript_path: '' };
  }
}

// ─── Frontmatter serialization ────────────────────────────────────────────────

/**
 * Serialize a pin to $OMT_DIR/pins/{slug}.md with frontmatter + body.
 * created_at is added here (not in XML — not author-controlled).
 */
export function serializePin(
  slug: string,
  pin: PinExtracted,
  createdAt: string,
): string {

  const lines: string[] = ['---'];
  lines.push(`slug: ${JSON.stringify(slug)}`);
  lines.push(`source_url: ${JSON.stringify(pin.source_url)}`);
  lines.push(`authority: ${JSON.stringify(pin.authority)}`);
  lines.push(`tier: ${JSON.stringify(pin.tier)}`);
  lines.push(`tags: ${JSON.stringify(pin.tags)}`);
  lines.push(`sensitivity: ${JSON.stringify(pin.sensitivity)}`);
  lines.push(`created_at: ${JSON.stringify(createdAt)}`);
  if (pin.related) lines.push(`related: ${JSON.stringify(pin.related)}`);
  if (pin.supersedes) lines.push(`supersedes: ${JSON.stringify(pin.supersedes)}`);
  if (pin.discovery_context) lines.push(`discovery_context: ${JSON.stringify(pin.discovery_context)}`);
  lines.push('---');
  lines.push('');
  lines.push(pin.body);
  lines.push('');

  return lines.join('\n');
}

// ─── Atomic pin write (wx flag + counter retry) ───────────────────────────────

/**
 * Atomically create a pin file using the O_EXCL (wx) flag.
 *
 * - 1st attempt: {slug}.md
 * - EEXIST → retry with {slug}-HHMMSS.md, then {slug}-HHMMSS-1.md .. {slug}-HHMMSS-999.md
 * - 1000 exhausted → throw Error
 *
 * @param clock Optional clock provider (default: () => new Date()). Injected in tests
 *              to avoid wall-clock second-boundary flakes.
 */
export function writePinAtomically(
  omtDir: string,
  slug: string,
  content: string,
  clock: () => Date = () => new Date(),
): void {
  const pinsDir = join(omtDir, 'pins');
  const basePath = join(pinsDir, `${slug}.md`);

  // 1st attempt: base path (no suffix)
  try {
    writeFileSync(basePath, content, { flag: 'wx', encoding: 'utf-8' });
    return;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // EEXIST: build timestamp suffix and retry with monotonic counter
  const now = clock();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const hhmmss = `${hh}${mm}${ss}`;

  // counter=0 → {slug}-HHMMSS.md; counter=1..999 → {slug}-HHMMSS-{counter}.md
  for (let counter = 0; counter < 1000; counter++) {
    const suffix = counter === 0 ? `${slug}-${hhmmss}.md` : `${slug}-${hhmmss}-${counter}.md`;
    const candidatePath = join(pinsDir, suffix);
    try {
      writeFileSync(candidatePath, content, { flag: 'wx', encoding: 'utf-8' });
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  throw new Error(`failed to find unique filename for slug ${slug}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  try {
    // Step 1: stdin → parse
    const rawInput = await readStdin();
    const input = parseInput(rawInput);

    const sessionId = input.sessionId || input.session_id || 'unknown';
    const transcriptPath = input.transcript_path
      ? resolve(input.transcript_path)
      : '';

    // Step 2: resolve OMT_DIR (self-compute when env unset — Stop hook runs in
    // a fresh process and CLAUDE_ENV_FILE may not be loaded by the harness)
    const omtDir = resolveOmtDir(input.cwd ?? process.cwd());
    if (!omtDir) {
      process.stderr.write('[pin-up] WARN: OMT_DIR resolution failed — skipping pin extraction\n');
      console.log('{"continue": true}');
      return;
    }

    if (!transcriptPath) {
      process.stderr.write('[pin-up] WARN: transcript_path not provided — skipping\n');
      console.log('{"continue": true}');
      return;
    }

    // Ensure pins/ directory exists
    const pinsDir = join(omtDir, 'pins');
    mkdirSync(pinsDir, { recursive: true });

    // Step 3: load cursor
    const cursor = loadCursor(omtDir);
    const cursorEntry = getCursorEntry(cursor, transcriptPath);
    const startOffset = cursorEntry?.byte_offset ?? 0;

    // Step 4: scan transcript JSONL
    const { pins: extractedPins, finalByteOffset, lastUuid } = await scanTranscript(
      transcriptPath,
      startOffset,
    );

    // Steps 5+6: validate + write
    const createdAt = new Date().toISOString();

    // Pre-pass: collect all valid slugs in this batch for forward-reference resolution
    const batchSlugs = new Set<string>(
      extractedPins.map((p) => p.slug).filter(Boolean),
    );

    for (const pin of extractedPins) {
      const validationResult = validatePin(pin, omtDir, batchSlugs);

      if (!validationResult.valid) {
        // Append to escape log (AC-14)
        appendEscapeEntry(
          omtDir,
          sessionId,
          validationResult.reason ?? 'unknown',
          pin.slug || null,
          JSON.stringify(pin),
        );
        continue;
      }

      // Write pin file atomically (wx flag + counter retry — AC-7, TOCTOU-safe)
      const content = serializePin(pin.slug, pin, createdAt);
      try {
        writePinAtomically(omtDir, pin.slug, content);
      } catch (writeErr: unknown) {
        const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        process.stderr.write(`[pin-up] WARN: skipping pin "${pin.slug}" — ${msg}\n`);
        // write 실패도 audit trail에 기록 (P1-4)
        appendEscapeEntry(omtDir, sessionId, 'write_failed', pin.slug || null, JSON.stringify(pin));
      }
    }

    // Step 7: save cursor (transcript 진행이 있을 때 저장)
    // — write 실패가 있어도 cursor 진행 (P1-2)
    if (finalByteOffset > startOffset || lastUuid) {
      saveCursor(omtDir, { transcriptPath, byteOffset: finalByteOffset, lastUuid });
    }

    // Step 8: JSON stdout
    const output: HookOutput = { continue: true };
    console.log(JSON.stringify(output));
  } catch (error) {
    // Fail-open (AC-4, persistent-mode:51-58 pattern)
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pin-up] ERROR: ${msg}\n`);
    console.log('{"continue": true}');
  }
}

// Run when executed directly
if (import.meta.main) {
  main();
}

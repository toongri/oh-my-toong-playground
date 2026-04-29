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

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { HookInput, HookOutput, PinExtracted } from './types.ts';
import { loadCursor, saveCursor, getCursorEntry, updateCursorEntry } from './cursor.ts';
import { scanTranscript } from './extractor.ts';
import { validatePin } from './validator.ts';
import { appendEscapeEntry } from './escape-log.ts';

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
function serializePin(
  slug: string,
  pin: PinExtracted,
  createdAt: string,
): string {

  const lines: string[] = ['---'];
  lines.push(`slug: "${slug}"`);
  lines.push(`source_url: "${pin.source_url}"`);
  lines.push(`authority: "${pin.authority}"`);
  lines.push(`tier: "${pin.tier}"`);
  lines.push(`tags: "${pin.tags}"`);
  lines.push(`sensitivity: "${pin.sensitivity}"`);
  lines.push(`created_at: "${createdAt}"`);
  if (pin.related) lines.push(`related: "${pin.related}"`);
  if (pin.supersedes) lines.push(`supersedes: "${pin.supersedes}"`);
  if (pin.discovery_context) lines.push(`discovery_context: "${pin.discovery_context}"`);
  lines.push('---');
  lines.push('');
  lines.push(pin.body);
  lines.push('');

  return lines.join('\n');
}

// ─── Slug → filename (duplicate → timestamp suffix) ──────────────────────────

function slugToFilename(omtDir: string, slug: string): string {
  const base = join(omtDir, 'pins', `${slug}.md`);
  if (!existsSync(base)) return base;

  // Duplicate: append HHMMSS timestamp suffix (AC-7)
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return join(omtDir, 'pins', `${slug}-${hh}${mm}${ss}.md`);
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

    // Step 2: resolve OMT_DIR (AC-4: fail-open if missing)
    const omtDir = process.env.OMT_DIR || '';
    if (!omtDir) {
      process.stderr.write('[pin-up] WARN: OMT_DIR not set — skipping pin extraction\n');
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
    let newCursor = cursor;
    const createdAt = new Date().toISOString();

    for (const pin of extractedPins) {
      const validationResult = validatePin(pin, omtDir);

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

      // Write pin file (AC-7: duplicate → timestamp suffix)
      const filePath = slugToFilename(omtDir, pin.slug);
      const content = serializePin(pin.slug, pin, createdAt);
      writeFileSync(filePath, content, 'utf-8');
    }

    // Step 7: save cursor (only when transcript was readable)
    if (finalByteOffset > startOffset || lastUuid) {
      newCursor = updateCursorEntry(cursor, transcriptPath, finalByteOffset, lastUuid);
      saveCursor(omtDir, newCursor);
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

/**
 * Transcript JSONL → <pin> extraction (AC-3, AC-3a, AC-5).
 *
 * Scans main session JSONL line by line.
 * Extracts from: assistant events, message.content[].type=='text'.text only.
 * Skips: thinking, tool_use, redacted_thinking content items.
 * subagents/ walk is v2 — main JSONL only.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { resolve } from 'path';
import type { PinExtracted } from './types.ts';

// Greedy regex: <pin[^>]*>([\s\S]*?)</pin>
const PIN_REGEX = /<pin\s+([^>]*)>([\s\S]*?)<\/pin>/g;

// Attribute extraction regex
const ATTR_REGEX = /(\w+)="([^"]*)"/g;

interface TranscriptEntry {
  type?: string;
  uuid?: string;
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
}

export interface ExtractionResult {
  pins: PinExtracted[];
  finalByteOffset: number;
  lastUuid: string;
}

/**
 * Parse a <pin> XML block into structured PinExtracted.
 * Returns null if required attributes are missing.
 */
export function parsePinXml(attrsStr: string, body: string): PinExtracted | null {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;

  // Reset lastIndex to avoid state issues with global regex
  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(attrsStr)) !== null) {
    attrs[match[1]] = match[2];
  }

  // Required fields (AC-6)
  const required = ['slug', 'source_url', 'authority', 'tier', 'tags', 'sensitivity'];
  for (const field of required) {
    if (!attrs[field]) return null;
  }

  return {
    slug: attrs['slug'],
    source_url: attrs['source_url'],
    authority: attrs['authority'],
    tier: attrs['tier'],
    tags: attrs['tags'],
    sensitivity: attrs['sensitivity'] as 'private' | 'shared',
    related: attrs['related'] || undefined,
    supersedes: attrs['supersedes'] || undefined,
    discovery_context: attrs['discovery_context'] || undefined,
    body: body.trim(),
  };
}

/**
 * Extract text content from assistant message entries only.
 * Skips thinking, tool_use, redacted_thinking items (AC-3a).
 */
function extractTextFromEntry(entry: TranscriptEntry): string[] {
  if (entry.type !== 'assistant') return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];

  return content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string);
}

/**
 * Extract all <pin> blocks from a text string.
 */
export function extractPinsFromText(text: string): PinExtracted[] {
  const pins: PinExtracted[] = [];
  const regex = /<pin\s+([^>]*)>([\s\S]*?)<\/pin>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const parsed = parsePinXml(match[1], match[2]);
    if (parsed) pins.push(parsed);
  }

  return pins;
}

/**
 * Scan transcript JSONL from a given byte offset.
 * Returns extracted pins, final byte offset, and last seen UUID.
 *
 * AC-3a: only assistant.message.content[].type=='text'.text is scanned.
 * subagents/ walk is v2.
 */
export async function scanTranscript(
  transcriptPath: string,
  startByteOffset: number,
): Promise<ExtractionResult> {
  const normalizedPath = resolve(transcriptPath);
  const pins: PinExtracted[] = [];
  let finalByteOffset = startByteOffset;
  let lastUuid = '';
  let currentOffset = 0;

  try {
    const fileStream = createReadStream(normalizedPath, { start: startByteOffset });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
      currentOffset += lineBytes;

      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptEntry;

        if (entry.uuid) {
          lastUuid = entry.uuid;
        }

        const texts = extractTextFromEntry(entry);
        for (const text of texts) {
          const extracted = extractPinsFromText(text);
          pins.push(...extracted);
        }
      } catch {
        // Skip malformed lines
      }
    }

    finalByteOffset = startByteOffset + currentOffset;
  } catch {
    // File not readable — return empty result with original offset
  }

  return {
    pins,
    finalByteOffset,
    lastUuid,
  };
}

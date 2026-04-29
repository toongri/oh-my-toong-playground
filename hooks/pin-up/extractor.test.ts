/**
 * Tests for transcript extractor (AC-3, AC-3a, AC-5).
 *
 * Fixture cases (AC-3a):
 *   F1. main-text-with-pin: assistant.message.content[{type:'text'}] → 1 pin extracted
 *   F2. thinking-with-pin: content[{type:'thinking'}] → 0 pins extracted (skipped)
 *   F3. tool_use-with-pin: content[{type:'tool_use'}] → 0 pins extracted (skipped)
 *
 * Robustness cases (AC-5):
 *   R1. Multi-line body in <pin>
 *   R2. Attribute order variation
 *   R3. Empty body <pin>
 *   R4. Missing required attribute → parsePinXml returns null
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parsePinXml, extractPinsFromText, scanTranscript } from './extractor.ts';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeAssistantEntry(text: string, uuid = 'uuid-001'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: {
      content: [{ type: 'text', text }],
    },
  });
}

function makeThinkingEntry(thinkingText: string, uuid = 'uuid-002'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: {
      content: [{ type: 'thinking', thinking: thinkingText }],
    },
  });
}

function makeToolUseEntry(toolName: string, inputText: string, uuid = 'uuid-003'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: {
      content: [{ type: 'tool_use', name: toolName, input: { text: inputText } }],
    },
  });
}

const VALID_PIN = `<pin slug="code-auth-jwt" source_url="auth/jwt.ts:142" authority="code" tier="L1" tags="auth,jwt" sensitivity="private">
## 한 줄 요지
verifyToken 함수가 auth 권위

## SSOT 위치
auth/jwt.ts:142

## 전후 컨텍스트
OAuth 리팩토링 중 발견

## 관련 cross-link
없음
</pin>`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parsePinXml', () => {
  it('parses valid attrs and body', () => {
    const result = parsePinXml(
      'slug="test-pin-slug" source_url="https://x.com" authority="code" tier="L1" tags="a,b" sensitivity="private"',
      'body text',
    );
    expect(result).not.toBeNull();
    expect(result?.slug).toBe('test-pin-slug');
    expect(result?.source_url).toBe('https://x.com');
    expect(result?.body).toBe('body text');
  });

  it('returns null when required field is missing', () => {
    // Missing sensitivity
    const result = parsePinXml(
      'slug="test-pin" source_url="x" authority="code" tier="L1" tags="a"',
      'body',
    );
    expect(result).toBeNull();
  });

  it('captures optional related and discovery_context', () => {
    const result = parsePinXml(
      'slug="code-a-b" source_url="x" authority="code" tier="L1" tags="t" sensitivity="private" related="other-pin-c" discovery_context="context note"',
      'body',
    );
    expect(result?.related).toBe('other-pin-c');
    expect(result?.discovery_context).toBe('context note');
  });
});

describe('extractPinsFromText', () => {
  it('extracts a valid pin from text', () => {
    const pins = extractPinsFromText(VALID_PIN);
    expect(pins).toHaveLength(1);
    expect(pins[0].slug).toBe('code-auth-jwt');
  });

  it('extracts multiple pins from same text', () => {
    const text = VALID_PIN + '\n\n' + VALID_PIN.replace('code-auth-jwt', 'code-auth-refresh');
    const pins = extractPinsFromText(text);
    expect(pins).toHaveLength(2);
  });

  it('handles multi-line body (AC-5 R1)', () => {
    const pins = extractPinsFromText(VALID_PIN);
    expect(pins[0].body).toContain('한 줄 요지');
    expect(pins[0].body).toContain('전후 컨텍스트');
  });

  it('handles attribute order variation (AC-5 R2)', () => {
    // Different attribute order than standard
    const text = `<pin sensitivity="private" tier="L1" slug="code-b-c" tags="t" authority="code" source_url="x">body</pin>`;
    const pins = extractPinsFromText(text);
    expect(pins).toHaveLength(1);
    expect(pins[0].slug).toBe('code-b-c');
  });

  it('handles empty body gracefully (AC-5 R3)', () => {
    const text = `<pin slug="code-x-y" source_url="x" authority="code" tier="L1" tags="t" sensitivity="private"></pin>`;
    const pins = extractPinsFromText(text);
    expect(pins).toHaveLength(1);
    expect(pins[0].body).toBe('');
  });

  it('returns empty array when no pins in text', () => {
    expect(extractPinsFromText('no pins here')).toHaveLength(0);
  });
});

describe('scanTranscript', () => {
  const testDir = join(tmpdir(), 'pin-up-extractor-test-' + Date.now());

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('F1: extracts pin from assistant text entry', async () => {
    const filePath = join(testDir, 'f1.jsonl');
    await writeFile(filePath, makeAssistantEntry(VALID_PIN) + '\n', 'utf-8');

    const result = await scanTranscript(filePath, 0);
    expect(result.pins).toHaveLength(1);
    expect(result.pins[0].slug).toBe('code-auth-jwt');
    expect(result.finalByteOffset).toBeGreaterThan(0);
  });

  it('F2: skips thinking content entries (AC-3a)', async () => {
    const filePath = join(testDir, 'f2.jsonl');
    await writeFile(filePath, makeThinkingEntry(VALID_PIN) + '\n', 'utf-8');

    const result = await scanTranscript(filePath, 0);
    expect(result.pins).toHaveLength(0);
  });

  it('F3: skips tool_use content entries (AC-3a)', async () => {
    const filePath = join(testDir, 'f3.jsonl');
    await writeFile(filePath, makeToolUseEntry('read', VALID_PIN) + '\n', 'utf-8');

    const result = await scanTranscript(filePath, 0);
    expect(result.pins).toHaveLength(0);
  });

  it('returns empty result for nonexistent file', async () => {
    const result = await scanTranscript('/nonexistent/path.jsonl', 0);
    expect(result.pins).toHaveLength(0);
    expect(result.finalByteOffset).toBe(0);
  });

  it('respects startByteOffset — skips already-scanned lines', async () => {
    const line1 = makeAssistantEntry(VALID_PIN, 'uuid-1');
    const line2 = makeAssistantEntry(VALID_PIN.replace('code-auth-jwt', 'code-auth-refresh'), 'uuid-2');
    const filePath = join(testDir, 'cursor-offset.jsonl');
    await writeFile(filePath, line1 + '\n' + line2 + '\n', 'utf-8');

    // Scan all first
    const first = await scanTranscript(filePath, 0);
    expect(first.pins).toHaveLength(2);

    // Now start from where we left off — should get 0 new pins
    const second = await scanTranscript(filePath, first.finalByteOffset);
    expect(second.pins).toHaveLength(0);
  });

  it('captures lastUuid from assistant entries', async () => {
    const filePath = join(testDir, 'uuid-capture.jsonl');
    await writeFile(filePath, makeAssistantEntry('hello', 'uuid-xyz') + '\n', 'utf-8');

    const result = await scanTranscript(filePath, 0);
    expect(result.lastUuid).toBe('uuid-xyz');
  });
});

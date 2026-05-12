/**
 * SKILL contract spec: enforces orchestrate-review §"Worker Output Contract".
 *
 * The chairman (chunk-reviewer) assumes each reviewer's `output.txt` contains
 * the final answer text only. The script layer (worker.ts post-processing
 * via worker-utils.extractFinal) is responsible for enforcing that shape
 * regardless of which CLI produced the raw stream. This file is the
 * executable assertion of that contract — if a new CLI is registered without
 * an extraction path, these tests fail.
 */

import { describe, test, expect } from 'bun:test';
import { extractFinal } from '@lib/worker-utils';

const CONTRACT_MAX_BYTES = 50_000;
const REGISTERED_CLIS = ['opencode', 'codex', 'claude', 'gemini', 'raw'] as const;

function makeOpencodeProductionFixture(finalText: string, noiseEvents = 500): string {
  const lines: string[] = [];
  for (let i = 0; i < noiseEvents; i++) {
    lines.push(JSON.stringify({
      type: 'step_start',
      timestamp: 1778562000000 + i,
      sessionID: 'ses_realistic',
      part: { id: `prt_${i}`, type: 'step-start', snapshot: 'a'.repeat(40) },
    }));
    lines.push(JSON.stringify({
      type: 'tool_use',
      timestamp: 1778562001000 + i,
      part: { id: `prt_tool_${i}`, type: 'tool-use', tool: 'bash', input: { command: 'x'.repeat(80) } },
    }));
    lines.push(JSON.stringify({
      type: 'step_finish',
      timestamp: 1778562002000 + i,
      part: { id: `prt_fin_${i}`, type: 'step-finish', tokens: { input: 1000, output: 200 } },
    }));
  }
  lines.push(JSON.stringify({
    type: 'text',
    timestamp: 1778562999999,
    sessionID: 'ses_realistic',
    part: { id: 'prt_final', type: 'text', text: finalText },
  }));
  return lines.join('\n');
}

describe('Worker Output Contract — orchestrate-review/SKILL.md §Worker Output Contract', () => {
  test('opencode: production-sized raw stream is reduced to final answer only', () => {
    const finalText = '### Chunk Analysis\n\n- Verdict: ready to merge: no\n- Reason: P0 issue at lib/x.ts:42';
    const rawStream = makeOpencodeProductionFixture(finalText, 500);

    expect(rawStream.length).toBeGreaterThan(CONTRACT_MAX_BYTES);

    const finalized = extractFinal('opencode', { stdout: rawStream });

    expect(finalized.length).toBeLessThan(CONTRACT_MAX_BYTES);
    expect(finalized).not.toContain('step_start');
    expect(finalized).not.toContain('step_finish');
    expect(finalized).not.toContain('tool_use');
    expect(finalized).toContain('Chunk Analysis');
    expect(finalized).toContain('Verdict');
  });

  test('contract registration: every supported CLI has a non-throwing extract path', () => {
    for (const cli of REGISTERED_CLIS) {
      expect(() => extractFinal(cli, { stdout: '' })).not.toThrow();
    }
  });

  test('opencode: 1.3MB-class bloat ratio collapses to single-digit KB output', () => {
    const finalText = 'A'.repeat(8_000);
    const rawStream = makeOpencodeProductionFixture(finalText, 1500);

    expect(rawStream.length).toBeGreaterThan(500_000);

    const finalized = extractFinal('opencode', { stdout: rawStream });
    const bloatRatio = rawStream.length / Math.max(finalized.length, 1);

    expect(finalized.length).toBeLessThan(30_000);
    expect(bloatRatio).toBeGreaterThan(15);
  });

  test('claude/gemini: single-result JSON shape preserved end-to-end', () => {
    const claudeOut = extractFinal('claude', {
      stdout: JSON.stringify({ type: 'result', subtype: 'success', result: 'claude final answer' }),
    });
    expect(claudeOut).toBe('claude final answer');
    expect(claudeOut.length).toBeLessThan(CONTRACT_MAX_BYTES);

    const geminiOut = extractFinal('gemini', {
      stdout: JSON.stringify({ session_id: 'x', response: 'gemini final answer' }),
    });
    expect(geminiOut).toBe('gemini final answer');
    expect(geminiOut.length).toBeLessThan(CONTRACT_MAX_BYTES);
  });
});

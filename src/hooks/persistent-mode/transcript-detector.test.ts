import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import {
  detectCompletionPromise,
  detectOracleApproval,
  analyzeTranscript,
} from './transcript-detector.ts';
import type { TranscriptDetection, RalphState } from './types.ts';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('transcript-detector', () => {
  const testDir = join(tmpdir(), 'transcript-detector-test-' + Date.now());
  let transcriptPath: string;

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    transcriptPath = join(testDir, 'transcript.jsonl');
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up transcript file before each test
    try { await rm(transcriptPath, { force: true }); } catch {}
  });

  describe('detectCompletionPromise', () => {
    it('should return false when transcriptPath is null', () => {
      const result = detectCompletionPromise(null);

      expect(result).toBe(false);
    });

    it('should return false when file does not exist', () => {
      const result = detectCompletionPromise('/nonexistent/path');

      expect(result).toBe(false);
    });

    it('should return true when <promise>DONE</promise> is present', async () => {
      await writeFile(transcriptPath, 'Some content\n<promise>DONE</promise>\nMore content');

      const result = detectCompletionPromise(transcriptPath);

      expect(result).toBe(true);
    });

    it('should handle whitespace in promise tag', async () => {
      await writeFile(transcriptPath, '<promise>  DONE  </promise>');

      const result = detectCompletionPromise(transcriptPath);

      expect(result).toBe(true);
    });

    it('should be case insensitive', async () => {
      await writeFile(transcriptPath, '<promise>done</promise>');

      const result = detectCompletionPromise(transcriptPath);

      expect(result).toBe(true);
    });

    it('should return false when no promise tag is present', async () => {
      await writeFile(transcriptPath, 'No promise tag here');

      const result = detectCompletionPromise(transcriptPath);

      expect(result).toBe(false);
    });

    it('started_at 이전 DONE 태그는 false 반환', async () => {
      const lines = [
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T09:00:00.000Z', message: { content: '<promise>DONE</promise>' } }),
        JSON.stringify({ type: 'user', timestamp: '2024-01-15T11:00:00.000Z', message: { content: 'some later message' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectCompletionPromise(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(false);
    });

    it('started_at 이후 DONE 태그는 true 반환', async () => {
      const lines = [
        JSON.stringify({ type: 'user', timestamp: '2024-01-15T09:00:00.000Z', message: { content: 'some early message' } }),
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T11:00:00.000Z', message: { content: '<promise>DONE</promise>' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectCompletionPromise(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(true);
    });

    it('started_at 미지정 시 전체 스캔으로 폴백 (하위 호환)', async () => {
      await writeFile(transcriptPath, '<promise>DONE</promise>');

      const result = detectCompletionPromise(transcriptPath);

      expect(result).toBe(true);
    });

    it('should skip unparseable JSONL lines gracefully', async () => {
      const lines = [
        '{ invalid json }',
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T11:00:00.000Z', message: { content: '<promise>DONE</promise>' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectCompletionPromise(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(true);
    });
  });

  describe('detectOracleApproval', () => {
    it('should return false when transcriptPath is null', () => {
      const result = detectOracleApproval(null);

      expect(result).toBe(false);
    });

    it('should return false when file does not exist', () => {
      const result = detectOracleApproval('/nonexistent/path');

      expect(result).toBe(false);
    });

    it('should return true when <oracle-approved>VERIFIED_COMPLETE</oracle-approved> is present', async () => {
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const result = detectOracleApproval(transcriptPath);

      expect(result).toBe(true);
    });

    it('should match VERIFIED_COMPLETE with surrounding text', async () => {
      await writeFile(transcriptPath, '<oracle-approved>Task is VERIFIED_COMPLETE as of now</oracle-approved>');

      const result = detectOracleApproval(transcriptPath);

      expect(result).toBe(true);
    });

    it('should be case insensitive', async () => {
      await writeFile(transcriptPath, '<oracle-approved>verified_complete</oracle-approved>');

      const result = detectOracleApproval(transcriptPath);

      expect(result).toBe(true);
    });

    it('should return false when no approval tag is present', async () => {
      await writeFile(transcriptPath, 'No approval here');

      const result = detectOracleApproval(transcriptPath);

      expect(result).toBe(false);
    });

    it('started_at 이전 oracle 태그는 false 반환', async () => {
      const lines = [
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T09:00:00.000Z', message: { content: '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' } }),
        JSON.stringify({ type: 'user', timestamp: '2024-01-15T11:00:00.000Z', message: { content: 'some later message' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectOracleApproval(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(false);
    });

    it('started_at 이후 oracle 태그는 true 반환', async () => {
      const lines = [
        JSON.stringify({ type: 'user', timestamp: '2024-01-15T09:00:00.000Z', message: { content: 'some early message' } }),
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T11:00:00.000Z', message: { content: '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectOracleApproval(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(true);
    });

    it('started_at 미지정 시 전체 스캔으로 폴백 (하위 호환)', async () => {
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const result = detectOracleApproval(transcriptPath);

      expect(result).toBe(true);
    });

    it('should skip unparseable JSONL lines gracefully', async () => {
      const lines = [
        '{ invalid json }',
        JSON.stringify({ type: 'assistant', timestamp: '2024-01-15T11:00:00.000Z', message: { content: '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>' } }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = detectOracleApproval(transcriptPath, '2024-01-15T10:00:00.000Z');

      expect(result).toBe(true);
    });
  });

  describe('analyzeTranscript', () => {
    it('should return default values when transcriptPath is null', () => {
      const result = analyzeTranscript(null);

      expect(result).toEqual({
        hasCompletionPromise: false,
        hasOracleApproval: false,
      });
    });

    it('should analyze transcript with completion promise', async () => {
      await writeFile(transcriptPath, '<promise>DONE</promise>');

      const result = analyzeTranscript(transcriptPath);

      expect(result.hasCompletionPromise).toBe(true);
      expect(result.hasOracleApproval).toBe(false);
    });

    it('should analyze transcript with oracle approval', async () => {
      await writeFile(transcriptPath, '<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      const result = analyzeTranscript(transcriptPath);

      expect(result.hasOracleApproval).toBe(true);
    });

    it('should combine all detection results', async () => {
      const content = `
        <promise>DONE</promise>
        <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
      `;
      await writeFile(transcriptPath, content);

      const result = analyzeTranscript(transcriptPath);

      expect(result.hasCompletionPromise).toBe(true);
      expect(result.hasOracleApproval).toBe(true);
    });
  });
});

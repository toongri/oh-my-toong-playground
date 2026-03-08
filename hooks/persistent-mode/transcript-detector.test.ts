import { describe, it, expect } from 'bun:test';
import {
  detectCompletionPromise,
  detectOracleApproval,
  analyzeTranscript,
} from './transcript-detector.ts';
import type { TranscriptDetection } from './types.ts';

describe('transcript-detector', () => {
  describe('detectCompletionPromise', () => {
    it('should return false when lastAssistantMessage is null', () => {
      const result = detectCompletionPromise(null);

      expect(result).toBe(false);
    });

    it('should return false when lastAssistantMessage is empty string', () => {
      const result = detectCompletionPromise('');

      expect(result).toBe(false);
    });

    it('should return true when <promise>DONE</promise> is present', () => {
      const result = detectCompletionPromise('Some content\n<promise>DONE</promise>\nMore content');

      expect(result).toBe(true);
    });

    it('should handle whitespace in promise tag', () => {
      const result = detectCompletionPromise('<promise>  DONE  </promise>');

      expect(result).toBe(true);
    });

    it('should be case insensitive', () => {
      const result = detectCompletionPromise('<promise>done</promise>');

      expect(result).toBe(true);
    });

    it('should return false when no promise tag is present', () => {
      const result = detectCompletionPromise('No promise tag here');

      expect(result).toBe(false);
    });
  });

  describe('detectOracleApproval', () => {
    it('should return false when lastAssistantMessage is null', () => {
      const result = detectOracleApproval(null);

      expect(result).toBe(false);
    });

    it('should return false when lastAssistantMessage is empty string', () => {
      const result = detectOracleApproval('');

      expect(result).toBe(false);
    });

    it('should return true when <oracle-approved>VERIFIED_COMPLETE</oracle-approved> is present', () => {
      const result = detectOracleApproval('<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      expect(result).toBe(true);
    });

    it('should match VERIFIED_COMPLETE with surrounding text', () => {
      const result = detectOracleApproval('<oracle-approved>Task is VERIFIED_COMPLETE as of now</oracle-approved>');

      expect(result).toBe(true);
    });

    it('should be case insensitive', () => {
      const result = detectOracleApproval('<oracle-approved>verified_complete</oracle-approved>');

      expect(result).toBe(true);
    });

    it('should return false when no approval tag is present', () => {
      const result = detectOracleApproval('No approval here');

      expect(result).toBe(false);
    });
  });

  describe('analyzeTranscript', () => {
    it('should return default values when lastAssistantMessage is null', () => {
      const result = analyzeTranscript(null);

      expect(result).toEqual({
        hasCompletionPromise: false,
        hasOracleApproval: false,
      });
    });

    it('should analyze message with completion promise', () => {
      const result = analyzeTranscript('<promise>DONE</promise>');

      expect(result.hasCompletionPromise).toBe(true);
      expect(result.hasOracleApproval).toBe(false);
    });

    it('should analyze message with oracle approval', () => {
      const result = analyzeTranscript('<oracle-approved>VERIFIED_COMPLETE</oracle-approved>');

      expect(result.hasOracleApproval).toBe(true);
    });

    it('should combine all detection results', () => {
      const content = `
        <promise>DONE</promise>
        <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
      `;

      const result = analyzeTranscript(content);

      expect(result.hasCompletionPromise).toBe(true);
      expect(result.hasOracleApproval).toBe(true);
    });
  });
});

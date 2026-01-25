import {
  detectCompletionPromise,
  detectOracleApproval,
  detectOracleRejection,
  countIncompleteTodos,
  analyzeTranscript,
} from './transcript-detector.js';
import type { TranscriptDetection } from './types.js';
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
  });

  describe('detectOracleRejection', () => {
    it('should return null when transcriptPath is null', () => {
      const result = detectOracleRejection(null);

      expect(result).toBeNull();
    });

    it('should return null when file does not exist', () => {
      const result = detectOracleRejection('/nonexistent/path');

      expect(result).toBeNull();
    });

    it('should detect oracle rejected pattern', async () => {
      await writeFile(transcriptPath, 'The oracle rejected the submission');

      const result = detectOracleRejection(transcriptPath);

      expect(result).not.toBeNull();
    });

    it('should detect verification failed pattern', async () => {
      await writeFile(transcriptPath, 'Verification failed due to missing tests');

      const result = detectOracleRejection(transcriptPath);

      expect(result).not.toBeNull();
    });

    it('should detect issues found pattern', async () => {
      await writeFile(transcriptPath, 'Several issues found in the code');

      const result = detectOracleRejection(transcriptPath);

      expect(result).not.toBeNull();
    });

    it('should detect not complete pattern', async () => {
      await writeFile(transcriptPath, 'The task is not complete');

      const result = detectOracleRejection(transcriptPath);

      expect(result).not.toBeNull();
    });

    it('should extract feedback text from issue/problem/reason patterns', async () => {
      await writeFile(transcriptPath, 'verification failed\nIssue: Missing unit tests\nProblem: No error handling\nReason: Incomplete implementation');

      const result = detectOracleRejection(transcriptPath);

      expect(result).not.toBeNull();
      expect(result).toContain('Missing unit tests');
    });

    it('should return null when no rejection patterns are found', async () => {
      await writeFile(transcriptPath, 'Everything is fine, no problems');

      const result = detectOracleRejection(transcriptPath);

      expect(result).toBeNull();
    });

    it('should return empty string when rejection found but no specific feedback', async () => {
      await writeFile(transcriptPath, 'Oracle rejected this submission.');

      const result = detectOracleRejection(transcriptPath);

      expect(result).toBe('');
    });
  });

  describe('countIncompleteTodos', () => {
    it('should return 0 when transcriptPath is null', () => {
      const result = countIncompleteTodos(null);

      expect(result).toBe(0);
    });

    it('should return 0 when file does not exist', () => {
      const result = countIncompleteTodos('/nonexistent/path');

      expect(result).toBe(0);
    });

    it('should count TaskCreate calls as pending todos', async () => {
      // The pattern looks for "Task #N created successfully" in tool results
      const content = `
        {"name": "TaskCreate", "parameters": {"subject": "Task 1"}}
        Task #1 created successfully
        {"name": "TaskCreate", "parameters": {"subject": "Task 2"}}
        Task #2 created successfully
      `;
      await writeFile(transcriptPath, content);

      const result = countIncompleteTodos(transcriptPath);

      expect(result).toBe(2);
    });

    it('should handle TaskUpdate status changes', async () => {
      const content = `
        {"name": "TaskCreate", "parameters": {"subject": "Task 1"}}
        Task #1 created successfully
        {"name": "TaskUpdate", "parameters": {"taskId": "1", "status": "completed"}}
      `;
      await writeFile(transcriptPath, content);

      // TaskCreate adds taskId "1", TaskUpdate marks it completed
      const result = countIncompleteTodos(transcriptPath);

      expect(result).toBe(0);
    });

    it('should return 0 when no todos in transcript', async () => {
      await writeFile(transcriptPath, 'Just regular content, no task tools');

      const result = countIncompleteTodos(transcriptPath);

      expect(result).toBe(0);
    });

    describe('with originalPrompt parameter', () => {
      it('should only count todos after originalPrompt position', async () => {
        // Transcript with two separate requests:
        // 1. First request creates tasks #1 and #2
        // 2. Second request (starting with "Build the feature") creates task #3
        const content = `
          {"type": "human", "message": "Fix the bug"}
          {"name": "TaskCreate", "parameters": {"subject": "Fix bug A"}}
          Task #1 created successfully
          {"name": "TaskCreate", "parameters": {"subject": "Fix bug B"}}
          Task #2 created successfully
          {"type": "human", "message": "Build the feature"}
          {"name": "TaskCreate", "parameters": {"subject": "Add feature"}}
          Task #3 created successfully
        `;
        await writeFile(transcriptPath, content);

        // With originalPrompt, should only count task #3
        const result = countIncompleteTodos(transcriptPath, 'Build the feature');

        expect(result).toBe(1);
      });

      it('should find last occurrence of originalPrompt', async () => {
        // Same prompt appears twice - should use the LAST occurrence
        const content = `
          {"type": "human", "message": "Do the work"}
          {"name": "TaskCreate", "parameters": {"subject": "First batch task"}}
          Task #1 created successfully
          {"type": "human", "message": "Do the work"}
          {"name": "TaskCreate", "parameters": {"subject": "Second batch task"}}
          Task #2 created successfully
        `;
        await writeFile(transcriptPath, content);

        // Should only count task #2 (after last "Do the work")
        const result = countIncompleteTodos(transcriptPath, 'Do the work');

        expect(result).toBe(1);
      });

      it('should count all todos when originalPrompt is not provided', async () => {
        const content = `
          {"type": "human", "message": "Fix the bug"}
          {"name": "TaskCreate", "parameters": {"subject": "Fix bug A"}}
          Task #1 created successfully
          {"type": "human", "message": "Build the feature"}
          {"name": "TaskCreate", "parameters": {"subject": "Add feature"}}
          Task #2 created successfully
        `;
        await writeFile(transcriptPath, content);

        // Without originalPrompt, should count all tasks
        const result = countIncompleteTodos(transcriptPath);

        expect(result).toBe(2);
      });

      it('should count all todos when originalPrompt is not found', async () => {
        const content = `
          {"type": "human", "message": "Fix the bug"}
          {"name": "TaskCreate", "parameters": {"subject": "Fix bug A"}}
          Task #1 created successfully
        `;
        await writeFile(transcriptPath, content);

        // If originalPrompt not found in transcript, count all
        const result = countIncompleteTodos(transcriptPath, 'Nonexistent prompt');

        expect(result).toBe(1);
      });

      it('should handle TaskUpdate after originalPrompt correctly', async () => {
        const content = `
          {"type": "human", "message": "Old task"}
          {"name": "TaskCreate", "parameters": {"subject": "Old task"}}
          Task #1 created successfully
          {"type": "human", "message": "New task"}
          {"name": "TaskCreate", "parameters": {"subject": "New task"}}
          Task #2 created successfully
          {"name": "TaskUpdate", "parameters": {"taskId": "2", "status": "completed"}}
        `;
        await writeFile(transcriptPath, content);

        // Task #2 is created and completed after originalPrompt
        const result = countIncompleteTodos(transcriptPath, 'New task');

        expect(result).toBe(0);
      });

      it('should ignore TaskUpdate for tasks created before originalPrompt', async () => {
        const content = `
          {"type": "human", "message": "Old task"}
          {"name": "TaskCreate", "parameters": {"subject": "Old task"}}
          Task #1 created successfully
          {"type": "human", "message": "New task"}
          {"name": "TaskCreate", "parameters": {"subject": "New task"}}
          Task #2 created successfully
          {"name": "TaskUpdate", "parameters": {"taskId": "1", "status": "completed"}}
        `;
        await writeFile(transcriptPath, content);

        // Task #1 was created before originalPrompt, so its update shouldn't affect count
        // Only Task #2 should be counted as incomplete
        const result = countIncompleteTodos(transcriptPath, 'New task');

        expect(result).toBe(1);
      });
    });
  });

  describe('analyzeTranscript', () => {
    it('should return default values when transcriptPath is null', () => {
      const result = analyzeTranscript(null);

      expect(result).toEqual({
        hasCompletionPromise: false,
        hasOracleApproval: false,
        oracleRejectionFeedback: null,
        incompleteTodoCount: 0,
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

    it('should analyze transcript with rejection feedback', async () => {
      await writeFile(transcriptPath, 'Oracle rejected this.\nIssue: Test failure');

      const result = analyzeTranscript(transcriptPath);

      expect(result.oracleRejectionFeedback).not.toBeNull();
    });

    it('should combine all detection results', async () => {
      const content = `
        <promise>DONE</promise>
        <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
        {"name": "TaskCreate", "parameters": {"subject": "Task"}}
        Task #1 created successfully
      `;
      await writeFile(transcriptPath, content);

      const result = analyzeTranscript(transcriptPath);

      expect(result.hasCompletionPromise).toBe(true);
      expect(result.hasOracleApproval).toBe(true);
      expect(result.incompleteTodoCount).toBe(1);
    });
  });
});

import { jest, describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import type { StdinInput, RalphState, RateLimitData } from './types.ts';
import type { TranscriptResult } from './transcript.ts';
import * as stdinMod from './stdin.ts';
import * as stateMod from './state.ts';
import * as transcriptMod from './transcript.ts';
import * as usageApiMod from './usage-api.ts';
import * as formatterMod from './formatter.ts';
import * as loggingMod from '@lib/logging';
import { main } from './index.ts';

describe('main', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;

  // Spy references for assertions
  let mockReadStdin: ReturnType<typeof spyOn>;
  let mockInitLogger: ReturnType<typeof spyOn>;
  let mockLogDebug: ReturnType<typeof spyOn>;
  let mockLogInfo: ReturnType<typeof spyOn>;
  let mockLogWarn: ReturnType<typeof spyOn>;
  let mockLogError: ReturnType<typeof spyOn>;
  let mockLogStart: ReturnType<typeof spyOn>;
  let mockLogEnd: ReturnType<typeof spyOn>;
  let mockReadRalphState: ReturnType<typeof spyOn>;
  let mockReadBackgroundTasks: ReturnType<typeof spyOn>;
  let mockCalculateSessionDuration: ReturnType<typeof spyOn>;
  let mockIsThinkingEnabled: ReturnType<typeof spyOn>;
  let mockReadTasks: ReturnType<typeof spyOn>;
  let mockGetActiveTaskForm: ReturnType<typeof spyOn>;
  let mockParseTranscript: ReturnType<typeof spyOn>;
  let mockFetchRateLimits: ReturnType<typeof spyOn>;
  let mockFormatStatusLineV2: ReturnType<typeof spyOn>;
  let mockFormatMinimalStatus: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    // Spy on all module functions
    mockReadStdin = spyOn(stdinMod, 'readStdin');
    mockInitLogger = spyOn(loggingMod, 'initLogger').mockImplementation(() => {});
    mockLogDebug = spyOn(loggingMod, 'logDebug').mockImplementation(() => {});
    mockLogInfo = spyOn(loggingMod, 'logInfo').mockImplementation(() => {});
    mockLogWarn = spyOn(loggingMod, 'logWarn').mockImplementation(() => {});
    mockLogError = spyOn(loggingMod, 'logError').mockImplementation(() => {});
    mockLogStart = spyOn(loggingMod, 'logStart').mockImplementation(() => {});
    mockLogEnd = spyOn(loggingMod, 'logEnd').mockImplementation(() => {});
    mockReadRalphState = spyOn(stateMod, 'readRalphState');
    mockReadBackgroundTasks = spyOn(stateMod, 'readBackgroundTasks');
    mockCalculateSessionDuration = spyOn(stateMod, 'calculateSessionDuration');
    mockIsThinkingEnabled = spyOn(stateMod, 'isThinkingEnabled');
    mockReadTasks = spyOn(stateMod, 'readTasks');
    mockGetActiveTaskForm = spyOn(stateMod, 'getActiveTaskForm');
    mockParseTranscript = spyOn(transcriptMod, 'parseTranscript');
    mockFetchRateLimits = spyOn(usageApiMod, 'fetchRateLimits');
    mockFormatStatusLineV2 = spyOn(formatterMod, 'formatStatusLineV2');
    mockFormatMinimalStatus = spyOn(formatterMod, 'formatMinimalStatus');

    // Default mock implementations
    mockReadStdin.mockResolvedValue(null);
    mockReadRalphState.mockResolvedValue(null);
    mockReadBackgroundTasks.mockResolvedValue(0);
    mockCalculateSessionDuration.mockReturnValue(null);
    mockIsThinkingEnabled.mockResolvedValue(false);
    mockReadTasks.mockResolvedValue(null);
    mockGetActiveTaskForm.mockResolvedValue(null);
    mockParseTranscript.mockResolvedValue({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null });
    mockFetchRateLimits.mockResolvedValue(null);
    mockFormatStatusLineV2.mockReturnValue('[OMT] ctx:50%');
    mockFormatMinimalStatus.mockReturnValue('[OMT] ready');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    mockReadStdin.mockRestore();
    mockInitLogger.mockRestore();
    mockLogDebug.mockRestore();
    mockLogInfo.mockRestore();
    mockLogWarn.mockRestore();
    mockLogError.mockRestore();
    mockLogStart.mockRestore();
    mockLogEnd.mockRestore();
    mockReadRalphState.mockRestore();
    mockReadBackgroundTasks.mockRestore();
    mockCalculateSessionDuration.mockRestore();
    mockIsThinkingEnabled.mockRestore();
    mockReadTasks.mockRestore();
    mockGetActiveTaskForm.mockRestore();
    mockParseTranscript.mockRestore();
    mockFetchRateLimits.mockRestore();
    mockFormatStatusLineV2.mockRestore();
    mockFormatMinimalStatus.mockRestore();
  });

  describe('when stdin has valid input', () => {
    it('outputs formatted status line using V2 formatter', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockFormatStatusLineV2).toHaveBeenCalled();
      // Output should have non-breaking spaces (U+00A0)
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0ctx:50%');
    });

    it('passes context_window.used_percentage to HudDataV2', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 75.5,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockFormatStatusLineV2).toHaveBeenCalledWith(
        expect.objectContaining({ contextPercent: 75.5 })
      );
    });

    it('reads state files with correct cwd', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/my/project',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockReadRalphState).toHaveBeenCalledWith('/my/project', 'test-session');
    });

    it('fetches rate limits', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockFetchRateLimits).toHaveBeenCalled();
    });

    it('checks thinking enabled status', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockIsThinkingEnabled).toHaveBeenCalled();
    });

    it('reads tasks with session_id', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session-abc',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockReadTasks).toHaveBeenCalledWith('test-session-abc');
    });

    it('gets active task form with session_id', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session-xyz',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockGetActiveTaskForm).toHaveBeenCalledWith('test-session-xyz');
    });

    it('parses transcript when path is provided', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockParseTranscript).toHaveBeenCalledWith('/path/to/transcript.jsonl');
    });

    it('includes all gathered data in HudDataV2', async () => {
      const ralphState: RalphState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: 'DONE',
        prompt: 'test',
        started_at: '2025-01-22T10:00:00+09:00',
        oracle_feedback: ['First rejection reason'],
      };
      const rateLimits: RateLimitData = {
        fiveHour: { percent: 25, resetIn: '3h' },
        sevenDay: { percent: 10, resetIn: '5d' },
      };
      const sessionStartedAt = new Date('2025-01-22T10:00:00+09:00');

      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockReadRalphState.mockResolvedValue(ralphState);
      mockReadBackgroundTasks.mockResolvedValue(2);
      mockParseTranscript.mockResolvedValue({
        runningAgents: 3,
        activeSkill: 'prometheus',
        agents: [{ type: 'M', model: 'o', id: 'main-1' }, { type: 'S', model: 's', id: 'sub-1' }],
        sessionStartedAt,
      });
      mockFetchRateLimits.mockResolvedValue(rateLimits);
      mockIsThinkingEnabled.mockResolvedValue(true);
      mockReadTasks.mockResolvedValue({ completed: 3, total: 5 });
      mockGetActiveTaskForm.mockResolvedValue('Running tests...');
      mockCalculateSessionDuration.mockReturnValue(45);

      await main();

      expect(mockFormatStatusLineV2).toHaveBeenCalledWith({
        contextPercent: 50,
        ralph: ralphState,
        runningAgents: 3,
        backgroundTasks: 2,
        activeSkill: 'prometheus',
        rateLimits: rateLimits,
        agents: [{ type: 'M', model: 'o', id: 'main-1' }, { type: 'S', model: 's', id: 'sub-1' }],
        sessionDuration: 45,
        thinkingActive: true,
        todos: { completed: 3, total: 5 },
        inProgressTodo: 'Running tests...',
      });
    });

    it('calculates session duration from transcript sessionStartedAt', async () => {
      const sessionStartedAt = new Date('2025-01-22T10:00:00+09:00');

      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockParseTranscript.mockResolvedValue({
        runningAgents: 0,
        activeSkill: null,
        agents: [],
        sessionStartedAt,
      });

      await main();

      expect(mockCalculateSessionDuration).toHaveBeenCalledWith(sessionStartedAt);
    });
  });

  describe('when stdin has no input', () => {
    it('outputs minimal status', async () => {
      mockReadStdin.mockResolvedValue(null);

      await main();

      expect(mockFormatMinimalStatus).toHaveBeenCalledWith(null);
      // Output should have non-breaking spaces (U+00A0)
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0ready');
    });
  });

  describe('error handling', () => {
    it('outputs minimal status when an error occurs', async () => {
      mockReadStdin.mockRejectedValue(new Error('Test error'));

      await main();

      expect(mockFormatMinimalStatus).toHaveBeenCalledWith(null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0ready');
    });

    it('gracefully handles state file read errors', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockReadRalphState.mockRejectedValue(new Error('File not found'));

      await main();

      // Promise.allSettled: individual failure falls back to default, formatStatusLineV2 still called
      expect(mockFormatStatusLineV2).toHaveBeenCalledWith(
        expect.objectContaining({ ralph: null })
      );
      expect(mockFormatMinimalStatus).not.toHaveBeenCalled();
    });

    it('partially degrades when individual data source fails', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockReadRalphState.mockRejectedValue(new Error('File not found'));

      await main();

      // ralph falls back to null; other fields use beforeEach defaults
      expect(mockFormatStatusLineV2).toHaveBeenCalledWith(
        expect.objectContaining({
          ralph: null,
          backgroundTasks: 0,
          runningAgents: 0,
          rateLimits: null,
          thinkingActive: false,
          todos: null,
          inProgressTodo: null,
        })
      );
      expect(mockFormatMinimalStatus).not.toHaveBeenCalled();
    });

    it('logs error with function name when data source rejects', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockReadRalphState.mockRejectedValue(new Error('File not found'));

      await main();

      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('readRalphState'));
    });

    it('degrades gracefully when multiple data sources fail', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockReadRalphState.mockRejectedValue(new Error('ralph error'));
      mockReadTasks.mockRejectedValue(new Error('tasks error'));
      mockFetchRateLimits.mockRejectedValue(new Error('rate limit error'));

      await main();

      // formatStatusLineV2 still called (not formatMinimalStatus)
      expect(mockFormatStatusLineV2).toHaveBeenCalled();
      expect(mockFormatMinimalStatus).not.toHaveBeenCalled();
      // Each failure logged individually
      expect(mockLogError).toHaveBeenCalledTimes(3);
    });
  });

  describe('non-breaking space conversion', () => {
    it('converts regular spaces to non-breaking spaces in output', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockFormatStatusLineV2.mockReturnValue('[OMT] | ctx:50%');

      await main();

      // Should convert regular spaces to non-breaking spaces (U+00A0)
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0|\u00A0ctx:50%');
    });

    it('converts spaces in multiline output', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });
      mockFormatStatusLineV2.mockReturnValue('[OMT] | ctx:50%\nralph:2/10 | session:45m');

      await main();

      // Should convert spaces on both lines to non-breaking spaces
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0|\u00A0ctx:50%\nralph:2/10\u00A0|\u00A0session:45m');
    });

    it('converts spaces in minimal status output', async () => {
      mockReadStdin.mockResolvedValue(null);
      mockFormatMinimalStatus.mockReturnValue('[OMT] ready');

      await main();

      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0ready');
    });
  });

  describe('logging', () => {
    it('initializes logger with correct parameters when input is valid', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session-123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/my/project',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockInitLogger).toHaveBeenCalledWith('hud', '/my/project', 'test-session-123');
    });

    it('uses default session ID when session_id is empty', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: '',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/my/project',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockInitLogger).toHaveBeenCalledWith('hud', '/my/project', 'default');
    });

    it('calls logStart at entry point', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockLogStart).toHaveBeenCalled();
    });

    it('logs input parameters after receiving stdin', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('transcript_path'));
      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('/path/to/transcript.jsonl'));
    });

    it('calls logEnd on successful completion', async () => {
      mockReadStdin.mockResolvedValue({
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/test/cwd',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 10000,
          context_window_size: 200000,
        },
      });

      await main();

      expect(mockLogEnd).toHaveBeenCalled();
    });

    it('logs error when an exception occurs', async () => {
      mockReadStdin.mockRejectedValue(new Error('Test error message'));

      await main();

      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
    });

    it('does not initialize logger when no input is received', async () => {
      mockReadStdin.mockResolvedValue(null);

      await main();

      // Logger should not be initialized when there's no input
      expect(mockInitLogger).not.toHaveBeenCalled();
    });
  });
});

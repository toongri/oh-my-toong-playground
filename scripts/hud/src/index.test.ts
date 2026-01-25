import { jest } from '@jest/globals';
import type { StdinInput, RalphState, UltraworkState, RateLimitData } from './types.js';
import type { TranscriptResult } from './transcript.js';

// Mock modules before imports
const mockReadStdin = jest.fn<() => Promise<StdinInput | null>>();

// Logging mocks
const mockInitLogger = jest.fn<(component: string, projectRoot: string, sessionId?: string) => void>();
const mockLogDebug = jest.fn<(message: string) => void>();
const mockLogInfo = jest.fn<(message: string) => void>();
const mockLogWarn = jest.fn<(message: string) => void>();
const mockLogError = jest.fn<(message: string) => void>();
const mockLogStart = jest.fn<() => void>();
const mockLogEnd = jest.fn<() => void>();
const mockReadRalphState = jest.fn<(cwd: string, sessionId?: string) => Promise<RalphState | null>>();
const mockReadUltraworkState = jest.fn<(cwd: string, sessionId?: string) => Promise<UltraworkState | null>>();
const mockReadBackgroundTasks = jest.fn<() => Promise<number>>();
const mockCalculateSessionDuration = jest.fn<(startedAt: Date | null) => number | null>();
const mockIsThinkingEnabled = jest.fn<() => Promise<boolean>>();
const mockReadTasks = jest.fn<(sessionId: string) => Promise<{ completed: number; total: number } | null>>();
const mockGetActiveTaskForm = jest.fn<(sessionId: string) => Promise<string | null>>();
const mockParseTranscript = jest.fn<(path: string) => Promise<TranscriptResult>>();
const mockFetchRateLimits = jest.fn<() => Promise<RateLimitData | null>>();
const mockFormatStatusLineV2 = jest.fn<() => string>();
const mockFormatMinimalStatus = jest.fn<() => string>();

jest.unstable_mockModule('./stdin.js', () => ({
  readStdin: mockReadStdin,
}));

jest.unstable_mockModule('./state.js', () => ({
  readRalphState: mockReadRalphState,
  readUltraworkState: mockReadUltraworkState,
  readBackgroundTasks: mockReadBackgroundTasks,
  calculateSessionDuration: mockCalculateSessionDuration,
  isThinkingEnabled: mockIsThinkingEnabled,
  readTasks: mockReadTasks,
  getActiveTaskForm: mockGetActiveTaskForm,
}));

jest.unstable_mockModule('./transcript.js', () => ({
  parseTranscript: mockParseTranscript,
}));

jest.unstable_mockModule('./usage-api.js', () => ({
  fetchRateLimits: mockFetchRateLimits,
}));

jest.unstable_mockModule('./formatter.js', () => ({
  formatStatusLineV2: mockFormatStatusLineV2,
  formatMinimalStatus: mockFormatMinimalStatus,
}));

jest.unstable_mockModule('../../lib/dist/logging.js', () => ({
  initLogger: mockInitLogger,
  logDebug: mockLogDebug,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
  logError: mockLogError,
  logStart: mockLogStart,
  logEnd: mockLogEnd,
}));

// Import main after mocks are set up
const { main } = await import('./index.js');

describe('main', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Default mock implementations
    mockReadRalphState.mockResolvedValue(null);
    mockReadUltraworkState.mockResolvedValue(null);
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
      expect(mockReadUltraworkState).toHaveBeenCalledWith('/my/project', 'test-session');
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
        linked_ultrawork: false,
        oracle_feedback: ['First rejection reason'],
      };
      const ultraworkState: UltraworkState = {
        active: true,
        started_at: '2025-01-22T10:00:00+09:00',
        original_prompt: 'test',
        reinforcement_count: 0,
        linked_to_ralph: false,
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
      mockReadUltraworkState.mockResolvedValue(ultraworkState);
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
        ultrawork: ultraworkState,
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

      // Should still output something
      expect(consoleLogSpy).toHaveBeenCalled();
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
      mockFormatStatusLineV2.mockReturnValue('[OMT] | ctx:50%\nultrawork | session:45m');

      await main();

      // Should convert spaces on both lines to non-breaking spaces
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0|\u00A0ctx:50%\nultrawork\u00A0|\u00A0session:45m');
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

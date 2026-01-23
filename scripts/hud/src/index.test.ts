import { jest } from '@jest/globals';
import type { StdinInput, RalphState, UltraworkState, RalphVerification, RateLimitData, TodoItem } from './types.js';
import type { TranscriptResult } from './transcript.js';

// Mock modules before imports
const mockReadStdin = jest.fn<() => Promise<StdinInput | null>>();
const mockReadRalphState = jest.fn<(cwd: string) => Promise<RalphState | null>>();
const mockReadUltraworkState = jest.fn<(cwd: string) => Promise<UltraworkState | null>>();
const mockReadRalphVerification = jest.fn<(cwd: string) => Promise<RalphVerification | null>>();
// readTodos removed - todos now come from transcript only for session isolation
const mockReadBackgroundTasks = jest.fn<() => Promise<number>>();
const mockCalculateSessionDuration = jest.fn<(startedAt: Date | null) => number | null>();
// getInProgressTodo now takes TodoItem[] and returns synchronously
const mockGetInProgressTodo = jest.fn<(todos: TodoItem[]) => string | null>();
const mockIsThinkingEnabled = jest.fn<() => Promise<boolean>>();
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
  readRalphVerification: mockReadRalphVerification,
  readBackgroundTasks: mockReadBackgroundTasks,
  calculateSessionDuration: mockCalculateSessionDuration,
  getInProgressTodo: mockGetInProgressTodo,
  isThinkingEnabled: mockIsThinkingEnabled,
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
    mockReadRalphVerification.mockResolvedValue(null);
    mockReadBackgroundTasks.mockResolvedValue(0);
    mockCalculateSessionDuration.mockReturnValue(null);
    // getInProgressTodo now returns synchronously (no Promise)
    mockGetInProgressTodo.mockReturnValue(null);
    mockIsThinkingEnabled.mockResolvedValue(false);
    mockParseTranscript.mockResolvedValue({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null, todos: [] });
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

      expect(mockReadRalphState).toHaveBeenCalledWith('/my/project');
      expect(mockReadUltraworkState).toHaveBeenCalledWith('/my/project');
      expect(mockReadRalphVerification).toHaveBeenCalledWith('/my/project');
      // Note: getInProgressTodo now takes transcript todos (session isolation)
      expect(mockGetInProgressTodo).toHaveBeenCalledWith([]);
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
      };
      const ultraworkState: UltraworkState = {
        active: true,
        started_at: '2025-01-22T10:00:00+09:00',
        original_prompt: 'test',
        reinforcement_count: 0,
        linked_to_ralph: false,
      };
      const ralphVerification: RalphVerification = {
        pending: true,
        verification_attempts: 1,
        max_verification_attempts: 3,
        original_task: 'test',
        completion_claim: 'done',
        created_at: '2025-01-22T10:00:00+09:00',
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
      mockReadRalphVerification.mockResolvedValue(ralphVerification);
      mockReadBackgroundTasks.mockResolvedValue(2);
      mockParseTranscript.mockResolvedValue({
        runningAgents: 3,
        activeSkill: 'prometheus',
        agents: [{ type: 'M', model: 'o', id: 'main-1' }, { type: 'S', model: 's', id: 'sub-1' }],
        sessionStartedAt,
        todos: [],
      });
      mockFetchRateLimits.mockResolvedValue(rateLimits);
      // getInProgressTodo now returns synchronously
      mockGetInProgressTodo.mockReturnValue('Working on task...');
      mockIsThinkingEnabled.mockResolvedValue(true);
      mockCalculateSessionDuration.mockReturnValue(45);

      await main();

      expect(mockFormatStatusLineV2).toHaveBeenCalledWith({
        contextPercent: 50,
        ralph: ralphState,
        ultrawork: ultraworkState,
        ralphVerification: ralphVerification,
        todos: null,
        runningAgents: 3,
        backgroundTasks: 2,
        activeSkill: 'prometheus',
        rateLimits: rateLimits,
        agents: [{ type: 'M', model: 'o', id: 'main-1' }, { type: 'S', model: 's', id: 'sub-1' }],
        sessionDuration: 45,
        thinkingActive: true,
        inProgressTodo: 'Working on task...',
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
        todos: [],
      });

      await main();

      expect(mockCalculateSessionDuration).toHaveBeenCalledWith(sessionStartedAt);
    });

    it('shows null todos when transcript todos are empty (session isolation)', async () => {
      // Transcript todos are the ONLY source - no file fallback
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
      // Transcript todos are empty (current session has no todos)
      mockParseTranscript.mockResolvedValue({
        runningAgents: 0,
        activeSkill: null,
        agents: [],
        sessionStartedAt: null,
        todos: [],
      });

      await main();

      // Should use null because transcript todos are empty
      expect(mockFormatStatusLineV2).toHaveBeenCalledWith(
        expect.objectContaining({ todos: null })
      );
    });

    it('uses transcript todos when available', async () => {
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
      // Transcript todos from current session
      mockParseTranscript.mockResolvedValue({
        runningAgents: 0,
        activeSkill: null,
        agents: [],
        sessionStartedAt: null,
        todos: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'in_progress' },
          { content: 'Task 3', status: 'pending' },
        ],
      });

      await main();

      // Should use transcript todos: 1 completed out of 3 total
      expect(mockFormatStatusLineV2).toHaveBeenCalledWith(
        expect.objectContaining({ todos: { completed: 1, total: 3 } })
      );
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
      mockFormatStatusLineV2.mockReturnValue('[OMT] | ctx:50%\ntodos:3/5 | session:45m');

      await main();

      // Should convert spaces on both lines to non-breaking spaces
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0|\u00A0ctx:50%\ntodos:3/5\u00A0|\u00A0session:45m');
    });

    it('converts spaces in minimal status output', async () => {
      mockReadStdin.mockResolvedValue(null);
      mockFormatMinimalStatus.mockReturnValue('[OMT] ready');

      await main();

      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT]\u00A0ready');
    });
  });
});

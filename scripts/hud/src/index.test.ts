import { jest } from '@jest/globals';
import type { StdinInput, RalphState, UltraworkState, RalphVerification, TodosState, RateLimitData } from './types.js';
import type { TranscriptResult } from './transcript.js';

// Mock modules before imports
const mockReadStdin = jest.fn<() => Promise<StdinInput | null>>();
const mockReadRalphState = jest.fn<(cwd: string) => Promise<RalphState | null>>();
const mockReadUltraworkState = jest.fn<(cwd: string) => Promise<UltraworkState | null>>();
const mockReadRalphVerification = jest.fn<(cwd: string) => Promise<RalphVerification | null>>();
const mockReadTodos = jest.fn<(cwd: string) => Promise<TodosState | null>>();
const mockReadBackgroundTasks = jest.fn<() => Promise<number>>();
const mockCalculateSessionDuration = jest.fn<(startedAt: Date | null) => number | null>();
const mockGetInProgressTodo = jest.fn<(cwd: string) => Promise<string | null>>();
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
  readTodos: mockReadTodos,
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
    mockReadTodos.mockResolvedValue(null);
    mockReadBackgroundTasks.mockResolvedValue(0);
    mockCalculateSessionDuration.mockReturnValue(null);
    mockGetInProgressTodo.mockResolvedValue(null);
    mockIsThinkingEnabled.mockResolvedValue(false);
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
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT] ctx:50%');
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
      expect(mockReadTodos).toHaveBeenCalledWith('/my/project');
      expect(mockGetInProgressTodo).toHaveBeenCalledWith('/my/project');
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
      });
      mockFetchRateLimits.mockResolvedValue(rateLimits);
      mockGetInProgressTodo.mockResolvedValue('Working on task...');
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
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT] ready');
    });
  });

  describe('error handling', () => {
    it('outputs minimal status when an error occurs', async () => {
      mockReadStdin.mockRejectedValue(new Error('Test error'));

      await main();

      expect(mockFormatMinimalStatus).toHaveBeenCalledWith(null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[OMT] ready');
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
});

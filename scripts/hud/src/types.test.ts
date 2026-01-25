import type {
  StdinInput,
  RalphState,
  UltraworkState,
  HudData,
  UsageResponse,
  UsageLimit,
  RateLimitData,
  AgentInfo,
  HudDataV2,
} from './types.js';
import { ANSI } from './types.js';

describe('types', () => {
  describe('StdinInput', () => {
    it('should accept valid stdin input structure', () => {
      const input: StdinInput = {
        hook_event_name: 'test',
        session_id: 'session-123',
        transcript_path: '/path/to/transcript',
        cwd: '/current/working/dir',
        context_window: {
          used_percentage: 50,
          total_input_tokens: 1000,
          context_window_size: 200000,
        },
      };

      expect(input.hook_event_name).toBe('test');
      expect(input.session_id).toBe('session-123');
      expect(input.context_window.used_percentage).toBe(50);
    });

    it('should accept optional workspace field', () => {
      const input: StdinInput = {
        hook_event_name: 'test',
        session_id: 'session-123',
        transcript_path: '/path/to/transcript',
        cwd: '/current/working/dir',
        workspace: { project_dir: '/project/dir' },
        context_window: {
          used_percentage: 50,
          total_input_tokens: 1000,
          context_window_size: 200000,
        },
      };

      expect(input.workspace?.project_dir).toBe('/project/dir');
    });
  });

  describe('RalphState', () => {
    it('should accept valid ralph state structure', () => {
      const state: RalphState = {
        active: true,
        iteration: 2,
        max_iterations: 5,
        completion_promise: 'Complete the task',
        prompt: 'Original prompt',
        started_at: '2024-01-22T10:00:00Z',
        linked_ultrawork: false,
      };

      expect(state.active).toBe(true);
      expect(state.iteration).toBe(2);
      expect(state.max_iterations).toBe(5);
    });
  });

  describe('UltraworkState', () => {
    it('should accept valid ultrawork state structure', () => {
      const state: UltraworkState = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Original prompt',
        reinforcement_count: 3,
        linked_to_ralph: true,
      };

      expect(state.active).toBe(true);
      expect(state.reinforcement_count).toBe(3);
    });

    it('should accept optional last_checked_at field', () => {
      const state: UltraworkState = {
        active: true,
        started_at: '2024-01-22T10:00:00Z',
        original_prompt: 'Original prompt',
        reinforcement_count: 3,
        last_checked_at: '2024-01-22T11:00:00Z',
        linked_to_ralph: false,
      };

      expect(state.last_checked_at).toBe('2024-01-22T11:00:00Z');
    });
  });

  // RalphVerification tests removed - oracle_feedback is now in RalphState

  describe('HudData', () => {
    it('should accept valid hud data structure with null values', () => {
      const data: HudData = {
        contextPercent: null,
        ralph: null,
        ultrawork: null,
        runningAgents: 0,
        backgroundTasks: 0,
        activeSkill: null,
      };

      expect(data.contextPercent).toBeNull();
      expect(data.runningAgents).toBe(0);
    });

    it('should accept valid hud data structure with populated values', () => {
      const data: HudData = {
        contextPercent: 75,
        ralph: {
          active: true,
          iteration: 2,
          max_iterations: 5,
          completion_promise: 'Promise',
          prompt: 'Prompt',
          started_at: '2024-01-22T10:00:00Z',
          linked_ultrawork: true,
        },
        ultrawork: {
          active: true,
          started_at: '2024-01-22T10:00:00Z',
          original_prompt: 'Prompt',
          reinforcement_count: 1,
          linked_to_ralph: true,
        },
        runningAgents: 2,
        backgroundTasks: 1,
        activeSkill: 'prometheus',
      };

      expect(data.contextPercent).toBe(75);
      expect(data.ralph?.iteration).toBe(2);
    });
  });

  describe('ANSI', () => {
    it('should export ANSI color codes', () => {
      expect(ANSI.reset).toBe('\x1b[0m');
      expect(ANSI.green).toBe('\x1b[32m');
      expect(ANSI.yellow).toBe('\x1b[33m');
      expect(ANSI.red).toBe('\x1b[31m');
      expect(ANSI.bold).toBe('\x1b[1m');
    });

    it('should export cyan and dim ANSI codes', () => {
      expect(ANSI.cyan).toBe('\x1b[36m');
      expect(ANSI.dim).toBe('\x1b[2m');
    });
  });

  describe('UsageLimit', () => {
    it('should accept valid usage limit structure', () => {
      const limit: UsageLimit = {
        utilization: 0.75,
        resets_at: '2024-01-22T15:00:00Z',
      };

      expect(limit.utilization).toBe(0.75);
      expect(limit.resets_at).toBe('2024-01-22T15:00:00Z');
    });

    it('should accept null resets_at', () => {
      const limit: UsageLimit = {
        utilization: 0.5,
        resets_at: null,
      };

      expect(limit.utilization).toBe(0.5);
      expect(limit.resets_at).toBeNull();
    });
  });

  describe('UsageResponse', () => {
    it('should accept valid usage response structure', () => {
      const response: UsageResponse = {
        five_hour: { utilization: 0.25, resets_at: '2024-01-22T15:00:00Z' },
        seven_day: { utilization: 0.5, resets_at: '2024-01-29T10:00:00Z' },
        seven_day_oauth_apps: { utilization: 0.1, resets_at: null },
        seven_day_opus: { utilization: 0.8, resets_at: '2024-01-29T10:00:00Z' },
      };

      expect(response.five_hour?.utilization).toBe(0.25);
      expect(response.seven_day?.utilization).toBe(0.5);
      expect(response.seven_day_oauth_apps?.utilization).toBe(0.1);
      expect(response.seven_day_opus?.utilization).toBe(0.8);
    });

    it('should accept all null values', () => {
      const response: UsageResponse = {
        five_hour: null,
        seven_day: null,
        seven_day_oauth_apps: null,
        seven_day_opus: null,
      };

      expect(response.five_hour).toBeNull();
      expect(response.seven_day).toBeNull();
      expect(response.seven_day_oauth_apps).toBeNull();
      expect(response.seven_day_opus).toBeNull();
    });
  });

  describe('RateLimitData', () => {
    it('should accept valid rate limit data structure', () => {
      const data: RateLimitData = {
        fiveHour: { percent: 25, resetIn: '2h 30m' },
        sevenDay: { percent: 50, resetIn: '3d 12h' },
      };

      expect(data.fiveHour?.percent).toBe(25);
      expect(data.fiveHour?.resetIn).toBe('2h 30m');
      expect(data.sevenDay?.percent).toBe(50);
      expect(data.sevenDay?.resetIn).toBe('3d 12h');
    });

    it('should accept null values', () => {
      const data: RateLimitData = {
        fiveHour: null,
        sevenDay: null,
      };

      expect(data.fiveHour).toBeNull();
      expect(data.sevenDay).toBeNull();
    });
  });

  describe('AgentInfo', () => {
    it('should accept main agent with opus model', () => {
      const agent: AgentInfo = {
        type: 'M',
        model: 'o',
        id: 'agent-123',
      };

      expect(agent.type).toBe('M');
      expect(agent.model).toBe('o');
      expect(agent.id).toBe('agent-123');
    });

    it('should accept subagent with sonnet model', () => {
      const agent: AgentInfo = {
        type: 'S',
        model: 's',
        id: 'agent-456',
      };

      expect(agent.type).toBe('S');
      expect(agent.model).toBe('s');
    });

    it('should accept subagent with haiku model', () => {
      const agent: AgentInfo = {
        type: 'S',
        model: 'h',
        id: 'agent-789',
      };

      expect(agent.model).toBe('h');
    });
  });

  describe('HudDataV2', () => {
    it('should accept valid HudDataV2 structure with all null values', () => {
      const data: HudDataV2 = {
        contextPercent: null,
        ralph: null,
        ultrawork: null,
        runningAgents: 0,
        backgroundTasks: 0,
        activeSkill: null,
        rateLimits: null,
        agents: [],
        sessionDuration: null,
        thinkingActive: false,
        todos: null,
        inProgressTodo: null,
      };

      expect(data.contextPercent).toBeNull();
      expect(data.rateLimits).toBeNull();
      expect(data.agents).toHaveLength(0);
      expect(data.sessionDuration).toBeNull();
      expect(data.thinkingActive).toBe(false);
      expect(data.todos).toBeNull();
      expect(data.inProgressTodo).toBeNull();
    });

    it('should accept fully populated HudDataV2 structure', () => {
      const data: HudDataV2 = {
        contextPercent: 75,
        ralph: {
          active: true,
          iteration: 2,
          max_iterations: 5,
          completion_promise: 'Promise',
          prompt: 'Prompt',
          started_at: '2024-01-22T10:00:00Z',
          linked_ultrawork: true,
        },
        ultrawork: {
          active: true,
          started_at: '2024-01-22T10:00:00Z',
          original_prompt: 'Prompt',
          reinforcement_count: 1,
          linked_to_ralph: true,
        },
        runningAgents: 2,
        backgroundTasks: 1,
        activeSkill: 'prometheus',
        rateLimits: {
          fiveHour: { percent: 25, resetIn: '2h 30m' },
          sevenDay: { percent: 50, resetIn: '3d 12h' },
        },
        agents: [
          { type: 'M', model: 'o', id: 'main-1' },
          { type: 'S', model: 's', id: 'sub-1' },
        ],
        sessionDuration: 45,
        thinkingActive: true,
        todos: { completed: 3, total: 5 },
        inProgressTodo: 'Running tests',
      };

      expect(data.contextPercent).toBe(75);
      expect(data.rateLimits?.fiveHour?.percent).toBe(25);
      expect(data.agents).toHaveLength(2);
      expect(data.agents[0].type).toBe('M');
      expect(data.agents[1].model).toBe('s');
      expect(data.sessionDuration).toBe(45);
      expect(data.thinkingActive).toBe(true);
      expect(data.todos?.completed).toBe(3);
      expect(data.todos?.total).toBe(5);
      expect(data.inProgressTodo).toBe('Running tests');
    });
  });
});

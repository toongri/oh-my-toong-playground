import { formatStatusLine, formatMinimalStatus, formatStatusLineV2 } from './formatter.js';
import { ANSI, type HudData, type HudDataV2, type RalphState, type UltraworkState, type AgentInfo } from './types.js';

// Helper to create complete ralph state for tests
function createRalphState(overrides: Partial<RalphState> & Pick<RalphState, 'active' | 'iteration' | 'max_iterations'>): RalphState {
  return {
    completion_promise: 'DONE',
    prompt: 'test prompt',
    started_at: '2025-01-22T10:00:00+09:00',
    linked_ultrawork: false,
    ...overrides,
  };
}

// Helper to create complete ultrawork state for tests
function createUltraworkState(overrides: Partial<UltraworkState> & Pick<UltraworkState, 'active'>): UltraworkState {
  return {
    started_at: '2025-01-22T10:00:00+09:00',
    original_prompt: 'test prompt',
    reinforcement_count: 0,
    linked_to_ralph: false,
    ...overrides,
  };
}

// createRalphVerification helper removed - oracle_feedback is now in RalphState

describe('formatStatusLine', () => {
  const emptyData: HudData = {
    contextPercent: null,
    ralph: null,
    ultrawork: null,
    runningAgents: 0,
    backgroundTasks: 0,
    activeSkill: null,
  };

  describe('always shows prefix', () => {
    it('shows [OMT] prefix with bold formatting', () => {
      const result = formatStatusLine(emptyData);
      expect(result).toContain('[OMT]');
      expect(result).toContain(ANSI.bold);
    });
  });

  describe('ralph status', () => {
    it('shows ralph iteration when active', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10 }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain('ralph:3/10');
    });

    it('does not show ralph when inactive', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: false, iteration: 0, max_iterations: 10 }),
      };
      const result = formatStatusLine(data);
      expect(result).not.toContain('ralph');
    });

    it('shows green color when iteration is low', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 2, max_iterations: 10 }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.green);
    });

    it('shows yellow color when iteration is above 70% of max', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 8, max_iterations: 10 }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.yellow);
    });

    it('shows red color when iteration equals max', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 10, max_iterations: 10 }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.red);
    });
  });

  describe('ralph oracle feedback', () => {
    it('shows feedback count when oracle_feedback has items', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, oracle_feedback: ['feedback1', 'feedback2'] }),
      };
      const result = formatStatusLine(data);
      expect(result).toMatch(/ralph:3\/10.*fb:2/);
    });

    it('does not show feedback when oracle_feedback is empty', () => {
      const data: HudData = {
        ...emptyData,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, oracle_feedback: [] }),
      };
      const result = formatStatusLine(data);
      expect(result).not.toContain('fb:');
    });
  });

  describe('ultrawork status', () => {
    it('shows ultrawork when active', () => {
      const data: HudData = {
        ...emptyData,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain('ultrawork');
      expect(result).toContain(ANSI.green);
    });

    it('does not show ultrawork when inactive', () => {
      const data: HudData = {
        ...emptyData,
        ultrawork: createUltraworkState({ active: false }),
      };
      const result = formatStatusLine(data);
      expect(result).not.toContain('ultrawork');
    });
  });

  describe('context window percentage', () => {
    it('shows context percentage when available', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 42.5,
      };
      const result = formatStatusLine(data);
      expect(result).toContain('ctx:43%');
    });

    it('shows green color when context is below 70%', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 50,
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.green);
    });

    it('shows yellow color when context is above 70%', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 75,
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.yellow);
    });

    it('shows red color when context is above 85%', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 90,
      };
      const result = formatStatusLine(data);
      expect(result).toContain(ANSI.red);
    });

    it('caps context at 100%', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 150,
      };
      const result = formatStatusLine(data);
      expect(result).toContain('ctx:100%');
    });
  });

  describe('running agents', () => {
    it('shows running agents when greater than 0', () => {
      const data: HudData = {
        ...emptyData,
        runningAgents: 3,
      };
      const result = formatStatusLine(data);
      expect(result).toContain('agents:3');
    });

    it('does not show agents when 0', () => {
      const data: HudData = {
        ...emptyData,
        runningAgents: 0,
      };
      const result = formatStatusLine(data);
      expect(result).not.toContain('agents');
    });
  });

  describe('background tasks', () => {
    it('shows background tasks when greater than 0', () => {
      const data: HudData = {
        ...emptyData,
        backgroundTasks: 2,
      };
      const result = formatStatusLine(data);
      expect(result).toContain('bg:2');
    });

    it('does not show background tasks when 0', () => {
      const data: HudData = {
        ...emptyData,
        backgroundTasks: 0,
      };
      const result = formatStatusLine(data);
      expect(result).not.toContain('bg:');
    });
  });


  describe('active skill', () => {
    it('shows active skill name', () => {
      const data: HudData = {
        ...emptyData,
        activeSkill: 'prometheus',
      };
      const result = formatStatusLine(data);
      expect(result).toContain('skill:prometheus');
    });

    it('truncates long skill names to 15 chars', () => {
      const data: HudData = {
        ...emptyData,
        activeSkill: 'verylongskillnamethatexceedslimit',
      };
      const result = formatStatusLine(data);
      // 'verylongskillnamethatexceedslimit'.substring(0, 15) = 'verylongskillna'
      expect(result).toContain('skill:verylongskillna');
      expect(result).not.toContain('verylongskillnamethatexceedslimit');
    });
  });

  describe('separator', () => {
    it('uses pipe separator between elements', () => {
      const data: HudData = {
        ...emptyData,
        contextPercent: 50,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLine(data);
      expect(result).toContain(' | ');
    });
  });
});

describe('formatMinimalStatus', () => {
  it('shows [OMT] prefix', () => {
    const result = formatMinimalStatus(null);
    expect(result).toContain('[OMT]');
  });

  it('shows ready when no context percent', () => {
    const result = formatMinimalStatus(null);
    expect(result).toContain('ready');
  });

  it('shows context percent when available', () => {
    const result = formatMinimalStatus(42);
    expect(result).toContain('ctx:42%');
  });

  it('applies correct color for context percent', () => {
    const result = formatMinimalStatus(90);
    expect(result).toContain(ANSI.red);
  });

  it('caps context at 100%', () => {
    const result = formatMinimalStatus(150);
    expect(result).toContain('ctx:100%');
  });
});

describe('formatStatusLineV2', () => {
  const emptyDataV2: HudDataV2 = {
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

  describe('prefix', () => {
    it('shows [OMT] prefix with bold formatting', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).toContain('[OMT]');
      expect(result).toContain(ANSI.bold);
    });
  });

  describe('rate limits', () => {
    it('shows 5h rate limit with percentage and reset time', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: { percent: 45, resetIn: '2h' },
          sevenDay: null,
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('5h:45%(2h)');
    });

    it('shows weekly rate limit with percentage and reset time', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: null,
          sevenDay: { percent: 30, resetIn: '3d' },
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('wk:30%(3d)');
    });

    it('shows both rate limits when available', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: { percent: 45, resetIn: '2h' },
          sevenDay: { percent: 30, resetIn: '3d' },
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('5h:45%(2h)');
      expect(result).toContain('wk:30%(3d)');
    });

    it('applies green color when rate limit is below 70%', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: { percent: 50, resetIn: '2h' },
          sevenDay: null,
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.green);
    });

    it('applies yellow color when rate limit is above 70%', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: { percent: 75, resetIn: '2h' },
          sevenDay: null,
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.yellow);
    });

    it('applies red color when rate limit is above 85%', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        rateLimits: {
          fiveHour: { percent: 90, resetIn: '1h' },
          sevenDay: null,
        },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.red);
    });

    it('does not show rate limits section when null', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).not.toContain('5h:');
      expect(result).not.toContain('wk:');
    });
  });

  describe('context percentage', () => {
    it('shows context percentage when available', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 42.5,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ctx:43%');
    });

    it('applies correct color based on percentage', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 90,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.red);
    });
  });

  describe('agent names display (compact format)', () => {
    it('shows single agent name without +N suffix', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [
          { type: 'S', model: 's', id: 'sub-1', name: 'explore' },
        ],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('agents:explore');
      expect(result).not.toContain('agents:explore+');
    });

    it('shows first agent name with +1 suffix for 2 agents', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [
          { type: 'S', model: 's', id: 'sub-1', name: 'explore' },
          { type: 'S', model: 'o', id: 'sub-2', name: 'oracle' },
        ],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('agents:explore+1');
      expect(result).not.toContain('oracle');
    });

    it('shows first agent name with +2 suffix for 3 agents', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [
          { type: 'S', model: 's', id: 'sub-1', name: 'explore' },
          { type: 'S', model: 'o', id: 'sub-2', name: 'librarian' },
          { type: 'S', model: 'o', id: 'sub-3', name: 'oracle' },
        ],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('agents:explore+2');
      expect(result).not.toContain('librarian');
      expect(result).not.toContain('oracle');
    });

    it('falls back to type+model code when first agent has no name', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [
          { type: 'S', model: 's', id: 'sub-1' },
        ],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('agents:Ss');
    });

    it('uses first agent name even when later agents have no name', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [
          { type: 'S', model: 's', id: 'sub-1', name: 'explore' },
          { type: 'S', model: 'h', id: 'sub-2' },
        ],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('agents:explore+1');
    });

    it('applies green color to agents', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        agents: [{ type: 'S', model: 'o', id: 'main-1', name: 'oracle' }],
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.green);
    });

    it('does not show agents when array is empty', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).not.toContain('agents:');
    });
  });

  describe('ralph status', () => {
    it('shows ralph only when active is true', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 2, max_iterations: 10 }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ralph:2/10');
    });

    it('does not show ralph when active is false', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: false, iteration: 2, max_iterations: 10 }),
      };
      const result = formatStatusLineV2(data);
      expect(result).not.toContain('ralph');
    });

    it('shows feedback count when oracle_feedback has items', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, oracle_feedback: ['feedback1'] }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toMatch(/ralph:3\/10.*fb:1/);
    });
  });

  describe('ultrawork status', () => {
    it('shows ultrawork only when active is true', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ultrawork');
    });

    it('does not show ultrawork when active is false', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ultrawork: createUltraworkState({ active: false }),
      };
      const result = formatStatusLineV2(data);
      expect(result).not.toContain('ultrawork');
    });

    it('applies green color to ultrawork', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.green);
    });
  });

  describe('thinking indicator', () => {
    it('shows thinking when thinkingActive is true', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        thinkingActive: true,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('thinking');
    });

    it('does not show thinking when thinkingActive is false', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).not.toContain('thinking');
    });

    it('applies cyan color to thinking', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        thinkingActive: true,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.cyan);
    });
  });

  describe('line 2 - ralph and ultrawork', () => {
    it('shows ralph on line 2 when active', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10 }),
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('ralph:3/10');
    });

    it('shows ultrawork on line 2 when active', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('ultrawork');
    });

    it('shows both ralph and ultrawork on line 2 when both active', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 2, max_iterations: 10 }),
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('ralph:2/10');
      expect(lines[1]).toContain('ultrawork');
    });
  });

  describe('line 2 - session duration', () => {
    it('shows session duration in minutes', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('session:45m');
    });

    it('shows session duration in hours and minutes', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        sessionDuration: 135,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('session:2h15m');
    });

    it('applies dim color to session duration', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.dim);
    });

    it('does not show session when duration is 0', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        sessionDuration: 0,
      };
      const result = formatStatusLineV2(data);
      expect(result).not.toContain('session:');
    });

    it('does not show session when duration is null', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).not.toContain('session:');
    });
  });

  describe('line 2 - todos progress', () => {
    it('shows todos progress when data.todos exists', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        todos: { completed: 3, total: 5 },
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('todos:3/5');
    });

    it('does not show todos when data.todos is null', () => {
      const result = formatStatusLineV2(emptyDataV2);
      expect(result).not.toContain('todos:');
    });

    it('applies green color to todos', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        todos: { completed: 2, total: 4 },
      };
      const result = formatStatusLineV2(data);
      // todos should have green color
      const line2 = result.split('\n')[1] || '';
      expect(line2).toContain(ANSI.green);
    });

    it('shows todos on line 2', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        todos: { completed: 1, total: 3 },
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('todos:1/3');
    });
  });

  describe('line 2 - in-progress task', () => {
    it('shows in-progress task activeForm when data.inProgressTodo exists', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        inProgressTodo: 'Running tests',
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('Running tests');
    });

    it('does not show in-progress task when data.inProgressTodo is null', () => {
      const result = formatStatusLineV2(emptyDataV2);
      // Should only have line 1
      expect(result.split('\n').length).toBe(1);
    });

    it('applies dim color to in-progress task', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        inProgressTodo: 'Implementing feature',
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(ANSI.dim);
    });

    it('shows in-progress task on line 2', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        inProgressTodo: 'Analyzing code',
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('Analyzing code');
    });
  });

  describe('2-line output format', () => {
    it('returns single line when no line 2 content', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
      };
      const result = formatStatusLineV2(data);
      expect(result.split('\n').length).toBe(1);
    });

    it('returns 2 lines when line 2 content exists (ralph active)', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10 }),
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
    });

    it('returns 2 lines when line 2 content exists (ultrawork active)', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
        ultrawork: createUltraworkState({ active: true }),
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
    });

    it('has line 1 with prefix and main status', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
        agents: [{ type: 'S', model: 's', id: 'sub-1', name: 'explore' }],
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10 }),
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines[0]).toContain('[OMT]');
      expect(lines[0]).toContain('ctx:50%');
      expect(lines[0]).toContain('agents:explore');
    });

    it('has line 2 with ralph and session', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10 }),
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      const lines = result.split('\n');
      expect(lines[1]).toContain('ralph:3/10');
      expect(lines[1]).toContain('session:45m');
    });
  });

  describe('element order', () => {
    it('maintains correct order on line 1: [OMT] | rateLimits | ctx | agents | thinking', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
        rateLimits: { fiveHour: { percent: 30, resetIn: '2h' }, sevenDay: null },
        agents: [{ type: 'S', model: 's', id: 'sub-1', name: 'sisyphus-junior' }],
        thinkingActive: true,
      };
      const result = formatStatusLineV2(data);
      const line1 = result.split('\n')[0];

      const omtIndex = line1.indexOf('[OMT]');
      const rateIndex = line1.indexOf('5h:');
      const ctxIndex = line1.indexOf('ctx:');
      const agentsIndex = line1.indexOf('agents:');
      const thinkingIndex = line1.indexOf('thinking');

      expect(omtIndex).toBeLessThan(rateIndex);
      expect(rateIndex).toBeLessThan(ctxIndex);
      expect(ctxIndex).toBeLessThan(agentsIndex);
      expect(agentsIndex).toBeLessThan(thinkingIndex);
    });

    it('maintains correct order on line 2: ralph | ultrawork | session', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 2, max_iterations: 10 }),
        ultrawork: createUltraworkState({ active: true }),
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      const line2 = result.split('\n')[1];

      const ralphIndex = line2.indexOf('ralph:');
      const ultraworkIndex = line2.indexOf('ultrawork');
      const sessionIndex = line2.indexOf('session:');

      expect(ralphIndex).toBeLessThan(ultraworkIndex);
      expect(ultraworkIndex).toBeLessThan(sessionIndex);
    });
  });

  describe('separator', () => {
    it('uses pipe separator between line 1 elements', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        contextPercent: 50,
        thinkingActive: true,
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain(' | ');
    });

    it('uses pipe separator between line 2 elements', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ultrawork: createUltraworkState({ active: true }),
        sessionDuration: 45,
      };
      const result = formatStatusLineV2(data);
      const line2 = result.split('\n')[1];
      expect(line2).toContain(' | ');
    });
  });

  describe('ralph display without + suffix', () => {
    it('never shows + suffix on ralph even when linked_ultrawork is true', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, linked_ultrawork: true }),
        ultrawork: createUltraworkState({ active: true, linked_to_ralph: true }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ralph:3/10');
      expect(result).not.toContain('ralph:3/10+');
    });

    it('skips individual ultrawork display when linked_to_ralph is true', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, linked_ultrawork: true }),
        ultrawork: createUltraworkState({ active: true, linked_to_ralph: true }),
      };
      const result = formatStatusLineV2(data);
      // Should have ralph:3/10 but not separate "ultrawork" text
      expect(result).toContain('ralph:3/10');
      expect(result).not.toMatch(/\bultrawork\b/);
    });

    it('shows individual ultrawork when linked_to_ralph is false', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, linked_ultrawork: false }),
        ultrawork: createUltraworkState({ active: true, linked_to_ralph: false }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ralph:3/10');
      expect(result).toContain('ultrawork');
    });

    it('shows feedback count without + suffix when linked and has feedback', () => {
      const data: HudDataV2 = {
        ...emptyDataV2,
        ralph: createRalphState({ active: true, iteration: 3, max_iterations: 10, linked_ultrawork: true, oracle_feedback: ['feedback1'] }),
        ultrawork: createUltraworkState({ active: true, linked_to_ralph: true }),
      };
      const result = formatStatusLineV2(data);
      expect(result).toContain('ralph:3/10');
      expect(result).not.toContain('ralph:3/10+');
      expect(result).toContain('fb:1');
    });
  });
});

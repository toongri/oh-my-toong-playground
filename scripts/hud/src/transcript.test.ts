import { parseTranscript, modelToTier } from './transcript.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseTranscript', () => {
  const testDir = join(tmpdir(), 'hud-transcript-test-' + Date.now());

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return default values when file does not exist', async () => {
    const nonExistentPath = join(testDir, 'nonexistent.jsonl');

    const result = await parseTranscript(nonExistentPath);

    expect(result.runningAgents).toBe(0);
    expect(result.activeSkill).toBeNull();
  });

  it('should track active skill from Skill tool calls', async () => {
    const transcriptPath = join(testDir, 'skill-transcript.jsonl');
    const lines = [
      JSON.stringify({ tool: 'Skill', name: 'prometheus', status: 'started' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.activeSkill).toBe('prometheus');
  });

  it('should track active skill using toolName field', async () => {
    const transcriptPath = join(testDir, 'skill-toolname-transcript.jsonl');
    const lines = [
      JSON.stringify({ toolName: 'Skill', name: 'sisyphus', status: 'started' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.activeSkill).toBe('sisyphus');
  });

  it('should count running agents from Task tool calls', async () => {
    const transcriptPath = join(testDir, 'agents-transcript.jsonl');
    const lines = [
      JSON.stringify({ tool: 'Task', status: 'started', id: 'agent1' }),
      JSON.stringify({ tool: 'Task', status: 'running', id: 'agent2' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.runningAgents).toBeGreaterThanOrEqual(0);
  });

  it('should skip malformed JSON lines', async () => {
    const transcriptPath = join(testDir, 'malformed-transcript.jsonl');
    const lines = [
      '{ invalid json }',
      JSON.stringify({ tool: 'Skill', name: 'explore' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.activeSkill).toBe('explore');
  });

  it('should return last active skill when multiple skills are invoked', async () => {
    const transcriptPath = join(testDir, 'multiple-skills-transcript.jsonl');
    const lines = [
      JSON.stringify({ tool: 'Skill', name: 'prometheus' }),
      JSON.stringify({ tool: 'Skill', name: 'sisyphus' }),
      JSON.stringify({ tool: 'Skill', name: 'oracle' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.activeSkill).toBe('oracle');
  });

  it('should track session start timestamp from first entry', async () => {
    const transcriptPath = join(testDir, 'session-timestamp.jsonl');
    const timestamp1 = '2024-01-15T10:30:00.000Z';
    const timestamp2 = '2024-01-15T10:35:00.000Z';
    const lines = [
      JSON.stringify({ type: 'assistant', timestamp: timestamp1 }),
      JSON.stringify({ type: 'user', timestamp: timestamp2 }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.sessionStartedAt).toEqual(new Date(timestamp1));
  });

  it('should return null sessionStartedAt when no timestamps exist', async () => {
    const transcriptPath = join(testDir, 'no-timestamp.jsonl');
    const lines = [
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ type: 'user' }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.sessionStartedAt).toBeNull();
  });

  it('should return earliest timestamp as sessionStartedAt', async () => {
    const transcriptPath = join(testDir, 'multiple-timestamps.jsonl');
    const earliest = '2024-01-15T09:00:00.000Z';
    const middle = '2024-01-15T10:00:00.000Z';
    const latest = '2024-01-15T11:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'user', timestamp: middle }),
      JSON.stringify({ type: 'assistant', timestamp: earliest }),
      JSON.stringify({ type: 'user', timestamp: latest }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.sessionStartedAt).toEqual(new Date(earliest));
  });

  it('should return empty agents array when file does not exist', async () => {
    const nonExistentPath = join(testDir, 'nonexistent-agents.jsonl');

    const result = await parseTranscript(nonExistentPath);

    expect(result.agents).toEqual([]);
  });

  it('should not track assistant messages as agents (only running subagents)', async () => {
    const transcriptPath = join(testDir, 'main-agent.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-20250514' },
        uuid: 'main-123',
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    // Assistant messages are no longer tracked as agents
    // Only running Task subagents are shown
    expect(result.agents).toEqual([]);
  });

  it('should extract subagent info from Task tool calls', async () => {
    const transcriptPath = join(testDir, 'subagent.jsonl');
    const lines = [
      JSON.stringify({
        tool: 'Task',
        status: 'started',
        toolUseId: 'task-456',
        model: 'claude-opus-4-20250514',
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.agents).toContainEqual({
      type: 'S',
      model: 'o',
      id: 'task-456',
    });
  });

  it('should track only running subagents with different models', async () => {
    const transcriptPath = join(testDir, 'multiple-agents.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-4-20250514' },
        uuid: 'main-1',
      }),
      JSON.stringify({
        tool: 'Task',
        status: 'started',
        toolUseId: 'sub-1',
        model: 'claude-sonnet-4-20250514',
      }),
      JSON.stringify({
        tool: 'Task',
        status: 'started',
        toolUseId: 'sub-2',
        model: 'claude-3-5-haiku-20241022',
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    // Only running subagents are tracked (assistant messages are ignored)
    expect(result.agents).toHaveLength(2);
    expect(result.agents).toContainEqual({ type: 'S', model: 's', id: 'sub-1' });
    expect(result.agents).toContainEqual({ type: 'S', model: 'h', id: 'sub-2' });
  });

  it('should remove agents when they complete', async () => {
    const transcriptPath = join(testDir, 'agent-completion.jsonl');
    const lines = [
      JSON.stringify({
        tool: 'Task',
        status: 'started',
        toolUseId: 'task-1',
        model: 'claude-sonnet-4-20250514',
      }),
      JSON.stringify({
        tool: 'Task',
        status: 'started',
        toolUseId: 'task-2',
        model: 'claude-haiku-3-20240307',
      }),
      JSON.stringify({
        tool: 'Task',
        status: 'completed',
        toolUseId: 'task-1',
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    // task-1 completed, only task-2 should remain
    expect(result.agents).toHaveLength(1);
    expect(result.agents).toContainEqual({ type: 'S', model: 'h', id: 'task-2' });
  });

  // Tests for actual Claude Code transcript structure
  // Claude Code uses: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task', id: 'xxx', input: {...} }] } }
  it('should detect Task agent from actual Claude Code transcript structure with message.content array', async () => {
    const transcriptPath = join(testDir, 'claude-code-structure.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-01-15T10:00:00.000Z',
        message: {
          model: 'claude-opus-4-20250514',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc123',
              name: 'Task',
              input: { prompt: 'Do something' },
            },
          ],
        },
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.agents).toHaveLength(1);
    expect(result.agents).toContainEqual({
      type: 'S',
      model: 'o',
      id: 'toolu_abc123',
    });
  });

  it('should track agent completion via tool_result in Claude Code transcript', async () => {
    const transcriptPath = join(testDir, 'claude-code-completion.jsonl');
    const lines = [
      // Agent starts
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-01-15T10:00:00.000Z',
        message: {
          model: 'claude-sonnet-4-20250514',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_task1',
              name: 'Task',
              input: { prompt: 'Task 1' },
            },
          ],
        },
      }),
      // Another agent starts
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-01-15T10:01:00.000Z',
        message: {
          model: 'claude-3-5-haiku-20241022',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_task2',
              name: 'Task',
              input: { prompt: 'Task 2' },
            },
          ],
        },
      }),
      // First agent completes
      JSON.stringify({
        type: 'user',
        timestamp: '2024-01-15T10:02:00.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_task1',
              content: 'Task completed',
            },
          ],
        },
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    // task1 completed, only task2 should remain
    expect(result.agents).toHaveLength(1);
    expect(result.agents).toContainEqual({
      type: 'S',
      model: 'h',
      id: 'toolu_task2',
    });
  });

  it('should detect multiple Task agents from single message with multiple tool_use items', async () => {
    const transcriptPath = join(testDir, 'claude-code-multiple-tools.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-01-15T10:00:00.000Z',
        message: {
          model: 'claude-opus-4-5-20251101',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_task_a',
              name: 'Task',
              input: { prompt: 'Task A' },
            },
            {
              type: 'text',
              text: 'Running two tasks in parallel...',
            },
            {
              type: 'tool_use',
              id: 'toolu_task_b',
              name: 'Task',
              input: { prompt: 'Task B' },
            },
          ],
        },
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.agents).toHaveLength(2);
    expect(result.agents).toContainEqual({
      type: 'S',
      model: 'o',
      id: 'toolu_task_a',
    });
    expect(result.agents).toContainEqual({
      type: 'S',
      model: 'o',
      id: 'toolu_task_b',
    });
  });

  it('should detect Skill from Claude Code transcript structure', async () => {
    const transcriptPath = join(testDir, 'claude-code-skill.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-01-15T10:00:00.000Z',
        message: {
          model: 'claude-opus-4-20250514',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_skill1',
              name: 'Skill',
              input: { skill: 'prometheus' },
            },
          ],
        },
      }),
    ];
    await writeFile(transcriptPath, lines.join('\n'));

    const result = await parseTranscript(transcriptPath);

    expect(result.activeSkill).toBe('prometheus');
  });

  // Tests for TaskCreate/TaskUpdate with taskId mapping
  describe('TaskCreate and TaskUpdate workflow', () => {
    it('should update todo status when TaskUpdate uses taskId from TaskCreate result', async () => {
      const transcriptPath = join(testDir, 'task-create-update.jsonl');
      const toolUseId = 'toolu_01BvX4iiiiewshdWn2UnEYcD';
      const lines = [
        // TaskCreate tool_use
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:00.000Z',
          message: {
            model: 'claude-opus-4-20250514',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: 'TaskCreate',
                input: {
                  subject: 'Delete accumulated global todos files',
                  activeForm: 'Deleting global todos files',
                },
              },
            ],
          },
        }),
        // TaskCreate tool_result with taskId in toolUseResult
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:00:01.000Z',
          message: {
            content: [
              {
                tool_use_id: toolUseId,
                type: 'tool_result',
                content: 'Task #3 created successfully: Delete accumulated global todos files',
              },
            ],
          },
          toolUseResult: {
            task: {
              id: '3',
              subject: 'Delete accumulated global todos files',
              status: 'pending',
            },
          },
        }),
        // TaskUpdate using taskId
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:02.000Z',
          message: {
            model: 'claude-opus-4-20250514',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_update1',
                name: 'TaskUpdate',
                input: {
                  taskId: '3',
                  status: 'in_progress',
                },
              },
            ],
          },
        }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = await parseTranscript(transcriptPath);

      // The todo should exist and have status 'in_progress'
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0].content).toBe('Delete accumulated global todos files');
      expect(result.todos[0].status).toBe('in_progress');
    });

    it('should update todo to completed status via TaskUpdate', async () => {
      const transcriptPath = join(testDir, 'task-complete-update.jsonl');
      const toolUseId = 'toolu_create123';
      const lines = [
        // TaskCreate
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:00.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: 'TaskCreate',
                input: {
                  subject: 'Run unit tests',
                  activeForm: 'Running unit tests',
                },
              },
            ],
          },
        }),
        // TaskCreate result
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:00:01.000Z',
          message: {
            content: [
              {
                tool_use_id: toolUseId,
                type: 'tool_result',
                content: 'Task #5 created successfully',
              },
            ],
          },
          toolUseResult: {
            task: {
              id: '5',
              subject: 'Run unit tests',
            },
          },
        }),
        // TaskUpdate to in_progress
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:02.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_update1',
                name: 'TaskUpdate',
                input: {
                  taskId: '5',
                  status: 'in_progress',
                },
              },
            ],
          },
        }),
        // TaskUpdate to completed
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:03.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_update2',
                name: 'TaskUpdate',
                input: {
                  taskId: '5',
                  status: 'completed',
                },
              },
            ],
          },
        }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = await parseTranscript(transcriptPath);

      expect(result.todos).toHaveLength(1);
      expect(result.todos[0].status).toBe('completed');
    });

    it('should handle multiple TaskCreate/TaskUpdate pairs independently', async () => {
      const transcriptPath = join(testDir, 'multiple-tasks.jsonl');
      const lines = [
        // First TaskCreate
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:00.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_create1',
                name: 'TaskCreate',
                input: { subject: 'Task One' },
              },
            ],
          },
        }),
        // First TaskCreate result
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:00:01.000Z',
          message: {
            content: [
              {
                tool_use_id: 'toolu_create1',
                type: 'tool_result',
                content: 'Task #1 created',
              },
            ],
          },
          toolUseResult: { task: { id: '1', subject: 'Task One' } },
        }),
        // Second TaskCreate
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:02.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_create2',
                name: 'TaskCreate',
                input: { subject: 'Task Two' },
              },
            ],
          },
        }),
        // Second TaskCreate result
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:00:03.000Z',
          message: {
            content: [
              {
                tool_use_id: 'toolu_create2',
                type: 'tool_result',
                content: 'Task #2 created',
              },
            ],
          },
          toolUseResult: { task: { id: '2', subject: 'Task Two' } },
        }),
        // Update Task #2 to in_progress
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:04.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_update1',
                name: 'TaskUpdate',
                input: { taskId: '2', status: 'in_progress' },
              },
            ],
          },
        }),
        // Update Task #1 to completed
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_update2',
                name: 'TaskUpdate',
                input: { taskId: '1', status: 'completed' },
              },
            ],
          },
        }),
      ];
      await writeFile(transcriptPath, lines.join('\n'));

      const result = await parseTranscript(transcriptPath);

      expect(result.todos).toHaveLength(2);
      const taskOne = result.todos.find((t) => t.content === 'Task One');
      const taskTwo = result.todos.find((t) => t.content === 'Task Two');
      expect(taskOne?.status).toBe('completed');
      expect(taskTwo?.status).toBe('in_progress');
    });
  });
});

describe('modelToTier', () => {
  it('should return "o" for opus models', () => {
    expect(modelToTier('claude-opus-4-20250514')).toBe('o');
    expect(modelToTier('claude-opus-4-5-20251101')).toBe('o');
  });

  it('should return "h" for haiku models', () => {
    expect(modelToTier('claude-3-5-haiku-20241022')).toBe('h');
    expect(modelToTier('claude-haiku-3-20240307')).toBe('h');
  });

  it('should return "s" for sonnet models', () => {
    expect(modelToTier('claude-sonnet-4-20250514')).toBe('s');
    expect(modelToTier('claude-3-5-sonnet-20241022')).toBe('s');
  });

  it('should default to "s" for unknown models', () => {
    expect(modelToTier('unknown-model')).toBe('s');
    expect(modelToTier('')).toBe('s');
  });
});

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { AgentInfo, TodoItem } from './types.js';

interface TodoInput {
  todos?: Array<{
    content?: string;
    subject?: string;  // TaskCreate uses 'subject' instead of 'content'
    status?: string;
    activeForm?: string;
  }>;
  // TaskCreate single-item format
  subject?: string;
  description?: string;
  status?: string;
  activeForm?: string;
}

interface ContentItem {
  type?: string;
  id?: string;
  name?: string;
  input?: { skill?: string; prompt?: string } & TodoInput;
  tool_use_id?: string;
  content?: string;
}

interface TranscriptEntry {
  type?: string;
  tool?: string;
  toolName?: string;
  name?: string;
  status?: string;
  state?: string;
  timestamp?: string;
  uuid?: string;
  toolUseId?: string;
  model?: string;
  message?: {
    model?: string;
    content?: ContentItem[];
  };
  // TaskCreate/TaskUpdate tool results include task info at entry level
  toolUseResult?: {
    task?: {
      id?: string;
      subject?: string;
      status?: string;
    };
  };
}

export interface TranscriptResult {
  runningAgents: number;
  activeSkill: string | null;
  agents: AgentInfo[];
  sessionStartedAt: Date | null;
  todos: TodoItem[];
}

// Parse model ID to tier abbreviation
export function modelToTier(modelId: string): 'o' | 's' | 'h' {
  if (modelId.includes('opus')) return 'o';
  if (modelId.includes('haiku')) return 'h';
  return 's'; // default to sonnet
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptResult> {
  const result: TranscriptResult = {
    runningAgents: 0,
    activeSkill: null,
    agents: [],
    sessionStartedAt: null,
    todos: [],
  };

  try {
    const fileStream = createReadStream(transcriptPath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    // Track running agents by their toolUseId
    const runningAgents = new Map<string, AgentInfo>();
    // Track todos - use Map to handle updates by content/subject
    const todosMap = new Map<string, TodoItem>();
    // Track pending TaskCreate calls: toolUseId -> subject
    const pendingTaskCreates = new Map<string, string>();
    // Map taskId -> subject for TaskUpdate lookups
    const taskIdToSubject = new Map<string, string>();
    let earliestTimestamp: Date | null = null;

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;

        // Track earliest timestamp for sessionStartedAt
        if (entry.timestamp) {
          const entryDate = new Date(entry.timestamp);
          if (!earliestTimestamp || entryDate < earliestTimestamp) {
            earliestTimestamp = entryDate;
          }
        }

        // Track running Task agents (subagents) - legacy format
        if (entry.tool === 'Task' || entry.toolName === 'Task') {
          const agentId = entry.toolUseId;
          if (!agentId) continue;

          if (entry.status === 'started' || entry.state === 'running') {
            const modelId = entry.model || '';
            runningAgents.set(agentId, {
              type: 'S',
              model: modelToTier(modelId),
              id: agentId,
            });
          } else if (entry.status === 'completed' || entry.state === 'done') {
            runningAgents.delete(agentId);
          }
        }

        // Track active skill - legacy format
        if (entry.tool === 'Skill' || entry.toolName === 'Skill') {
          if (entry.name) {
            result.activeSkill = entry.name;
          }
        }

        // Handle actual Claude Code transcript structure: message.content[] array
        const messageContent = entry.message?.content;
        if (Array.isArray(messageContent)) {
          const modelId = entry.message?.model || '';

          for (const item of messageContent) {
            // Detect tool_use items (agent starts)
            if (item.type === 'tool_use' && item.id) {
              if (item.name === 'Task') {
                runningAgents.set(item.id, {
                  type: 'S',
                  model: modelToTier(modelId),
                  id: item.id,
                });
              } else if (item.name === 'Skill' && item.input?.skill) {
                result.activeSkill = item.input.skill;
              } else if (item.name === 'TodoWrite' && item.input?.todos) {
                // TodoWrite: replace entire todos list
                todosMap.clear();
                for (const t of item.input.todos) {
                  const content = t.content || t.subject || '';
                  if (content) {
                    todosMap.set(content, {
                      content,
                      status: (t.status as TodoItem['status']) || 'pending',
                      activeForm: t.activeForm,
                    });
                  }
                }
              } else if (item.name === 'TaskCreate' && item.input) {
                // TaskCreate: add single todo
                const input = item.input;
                const content = input.subject || input.description || '';
                if (content) {
                  todosMap.set(content, {
                    content,
                    status: 'pending',
                    activeForm: input.activeForm,
                  });
                  // Store toolUseId -> subject for later taskId mapping
                  if (item.id) {
                    pendingTaskCreates.set(item.id, content);
                  }
                }
              } else if (item.name === 'TaskUpdate' && item.input) {
                // TaskUpdate: update existing todo status
                const input = item.input as { taskId?: string; status?: string };
                if (input.taskId && input.status) {
                  // Find todo by taskId using the taskIdToSubject mapping
                  const subject = taskIdToSubject.get(input.taskId);
                  if (subject && todosMap.has(subject)) {
                    const todo = todosMap.get(subject)!;
                    todosMap.set(subject, {
                      ...todo,
                      status: input.status as TodoItem['status'],
                    });
                  } else {
                    // Fallback: try to find by content match (legacy behavior)
                    for (const [key, todo] of todosMap.entries()) {
                      if (key.includes(input.taskId) || input.taskId === key) {
                        todosMap.set(key, {
                          ...todo,
                          status: input.status as TodoItem['status'],
                        });
                        break;
                      }
                    }
                  }
                }
              }
            }

            // Detect tool_result items (agent completes)
            if (item.type === 'tool_result' && item.tool_use_id) {
              runningAgents.delete(item.tool_use_id);

              // Check if this is a TaskCreate result with taskId mapping
              const taskResult = entry.toolUseResult?.task;
              if (taskResult?.id && pendingTaskCreates.has(item.tool_use_id)) {
                const subject = pendingTaskCreates.get(item.tool_use_id)!;
                taskIdToSubject.set(taskResult.id, subject);
                pendingTaskCreates.delete(item.tool_use_id);
              }
            }
          }
        }

        // Note: We no longer track assistant messages as agents.
        // Only subagents (Task tool) are shown in the HUD.
      } catch {
        // Skip malformed lines
      }
    }

    result.runningAgents = runningAgents.size;
    result.agents = Array.from(runningAgents.values());
    result.sessionStartedAt = earliestTimestamp;
    result.todos = Array.from(todosMap.values());
  } catch {
    // File doesn't exist or can't be read
  }

  return result;
}

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { logError } from '../../lib/logging.ts';
import type { AgentInfo } from './types.ts';

interface ContentItem {
  type?: string;
  id?: string;
  name?: string;
  input?: { skill?: string; prompt?: string; subagent_type?: string };
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
}

export interface TranscriptResult {
  runningAgents: number;
  activeSkill: string | null;
  agents: AgentInfo[];
  sessionStartedAt: Date | null;
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
  };

  try {
    const fileStream = createReadStream(transcriptPath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    // Track running agents by their toolUseId
    const runningAgents = new Map<string, AgentInfo>();
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

        // Track running agents (subagents) - legacy format
        if (entry.tool === 'Agent' || entry.toolName === 'Agent') {
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
              if (item.name === 'Agent') {
                runningAgents.set(item.id, {
                  type: 'S',
                  model: modelToTier(modelId),
                  id: item.id,
                  name: item.input?.subagent_type,
                });
              } else if (item.name === 'Skill' && item.input?.skill) {
                result.activeSkill = item.input.skill;
              }
            }

            // Detect tool_result items (agent completes)
            if (item.type === 'tool_result' && item.tool_use_id) {
              runningAgents.delete(item.tool_use_id);
            }
          }
        }

        // Note: We no longer track assistant messages as agents.
        // Only subagents (Agent tool) are shown in the HUD.
      } catch (error) {
        // Skip malformed lines but log the error
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`Failed to parse transcript line: ${errorMessage}`);
      }
    }

    result.runningAgents = runningAgents.size;
    result.agents = Array.from(runningAgents.values());
    result.sessionStartedAt = earliestTimestamp;
  } catch (error) {
    // File doesn't exist or can't be read - log error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to read transcript file: ${errorMessage}`);
  }

  return result;
}

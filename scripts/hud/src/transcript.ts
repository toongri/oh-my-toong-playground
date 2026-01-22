import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { AgentInfo } from './types.js';

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

        // Track running Task agents (subagents)
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

        // Track active skill
        if (entry.tool === 'Skill' || entry.toolName === 'Skill') {
          if (entry.name) {
            result.activeSkill = entry.name;
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
  } catch {
    // File doesn't exist or can't be read
  }

  return result;
}

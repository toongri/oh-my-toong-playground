import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STATE_FILE = path.join(os.homedir(), '.claude', '.session-stats.json');

interface SessionData {
  tool_counts: Record<string, number>;
  last_tool: string;
  total_calls: number;
  started_at: number;
  updated_at?: number;
}

interface StatsData {
  sessions: Record<string, SessionData>;
}

function loadStats(): StatsData {
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(content) as StatsData;
  } catch {
    return { sessions: {} };
  }
}

function saveStats(stats: StatsData): void {
  try {
    const dir = path.dirname(STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(stats, null, 2));
  } catch {
    // Fail silently
  }
}

export function updateStats(toolName: string, sessionId: string): number {
  const stats = loadStats();

  if (!stats.sessions[sessionId]) {
    stats.sessions[sessionId] = {
      tool_counts: {},
      last_tool: '',
      total_calls: 0,
      started_at: Math.floor(Date.now() / 1000),
    };
  }

  const session = stats.sessions[sessionId];
  session.tool_counts[toolName] = (session.tool_counts[toolName] || 0) + 1;
  session.last_tool = toolName;
  session.total_calls = (session.total_calls || 0) + 1;
  session.updated_at = Math.floor(Date.now() / 1000);

  saveStats(stats);
  return session.tool_counts[toolName];
}

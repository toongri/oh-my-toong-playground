// src/stdin.ts
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });
    setTimeout(() => {
      if (!data) resolve(null);
    }, 100);
  });
}

// src/state.ts
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
var MAX_STATE_AGE_MS = 2 * 60 * 60 * 1e3;
async function isStateFileStale(path) {
  try {
    const fileStat = await stat(path);
    const age = Date.now() - fileStat.mtimeMs;
    return age > MAX_STATE_AGE_MS;
  } catch {
    return true;
  }
}
async function readJsonFile(path) {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function findStateFile(cwd, filename) {
  const localPath = join(cwd, ".claude", "sisyphus", filename);
  if (!await isStateFileStale(localPath)) {
    return readJsonFile(localPath);
  }
  return null;
}
async function readRalphState(cwd) {
  return findStateFile(cwd, "ralph-state.json");
}
async function readUltraworkState(cwd) {
  return findStateFile(cwd, "ultrawork-state.json");
}
async function readRalphVerification(cwd) {
  const verification = await findStateFile(cwd, "ralph-verification.json");
  if (verification?.created_at) {
    const createdAt = new Date(verification.created_at).getTime();
    const now = Date.now();
    const hours24 = 24 * 60 * 60 * 1e3;
    if (now - createdAt > hours24) {
      return null;
    }
  }
  return verification;
}
async function readTodos(cwd) {
  const allTodos = [];
  const sisyphusPath = join(cwd, ".claude", "sisyphus", "todos.json");
  const sisyphusTodos = await readJsonFile(sisyphusPath);
  if (sisyphusTodos?.todos) {
    allTodos.push(...sisyphusTodos.todos);
  }
  const localPath = join(cwd, ".claude", "todos.json");
  const localTodos = await readJsonFile(localPath);
  if (localTodos?.todos) {
    allTodos.push(...localTodos.todos);
  }
  const globalTodosDir = join(homedir(), ".claude", "todos");
  try {
    const files = await readdir(globalTodosDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const fileTodos = await readJsonFile(join(globalTodosDir, file));
        if (fileTodos?.todos) {
          allTodos.push(...fileTodos.todos);
        }
      }
    }
  } catch {
  }
  if (allTodos.length === 0) return null;
  const completed = allTodos.filter((t) => t.status === "completed").length;
  return { completed, total: allTodos.length };
}
async function readBackgroundTasks() {
  const tasksDir = join(homedir(), ".claude", "background-tasks");
  try {
    const files = await readdir(tasksDir);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
function calculateSessionDuration(startedAt) {
  if (!startedAt) return null;
  const now = /* @__PURE__ */ new Date();
  return Math.floor((now.getTime() - startedAt.getTime()) / 6e4);
}
async function getInProgressTodo(cwd) {
  const allTodos = [];
  const sisyphusPath = join(cwd, ".claude", "sisyphus", "todos.json");
  const sisyphusTodos = await readJsonFile(sisyphusPath);
  if (sisyphusTodos?.todos) {
    allTodos.push(...sisyphusTodos.todos);
  }
  const localPath = join(cwd, ".claude", "todos.json");
  const localTodos = await readJsonFile(localPath);
  if (localTodos?.todos) {
    allTodos.push(...localTodos.todos);
  }
  const inProgress = allTodos.find((t) => t.status === "in_progress");
  if (!inProgress) return null;
  const text = inProgress.activeForm || inProgress.content;
  return text.length > 25 ? text.substring(0, 25) + "..." : text;
}
async function isThinkingEnabled() {
  return false;
}

// src/transcript.ts
import { createReadStream } from "fs";
import { createInterface } from "readline";
function modelToTier(modelId) {
  if (modelId.includes("opus")) return "o";
  if (modelId.includes("haiku")) return "h";
  return "s";
}
async function parseTranscript(transcriptPath) {
  const result = {
    runningAgents: 0,
    activeSkill: null,
    agents: [],
    sessionStartedAt: null
  };
  try {
    const fileStream = createReadStream(transcriptPath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    const runningAgents = /* @__PURE__ */ new Map();
    let earliestTimestamp = null;
    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry.timestamp) {
          const entryDate = new Date(entry.timestamp);
          if (!earliestTimestamp || entryDate < earliestTimestamp) {
            earliestTimestamp = entryDate;
          }
        }
        if (entry.tool === "Task" || entry.toolName === "Task") {
          const agentId = entry.toolUseId;
          if (!agentId) continue;
          if (entry.status === "started" || entry.state === "running") {
            const modelId = entry.model || "";
            runningAgents.set(agentId, {
              type: "S",
              model: modelToTier(modelId),
              id: agentId
            });
          } else if (entry.status === "completed" || entry.state === "done") {
            runningAgents.delete(agentId);
          }
        }
        if (entry.tool === "Skill" || entry.toolName === "Skill") {
          if (entry.name) {
            result.activeSkill = entry.name;
          }
        }
      } catch {
      }
    }
    result.runningAgents = runningAgents.size;
    result.agents = Array.from(runningAgents.values());
    result.sessionStartedAt = earliestTimestamp;
  } catch {
  }
  return result;
}

// src/credentials.ts
import { exec } from "child_process";
import { promisify } from "util";
import { readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var execAsync = promisify(exec);
async function getOAuthToken() {
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 5e3 }
    );
    const creds = JSON.parse(stdout.trim());
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch {
  }
  try {
    const credPath = join2(homedir2(), ".claude", ".credentials.json");
    const content = await readFile2(credPath, "utf8");
    const creds = JSON.parse(content);
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch {
  }
  return null;
}

// src/cache.ts
var cache = /* @__PURE__ */ new Map();
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

// src/usage-api.ts
var CACHE_KEY = "oauth-usage";
var CACHE_TTL_MS = 3e4;
var API_URL = "https://api.anthropic.com/api/oauth/usage";
function formatResetTime(resetsAt) {
  if (!resetsAt) return "";
  const resetDate = new Date(resetsAt);
  const now = /* @__PURE__ */ new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  if (diffMs <= 0) return "0m";
  const totalMinutes = Math.floor(diffMs / 6e4);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
async function fetchRateLimits() {
  const cached = getCached(CACHE_KEY);
  if (cached) return cached;
  const token = await getOAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(API_URL, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "omt-hud/1.0.0",
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20"
      },
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const result = {
      fiveHour: data.five_hour ? {
        percent: Math.round(data.five_hour.utilization),
        resetIn: formatResetTime(data.five_hour.resets_at)
      } : null,
      sevenDay: data.seven_day ? {
        percent: Math.round(data.seven_day.utilization),
        resetIn: formatResetTime(data.seven_day.resets_at)
      } : null
    };
    setCache(CACHE_KEY, result, CACHE_TTL_MS);
    return result;
  } catch {
    return null;
  }
}

// src/types.ts
var ANSI = {
  reset: "\x1B[0m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  cyan: "\x1B[36m"
};

// src/formatter.ts
function colorize(text, color) {
  return `${color}${text}${ANSI.reset}`;
}
function getContextColor(percent) {
  if (percent > 85) return ANSI.red;
  if (percent > 70) return ANSI.yellow;
  return ANSI.green;
}
function getRalphColor(iteration, max) {
  if (iteration >= max) return ANSI.red;
  if (iteration > max * 0.7) return ANSI.yellow;
  return ANSI.green;
}
function formatMinimalStatus(contextPercent) {
  const parts = [colorize("[OMT]", ANSI.bold)];
  if (contextPercent !== null) {
    const percent = Math.min(100, Math.round(contextPercent));
    const color = getContextColor(percent);
    parts.push(colorize(`ctx:${percent}%`, color));
  } else {
    parts.push("ready");
  }
  return parts.join(" ");
}
function getPercentColor(percent) {
  if (percent > 85) return ANSI.red;
  if (percent > 70) return ANSI.yellow;
  return ANSI.green;
}
function formatStatusLineV2(data) {
  const line1Parts = [];
  const line2Parts = [];
  line1Parts.push(colorize("[OMT]", ANSI.bold));
  if (data.rateLimits) {
    const parts = [];
    if (data.rateLimits.fiveHour) {
      const { percent, resetIn } = data.rateLimits.fiveHour;
      const color = getPercentColor(percent);
      parts.push(colorize(`5h:${percent}%(${resetIn})`, color));
    }
    if (data.rateLimits.sevenDay) {
      const { percent, resetIn } = data.rateLimits.sevenDay;
      const color = getPercentColor(percent);
      parts.push(colorize(`wk:${percent}%(${resetIn})`, color));
    }
    if (parts.length > 0) {
      line1Parts.push(parts.join(" "));
    }
  }
  if (data.contextPercent !== null) {
    const percent = Math.min(100, Math.round(data.contextPercent));
    const color = getContextColor(percent);
    line1Parts.push(colorize(`ctx:${percent}%`, color));
  }
  if (data.agents.length > 0) {
    const codes = data.agents.map((a) => `${a.type}${a.model}`).join("");
    line1Parts.push(colorize(`agents:${codes}`, ANSI.green));
  }
  if (data.ralph?.active) {
    const color = getRalphColor(data.ralph.iteration, data.ralph.max_iterations);
    let text = `ralph:${data.ralph.iteration}/${data.ralph.max_iterations}`;
    if (data.ralphVerification?.pending) {
      text += ` v${data.ralphVerification.verification_attempts}/${data.ralphVerification.max_verification_attempts}`;
    }
    line1Parts.push(colorize(text, color));
  }
  if (data.ultrawork?.active) {
    line1Parts.push(colorize("ultrawork", ANSI.green));
  }
  if (data.thinkingActive) {
    line1Parts.push(colorize("thinking", ANSI.cyan));
  }
  if (data.todos) {
    const { completed, total } = data.todos;
    const color = completed === total ? ANSI.green : ANSI.yellow;
    let todoText = `todos:${completed}/${total}`;
    if (data.inProgressTodo) {
      todoText += ` (${data.inProgressTodo})`;
    }
    line2Parts.push(colorize(todoText, color));
  }
  if (data.sessionDuration !== null && data.sessionDuration > 0) {
    const hours = Math.floor(data.sessionDuration / 60);
    const mins = data.sessionDuration % 60;
    const formatted = hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
    line2Parts.push(colorize(`session:${formatted}`, ANSI.dim));
  }
  const line1 = line1Parts.join(" | ");
  const line2 = line2Parts.length > 0 ? line2Parts.join(" | ") : "";
  return line2 ? `${line1}
${line2}` : line1;
}

// src/index.ts
async function main() {
  try {
    const input = await readStdin();
    if (!input) {
      console.log(formatMinimalStatus(null));
      return;
    }
    const cwd = input.cwd || process.cwd();
    const [
      ralph,
      ultrawork,
      ralphVerification,
      todos,
      backgroundTasks,
      transcriptData,
      rateLimits,
      inProgressTodo,
      thinkingActive
    ] = await Promise.all([
      readRalphState(cwd),
      readUltraworkState(cwd),
      readRalphVerification(cwd),
      readTodos(cwd),
      readBackgroundTasks(),
      input.transcript_path ? parseTranscript(input.transcript_path) : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null }),
      fetchRateLimits(),
      getInProgressTodo(cwd),
      isThinkingEnabled()
    ]);
    const hudData = {
      contextPercent: input.context_window?.used_percentage ?? null,
      ralph,
      ultrawork,
      ralphVerification,
      todos,
      runningAgents: transcriptData.runningAgents,
      backgroundTasks,
      activeSkill: transcriptData.activeSkill,
      rateLimits,
      agents: transcriptData.agents,
      sessionDuration: calculateSessionDuration(transcriptData.sessionStartedAt),
      thinkingActive,
      inProgressTodo
    };
    console.log(formatStatusLineV2(hudData));
  } catch (error) {
    console.log(formatMinimalStatus(null));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
export {
  main
};

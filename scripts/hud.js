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
async function readRalphState(cwd, sessionId = "default") {
  return findStateFile(cwd, `ralph-state-${sessionId}.json`);
}
async function readUltraworkState(cwd, sessionId = "default") {
  return findStateFile(cwd, `ultrawork-state-${sessionId}.json`);
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
async function isThinkingEnabled() {
  return false;
}

// src/transcript.ts
import { createReadStream } from "fs";
import { createInterface } from "readline";

// ../lib/dist/logging.js
import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join as join2, dirname } from "path";
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
var initialized = false;
var logFile = "";
var componentName = "";
function getLogLevel() {
  const levelStr = process.env.OMT_LOG_LEVEL?.toUpperCase();
  switch (levelStr) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}
function shouldLog(level) {
  return level >= getLogLevel();
}
function levelName(level) {
  switch (level) {
    case LogLevel.DEBUG:
      return "DEBUG";
    case LogLevel.INFO:
      return "INFO";
    case LogLevel.WARN:
      return "WARN";
    case LogLevel.ERROR:
      return "ERROR";
    default:
      return "UNKNOWN";
  }
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, "-");
}
function log(level, message) {
  if (!initialized || !logFile) {
    return;
  }
  if (!shouldLog(level)) {
    return;
  }
  const logDir = dirname(logFile);
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const ts = timestamp();
    const lvl = levelName(level);
    const entry = `[${ts}] [${lvl}] [${componentName}] ${message}
`;
    appendFileSync(logFile, entry, "utf-8");
  } catch {
  }
}
function initLogger(component, projectRoot, sessionId) {
  if (!projectRoot) {
    initialized = false;
    return;
  }
  componentName = component;
  const sanitizedSession = sanitizeSessionId(sessionId || "default");
  const logDir = join2(projectRoot, ".claude", "sisyphus", "logs");
  logFile = join2(logDir, `${component}-${sanitizedSession}.log`);
  initialized = true;
}
function logInfo(message) {
  log(LogLevel.INFO, message);
}
function logError(message) {
  log(LogLevel.ERROR, message);
}
function logStart() {
  logInfo("========== START ==========");
}
function logEnd() {
  logInfo("========== END ==========");
}

// src/transcript.ts
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
        const messageContent = entry.message?.content;
        if (Array.isArray(messageContent)) {
          const modelId = entry.message?.model || "";
          for (const item of messageContent) {
            if (item.type === "tool_use" && item.id) {
              if (item.name === "Task") {
                runningAgents.set(item.id, {
                  type: "S",
                  model: modelToTier(modelId),
                  id: item.id,
                  name: item.input?.subagent_type
                });
              } else if (item.name === "Skill" && item.input?.skill) {
                result.activeSkill = item.input.skill;
              }
            }
            if (item.type === "tool_result" && item.tool_use_id) {
              runningAgents.delete(item.tool_use_id);
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`Failed to parse transcript line: ${errorMessage}`);
      }
    }
    result.runningAgents = runningAgents.size;
    result.agents = Array.from(runningAgents.values());
    result.sessionStartedAt = earliestTimestamp;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to read transcript file: ${errorMessage}`);
  }
  return result;
}

// src/credentials.ts
import { exec } from "child_process";
import { promisify } from "util";
import { readFile as readFile2 } from "fs/promises";
import { join as join3 } from "path";
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
    const credPath = join3(homedir2(), ".claude", ".credentials.json");
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
    const names = data.agents.map((a) => a.name || `${a.type}${a.model}`).join(", ");
    line1Parts.push(colorize(`agents:${names}`, ANSI.green));
  }
  if (data.thinkingActive) {
    line1Parts.push(colorize("thinking", ANSI.cyan));
  }
  if (data.ralph?.active) {
    const color = getRalphColor(data.ralph.iteration, data.ralph.max_iterations);
    let text = `ralph:${data.ralph.iteration}/${data.ralph.max_iterations}`;
    if (data.ralph.linked_ultrawork) {
      text += "+";
    }
    if (data.ralph.oracle_feedback && data.ralph.oracle_feedback.length > 0) {
      text += ` fb:${data.ralph.oracle_feedback.length}`;
    }
    line2Parts.push(colorize(text, color));
  }
  if (data.ultrawork?.active && !data.ultrawork.linked_to_ralph) {
    line2Parts.push(colorize("ultrawork", ANSI.green));
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
function toNonBreakingSpaces(text) {
  return text.replace(/ /g, "\xA0");
}
async function main() {
  try {
    const input = await readStdin();
    if (!input) {
      console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
      return;
    }
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id || "default";
    initLogger("hud", cwd, sessionId);
    logStart();
    logInfo(`Input: transcript_path=${input.transcript_path}, cwd=${cwd}`);
    const [
      ralph,
      ultrawork,
      backgroundTasks,
      transcriptData,
      rateLimits,
      thinkingActive
    ] = await Promise.all([
      readRalphState(cwd, sessionId),
      readUltraworkState(cwd, sessionId),
      readBackgroundTasks(),
      input.transcript_path ? parseTranscript(input.transcript_path) : Promise.resolve({ runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null }),
      fetchRateLimits(),
      isThinkingEnabled()
    ]);
    logInfo(`Transcript parsed: runningAgents=${transcriptData.runningAgents}`);
    const hudData = {
      contextPercent: input.context_window?.used_percentage ?? null,
      ralph,
      ultrawork,
      runningAgents: transcriptData.runningAgents,
      backgroundTasks,
      activeSkill: transcriptData.activeSkill,
      rateLimits,
      agents: transcriptData.agents,
      sessionDuration: calculateSessionDuration(transcriptData.sessionStartedAt),
      thinkingActive
    };
    console.log(toNonBreakingSpaces(formatStatusLineV2(hudData)));
    logEnd();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`HUD error: ${errorMessage}`);
    console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
export {
  main
};

// src/stdin.ts
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}
function parseInput(raw) {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
  }
  const sessionId = input.sessionId || input.session_id || "default";
  const directory = input.cwd || process.cwd();
  const transcriptPath = input.transcript_path || null;
  return { sessionId, directory, transcriptPath };
}

// src/utils.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname } from "path";
function getProjectRoot(directory) {
  let dir = directory.replace(/\/.omt$/, "").replace(/\/.claude$/, "");
  while (dir !== "/" && dir !== "." && dir) {
    if (existsSync(`${dir}/.git`) || existsSync(`${dir}/CLAUDE.md`) || existsSync(`${dir}/package.json`)) {
      return dir;
    }
    dir = dirname(dir);
  }
  return directory.replace(/\/.omt$/, "");
}
function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}
function readFileOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function writeFileSafe(path, content) {
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf8");
}
function deleteFile(path) {
  try {
    unlinkSync(path);
  } catch {
  }
}
function generateAttemptId(sessionId, directory) {
  if (sessionId && sessionId !== "default") {
    return sessionId;
  }
  let hash = 0;
  for (const char of directory) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

// src/state.ts
var MAX_BLOCK_COUNT = 5;
function readRalphState(projectRoot, sessionId) {
  const path = `${projectRoot}/.omt/ralph-state-${sessionId}.json`;
  const content = readFileOrNull(path);
  if (!content) return null;
  try {
    const state = JSON.parse(content);
    return state.active ? state : null;
  } catch {
    return null;
  }
}
function updateRalphState(projectRoot, sessionId, state) {
  const path = `${projectRoot}/.omt/ralph-state-${sessionId}.json`;
  writeFileSafe(path, JSON.stringify(state, null, 2));
}
function cleanupRalphState(projectRoot, sessionId) {
  deleteFile(`${projectRoot}/.omt/ralph-state-${sessionId}.json`);
}
function getBlockCount(stateDir, attemptId) {
  const content = readFileOrNull(`${stateDir}/block-count-${attemptId}`);
  return content ? parseInt(content, 10) || 0 : 0;
}
function incrementBlockCount(stateDir, attemptId) {
  const current = getBlockCount(stateDir, attemptId);
  ensureDir(stateDir);
  writeFileSafe(`${stateDir}/block-count-${attemptId}`, String(current + 1));
}
function cleanupBlockCountFiles(stateDir, attemptId) {
  deleteFile(`${stateDir}/block-count-${attemptId}`);
}

// ../lib/dist/logging.js
import { mkdirSync as mkdirSync2, appendFileSync, existsSync as existsSync2 } from "fs";
import { join, dirname as dirname2 } from "path";
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
  const logDir = dirname2(logFile);
  try {
    if (!existsSync2(logDir)) {
      mkdirSync2(logDir, { recursive: true });
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
  const logDir = join(projectRoot, ".omt", "logs");
  logFile = join(logDir, `${component}-${sanitizedSession}.log`);
  initialized = true;
}
function logDebug(message) {
  log(LogLevel.DEBUG, message);
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

// src/transcript-detector.ts
var PROMISE_PATTERN = /<promise>\s*DONE\s*<\/promise>/i;
var ORACLE_APPROVED_PATTERN = /<oracle-approved>.*VERIFIED_COMPLETE.*<\/oracle-approved>/i;
var ORACLE_REJECTION_PATTERNS = [
  /oracle.*rejected/i,
  /verification.*failed/i,
  /issues?\s*found/i,
  /not\s+complete/i
];
var FEEDBACK_PATTERN = /(issue|problem|reason):\s*([^\n]+)/gi;
function detectCompletionPromise(transcriptPath) {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  const detected = PROMISE_PATTERN.test(content);
  if (detected) {
    logDebug("detected completion promise <promise>DONE</promise>");
  }
  return detected;
}
function detectOracleApproval(transcriptPath) {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  const detected = ORACLE_APPROVED_PATTERN.test(content);
  if (detected) {
    logDebug("detected oracle approval <oracle-approved>VERIFIED_COMPLETE</oracle-approved>");
  }
  return detected;
}
function detectOracleRejection(transcriptPath) {
  if (!transcriptPath) return null;
  const content = readFileOrNull(transcriptPath);
  if (!content) return null;
  const hasRejection = ORACLE_REJECTION_PATTERNS.some((pattern) => pattern.test(content));
  if (!hasRejection) return null;
  logDebug("detected oracle rejection pattern");
  const feedbackMatches = [];
  let match;
  while ((match = FEEDBACK_PATTERN.exec(content)) !== null) {
    feedbackMatches.push(match[2].trim());
    if (feedbackMatches.length >= 5) break;
  }
  if (feedbackMatches.length > 0) {
    logDebug(`extracted rejection feedback: ${feedbackMatches.join(", ")}`);
  }
  return feedbackMatches.length > 0 ? feedbackMatches.join(" ") : "";
}
function analyzeTranscript(transcriptPath) {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath),
    hasOracleApproval: detectOracleApproval(transcriptPath),
    oracleRejectionFeedback: detectOracleRejection(transcriptPath),
    incompleteTodoCount: 0
    // Deprecated: now using file-based task counting
  };
}

// src/decision.ts
function formatBlockOutput(reason) {
  return {
    decision: "block",
    reason
  };
}
function formatContinueOutput() {
  return { continue: true };
}
var MAX_PROMPT_LENGTH = 500;
var MAX_FEEDBACK_LENGTH = 500;
var MAX_FEEDBACK_COUNT = 3;
function truncateText(text, maxLength) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...[truncated]";
  }
  return text;
}
function buildRalphContinuationMessage(iteration, maxIterations, prompt, promise, oracleFeedback) {
  const truncatedPrompt = truncateText(prompt, MAX_PROMPT_LENGTH);
  const limitedFeedback = oracleFeedback.slice(-MAX_FEEDBACK_COUNT).map((fb) => truncateText(fb, MAX_FEEDBACK_LENGTH));
  let feedbackSection = "";
  if (limitedFeedback.length > 0) {
    feedbackSection = `
**Previous Oracle Feedback:**
${limitedFeedback.join("\n")}
`;
  }
  return `<ralph-loop-continuation>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

Your previous attempt did not include oracle approval. The work is NOT verified complete yet.
${feedbackSection}
CRITICAL INSTRUCTIONS:
1. Review your progress and the original task
2. Check your todo list - are ALL items marked complete?
3. Spawn Oracle to verify: Task(subagent_type="oracle", prompt="Verify: ${truncatedPrompt}")
4. If Oracle approves, output: <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
5. Then output: <promise>${promise}</promise>
6. Do NOT stop until verified by Oracle

Original task: ${truncatedPrompt}

</ralph-loop-continuation>

---
`;
}
function buildTodoContinuationMessage(incompleteCount) {
  return `<todo-continuation>

[INCOMPLETE TASKS DETECTED - ${incompleteCount} remaining]

Your task list still has incomplete items. Please review and complete them.

INSTRUCTIONS:
1. Check your todo list with TaskList
2. Complete remaining tasks
3. Mark each task as completed when done

Do NOT stop until all tasks are completed.

</todo-continuation>

---
`;
}
function makeDecision(context) {
  const { projectRoot, sessionId, transcriptPath, incompleteTodoCount } = context;
  const stateDir = `${projectRoot}/.omt/state`;
  const attemptId = generateAttemptId(sessionId, projectRoot);
  ensureDir(stateDir);
  const transcript = analyzeTranscript(transcriptPath);
  const ralphState = readRalphState(projectRoot, sessionId);
  if (ralphState && ralphState.active) {
    if (ralphState.iteration >= ralphState.max_iterations) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    if (incompleteTodoCount > 0) {
      const newIteration2 = ralphState.iteration + 1;
      const oracleFeedback2 = ralphState.oracle_feedback || [];
      const updatedState2 = {
        ...ralphState,
        iteration: newIteration2,
        oracle_feedback: oracleFeedback2
      };
      updateRalphState(projectRoot, sessionId, updatedState2);
      const message2 = buildRalphContinuationMessage(
        newIteration2,
        ralphState.max_iterations,
        ralphState.prompt,
        ralphState.completion_promise || "DONE",
        oracleFeedback2
      );
      return formatBlockOutput(message2);
    }
    if (transcript.hasOracleApproval) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    const oracleFeedback = ralphState.oracle_feedback || [];
    let newIteration = ralphState.iteration;
    if (transcript.oracleRejectionFeedback) {
      oracleFeedback.push(transcript.oracleRejectionFeedback);
      newIteration = ralphState.iteration + 1;
    }
    const updatedState = {
      ...ralphState,
      iteration: newIteration,
      oracle_feedback: oracleFeedback
    };
    updateRalphState(projectRoot, sessionId, updatedState);
    const message = buildRalphContinuationMessage(
      newIteration,
      ralphState.max_iterations,
      ralphState.prompt,
      ralphState.completion_promise || "DONE",
      oracleFeedback
    );
    return formatBlockOutput(message);
  }
  if (incompleteTodoCount > 0) {
    const blockCount = getBlockCount(stateDir, attemptId);
    if (blockCount >= MAX_BLOCK_COUNT) {
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    incrementBlockCount(stateDir, attemptId);
    const message = buildTodoContinuationMessage(incompleteTodoCount);
    return formatBlockOutput(message);
  }
  return formatContinueOutput();
}

// ../lib/dist/task-reader.js
import { readdir, readFile } from "fs/promises";
import { join as join2 } from "path";
async function readTasksFromDirectory(directoryPath) {
  let files;
  try {
    files = await readdir(directoryPath);
  } catch {
    return [];
  }
  const tasks = [];
  for (const file of files) {
    if (!file.endsWith(".json"))
      continue;
    const filePath = join2(directoryPath, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const task = JSON.parse(content);
      tasks.push(task);
    } catch {
      console.error(`Warning: Failed to parse task file: ${file}`);
    }
  }
  return tasks;
}
function countIncompleteTasks(tasks) {
  return tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
}

// src/index.ts
import { join as join3 } from "path";
async function main() {
  try {
    const rawInput = await readStdin();
    const input = parseInput(rawInput);
    const projectRoot = getProjectRoot(input.directory);
    initLogger("persistent-mode", projectRoot, input.sessionId);
    logStart();
    logInfo(`stop hook invoked, sessionId=${input.sessionId}`);
    const homeDir = process.env.HOME || "/tmp";
    const tasksDir = join3(homeDir, ".claude", "tasks", input.sessionId);
    const tasks = await readTasksFromDirectory(tasksDir);
    const incompleteTodoCount = countIncompleteTasks(tasks);
    logDebug(`tasks from ${tasksDir}: total=${tasks.length}, incomplete=${incompleteTodoCount}`);
    const context = {
      projectRoot,
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      incompleteTodoCount
    };
    const output = makeDecision(context);
    if (output.decision) {
      logInfo(`decision=${output.decision}`);
    } else if (output.continue !== void 0) {
      logInfo(`decision=continue`);
    }
    console.log(JSON.stringify(output));
    logEnd();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`error: ${errorMessage}`);
    console.error("persistent-mode error:", error);
    console.log('{"continue": true}');
    logEnd();
  }
}
main();
export {
  main
};

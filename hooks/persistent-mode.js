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
  let dir = directory.replace(/\/.claude\/sisyphus$/, "").replace(/\/.claude$/, "");
  while (dir !== "/" && dir !== "." && dir) {
    if (existsSync(`${dir}/.git`) || existsSync(`${dir}/CLAUDE.md`) || existsSync(`${dir}/package.json`)) {
      return dir;
    }
    dir = dirname(dir);
  }
  return directory.replace(/\/.claude\/sisyphus$/, "");
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
import { homedir } from "os";
var MAX_TODO_CONTINUATION_ATTEMPTS = 5;
function readRalphState(projectRoot, sessionId) {
  const path = `${projectRoot}/.claude/sisyphus/ralph-state-${sessionId}.json`;
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
  const path = `${projectRoot}/.claude/sisyphus/ralph-state-${sessionId}.json`;
  writeFileSafe(path, JSON.stringify(state, null, 2));
}
function cleanupRalphState(projectRoot, sessionId) {
  deleteFile(`${projectRoot}/.claude/sisyphus/ralph-state-${sessionId}.json`);
}
function readUltraworkState(projectRoot, sessionId) {
  const paths = [
    `${projectRoot}/.claude/sisyphus/ultrawork-state-${sessionId}.json`,
    `${homedir()}/.claude/ultrawork-state-${sessionId}.json`
  ];
  for (const path of paths) {
    const content = readFileOrNull(path);
    if (content) {
      try {
        const state = JSON.parse(content);
        return state.active ? state : null;
      } catch {
        continue;
      }
    }
  }
  return null;
}
function updateUltraworkState(projectRoot, sessionId, state) {
  const path = `${projectRoot}/.claude/sisyphus/ultrawork-state-${sessionId}.json`;
  writeFileSafe(path, JSON.stringify(state, null, 2));
}
function cleanupUltraworkState(projectRoot, sessionId) {
  deleteFile(`${projectRoot}/.claude/sisyphus/ultrawork-state-${sessionId}.json`);
  deleteFile(`${homedir()}/.claude/ultrawork-state-${sessionId}.json`);
}
function getAttemptCount(stateDir, attemptId) {
  const content = readFileOrNull(`${stateDir}/todo-attempts-${attemptId}`);
  return content ? parseInt(content, 10) || 0 : 0;
}
function incrementAttempts(stateDir, attemptId) {
  const current = getAttemptCount(stateDir, attemptId);
  ensureDir(stateDir);
  writeFileSafe(`${stateDir}/todo-attempts-${attemptId}`, String(current + 1));
}
function resetAttempts(stateDir, attemptId) {
  deleteFile(`${stateDir}/todo-attempts-${attemptId}`);
}
function getTodoCount(stateDir, attemptId) {
  const content = readFileOrNull(`${stateDir}/todo-count-${attemptId}`);
  return content ? parseInt(content, 10) : -1;
}
function saveTodoCount(stateDir, attemptId, count) {
  ensureDir(stateDir);
  writeFileSafe(`${stateDir}/todo-count-${attemptId}`, String(count));
}
function cleanupAttemptFiles(stateDir, attemptId) {
  deleteFile(`${stateDir}/todo-attempts-${attemptId}`);
  deleteFile(`${stateDir}/todo-count-${attemptId}`);
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
  const logDir = join(projectRoot, ".claude", "sisyphus", "logs");
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
function countIncompleteTodos(transcriptPath) {
  if (!transcriptPath) return 0;
  const content = readFileOrNull(transcriptPath);
  if (!content) return 0;
  const todos = /* @__PURE__ */ new Map();
  const createResultPattern = /Task #(\d+) created successfully/g;
  let createMatch;
  while ((createMatch = createResultPattern.exec(content)) !== null) {
    const [, taskId] = createMatch;
    todos.set(taskId, "pending");
  }
  if (todos.size > 0) {
    logDebug(`detected ${todos.size} TaskCreate result(s)`);
  }
  const updatePattern = /"name":\s*"TaskUpdate"[\s\S]*?"taskId":\s*"(\d+)"[\s\S]*?"status":\s*"([^"]+)"/g;
  let updateMatch;
  let updateCount = 0;
  while ((updateMatch = updatePattern.exec(content)) !== null) {
    const [, taskId, status] = updateMatch;
    if (todos.has(taskId)) {
      todos.set(taskId, status);
      updateCount++;
    }
  }
  if (updateCount > 0) {
    logDebug(`detected ${updateCount} TaskUpdate(s) affecting tracked tasks`);
  }
  let incomplete = 0;
  for (const status of todos.values()) {
    if (status === "pending" || status === "in_progress") {
      incomplete++;
    }
  }
  logDebug(`todo count: ${todos.size} total, ${incomplete} incomplete`);
  return incomplete;
}
function analyzeTranscript(transcriptPath) {
  return {
    hasCompletionPromise: detectCompletionPromise(transcriptPath),
    hasOracleApproval: detectOracleApproval(transcriptPath),
    oracleRejectionFeedback: detectOracleRejection(transcriptPath),
    incompleteTodoCount: countIncompleteTodos(transcriptPath)
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
function buildRalphContinuationMessage(iteration, maxIterations, prompt, promise, oracleFeedback) {
  let feedbackSection = "";
  if (oracleFeedback.length > 0) {
    feedbackSection = `
**Previous Oracle Feedback:**
${oracleFeedback.join("\n")}
`;
  }
  return `<ralph-loop-continuation>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

Your previous attempt did not include oracle approval. The work is NOT verified complete yet.
${feedbackSection}
CRITICAL INSTRUCTIONS:
1. Review your progress and the original task
2. Check your todo list - are ALL items marked complete?
3. Spawn Oracle to verify: Task(subagent_type="oracle", prompt="Verify: ${prompt}")
4. If Oracle approves, output: <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
5. Then output: <promise>${promise}</promise>
6. Do NOT stop until verified by Oracle

Original task: ${prompt}

</ralph-loop-continuation>

---
`;
}
function buildUltraworkContinuationMessage(reinforcementCount, incompleteCount, originalPrompt) {
  return `<ultrawork-persistence>

[ULTRAWORK MODE STILL ACTIVE - Reinforcement #${reinforcementCount}]

Your ultrawork session is NOT complete. ${incompleteCount} incomplete todos remain.

REMEMBER THE ULTRAWORK RULES:
- **PARALLEL**: Fire independent calls simultaneously - NEVER wait sequentially
- **BACKGROUND FIRST**: Use Task(run_in_background=true) for exploration (10+ concurrent)
- **TODO**: Track EVERY step. Mark complete IMMEDIATELY after each
- **VERIFY**: Check ALL requirements met before done
- **NO Premature Stopping**: ALL TODOs must be complete

Continue working on the next pending task. DO NOT STOP until all tasks are marked complete.

Original task: ${originalPrompt}

</ultrawork-persistence>

---
`;
}
function makeDecision(context) {
  const { projectRoot, sessionId, transcriptPath, incompleteTodoCount } = context;
  const stateDir = `${projectRoot}/.claude/sisyphus/state`;
  const attemptId = generateAttemptId(sessionId, projectRoot);
  ensureDir(stateDir);
  const transcript = analyzeTranscript(transcriptPath);
  const currentCount = incompleteTodoCount;
  const previousCount = getTodoCount(stateDir, attemptId);
  if (currentCount !== previousCount) {
    resetAttempts(stateDir, attemptId);
    saveTodoCount(stateDir, attemptId, currentCount);
  }
  const ralphState = readRalphState(projectRoot, sessionId);
  if (ralphState && ralphState.active) {
    if (transcript.hasOracleApproval) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupUltraworkState(projectRoot, sessionId);
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    if (ralphState.iteration >= ralphState.max_iterations) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupUltraworkState(projectRoot, sessionId);
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    const newIteration = ralphState.iteration + 1;
    const oracleFeedback = ralphState.oracle_feedback || [];
    if (transcript.oracleRejectionFeedback) {
      oracleFeedback.push(transcript.oracleRejectionFeedback);
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
  const ultraworkState = readUltraworkState(projectRoot, sessionId);
  if (ultraworkState && ultraworkState.active && incompleteTodoCount > 0) {
    const attempts = getAttemptCount(stateDir, attemptId);
    if (attempts >= MAX_TODO_CONTINUATION_ATTEMPTS) {
      cleanupAttemptFiles(stateDir, attemptId);
      cleanupUltraworkState(projectRoot, sessionId);
      return formatContinueOutput();
    }
    incrementAttempts(stateDir, attemptId);
    const newCount = (ultraworkState.reinforcement_count || 0) + 1;
    const updatedState = {
      ...ultraworkState,
      reinforcement_count: newCount,
      last_checked_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    updateUltraworkState(projectRoot, sessionId, updatedState);
    const message = buildUltraworkContinuationMessage(
      newCount,
      incompleteTodoCount,
      ultraworkState.original_prompt || ""
    );
    return formatBlockOutput(message);
  }
  if (ultraworkState && ultraworkState.active && incompleteTodoCount === 0) {
    cleanupUltraworkState(projectRoot, sessionId);
    cleanupAttemptFiles(stateDir, attemptId);
    return formatContinueOutput();
  }
  return formatContinueOutput();
}

// src/index.ts
async function main() {
  try {
    const rawInput = await readStdin();
    const input = parseInput(rawInput);
    const projectRoot = getProjectRoot(input.directory);
    initLogger("persistent-mode", projectRoot, input.sessionId);
    logStart();
    logInfo(`stop hook invoked, sessionId=${input.sessionId}`);
    const incompleteTodoCount = countIncompleteTodos(input.transcriptPath);
    logDebug(`incompleteTodoCount=${incompleteTodoCount}`);
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

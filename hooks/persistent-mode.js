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
  return PROMISE_PATTERN.test(content);
}
function detectOracleApproval(transcriptPath) {
  if (!transcriptPath) return false;
  const content = readFileOrNull(transcriptPath);
  if (!content) return false;
  return ORACLE_APPROVED_PATTERN.test(content);
}
function detectOracleRejection(transcriptPath) {
  if (!transcriptPath) return null;
  const content = readFileOrNull(transcriptPath);
  if (!content) return null;
  const hasRejection = ORACLE_REJECTION_PATTERNS.some((pattern) => pattern.test(content));
  if (!hasRejection) return null;
  const feedbackMatches = [];
  let match;
  while ((match = FEEDBACK_PATTERN.exec(content)) !== null) {
    feedbackMatches.push(match[2].trim());
    if (feedbackMatches.length >= 5) break;
  }
  return feedbackMatches.length > 0 ? feedbackMatches.join(" ") : "";
}
function countIncompleteTodos(transcriptPath) {
  if (!transcriptPath) return 0;
  const content = readFileOrNull(transcriptPath);
  if (!content) return 0;
  const todos = /* @__PURE__ */ new Map();
  let autoId = 0;
  const createPattern = /"name":\s*"TaskCreate"[\s\S]*?"subject":\s*"[^"]*"/g;
  const creates = content.match(createPattern) || [];
  for (const _ of creates) {
    todos.set(`auto-${autoId++}`, "pending");
  }
  const updatePattern = /"name":\s*"TaskUpdate"[\s\S]*?"taskId":\s*"(\d+)"[\s\S]*?"status":\s*"([^"]+)"/g;
  let updateMatch;
  while ((updateMatch = updatePattern.exec(content)) !== null) {
    const [, taskId, status] = updateMatch;
    todos.set(taskId, status);
  }
  let incomplete = 0;
  for (const status of todos.values()) {
    if (status === "pending" || status === "in_progress") {
      incomplete++;
    }
  }
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
function buildTodoContinuationMessage(incompleteCount) {
  return `<todo-continuation>

[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list (${incompleteCount} remaining). Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done

</todo-continuation>

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
  if (incompleteTodoCount > 0) {
    const attempts = getAttemptCount(stateDir, attemptId);
    if (attempts >= MAX_TODO_CONTINUATION_ATTEMPTS) {
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }
    incrementAttempts(stateDir, attemptId);
    const message = buildTodoContinuationMessage(incompleteTodoCount);
    return formatBlockOutput(message);
  }
  return formatContinueOutput();
}

// src/index.ts
async function main() {
  try {
    const rawInput = await readStdin();
    const input = parseInput(rawInput);
    const projectRoot = getProjectRoot(input.directory);
    const incompleteTodoCount = countIncompleteTodos(input.transcriptPath);
    const context = {
      projectRoot,
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      incompleteTodoCount
    };
    const output = makeDecision(context);
    console.log(JSON.stringify(output));
  } catch (error) {
    console.error("persistent-mode error:", error);
    console.log('{"continue": true}');
  }
}
main();
export {
  main
};

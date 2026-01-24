import { HookOutput, RalphState, UltraworkState, TranscriptDetection } from './types.js';
import {
  readRalphState, updateRalphState, cleanupRalphState,
  readUltraworkState, updateUltraworkState, cleanupUltraworkState,
  getAttemptCount, incrementAttempts, resetAttempts,
  getTodoCount, saveTodoCount, cleanupAttemptFiles,
  MAX_TODO_CONTINUATION_ATTEMPTS
} from './state.js';
import { analyzeTranscript } from './transcript-detector.js';
import { generateAttemptId, ensureDir } from './utils.js';

export interface DecisionContext {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string | null;
  incompleteTodoCount: number;
}

function formatBlockOutput(reason: string): HookOutput {
  return {
    decision: 'block',
    reason
  };
}

function formatContinueOutput(): HookOutput {
  return { continue: true };
}

function buildRalphContinuationMessage(
  iteration: number,
  maxIterations: number,
  prompt: string,
  promise: string,
  oracleFeedback: string[]
): string {
  let feedbackSection = '';
  if (oracleFeedback.length > 0) {
    feedbackSection = `\n**Previous Oracle Feedback:**\n${oracleFeedback.join('\n')}\n`;
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

function buildUltraworkContinuationMessage(
  reinforcementCount: number,
  incompleteCount: number,
  originalPrompt: string
): string {
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

function buildTodoContinuationMessage(incompleteCount: number): string {
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

export function makeDecision(context: DecisionContext): HookOutput {
  const { projectRoot, sessionId, transcriptPath, incompleteTodoCount } = context;
  const stateDir = `${projectRoot}/.claude/sisyphus/state`;
  const attemptId = generateAttemptId(sessionId, projectRoot);

  // Ensure state directory exists
  ensureDir(stateDir);

  // Analyze transcript for completion markers
  const transcript = analyzeTranscript(transcriptPath);

  // Progress detection: reset attempts when todo count changes
  const currentCount = incompleteTodoCount;
  const previousCount = getTodoCount(stateDir, attemptId);
  if (currentCount !== previousCount) {
    resetAttempts(stateDir, attemptId);
    saveTodoCount(stateDir, attemptId, currentCount);
  }

  // Priority 1: Ralph Loop with Oracle Verification
  const ralphState = readRalphState(projectRoot, sessionId);
  if (ralphState && ralphState.active) {
    // Check for oracle approval -> clean up and allow stop
    if (transcript.hasOracleApproval) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupUltraworkState(projectRoot, sessionId);
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // Check max iterations
    if (ralphState.iteration >= ralphState.max_iterations) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupUltraworkState(projectRoot, sessionId);
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // No oracle approval - increment iteration and block
    const newIteration = ralphState.iteration + 1;
    const oracleFeedback = ralphState.oracle_feedback || [];

    // Capture rejection feedback if present
    if (transcript.oracleRejectionFeedback) {
      oracleFeedback.push(transcript.oracleRejectionFeedback);
    }

    // Update state
    const updatedState: RalphState = {
      ...ralphState,
      iteration: newIteration,
      oracle_feedback: oracleFeedback
    };
    updateRalphState(projectRoot, sessionId, updatedState);

    const message = buildRalphContinuationMessage(
      newIteration,
      ralphState.max_iterations,
      ralphState.prompt,
      ralphState.completion_promise || 'DONE',
      oracleFeedback
    );
    return formatBlockOutput(message);
  }

  // Priority 2: Ultrawork Mode with incomplete todos
  const ultraworkState = readUltraworkState(projectRoot, sessionId);
  if (ultraworkState && ultraworkState.active && incompleteTodoCount > 0) {
    // Check escape hatch
    const attempts = getAttemptCount(stateDir, attemptId);
    if (attempts >= MAX_TODO_CONTINUATION_ATTEMPTS) {
      cleanupAttemptFiles(stateDir, attemptId);
      cleanupUltraworkState(projectRoot, sessionId);
      return formatContinueOutput();
    }

    // Increment attempts and block
    incrementAttempts(stateDir, attemptId);

    const newCount = (ultraworkState.reinforcement_count || 0) + 1;
    const updatedState: UltraworkState = {
      ...ultraworkState,
      reinforcement_count: newCount,
      last_checked_at: new Date().toISOString()
    };
    updateUltraworkState(projectRoot, sessionId, updatedState);

    const message = buildUltraworkContinuationMessage(
      newCount,
      incompleteTodoCount,
      ultraworkState.original_prompt || ''
    );
    return formatBlockOutput(message);
  }

  // Ultrawork completed successfully (all todos done)
  if (ultraworkState && ultraworkState.active && incompleteTodoCount === 0) {
    cleanupUltraworkState(projectRoot, sessionId);
    cleanupAttemptFiles(stateDir, attemptId);
    return formatContinueOutput();
  }

  // Priority 3: Todo Continuation (baseline)
  if (incompleteTodoCount > 0) {
    // Check escape hatch
    const attempts = getAttemptCount(stateDir, attemptId);
    if (attempts >= MAX_TODO_CONTINUATION_ATTEMPTS) {
      cleanupAttemptFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // Increment attempts and block
    incrementAttempts(stateDir, attemptId);

    const message = buildTodoContinuationMessage(incompleteTodoCount);
    return formatBlockOutput(message);
  }

  // No blocking needed
  return formatContinueOutput();
}

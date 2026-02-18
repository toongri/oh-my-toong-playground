import { HookOutput, RalphState } from './types.js';
import {
  readRalphState, updateRalphState, cleanupRalphState,
  getBlockCount, incrementBlockCount, cleanupBlockCountFiles,
  MAX_BLOCK_COUNT
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

const MAX_PROMPT_LENGTH = 2000;
const MAX_FEEDBACK_LENGTH = 500;
const MAX_FEEDBACK_COUNT = 3;

function truncateText(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + `...[truncated from ${text.length} chars]`;
  }
  return text;
}

function buildRalphContinuationMessage(
  iteration: number,
  maxIterations: number,
  prompt: string,
  promise: string,
  oracleFeedback: string[]
): string {
  // Truncate prompt to prevent message explosion
  const truncatedPrompt = truncateText(prompt, MAX_PROMPT_LENGTH);

  // Keep only the most recent feedback items and truncate each
  const limitedFeedback = oracleFeedback
    .slice(-MAX_FEEDBACK_COUNT)
    .map(fb => truncateText(fb, MAX_FEEDBACK_LENGTH));

  let feedbackSection = '';
  if (limitedFeedback.length > 0) {
    feedbackSection = `\n**Previous Oracle Feedback:**\n${limitedFeedback.join('\n')}\n`;
  }

  return `<ralph-loop-continuation>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

Your previous attempt did not include oracle approval. The work is NOT verified complete yet.
${feedbackSection}
CRITICAL INSTRUCTIONS:
1. Review your progress and the original task below
2. Check your todo list - are ALL items marked complete?
3. Spawn Oracle to verify: Task(subagent_type="oracle", prompt="Verify task completion: ${truncatedPrompt}")
4. If Oracle approves, output: <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
5. Then output: <promise>${promise}</promise>
6. Do NOT stop until verified by Oracle

</ralph-loop-continuation>

---
`;
}

function buildTodoContinuationMessage(incompleteCount: number): string {
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

export function makeDecision(context: DecisionContext): HookOutput {
  const { projectRoot, sessionId, transcriptPath, incompleteTodoCount } = context;
  const stateDir = `${projectRoot}/.omt/state`;
  const attemptId = generateAttemptId(sessionId, projectRoot);

  // Ensure state directory exists
  ensureDir(stateDir);

  // Analyze transcript for completion markers
  const transcript = analyzeTranscript(transcriptPath);

  // Priority 1: Ralph Loop with Oracle Verification
  const ralphState = readRalphState(projectRoot, sessionId);
  if (ralphState && ralphState.active) {
    // 1. Max iteration check FIRST (escape hatch, regardless of tasks)
    if (ralphState.iteration >= ralphState.max_iterations) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // 2. Tasks incomplete check SECOND (before Oracle check)
    if (incompleteTodoCount > 0) {
      const newIteration = ralphState.iteration + 1;
      const oracleFeedback = ralphState.oracle_feedback || [];

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

    // 3. Tasks complete + Oracle approved -> pass
    if (transcript.hasOracleApproval) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // 4. Tasks complete + Oracle not approved -> block
    // Only increment iteration if Oracle was actually called and rejected
    // "Oracle not called yet" scenario should preserve iteration count
    const oracleFeedback = ralphState.oracle_feedback || [];
    let newIteration = ralphState.iteration;

    // Capture rejection feedback if present and increment iteration
    if (transcript.oracleRejectionFeedback) {
      oracleFeedback.push(transcript.oracleRejectionFeedback);
      newIteration = ralphState.iteration + 1;
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

  // Priority 2: Baseline todo-continuation (incomplete tasks from file-based counting)
  if (incompleteTodoCount > 0) {
    // Check escape hatch
    const blockCount = getBlockCount(stateDir, attemptId);
    if (blockCount >= MAX_BLOCK_COUNT) {
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // Increment block count and block
    incrementBlockCount(stateDir, attemptId);
    const message = buildTodoContinuationMessage(incompleteTodoCount);
    return formatBlockOutput(message);
  }

  // No blocking needed
  return formatContinueOutput();
}

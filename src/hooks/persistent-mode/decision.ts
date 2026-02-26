import { HookOutput, RalphState } from './types.ts';
import {
  readRalphState, updateRalphState, cleanupRalphState,
  getBlockCount, incrementBlockCount, cleanupBlockCountFiles,
  MAX_BLOCK_COUNT
} from './state.ts';
import { analyzeTranscript } from './transcript-detector.ts';
import { generateAttemptId, ensureDir } from './utils.ts';

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
  promise: string
): string {
  // Truncate prompt to prevent message explosion
  const truncatedPrompt = truncateText(prompt, MAX_PROMPT_LENGTH);

  return `<ralph-loop-continuation>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

Your previous attempt did not include oracle approval. The work is NOT verified complete yet.

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

function buildOracleVerificationMessage(
  iteration: number,
  maxIterations: number,
  prompt: string
): string {
  const truncatedPrompt = truncateText(prompt, MAX_PROMPT_LENGTH);

  return `<ralph-oracle-verification>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

DONE detected. Spawn Oracle to verify completion.

CRITICAL INSTRUCTIONS:
1. Spawn Oracle to verify: Task(subagent_type="oracle", prompt="Verify task completion: ${truncatedPrompt}")
2. When Oracle approves, output: <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
3. Do NOT stop until verified by Oracle

</ralph-oracle-verification>

---
`;
}

function buildNoDoneMessage(
  iteration: number,
  maxIterations: number,
  prompt: string,
  promise: string
): string {
  const truncatedPrompt = truncateText(prompt, MAX_PROMPT_LENGTH);

  return `<ralph-loop-continuation>

[RALPH LOOP - ITERATION ${iteration}/${maxIterations}]

DONE not detected. You have not yet signaled task completion.

CRITICAL INSTRUCTIONS:
1. Review the original task below and check your progress
2. Complete any remaining work
3. When finished, output: <promise>${promise}</promise>

Original task: ${truncatedPrompt}

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

  // Priority 1: Ralph Loop with Oracle Verification
  const ralphState = readRalphState(projectRoot, sessionId);

  // Analyze transcript for completion markers (pass ralphState for started_at filtering)
  const transcript = analyzeTranscript(transcriptPath, ralphState);
  if (ralphState && ralphState.active) {
    // Branch 1: Max iteration check (escape hatch, regardless of tasks)
    if (ralphState.iteration >= ralphState.max_iterations) {
      cleanupRalphState(projectRoot, sessionId);
      cleanupBlockCountFiles(stateDir, attemptId);
      return formatContinueOutput();
    }

    // Branch 2: Tasks incomplete → block with continuation
    if (incompleteTodoCount > 0) {
      const newIteration = ralphState.iteration + 1;

      const updatedState: RalphState = {
        ...ralphState,
        iteration: newIteration,
      };
      updateRalphState(projectRoot, sessionId, updatedState);

      const message = buildRalphContinuationMessage(
        newIteration,
        ralphState.max_iterations,
        ralphState.prompt,
        ralphState.completion_promise || 'DONE'
      );
      return formatBlockOutput(message);
    }

    // Branches 3-5: Tasks complete path - check DONE detection
    if (transcript.hasCompletionPromise) {
      // Branch 3: DONE + VERIFIED_COMPLETE → cleanup → exit
      if (transcript.hasOracleApproval) {
        cleanupRalphState(projectRoot, sessionId);
        cleanupBlockCountFiles(stateDir, attemptId);
        return formatContinueOutput();
      }

      // Branch 4: DONE + no VERIFIED_COMPLETE → increment iteration → oracle verification
      const newIteration = ralphState.iteration + 1;

      const updatedState: RalphState = {
        ...ralphState,
        iteration: newIteration,
      };
      updateRalphState(projectRoot, sessionId, updatedState);

      const message = buildOracleVerificationMessage(
        newIteration,
        ralphState.max_iterations,
        ralphState.prompt
      );
      return formatBlockOutput(message);
    }

    // Branch 5: No DONE detected → increment iteration → block with continuation
    const newIteration = ralphState.iteration + 1;

    const updatedState: RalphState = {
      ...ralphState,
      iteration: newIteration,
    };
    updateRalphState(projectRoot, sessionId, updatedState);

    const message = buildNoDoneMessage(
      newIteration,
      ralphState.max_iterations,
      ralphState.prompt,
      ralphState.completion_promise || 'DONE'
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

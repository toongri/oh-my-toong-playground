import { readStdin, parseInput } from './stdin.js';
import { getProjectRoot } from './utils.js';
import { makeDecision, DecisionContext } from './decision.js';
import { readTasksFromDirectory, countIncompleteTasks } from '../../lib/dist/task-reader.js';
import { join } from 'path';
import { initLogger, logStart, logEnd, logInfo, logDebug, logError } from '../../lib/dist/logging.js';

export async function main(): Promise<void> {
  try {
    // Read and parse stdin
    const rawInput = await readStdin();
    const input = parseInput(rawInput);

    // Get project root
    const projectRoot = getProjectRoot(input.directory);

    // Initialize logging
    initLogger('persistent-mode', projectRoot, input.sessionId);
    logStart();
    logInfo(`stop hook invoked, sessionId=${input.sessionId}`);

    // Read tasks from file-based directory
    const homeDir = process.env.HOME || '/tmp';
    const tasksDir = join(homeDir, '.claude', 'tasks', input.sessionId);
    const tasks = await readTasksFromDirectory(tasksDir);
    const incompleteTodoCount = countIncompleteTasks(tasks);
    logDebug(`tasks from ${tasksDir}: total=${tasks.length}, incomplete=${incompleteTodoCount}`);

    // Build decision context
    const context: DecisionContext = {
      projectRoot,
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      incompleteTodoCount
    };

    // Make decision
    const output = makeDecision(context);

    // Log decision result
    if (output.decision) {
      logInfo(`decision=${output.decision}`);
    } else if (output.continue !== undefined) {
      logInfo(`decision=continue`);
    }

    // Output JSON result
    console.log(JSON.stringify(output));
    logEnd();
  } catch (error) {
    // On any error, allow stop (fail open)
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`error: ${errorMessage}`);
    console.error('persistent-mode error:', error);
    console.log('{"continue": true}');
    logEnd();
  }
}

// Run main when executed directly
main();

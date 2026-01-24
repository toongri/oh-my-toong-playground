import { readStdin, parseInput } from './stdin.js';
import { getProjectRoot } from './utils.js';
import { makeDecision, DecisionContext } from './decision.js';
import { countIncompleteTodos } from './transcript-detector.js';

export async function main(): Promise<void> {
  try {
    // Read and parse stdin
    const rawInput = await readStdin();
    const input = parseInput(rawInput);

    // Get project root
    const projectRoot = getProjectRoot(input.directory);

    // Count incomplete todos from transcript
    const incompleteTodoCount = countIncompleteTodos(input.transcriptPath);

    // Build decision context
    const context: DecisionContext = {
      projectRoot,
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      incompleteTodoCount
    };

    // Make decision
    const output = makeDecision(context);

    // Output JSON result
    console.log(JSON.stringify(output));
  } catch (error) {
    // On any error, allow stop (fail open)
    console.error('persistent-mode error:', error);
    console.log('{"continue": true}');
  }
}

// Run main when executed directly
main();

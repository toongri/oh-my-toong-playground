import { readStdin, parseInput } from './stdin.js';
import { updateStats } from './stats.js';
import { generateMessage } from './message-generator.js';

interface HookResponse {
  continue: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
}

export function buildResponse(
  toolName: string,
  toolOutput: string,
  toolCount: number,
): HookResponse {
  const message = generateMessage(toolName, toolOutput, '', toolCount);

  const response: HookResponse = { continue: true };
  if (message) {
    response.hookSpecificOutput = {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    };
  }

  return response;
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    const input = parseInput(raw);

    const toolCount = updateStats(input.toolName, input.sessionId);

    const response = buildResponse(input.toolName, input.toolOutput, toolCount);

    process.stdout.write(JSON.stringify(response, null, 2));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

main();

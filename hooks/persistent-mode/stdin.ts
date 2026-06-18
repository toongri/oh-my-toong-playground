import { HookInput, ParsedInput } from './types.ts';

export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

export function parseInput(raw: string): ParsedInput {
  let input: HookInput = {};
  try {
    input = JSON.parse(raw);
  } catch {
    // Use defaults
  }

  const sessionId = input.sessionId || input.session_id || 'default';
  const directory = input.cwd || process.cwd();
  const lastAssistantMessage = input.last_assistant_message || null;
  const stopHookActive = input.stop_hook_active === true;
  const backgroundTaskCount = Array.isArray(input.background_tasks) ? input.background_tasks.length : 0;

  return { sessionId, directory, lastAssistantMessage, stopHookActive, backgroundTaskCount };
}

import { HookInput, ParsedInput } from './types.js';

export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
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
  const transcriptPath = input.transcript_path || null;

  return { sessionId, directory, transcriptPath };
}

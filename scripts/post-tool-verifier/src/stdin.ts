export interface HookInput {
  toolName: string;
  toolOutput: string;
  sessionId: string;
  cwd: string;
}

export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

export function parseInput(raw: string): HookInput {
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(raw); } catch {}
  return {
    toolName: (input.tool_name || input.toolName || '') as string,
    toolOutput: (input.tool_response || input.toolOutput || '') as string,
    sessionId: (input.session_id || input.sessionId || 'unknown') as string,
    cwd: (input.cwd || input.directory || '') as string,
  };
}

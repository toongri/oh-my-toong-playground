import { ParsedInput, HookInput, HookOutput } from './types.ts';
import { buildCatalog, formatCatalog } from './catalog.ts';
import { scanSkillDirectories } from './scanner.ts';

export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', (err) => reject(err));
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
  const cwd = input.cwd || process.cwd();

  return { sessionId, cwd };
}

export async function main(): Promise<void> {
  try {
    const rawInput = await readStdin();
    const input = parseInput(rawInput);

    // Scan skill directories
    const discoveredSkills = await scanSkillDirectories(input.cwd);

    // Build catalog from hashmap + discovered skills
    const entries = buildCatalog(discoveredSkills);

    // Format catalog text
    const additionalContext = formatCatalog(entries);

    // Output JSON
    const output: HookOutput = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    };

    console.log(JSON.stringify(output));
  } catch {
    // Fail open on any error
    console.log('{"continue": true}');
  }
}

main();

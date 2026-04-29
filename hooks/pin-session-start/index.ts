/**
 * pin-session-start SessionStart hook entrypoint (AC-1.6, AC-2).
 *
 * 8-step logic:
 * 1. Read stdin → parse HookInput
 * 2. Resolve $OMT_DIR
 * 3. Scan $OMT_DIR/pins/ for .md files
 * 4. Count + extract recent slugs (up to 3 if ≤30 total)
 * 5. Assemble instructions text (index + Model 2 guidance + supersedes note)
 * 6. Build hookSpecificOutput JSON
 * 7. JSON stdout
 * (8. Fail-open: any error → {} + stderr WARN)
 *
 * Fail-open: any unhandled error → {} (empty output, session proceeds normally).
 */

import type { HookInput, HookOutput } from './types.ts';
import { scanPins } from './scanner.ts';
import { formatPinsContext } from './formatter.ts';

// ─── stdin helpers ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function parseInput(raw: string): HookInput {
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return {};
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  try {
    // Step 1: stdin → parse
    const rawInput = await readStdin();
    parseInput(rawInput); // sessionId/cwd available but not required for this hook

    // Step 2: resolve OMT_DIR
    const omtDir = process.env.OMT_DIR || '';
    if (!omtDir) {
      process.stderr.write('[pin-session-start] WARN: OMT_DIR not set — skipping pins surface\n');
      console.log('{}');
      return;
    }

    // Steps 3+4: scan pins
    const scanResult = scanPins(omtDir);

    // Step 5: build instructions text
    const additionalContext = formatPinsContext(scanResult);

    // Step 6: build output (empty additionalContext → no hookSpecificOutput)
    const output: HookOutput = additionalContext
      ? {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext,
          },
        }
      : {};

    // Step 7: JSON stdout
    console.log(JSON.stringify(output));
  } catch (error) {
    // Fail-open
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pin-session-start] ERROR: ${msg}\n`);
    console.log('{}');
  }
}

// Run when executed directly
if (import.meta.main) {
  main();
}

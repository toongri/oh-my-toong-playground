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

import { execFileSync } from 'child_process';
import { join } from 'path';
import type { HookInput, HookOutput } from './types.ts';
import { scanPins } from './scanner.ts';
import { formatPinsContext } from './formatter.ts';

// ─── OMT_DIR resolver ─────────────────────────────────────────────────────────
// Sibling SessionStart hooks in the same event cycle do not share CLAUDE_ENV_FILE
// exports, so each TS hook resolves OMT_DIR independently — same convention used
// by session-start.sh / keyword-detector.sh / resume-forge-start.sh.
const OMT_DIR_LIB_SH = join(import.meta.dir, '..', 'lib', 'omt-dir.sh');

function resolveOmtDir(cwd: string): string {
  const envValue = process.env.OMT_DIR;
  if (envValue) return envValue;
  try {
    const stdout = execFileSync(
      'bash',
      ['-c', `source "${OMT_DIR_LIB_SH}" && resolve_omt_dir "$1"`, '--', cwd],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: process.env as NodeJS.ProcessEnv },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

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
    const input = parseInput(rawInput);

    // Step 2: resolve OMT_DIR (self-compute when env unset — sibling hooks in
    // the same SessionStart cycle do not propagate CLAUDE_ENV_FILE exports)
    const omtDir = resolveOmtDir(input.cwd ?? process.cwd());
    if (!omtDir) {
      process.stderr.write('[pin-session-start] WARN: OMT_DIR resolution failed — skipping pins surface\n');
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

/**
 * pin-session-start SessionStart hook entrypoint (T16).
 *
 * Logic:
 * 1. Read stdin → parse HookInput
 * 2. Call resolveManifest (from lib/pins) — searches cwd + $OMT_DIR for pins.yaml
 * 3a. If absent → inject passive setup suggestion (no file/dir created)
 * 3b. If resolved → buildIndex(manifest.location) → inject compact index summary
 * 4. Emit hookSpecificOutput JSON
 *
 * Fail-open: any unhandled error → {} (empty output, session proceeds normally).
 */

import type { HookInput, HookOutput } from './types.ts';
import { resolveManifest } from '@lib/pins/manifest';
import { buildIndex } from '@lib/pins/index';
import { formatAbsentContext, formatIndexContext } from './formatter.ts';
import { resolveOmtDir, resolveProjectRoot } from '@lib/omt-dir';

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
    return JSON.parse(raw);
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

    // Step 2: resolve manifest (project-root-first, user-root-fallback)
    // projectRoot = git project root of the session's cwd, so a session
    //            launched from a subdirectory still finds the root pins.yaml.
    // userRoot = $OMT_DIR when set; otherwise derived from the session cwd so
    //            process.cwd() (hook process dir) does not shadow the session dir.
    const projectRoot = resolveProjectRoot(input.cwd ?? process.cwd());
    const userRoot = process.env.OMT_DIR ?? resolveOmtDir(projectRoot);

    const manifestResult = await resolveManifest({ projectRoot, userRoot });

    let additionalContext: string;

    if (manifestResult.kind === 'absent') {
      // Step 3a: passive setup suggestion — no file/dir creation
      additionalContext = formatAbsentContext();
    } else {
      // Step 3b: build index from manifest.location and format summary
      const index = buildIndex(manifestResult.manifest.location);
      additionalContext = formatIndexContext(index, manifestResult.manifest);
    }

    // Step 4: emit hookSpecificOutput
    const output: HookOutput = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    };

    // eslint-disable-next-line no-console -- SessionStart stdout 주입: 이 출력이 hookSpecificOutput 컨텍스트로 소비됨
    console.log(JSON.stringify(output));
  } catch (error) {
    // Fail-open: never block the session
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pin-session-start] ERROR: ${msg}\n`);
    // eslint-disable-next-line no-console -- SessionStart stdout 주입: fail-open 시에도 빈 hook 출력 계약 유지
    console.log('{}');
  }
}

// Run when executed directly
if (import.meta.main) {
  main();
}

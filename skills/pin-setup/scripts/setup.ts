#!/usr/bin/env bun
/**
 * pin-setup: write pins.yaml into the current project, then migrate legacy pins.
 *
 * Usage:
 *   bun setup.ts --location <abs-path> --scope <private|shared> [--git <true|false>]
 *
 * Argv-driven and non-interactive. The AI skill gathers values via interview,
 * then invokes this script. This is the ONLY script that creates pins.yaml —
 * it does NOT call resolveManifest (D3 exception: setup writes, not reads).
 *
 * D8 write-safety: migrate() receives exactly the location written to pins.yaml,
 * never an inferred cwd path.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { migrate } from '@lib/pins/migrate';
import { failEngine } from '@lib/pin-cli/io';

// ── Argv parsing ──────────────────────────────────────────────────────────────

function parseArgs(): { location: string; scope: string; git: boolean | null } {
  const args = process.argv.slice(2);
  let location: string | null = null;
  let scope: string | null = null;
  let git: boolean | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--location' && args[i + 1]) {
      location = args[++i];
    } else if (args[i] === '--scope' && args[i + 1]) {
      scope = args[++i];
    } else if (args[i] === '--git' && args[i + 1]) {
      const val = args[++i];
      git = val === 'true';
    }
  }

  if (!location) {
    process.stderr.write('[pin-setup] --location is required\n');
    process.exit(1);
  }
  if (!scope || (scope !== 'private' && scope !== 'shared')) {
    process.stderr.write('[pin-setup] --scope must be "private" or "shared"\n');
    process.exit(1);
  }

  return { location, scope, git };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { location, scope, git } = parseArgs();

  // Write pins.yaml into cwd using the canonical template format.
  const gitLine = git !== null ? `\ngit: ${git}` : '';
  const manifest = `# pins.yaml — knowledge graph storage manifest\nlocation: ${location}\nscope: ${scope}${gitLine}\n`;

  const manifestPath = join(process.cwd(), 'pins.yaml');
  writeFileSync(manifestPath, manifest, 'utf8');
  process.stdout.write(`[pin-setup] manifest created: ${manifestPath}\n`);

  // Migrate legacy pins at the just-written location (D8: exact same value).
  try {
    await migrate({ location });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    failEngine(`migrate failed: ${detail}`);
  }

  process.stdout.write(`[pin-setup] migration complete: ${location}\n`);
}

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

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { migrate } from '@lib/pins/migrate';
import { failEngine } from '@lib/pin-cli/io';
import { resolveProjectRoot } from '@lib/omt-dir';

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

  // Write pins.yaml into the project root (C7: aligns write with resolveManifest read path).
  const manifestObj: Record<string, unknown> = { location, scope };
  if (git !== null) manifestObj.git = git;
  const manifest = `# pins.yaml — knowledge graph storage manifest\n${stringifyYaml(manifestObj)}`;

  const manifestPath = join(resolveProjectRoot(), 'pins.yaml');
  writeFileSync(manifestPath, manifest, 'utf8');
  process.stdout.write(`[pin-setup] manifest created: ${manifestPath}\n`);

  // Migrate legacy pins at the just-written location (D8: exact same value).
  // C6: skip migrate when location does not yet exist — first record() call creates it.
  try {
    if (existsSync(location)) {
      await migrate({ location });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    failEngine(`migrate failed: ${detail}`);
  }

  process.stdout.write(`[pin-setup] migration complete: ${location}\n`);
}

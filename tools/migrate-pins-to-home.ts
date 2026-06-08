#!/usr/bin/env bun
/**
 * One-off, operator-run migration of legacy pin .md files into the fixed pins
 * home (~/.pins/<project>), ACTIVATING the slug-shaped orphans by format-migrating
 * them (slug -> id) so buildIndex (which keys on `id`) can finally see them.
 *
 * NON-DEPLOYED tool. It only CALLS migrate(); it never modifies the runtime path,
 * the hook, or any skill. It performs NO destructive delete — instead it prints a
 * verbatim, copy-pasteable `rm -r` block keyed on the EXACT verified stale source
 * paths, so the human's delete cannot diverge from what was actually verified.
 *
 * Per project the flow is, in this mandatory order:
 *   1. copy .md pins (PRESERVING filenames) source -> target home
 *   2. migrate({ location: target }) — in-place slug->id, idempotent for canonical
 *   3. write the co-located manifest (pins.yaml) at the target home
 *   4. verify: buildIndex count === expected AND skipped === 0 AND manifest resolves
 *   5. collect stale source paths for the delete block (NOT deleting them)
 */

import { readdirSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { migrate } from '../lib/pins/migrate.ts';
import { buildIndex } from '../lib/pins/index.ts';
import { resolveManifest } from '../lib/pins/manifest.ts';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MigrateSpec {
  /** Human-readable project name (used in output + delete block). */
  name: string;
  /** Source legacy pins dir (e.g. ~/.omt/<project>/pins). */
  sourcePinsDir: string;
  /** Source manifest file, when one exists (preserved scope/git). */
  sourceManifest?: string;
  /** Target fixed pins home (e.g. ~/.pins/<project>). */
  targetHome: string;
  /** Expected canonical pin count after migration (verify gate). */
  expectedCount: number;
}

export interface MigrateResult {
  name: string;
  /** True only when count matched AND no skips AND manifest resolved. */
  verified: boolean;
  actualCount: number;
  expectedCount: number;
  /**
   * Source paths that are safe to delete ONLY because this project verified.
   * Always the source pins dir, plus the source manifest when the spec gave one.
   * The tool NEVER deletes these — they key the printed `rm -r` block.
   */
  stalePaths: string[];
}

// ── Per-project migration ───────────────────────────────────────────────────────

/**
 * Migrate one project's legacy pins into its fixed home and verify the result.
 * Deletes nothing. Throws on a verify mismatch (count/skipped/manifest), so a
 * failed project surfaces loudly and its source is provably untouched.
 */
export async function migrateProject(spec: MigrateSpec): Promise<MigrateResult> {
  // 1. Copy .md pins (preserve filenames) source -> target. Cruft is skipped via
  //    the EXACT buildIndex filter so collision suffixes survive (distinct ids).
  mkdirSync(spec.targetHome, { recursive: true });
  const sourceEntries = readdirSync(spec.sourcePinsDir).filter(
    (f) => f.endsWith('.md') && !f.endsWith('.bak') && !f.startsWith('.'),
  );
  for (const entry of sourceEntries) {
    copyFileSync(join(spec.sourcePinsDir, entry), join(spec.targetHome, entry));
  }

  // 2. Format-migrate in place (slug -> id). No-op for already-canonical files.
  await migrate({ location: spec.targetHome });

  // 3. Write the co-located manifest at the target home.
  writeManifest(spec);

  // 4. Verify: count, zero skips, and manifest resolution via the pinsHome tier.
  const index = buildIndex(spec.targetHome);
  const actualCount = Object.keys(index.entries).length;

  const manifestResult = await resolveManifest({
    pinsHome: spec.targetHome,
    projectRoot: join(spec.targetHome, '__nonexistent_project_root__'),
    userRoot: join(spec.targetHome, '__nonexistent_user_root__'),
  });

  const verified =
    actualCount === spec.expectedCount &&
    index.skipped.length === 0 &&
    manifestResult.kind === 'resolved' &&
    manifestResult.manifest.location === spec.targetHome;

  const stalePaths = [spec.sourcePinsDir];
  if (spec.sourceManifest) stalePaths.push(spec.sourceManifest);

  if (!verified) {
    throw new Error(
      `[migrate] verify FAILED for ${spec.name}: ` +
        `count=${actualCount} (expected ${spec.expectedCount}), ` +
        `skipped=${index.skipped.length}, manifest=${manifestResult.kind}. ` +
        `Source left intact (nothing deleted).`,
    );
  }

  return {
    name: spec.name,
    verified,
    actualCount,
    expectedCount: spec.expectedCount,
    stalePaths,
  };
}

/**
 * Write the co-located manifest. `location` is always the target home; `scope`
 * and `git` are preserved from the source manifest when given, else defaulted.
 * Matches setup.ts's YAML write format for consistency.
 */
function writeManifest(spec: MigrateSpec): void {
  let scope = 'private';
  let git = false;

  if (spec.sourceManifest && existsSync(spec.sourceManifest)) {
    const parsed = parseYaml(readFileSync(spec.sourceManifest, 'utf8')) as
      | Record<string, unknown>
      | null;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.scope === 'string') scope = parsed.scope;
      if (typeof parsed.git === 'boolean') git = parsed.git;
    }
  }

  const manifestObj: Record<string, unknown> = {
    location: spec.targetHome,
    scope,
    git,
  };
  const manifest = `# pins.yaml — knowledge graph storage manifest\n${stringifyYaml(manifestObj)}`;
  writeFileSync(join(spec.targetHome, 'pins.yaml'), manifest, 'utf8');
}

// ── Delete block ────────────────────────────────────────────────────────────────

/**
 * Emit a verbatim, copy-pasteable `rm -r` block keyed on the verified stale
 * source paths. ONLY verified projects contribute lines — so the human's delete
 * cannot diverge from what the tool actually verified. The tool itself deletes
 * nothing; this is human-gated.
 */
export function formatDeleteBlock(results: MigrateResult[]): string {
  const lines: string[] = [
    '# Verified migration complete. The following legacy source paths are now',
    '# superseded by ~/.pins/<project>. Review, then delete by hand:',
  ];
  for (const r of results) {
    if (!r.verified) continue;
    for (const p of r.stalePaths) {
      lines.push(`rm -r '${p}'`);
    }
  }
  return lines.join('\n');
}

// ── Runner (operator-executed; NOT exercised by unit tests) ─────────────────────

if (import.meta.main) {
  const home = homedir();
  const omt = (p: string) => join(home, '.omt', p);
  const pins = (p: string) => join(home, '.pins', p);

  const specs: MigrateSpec[] = [
    {
      name: 'oh-my-toong-playground',
      sourcePinsDir: omt('oh-my-toong-playground/pins'),
      sourceManifest: omt('oh-my-toong-playground/pins.yaml'),
      targetHome: pins('oh-my-toong-playground'),
      expectedCount: 1,
    },
    {
      name: 'algocare-home',
      sourcePinsDir: omt('algocare-home/pins'),
      targetHome: pins('algocare-home'),
      expectedCount: 38,
    },
    {
      name: 'algocare-home-app-device',
      sourcePinsDir: omt('algocare-home-app-device/pins'),
      targetHome: pins('algocare-home-app-device'),
      expectedCount: 8,
    },
  ];

  const results: MigrateResult[] = [];
  for (const spec of specs) {
    const result = await migrateProject(spec);
    results.push(result);
    process.stdout.write(
      `[migrate] ${result.name}: verified=${result.verified} ` +
        `count=${result.actualCount}/${result.expectedCount}\n`,
    );
  }

  process.stdout.write('\n' + formatDeleteBlock(results) + '\n');
}

#!/usr/bin/env bun
/**
 * CLI wrapper for lib/pins/query — retrieves matching pin entries from the
 * knowledge graph and prints them as a JSON array to stdout.
 *
 * Usage:
 *   bun "${CLAUDE_SKILL_DIR}/scripts/query.ts" [--type <type>] [--tags <a,b>] [--source <source>]
 *
 * Flags:
 *   --type    EntityType filter (e.g. "code", "decision")
 *   --tags    Comma-separated tag list; all must match (AND semantics)
 *   --source  PinSource filter (e.g. "inline", "url")
 *
 * Exit codes:
 *   0 — success, or manifest absent (prints the absent message)
 *   1 — engine error
 */

import { query, type QueryCriteria } from '@lib/pins/query';
import { requireManifest, failEngine } from '@lib/pin-cli/io';

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse --flag value pairs
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--') && i + 1 < args.length) {
      flags[arg.slice(2)] = args[i + 1];
      i++;
    }
  }

  // requireManifest handles the absent case: prints the absent line + exits 0
  const manifest = await requireManifest();

  const criteria: QueryCriteria = {};
  if (flags['type'] !== undefined) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- unvalidated CLI arg; an invalid value simply matches no entries downstream
    criteria.type = flags['type'] as QueryCriteria['type'];
  }
  if (flags['tags'] !== undefined) {
    criteria.tags = flags['tags'].split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (flags['source'] !== undefined) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- unvalidated CLI arg; an invalid value simply matches no entries downstream
    criteria.source = flags['source'] as QueryCriteria['source'];
  }

  let results;
  try {
    results = query(manifest.location, criteria);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failEngine(message);
  }

  // eslint-disable-next-line no-console -- CLI tool output contract: results are printed to stdout as JSON, not a debug log
  console.log(JSON.stringify(results, null, 2));
}

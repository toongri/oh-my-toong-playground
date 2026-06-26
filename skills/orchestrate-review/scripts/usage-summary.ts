#!/usr/bin/env bun
/**
 * usage-summary — generic token-usage harvest for a job dir.
 *
 * Reads members/[*]/status.json from the given job directory, sums each
 * member's `usage` object (token counts written by the worker, T2), and
 * prints a JSON aggregate to stdout.
 *
 * Design invariants:
 *   - Pure read; never mutates any file.
 *   - Members whose status.json lacks a `usage` field (or has null/non-object)
 *     contribute 0 to every key — never throws.
 *   - memberCount counts entries that have a readable status.json, regardless
 *     of whether they carried usage data.
 *
 * Usage:
 *   bun usage-summary.ts <jobDir>
 *
 * Stdout (JSON):
 *   { "memberCount": N, "usage": { "input_tokens": N, "output_tokens": N, … } }
 */

import fs from 'fs';
import path from 'path';

export interface UsageSummary {
  memberCount: number;
  /** Aggregate token counts across all members. Keys mirror ParseResult.usage keys. */
  usage: Record<string, number>;
}

/**
 * Traverse members/<entry>/status.json files under jobDir and aggregate usage.
 * Cross-runtime safe: uses only fs + path (Node built-ins).
 */
export function summarizeUsage(jobDir: string): UsageSummary {
  const membersDir = path.resolve(jobDir, 'members');
  const aggregate: Record<string, number> = {};
  let memberCount = 0;

  let entries: string[];
  try {
    entries = fs.readdirSync(membersDir);
  } catch {
    return { memberCount: 0, usage: {} };
  }

  for (const entry of entries) {
    const statusPath = path.join(membersDir, entry, 'status.json');
    let status: unknown;
    try {
      status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch {
      continue;
    }
    if (!status || typeof status !== 'object') continue;

    memberCount++;

    const usage = (status as Record<string, unknown>).usage;
    if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
      for (const [key, val] of Object.entries(usage as Record<string, unknown>)) {
        if (typeof val === 'number') {
          aggregate[key] = (aggregate[key] ?? 0) + val;
        }
      }
    }
  }

  return { memberCount, usage: aggregate };
}

if (import.meta.main) {
  const jobDir = process.argv[2];
  if (!jobDir) {
    process.stderr.write('usage-summary: missing jobDir argument\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(summarizeUsage(jobDir), null, 2) + '\n');
}

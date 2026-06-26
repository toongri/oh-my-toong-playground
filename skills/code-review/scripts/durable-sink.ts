/**
 * Durable sink for code-review run metrics.
 *
 * Writes two measurement artifacts to ${OMT_DIR}/code-review/${runId}/:
 *   - candidates.json  — {found, deduped, dispatched} counts
 *   - usage-summary.json — {findTokenUsage} (null when aggregate unavailable)
 *
 * The directory is created on first write (mkdirSync recursive).
 * A D=0 review STILL writes candidates.json with zeros.
 * Missing findTokenUsage does NOT block the write — usage-summary.json is
 * written with findTokenUsage: null in that case.
 *
 * runId is always injected by the caller:
 *   - Under /goal: pass the goal session id {sid} so the sink correlates with
 *     goal-codereview-{sid}.json (goal-state.ts resolveCodeReviewArtifactPath)
 *   - Otherwise: pass crypto.randomUUID() (Tier-0 builtin, no extra dep)
 *
 * getOmtDir() reads $OMT_DIR at call time, enabling hermetic test injection
 * via process.env.OMT_DIR = tmpDir.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOmtDir } from '@lib/omt-dir';

export interface DurableSinkParams {
  /** Injected by caller — never generated inside this function. */
  runId: string;
  /** Total candidates surfaced across all angles (sum of per-angle counts). */
  found: number;
  /** Candidates surviving deduplication (total-surviving header). */
  deduped: number;
  /**
   * Candidates entering inline verification.
   * v1: dispatched === deduped (no inline cap exists yet).
   * The field records verify load for the find-inclusion gate and diverges
   * only if a later inline cap or pre-filter is added.
   */
  dispatched: number;
  /**
   * Raw JSON object from the `### Find Token Usage` block in the conductor's
   * returned text (T4, commit 84d67d02). Omit or pass undefined when the
   * aggregate is unavailable — the write proceeds without blocking.
   */
  findTokenUsage?: object;
}

/**
 * Writes candidates.json and usage-summary.json to
 * ${OMT_DIR}/code-review/${runId}/.
 *
 * Returns the absolute path to the sink directory so callers can log it
 * without re-deriving the path independently (K-3).
 */
export function writeDurableSink(params: DurableSinkParams): string {
  const { runId, found, deduped, dispatched, findTokenUsage } = params;

  if (!runId) throw new Error('writeDurableSink: runId must be non-empty');

  const sinkDir = join(getOmtDir(), 'code-review', runId);
  mkdirSync(sinkDir, { recursive: true });

  writeFileSync(
    join(sinkDir, 'candidates.json'),
    JSON.stringify({ found, deduped, dispatched }, null, 2),
    'utf8'
  );

  writeFileSync(
    join(sinkDir, 'usage-summary.json'),
    JSON.stringify({ findTokenUsage: findTokenUsage ?? null }, null, 2),
    'utf8'
  );

  return sinkDir;
}

// ---------------------------------------------------------------------------
// CLI entry point — mirrors usage-summary.ts convention
//
// Usage:
//   bun durable-sink.ts <runId> <found> <deduped> <dispatched> [<findTokenUsageJson>]
//
// <findTokenUsageJson>: raw JSON string from the `### Find Token Usage` block.
//   Omit or pass '' when the aggregate is unavailable.
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const [, , runId, foundStr, dedupedStr, dispatchedStr, findTokenUsageJson] = process.argv;

  if (
    !runId ||
    foundStr === undefined || foundStr === '' ||
    dedupedStr === undefined || dedupedStr === '' ||
    dispatchedStr === undefined || dispatchedStr === ''
  ) {
    process.stderr.write(
      'usage: durable-sink.ts <runId> <found> <deduped> <dispatched> [<findTokenUsageJson>]\n'
    );
    process.exit(1);
  }

  const found = Number(foundStr);
  const deduped = Number(dedupedStr);
  const dispatched = Number(dispatchedStr);

  if (!Number.isInteger(found) || !Number.isInteger(deduped) || !Number.isInteger(dispatched)) {
    process.stderr.write('durable-sink: found/deduped/dispatched must be integers\n');
    process.exit(1);
  }

  let findTokenUsage: object | undefined;
  if (findTokenUsageJson && findTokenUsageJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(findTokenUsageJson);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        findTokenUsage = parsed as object;
      } else {
        process.stderr.write(`durable-sink: findTokenUsageJson is not a JSON object — writing null\n`);
      }
    } catch {
      process.stderr.write(`durable-sink: invalid findTokenUsageJson — writing null\n`);
      process.exit(2);
    }
  }

  const sinkDir = writeDurableSink({ runId, found, deduped, dispatched, findTokenUsage });
  process.stdout.write(`durable-sink: wrote ${sinkDir}/\n`);
}

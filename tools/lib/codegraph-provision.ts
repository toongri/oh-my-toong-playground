/**
 * codegraph-provision.ts
 *
 * Sync-time provisioning for the `codegraph` binary and per-project index.
 * Invoked at the END of the sync flow (after all sync.yaml processing).
 *
 * Design contract:
 *   - planCodegraphInit:  pure-ish guard — decides WHICH dirs are safe to init
 *   - ensureCodegraphBinary: foreground install if absent; never throws
 *   - provisionCodegraph: composes both; background-spawns `codegraph init`
 *
 * A missing/failing codegraph binary MUST NOT break `make sync`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// planCodegraphInit
// ---------------------------------------------------------------------------

/**
 * Returns the subset of repoDirs that are safe to `codegraph init`.
 *
 * Skips a dir if ANY of the following hold:
 *   - does not exist or is not a directory
 *   - dir === os.homedir()          (never index $HOME)
 *   - dir === "/"                   (never index filesystem root)
 *   - <dir>/tools/sync.ts exists   (the OMT harness repo — low value)
 *   - <dir>/.codegraph/codegraph.db exists  (already indexed — idempotent)
 */
export function planCodegraphInit(repoDirs: string[]): string[] {
  const home = os.homedir();
  const result: string[] = [];

  for (const dir of repoDirs) {
    // Must exist and be a directory
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Never index $HOME or filesystem root
    if (dir === home || dir === "/") continue;

    // Skip the OMT harness repo (contains tools/sync.ts)
    if (fs.existsSync(path.join(dir, "tools", "sync.ts"))) continue;

    // Skip already-indexed repos
    if (fs.existsSync(path.join(dir, ".codegraph", "codegraph.db"))) continue;

    result.push(dir);
  }

  return result;
}

// ---------------------------------------------------------------------------
// ensureCodegraphBinary
// ---------------------------------------------------------------------------

/**
 * Ensures the `codegraph` binary is on PATH.
 *
 * - If already present: noop.
 * - If absent and dryRun: log intent only.
 * - If absent and !dryRun: install via `npm i -g @colbymchenry/codegraph` (foreground/awaited).
 *   Install failure is non-fatal: warn and continue.
 */
export function ensureCodegraphBinary(opts: { dryRun: boolean }): void {
  // Bun.which returns the path if found, null if not
  const found = Bun.which("codegraph");
  if (found !== null) return;

  if (opts.dryRun) {
    process.stderr.write(
      "[codegraph] codegraph not found on PATH — would install: npm i -g @colbymchenry/codegraph\n",
    );
    return;
  }

  process.stderr.write("[codegraph] codegraph not found on PATH — installing: npm i -g @colbymchenry/codegraph\n");
  try {
    const result = spawnSync("npm", ["i", "-g", "@colbymchenry/codegraph"], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) {
      process.stderr.write(
        `[codegraph] install exited with status ${result.status} — skipping codegraph init\n`,
      );
    } else {
      process.stderr.write("[codegraph] installed successfully\n");
    }
  } catch (err) {
    process.stderr.write(`[codegraph] install failed (non-fatal): ${err}\n`);
  }
}

// ---------------------------------------------------------------------------
// provisionCodegraph
// ---------------------------------------------------------------------------

/**
 * Provisions codegraph for the given project directories.
 *
 * 1. Ensures the binary is installed (foreground, non-fatal on failure).
 * 2. Filters repoDirs through planCodegraphInit (safety guards).
 * 3. For each eligible dir:
 *    - dryRun: logs intent only.
 *    - !dryRun: spawns `codegraph init` DETACHED + unreffed (background, non-blocking).
 *              A spawn error is caught and logged, never thrown.
 */
export function provisionCodegraph(repoDirs: string[], opts: { dryRun: boolean }): void {
  ensureCodegraphBinary(opts);

  const eligibleDirs = planCodegraphInit(repoDirs);
  if (eligibleDirs.length === 0) return;

  for (const dir of eligibleDirs) {
    if (opts.dryRun) {
      process.stderr.write(`[codegraph] would init ${dir}\n`);
      continue;
    }

    try {
      const child = spawn("codegraph", ["init"], {
        cwd: dir,
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      process.stderr.write(`[codegraph] init started: ${dir}\n`);
    } catch (err) {
      process.stderr.write(`[codegraph] init spawn failed (non-fatal) for ${dir}: ${err}\n`);
    }
  }
}

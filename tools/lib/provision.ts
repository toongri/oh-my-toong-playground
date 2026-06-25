/**
 * provision.ts
 *
 * Generic sync-time provisioning engine.
 * Runs provision items (check + commands) at each deploy target directory.
 *
 * Design contract:
 *   - Non-fatal: a failing check or command logs a warning and continues.
 *     A missing/failed provision MUST NOT break `make sync`.
 *   - dryRun-safe: in dryRun mode, nothing is executed — only log intent.
 *   - Per-dir: each item runs at cwd=targetDir.
 *   - Ordered: items run in declaration order (item 0 before item 1).
 *   - check semantics: exit 0 → already satisfied → SKIP this item's commands.
 *                      non-zero (or absent) → run commands.
 */

import fs from "node:fs";
import { logDry, logInfo, logWarn } from "./logger.ts";
import type { ProvisionItem } from "./types.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runCommandSync(command: string, cwd: string): { exitCode: number } {
  const proc = Bun.spawnSync(["bash", "-c", command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return { exitCode: proc.exitCode ?? 1 };
}

// ---------------------------------------------------------------------------
// runProvision
// ---------------------------------------------------------------------------

/**
 * Runs provision items for each existing target directory.
 *
 * For each dir in targetDirs:
 *   - If the dir does not exist (fs), skip it entirely.
 *   - For each item in items (in order):
 *     - If item.check is present: run it at cwd=dir.
 *       Exit 0 → SKIP this item (already satisfied).
 *       Non-zero (or error) → proceed to run commands.
 *     - Run each command in item.commands in order at cwd=dir.
 *       A failing command is non-fatal: log and continue.
 *
 * dryRun=true: log intended actions only, execute nothing.
 */
export function runProvision(
  items: ProvisionItem[],
  targetDirs: string[],
  opts: { dryRun: boolean },
): void {
  if (items.length === 0) return;

  for (const dir of targetDirs) {
    // Skip non-existent dirs
    if (!fs.existsSync(dir)) {
      logInfo(`provision skip (dir not found): ${dir}`);
      continue;
    }

    for (const item of items) {
      // Check phase
      if (item.check) {
        if (opts.dryRun) {
          logDry(`provision would check: ${item.check} @ ${dir}`);
          // In dryRun we don't know what check would return; report both paths as intent.
          for (const cmd of item.commands) {
            logDry(`provision would run (if check fails): ${cmd} @ ${dir}`);
          }
          continue;
        }

        let checkPassed = false;
        try {
          const result = runCommandSync(item.check, dir);
          if (result.exitCode === 0) {
            checkPassed = true;
          }
        } catch {
          // Check itself errored → treat as not satisfied → run commands
        }

        if (checkPassed) {
          logInfo(`provision skip (check passed): ${item.check} @ ${dir}`);
          continue;
        }
      }

      // Commands phase
      for (const cmd of item.commands) {
        if (opts.dryRun) {
          logDry(`provision would run: ${cmd} @ ${dir}`);
          continue;
        }

        try {
          const result = runCommandSync(cmd, dir);
          if (result.exitCode !== 0) {
            logWarn(`provision command exited with status ${result.exitCode} (non-fatal): ${cmd} @ ${dir}`);
          }
        } catch (err) {
          logWarn(`provision command failed (non-fatal): ${cmd} @ ${dir}: ${err}`);
        }
      }
    }
  }
}

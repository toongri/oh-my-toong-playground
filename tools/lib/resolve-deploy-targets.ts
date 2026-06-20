import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Thrown by resolveDeployTargets for two distinct failure modes:
 *   (a) the git worktree-list command errors (not a repo, git absent, dubious ownership)
 *   (b) the bare-structure path resolves to zero worktrees after excluding bare/prunable blocks
 *
 * Callers MUST surface this loudly (non-zero exit) — silently returning an
 * empty or incorrect target set would cause the deploy step to write nothing
 * without any signal to the operator.
 */
export class DeployTargetsError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "DeployTargetsError";
  }
}

/**
 * Parses `git worktree list --porcelain` output into a list of non-bare,
 * non-prunable worktree paths.
 *
 * Porcelain format (blocks separated by blank lines):
 *   worktree <abs-path>
 *   HEAD <sha>          (absent for bare)
 *   branch <ref>        (absent for detached/bare)
 *   bare                (marker line, no value)
 *   detached            (marker line, no value)
 *   locked [reason]     (marker line + optional reason)
 *   prunable <reason>   (marker line + reason)
 */
function parsePorcelain(output: string): string[] {
  const blocks = output.trim().split(/\n\n+/);
  const result: string[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");

    let worktreePath: string | undefined;
    let isBare = false;
    let isPrunable = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length).trim();
      } else if (line === "bare") {
        isBare = true;
      } else if (line.startsWith("prunable")) {
        isPrunable = true;
      }
      // locked and detached are intentionally NOT excluded — they are real working trees
    }

    if (worktreePath && !isBare && !isPrunable) {
      result.push(worktreePath);
    }
  }

  return result;
}

/**
 * Resolves the set of deploy targets for a given path.
 *
 * - If `<path>/.bare` does not exist or is not a directory, returns `[path]` unchanged.
 * - If `<path>/.bare` exists and is a directory (bare-structure), runs
 *   `git --git-dir=<path>/.bare worktree list --porcelain` and returns all
 *   non-bare, non-prunable worktree paths. The bare entry itself is excluded
 *   by construction (it carries the `bare` marker). Locked and detached
 *   worktrees ARE included — they are real working trees.
 *
 * Throws DeployTargetsError for:
 *   (a) git command errors (not a repo / git absent / dubious ownership)
 *   (b) zero worktrees after filtering bare/prunable blocks
 *
 * The input path must already be tilde-expanded — this function does NOT
 * expand `~`.
 *
 * @param targetPath - Absolute, already-tilde-expanded path to inspect.
 */
export function resolveDeployTargets(targetPath: string): string[] {
  const bareDir = path.join(targetPath, ".bare");

  // Detection (D-2): bare-structure iff .bare exists AND is a directory
  let isBareStructure: boolean;
  try {
    isBareStructure = fs.statSync(bareDir).isDirectory();
  } catch {
    // .bare does not exist — plain path
    isBareStructure = false;
  }

  if (!isBareStructure) {
    return [targetPath];
  }

  // Enumeration (D-3): ask git for the worktree list
  let stdout: string;
  try {
    const result = execFileSync(
      "git",
      ["--git-dir", bareDir, "worktree", "list", "--porcelain"],
      { stdio: ["pipe", "pipe", "pipe"], env: process.env },
    );
    stdout = result.toString();
  } catch (err) {
    throw new DeployTargetsError(
      `Failed to enumerate worktrees for bare-structure at ${targetPath}: ` +
        `git worktree list command failed. ` +
        `Ensure git is installed, the path is a valid git bare repo, and check ` +
        `repository ownership (e.g. git config --global --add safe.directory). ` +
        `Original error: ${err}`,
      err,
    );
  }

  const worktrees = parsePorcelain(stdout);

  if (worktrees.length === 0) {
    throw new DeployTargetsError(
      `Bare-structure at ${targetPath} resolved to no worktrees. ` +
        `Add at least one git worktree before deploying.`,
    );
  }

  return worktrees;
}

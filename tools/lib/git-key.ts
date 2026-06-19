import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Derives the key used by Claude Code's ~/.claude.json `projects[]` map
 * for a given target path.
 *
 * The key is the git common-dir, which is shared across all worktrees of a
 * repo — giving a stable per-repo key that byte-matches Claude Code's keying.
 *
 * Branch logic:
 *   (a) common-dir is <root>/.git (standalone or linked-worktree off standalone)
 *       → return dirname(common-dir) = repo root
 *   (b) common-dir is a bare-pattern dir (e.g. .bare)
 *       → return common-dir as-is
 *   (c) not a git repository
 *       → return fs.realpathSync(targetPath)
 *   (d) git fails for any other reason (dubious ownership, git absent, git < 2.31)
 *       → throw — must never silently mis-key
 *
 * Requires git >= 2.31 (--path-format=absolute). Older git must throw loudly.
 * Do NOT call fs.realpathSync on branches (a) or (b) — git already canonicalizes.
 *
 * @param targetPath - The directory to derive the key for.
 * @param env - Optional environment to pass to the git subprocess (defaults to
 *   process.env). Exposed for testing only — callers should omit this parameter.
 */
export function deriveClaudeProjectKey(
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let stdout: string;
  let stderr: string;

  try {
    const result = execFileSync(
      "git",
      ["-C", targetPath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { stdio: ["pipe", "pipe", "pipe"], env },
    );
    stdout = result.toString();
    stderr = "";
  } catch (err: unknown) {
    const spawnErr = err as { stderr?: Buffer | string };
    stderr = spawnErr.stderr ? spawnErr.stderr.toString() : "";

    if (stderr.includes("not a git repository")) {
      // Branch (c): not a git repo — resolve symlinks on the input path
      return fs.realpathSync(targetPath);
    }

    // Branch (d): git failure for another reason — must throw loudly
    throw err;
  }

  const commonDir = stdout.trim();

  if (path.basename(commonDir) === ".git") {
    // Branch (a): standard repo or linked-worktree off standalone
    // common-dir = <root>/.git → return the repo root
    return path.dirname(commonDir);
  }

  // Branch (b): bare-pattern repo (e.g. .bare)
  // common-dir is the bare dir itself — return it as-is
  return commonDir;
}

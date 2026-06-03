/**
 * OMT_DIR Resolution Module
 * Provides the per-project OMT working directory path.
 *
 * Resolution order:
 * 1. $OMT_DIR env var (set by session-start.sh)
 * 2. Computed from git repo name + $HOME/.omt/{sanitized-name}
 * 3. Fallback to basename(cwd) when not in a git repo
 */

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, resolve } from 'path';

/**
 * Returns the OMT working directory for the current project.
 * Mirrors the PROJECT_NAME derivation logic in session-start.sh (lines 49-68).
 * Creates the directory if it does not exist.
 */
export function getOmtDir(): string {
  const dir = resolveOmtDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns the OMT working directory path for the current project.
 * Mirrors getOmtDir's env→git→cwd derivation exactly but does NOT create
 * the directory. Safe to call in read-only contexts (e.g. manifest resolution).
 *
 * @param cwd - Directory to derive project name from when OMT_DIR is unset.
 *              Defaults to process.cwd(). Pass input.cwd from hook input to
 *              correctly resolve the user manifest for the Claude session's
 *              working directory rather than the hook process's own cwd.
 */
export function resolveOmtDir(cwd: string = process.cwd()): string {
  if (process.env.OMT_DIR) {
    return process.env.OMT_DIR;
  }

  const projectName = deriveProjectName(cwd);
  return `${homedir()}/.omt/${projectName}`;
}

/**
 * Returns the project root directory for the given cwd.
 *
 * Resolves to the git worktree top-level so a session launched from a
 * subdirectory still resolves to the repo root (matching where pin-setup
 * tells users to place pins.yaml). Falls back to cwd when not inside a git
 * repository. Performs no filesystem writes.
 *
 * @param cwd - Directory to resolve from. Defaults to process.cwd().
 */
export function resolveProjectRoot(cwd: string = process.cwd()): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return cwd;
  }
}

function deriveProjectName(cwd: string): string {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    let name: string;

    if (gitCommonDir !== '.git') {
      // Worktree or subdirectory: resolve relative path against cwd
      const resolved = resolve(cwd, gitCommonDir);
      name = basename(dirname(resolved));
    } else {
      // Standard repo: use toplevel directory name
      const toplevel = execSync('git rev-parse --show-toplevel', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      name = basename(toplevel);
    }

    return name.replace(/ /g, '-');
  } catch {
    // Not a git repo — fall back to basename of cwd
    return basename(cwd).replace(/ /g, '-');
  }
}

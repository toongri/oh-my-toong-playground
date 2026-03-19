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
import { basename, dirname } from 'path';

/**
 * Returns the OMT working directory for the current project.
 * Mirrors the PROJECT_NAME derivation logic in session-start.sh (lines 49-68).
 * Creates the directory if it does not exist.
 */
export function getOmtDir(): string {
  if (process.env.OMT_DIR) {
    const dir = process.env.OMT_DIR;
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const cwd = process.cwd();
  const projectName = deriveProjectName(cwd);
  const dir = `${homedir()}/.omt/${projectName}`;
  mkdirSync(dir, { recursive: true });
  return dir;
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
      // Worktree: git-common-dir returns absolute path like /path/to/repo/.git
      name = basename(dirname(gitCommonDir));
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

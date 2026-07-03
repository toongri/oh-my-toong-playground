import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Thrown by deriveClaudeProjectKey branch (d): git failed for a reason other
 * than "not a git repository" (dubious ownership, git absent, git < 2.31 where
 * --path-format=absolute is unknown). Carries an actionable remediation message
 * and the original error as `cause`. Callers MUST surface this loudly (non-zero
 * exit) — silently mis-keying a local MCP into ~/.claude.json is the worst
 * failure class for this tool.
 */
function hasStderr(err: unknown): err is { stderr?: Buffer | string } {
	return typeof err === "object" && err !== null && "stderr" in err;
}

export class ProjectKeyError extends Error {
	constructor(targetPath: string, cause: unknown) {
		super(
			`Failed to derive Claude project key for ${targetPath}: git command failed. ` +
				`Ensure git >= 2.31 is installed and check repository ownership ` +
				`(e.g. git config --global --add safe.directory). Original error: ${cause}`,
			{ cause },
		);
		this.name = "ProjectKeyError";
	}
}

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

	try {
		const result = execFileSync(
			"git",
			["-C", targetPath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
			{ stdio: ["pipe", "pipe", "pipe"], env },
		);
		stdout = result.toString();
	} catch (err: unknown) {
		const stderr = hasStderr(err) && err.stderr ? err.stderr.toString() : "";

		if (stderr.includes("not a git repository")) {
			// Branch (c): not a git repo — resolve symlinks on the input path
			return fs.realpathSync(targetPath);
		}

		// Branch (d): git failure for another reason — must throw loudly
		throw new ProjectKeyError(targetPath, err);
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

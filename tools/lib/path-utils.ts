import os from "os";
import path from "path";

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 *
 * Rules:
 *   `~`        → os.homedir()
 *   `~/foo`    → path.join(os.homedir(), "foo")
 *   `~user/…`  → returned as-is (POSIX ~user not supported)
 *   absolute   → returned as-is
 *   relative   → returned as-is
 *   empty      → returned as-is
 */
export function expandTilde(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

/**
 * Returns true when targetPath resolves to the user's home directory.
 * Adapters use this to choose between $HOME (global sync) and $CLAUDE_PROJECT_DIR (project sync).
 * Symlinked homedir is not followed — uses path.resolve only. If needed later, switch to fs.realpathSync.
 */
export function isGlobalSync(targetPath: string): boolean {
	return path.resolve(expandTilde(targetPath)) === path.resolve(os.homedir());
}

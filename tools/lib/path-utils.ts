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

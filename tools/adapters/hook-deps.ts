import fs from "fs/promises";
import path from "path";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";

/**
 * Recursively resolve shell `source` dependencies for a .sh file.
 *
 * Scans the file for lines matching:
 *   source "$SOME_VAR/relative/path.sh"
 *   . "$SOME_VAR/relative/path.sh"
 * Captures the relative path after the variable reference, resolves it
 * under hooksSourceDir, and recurses (with cycle detection).
 *
 * Returns absolute paths of all discovered dependencies that exist on disk.
 * Test files (*_test.sh) are excluded.
 */
export async function resolveShellDependencies(
  filePath: string,
  hooksSourceDir: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  // Match: source "$VAR/rel/path.sh" or . "$VAR/rel/path.sh"
  // Handles both ${VAR} and $VAR, single or double quotes, optional quotes
  const SOURCE_RE =
    /^\s*(?:source|\.)\s+["']?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?[/]([\w./-]+\.sh)["']?/;

  const deps: string[] = [];

  for (const line of content.split("\n")) {
    // Skip commented lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) continue;

    const match = SOURCE_RE.exec(line);
    if (!match) continue;

    const relPath = match[1];
    // Exclude test files
    if (relPath.endsWith("_test.sh")) continue;

    const absPath = path.join(hooksSourceDir, relPath);

    // Check existence
    try {
      await fs.stat(absPath);
    } catch {
      logWarn(`Shell dependency not found, skipping: ${absPath}`);
      continue;
    }

    if (!visited.has(absPath)) {
      deps.push(absPath);
      // Recurse to pick up transitive dependencies
      const transitive = await resolveShellDependencies(
        absPath,
        hooksSourceDir,
        visited,
      );
      deps.push(...transitive);
    }
  }

  return deps;
}

/**
 * Copy (or dry-run log) shell source dependencies for a single .sh file.
 *
 * Resolves dependencies via resolveShellDependencies(), then copies each
 * discovered file into targetHooksDir, preserving the relative path under
 * hooksSourceDir.
 */
export async function syncShellDependencies(
  sourcePath: string,
  hooksSourceDir: string,
  targetHooksDir: string,
  dryRun: boolean,
): Promise<void> {
  const deps = await resolveShellDependencies(sourcePath, hooksSourceDir);
  for (const dep of deps) {
    const relDep = path.relative(hooksSourceDir, dep);
    const targetDep = path.join(targetHooksDir, relDep);
    if (dryRun) {
      logDry(`Copy (dep): ${dep} -> ${targetDep}`);
    } else {
      await fs.mkdir(path.dirname(targetDep), { recursive: true });
      await fs.copyFile(dep, targetDep);
      logInfo(`Copied (dep): ${relDep}`);
    }
  }
}

/**
 * Scan all .sh files in a hook directory for shell source dependencies,
 * then copy (or log) each discovered dependency.
 * Dependencies are resolved relative to hooksBaseDir (the hooks root),
 * not hookDir itself — allowing .sh files inside a subdirectory to reference
 * shared libraries outside their own directory (e.g. hooks/lib/).
 */
export async function syncShellDepsForDir(
  hookDir: string,
  hooksBaseDir: string,
  targetHooksDir: string,
  dryRun: boolean,
): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = (await fs.readdir(hookDir, { withFileTypes: true })) as import("fs").Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sh")) continue;
    if (entry.name.endsWith("_test.sh")) continue;

    const shFile = path.join(hookDir, entry.name);
    await syncShellDependencies(shFile, hooksBaseDir, targetHooksDir, dryRun);
  }
}

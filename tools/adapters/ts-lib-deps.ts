import fs from "fs/promises";
import path from "path";
import { logWarn } from "../lib/logger.ts";

/**
 * Recursively resolve `@lib/` import dependencies for a .ts file.
 *
 * Scans the file for lines matching:
 *   from "@lib/xxx"
 *   from '@lib/xxx'
 *   import "@lib/xxx"
 *   import '@lib/xxx'
 *   import("@lib/xxx")
 *   import('@lib/xxx')
 * The xxx part may or may not include a .ts extension.
 *
 * Resolves each reference under libSourceDir (appending .ts if needed),
 * and recurses to pick up transitive dependencies (with cycle detection).
 *
 * Returns absolute paths of all discovered lib files that exist on disk.
 * Test files (*.test.ts) are excluded.
 */
export async function resolveTsLibDependencies(
  filePath: string,
  libSourceDir: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  // Exclude test files
  if (filePath.endsWith(".test.ts")) return [];

  if (visited.has(filePath)) return [];
  visited.add(filePath);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  // Match: from "@lib/xxx" or from '@lib/xxx'
  //        import "@lib/xxx" or import '@lib/xxx'
  //        import("@lib/xxx") or import('@lib/xxx')  (dynamic import)
  // The xxx may contain letters, digits, underscores, hyphens, dots, slashes
  const LIB_IMPORT_RE = /(?:from|import)\s*[\s(]["']@lib\/([^"']+)["']/g;

  const deps: string[] = [];

  for (const line of content.split("\n")) {
    // Skip commented lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) continue;

    let match: RegExpExecArray | null;
    LIB_IMPORT_RE.lastIndex = 0;
    while ((match = LIB_IMPORT_RE.exec(line)) !== null) {
      let moduleName = match[1];

      // Strip .ts extension if present to get the base name
      if (moduleName.endsWith(".ts")) {
        moduleName = moduleName.slice(0, -3);
      }

      const absPath = path.join(libSourceDir, `${moduleName}.ts`);

      // Check existence
      try {
        await fs.stat(absPath);
      } catch {
        logWarn(`TS lib dependency not found, skipping: ${absPath}`);
        continue;
      }

      if (!visited.has(absPath)) {
        deps.push(absPath);
        // Recurse to pick up transitive dependencies
        const transitive = await resolveTsLibDependencies(
          absPath,
          libSourceDir,
          visited,
        );
        deps.push(...transitive);
      }
    }
  }

  return deps;
}

/**
 * Scan all .ts files under platformDir for `@lib/` import dependencies,
 * and return the deduplicated set of required lib module absolute paths.
 *
 * Excludes:
 * - The lib/ subdirectory itself (to avoid scanning the source lib files)
 * - *.test.ts files
 */
export async function collectRequiredLibModules(
  platformDir: string,
  libSourceDir: string,
): Promise<Set<string>> {
  const result = new Set<string>();
  const shared = new Set<string>();
  const tsFiles = await collectTsFiles(platformDir, platformDir);
  for (const filePath of tsFiles) {
    const deps = await resolveTsLibDependencies(filePath, libSourceDir, shared);
    for (const dep of deps) {
      result.add(dep);
    }
  }
  return result;
}

/**
 * Recursively collect all .ts files under a directory,
 * excluding the lib/ subdirectory and *.test.ts files.
 */
async function collectTsFiles(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Exclude lib/ directory under the platform root
      const rel = path.relative(root, fullPath);
      if (rel === "lib" || rel.startsWith("lib" + path.sep)) continue;
      results.push(...(await collectTsFiles(fullPath, root)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      // Exclude test files
      if (entry.name.endsWith(".test.ts")) continue;
      results.push(fullPath);
    }
  }
  return results;
}

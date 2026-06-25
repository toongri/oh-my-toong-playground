import fs from "fs/promises";
import path from "path";

/** Python cache patterns that are always excluded, regardless of any caller-supplied list. */
export const PY_CACHE_EXCLUDE = ["__pycache__", ".pytest_cache", "*.pyc"];

export const DEFAULT_EXCLUDE = [...PY_CACHE_EXCLUDE, "*.test.ts"];

/**
 * Checks if a filename matches any of the given glob-style exclude patterns.
 * Only supports simple "*.ext" wildcard prefix patterns.
 */
export function isExcluded(filename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // e.g. ".test.ts"
      if (filename.endsWith(suffix)) return true;
    } else {
      if (filename === pattern) return true;
    }
  }
  return false;
}

/**
 * Recursively collects all file paths under a directory.
 * Returns paths relative to the root dir.
 *
 * Excluded names are pruned DURING the walk: an excluded directory name (e.g.
 * `__pycache__`, `.pytest_cache`) is never descended into, and excluded files
 * (e.g. `*.pyc`) are skipped. Pruning at the walk — not only in the caller's
 * post-filter — is what keeps the contents of a cache directory off the copy
 * list, since the source tree is copied verbatim from disk, not from git.
 */
export async function collectFiles(
  dir: string,
  rel = "",
  exclude: string[] = DEFAULT_EXCLUDE,
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (isExcluded(entry.name, exclude)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await collectFiles(path.join(dir, entry.name), relPath, exclude);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Recursively collects all directory paths under a directory.
 * Returns paths relative to the root dir, deepest first.
 */
export async function collectDirs(dir: string, rel = ""): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return results;
    }
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const nested = await collectDirs(path.join(dir, entry.name), relPath);
      results.push(...nested);
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Rewrites @lib/ import aliases in TypeScript source content to relative paths.
 *
 * This is a pure helper shared by both copy-time rewrite (syncDirectory) and
 * the post-pass rewrite (rewriteLibAliases in sync.ts). Both must produce
 * identical output so that the post-pass is a no-op on already-rewritten files.
 *
 * @param content      File content to rewrite
 * @param targetFile   Absolute path where the file will be written (used to compute depth)
 * @param platformRoot Absolute path to the platform root directory (e.g. /path/.claude/)
 * @returns            Rewritten content, or the original string if no @lib/ present
 */
export function rewriteLibImports(
  content: string,
  targetFile: string,
  platformRoot: string,
): string {
  if (!content.includes("@lib/")) return content;

  const dir = path.dirname(targetFile);
  const relDir = path.relative(platformRoot, dir);
  const depth = relDir === "" ? 0 : relDir.split(path.sep).length;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);

  return content
    .replace(/'@lib\//g, `'${prefix}lib/`)
    .replace(/"@lib\//g, `"${prefix}lib/`);
}

/**
 * Copies a single file from source to target, preserving execute permissions.
 */
export async function copyFile(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target, fs.constants.COPYFILE_FICLONE);
  const stat = await fs.stat(source);
  if (stat.mode & 0o111) {
    const targetStat = await fs.stat(target);
    await fs.chmod(target, targetStat.mode | 0o111);
  }
}

/**
 * Synchronizes a source directory to a target directory.
 * Mirrors rsync -a --delete --exclude behavior:
 *   - Recursively copies source files to target (preserving relative paths)
 *   - Skips files matching exclude patterns
 *   - Deletes target files not present in source (orphan cleanup)
 *   - Removes empty directories in target after orphan cleanup
 *   - Preserves execute permissions
 *
 * @param source  Absolute path to source directory
 * @param target  Absolute path to target directory
 * @param options Optional configuration
 * @param options.exclude      Glob-style patterns to exclude (default: ["*.test.ts"])
 * @param options.platformRoot When provided, rewrites @lib/ aliases in .ts files at
 *                             write time so the deployed bytes are already resolved.
 *                             Must be the platform root dir (e.g. /path/.claude/).
 */
export async function syncDirectory(
  source: string,
  target: string,
  options?: { exclude?: string[]; platformRoot?: string }
): Promise<void> {
  // PY_CACHE_EXCLUDE is always prepended so callers that supply a custom list
  // (e.g. { exclude: ["*.test.ts"] }) do not accidentally lose Python cache pruning.
  const exclude = [...PY_CACHE_EXCLUDE, ...(options?.exclude ?? ["*.test.ts"])];
  const platformRoot = options?.platformRoot;

  // 1. Ensure target directory exists
  await fs.mkdir(target, { recursive: true });

  // 2. Collect source files (excluded dir names are pruned during the walk)
  const sourceFiles = await collectFiles(source, "", exclude);

  // 3. Determine files to copy (respecting exclude patterns)
  const includedSourceFiles = sourceFiles.filter((relPath) => {
    const filename = path.basename(relPath);
    return !isExcluded(filename, exclude);
  });

  // 4. Copy included files to target, preserving permissions.
  //    If platformRoot is set, rewrite @lib/ aliases in .ts files at write time
  //    so that no deployed file ever exists on disk with raw @lib/ specifiers.
  for (const relPath of includedSourceFiles) {
    const srcFile = path.join(source, relPath);
    const tgtFile = path.join(target, relPath);

    if (platformRoot && tgtFile.endsWith(".ts") && !tgtFile.endsWith(".test.ts")) {
      await fs.mkdir(path.dirname(tgtFile), { recursive: true });
      const srcContent = await fs.readFile(srcFile, "utf8");
      const rewritten = rewriteLibImports(srcContent, tgtFile, platformRoot);
      await fs.writeFile(tgtFile, rewritten, "utf8");
      // Preserve execute permissions
      const stat = await fs.stat(srcFile);
      if (stat.mode & 0o111) {
        const tgtStat = await fs.stat(tgtFile);
        await fs.chmod(tgtFile, tgtStat.mode | 0o111);
      }
    } else {
      await copyFile(srcFile, tgtFile);
    }
  }

  // 5. Collect target files and delete orphans. Walk the full target tree
  //    (no prune) so orphan detection sees every deployed file; the per-file
  //    isExcluded guard below preserves excluded target-only files.
  const targetFiles = await collectFiles(target, "", []);
  const includedSourceSet = new Set(includedSourceFiles);

  for (const relPath of targetFiles) {
    if (!includedSourceSet.has(relPath) && !isExcluded(path.basename(relPath), exclude)) {
      await fs.unlink(path.join(target, relPath));
    }
  }

  // 6. Remove empty directories in target (deepest first)
  const targetDirs = await collectDirs(target);
  for (const relDir of targetDirs) {
    const absDir = path.join(target, relDir);
    try {
      const contents = await fs.readdir(absDir);
      if (contents.length === 0) {
        await fs.rmdir(absDir);
      }
    } catch {
      // Directory may have already been removed
    }
  }
}

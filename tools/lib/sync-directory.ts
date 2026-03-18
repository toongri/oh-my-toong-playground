import fs from "fs/promises";
import path from "path";

/**
 * Checks if a filename matches any of the given glob-style exclude patterns.
 * Only supports simple "*.ext" wildcard prefix patterns.
 */
function isExcluded(filename: string, patterns: string[]): boolean {
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
 */
async function collectFiles(dir: string, rel = ""): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await collectFiles(path.join(dir, entry.name), relPath);
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
async function collectDirs(dir: string, rel = ""): Promise<string[]> {
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
 * @param options.exclude  Glob-style patterns to exclude (default: ["*.test.ts"])
 */
export async function syncDirectory(
  source: string,
  target: string,
  options?: { exclude?: string[] }
): Promise<void> {
  const exclude = options?.exclude ?? ["*.test.ts"];

  // 1. Ensure target directory exists
  await fs.mkdir(target, { recursive: true });

  // 2. Collect source files
  const sourceFiles = await collectFiles(source);

  // 3. Determine files to copy (respecting exclude patterns)
  const includedSourceFiles = sourceFiles.filter((relPath) => {
    const filename = path.basename(relPath);
    return !isExcluded(filename, exclude);
  });

  // 4. Copy included files to target, preserving permissions
  for (const relPath of includedSourceFiles) {
    const srcFile = path.join(source, relPath);
    const tgtFile = path.join(target, relPath);
    await copyFile(srcFile, tgtFile);
  }

  // 5. Collect target files and delete orphans
  const targetFiles = await collectFiles(target);
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

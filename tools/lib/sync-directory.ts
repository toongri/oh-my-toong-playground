import fs from "fs/promises";
import path from "path";

export const DEFAULT_EXCLUDE = ["*.test.ts"];

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
 */
export async function collectFiles(dir: string, rel = ""): Promise<string[]> {
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
 * Rewrites @lib/ import aliases and bundled bare specifiers in TypeScript
 * source content to relative paths.
 *
 * This is a pure helper shared by both copy-time rewrite (syncDirectory) and
 * the post-pass rewrite (rewriteLibAliases in sync.ts). Both must produce
 * identical output so that the post-pass is a no-op on already-rewritten files.
 *
 * Bundled bare specifiers (e.g. `import x from "picomatch"`) are repointed at
 * the vendored bundle deployed under lib/vendor/<pkg>.js. The `.js` extension is
 * emitted explicitly: the bundle is a .js file and the deploy target carries no
 * package.json "type", so node's ESM resolver rejects an extensionless relative
 * specifier (bun tolerates it, node does not). The match is anchored on the FULL
 * quoted specifier (D-4): `'picomatch'` matches but `'picomatch-extra'`, the
 * sub-path `'picomatch/lib/x'`, and a bare identifier `picomatchResult` do not —
 * so collisions are impossible.
 *
 * @param content         File content to rewrite
 * @param targetFile      Absolute path where the file will be written (used to compute depth)
 * @param platformRoot    Absolute path to the platform root directory (e.g. /path/.claude/)
 * @param bundledPackages Package names whose bare specifiers are repointed at lib/vendor/<pkg>
 * @returns               Rewritten content, or the original string if nothing rewritable present
 */
export function rewriteLibImports(
  content: string,
  targetFile: string,
  platformRoot: string,
  bundledPackages: Set<string>,
): string {
  const hasBundled = [...bundledPackages].some(
    (pkg) => content.includes(`'${pkg}'`) || content.includes(`"${pkg}"`),
  );
  if (!content.includes("@lib/") && !hasBundled) return content;

  const dir = path.dirname(targetFile);
  const relDir = path.relative(platformRoot, dir);
  const depth = relDir === "" ? 0 : relDir.split(path.sep).length;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);

  let result = content
    .replace(/'@lib\//g, `'${prefix}lib/`)
    .replace(/"@lib\//g, `"${prefix}lib/`);

  for (const pkg of bundledPackages) {
    result = result
      .split(`'${pkg}'`)
      .join(`'${prefix}lib/vendor/${pkg}.js'`)
      .split(`"${pkg}"`)
      .join(`"${prefix}lib/vendor/${pkg}.js"`);
  }

  return result;
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
 * @param options.bundledPackages Package names whose bare specifiers are repointed at
 *                             lib/vendor/<pkg> at write time. Defaults to empty — the
 *                             real set is only known later, so the post-pass rewrite
 *                             (rewriteLibAliases) carries it; copy-time stays a no-op.
 */
export async function syncDirectory(
  source: string,
  target: string,
  options?: { exclude?: string[]; platformRoot?: string; bundledPackages?: Set<string> }
): Promise<void> {
  const exclude = options?.exclude ?? DEFAULT_EXCLUDE;
  const platformRoot = options?.platformRoot;
  const bundledPackages = options?.bundledPackages ?? new Set<string>();

  // 1. Ensure target directory exists
  await fs.mkdir(target, { recursive: true });

  // 2. Collect source files
  const sourceFiles = await collectFiles(source);

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
      const rewritten = rewriteLibImports(srcContent, tgtFile, platformRoot, bundledPackages);
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

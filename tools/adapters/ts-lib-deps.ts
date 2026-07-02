import fs from "fs/promises";
import path from "path";
import { builtinModules } from "node:module";
import { logWarn } from "../lib/logger.ts";

// Single source of truth for the relative-import matcher. Used as a pattern
// only — callers build a fresh `new RegExp(RELATIVE_IMPORT_RE.source, "g")` per
// scan so the stateful `lastIndex` is never shared across concurrent scans.
// Matches: from './x', from '../x', import './x', import('../x'), side-effects.
const RELATIVE_IMPORT_RE = /(?:from|import)\s*[\s(]["'](\.\.?\/[^"']+)["']/g;

// Single source of truth for the static data-file reference matcher. Sibling of
// RELATIVE_IMPORT_RE; same fresh-RegExp-per-scan rule (build a new
// `new RegExp(DATA_REF_RE.source, "g")` so `lastIndex` is never shared).
// Matches a join/path call where `import.meta.dir` (or `import.meta.dirname`) is
// immediately followed by a STRING LITERAL filename, e.g.
//   join(import.meta.dir, "tbox.yaml")
//   path.join(import.meta.dirname, 'x.yaml')
// Captures the literal filename. Computed/template/variable args don't match.
const DATA_REF_RE = /import\.meta\.dir(?:name)?\s*,\s*["']([^"']+)["']/g;

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

  // Match relative imports: from './x', from '../x', import './x', import '../x'
  // Also side-effect: import './x';  import '../x';
  const REL_IMPORT_RE = new RegExp(RELATIVE_IMPORT_RE.source, "g");

  const deps: string[] = [];

  for (const line of content.split("\n")) {
    // Skip commented lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) continue;

    // --- @lib/ imports ---
    let match: RegExpExecArray | null;
    LIB_IMPORT_RE.lastIndex = 0;
    while ((match = LIB_IMPORT_RE.exec(line)) !== null) {
      let moduleName = match[1];

      // Strip .ts extension if present to get the base name
      if (moduleName.endsWith(".ts")) {
        moduleName = moduleName.slice(0, -3);
      }

      // Try .ts first (TypeScript source), fall back to .js (vendored runtime artifact).
      // Vendor bundles are emitted as .js (+ a separate hand-written .d.ts for types)
      // so the resolver must discover them even though the source extension is absent.
      let absPath = path.join(libSourceDir, `${moduleName}.ts`);
      try {
        await fs.stat(absPath);
      } catch {
        const jsPath = path.join(libSourceDir, `${moduleName}.js`);
        try {
          await fs.stat(jsPath);
          absPath = jsPath;
        } catch {
          logWarn(`TS lib dependency not found, skipping: ${absPath}`);
          continue;
        }
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

    // --- relative imports (only meaningful when inside a lib module) ---
    // Only track relative imports when the current file is itself under libSourceDir.
    if (!filePath.startsWith(libSourceDir + path.sep) && filePath !== libSourceDir) {
      continue;
    }

    REL_IMPORT_RE.lastIndex = 0;
    while ((match = REL_IMPORT_RE.exec(line)) !== null) {
      let specifier = match[1];

      // Strip .ts extension if present
      if (specifier.endsWith(".ts")) {
        specifier = specifier.slice(0, -3);
      }

      // Resolve relative to the importing file's directory
      const absPath = path.normalize(
        path.join(path.dirname(filePath), `${specifier}.ts`),
      );

      // Confine to libSourceDir — skip paths that escape it
      if (!absPath.startsWith(libSourceDir + path.sep) && absPath !== libSourceDir) {
        continue;
      }

      // Check existence
      try {
        await fs.stat(absPath);
      } catch {
        continue;
      }

      if (!visited.has(absPath)) {
        deps.push(absPath);
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
 * Resolve required lib modules from a set of component SOURCE roots (files or
 * directories) rather than from a deployed platform directory.
 *
 * This is the production path: the deployed tree no longer carries raw `@lib/`
 * specifiers (they are rewritten to relative paths at copy time), so scanning
 * the deployed tree finds nothing. Component SOURCE still contains raw `@lib/`,
 * so the matcher logic in resolveTsLibDependencies works unchanged here.
 *
 * Each root may be a single .ts/.md file (e.g. an agent file) or a directory
 * (e.g. a skill/script/hook bundle). Directories are walked with the same
 * excluder as collectRequiredLibModules: the nested lib/ subdir and *.test.ts
 * files are skipped. (A component bundle never contains a lib/ subdir, but the
 * exclusion is harmless and keeps the two collection paths consistent.)
 */
export async function collectRequiredLibModulesFromSources(
  sourceRoots: Iterable<string>,
  libSourceDir: string,
): Promise<Set<string>> {
  const result = new Set<string>();
  const shared = new Set<string>();
  for (const root of sourceRoots) {
    let tsFiles: string[];
    let stat: import("fs").Stats;
    try {
      stat = await fs.stat(root);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      tsFiles = await collectTsFiles(root, root);
    } else if (root.endsWith(".ts") && !root.endsWith(".test.ts")) {
      tsFiles = [root];
    } else {
      // Non-.ts file (e.g. an agent/command/rule .md) — no @lib/ deps to follow.
      continue;
    }
    for (const filePath of tsFiles) {
      const deps = await resolveTsLibDependencies(filePath, libSourceDir, shared);
      for (const dep of deps) {
        result.add(dep);
      }
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
    entries = await fs.readdir(dir, { withFileTypes: true });
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

/**
 * Trace static data-file references in a single .ts file.
 *
 * Scans for `import.meta.dir`/`import.meta.dirname` immediately followed by a
 * string-literal filename inside a join/path call (see DATA_REF_RE), e.g.
 *   join(import.meta.dir, "tbox.yaml")
 * Each captured literal is resolved against the .ts file's own source directory
 * and returned as an absolute path (existence on disk is verified).
 *
 * Only literal filenames are followed; computed/template/variable args are out
 * of scope and ignored.
 */
async function resolveTsDataReferences(filePath: string, libSourceDir: string): Promise<string[]> {
  if (filePath.endsWith(".test.ts")) return [];

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const re = new RegExp(DATA_REF_RE.source, "g");
  const sourceDir = path.dirname(filePath);
  const dataFiles: string[] = [];

  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("//")) continue;

    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      const absPath = path.normalize(path.join(sourceDir, match[1]));
      // Confine to libSourceDir — skip paths that escape it
      if (!absPath.startsWith(libSourceDir + path.sep) && absPath !== libSourceDir) {
        continue;
      }
      try {
        await fs.stat(absPath);
      } catch {
        continue;
      }
      dataFiles.push(absPath);
    }
  }

  return dataFiles;
}

/**
 * Scan all .ts files under platformDir and return the deduplicated set of
 * absolute data-file paths each .ts statically references via
 * `import.meta.dir`/`import.meta.dirname` + string literal.
 *
 * Contract for T2 (syncLib): this is a SEPARATE set from the `.ts` module set
 * returned by collectRequiredLibModules — that module API is untouched. Each
 * path is resolved against its referencing .ts file's own source dir.
 *
 * Excludes the lib/ subdirectory and *.test.ts files (same as collectTsFiles).
 */
export async function collectLibDataFiles(
  platformDir: string,
): Promise<Set<string>> {
  const result = new Set<string>();
  const tsFiles = await collectTsFiles(platformDir, platformDir);
  for (const filePath of tsFiles) {
    for (const dataFile of await resolveTsDataReferences(filePath, platformDir)) {
      result.add(dataFile);
    }
  }
  return result;
}

/**
 * Find relative imports in a non-lib component file that resolve INTO
 * libSourceDir. Such imports are a deployment hazard: the collector above only
 * follows the `@lib/` alias when gathering a component's lib dependencies, so a
 * relative import reaching into lib/ is silently dropped from the deployed
 * bundle and the deployed file fails at runtime with "Cannot find module".
 *
 * Returns the offending import specifiers (raw text as written). Returns an
 * empty array for files under libSourceDir (intra-lib relative imports are the
 * supported style) and for *.test.ts files (never deployed).
 */
export async function findRelativeLibImports(
  filePath: string,
  libSourceDir: string,
): Promise<string[]> {
  if (filePath.startsWith(libSourceDir + path.sep) || filePath === libSourceDir) {
    return [];
  }
  if (filePath.endsWith(".test.ts")) return [];

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const re = new RegExp(RELATIVE_IMPORT_RE.source, "g");
  const offenders: string[] = [];

  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("//")) continue;

    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      let specifier = match[1];
      if (specifier.endsWith(".ts")) specifier = specifier.slice(0, -3);
      const absPath = path.normalize(
        path.join(path.dirname(filePath), `${specifier}.ts`),
      );
      if (absPath.startsWith(libSourceDir + path.sep) || absPath === libSourceDir) {
        offenders.push(match[1]);
      }
    }
  }

  return offenders;
}

/**
 * Read the root package.json and return the union of `dependencies` and
 * `devDependencies` key names as a Set<string>.
 *
 * Caller supplies `repoRoot` (the absolute path to the repository root) so
 * this function stays a pure detector with no hardcoded paths — consistent
 * with findBareNpmImports which receives its target path from the caller.
 *
 * `peerDependencies` and `optionalDependencies` are intentionally excluded.
 * `@types/*` keys are included as-declared (harmless; they have no bare
 * import targets at runtime).
 *
 * Reads package.json exactly once per call.
 */
export async function readPackageJsonDeps(repoRoot: string): Promise<Set<string>> {
  const pkgPath = path.join(repoRoot, "package.json");
  const raw = await fs.readFile(pkgPath, "utf8");
  const pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(raw);
  const declared = new Set<string>();
  for (const name of Object.keys(pkg.dependencies ?? {})) declared.add(name);
  for (const name of Object.keys(pkg.devDependencies ?? {})) declared.add(name);
  return declared;
}

// Matches any static import specifier (from '...' or import '...' or import(...))
// Used by findBareNpmImports — build a fresh RegExp per call to avoid shared lastIndex.
const IMPORT_SPECIFIER_RE = /(?:from|import)\s*[\s(]["']([^"']+)["']/g;

// Set of unprefixed Node built-in module names (e.g. "fs", "path", "crypto").
// Kept as a Set for O(1) lookup. We also accept any specifier that starts with
// "node:" or "bun:" regardless of whether it appears in this list.
const BUILTIN_MODULE_SET = new Set(builtinModules);

/**
 * Detect bare npm import specifiers in a string of TypeScript source.
 *
 * A specifier is "bare" when it is NOT:
 *   - a relative path (starts with "./" or "../")
 *   - an @lib/ alias (starts with "@lib/")
 *   - a Node builtin (unprefixed name in builtinModules, or "node:"-prefixed)
 *   - a bun: protocol import ("bun:"-prefixed)
 *
 * Comment lines (starting with `//`, `/*`, or `*`) are skipped.
 * For sub-path specifiers like "picomatch/lib/x", the root segment ("picomatch")
 * is tested against the builtin set, so bare packages with sub-paths are caught.
 *
 * Used by findBareNpmImports (file-based) and rewriteLibImports (post-condition guard).
 */
export function detectBareImports(content: string): string[] {
  const re = new RegExp(IMPORT_SPECIFIER_RE.source, "g");
  const offenders: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trimStart();
    // Skip single-line comments and block-comment / JSDoc lines.
    // "/*" covers block-open and single-line /* ... */ shapes.
    // "*" covers JSDoc continuation lines (" * ...") and block-close " */".
    // lazy: comment-line skip only; string-literal import shapes not handled — add tokenization if a real case appears
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      const specifier = match[1];

      // Relative imports are fine
      if (specifier.startsWith("./") || specifier.startsWith("../")) continue;

      // @lib/ aliases (vendored or internal) are fine
      if (specifier.startsWith("@lib/")) continue;

      // node: and bun: protocol imports are fine
      if (specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;

      // Check the root segment against the builtin list (handles sub-paths like "fs/promises")
      const rootSegment = specifier.split("/")[0];
      if (BUILTIN_MODULE_SET.has(rootSegment)) continue;

      // Everything else is a bare npm import
      offenders.push(specifier);
    }
  }

  return offenders;
}

/**
 * Find bare npm import specifiers in a single .ts file.
 *
 * Returns:
 *   - Empty array for *.test.ts files (never deployed)
 *   - Empty array if the file cannot be read
 *   - The raw specifier strings that are bare npm imports
 *
 * See detectBareImports for the classification rules.
 */
export async function findBareNpmImports(filePath: string): Promise<string[]> {
  if (filePath.endsWith(".test.ts")) return [];

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  return detectBareImports(content);
}

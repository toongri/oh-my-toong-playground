import fs from "fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import { detectBareImports } from "../adapters/ts-lib-deps.ts";
import type { DeployMutationHooks } from "./deploy-transaction.ts";

/** Python cache patterns that are always excluded, regardless of any caller-supplied list. */
export const PY_CACHE_EXCLUDE = ["__pycache__", ".pytest_cache", "*.pyc"];

/**
 * Names never deployed, regardless of any caller-supplied exclude list.
 * Note: __fixtures__ is also pruned from collectFiles' default walk, so a .ts file
 * under __fixtures__ would be skipped by the bare-import scan (lib-imports.ts).
 */
export const ALWAYS_PRUNE = [...PY_CACHE_EXCLUDE, "__fixtures__"];
export const DEFAULT_EXCLUDE = [...ALWAYS_PRUNE, "*.test.ts"];

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

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
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") {
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
 * @throws                If any bundled package's bare import survives rewrite (post-condition invariant)
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

	let result = content.replace(/'@lib\//g, `'${prefix}lib/`).replace(/"@lib\//g, `"${prefix}lib/`);

	for (const pkg of bundledPackages) {
		// Anchor the rewrite to real ESM module-specifier positions only. Each
		// alternative below ends with the FULL quoted specifier (`'pkg'`) so a
		// sub-path (`'pkg/lib/x'`) or look-alike (`'pkg-extra'`) never matches.
		//
		// The static forms are anchored to the START of a line (the `m` flag makes
		// `^` match per-line): a `from`/`import` keyword that does NOT begin the
		// statement — because it sits inside a `//` comment, a `*` JSDoc line, or a
		// string literal — is never matched.
		//   ^import|export … from 'pkg'   static import / re-export
		//   ^import 'pkg'                  bare side-effect import
		//   import('pkg')                  dynamic import (guarded against literals)
		// Discovery (findBareNpmImports) is ESM-only and never detects `require()`,
		// so the rewrite must not act on `require()` either — the two sides agree.
		//
		// Package names may contain regex-special characters (`.`, `-`, `@`, `/`),
		// so escape them before embedding in the pattern.
		const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const q = `(['"])${escaped}`; // group: opening quote; specifier follows
		const specifierPattern = new RegExp(
			[
				// static import/export with a `from` clause
				`(^[ \\t]*(?:import|export)\\b[^'"\\n]*?\\bfrom[ \\t]*)${q}\\2`,
				// bare side-effect import (statement-leading, space before the quote)
				`(^[ \\t]*import[ \\t]+)${q}\\4`,
				// dynamic import — preceded by a non-identifier, non-quote boundary so a
				// `"import('pkg')"` fragment inside a string literal is not matched
				`((?:^|[^.\\w'"\`])import[ \\t]*\\([ \\t]*)${q}\\6`,
			].join("|"),
			"gm",
		);
		result = result.replace(specifierPattern, (match, p1, q1, p2, q2, p3, q3) => {
			// Three alternatives, each a [prefix, quote] pair; exactly one fires.
			const prefixCtx = p1 ?? p2 ?? p3;
			const quote = q1 ?? q2 ?? q3;
			if (prefixCtx === undefined || quote === undefined) return match;
			return `${prefixCtx}${quote}${prefix}lib/vendor/${pkg}.js${quote}`;
		});
	}

	// Post-condition guard: detectBareImports uses broader matching than the rewrite regex
	// (no line-start anchor), so it catches `} from "pkg"` lines that start with `}` — the
	// multi-line import case the rewrite misses. Filter by bundledPackages, then confirm each
	// surviving specifier appears in a real import position (not inside a string literal) using
	// a regex that requires no unescaped string-delimiter before the from/import keyword on
	// the line. This avoids false-positives for patterns like `"rewrote from 'pkg'"`.
	const candidates = detectBareImports(result).filter((s) => bundledPackages.has(s));
	if (candidates.length > 0) {
		// For each candidate, verify it appears outside a string literal on at least one line.
		// The pattern `^[^"'`]*` anchors at line-start and requires no opening quote before
		// the from/import keyword — string-embedded occurrences are excluded by this anchor.
		const stillBare = candidates.filter((pkg) => {
			const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// Matches: non-string-start of line, then from/import keyword, then the quoted pkg name.
			const outsideString = new RegExp(`^[^"'\`]*(?:from|import)\\s*[\\s(]['"]${escaped}['"]`, "m");
			return outsideString.test(result);
		});
		if (stillBare.length > 0) {
			throw new Error(
				`rewriteLibImports: bundled package(s) [${stillBare.join(", ")}] still have bare imports after rewrite in ${targetFile} — multi-line import not supported by the rewrite regex`,
			);
		}
	}

	return result;
}

/**
 * Copies a single file from source to target, preserving execute permissions.
 */
export async function copyFile(source: string, target: string): Promise<void> {
	await fs.mkdir(path.dirname(target), { recursive: true });
	const stat = await fs.stat(source);
	const tempTarget = path.join(
		path.dirname(target),
		`.${path.basename(target)}.${randomUUID()}.tmp`,
	);
	let renamed = false;
	try {
		await fs.copyFile(source, tempTarget, fs.constants.COPYFILE_FICLONE);
		if (stat.mode & 0o111) {
			const tempStat = await fs.stat(tempTarget);
			await fs.chmod(tempTarget, tempStat.mode | 0o111);
		}
		await fs.rename(tempTarget, target);
		renamed = true;
	} finally {
		if (!renamed) {
			try {
				await fs.rm(tempTarget, { force: true });
			} catch {
				// Preserve the original copy/chmod/rename error if cleanup also fails.
			}
		}
	}
}

type SyncDirectoryOptions = {
	exclude?: string[];
	platformRoot?: string;
	mutationHooks?: DeployMutationHooks;
};

type SyncDirectoryPlan = {
	includedSourceFiles: string[];
	orphanTargetFiles: string[];
};

function effectiveExclude(options?: SyncDirectoryOptions): string[] {
	return [...ALWAYS_PRUNE, ...(options?.exclude ?? ["*.test.ts"])];
}

async function collectTargetFiles(target: string): Promise<string[]> {
	try {
		return await collectFiles(target, "", []);
	} catch (error: unknown) {
		if (isErrnoException(error) && error.code === "ENOENT") return [];
		throw error;
	}
}

async function buildSyncDirectoryPlan(
	source: string,
	target: string,
	options?: SyncDirectoryOptions,
): Promise<SyncDirectoryPlan> {
	const exclude = effectiveExclude(options);
	const sourceFiles = await collectFiles(source, "", exclude);
	const includedSourceFiles = sourceFiles
		.filter((relPath) => !isExcluded(path.basename(relPath), exclude))
		.sort();
	const includedSourceSet = new Set(includedSourceFiles);
	const orphanTargetFiles = (await collectTargetFiles(target))
		.filter((relPath) => !includedSourceSet.has(relPath) && !isExcluded(path.basename(relPath), exclude))
		.sort();
	return { includedSourceFiles, orphanTargetFiles };
}

/**
 * Plans the exact file leaves that syncDirectory may mutate.
 * The result is deterministic absolute target paths, and excludes
 * target-only files protected by the same exclude rules as the executor.
 */
export async function planSyncDirectoryMutations(
	source: string,
	target: string,
	options?: Pick<SyncDirectoryOptions, "exclude">,
): Promise<string[]> {
	const plan = await buildSyncDirectoryPlan(source, target, options);
	return [...new Set(
		[...plan.includedSourceFiles, ...plan.orphanTargetFiles].map((relPath) => path.normalize(path.join(target, relPath))),
	)];
}

async function rewriteFileAtomically(source: string, target: string, platformRoot: string): Promise<void> {
	await fs.mkdir(path.dirname(target), { recursive: true });
	const [srcContent, sourceStat] = await Promise.all([
		fs.readFile(source, "utf8"),
		fs.stat(source),
	]);
	const rewritten = rewriteLibImports(srcContent, target, platformRoot, new Set<string>());
	const tempTarget = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
	let renamed = false;
	try {
		await fs.writeFile(tempTarget, rewritten, "utf8");
		await fs.chmod(tempTarget, sourceStat.mode & 0o7777);
		await fs.rename(tempTarget, target);
		renamed = true;
	} finally {
		if (!renamed) await fs.rm(tempTarget, { force: true }).catch(() => undefined);
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
 * @param options.mutationHooks When provided, wraps each file-leaf copy/rewrite/unlink
 *                              in the caller's exact mutation journal.
 */
export async function syncDirectory(
	source: string,
	target: string,
	options?: SyncDirectoryOptions,
): Promise<void> {
	// ALWAYS_PRUNE is always prepended so callers that supply a custom list
	// (e.g. { exclude: ["*.test.ts"] }) do not accidentally lose Python cache pruning
	// or __fixtures__ pruning.
	const platformRoot = options?.platformRoot;

	// 1. Ensure target directory exists
	await fs.mkdir(target, { recursive: true });

	// 2. Collect source files (excluded dir names are pruned during the walk)
	const plan = await buildSyncDirectoryPlan(source, target, options);
	const { includedSourceFiles } = plan;

	const orphanSet = new Set(plan.orphanTargetFiles);
	const mutationOrder = [...new Set([...includedSourceFiles, ...plan.orphanTargetFiles])];

	// 4. Copy included files and delete orphans in the planner's deterministic order.
	//    If platformRoot is set, rewrite @lib/ aliases in .ts files at write time
	//    so that no deployed file ever exists on disk with raw @lib/ specifiers.
	for (const relPath of mutationOrder) {
		const targetPath = path.join(target, relPath);
		const operation = orphanSet.has(relPath)
			? async () => { await fs.unlink(targetPath); }
			: platformRoot && targetPath.endsWith(".ts") && !targetPath.endsWith(".test.ts")
				? () => rewriteFileAtomically(path.join(source, relPath), targetPath, platformRoot)
				: () => copyFile(path.join(source, relPath), targetPath);
		if (options?.mutationHooks) await options.mutationHooks.mutate(targetPath, operation);
		else await operation();
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
		} catch (error: unknown) {
			if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) continue;
			throw error;
		}
	}
}

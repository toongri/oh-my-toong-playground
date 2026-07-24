import { homedir } from "node:os";
import { join, resolve } from "node:path";

import picomatch from "picomatch";

import {
	BUNDLED_RULE_SUBDIR,
	GLOBAL_DISTANCE,
	PROJECT_RULE_SUBDIRS,
	PROJECT_SINGLE_FILES,
	USER_HOME_RULE_SUBDIRS,
	USER_HOME_SINGLE_FILES,
} from "./constants.js";
import {
	type RuleDiscoveryCache,
	scanRuleFilesCached,
	singleFileInfoCached,
} from "./finder-cache.js";
import { isCandidateWithinProjectCached, toPosixPath } from "./engine-paths.js";
import { getWalkDirectories, toRelativePath } from "./finder-paths.js";
import {
	toProjectRuleSource,
	toProjectSingleFileSource,
	toUserHomeRuleSource,
	toUserHomeSingleFileSource,
} from "./finder-sources.js";
import { resolvePluginRulesRoot } from "./plugin-root.js";
import type { RuleCandidate } from "./types.js";

export type { RuleDiscoveryCache } from "./finder-cache.js";
export { createRuleDiscoveryCache } from "./finder-cache.js";

export interface FinderOptions {
	/** Project root absolute path (use findProjectRoot to get this). */
	projectRoot: string | null;
	/** Target file path (used for distance calculation in dynamic injection mode). null for static mode. */
	targetFile: string | null;
	/** Current working directory. Used in static mode (targetFile: null) to walk nested-package rule dirs up to projectRoot. */
	cwd?: string;
	/** User home directory (default: os.homedir()). Injectable for tests. */
	homeDir?: string;
	/** Set of disabled sources to omit from discovery. Empty by default. */
	disabledSources?: ReadonlySet<string>;
	/** Whether to skip user-home rules. Default: false. */
	skipUserHome?: boolean;
	/** Plugin root directory. Defaults to PLUGIN_ROOT env or this package root. */
	pluginRoot?: string;
	platform?: NodeJS.Platform;
	cache?: RuleDiscoveryCache;
	/** Glob patterns; a candidate whose `path` or `realPath` matches any is dropped. */
	excludeGlobs?: string[];
}

interface PluginBundledFinderOptions {
	readonly disabledSources?: ReadonlySet<string>;
	readonly cache?: RuleDiscoveryCache;
	readonly pluginRoot?: string;
	readonly platform?: NodeJS.Platform;
}

const WINDOWS_GIT_BASH_BUNDLED_RULE_PATH = "bundled-rules/windows-git-bash.md";

export function findRuleCandidates(options: FinderOptions): RuleCandidate[] {
	const skipUserHome = options.skipUserHome ?? false;
	const disabledSources = options.disabledSources ?? new Set<string>();
	const candidates: RuleCandidate[] = [];
	const homeDirectory = resolve(options.homeDir ?? homedir());

	if (options.projectRoot !== null) {
		candidates.push(
			...findProjectCandidates(
				options.projectRoot,
				options.targetFile,
				disabledSources,
				options.cache,
				options.cwd,
				options.excludeGlobs,
			),
		);
	}

	const pluginBundledOptions: PluginBundledFinderOptions = {
		disabledSources,
		...(options.cache === undefined ? {} : { cache: options.cache }),
		...(options.pluginRoot === undefined ? {} : { pluginRoot: options.pluginRoot }),
		...(options.platform === undefined ? {} : { platform: options.platform }),
	};
	candidates.push(...findPluginBundledCandidates(pluginBundledOptions));

	if (!skipUserHome) {
		candidates.push(
			...findUserHomeCandidates(homeDirectory, disabledSources, options.cache, options.excludeGlobs),
		);
	}

	return filterExcludedCandidates(candidates, options.excludeGlobs);
}

export function filterExcludedCandidates(
	candidates: RuleCandidate[],
	excludeGlobs: string[] | undefined,
): RuleCandidate[] {
	if (excludeGlobs === undefined || excludeGlobs.length === 0) {
		return candidates;
	}

	// Normalize globs and candidate paths to POSIX before matching: on win32 the
	// paths carry backslashes (node:path / realpathSync.native) but globs stay
	// slash-based, so raw picomatch would never match. Mirrors matcher.ts.
	const matchers = excludeGlobs.map((glob) => picomatch(toPosixPath(glob), { bash: true, dot: true }));
	return candidates.filter(
		(candidate) =>
			!matchers.some(
				(isMatch) => isMatch(toPosixPath(candidate.path)) || isMatch(toPosixPath(candidate.realPath)),
			),
	);
}

export function findPluginBundledCandidates(
	options: PluginBundledFinderOptions = {},
): RuleCandidate[] {
	if (options.disabledSources?.has("plugin-bundled") === true) {
		return [];
	}

	const pluginRoot = resolvePluginRulesRoot(options.pluginRoot);
	const ruleDirectory = join(pluginRoot, BUNDLED_RULE_SUBDIR);
	const platform = options.platform ?? process.platform;
	const candidates: RuleCandidate[] = [];
	for (const scannedFile of scanRuleFilesCached(ruleDirectory, options.cache)) {
		const candidate: RuleCandidate = {
			path: scannedFile.path,
			realPath: scannedFile.realPath,
			source: "plugin-bundled",
			distance: GLOBAL_DISTANCE,
			isGlobal: true,
			isSingleFile: false,
			relativePath: toRelativePath(pluginRoot, scannedFile.path),
		};
		if (isPluginBundledCandidateEnabled(candidate, platform)) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function isPluginBundledCandidateEnabled(
	candidate: RuleCandidate,
	platform: NodeJS.Platform,
): boolean {
	return candidate.relativePath !== WINDOWS_GIT_BASH_BUNDLED_RULE_PATH || platform === "win32";
}

/**
 * A candidate's path within its rules directory (e.g. "foo/bar.md" for both
 * ".claude/rules/foo/bar.md" and ".codex/rules/foo/bar.md"), used to PAIR a
 * `.claude/rules` file with its `.codex/rules` counterpart by stem rather
 * than by scope alone. Read directly from `ruleDirRelativePath`, which each
 * rule-subdirectory candidate carries from creation time (computed relative
 * to the exact rules directory it was scanned from) — NOT re-derived from
 * `relativePath`, which is projectRoot- or homeDir-relative and therefore
 * still carries the walk-directory prefix for a nested package (e.g.
 * "packages/app/.claude/rules/foo.md"), where a `${source}/` prefix strip
 * would never match.
 */
function ruleStem(candidate: RuleCandidate): string {
	return candidate.ruleDirRelativePath ?? candidate.relativePath;
}

/**
 * Drops a `.claude/rules` (project scope) / `~/.claude/rules` (home scope)
 * candidate from `candidates` only when a `.codex/rules` / `~/.codex/rules`
 * candidate with the SAME stem (path within the rules dir) is ALSO present
 * in that same list — the de-Claude-ified counterpart supersedes the raw
 * Claude source file-for-file so unrewritten Claude vocabulary
 * (AskUserQuestion, TaskOutput, ...) is never injected into a Codex session.
 * A `.claude/rules` file with NO codex counterpart is kept — losing a
 * hand-written project rule that happens to sit next to OMT-deployed rules
 * would be worse than the vocabulary leak this closes. Callers pass one
 * scope's list at a time (a project walkDirectory, or the home-dir list) so
 * a project-scope codex replacement can never suppress a home-scope claude
 * source, and vice versa.
 */
function supersedeClaudeRulesWithCodex(candidates: RuleCandidate[]): RuleCandidate[] {
	const codexStems = new Set(
		candidates
			.filter((candidate) => candidate.source === ".codex/rules" || candidate.source === "~/.codex/rules")
			.map(ruleStem),
	);
	if (codexStems.size === 0) {
		return candidates;
	}
	return candidates.filter((candidate) => {
		const isClaudeRules = candidate.source === ".claude/rules" || candidate.source === "~/.claude/rules";
		return !isClaudeRules || !codexStems.has(ruleStem(candidate));
	});
}

function findProjectCandidates(
	projectRoot: string,
	targetFile: string | null,
	disabledSources: ReadonlySet<string>,
	cache: RuleDiscoveryCache | undefined,
	cwd?: string,
	excludeGlobs?: string[],
): RuleCandidate[] {
	const rootDirectory = resolve(projectRoot);
	const walkDirectories = getWalkDirectories(rootDirectory, targetFile, cwd);
	const candidates: RuleCandidate[] = [];

	for (const walkDirectory of walkDirectories) {
		const ruleSubdirCandidates: RuleCandidate[] = [];
		for (const [parentDirectory, subDirectory] of PROJECT_RULE_SUBDIRS) {
			const source = toProjectRuleSource(parentDirectory, subDirectory);
			if (disabledSources.has(source)) {
				continue;
			}

			const ruleDirectory = join(walkDirectory.directory, parentDirectory, subDirectory);
			for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
				ruleSubdirCandidates.push({
					path: scannedFile.path,
					realPath: scannedFile.realPath,
					source,
					distance: walkDirectory.distance,
					isGlobal: false,
					isSingleFile: false,
					relativePath: toRelativePath(rootDirectory, scannedFile.path),
					ruleDirRelativePath: toRelativePath(ruleDirectory, scannedFile.path),
				});
			}
		}
		// exclude-glob and project-boundary filters MUST run before supersede consumes
		// the list (see supersedeClaudeRulesWithCodex's doc comment for the predicate
		// itself, unchanged here): an excluded or out-of-boundary `.codex/rules` file
		// must never count as a "counterpart present" that suppresses its live
		// `.claude/rules` sibling — it is not going to survive to be adopted itself.
		const eligibleCandidates = filterExcludedCandidates(ruleSubdirCandidates, excludeGlobs).filter(
			(candidate) => isCandidateWithinProjectCached(candidate, rootDirectory, undefined),
		);
		candidates.push(...supersedeClaudeRulesWithCodex(eligibleCandidates));
	}

	for (const walkDirectory of walkDirectories) {
		for (const ruleFile of PROJECT_SINGLE_FILES) {
			const source = toProjectSingleFileSource(ruleFile);
			if (disabledSources.has(source)) {
				continue;
			}

			const filePath = join(walkDirectory.directory, ruleFile);
			const fileInfo = singleFileInfoCached(filePath, cache);
			if (fileInfo === null) {
				continue;
			}

			candidates.push({
				path: fileInfo.path,
				realPath: fileInfo.realPath,
				source,
				distance: walkDirectory.distance,
				isGlobal: false,
				isSingleFile: true,
				relativePath: toRelativePath(rootDirectory, filePath),
			});
		}
	}

	return candidates;
}

function findUserHomeCandidates(
	homeDirectory: string,
	disabledSources: ReadonlySet<string>,
	cache: RuleDiscoveryCache | undefined,
	excludeGlobs?: string[],
): RuleCandidate[] {
	const ruleSubdirCandidates: RuleCandidate[] = [];

	for (const ruleSubdir of USER_HOME_RULE_SUBDIRS) {
		const source = toUserHomeRuleSource(ruleSubdir);
		if (disabledSources.has(source)) {
			continue;
		}

		const ruleDirectory = join(homeDirectory, ruleSubdir);
		for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
			ruleSubdirCandidates.push({
				path: scannedFile.path,
				realPath: scannedFile.realPath,
				source,
				distance: GLOBAL_DISTANCE,
				isGlobal: true,
				isSingleFile: false,
				relativePath: toRelativePath(homeDirectory, scannedFile.path),
				ruleDirRelativePath: toRelativePath(ruleDirectory, scannedFile.path),
			});
		}
	}

	// Exclude-glob filter before supersede — same reasoning as findProjectCandidates.
	// No project-boundary filter here: every home-scope candidate is isGlobal, which
	// isCandidateWithinProjectCached always accepts, so applying it would be a no-op.
	const eligibleCandidates = filterExcludedCandidates(ruleSubdirCandidates, excludeGlobs);
	const candidates: RuleCandidate[] = supersedeClaudeRulesWithCodex(eligibleCandidates);

	for (const ruleFile of USER_HOME_SINGLE_FILES) {
		const source = toUserHomeSingleFileSource(ruleFile);
		if (disabledSources.has(source)) {
			continue;
		}

		const filePath = join(homeDirectory, ruleFile);
		const fileInfo = singleFileInfoCached(filePath, cache);
		if (fileInfo === null) {
			continue;
		}

		candidates.push({
			path: fileInfo.path,
			realPath: fileInfo.realPath,
			source,
			distance: GLOBAL_DISTANCE,
			isGlobal: true,
			isSingleFile: true,
			relativePath: toRelativePath(homeDirectory, filePath),
		});
	}

	return candidates;
}

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
import { toPosixPath } from "./engine-paths.js";
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
		candidates.push(...findUserHomeCandidates(homeDirectory, disabledSources, options.cache));
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

function findProjectCandidates(
	projectRoot: string,
	targetFile: string | null,
	disabledSources: ReadonlySet<string>,
	cache: RuleDiscoveryCache | undefined,
	cwd?: string,
): RuleCandidate[] {
	const rootDirectory = resolve(projectRoot);
	const walkDirectories = getWalkDirectories(rootDirectory, targetFile, cwd);
	const candidates: RuleCandidate[] = [];

	for (const walkDirectory of walkDirectories) {
		for (const [parentDirectory, subDirectory] of PROJECT_RULE_SUBDIRS) {
			const source = toProjectRuleSource(parentDirectory, subDirectory);
			if (disabledSources.has(source)) {
				continue;
			}

			const ruleDirectory = join(walkDirectory.directory, parentDirectory, subDirectory);
			for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
				candidates.push({
					path: scannedFile.path,
					realPath: scannedFile.realPath,
					source,
					distance: walkDirectory.distance,
					isGlobal: false,
					isSingleFile: false,
					relativePath: toRelativePath(rootDirectory, scannedFile.path),
				});
			}
		}
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
): RuleCandidate[] {
	const candidates: RuleCandidate[] = [];

	for (const ruleSubdir of USER_HOME_RULE_SUBDIRS) {
		const source = toUserHomeRuleSource(ruleSubdir);
		if (disabledSources.has(source)) {
			continue;
		}

		const ruleDirectory = join(homeDirectory, ruleSubdir);
		for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
			candidates.push({
				path: scannedFile.path,
				realPath: scannedFile.realPath,
				source,
				distance: GLOBAL_DISTANCE,
				isGlobal: true,
				isSingleFile: false,
				relativePath: toRelativePath(homeDirectory, scannedFile.path),
			});
		}
	}

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

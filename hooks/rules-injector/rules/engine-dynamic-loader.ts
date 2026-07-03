import { findSortedCandidatesCached, matchDynamicRuleCached } from "./engine-dynamic-cache.js";
import { loadCandidate, ruleDedupKey } from "./engine-loader.js";
import { isSameOrChildPath } from "./engine-paths.js";
import type {
	CandidateDiscoveryCache,
	DynamicMatchCache,
	EngineDeps,
	LoadedRuleContent,
} from "./engine-types.js";
import { createRuleDiscoveryCache } from "./finder.js";
import { matchRule } from "./matcher.js";
import { sortCandidates } from "./ordering.js";
import { disabledSourcesFromConfig } from "./sources.js";
import type { LoadedRule, PiRulesConfig, RuleDiagnostic } from "./types.js";

/**
 * A dynamically-loaded rule annotated with the absolute target path that caused it
 * to match. Multi-target tool calls (e.g. `cat README.md src/x.ts`) load rules
 * across several targets; the injection header must attribute each rule to the
 * target it actually matched rather than blindly naming targetPaths[0]. The field
 * is additive — every consumer that only reads LoadedRule keeps working.
 */
export type DynamicLoadedRule = LoadedRule & { matchedTarget: string };

export function loadDynamicCandidates(
	config: PiRulesConfig,
	deps: EngineDeps,
	cwd: string,
	targetPaths: ReadonlyArray<string>,
	dynamicMatchCache: DynamicMatchCache,
): { rules: DynamicLoadedRule[]; diagnostics: RuleDiagnostic[] } {
	const rules: DynamicLoadedRule[] = [];
	const diagnostics: RuleDiagnostic[] = [];
	const seenRules = new Set<string>();
	const loadedRuleContent = new Map<string, LoadedRuleContent | null>();
	const projectMembership = new Map<string, boolean>();
	const disabledSources = disabledSourcesFromConfig(config);
	const discoveryCache = createRuleDiscoveryCache();
	const candidateDiscoveryCache: CandidateDiscoveryCache = new Map();
	const cwdProjectRoot = deps.findProjectRoot(cwd);

	for (const targetFile of uniqueStrings(targetPaths)) {
		const projectRoot =
			cwdProjectRoot !== null && isSameOrChildPath(targetFile, cwdProjectRoot)
				? cwdProjectRoot
				: deps.findProjectRoot(targetFile);
		const findOptions: Parameters<EngineDeps["findCandidates"]>[0] = {
			projectRoot,
			targetFile,
			cache: discoveryCache,
		};
		if (disabledSources !== undefined) {
			findOptions.disabledSources = disabledSources;
		}
		const candidates = findSortedCandidatesCached(
			candidateDiscoveryCache,
			deps.findCandidates,
			findOptions,
		);

		for (const candidate of candidates) {
			const loadedRule = loadCandidate(
				candidate,
				deps,
				diagnostics,
				projectRoot,
				loadedRuleContent,
				projectMembership,
			);
			if (loadedRule === null) {
				continue;
			}

			const matchReason = matchDynamicRuleCached(
				dynamicMatchCache,
				projectRoot,
				targetFile,
				candidate,
				loadedRule,
				deps.matchRule ?? matchRule,
			);

			if (matchReason === null) {
				continue;
			}

			const dedupKey = ruleDedupKey(loadedRule);
			if (seenRules.has(dedupKey)) {
				continue;
			}

			seenRules.add(dedupKey);
			rules.push({ ...loadedRule, matchReason, matchedTarget: targetFile });
		}
	}

	return { rules: sortCandidates(rules), diagnostics };
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
	const uniqueValues: string[] = [];
	const seenValues = new Set<string>();
	for (const value of values) {
		if (seenValues.has(value)) {
			continue;
		}

		seenValues.add(value);
		uniqueValues.push(value);
	}
	return uniqueValues;
}

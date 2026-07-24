import { existsSync, readFileSync } from "node:fs";

import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { withPromptBudget } from "./event-budget.js";
import { formatAdditionalContextOutput, limitAdditionalContextText } from "./hook-output.js";
import {
	completePostCompactRecovery,
	hydrateEngineState,
	persistEngineState,
} from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import type { PostCompactReadDirective } from "./post-compact-directive.js";
import { buildPostCompactReadDirective } from "./post-compact-directive.js";
import type { Engine } from "./rules/index.js";
import {
	formatStaticBlock,
	isNeverTruncatedRule,
	parseRule,
	ruleMarkerLine,
	transcriptHasRuleMarker,
} from "./rules/index.js";
import type { LoadedRule, PiRulesConfig } from "./rules/index.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import {
	filterRulesAlreadyInTranscript,
	filterRulesNotInTranscriptText,
} from "./transcript-rule-filter.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";
import { readTranscriptSearchText } from "./transcript-search.js";

export function runStaticInjection(
	cwd: string,
	transcriptPath: string | null,
	eventName: "SessionStart" | "UserPromptSubmit" | "PostToolUse",
	cachePath: string,
	options: CodexRulesHookOptions,
	completedPostCompactChannel?: "static",
	transcriptSearchOptions: TranscriptSearchOptions = {},
	model?: string,
): string {
	const config = configFromEnvironment(options.env);
	if (config.disabled) {
		if (completedPostCompactChannel !== undefined) {
			completePostCompactRecovery(cachePath, completedPostCompactChannel);
		}
		return "";
	}

	if (completedPostCompactChannel !== undefined) {
		return runPostCompactRecovery({
			cwd,
			transcriptPath,
			eventName,
			cachePath,
			options,
			channel: completedPostCompactChannel,
			model: model ?? "",
			config,
		});
	}

	const effectiveConfig = eventName === "UserPromptSubmit" ? withPromptBudget(config) : config;
	const engine = createRulesEngine(options, effectiveConfig);
	hydrateEngineState(engine, cachePath);
	engine.state.cwd = cwd;

	const loaded = engine.loadStaticRules(cwd);
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptPath,
		(rule) => {
			engine.markStaticInjected(rule);
		},
		transcriptSearchOptions,
	);
	if (rules.length === 0) {
		persistEngineState(engine, cachePath);
		return "";
	}

	const { text: block, emittedRules } = formatStaticBlock(rules, {
		maxRuleChars: effectiveConfig.maxRuleChars,
		maxResultChars: effectiveConfig.maxResultChars,
	});
	// Mark only rules whose marker survives the 32K byte clamp.
	// The formatter char-budget (up to 40000 chars) can admit rules that the downstream
	// byte clamp then cuts. A rule whose marker is past the 32K cut must stay pending so
	// a later turn re-injects it. Compute the limited context first, then filter.
	const combinedContext = combineStaticContext(block);
	const limitedContext = limitAdditionalContextText(
		combinedContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
	);
	for (const rule of emittedRules) {
		if (limitedContext.includes(ruleMarkerLine(rule.path))) {
			engine.markStaticInjected(rule);
		}
	}
	persistEngineState(engine, cachePath);
	return formatAdditionalContextOutput(eventName, combinedContext);
}

interface PostCompactRecoveryInput {
	cwd: string;
	transcriptPath: string | null;
	eventName: "SessionStart" | "UserPromptSubmit" | "PostToolUse";
	cachePath: string;
	options: CodexRulesHookOptions;
	channel: "static";
	model: string;
	config: PiRulesConfig;
}

function runPostCompactRecovery(input: PostCompactRecoveryInput): string {
	const effectiveConfig = withPostCompactBudget(input.config, {
		model: input.model,
		transcriptPath: input.transcriptPath,
	});
	const engine = createRulesEngine(input.options, effectiveConfig);
	hydrateEngineState(engine, input.cachePath);
	engine.state.cwd = input.cwd;

	const loaded = engine.loadStaticRules(input.cwd);
	const transcriptText = readRecoveryTranscriptText(input.transcriptPath);
	// Recovery must let the TRANSCRIPT decide presence, not the session staticDedup.
	// In the arrival-order inversion (SessionStart source=compact arriving before the
	// matching PostCompact) the staticDedup wipe has not run yet, so a session-dedup
	// pre-filter here would drop the very rules compaction is about to evict. Pass the
	// loaded rules straight to the transcript check; on the PostCompact-first path the
	// dedup is already wiped, so dropping the pre-filter is a no-op there.
	const missingRules = filterRulesNotInTranscriptText(loaded.rules, transcriptText, (rule) => {
		engine.markStaticInjected(rule);
	});
	const dynamicRulePaths = recoverDynamicRulePaths(engine, transcriptText, loaded.rules);

	if (missingRules.length === 0 && dynamicRulePaths.length === 0) {
		persistEngineState(engine, input.cachePath, input.channel);
		return "";
	}

	const fullBodyRules = missingRules.filter((rule) => isNeverTruncatedRule(ruleDisplayPath(rule)));
	const listedRules = missingRules.filter((rule) => !isNeverTruncatedRule(ruleDisplayPath(rule)));
	// Use formatStaticBlock directly (not engine.formatStatic) to get emittedRules —
	// the formatter may budget-drop some fullBodyRules too; only emitted ones are marked.
	const { text: bodyBlock, emittedRules: bodyEmittedRules } =
		fullBodyRules.length === 0
			? { text: "", emittedRules: [] }
			: formatStaticBlock(fullBodyRules, {
					maxRuleChars: effectiveConfig.maxRuleChars,
					maxResultChars: effectiveConfig.maxResultChars,
				});
	const remainingForDirective = Math.max(0, effectiveConfig.maxResultChars - bodyBlock.length);
	const { text: directive, emittedPaths }: PostCompactReadDirective = buildPostCompactReadDirective(
		[...listedRules.map((rule) => rule.path), ...dynamicRulePaths],
		remainingForDirective,
	);
	// Mark only rules actually delivered this turn. A listed rule whose path was dropped by
	// the directive budget stays pending so a later, wider-budget turn can re-offer it.
	// Marking a dropped rule here would let !isStaticInjected suppress it forever.
	const emittedPathSet = new Set(emittedPaths);
	for (const rule of bodyEmittedRules) {
		engine.markStaticInjected(rule);
	}
	for (const rule of listedRules) {
		if (emittedPathSet.has(rule.path)) {
			engine.markStaticInjected(rule);
		}
	}
	persistEngineState(engine, input.cachePath, input.channel);
	return formatAdditionalContextOutput(input.eventName, combineStaticContext(bodyBlock, directive));
}

function readRecoveryTranscriptText(transcriptPath: string | null): string | null {
	if (transcriptPath === null) {
		return null;
	}
	return (
		readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ??
		readTranscriptSearchText(transcriptPath)
	);
}

/**
 * Returns true only when the rule's emitted body AND the rule's marker are present
 * in the transcript — meaning this rule was emitted end-to-end and is still in
 * context. Two gates:
 *
 * - Body gate: the needle is the PARSED body (frontmatter stripped), matching what
 *   is actually emitted. The raw file (frontmatter included) is never emitted, so a
 *   raw needle would never match and the rule would be re-injected on every recovery.
 *   A transcript that mentions the path but omits the body (e.g. a compacted summary)
 *   fails this gate → re-inject.
 * - Presence gate: transcriptHasRuleMarker checks whether the rule's name-based open
 *   tag (<rules name="...">) is in the transcript. There is NO hash/version
 *   granularity — an edited rule whose open tag is already present is treated as
 *   injected (see the lazy: note on ruleMarkerLine).
 *
 * Any read/parse failure is absorbed as `false` (re-inject) to honor the advisory
 * exit-0 contract.
 */
function isDynamicRuleBodyInTranscript(rulePath: string, transcriptText: string): boolean {
	try {
		const raw = readFileSync(rulePath, "utf8");
		const needle = parseRule(raw)
			.body.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.trim()
			.slice(0, 2_000);
		if (needle.length === 0 || !transcriptText.includes(needle)) {
			return false;
		}
		return transcriptHasRuleMarker(transcriptText, [rulePath]);
	} catch {
		return false;
	}
}

function recoverDynamicRulePaths(
	engine: Engine,
	transcriptText: string | null,
	staticRules: ReadonlyArray<LoadedRule>,
): string[] {
	const staticRulePaths = new Set(staticRules.map((rule) => rule.realPath));
	const recoveredPaths = new Set<string>();
	for (const dedupKeys of engine.state.dynamicDedup.values()) {
		for (const dedupKey of dedupKeys) {
			const separatorIndex = dedupKey.lastIndexOf("::");
			if (separatorIndex <= 0) {
				continue;
			}
			const rulePath = dedupKey.slice(0, separatorIndex);
			if (staticRulePaths.has(rulePath)) {
				continue;
			}
			if (!existsSync(rulePath)) {
				continue;
			}
			if (transcriptText !== null && isDynamicRuleBodyInTranscript(rulePath, transcriptText)) {
				continue;
			}
			recoveredPaths.add(rulePath);
		}
	}
	return [...recoveredPaths].sort();
}

function ruleDisplayPath(rule: LoadedRule): string {
	return rule.relativePath.length > 0 ? rule.relativePath : rule.path;
}

export function combineStaticContext(...blocks: readonly string[]): string {
	return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}

import { transcriptHasRuleVersion } from "./rules/index.js";
import type { LoadedRule } from "./rules/index.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";
import { readTranscriptSearchText } from "./transcript-search.js";

export function filterRulesAlreadyInTranscript(
	rules: ReadonlyArray<LoadedRule>,
	transcriptPath: string | null,
	markInjected: (rule: LoadedRule) => void,
	options: TranscriptSearchOptions = {},
): LoadedRule[] {
	if (rules.length === 0 || transcriptPath === null) {
		return [...rules];
	}

	const transcriptText = readTranscriptSearchText(transcriptPath, options);
	return filterRulesNotInTranscriptText(rules, transcriptText, markInjected);
}

export function filterRulesNotInTranscriptText(
	rules: ReadonlyArray<LoadedRule>,
	transcriptText: string | null,
	markInjected: (rule: LoadedRule) => void,
): LoadedRule[] {
	if (rules.length === 0 || transcriptText === null) {
		return [...rules];
	}

	const pendingRules: LoadedRule[] = [];
	for (const rule of rules) {
		if (isRuleAlreadyInTranscript(rule, transcriptText)) {
			markInjected(rule);
			continue;
		}

		pendingRules.push(rule);
	}
	return pendingRules;
}

function isRuleAlreadyInTranscript(rule: LoadedRule, transcriptText: string): boolean {
	const staticReferenceNeedles = [
		`- [${displayFilename(rule)}]{${rule.path}}`,
		`- [${displayFilename(rule)}]{${rule.realPath}}`,
	];
	if (staticReferenceNeedles.some((needle) => transcriptText.includes(needle))) {
		return true;
	}

	const bodyNeedle = rule.body.trim().slice(0, 2_000);
	if (bodyNeedle.length === 0 || !transcriptText.includes(bodyNeedle)) {
		return false;
	}

	// Anchor on the content version: an edited rule whose first 2000 chars are
	// unchanged must NOT be mistaken for the version already in the transcript.
	return transcriptHasRuleVersion(transcriptText, [rule.path, rule.realPath], rule.contentHash);
}

function displayFilename(rule: LoadedRule): string {
	const normalizedPath = rule.relativePath.length > 0 ? rule.relativePath : rule.path;
	const segments = normalizedPath
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0);
	return segments.at(-1) ?? normalizedPath;
}

import { isNeverTruncatedRule, truncateBudget, truncateRule } from "./truncator.js";
import type { LoadedRule } from "./types.js";

export interface FormatOptions {
	maxRuleChars: number;
	maxResultChars: number;
}

/**
 * Result shape returned by formatStaticBlock and formatDynamicBlock.
 *
 * - `text`: the fully-rendered injection string (may be "").
 * - `emittedRules`: the subset of input rules whose body was non-empty in the
 *   final output. A rule is included even when its body was truncated (partial
 *   body still appears). A rule whose body was entirely dropped by the budget
 *   — including rules for which only the header would have appeared — is NOT
 *   included. Callers must use this set (not the full input rules array) to
 *   mark which rules were actually injected; marking budget-dropped rules as
 *   injected causes permanent suppression on future turns.
 */
export interface FormatResult {
	text: string;
	emittedRules: LoadedRule[];
}

type TruncatedRule = {
	path: string;
	relativePath: string;
	body: string;
	contentHash: string;
};

type NormalizedRule = TruncatedRule & {
	source: LoadedRule["source"];
};

/**
 * The "Instructions from: <path> [hash:<contentHash>]" marker line emitted ahead
 * of each rule's body. The `[hash:...]` anchor pins the marker to the rule's
 * content version, so a transcript-presence check can tell an unchanged rule
 * (skip) from an edited one whose first 2000 chars happen to be identical
 * (re-inject). Producer (formatRule) and consumers (the transcript filters) MUST
 * build this line through ruleMarkerLine so the emitted and sought markers agree.
 */
export function ruleMarkerLine(path: string, contentHash: string): string {
	return `Instructions from: ${path} [hash:${contentHash}]`;
}

/** The bare, version-less marker prefix kept for legacy transcripts (pre-anchor emits). */
function legacyMarker(path: string): string {
	return `Instructions from: ${path}`;
}

/** The hash-anchor opening for a given path, used to detect that SOME version marker exists. */
function hashAnchorPrefix(path: string): string {
	return `Instructions from: ${path} [hash:`;
}

/**
 * Decide whether a transcript already carries THIS content version of a rule.
 *
 * Version semantics (the content-version anchor):
 * - If the transcript carries the exact `Instructions from: <path> [hash:<hash>]`
 *   marker for this version → present.
 * - If the transcript carries a hash-anchored marker for this path but for a
 *   DIFFERENT hash → a different version is in context → NOT present (re-inject).
 * - If the transcript carries only a legacy version-less `Instructions from: <path>`
 *   marker (no `[hash:...]` anchor at all) → fall back to present, since there is
 *   no version information to contradict it.
 *
 * `paths` lists the path spellings to try (e.g. path and realPath).
 */
export function transcriptHasRuleVersion(
	transcriptText: string,
	paths: ReadonlyArray<string>,
	contentHash: string,
): boolean {
	if (paths.some((path) => transcriptText.includes(ruleMarkerLine(path, contentHash)))) {
		return true;
	}
	if (paths.some((path) => transcriptText.includes(hashAnchorPrefix(path)))) {
		// A hash anchor exists for this path but not for this hash → different version.
		return false;
	}
	// Legacy marker check with end-boundary anchor: accept only when the marker is
	// followed by "\n" or is at end-of-string. This prevents "foo.md" matching inside
	// "foo.mdc" (next char "c") or "a.md" inside "a.md.bak" (next char ".").
	return paths.some((path) => {
		const marker = legacyMarker(path);
		let idx = transcriptText.indexOf(marker);
		while (idx !== -1) {
			const afterIdx = idx + marker.length;
			if (afterIdx === transcriptText.length || transcriptText[afterIdx] === "\n") {
				return true;
			}
			idx = transcriptText.indexOf(marker, afterIdx);
		}
		return false;
	});
}

/**
 * Byte length of the rule's emitted marker line + the "\n\n" separator that
 * precedes each rule's body. Charged to the budget before body bytes so a rule
 * with no remaining body budget is dropped (no header-only ghost block).
 *
 * Charges the FULL hash-anchored marker (the form formatRule actually emits via
 * ruleMarkerLine), so the budget accounting matches the emitted bytes. The hash
 * anchor is ~72 bytes per rule and is real output; charging the version-less
 * marker undercounts and lets blocks exceed maxResultChars.
 */
function ruleHeaderLength(path: string, contentHash: string): number {
	return `${ruleMarkerLine(path, contentHash)}\n\n`.length;
}

function formatRule(rule: TruncatedRule): string {
	const marker = ruleMarkerLine(rule.path, rule.contentHash);
	const body = normalizeRuleBody(rule.body);
	if (body.length === 0) {
		return marker;
	}
	return `${marker}\n\n${body}`;
}

/**
 * Truncate and budget the given rules, returning:
 * - the list of TruncatedRule entries whose body is non-empty after budgeting
 * - the original LoadedRule entries at those same positions (for emittedRules)
 *
 * Budget accounting includes per-rule header bytes so that a rule cannot
 * consume budget purely for its header while leaving no budget for body content.
 * Rules where the budget (after deducting the header) is insufficient to fit
 * any body bytes are dropped — they produce no output and are absent from
 * emittedRules.
 *
 * The strategy: charge each rule's header incrementally as it is admitted (not
 * pre-summed across all candidates), so earlier candidates' headers never starve
 * the first rule. The first rule is always attempted against the full
 * maxResultChars minus only its own header.
 */
function truncateRules(
	rules: ReadonlyArray<LoadedRule>,
	options: FormatOptions,
): { truncatedRules: TruncatedRule[]; emittedRules: LoadedRule[] } {
	const perRuleNormalized: NormalizedRule[] = rules.map((rule) => ({
		path: rule.path,
		relativePath: rule.relativePath,
		body: normalizeRuleBody(rule.body),
		source: rule.source,
		contentHash: rule.contentHash,
	}));
	const perRuleResultChars = Math.floor(options.maxResultChars / Math.max(1, perRuleNormalized.length));
	const perRuleBudgeted = perRuleNormalized.map((rule) => ({
		path: rule.path,
		relativePath: rule.relativePath,
		contentHash: rule.contentHash,
		body: isNeverTruncatedRule(rule.relativePath)
			? rule.body
			: truncateRule(rule.body, {
					maxChars: Math.min(options.maxRuleChars, perRuleResultChars),
					relativePath: rule.relativePath,
				}).body,
	}));

	// Incremental, header-aware admission: charge each rule's REAL (hash-anchored)
	// header only when that rule is admitted, so earlier candidates' headers never
	// pre-starve a later rule, and the first rule is always attempted against
	// maxResultChars minus its OWN header (not minus all candidates' headers).
	let remaining = options.maxResultChars;
	const budgetedBodies = perRuleBudgeted.map((rule) => {
		const headerLen = ruleHeaderLength(rule.path, rule.contentHash);
		const bodyBudget = remaining - headerLen;
		const fitted = truncateBudget({
			rules: [{ body: rule.body, relativePath: rule.relativePath }],
			maxResultChars: Math.max(0, bodyBudget),
		})[0];
		if (fitted === undefined || fitted.body.length === 0) {
			return { body: "", truncated: false, relativePath: rule.relativePath };
		}
		remaining -= headerLen + fitted.body.length;
		return fitted;
	});

	const truncatedRules: TruncatedRule[] = [];
	const emittedRules: LoadedRule[] = [];

	for (let index = 0; index < budgetedBodies.length; index += 1) {
		const sourceRule = perRuleBudgeted[index];
		const budgetedRule = budgetedBodies[index];
		const originalRule = rules[index];
		if (sourceRule === undefined || budgetedRule === undefined || originalRule === undefined) {
			continue;
		}

		// A rule with an empty body after budget allocation produces no useful
		// output (the header alone would be a ghost block). Drop it entirely.
		if (budgetedRule.body.length === 0) {
			continue;
		}

		truncatedRules.push({
			path: sourceRule.path,
			relativePath: budgetedRule.relativePath,
			body: budgetedRule.body,
			contentHash: sourceRule.contentHash,
		});
		emittedRules.push(originalRule);
	}

	return { truncatedRules, emittedRules };
}

export function formatStaticBlock(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): FormatResult {
	if (rules.length === 0) {
		return { text: "", emittedRules: [] };
	}
	if (options.maxResultChars <= 0) {
		return { text: "", emittedRules: [] };
	}

	const orderedRules = orderStaticRules(uniqueRulesByBody(rules));

	const { truncatedRules, emittedRules } = truncateRules(orderedRules, options);
	if (truncatedRules.length === 0) {
		return { text: "", emittedRules: [] };
	}

	const text = ["## Project Instructions", "", truncatedRules.map(formatRule).join("\n\n")].join("\n");
	return { text, emittedRules };
}

function orderStaticRules(rules: ReadonlyArray<LoadedRule>): LoadedRule[] {
	const hephaestusRules: LoadedRule[] = [];
	const otherRules: LoadedRule[] = [];
	for (const rule of rules) {
		if (isHephaestusRule(rule)) {
			hephaestusRules.push(rule);
			continue;
		}
		otherRules.push(rule);
	}
	return [...hephaestusRules, ...otherRules];
}

function isHephaestusRule(rule: LoadedRule): boolean {
	return displayFilename(rule).toLowerCase() === "hephaestus.md";
}

function displayFilename(rule: LoadedRule): string {
	const normalizedPath = rule.relativePath.length > 0 ? rule.relativePath : rule.path;
	const segments = normalizedPath
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0);
	return segments.at(-1) ?? normalizedPath;
}

function uniqueRulesByBody(rules: ReadonlyArray<LoadedRule>): LoadedRule[] {
	const uniqueRules: LoadedRule[] = [];
	const seenBodies = new Set<string>();
	const userDescriptions = new Set<string>();
	for (const rule of rules) {
		const descriptionKey = rule.frontmatter.description?.trim();
		if (rule.source === "plugin-bundled" && descriptionKey !== undefined && userDescriptions.has(descriptionKey)) {
			continue;
		}

		const bodyKey = normalizeRuleBody(rule.body);
		if (seenBodies.has(bodyKey)) {
			continue;
		}

		seenBodies.add(bodyKey);
		if (descriptionKey !== undefined && rule.source !== "plugin-bundled") {
			userDescriptions.add(descriptionKey);
		}
		uniqueRules.push(rule);
	}
	return uniqueRules;
}

export function formatDynamicBlock(
	rules: ReadonlyArray<LoadedRule>,
	targetRelativePath: string,
	options: FormatOptions,
): FormatResult {
	if (rules.length === 0) {
		return { text: "", emittedRules: [] };
	}

	const { truncatedRules, emittedRules } = truncateRules(rules, options);
	if (truncatedRules.length === 0) {
		return { text: "", emittedRules: [] };
	}

	const text = [
		`Additional project instructions matched for ${targetRelativePath}:`,
		"",
		truncatedRules.map(formatRule).join("\n\n"),
	].join("\n");
	return { text, emittedRules };
}

function normalizeRuleBody(body: string): string {
	return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

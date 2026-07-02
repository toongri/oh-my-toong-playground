import { basename, extname } from "node:path";
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
};

type NormalizedRule = TruncatedRule & {
	source: LoadedRule["source"];
};

/**
 * The XML open tag emitted ahead of each rule's body.
 *
 * Format: `<rules name="${basenameNoExt(path)}">`
 *
 * Producer (formatRule) and consumers (transcript filters) MUST build and seek
 * through ruleMarkerLine so emitted and sought tags always agree.
 *
 * lazy: dropping the hash removes version-granularity — accepted consequences:
 *   (1) An edited rule is NOT recognized as a new version if its open tag already
 *       appears in the transcript; it will be skipped until session restart.
 *   (2) Two rules with the same basename in different directories share the same
 *       `name`, so transcript-presence detection cannot distinguish them. The
 *       per-session path-keyed staticDedup still prevents double-injection within
 *       a session; only the transcript-presence layer is affected.
 */
export function ruleMarkerLine(path: string): string {
	return `<rules name="${basenameNoExt(path)}">`;
}

/**
 * Derive the rule name from a path: take the basename, then strip the last
 * extension (everything from the final "." onward). If there is no extension,
 * use the basename as-is.
 *
 * Examples:
 *   "coding-discipline.md" → "coding-discipline"
 *   "foo.test.md"          → "foo.test"
 *   "CLAUDE"               → "CLAUDE"
 */
function basenameNoExt(path: string): string {
	// Normalize backslashes first: node's POSIX basename does not split on "\".
	const base = basename(path.replace(/\\/g, "/"));
	const ext = extname(base);
	return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Decide whether a transcript already carries the open tag for a rule.
 *
 * Name-based presence: returns true when ANY of the given path spellings resolves
 * to an open tag that appears in the transcript. No hash/version logic — an edited
 * rule whose open tag is already present is treated as injected (see lazy: note on
 * ruleMarkerLine for the accepted trade-off).
 *
 * `paths` lists the path spellings to try (e.g. path and realPath). Because the
 * open tag is derived solely from the basename, two paths with the same basename
 * produce the same tag and are effectively equivalent here.
 */
export function transcriptHasRuleMarker(
	transcriptText: string,
	paths: ReadonlyArray<string>,
): boolean {
	return paths.some((path) => transcriptText.includes(ruleMarkerLine(path)));
}

/**
 * The closing tag (with its leading newline) that ends every rule's XML envelope.
 * Single-sourced so formatRule (which emits it) and ruleHeaderLength (which charges
 * its bytes to the budget) cannot drift apart.
 */
const RULE_BLOCK_CLOSE = "\n</rules>";

/**
 * Byte overhead charged to the budget per emitted rule: everything in the emitted
 * envelope except the body. The non-empty-body form is
 * `${openTag}\n${body}${RULE_BLOCK_CLOSE}`, so eliding the body leaves
 * `${openTag}\n${RULE_BLOCK_CLOSE}` — exactly the bytes computed here.
 *
 * Charged before body bytes so a rule with no remaining body budget is dropped
 * (no open-tag-only ghost block).
 */
function ruleHeaderLength(path: string): number {
	return `${ruleMarkerLine(path)}\n${RULE_BLOCK_CLOSE}`.length;
}

function formatRule(rule: TruncatedRule): string {
	const openTag = ruleMarkerLine(rule.path);
	const body = normalizeRuleBody(rule.body);
	if (body.length === 0) {
		return `${openTag}${RULE_BLOCK_CLOSE}`;
	}
	return `${openTag}\n${body}${RULE_BLOCK_CLOSE}`;
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
	}));
	const perRuleResultChars = Math.floor(
		options.maxResultChars / Math.max(1, perRuleNormalized.length),
	);
	const perRuleBudgeted = perRuleNormalized.map((rule) => ({
		path: rule.path,
		relativePath: rule.relativePath,
		body: isNeverTruncatedRule(rule.relativePath)
			? rule.body
			: truncateRule(rule.body, {
					maxChars: Math.min(options.maxRuleChars, perRuleResultChars),
					relativePath: rule.relativePath,
				}).body,
	}));

	// Incremental, header-aware admission: charge each rule's header only when that
	// rule is admitted, so earlier candidates' headers never pre-starve a later rule,
	// and the first rule is always attempted against maxResultChars minus its OWN
	// header (not minus all candidates' headers).
	let remaining = options.maxResultChars;
	const budgetedBodies = perRuleBudgeted.map((rule) => {
		const headerLen = ruleHeaderLength(rule.path);
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
		});
		emittedRules.push(originalRule);
	}

	return { truncatedRules, emittedRules };
}

export function formatStaticBlock(
	rules: ReadonlyArray<LoadedRule>,
	options: FormatOptions,
): FormatResult {
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

	const text = ["## Project Instructions", "", truncatedRules.map(formatRule).join("\n\n")].join(
		"\n",
	);
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
		if (
			rule.source === "plugin-bundled" &&
			descriptionKey !== undefined &&
			userDescriptions.has(descriptionKey)
		) {
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

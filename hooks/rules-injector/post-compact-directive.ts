import { uniqueStrings } from "./path-utils.js";

const DIRECTIVE_HEADER = [
	"## MANDATORY: POST-COMPACTION RULE RECOVERY",
	"",
	"Context compaction DROPPED the project rule files listed below from your context.",
	"Read every listed rule file in full using the necessary file-reading tools.",
	"Then restore bounded session state and Now, check authoritative evidence, and resume work.",
	"Higher-priority instructions remain unchanged.",
	"",
].join("\n");

const DIRECTIVE_FOOTER = "";

export interface PostCompactReadDirective {
	text: string;
	/** The subset of input paths that were actually included in the directive text.
	 * Paths dropped by the budget are absent; only these should be marked injected. */
	emittedPaths: string[];
}

export function buildPostCompactReadDirective(
	rulePaths: ReadonlyArray<string>,
	maxChars: number,
): PostCompactReadDirective {
	const paths = uniqueStrings([...rulePaths]);
	if (paths.length === 0) {
		return { text: "", emittedPaths: [] };
	}

	const lines: string[] = [];
	const emittedPaths: string[] = [];
	let usedChars = DIRECTIVE_HEADER.length + DIRECTIVE_FOOTER.length;
	let omittedCount = 0;
	for (const rulePath of paths) {
		const line = `- ${rulePath}`;
		if (lines.length > 0 && usedChars + line.length + 1 > maxChars) {
			omittedCount += 1;
			continue;
		}
		lines.push(line);
		emittedPaths.push(rulePath);
		usedChars += line.length + 1;
	}
	if (omittedCount > 0) {
		lines.push(
			`- (+${omittedCount} more rule files omitted - rescan the project rule directories and read those too)`,
		);
	}
	return { text: `${DIRECTIVE_HEADER}${lines.join("\n")}${DIRECTIVE_FOOTER}`, emittedPaths };
}

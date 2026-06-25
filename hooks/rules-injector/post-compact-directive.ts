import { uniqueStrings } from "./path-utils.js";

const DIRECTIVE_HEADER = [
	"## MANDATORY: POST-COMPACTION RULE RECOVERY",
	"",
	"Context compaction DROPPED the project rule files listed below from your context.",
	"YOU MUST READ THE FOLLOWING RULES with your file-reading tool RIGHT NOW, BEFORE ANY OTHER ACTION. NO EXCUSES.",
	"Do not plan, answer, edit, or run anything until EVERY file below has been read end to end:",
	"",
].join("\n");

const DIRECTIVE_FOOTER =
	"\nOperating without these rules is a protocol violation. Reconstructing them from memory is NOT reading. READ THEM ALL. NO EXCUSES.";

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

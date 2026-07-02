export type ClosingDelimiter = {
	readonly start: number;
	readonly bodyStart: number;
};

export function stripBom(content: string): string {
	return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

/** Return the length of the opening --- delimiter line (including its newline), or 0. */
export function getOpeningDelimiterLength(content: string): number {
	// Accept `---` followed by optional spaces/tabs, then \r?\n.
	// We scan the first line to find the newline and check if the line is `---\s*`.
	const newlineIndex = content.indexOf("\n");
	if (newlineIndex === -1) return 0;
	// Strip the optional \r before \n.
	const firstLine = content
		.slice(0, newlineIndex)
		.replace(/\r$/, "")
		.replace(/[ \t]+$/, "");
	if (firstLine !== "---") return 0;
	return newlineIndex + 1;
}

export function findClosingDelimiter(
	content: string,
	openingLength: number,
): ClosingDelimiter | null {
	let lineStart = openingLength;

	while (lineStart <= content.length) {
		const nextNewline = content.indexOf("\n", lineStart);
		const lineEnd = nextNewline === -1 ? content.length : nextNewline;
		// Strip \r and trailing spaces/tabs before comparing to "---".
		const line = content
			.slice(lineStart, lineEnd)
			.replace(/\r$/, "")
			.replace(/[ \t]+$/, "");

		if (line === "---") {
			return {
				start: lineStart,
				bodyStart: nextNewline === -1 ? content.length : nextNewline + 1,
			};
		}

		if (nextNewline === -1) break;
		lineStart = nextNewline + 1;
	}

	return null;
}

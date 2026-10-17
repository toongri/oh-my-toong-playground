/**
 * Lines of `text` outside fenced code blocks, in order, fence lines excluded.
 * A fence opens on a run of 3+ backticks or tildes (indent up to 3) and closes only
 * on a line of the same character, at least as long, followed by whitespace only —
 * so a shorter run, the other fence character, or a line with an info string inside
 * a block does not close it. An unclosed fence runs to the end of the text.
 */
export function linesOutsideFences(text: string): string[] {
	const out: string[] = [];
	let closer: RegExp | null = null;
	for (const line of text.split(/\r?\n/)) {
		if (closer !== null) {
			if (closer.test(line)) closer = null;
			continue;
		}
		const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (open !== null) {
			closer = new RegExp(`^\\s{0,3}${open[1][0]}{${open[1].length},}\\s*$`);
			continue;
		}
		out.push(line);
	}
	return out;
}

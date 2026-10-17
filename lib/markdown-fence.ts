/**
 * Fenced code block detection shared by every markdown reader that must agree on
 * what is code: the Stop hook's completion token, the plan TODO check, the plan
 * validator and the presentation renderers. Rules follow CommonMark:
 *
 * - A fence opens on a run of 3+ backticks or tildes. A backtick fence's info
 *   string may not contain a backtick.
 * - Indentation is measured from the content column of the list item that holds
 *   the line (0 at top level). A line indented 4+ columns past it is indented
 *   code, not a fence.
 * - A fence closes only on a line of the same character, at least as long, with
 *   whitespace only after it, and indented less than 4 columns past the opener's
 *   container. A shorter run, the other character, or a line with an info string
 *   does not close it.
 * - An unclosed fence runs to the end of the text.
 */

export interface FenceBlock {
	/** Line index of the opening fence. */
	open: number;
	/** Line index of the closing fence, or -1 when the fence runs to the end. */
	close: number;
	/** Whitespace before the opening fence, as written. */
	indent: string;
	/** Info string after the opening fence (untrimmed). */
	info: string;
}

/** Width of leading whitespace, a tab advancing to the next multiple of 4. */
function indentWidth(ws: string): number {
	let w = 0;
	for (const ch of ws) w = ch === "\t" ? w + 4 - (w % 4) : w + 1;
	return w;
}

const LIST_ITEM_LINE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)\S/;

/**
 * Content column of the list item holding `lines[i]` (indented `indent` columns),
 * or 0 at top level. Walks back over earlier lines: the first list item whose
 * content column is at or left of the bound holds the line; any other non-blank
 * line narrows the bound to its own indent, and one at column 0 means top level.
 */
function containerColumn(lines: string[], i: number, indent: number): number {
	let bound = indent;
	for (let j = i - 1; j >= 0; j--) {
		const line = lines[j];
		if (line.trim() === "") continue;
		const item = LIST_ITEM_LINE.exec(line);
		if (item !== null) {
			const markerEnd = indentWidth(item[1]) + item[2].length;
			const gap = indentWidth(item[1] + item[2] + item[3]) - indentWidth(item[1] + item[2]);
			// 5+ spaces after the marker means content starts one column past it.
			const content = markerEnd + (gap > 4 ? 1 : gap);
			if (content <= bound) return content;
		}
		const lead = indentWidth(line.slice(0, line.length - line.trimStart().length));
		if (lead === 0) return 0;
		bound = Math.min(bound, lead);
	}
	return 0;
}

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/;

/** Every fenced block in `lines`, in order. Lines must not carry `\r`. */
export function findFenceBlocks(lines: string[]): FenceBlock[] {
	const blocks: FenceBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = FENCE_OPEN.exec(lines[i]);
		if (open === null) continue;
		const [, indent, fence, info] = open;
		if (fence[0] === "`" && info.includes("`")) continue;
		const width = indentWidth(indent);
		const container = containerColumn(lines, i, width);
		if (width - container >= 4) continue;
		let close = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const m = FENCE_CLOSE.exec(lines[j]);
			if (
				m !== null &&
				m[2][0] === fence[0] &&
				m[2].length >= fence.length &&
				indentWidth(m[1]) - container < 4
			) {
				close = j;
				break;
			}
		}
		blocks.push({ open: i, close, indent, info });
		if (close === -1) break;
		i = close;
	}
	return blocks;
}

/** Lines of `text` outside fenced code blocks, in order, fence lines excluded. */
export function linesOutsideFences(text: string): string[] {
	const lines = text.split(/\r\n?|\n/);
	const out: string[] = [];
	let next = 0;
	for (const block of findFenceBlocks(lines)) {
		out.push(...lines.slice(next, block.open));
		next = block.close === -1 ? lines.length : block.close + 1;
	}
	out.push(...lines.slice(next));
	return out;
}

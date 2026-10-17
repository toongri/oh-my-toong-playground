import { Lexer, type Token } from "marked";

/**
 * Code blocks and HTML comments in a markdown text, found by marked's lexer — the
 * same parser the presentation renderers use, so every reader of a plan or message
 * (the Stop hook's completion token, the plan TODO check, the plan validator, the
 * renderers) agrees with what the reader sees as code or hidden text. CommonMark
 * details such as list-relative fence indentation, fence length and character,
 * indented code and unclosed blocks are the lexer's, not re-implemented here.
 */

export interface MarkdownBlock {
	kind: "code" | "comment";
	/** First source line, 0-based. */
	start: number;
	/** Last source line, 0-based, inclusive. */
	end: number;
	/** True for a ``` / ~~~ fence, false for indented code and comments. */
	fenced: boolean;
	/** False for a fence with no closing line or a `<!--` with no `-->`. */
	closed: boolean;
	/** Info string of a fenced code block (`mermaid title="x"`), "" otherwise. */
	info: string;
}

const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/;

/** Whether a fenced code token's raw text ends with a closing fence of its opener. */
function fenceClosed(raw: string): boolean {
	const lines = raw.replace(/\n+$/, "").split("\n");
	const opener = FENCE_LINE.exec(lines[0]);
	if (opener === null || lines.length < 2) return false;
	const closer = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[lines.length - 1]);
	return closer !== null && closer[1][0] === opener[1][0] && closer[1].length >= opener[1].length;
}

/** Line breaks in `s` — how far a token's raw text advances the source line. */
const lineBreaks = (s: string): number => s.split("\n").length - 1;

/**
 * Every code block and HTML comment block in `text`, in source order. Line numbers
 * index `text` split on `\r\n`, `\r` or `\n`. A token's start line is the number of
 * line breaks before it: the lexer's raw texts concatenate to its input, and a
 * container (list item, blockquote) only strips markers and indentation inside a
 * line, so the same count holds for nested tokens.
 */
export function findMarkdownBlocks(text: string): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	const walk = (tokens: Token[], startLine: number): void => {
		let line = startLine;
		for (const token of tokens) {
			const last = line + lineBreaks(token.raw.replace(/\n+$/, ""));
			if (token.type === "code") {
				const fenced = token.codeBlockStyle !== "indented";
				blocks.push({
					kind: "code",
					start: line,
					end: last,
					fenced,
					closed: !fenced || fenceClosed(token.raw),
					info: fenced ? (token.lang ?? "") : "",
				});
			} else if (token.type === "html" && token.raw.trimStart().startsWith("<!--")) {
				blocks.push({ kind: "comment", start: line, end: last, fenced: false, closed: token.raw.includes("-->"), info: "" });
			} else if (token.type === "list") {
				walk(token.items, line);
			} else if ((token.type === "list_item" || token.type === "blockquote") && token.tokens) {
				walk(token.tokens, line);
			}
			line += lineBreaks(token.raw);
		}
	};
	walk(Lexer.lex(text.replace(/\r\n?/g, "\n")), 0);
	return blocks;
}

/** Lines of `text` outside code blocks, in order. */
export function linesOutsideCode(text: string): string[] {
	const lines = text.split(/\r\n?|\n/);
	const inCode = new Set<number>();
	for (const block of findMarkdownBlocks(text)) {
		if (block.kind !== "code") continue;
		for (let k = block.start; k <= block.end; k++) inCode.add(k);
	}
	return lines.filter((_, k) => !inCode.has(k));
}

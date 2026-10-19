#!/usr/bin/env bun
/**
 * explain-diff renderer — markdown source to a single-file HTML page.
 *
 * The conversion happens here, at build time, and the page needs no JavaScript:
 * the document is rendered once and every pixel is static HTML and CSS. The page
 * styling is template-owned (this file); the author supplies content only.
 *
 * Diagrams arrive three ways. 1D flow strips and before/after cards are
 * sanctioned component markup (classes this file's CSS owns). 2D structure
 * diagrams are model-authored inline SVG inside a `<figure class="diagram"
 * data-kind="…">` block written straight into the Markdown (the block contract
 * lives in lib/explain-diff-structure.ts). marked passes the whole block through
 * unchanged — blank lines and indentation inside it included — and the SVG takes
 * its colors from the CSS variables below, so one drawing reads in light and dark.
 * There is no diagram renderer, no browser and no external tool in the build.
 */
import { readFileSync, writeFileSync } from "fs";
import { basename, extname } from "path";
import { Marked, marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked";
import { DIAGRAM_FIGURE_PATTERN } from "@lib/explain-diff-structure";

/** Heading rows the table of contents is built from. */
interface TocEntry {
	level: number;
	/** The heading's rendered inline HTML, so the entry keeps the heading's code/bold formatting. */
	html: string;
	id: string;
}

export function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/`/g, "")
			.trim()
			// Korean is kept: these documents are Korean-first, and dropping
			// non-ASCII would collapse every Korean heading to the same empty id.
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "section"
	);
}

/** Scroll-hint copy shown under a figure that scrolls in its own container. */
const FIG_HINT = "그림은 좌우로 밀어서 볼 수 있어요.";

/** A narrow-first drawing may grow at most this far past its drawn size on a wide screen (13px labels stay under 20px). */
const FIG_MAX_SCALE = 1.5;

/**
 * Turns one authored figure block into its page markup. The block passes through byte for byte
 * except the opening `<svg>` tag, which gains one `style`:
 *
 * - without `data-min-width`, `max-width` at {@link FIG_MAX_SCALE} times the viewBox width. The
 *   stylesheet keeps `width:100%`, so the figure still shrinks to a phone column, but a 340-wide
 *   drawing is not blown up to 3.4x its labels on a 1280px screen.
 * - with `data-min-width="N"`, `min-width:Npx`: the SVG keeps a drawn size of N px (labels stay
 *   readable) and scrolls sideways inside its own container, announced by a hint line.
 *   `onMinWidth` lets the page emit the viewport breakpoint below which that hint shows.
 *
 * The replacers are functions so `$&` and `$1` inside a label are never read as substitution patterns.
 */
function renderDiagramFigure(block: string, onMinWidth: (width: number) => void): string {
	const open = /^<figure\b[^>]*>/i.exec(block)?.[0] ?? "";
	const minWidth = /(?<![\w-])data-min-width\s*=\s*["'](\d+)["']/i.exec(open)?.[1];
	if (minWidth !== undefined) {
		onMinWidth(Number(minWidth));
		return block.replace(
			/<svg\b([^>]*)>([\s\S]*)<\/svg\s*>/i,
			(_m, attrs: string, inner: string) =>
				`<div class="fig-scroll" tabindex="0" role="region" aria-label="그림, 좌우 스크롤">` +
				`<svg${attrs} style="min-width:${minWidth}px">${inner}</svg></div>` +
				`<p class="fig-hint" data-min="${minWidth}">${FIG_HINT}</p>`,
		);
	}
	return block.replace(/<svg\b([^>]*)>/i, (tag: string, attrs: string) => {
		const width = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/i.exec(attrs)?.[1];
		return width === undefined ? tag : `<svg${attrs} style="max-width:${Math.round(Number(width) * FIG_MAX_SCALE)}px">`;
	});
}

/**
 * marked block extension for `<figure class="diagram">…</figure>`. CommonMark would end an HTML
 * block at the first blank line and turn indented SVG lines into code, so the figure is
 * tokenized as one unit instead. The block must start at a line with at most 3 spaces of
 * indent and end with `</figure>` on its own line.
 */
function diagramFigureExtension(onMinWidth: (width: number) => void): TokenizerAndRendererExtension {
	const block = new RegExp(`^ {0,3}(${DIAGRAM_FIGURE_PATTERN})[ \\t]*(?:\\r?\\n|$)`, "i");
	return {
		name: "diagramFigure",
		level: "block",
		start(src: string) {
			const at = src.search(/^ {0,3}<figure\b/m);
			return at < 0 ? undefined : at;
		},
		tokenizer(src: string) {
			const m = block.exec(src);
			return m === null ? undefined : { type: "diagramFigure", raw: m[0], text: m[1] ?? "" };
		},
		renderer(token) {
			return `${renderDiagramFigure(String(token.text), onMinWidth)}\n`;
		},
	};
}

/** Lexer for reading the source (title, warnings): knows figures, renders nothing. */
const sourceMarked = new Marked({ extensions: [diagramFigureExtension(() => undefined)] });

/**
 * GFM reads a single-tilde pair (`1~3 와 4~6`) as strikethrough. These documents
 * write ranges that way, so only a `~~` pair renders `<del>`; a single-tilde
 * pair gives its tildes back as literal text around the inline content.
 */
function renderDel(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens, raw }: Tokens.Del): string {
	const inner = this.parser.parseInline(tokens);
	return raw.startsWith("~~") ? `<del>${inner}</del>` : `~${inner}~`;
}

/** Inline-only parser for `<summary>` text: marked's own parser, plus the tilde rule. */
const summaryMarked = new Marked({ renderer: { del: renderDel } });

/** CommonMark HTML-block start conditions 1-5 (raw text until a closing marker) must not be split. */
const RAW_HTML_BLOCK = /<(?:pre|script|style|textarea)\b|<!--|<\?|<![A-Za-z[]/i;

/**
 * Splits a block-level HTML token at the first line that is not itself HTML.
 * CommonMark keeps an HTML block going until a blank line, so markdown written
 * directly under `<summary>`, `<div>` or a pre-rendered diagram figure would
 * stay literal. The line before the split must end with `>` so a multi-line
 * opening tag is not cut. Returns the index of the split line, or -1.
 */
function htmlBlockSplitLine(text: string): number {
	if (RAW_HTML_BLOCK.test(text)) return -1;
	const lines = text.split("\n");
	for (let i = 1; i < lines.length; i++) {
		// A tab or 4+ spaces of indent would become an indented code block once the rest is re-lexed.
		if (/^(?: {4}| {0,3}\t)/.test(lines[i])) continue;
		const line = lines[i].trim();
		if (line !== "" && !line.startsWith("<") && lines[i - 1].trimEnd().endsWith(">")) return i;
	}
	return -1;
}

/**
 * Rewrites inline tokens for a heading. Raw inline HTML (`Promise<void>`) becomes
 * literal text so it is shown, not swallowed as a tag. With `flattenLinks` (the
 * TOC entry, which is itself a link) a link keeps only its inner content, because
 * an `<a>` inside an `<a>` is invalid HTML.
 */
function headingInlineTokens(tokens: Token[], flattenLinks: boolean): Token[] {
	return tokens.flatMap((t): Token[] => {
		if (t.type === "html") {
			const text: Tokens.Text = { type: "text", raw: t.raw, text: t.raw };
			return [text];
		}
		const inner = "tokens" in t && Array.isArray(t.tokens) ? headingInlineTokens(t.tokens, flattenLinks) : undefined;
		if (flattenLinks && t.type === "link") return inner ?? [];
		return [inner ? Object.assign({}, t, { tokens: inner }) : t];
	});
}

/** The inline tokens as plain text — no markdown syntax, no tags. */
function inlinePlainText(tokens: Token[]): string {
	return tokens
		.map((t) => ("tokens" in t && Array.isArray(t.tokens) ? inlinePlainText(t.tokens) : t.type === "br" ? "" : "text" in t ? String(t.text) : t.raw))
		.join("");
}

/** Removes a YAML frontmatter block, only when it opens at byte 0 and a `---` line closes it. */
export function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, "");
}

/** The first level-1 heading as plain text (code fences are not headings); `fallback` when there is none. */
export function extractTitle(markdown: string, fallback: string): string {
	const h1 = sourceMarked.lexer(stripFrontmatter(markdown)).find((t): t is Tokens.Heading => t.type === "heading" && t.depth === 1);
	return (h1 ? inlinePlainText(h1.tokens) : "").trim() || fallback;
}

export function renderToHtml(markdown: string, title: string): string {
	markdown = stripFrontmatter(markdown);
	const toc: TocEntry[] = [];
	const seen = new Map<string, number>();
	const used = new Set<string>();

	const minWidths = new Set<number>();
	const docMarked = new Marked({ extensions: [diagramFigureExtension((w) => minWidths.add(w))] });
	const renderer = new marked.Renderer();
	renderer.heading = function ({ tokens, text, depth }: Tokens.Heading) {
		// The id still comes from the raw source text, so anchors stay what they were.
		const base = slugify(text);
		const taken = (c: string) => used.has(c);
		let id = base;
		if (taken(base)) {
			let n = seen.get(base) ?? 1;
			do {
				n += 1;
				id = `${base}-${n}`;
			} while (taken(id));
			seen.set(base, n);
		}
		used.add(id);
		const html = this.parser.parseInline(headingInlineTokens(tokens, false));
		// h2/h3 only: h1 is the document's title, not one of its sections, and
		// listing it as the first table-of-contents entry just points at the top.
		if (depth >= 2 && depth <= 3) toc.push({ level: depth, html: this.parser.parseInline(headingInlineTokens(tokens, true)), id });
		return `<h${depth} id="${id}">${html}</h${depth}>\n`;
	};
	// A `<details><summary>…</summary>` line is a raw HTML block, so markdown
	// would not touch the summary text; render it inline like any other line.
	renderer.del = renderDel;
	renderer.html = function ({ text, block }: Tokens.HTML | Tokens.Tag) {
		const split = block ? htmlBlockSplitLine(text) : -1;
		// Inside a raw block (script, pre, comment…) `<summary>` is just text; leave it alone.
		if (RAW_HTML_BLOCK.test(text)) return text;
		const lines = text.split("\n");
		const head = split === -1 ? text : lines.slice(0, split).join("\n") + "\n";
		const withSummary = head.replace(
			/(<summary\b[^>]*>)([\s\S]*?)(<\/summary>)/gi,
			(_m, open: string, inner: string, close: string) =>
				`${open}${summaryMarked.parseInline(inner, { async: false })}${close}`,
		);
		// The rest is markdown again; it may hold further HTML blocks (e.g. `</details>`).
		return split === -1 ? withSummary : withSummary + this.parser.parse(docMarked.lexer(lines.slice(split).join("\n")));
	};

	const bodyHtml = String(docMarked.parse(markdown, { renderer, async: false }));

	const tocHtml = toc
		.map((e) => `<li class="lv${e.level}"><a href="#${e.id}">${e.html}</a></li>`)
		.join("\n");

	const tocNav = toc.length === 0 ? "" : `<nav class="toc" aria-label="목차"><h2>목차</h2><ul>${tocHtml}</ul></nav>\n`;

	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${scrollHintCss(minWidths)}</style>
</head>
<body>
<main>
${tocNav}${bodyHtml}
</main>
</body>
</html>
`;
}

/**
 * Returns the raw source of every inline code span whose content ends with a
 * backslash. Inside a code span a backslash is not an escape, so `` `sql\`…\`` ``
 * closes the code at `\`` and flips every later code span on the line. A
 * legitimate span can also end with `\` (`` `C:\` ``), so the caller warns and
 * never fails the render.
 */
export function findBackslashEndedCodeSpans(markdown: string): string[] {
	const found: string[] = [];
	sourceMarked.walkTokens(sourceMarked.lexer(markdown), (token) => {
		if (token.type === "codespan" && token.text.endsWith("\\")) found.push(token.raw);
		// An HTML block is not inline-lexed, so the spans inside its <summary> text are lexed here.
		if (token.type === "html" && !RAW_HTML_BLOCK.test(token.text)) {
			for (const m of token.text.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)) {
				marked.walkTokens(marked.Lexer.lexInline(m[1]), (t) => {
					if (t.type === "codespan" && t.text.endsWith("\\")) found.push(t.raw);
				});
			}
		}
	});
	return found;
}

/** Drops control characters from text echoed to the terminal, so a document cannot drive the cursor or the screen. */
export function stripControlChars(text: string): string {
	// eslint-disable-next-line no-control-regex -- intentional: strips literal control chars from terminal-echoed text
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * One breakpoint per distinct `data-min-width`: the hint shows only while the viewport is
 * narrow enough that a figure drawn at N px overflows its container. The column is
 * 94vw wide, minus 2.5rem of page padding and about 26px of figure padding and border.
 * Sorted, so the page stays byte-reproducible for the render gate.
 */
function scrollHintCss(widths: ReadonlySet<number>): string {
	return [...widths]
		.sort((a, b) => a - b)
		.map((n) => `\n@media (max-width: ${Math.ceil((n + 66) / 0.94)}px) { figure.diagram .fig-hint[data-min="${n}"] { display: block; } }`)
		.join("");
}

// One long page with a table of contents, no top-level tabs, responsive by
// default, and readable in either theme. `white-space: pre-wrap` on every code
// container is load-bearing — without it a browser collapses the newlines of a
// styled div and the whole listing arrives as one line.
const STYLE = `
/* 레이아웃: 한 줄 읽기 컬럼 + 넓은 무대, 다이어그램은 컬럼 폭에 맞춰 줄고 필요하면 자기 컨테이너에서 스크롤한다.
   토큰은 html-report §3 과 같은 이름이다 — SVG 가 이 변수만 쓰므로 라이트·다크에서 같은 그림이 읽힌다. */
:root {
  --bg: #F3F4F8; --surface: #FFFFFF; --surface-2: #E9ECF3;
  --ink: #141821; --ink-2: #444C5C; --ink-3: #5B6477;
  --line: #D3D8E2; --line-strong: #98A0B3;
  --accent: #3340C9;
  --ok: #0B7A57; --ok-bg: #DCF2E8;
  --bad: #C0301F; --bad-bg: #FBE3DF;
  --warn: #8F5400; --warn-bg: #FAEAC8;
  --on-badge: #FFFFFF;
  --font: "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0E1117; --surface: #161A22; --surface-2: #1F242E;
    --ink: #E8EBF1; --ink-2: #B4BBC9; --ink-3: #8F98AA;
    --line: #2B313D; --line-strong: #566074;
    --accent: #9DAAFF;
    --ok: #4FD6A4; --ok-bg: #11302A;
    --bad: #FF8A7E; --bad-bg: #3B1B18;
    --warn: #F3BC5C; --warn-bg: #392B10;
    --on-badge: #0E1117;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0E1117; --surface: #161A22; --surface-2: #1F242E;
  --ink: #E8EBF1; --ink-2: #B4BBC9; --ink-3: #8F98AA;
  --line: #2B313D; --line-strong: #566074;
  --accent: #9DAAFF;
  --ok: #4FD6A4; --ok-bg: #11302A;
  --bad: #FF8A7E; --bad-bg: #3B1B18;
  --warn: #F3BC5C; --warn-bg: #392B10;
  --on-badge: #0E1117;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.75 var(--font);
  word-break: keep-all; overflow-wrap: break-word;
}
/* 본문 폭 — 좁은 고정 컬럼(46rem)은 다이어그램·카드가 잘리는 실측 결함이었다.
   뷰포트에 반응해 최대 92rem(≈1472px)까지 쓰고, 창이 좁아지면 94vw로 따라간다. */
main { max-width: min(92rem, 94vw); margin: 0 auto; padding: 2rem 1.25rem 6rem; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1, h2, h3, h4 { line-height: 1.35; margin: 2.5rem 0 0.75rem; letter-spacing: -0.01em; text-wrap: balance; }
h1 { font-size: clamp(30px, 6vw, 46px); line-height: 1.2; font-weight: 700; margin-top: 0; }
h2 { font-size: 24px; font-weight: 700; border-bottom: 1px solid var(--line); padding-bottom: 0.35rem; }
h3 { font-size: 17px; font-weight: 600; line-height: 1.4; }
p, li { overflow-wrap: anywhere; }
a { color: var(--accent); }
blockquote {
  margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--accent);
  background: var(--surface-2); color: var(--ink-2);
}
pre, code, .code {
  font-family: var(--mono);
  white-space: pre-wrap;
}
code { word-break: normal; overflow-wrap: anywhere; }
pre {
  background: var(--surface-2); padding: 0.9rem 1rem; border-radius: 6px;
  overflow-x: auto; font-size: 14px;
}
code { background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 15px; line-height: 1.6; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
th { background: var(--surface-2); color: var(--ink-2); font-weight: 600; }
img { max-width: 100%; height: auto; }
.toc {
  margin: 0 0 3rem; padding: 1rem 1.25rem; background: var(--surface);
  border: 1px solid var(--line); border-radius: 8px; font-size: 15px;
}
.toc h2 { margin: 0 0 0.5rem; font-size: 1rem; border: 0; padding: 0; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc .lv2 { margin-left: 0; }
.toc .lv3 { margin-left: 1.1rem; color: var(--ink-3); }
h1, h2, h3, h4, p, li, blockquote, th, td { word-break: keep-all; }
h1, h2, h3, h4, summary, th, td { overflow-wrap: anywhere; }

/* --- 승인된 컴포넌트: 저자는 클래스만 쓰고, 시각 언어는 여기 한 곳이 소유한다 --- */
.doc-meta {
  display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; list-style: none;
  margin: 0 0 2rem; padding: 0.8rem 1.1rem; background: var(--surface);
  border: 1px solid var(--line); border-radius: 8px; font-size: 14.5px; color: var(--ink-2);
}
.doc-meta strong { color: var(--ink); font-weight: 600; }

.flow { display: flex; align-items: stretch; flex-wrap: wrap; gap: 0.4rem; margin: 1.25rem 0; }
.flow-step {
  flex: 1 1 8.5rem; min-width: 0; display: flex; flex-direction: column; justify-content: center;
  padding: 0.6rem 0.55rem; border: 1px solid var(--line); border-top: 3px solid var(--accent);
  border-radius: 8px; background: var(--surface); text-align: center;
  font-size: 14px; line-height: 1.5;
}
.flow-step code { overflow-wrap: anywhere; word-break: break-all; }
.flow-arrow { display: flex; align-items: center; color: var(--ink-3); }

.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.25rem 0; }
.compare-before, .compare-after {
  border: 1px solid var(--line); border-radius: 10px; padding: 0.9rem 1rem 1rem; font-size: 15px;
  background: var(--surface);
}
.compare-before { border-top: 3px solid var(--bad); }
.compare-after { border-top: 3px solid var(--ok); }
.compare-before::before, .compare-after::before {
  display: block; font-size: 13px; font-weight: 700; letter-spacing: 0.04em;
  margin-bottom: 0.35rem;
}
.compare-before::before { content: "BEFORE"; color: var(--bad); }
.compare-after::before { content: "AFTER"; color: var(--ok); }

.callout {
  margin: 1.25rem 0; padding: 0.8rem 1.1rem; border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 8px;
  background: var(--surface); font-size: 15.5px;
}

/* cf — 변경 하나의 필드 블록. 책임 항목이 각자 한 줄로 서고(붕괴 방지),
   출처는 배지로, 위치 앵커는 산문 밖 회색 슬롯으로 뺀다. 변경종류(data-change)
   배지는 arch-entity 와 같은 색·라벨을 render.ts 가 붙인다 — 저자는 종류만 준다. */
.cf {
  margin: 0.6rem 0 1rem; padding: 0.1rem 0 0.1rem 0.9rem;
  border-left: 2px solid var(--line);
}
.cf p { margin: 0.3rem 0; font-size: 15.5px; }
.cf strong { color: var(--ink); font-weight: 650; }
.cf[data-change]::before {
  display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  border-radius: 999px; padding: 0 0.5rem; margin: 0 0 0.35rem; color: var(--on-badge);
}
.cf[data-change="new"] { border-left-color: var(--ok); }
.cf[data-change="new"]::before { content: "신설"; background: var(--ok); }
.cf[data-change="mod"] { border-left-color: var(--warn); }
.cf[data-change="mod"]::before { content: "변경"; background: var(--warn); }
.cf[data-change="del"] { border-left-color: var(--bad); }
.cf[data-change="del"]::before { content: "삭제"; background: var(--bad); }
.cf-src {
  display: inline-block; font-size: 12px; font-weight: 700;
  letter-spacing: 0.02em; color: var(--ink-2); background: var(--surface-2);
  border: 1px solid var(--line); border-radius: 999px;
  padding: 0 0.5rem; margin: 0 0.15rem; vertical-align: 0.06em;
}
.cf-loc { font-size: 13px; color: var(--ink-3); margin-top: 0.45rem; }
.cf-loc code { background: none; padding: 0; font-size: inherit; color: inherit; }

/* arch-entity — 아키텍처 노드/동작단위 하나의 구조 카드. cf 와 같은 필드 규칙에
   변경종류 배지(data-change)를 더한다. 색은 render.ts 가 소유한다 — 저자는 종류만 준다.
   컴포넌트 레벨(패키지·책임·인터페이스·변경점)과 경계 블록(한 일·영향 인터페이스)이 함께 쓴다. */
.arch-entity {
  margin: 0.6rem 0 1rem; padding: 0.55rem 0.9rem;
  border: 1px solid var(--line); border-left: 3px solid var(--line);
  border-radius: 8px; background: var(--surface);
}
.arch-entity p { margin: 0.25rem 0; font-size: 15px; }
.arch-entity strong { color: var(--ink); font-weight: 650; }
.arch-entity[data-change]::before {
  display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  border-radius: 999px; padding: 0 0.5rem; margin: 0 0 0.35rem; color: var(--on-badge);
}
.arch-entity[data-change="new"] { border-left-color: var(--ok); }
.arch-entity[data-change="new"]::before { content: "신설"; background: var(--ok); }
.arch-entity[data-change="mod"] { border-left-color: var(--warn); }
.arch-entity[data-change="mod"]::before { content: "변경"; background: var(--warn); }
.arch-entity[data-change="del"] { border-left-color: var(--bad); }
.arch-entity[data-change="del"]::before { content: "삭제"; background: var(--bad); }

/* ae-members — 도메인 카드의 핵심 멤버/메소드 칩 행. 산문 나열 대신 스캔 가능한
   칩으로 구조화하고, 이번 diff가 추가/변경한 멤버는 class="chg"로 변경색을 입힌다. */
.arch-entity p.ae-members code {
  display: inline-block; margin: 0.12rem 0.18rem 0.12rem 0; padding: 0.05rem 0.55rem;
  border: 1px solid var(--line); border-radius: 999px; font-size: 13.5px;
  background: transparent;
}
.arch-entity p.ae-members code.chg {
  border-color: var(--warn); color: var(--warn); font-weight: 600;
}

/* gloss — 다이어그램 바로 아래 붙는 요소 범례(각주). 그림 속 코드명 노드/화살표를
   한 줄씩 평이하게 풀어, 무맥락 독자가 그림 요소의 뜻을 페이지만 보고 알 수 있게 한다.
   저자는 <ul class="gloss"><li><code>노드명</code> — 평이한 뜻</li>… 로 쓴다. */
ul.gloss {
  margin: 0.4rem 0 1.5rem; padding: 0.7rem 1rem 0.7rem 1.2rem; list-style: none;
  background: var(--surface); border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 8px; font-size: 14.5px;
}
ul.gloss::before {
  content: "이 그림의 요소"; display: block; font-size: 13px; font-weight: 700;
  letter-spacing: 0.03em; color: var(--ink-3); margin-bottom: 0.4rem;
}
ul.gloss li { margin: 0.2rem 0; line-height: 1.6; }
ul.gloss code {
  background: transparent; border: 1px solid var(--line); border-radius: 4px;
  padding: 0.02em 0.3em; font-size: 0.85em; color: var(--ink);
}

/* figure.diagram — 저자가 문서에 그린 인라인 SVG. 색은 전부 위의 변수에서 와서 다크 모드에서도 읽힌다.
   기본은 컬럼 폭에 맞춰 줄어든다(width:100%, height:auto). data-min-width 가 있으면 render.ts 가
   SVG 에 min-width 를 주고 .fig-scroll 안에서 좌우로 스크롤시키며 .fig-hint 가 그 사실을 알린다. */
figure.diagram {
  margin: 1.25rem 0; padding: 12px; background: var(--surface);
  border: 1px solid var(--line); border-radius: 10px; min-width: 0;
}
figure.diagram svg { display: block; width: 100%; max-width: 100%; height: auto; margin-inline: auto; color: var(--ink); }
figure.diagram .fig-scroll { overflow-x: auto; }
figure.diagram .fig-scroll svg { max-width: none; }
figure.diagram .fig-hint { display: none; margin: 0.4rem 0 0; font-size: 13.5px; color: var(--ink-3); }
figure.diagram figcaption { max-width: 760px; margin-top: 0.6rem; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
figure.diagram figcaption .vf { display: block; margin-top: 6px; color: var(--ink-3); }

/* SVG 팔레트: 클래스 이름은 lib/explain-diff-structure.ts 의 DIAGRAM_SVG_CLASSES 와 1:1 이다.
   .focal(이 diff가 바꾼 요소의 강조)은 박스·선 규칙보다 뒤에 와야 둘 다에서 이긴다. */
figure.diagram svg :where(path, rect, circle, ellipse, polygon, polyline, line) { fill: none; stroke: var(--ink-2); }
figure.diagram svg text { font-family: var(--font); font-size: 13px; fill: var(--ink); stroke: none; }
figure.diagram svg .t-b { font-weight: 700; }
figure.diagram svg .t-s { font-size: 12px; fill: var(--ink-2); }
figure.diagram svg .t-m { font-family: var(--mono); font-size: 12px; }
figure.diagram svg .t-ok { fill: var(--ok); }
figure.diagram svg .t-bad { fill: var(--bad); }
figure.diagram svg .m { font-size: 12px; font-weight: 500; fill: var(--ink-2); }
figure.diagram svg .lbl { paint-order: stroke; stroke: var(--surface); stroke-width: 5px; stroke-linejoin: round; }
figure.diagram svg .box { fill: var(--surface); stroke: var(--line-strong); stroke-width: 1.5; }
figure.diagram svg .head { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.5; }
figure.diagram svg .store { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.5; }
figure.diagram svg .diamond { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.5; }
figure.diagram svg .ext { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.5; stroke-dasharray: 5 4; }
figure.diagram svg .group { fill: none; stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 4 4; }
figure.diagram svg .mask { fill: var(--surface); stroke: none; }
figure.diagram svg .act { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.2; }
figure.diagram svg .verdict-ok { fill: var(--ok-bg); stroke: none; }
figure.diagram svg .verdict-bad { fill: var(--bad-bg); stroke: none; }
figure.diagram svg .rel { fill: none; stroke: var(--ink-2); stroke-width: 1.6; }
figure.diagram svg .rel-ok { fill: none; stroke: var(--ok); stroke-width: 2.5; }
figure.diagram svg .rel-bad { fill: none; stroke: var(--bad); stroke-width: 2.5; }
figure.diagram svg .msg { fill: none; stroke: var(--ink-3); stroke-width: 1.4; }
figure.diagram svg .key { stroke: var(--bad); stroke-width: 2; }
figure.diagram svg .focal { stroke: var(--accent); stroke-width: 2; }
figure.diagram svg .ret, figure.diagram svg .ev { stroke-dasharray: 6 5; }
figure.diagram svg .life { stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 3 3; }
figure.diagram svg .stop { fill: none; stroke: var(--bad); stroke-width: 1.6; }
figure.diagram svg .init { fill: var(--ink); stroke: none; }
figure.diagram svg .fin-ring { fill: none; stroke: var(--ink); stroke-width: 1.6; }
figure.diagram svg .mk-mut { fill: var(--ink-3); stroke: none; }
figure.diagram svg .mk-ok { fill: var(--ok); stroke: none; }
figure.diagram svg .mk-bad { fill: var(--bad); stroke: none; }
figure.diagram svg .mk-accent { fill: var(--accent); stroke: none; }
figure.diagram svg .mk-open { fill: none; stroke: var(--ink-3); stroke-width: 1.2; }

@media (max-width: 640px) {
  body { font-size: 15.5px; }
  /* 폰이 그림에 줄 수 있는 폭을 최대로: 좌우 16px 거터만 남기고 figure 안쪽 여백도 줄인다. */
  main { max-width: none; padding-left: 16px; padding-right: 16px; }
  figure.diagram { padding: 8px; }
  .flow { flex-direction: column; }
  .flow-arrow { justify-content: center; transform: rotate(90deg); }
  .compare { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}

@media print {
  body { background: #fff; color: #000; }
  .toc { break-after: page; }
  figure.diagram { break-inside: avoid; }
  figure.diagram .fig-scroll { overflow: visible; }
  figure.diagram .fig-scroll svg { max-width: 100%; min-width: 0 !important; }
  figure.diagram .fig-hint { display: none !important; }
}
`;

function main(): void {
	const argv = process.argv.slice(2);
	const get = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const input = get("in");
	const output = get("out");
	if (!input || !output) {
		process.stderr.write("Usage: render.ts --in <doc.md> --out <doc.html>\n");
		process.exit(1);
	}
	const source = readFileSync(input, "utf8");
	const markdown = source;
	for (const raw of findBackslashEndedCodeSpans(stripFrontmatter(markdown))) {
		process.stderr.write(
			`경고: 인라인 코드 ${stripControlChars(raw)} 가 \\ 로 끝납니다. 코드 안의 \\\` 는 이스케이프가 아니라 코드를 닫습니다. 백틱이 든 코드는 백틱 두 개로 감싸세요 (예: \`\` sql\`…\` \`\`).\n`,
		);
	}
	const title = extractTitle(markdown, basename(input, extname(input)));
	writeFileSync(output, renderToHtml(markdown, title), "utf8");
	process.stdout.write(`${output}\n`);
}

if (import.meta.main) {
	main();
}

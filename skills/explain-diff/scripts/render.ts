#!/usr/bin/env bun
/**
 * explain-diff renderer — markdown source to a self-contained HTML page.
 *
 * The conversion happens here, at build time, and the page it produces runs no
 * JavaScript at all. That is the whole design: an explanation document outlives
 * the session that made it, gets mailed around, opened offline, and printed —
 * and every one of those breaks the moment the page needs a CDN to render
 * itself. A page with no script tag and no external reference cannot rot.
 *
 * Diagrams are authored as inline HTML inside the markdown, so they arrive here
 * already rendered and need no client-side library.
 */
import { readFileSync, writeFileSync } from "fs";
import { marked } from "marked";

/** Heading rows the table of contents is built from. */
interface TocEntry {
	level: number;
	text: string;
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

export function renderToHtml(markdown: string, title: string): string {
	const toc: TocEntry[] = [];
	const seen = new Map<string, number>();

	const renderer = new marked.Renderer();
	renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
		const base = slugify(text);
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		const id = n === 0 ? base : `${base}-${n + 1}`;
		// h2/h3 only: h1 is the document's title, not one of its sections, and
		// listing it as the first table-of-contents entry just points at the top.
		if (depth >= 2 && depth <= 3) toc.push({ level: depth, text, id });
		return `<h${depth} id="${id}">${text}</h${depth}>\n`;
	};

	const bodyHtml = String(marked.parse(markdown, { renderer, async: false }));

	const tocHtml = toc
		.map((e) => `<li class="lv${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
		.join("\n");

	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<nav class="toc" aria-label="목차"><h2>목차</h2><ul>${tocHtml}</ul></nav>
${bodyHtml}
</main>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// One long page with a table of contents, no top-level tabs, responsive by
// default, and readable in either theme. `white-space: pre-wrap` on every code
// container is load-bearing — without it a browser collapses the newlines of a
// styled div and the whole listing arrives as one line.
const STYLE = `
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --rule: #e3e3e3;
  --code-bg: #f6f6f4; --accent: #2b5fa8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --fg: #e6e6e6; --muted: #9aa0a6; --rule: #2e3238;
    --code-bg: #1e2126; --accent: #7aa7e6;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", sans-serif;
}
main { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; }
h1, h2, h3, h4 { line-height: 1.3; margin: 2.5rem 0 0.75rem; }
h1 { font-size: 1.9rem; margin-top: 0; }
h2 { font-size: 1.4rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.35rem; }
h3 { font-size: 1.12rem; }
p, li { overflow-wrap: anywhere; }
a { color: var(--accent); }
blockquote {
  margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--accent);
  background: var(--code-bg); color: var(--muted);
}
pre, code, .code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  white-space: pre-wrap;
}
pre {
  background: var(--code-bg); padding: 0.9rem 1rem; border-radius: 6px;
  overflow-x: auto; font-size: 0.86rem;
}
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.94rem; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--rule); padding: 0.45rem 0.6rem; text-align: left; }
th { background: var(--code-bg); }
img, svg { max-width: 100%; height: auto; }
.toc {
  margin: 0 0 3rem; padding: 1rem 1.25rem; background: var(--code-bg);
  border-radius: 8px; font-size: 0.94rem;
}
.toc h2 { margin: 0 0 0.5rem; font-size: 1rem; border: 0; padding: 0; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc .lv2 { margin-left: 0; }
.toc .lv3 { margin-left: 1.1rem; color: var(--muted); }
@media print {
  body { background: #fff; color: #000; }
  .toc { break-after: page; }
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
	const markdown = readFileSync(input, "utf8");
	const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? "explain-diff").trim();
	writeFileSync(output, renderToHtml(markdown, title), "utf8");
	process.stdout.write(`${output}\n`);
}

if (import.meta.main) {
	main();
}

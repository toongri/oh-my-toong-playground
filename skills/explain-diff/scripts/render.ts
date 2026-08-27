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
 * Diagrams arrive two ways and leave one way: 1D flow strips and before/after
 * cards are authored as sanctioned component markup (classes this file's CSS
 * owns), and 2D structure diagrams are authored as ```mermaid fences that
 * preRenderMermaid bakes into inline SVG at build time. Either way the page
 * ships with zero client-side rendering left to do.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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

const MERMAID_FENCE = /```mermaid\n([\s\S]*?)```/g;

/**
 * Rewrites a mermaid SVG's `width="100%"` root attribute to its viewBox pixel
 * width so a wide diagram renders at natural size and its figure scrolls, rather
 * than the SVG shrinking to the column and collapsing its labels to a few
 * illegible pixels. `width="100%"` is a presentation attribute that CSS
 * `width:auto`/`max-content` cannot reliably override on a percentage-sized SVG,
 * so the width is fixed here at build time from the ground truth already in the
 * markup — the viewBox. Left unchanged when there is no `width="100%"` or no
 * parseable viewBox width (a diagram mmdc already sized in px keeps that size).
 */
export function normalizeSvgWidth(svg: string): string {
	const viewBox = svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/);
	if (!viewBox) return svg;
	const width = Math.ceil(Number(viewBox[1]));
	if (!Number.isFinite(width) || width <= 0) return svg;
	return svg.replace(/(<svg\b[^>]*?)\swidth="100%"/, `$1 width="${width}"`);
}

/**
 * Replaces every ```mermaid fence with an inline SVG before markdown parsing.
 *
 * This is the build-time half of the "no runtime JS" invariant: the page keeps
 * rendering offline and in mail clients precisely because the diagram was
 * rendered HERE, once, rather than by a script the viewer must be able to run.
 * `renderSvg` is injected so tests exercise the wrapping without Chromium; the
 * production caller passes {@link mmdcRenderSvg}.
 */
export function preRenderMermaid(
	markdown: string,
	renderSvg: (source: string, index: number) => string,
): string {
	let index = 0;
	return markdown.replace(MERMAID_FENCE, (_m, source: string) => {
		const i = index;
		index += 1;
		let svg: string;
		try {
			svg = renderSvg(source, i);
		} catch (e) {
			throw new Error(`${i + 1}번째 mermaid 블록 렌더 실패: ${String(e)}\n--- 블록 원문 ---\n${source}`, {
				cause: e,
			});
		}
		return `<figure class="diagram">${normalizeSvgWidth(svg)}</figure>`;
	});
}

/**
 * Renders one mermaid source to SVG through mmdc (real mermaid inside headless
 * Chromium — the same engine the mermaid-render-gate hook uses, so a diagram
 * that passes here is the diagram the reader sees). The id is de-duplicated per
 * block: mmdc names every SVG `my-svg` and its internal stylesheet targets that
 * id, so two untouched diagrams on one page would style each other.
 */
export function mmdcRenderSvg(source: string, index: number): string {
	const dir = mkdtempSync(join(tmpdir(), "explain-diff-mmd-"));
	try {
		const src = join(dir, "block.mmd");
		const out = join(dir, "block.svg");
		const cfg = join(dir, "config.json");
		writeFileSync(src, source, "utf8");
		// mermaid is non-deterministic by default: it mints random element ids and
		// draws shapes with rough.js hand-drawn strokes seeded from a random value,
		// so the SAME source yields different SVG bytes every run. That breaks the
		// render gate, which proves an HTML was built from the current Markdown by
		// re-rendering and byte-comparing — a proof that only holds if this renderer
		// is a deterministic derivation. Pin every randomness source: a fixed id
		// seed, the classic (non-sketch) look, and a fixed rough seed for the shapes
		// (class boxes, dividers) mermaid still draws with rough.js regardless of look.
		writeFileSync(
			cfg,
			JSON.stringify({
				deterministicIds: true,
				deterministicIDSeed: "explain-diff",
				look: "classic",
				handDrawnSeed: 42,
			}),
			"utf8",
		);
		try {
			execFileSync("mmdc", ["-i", src, "-o", out, "-b", "transparent", "-q", "-c", cfg], {
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e) {
			const rec: Record<string, unknown> = {};
			if (e !== null && typeof e === "object") Object.assign(rec, e);
			if (rec["code"] === "ENOENT") {
				throw new Error(
					"mmdc 가 없습니다 — `npm i -g @mermaid-js/mermaid-cli` 후 `npx puppeteer browsers install chrome-headless-shell` 로 설치하세요.",
					{ cause: e },
				);
			}
			const stderr = rec["stderr"];
			throw new Error(stderr instanceof Buffer ? stderr.toString() : String(e), { cause: e });
		}
		return readFileSync(out, "utf8").replaceAll("my-svg", `mmd-${index}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
  --before: #b0563a; --after: #2e7d4f;
  --ae-new: #2e7d4f; --ae-mod: #b8860b; --ae-del: #c0392b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --fg: #e6e6e6; --muted: #9aa0a6; --rule: #2e3238;
    --code-bg: #1e2126; --accent: #7aa7e6;
    --before: #e0937a; --after: #7ec99a;
    --ae-new: #4a9d6f; --ae-mod: #c99a3a; --ae-del: #d05a48;
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
h1, h2, h3, h4, p, li, blockquote, th, td { word-break: keep-all; }

/* --- 승인된 컴포넌트: 저자는 클래스만 쓰고, 시각 언어는 여기 한 곳이 소유한다 --- */
.doc-meta {
  display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; list-style: none;
  margin: 0 0 2rem; padding: 0.8rem 1.1rem; background: var(--code-bg);
  border-radius: 8px; font-size: 0.9rem; color: var(--muted);
}
.doc-meta strong { color: var(--fg); font-weight: 600; }

.flow { display: flex; align-items: stretch; flex-wrap: wrap; gap: 0.4rem; margin: 1.25rem 0; }
.flow-step {
  flex: 1 1 8.5rem; min-width: 0; display: flex; flex-direction: column; justify-content: center;
  padding: 0.6rem 0.55rem; border: 1px solid var(--rule); border-top: 3px solid var(--accent);
  border-radius: 8px; background: var(--code-bg); text-align: center;
  font-size: 0.85rem; line-height: 1.5;
}
.flow-step code { overflow-wrap: anywhere; word-break: break-all; }
.flow-arrow { display: flex; align-items: center; color: var(--muted); }

.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.25rem 0; }
.compare-before, .compare-after {
  border: 1px solid var(--rule); border-radius: 10px; padding: 0.9rem 1rem 1rem; font-size: 0.92rem;
}
.compare-before { border-top: 3px solid var(--before); }
.compare-after { border-top: 3px solid var(--after); }
.compare-before::before, .compare-after::before {
  display: block; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em;
  margin-bottom: 0.35rem;
}
.compare-before::before { content: "BEFORE"; color: var(--before); }
.compare-after::before { content: "AFTER"; color: var(--after); }

.callout {
  margin: 1.25rem 0; padding: 0.8rem 1.1rem; border: 1px solid var(--rule);
  border-left: 3px solid var(--accent); border-radius: 8px;
  background: var(--code-bg); font-size: 0.95rem;
}

/* cf — 변경 하나의 필드 블록. 책임 항목이 각자 한 줄로 서고(붕괴 방지),
   출처는 배지로, 위치 앵커는 산문 밖 회색 슬롯으로 뺀다. 변경종류(data-change)
   배지는 arch-entity 와 같은 색·라벨을 render.ts 가 붙인다 — 저자는 종류만 준다. */
.cf {
  margin: 0.6rem 0 1rem; padding: 0.1rem 0 0.1rem 0.9rem;
  border-left: 2px solid var(--rule);
}
.cf p { margin: 0.3rem 0; font-size: 0.95rem; }
.cf strong { color: var(--fg); font-weight: 650; }
.cf[data-change]::before {
  display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em;
  border-radius: 999px; padding: 0 0.5rem; margin: 0 0 0.35rem; color: #fff;
}
.cf[data-change="new"] { border-left-color: var(--ae-new); }
.cf[data-change="new"]::before { content: "신설"; background: var(--ae-new); }
.cf[data-change="mod"] { border-left-color: var(--ae-mod); }
.cf[data-change="mod"]::before { content: "변경"; background: var(--ae-mod); }
.cf[data-change="del"] { border-left-color: var(--ae-del); }
.cf[data-change="del"]::before { content: "삭제"; background: var(--ae-del); }
.cf-src {
  display: inline-block; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.02em; color: var(--muted); background: var(--code-bg);
  border: 1px solid var(--rule); border-radius: 999px;
  padding: 0 0.5rem; margin: 0 0.15rem; vertical-align: 0.06em;
}
.cf-loc { font-size: 0.78rem; color: var(--muted); margin-top: 0.45rem; }
.cf-loc code { background: none; padding: 0; font-size: inherit; color: inherit; }

/* arch-entity — 아키텍처 노드/동작단위 하나의 구조 카드. cf 와 같은 필드 규칙에
   변경종류 배지(data-change)를 더한다. 색은 render.ts 가 소유한다 — 저자는 종류만 준다.
   컴포넌트 레벨(패키지·책임·인터페이스·변경점)과 경계 블록(한 일·영향 인터페이스)이 함께 쓴다. */
.arch-entity {
  margin: 0.6rem 0 1rem; padding: 0.55rem 0.9rem;
  border: 1px solid var(--rule); border-left: 3px solid var(--rule);
  border-radius: 8px; background: var(--code-bg);
}
.arch-entity p { margin: 0.25rem 0; font-size: 0.93rem; }
.arch-entity strong { color: var(--fg); font-weight: 650; }
.arch-entity[data-change]::before {
  display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em;
  border-radius: 999px; padding: 0 0.5rem; margin: 0 0 0.35rem; color: #fff;
}
.arch-entity[data-change="new"] { border-left-color: var(--ae-new); }
.arch-entity[data-change="new"]::before { content: "신설"; background: var(--ae-new); }
.arch-entity[data-change="mod"] { border-left-color: var(--ae-mod); }
.arch-entity[data-change="mod"]::before { content: "변경"; background: var(--ae-mod); }
.arch-entity[data-change="del"] { border-left-color: var(--ae-del); }
.arch-entity[data-change="del"]::before { content: "삭제"; background: var(--ae-del); }

/* ae-members — 도메인 카드의 핵심 멤버/메소드 칩 행. 산문 나열 대신 스캔 가능한
   칩으로 구조화하고, 이번 diff가 추가/변경한 멤버는 class="chg"로 변경색을 입힌다. */
.arch-entity p.ae-members code {
  display: inline-block; margin: 0.12rem 0.18rem 0.12rem 0; padding: 0.05rem 0.55rem;
  border: 1px solid var(--rule); border-radius: 999px; font-size: 0.85rem;
  background: transparent;
}
.arch-entity p.ae-members code.chg {
  border-color: var(--ae-mod); color: var(--ae-mod); font-weight: 600;
}

/* mermaid SVG는 밝은 테마 색으로 구워지므로, 다크 모드에서도 흰 카드 위에 놓는다. */
figure.diagram {
  margin: 1.25rem 0; padding: 1rem; background: #ffffff;
  border: 1px solid var(--rule); border-radius: 10px; overflow-x: auto;
}
/* A wide diagram (viewBox wider than the column) must scroll at natural size, not
   shrink to fit. mmdc emits width="100%", which downscales the whole SVG and
   collapses 16px labels to a few illegible pixels while figure's overflow-x never
   fires. normalizeSvgWidth (below) rewrites that attribute to the viewBox's pixel
   width, so max-width:none here lets the SVG keep its natural width and the figure
   scrolls instead. A diagram narrower than the column stays its own size, centered
   by margin:auto. */
figure.diagram svg { max-width: none; height: auto; display: block; margin: 0 auto; }
figure.diagram figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 0.6rem; text-align: center; }

@media (max-width: 640px) {
  .flow { flex-direction: column; }
  .flow-arrow { justify-content: center; transform: rotate(90deg); }
  .compare { grid-template-columns: 1fr; }
}

@media print {
  body { background: #fff; color: #000; }
  .toc { break-after: page; }
  figure.diagram svg { max-width: 100%; }
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
	const markdown = preRenderMermaid(readFileSync(input, "utf8"), mmdcRenderSvg);
	const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? "explain-diff").trim();
	writeFileSync(output, renderToHtml(markdown, title), "utf8");
	process.stdout.write(`${output}\n`);
}

if (import.meta.main) {
	main();
}

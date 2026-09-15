#!/usr/bin/env bun
/**
 * explain-diff renderer — markdown source to a self-contained HTML page.
 *
 * The conversion happens here, at build time, and the page it produces needs no
 * JavaScript to render. That is the whole design: an explanation document outlives
 * the session that made it, gets mailed around, opened offline, and printed —
 * and every one of those breaks the moment the page needs a CDN to render
 * itself. A page with no external reference, whose content renders with no script
 * running, cannot rot. The one script it carries ({@link ZOOM_SCRIPT}) only adds an
 * ESC/Enter shortcut to the zoom overlay; strip it and every pixel still renders and
 * the overlay still closes by button or click-off. Enhancement, never dependency.
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
	return (
		svg
			.replace(/(<svg\b[^>]*?)\swidth="100%"/, `$1 width="${width}"`)
			// mmdc bakes an inline `max-width:<px>` on the root <svg>. An inline style beats a
			// stylesheet rule, so both `.dz-scroll svg{max-width:100%}` (fit) and `.dz-view …
			// svg{max-width:none}` (zoom) are overridden and the SVG renders at natural width,
			// overflowing its figure card into the page background (the "broken diagram"). Strip
			// it so the stylesheet owns the width in both states.
			.replace(/(<svg\b[^>]*?style="[^"]*?)max-width:\s*[\d.]+px;?\s*/, "$1")
	);
}

/**
 * Wraps a pre-rendered mermaid SVG in a figure carrying a CSS-only zoom control.
 *
 * The page runs no JavaScript (the self-containment invariant), so zoom is a
 * checkbox toggle: unchecked, `.dz-scroll svg` fits its column (max-width:100%),
 * so the diagram section no longer forces horizontal page scroll; checked, the
 * `:checked ~ .dz-view` rule in STYLE turns `.dz-view` into a full-viewport
 * overlay showing the SVG at natural width, scrollable and legible. `index` keys
 * the checkbox id so diagrams on one page toggle independently. The ⤢ button sits
 * top-right of each figure; ✕ closes the overlay, and so does clicking anywhere off
 * the diagram — the full-viewport `.dz-backdrop` label is a second control for the
 * same checkbox, so any click on the dark area outside the SVG card unchecks it.
 */
export function zoomableFigure(svg: string, index: number): string {
	const id = `dz-${index}`;
	return (
		`<figure class="diagram">` +
		`<input type="checkbox" id="${id}" class="dz-toggle" aria-hidden="true">` +
		`<label for="${id}" class="dz-btn dz-open" title="확대" aria-label="확대">⤢</label>` +
		`<div class="dz-view">` +
		`<label for="${id}" class="dz-backdrop" aria-hidden="true"></label>` +
		`<label for="${id}" class="dz-btn dz-close" title="닫기" aria-label="닫기">✕</label>` +
		`<div class="dz-scroll">${svg}</div>` +
		`</div>` +
		`</figure>`
	);
}

/**
 * Inserts a line break before the dot in long dotted labels so mermaid wraps a
 * method-style label at its natural boundary — `ProductRepository.update` renders
 * as `ProductRepository` / `.update`, two clean lines in a compact node — instead
 * of one very wide node OR a mid-word character break (`Produ` / `ctRepository`),
 * which is what mermaid does to a long single token on its own.
 *
 * Only double-quoted labels at or above the length threshold and containing a
 * method-style dot are touched; short labels, non-method dots (`3.14`), dotless
 * tokens (kept on one line by `flowchart.wrappingWidth`), and labels the author
 * already broke with `<br/>` are left exactly as written. The transform is a pure,
 * deterministic string rewrite, so the render stays byte-reproducible for the gate.
 */
export function softWrapLabels(source: string): string {
	const THRESHOLD = 22;
	return source.replace(/"([^"\n]+)"/g, (whole, label: string) => {
		if (
			label.length < THRESHOLD ||
			!label.includes(".") ||
			label.includes("<br") ||
			/^[a-z][a-z\d+.-]*:\/\//i.test(label)
		)
			return whole;
		// Break only at a dot that joins two identifier characters (a method/property
		// separator), never inside a number or at a trailing dot.
		return `"${label.replace(/([A-Za-z0-9)\]])\.([A-Za-z_])/g, "$1<br/>.$2")}"`;
	});
}

/**
 * Replaces every ```mermaid fence with an inline SVG before markdown parsing.
 *
 * This is the build-time half of the "content renders without a script running"
 * invariant: the page keeps rendering offline and in mail clients precisely because
 * the diagram was rendered HERE, once, rather than by a script the viewer must run.
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
		return zoomableFigure(normalizeSvgWidth(svg), i);
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
		writeFileSync(src, softWrapLabels(source), "utf8");
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
				// Label clipping fix (font-independent). mermaid's default htmlLabels:true
				// bakes node labels as <foreignObject> HTML with a FIXED pixel width measured
				// in the render font; a viewer lacking that font (iOS/iCloud has no
				// "trebuchet ms") re-lays the HTML wider and the fixed box CLIPS the overflow —
				// text vanishes. htmlLabels:false makes labels SVG <text> (no clip region, so a
				// wide font overflows the border but is never hidden). fontFamily pins a
				// near-universal stack so render and viewer glyph widths match.
				// flowchart.wrappingWidth keeps a long single-token identifier on one line
				// instead of breaking it mid-word.
				htmlLabels: false,
				fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
				flowchart: { htmlLabels: false, wrappingWidth: 1000 },
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
${ZOOM_SCRIPT}
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
/* 본문 폭 — 좁은 고정 컬럼(46rem)은 다이어그램·카드가 잘리는 실측 결함이었다.
   뷰포트에 반응해 최대 92rem(≈1472px)까지 쓰고, 창이 좁아지면 94vw로 따라간다. */
main { max-width: min(92rem, 94vw); margin: 0 auto; padding: 2rem 1.25rem 6rem; }
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

/* gloss — 다이어그램 바로 아래 붙는 요소 범례(각주). 그림 속 코드명 노드/화살표 스타일을
   한 줄씩 평이하게 풀어, 무맥락 독자가 그림 요소의 뜻을 페이지만 보고 알 수 있게 한다.
   저자는 <ul class="gloss"><li><code>노드명</code> — 평이한 뜻</li>… 로 쓴다. */
ul.gloss {
  margin: 0.4rem 0 1.5rem; padding: 0.7rem 1rem 0.7rem 1.2rem; list-style: none;
  background: var(--code-bg); border: 1px solid var(--rule);
  border-left: 3px solid var(--accent); border-radius: 8px; font-size: 0.9rem;
}
ul.gloss::before {
  content: "이 그림의 요소"; display: block; font-size: 0.74rem; font-weight: 700;
  letter-spacing: 0.03em; color: var(--muted); margin-bottom: 0.4rem;
}
ul.gloss li { margin: 0.2rem 0; line-height: 1.6; }
ul.gloss code {
  background: transparent; border: 1px solid var(--rule); border-radius: 4px;
  padding: 0.02em 0.3em; font-size: 0.85em; color: var(--fg);
}

/* mermaid SVG는 밝은 테마 색으로 구워지므로, 다크 모드에서도 흰 카드 위에 놓는다.
   기본은 컬럼 폭에 맞춰 축소해 페이지 가로 스크롤을 없애고, 우측 상단 확대 버튼이
   자연 크기 오버레이를 연다 — 넘겨보며 읽던 넓은 다이어그램을 한눈에 + 필요 시 크게. */
figure.diagram {
  position: relative;
  margin: 1.25rem 0; padding: 1rem; background: #ffffff;
  border: 1px solid var(--rule); border-radius: 10px;
}
/* 무-JS 확대: 체크박스 토글(라벨 + :checked 형제 선택자). 외부 참조·스크립트 0 유지. */
figure.diagram .dz-toggle { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
figure.diagram .dz-btn {
  position: absolute; top: 0.55rem; right: 0.55rem; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  width: 2rem; height: 2rem; border: 1px solid var(--rule); border-radius: 6px;
  background: var(--bg); color: var(--fg); font-size: 1.05rem; line-height: 1;
  cursor: pointer; user-select: none;
}
figure.diagram .dz-btn:hover { background: var(--code-bg); }
figure.diagram .dz-close { display: none; }
figure.diagram .dz-backdrop { display: none; }
/* 기본: 컬럼 폭에 맞춤(다운스케일) — 넓은 다이어그램이 페이지 가로 스크롤을 만들지 않는다.
   자연 폭이 필요하면 확대 버튼으로 오버레이를 연다(아래). */
figure.diagram .dz-scroll svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
/* 확대 상태: 전체 뷰포트 오버레이 + 자연 크기(normalizeSvgWidth 가 viewBox px 로 고정) + 내부 스크롤. */
figure.diagram .dz-toggle:checked ~ .dz-open { display: none; }
figure.diagram .dz-toggle:checked ~ .dz-view {
  position: fixed; inset: 0; z-index: 1000; margin: 0;
  padding: 3rem 1rem 1rem; background: rgba(0, 0, 0, 0.85); overflow: auto;
}
/* 바깥 클릭으로 닫기: 뷰포트를 덮는 backdrop 라벨이 같은 체크박스의 두 번째 컨트롤. SVG 카드
   (.dz-scroll)는 그 위(z-index)로 올려 카드 클릭은 닫히지 않고, 어두운 바깥만 닫힌다. */
figure.diagram .dz-toggle:checked ~ .dz-view .dz-backdrop {
  display: block; position: fixed; inset: 0; z-index: 0; cursor: zoom-out;
}
figure.diagram .dz-toggle:checked ~ .dz-view .dz-close { display: flex; position: fixed; top: 1rem; right: 1rem; z-index: 2; }
figure.diagram .dz-toggle:checked ~ .dz-view .dz-scroll {
  position: relative; z-index: 1;
  width: max-content; max-width: none; margin: 0 auto;
  background: #ffffff; border-radius: 10px; padding: 1.25rem;
}
figure.diagram .dz-toggle:checked ~ .dz-view .dz-scroll svg { max-width: none; }
figure.diagram figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 0.6rem; text-align: center; }

@media (max-width: 640px) {
  .flow { flex-direction: column; }
  .flow-arrow { justify-content: center; transform: rotate(90deg); }
  .compare { grid-template-columns: 1fr; }
}

@media print {
  body { background: #fff; color: #000; }
  .toc { break-after: page; }
  figure.diagram .dz-btn { display: none; }
  figure.diagram .dz-backdrop { display: none; }
  figure.diagram .dz-toggle:checked ~ .dz-view { position: static; background: none; padding: 0; overflow: visible; }
  figure.diagram .dz-toggle:checked ~ .dz-view .dz-scroll { width: auto; max-width: 100%; }
  figure.diagram .dz-scroll svg,
  figure.diagram .dz-toggle:checked ~ .dz-view .dz-scroll svg { max-width: 100%; }
}
`;

/**
 * The page's ONLY script: a keyboard convenience for the zoom overlay — ESC or
 * Enter closes whichever diagram is open. It is deliberately the one exception to
 * the no-runtime-JS design: it enhances, never enables. With it stripped or
 * blocked (a mail client, a strict CSP), the content still renders, diagrams still
 * zoom, and the overlay still closes via the ✕ button and the click-off backdrop —
 * all CSS. Only the keyboard shortcut is lost. Static and deterministic, so the
 * render stays byte-reproducible for checkRenderOutput.
 */
const ZOOM_SCRIPT = `<script>
addEventListener("keydown",function(e){
if(e.key!=="Escape"&&e.key!=="Enter")return;
var o=document.querySelectorAll(".dz-toggle:checked");
if(!o.length)return;
e.preventDefault();
for(var i=0;i<o.length;i++)o[i].checked=false;
});
</script>`;

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

import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import { DIAGRAM_SVG_CLASSES } from "@lib/explain-diff-structure";
import { renderToHtml, slugify } from "./render";
import { extractTitle, stripControlChars } from "./render";

const DOC = `# 트리 선택기 수평 패닝

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

## Change Group 1: 뷰포트를 도입한다

<div class="fig"><span>before</span><span>after</span></div>

\`\`\`ts
const offset = clamp(anchor - width, 0, max);
\`\`\`
`;

describe("외부 참조·스크립트 없음", () => {
	const html = renderToHtml(DOC, "제목");

	test("외부 참조가 하나도 없다 — 오프라인·인쇄·메일 전달에서 깨지지 않는다", () => {
		expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
		expect(html).not.toMatch(/href\s*=\s*["']https?:\/\/[^"']*\.(css|js)/i);
		expect(html).not.toMatch(/<link\b/i);
	});

	test("스크립트가 하나도 없다 — 페이지는 무-JS 로 렌더된다", () => {
		expect(html).not.toMatch(/<script/i);
	});

	test("CSS 는 인라인으로 들어간다", () => {
		expect(html).toContain("<style>");
	});
});

describe("코드 블록", () => {
	test("`<pre>` 로 감싸고 줄바꿈이 보존되는 CSS 를 갖는다", () => {
		const html = renderToHtml(DOC, "제목");
		expect(html).toContain("<pre>");
		expect(html).toMatch(/white-space:\s*pre-wrap/);
	});
});

describe("목차", () => {
	test("h2/h3 가 목차에 실리고 앵커로 연결된다", () => {
		const html = renderToHtml(DOC, "제목");
		expect(html).toContain('<nav class="toc"');
		expect(html).toContain("#background");
		expect(html).toMatch(/<h2 id="background">/);
	});

	test("h1 은 목차에 넣지 않는다 — 문서 제목이지 절이 아니다", () => {
		const html = renderToHtml(DOC, "제목");
		expect(html).not.toMatch(/<a href="#트리-선택기-수평-패닝">/);
	});

	test("같은 제목이 두 번 나와도 앵커가 충돌하지 않는다", () => {
		const html = renderToHtml("## 같은 제목\n\n## 같은 제목\n", "t");
		expect(html).toContain('id="같은-제목"');
		expect(html).toContain('id="같은-제목-2"');
	});
});

describe("인라인 HTML 그림", () => {
	test("마크다운 안의 HTML 조각이 그대로 살아 나온다", () => {
		const html = renderToHtml(DOC, "제목");
		expect(html).toContain('<div class="fig">');
	});
});

describe("slugify", () => {
	test("한글 제목이 빈 앵커로 뭉개지지 않는다", () => {
		expect(slugify("깊은 배경")).toBe("깊은-배경");
	});

	test("백틱과 기호를 털어낸다", () => {
		expect(slugify("`lib/state-lock.ts` 변경")).toBe("lib-state-lock-ts-변경");
	});

	test("기호만 있는 제목도 앵커를 갖는다", () => {
		expect(slugify("!!!")).toBe("section");
	});
});

describe("테마", () => {
	test("다크 모드 대응이 들어 있다", () => {
		expect(renderToHtml(DOC, "제목")).toContain("prefers-color-scheme: dark");
	});
});

describe("컴포넌트 CSS — 렌더러가 시각 언어를 소유한다", () => {
	const html = renderToHtml(DOC, "제목");

	test("승인된 컴포넌트 클래스의 CSS 가 내장돼 있다", () => {
		for (const cls of [".flow", ".flow-step", ".flow-arrow", ".compare", ".callout", ".doc-meta", ".cf", ".cf-src", ".cf-loc", ".arch-entity"]) {
			expect(html).toContain(cls);
		}
	});

	test("arch-entity 변경종류 배지가 세 종류(신설/변경/삭제)의 색을 CSS 로 갖는다", () => {
		// 컴포넌트/경계 블록의 arch-entity 는 data-change 로 변경종류를 나르고,
		// 렌더러가 배지 텍스트와 색을 붙인다 — 저자는 문서에 색을 발명하지 않는다.
		for (const kind of ["new", "mod", "del"]) {
			expect(html).toContain(`.arch-entity[data-change="${kind}"]`);
		}
	});

	test("cf 필드는 각 <p> 가 세로로 분리되는 규칙을 갖는다 — 한 문단 붕괴 방지", () => {
		// 파일 블록의 6개 필드가 한 <p> 로 뭉치던 붕괴를 CSS 로 막는다.
		expect(html).toMatch(/\.cf\s+p\s*\{[^}]*margin/);
	});

	test("figure.diagram 스타일이 내장돼 있다 — 다크 모드에서도 다이어그램이 읽힌다", () => {
		expect(html).toContain("figure.diagram");
	});

	test("ul.gloss 각주 상자 스타일이 내장돼 있다 — 다이어그램 밑 '이 그림의 요소'", () => {
		// 그림 속 코드명 노드/화살표를 한 줄씩 풀어 무맥락 독자가 페이지만 보고 알게 한다.
		// deep-interview/prometheus 렌더러엔 이미 있고 explain-diff 에만 없던 각주 상자.
		expect(html).toContain("ul.gloss");
		expect(html).toContain('content: "이 그림의 요소"');
	});
});


// ---------------------------------------------------------------------------
// 다이어그램 figure — 문서에 직접 쓴 인라인 SVG 가 그대로 통과하고, 페이지 CSS 가 색·크기를 소유한다

const FIGURE = `<figure class="diagram" data-kind="flow">
<svg viewBox="0 0 340 120" role="img" aria-label="요청은 게이트웨이를 지나 서비스로 간다.">
  <!-- 열: x=16, 행: y=24 -->
  <rect class="box" x="16" y="24" width="120" height="40" rx="8"/>
  <text class="t-b" x="28" y="48">게이트웨이 $& $1</text>

  <path class="rel" d="M136 44 H200"/>
    <text class="t-s lbl" x="150" y="36">요청</text>
</svg>
<figcaption><b>그림 1.</b> 요청 흐름</figcaption>
</figure>`;

describe("다이어그램 figure — 블록 통과", () => {
	const html = renderToHtml(`# T\n\n${FIGURE}\n\n뒤 문단\n`, "t");

	test("figure 블록은 <svg> 여는 태그의 크기 상한 style 하나만 빼고 바이트 그대로 통과한다 — 빈 줄·들여쓰기·주석·$ 패턴 포함", () => {
		expect(html).not.toContain(FIGURE);
		expect(html.replace(/ style="max-width:\d+px"/, "")).toContain(FIGURE);
	});

	test("폭 상한은 viewBox 폭의 1.5배다 — 좁게 그린 그림이 넓은 화면에서 3배로 커지지 않는다", () => {
		expect(html).toContain('<svg viewBox="0 0 340 120" role="img" aria-label="요청은 게이트웨이를 지나 서비스로 간다." style="max-width:510px">');
	});

	test("viewBox 가 없으면 상한을 붙이지 않는다", () => {
		expect(renderToHtml(FIGURE.replace('viewBox="0 0 340 120" ', ""), "t")).not.toContain('style="max-width:');
	});

	test("figure 안의 빈 줄 뒤 들여쓴 줄이 코드 블록이나 문단으로 바뀌지 않는다", () => {
		expect(html).not.toContain("<pre>");
		expect(html).not.toContain("<p>  <path");
		expect(html).toContain("<p>뒤 문단</p>");
	});

	test("문단 바로 아래에 붙은 figure 도 블록으로 통과한다", () => {
		const out = renderToHtml(`앞 문단\n${FIGURE}\n`, "t");
		expect(out).toContain("<p>앞 문단</p>");
		expect(out).toContain('<figure class="diagram" data-kind="flow">');
		expect(out).toContain("<figcaption><b>그림 1.</b> 요청 흐름</figcaption>");
	});

	test("코드 펜스 안의 figure 예시는 이스케이프된 코드로 남는다", () => {
		const out = renderToHtml('```html\n<figure class="diagram" data-kind="flow"></figure>\n```\n', "t");
		expect(out).toContain("&lt;figure");
		expect(out).not.toContain('<figure class="diagram"');
	});

	test("figure 가 제목 추출·목차를 흐트러뜨리지 않는다", () => {
		expect(extractTitle(`${FIGURE}\n\n# 진짜 제목\n`, "fb")).toBe("진짜 제목");
		const out = renderToHtml(`# T\n\n${FIGURE}\n\n## 뒤 절\n`, "t");
		expect(out).toContain('<a href="#뒤-절">뒤 절</a>');
	});

	test("같은 입력은 같은 바이트를 낸다 — 렌더 게이트의 재현 비교 전제", () => {
		expect(renderToHtml(`# T\n\n${FIGURE}\n`, "t")).toBe(renderToHtml(`# T\n\n${FIGURE}\n`, "t"));
	});
});

describe("다이어그램 figure — data-min-width 자체 스크롤", () => {
	const wide = FIGURE.replace('data-kind="flow"', 'data-kind="flow" data-min-width="760"');
	const html = renderToHtml(`# T\n\n${wide}\n`, "t");

	test("SVG 가 min-width 를 갖는 키보드 접근 가능한 스크롤 영역 안에 놓인다", () => {
		expect(html).toContain('<div class="fig-scroll" tabindex="0" role="region" aria-label="그림, 좌우 스크롤">');
		expect(html).toContain('style="min-width:760px"');
		expect(html).toMatch(/<\/svg><\/div><p class="fig-hint" data-min="760">그림은 좌우로 밀어서 볼 수 있어요\.<\/p>/);
	});

	test("스크롤 힌트는 그 폭이 넘치는 뷰포트에서만 보인다 — 폭마다 중단점이 하나", () => {
		expect(html).toMatch(/@media \(max-width: \d+px\) \{ figure\.diagram \.fig-hint\[data-min="760"\] \{ display: block; \} \}/);
		const two = renderToHtml(`${wide}\n\n${wide.replace("760", "500")}\n\n${wide}\n`, "t");
		expect((two.match(/\.fig-hint\[data-min="760"\] \{ display: block/g) ?? []).length).toBe(1);
		expect((two.match(/\.fig-hint\[data-min="500"\] \{ display: block/g) ?? []).length).toBe(1);
	});

	test("data-min-width 가 없는 figure 에는 스크롤 영역도 힌트도 없다", () => {
		const plain = renderToHtml(`# T\n\n${FIGURE}\n`, "t");
		expect(plain).not.toContain('class="fig-scroll"');
		expect(plain).not.toContain('<p class="fig-hint"');
		expect(plain).not.toContain("data-min=");
	});

	test("힌트 줄은 기본이 숨김이고 인쇄에서도 숨는다", () => {
		expect(html).toMatch(/figure\.diagram \.fig-hint \{ display: none;/);
		expect(html.split("@media print", 2)[1]).toMatch(/\.fig-hint \{ display: none !important; \}/);
	});
});

describe("figure.diagram CSS — 라이트·다크에서 읽히고 폭에 맞춰 줄어든다", () => {
	const html = renderToHtml(DOC, "제목");
	const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

	test("SVG 는 컬럼 폭에 맞춰 줄어든다 — width:100%, max-width:100%, height:auto", () => {
		expect(css).toMatch(/figure\.diagram svg \{[^}]*width: 100%;[^}]*max-width: 100%;[^}]*height: auto;[^}]*margin-inline: auto;/);
	});

	test("figure 배경과 SVG 색은 모두 토큰이다 — 리터럴 색이 없다", () => {
		expect(css).toMatch(/figure\.diagram \{[^}]*background: var\(--surface\)/);
		const figureRules = css.split("\n").filter((line) => line.startsWith("figure.diagram"));
		expect(figureRules.length).toBeGreaterThan(30);
		for (const line of figureRules) expect(line).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
	});

	test("승인된 SVG 클래스 전부에 CSS 규칙이 있다 — 없는 클래스는 스타일 없는 도형이 된다", () => {
		for (const cls of DIAGRAM_SVG_CLASSES) {
			expect(css).toMatch(new RegExp(`figure\\.diagram (?:svg |figcaption )?[^{]*\\.${cls.replace(/-/g, "\\-")}\\b`));
		}
	});

	test("html-report 토큰이 맨 :root 에 정의되고 다크 값이 두 방식으로 다시 정의된다", () => {
		expect(css).toMatch(/:root \{[^}]*--surface: #FFFFFF;[^}]*--ink: #141821;[^}]*--line-strong: #98A0B3;[^}]*--ok-bg:/);
		expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{[^}]*--ink: #E8EBF1;/);
		expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--ink: #E8EBF1;/);
		expect(css).toMatch(/body \{[^}]*background: var\(--bg\);/);
	});

	test("글꼴과 한글 줄바꿈은 html-report 타이포 규칙을 따른다", () => {
		expect(css).toMatch(/--font: "IBM Plex Sans KR", "Apple SD Gothic Neo"/);
		expect(css).toMatch(/body \{[^}]*font: 16px\/1.75 var\(--font\);[^}]*word-break: keep-all; overflow-wrap: break-word;/);
		expect(css).toMatch(/h1 \{ font-size: clamp\(30px, 6vw, 46px\);/);
		expect(css).toMatch(/figure\.diagram svg text \{[^}]*font-size: 13px;/);
	});

	test("본문 폭은 뷰포트 반응형이다 — 46rem 고정 컬럼은 다이어그램이 잘리는 결함이었다", () => {
		expect(html).toMatch(/main\s*\{[^}]*max-width:\s*min\(/);
		expect(html).not.toMatch(/main\s*\{[^}]*max-width:\s*46rem/);
	});

	test("인쇄에서는 figure 가 쪼개지지 않고 스크롤 영역이 펼쳐진다", () => {
		const printCss = css.split("@media print", 2)[1] ?? "";
		expect(printCss).toContain("break-inside: avoid");
		expect(printCss).toMatch(/\.fig-scroll \{ overflow: visible; \}/);
	});

	test("이전 확대 오버레이 CSS·스크립트는 없다", () => {
		expect(html).not.toMatch(/dz-(?:toggle|btn|view|scroll|backdrop)/);
		expect(html).not.toContain("<script");
	});
});

// ---------------------------------------------------------------------------
// 인라인 마크다운 — 제목·접힘 제목이 본문과 같은 서식으로 나오고, 코드 안 `\`` 실수를 알린다

import { findBackslashEndedCodeSpans } from "./render";

describe("제목의 인라인 마크다운", () => {
	const html = renderToHtml("# T\n\n## `foo` 와 **굵게** & 끝\n", "t");

	test("코드·굵게가 태그로 바뀌고 & 는 이스케이프된다", () => {
		expect(html).toContain('<h2 id="foo-와-굵게-끝"><code>foo</code> 와 <strong>굵게</strong> &amp; 끝</h2>');
	});

	test("목차 항목도 같은 서식으로 나온다 — 백틱·별표가 글자로 남지 않는다", () => {
		expect(html).toContain('<a href="#foo-와-굵게-끝"><code>foo</code> 와 <strong>굵게</strong> &amp; 끝</a>');
	});
});

describe("접힘 제목(summary)의 인라인 마크다운", () => {
	test("<summary> 안의 백틱이 <code> 로 바뀐다", () => {
		const html = renderToHtml("<details><summary>TODO 2 — `findBy` 거르기</summary>\n\n- 본문\n\n</details>\n", "t");
		expect(html).toContain("<summary>TODO 2 — <code>findBy</code> 거르기</summary>");
	});
});

describe("findBackslashEndedCodeSpans", () => {
	test("`\\`` 로 코드를 닫아 버린 인라인 코드를 찾는다", () => {
		expect(findBackslashEndedCodeSpans("참조: `check(sql\\`…\\`)` 문법.")).toEqual(["`check(sql\\`"]);
	});

	test("백틱 두 개로 감싼 올바른 코드는 찾지 않는다", () => {
		expect(findBackslashEndedCodeSpans("참조: ``check(sql`…`)`` 문법.")).toEqual([]);
	});
});

describe("물결표(~) 범위 표기 — 한 개짜리는 취소선이 아니다", () => {
	test("문단의 1~3 와 4~6 은 물결표를 그대로 남긴다", () => {
		const html = renderToHtml("# T\n\n범위 1~3 와 4~6 입니다.\n", "t");
		expect(html).toContain("<p>범위 1~3 와 4~6 입니다.</p>");
		expect(html).not.toContain("<del>");
	});

	test("제목과 목차 항목도 물결표를 남긴다", () => {
		const html = renderToHtml("# T\n\n## Wave 1~3 와 4~6\n", "t");
		expect(html).not.toContain("<del>");
		expect(html).toContain(">Wave 1~3 와 4~6</h2>");
		expect(html).toMatch(/<a href="#[^"]*">Wave 1~3 와 4~6<\/a>/);
	});

	test("<summary> 안에서도 물결표를 남긴다", () => {
		const html = renderToHtml("<details><summary>태스크 1~3 와 4~6</summary>\n\n- 본문\n\n</details>\n", "t");
		expect(html).toContain("<summary>태스크 1~3 와 4~6</summary>");
		expect(html).not.toContain("<del>");
	});

	test("물결표 두 개짜리는 여전히 취소선이다", () => {
		expect(renderToHtml("# T\n\n~~취소~~\n", "t")).toContain("<del>취소</del>");
		expect(renderToHtml("<details><summary>~~취소~~</summary>\n\n- a\n\n</details>\n", "t")).toContain(
			"<summary><del>취소</del></summary>",
		);
	});
});

describe("HTML 블록 바로 아래에 쓴 마크다운", () => {
	test("<summary> 줄 바로 아래의 목록이 목록으로 렌더된다", () => {
		const html = renderToHtml("# T\n\n<details>\n<summary>T</summary>\n- item **two**\n\n</details>\n", "t");
		expect(html).toContain("<li>item <strong>two</strong></li>");
		expect(html).toContain("</details>");
		expect(html).not.toContain("- item");
	});

	test("<div> 안의 마크다운 줄이 렌더된다", () => {
		const html = renderToHtml('# T\n\n<div class="callout">\n**bold** text\n</div>\n', "t");
		expect(html).toContain("<strong>bold</strong> text");
		expect(html).toContain('<div class="callout">');
		expect(html).toContain("</div>");
	});

	test("다이어그램 figure 바로 아래의 범례 줄이 렌더된다", () => {
		const md = `# T\n\n${FIGURE}\n**범례** \`x\`\n`;
		const html = renderToHtml(md, "t");
		expect(html).toContain("<strong>범례</strong> <code>x</code>");
		expect(html).toContain('<figure class="diagram" data-kind="flow">');
	});

	test("나뉜 뒤쪽의 <summary> 와 제목도 인라인 렌더·앵커를 유지한다", () => {
		const html = renderToHtml("# T\n\n<div>\n**a**\n<details><summary>`k` 1~2</summary>\n\n## 뒤 제목\n", "t");
		expect(html).toContain("<strong>a</strong>");
		expect(html).toContain("<summary><code>k</code> 1~2</summary>");
		expect(html).toContain('<h2 id="뒤-제목">뒤 제목</h2>');
		expect(html).toContain('<a href="#뒤-제목">뒤 제목</a>');
	});

	test("모든 줄이 <로 시작하는 블록은 그대로 둔다", () => {
		const block = '<div class="flow">\n<div class="flow-step">a</div>\n<div class="flow-step">b</div>\n</div>';
		const html = renderToHtml(`# T\n\n${block}\n`, "t");
		expect(html).toContain(block);
	});

	test("여는 태그가 여러 줄이어도 쪼개지 않는다", () => {
		const block = '<div\n  class="x">\n</div>';
		expect(renderToHtml(`# T\n\n${block}\n`, "t")).toContain(block);
	});

	test("<pre> 원문 블록은 < 로 시작하지 않는 줄이 있어도 건드리지 않는다", () => {
		const block = "<pre>\n**not bold**\n- not list\n</pre>";
		const html = renderToHtml(`# T\n\n${block}\n`, "t");
		expect(html).toContain(block);
		expect(html).not.toContain("<strong>not bold</strong>");
	});

	test("탭으로 들여쓴 본문은 코드 블록이 되지 않고 원문 그대로 남는다", () => {
		const html = renderToHtml('# T\n\n<callout icon="📌" color="gray_bg">\n\t**기준** `main`\n\t본문\n</callout>\n', "t");
		expect(html).not.toContain("<pre>");
		expect(html).not.toContain("<code>**");
		expect(html).toContain("**기준**");
	});

	test("공백 4칸으로 들여쓴 본문도 코드 블록이 되지 않는다", () => {
		const html = renderToHtml("# T\n\n<div>\n    **a**\n</div>\n", "t");
		expect(html).not.toContain("<pre>");
		expect(html).toContain("**a**");
	});

	test("공백+탭 혼합 들여쓰기도 코드 블록이 되지 않는다", () => {
		const html = renderToHtml("# T\n\n<div>\n \t**a**\n</div>\n", "t");
		expect(html).not.toContain("<pre>");
	});

	test("공백 1~3칸 들여쓴 마크다운 줄은 여전히 렌더된다", () => {
		const html = renderToHtml("# T\n\n<div>\n  **a** text\n</div>\n", "t");
		expect(html).toContain("<strong>a</strong>");
	});

	test("들여쓴 줄은 건너뛰고 뒤의 후보 줄에서 나눈다", () => {
		const html = renderToHtml("# T\n\n<div>\n\tx\n<span>s</span>\n**b**\n</div>\n", "t");
		expect(html).toContain("<strong>b</strong>");
		expect(html).not.toContain("<pre>");
	});
});

describe("잔여 결함 수정 — 목차·제목·변환 경계", () => {
	const bodyOf = (md: string) => renderToHtml(md, "t");
	const tocOf = (html: string) => html.match(/<nav class="toc"[\s\S]*?<\/nav>/)?.[0] ?? "";

	test("제목의 링크는 본문에선 유지되고 목차 항목에선 안쪽 글자만 남는다 — <a> 안에 <a> 없음", () => {
		const html = bodyOf("# T\n\n## See [docs](https://x.y) now\n");
		expect(html).toContain('<h2 id="see-docs-https-x-y-now">See <a href="https://x.y">docs</a> now</h2>');
		expect(tocOf(html)).toContain('<a href="#see-docs-https-x-y-now">See docs now</a>');
		expect(tocOf(html)).not.toMatch(/<a [^>]*>[^<]*<a /);
	});

	test("강조 안에 든 링크도 목차에서 풀린다", () => {
		expect(tocOf(bodyOf("# T\n\n## **[a](u)** b\n"))).toContain('<a href="#a-u-b"><strong>a</strong> b</a>');
	});

	test("제목의 인라인 HTML 은 글자로 보인다 — 본문과 목차 모두", () => {
		const html = bodyOf("# T\n\n## Promise<void> 반환\n\n### `abc` — fix: <details> 접힘\n");
		expect(html).toContain("Promise&lt;void&gt; 반환</h2>");
		expect(tocOf(html)).toContain("Promise&lt;void&gt; 반환</a>");
		expect(html).toContain("<code>abc</code> — fix: &lt;details&gt; 접힘</h3>");
		expect(html).not.toContain("<details>");
	});

	test("제목의 코드·굵게·물결표 규칙은 그대로 동작한다", () => {
		const html = bodyOf("# T\n\n## `x` **b** 1~3 와 4~6\n");
		expect(html).toContain("<code>x</code> <strong>b</strong> 1~3 와 4~6</h2>");
	});

	test("제목 id 는 문서 전체에서 유일하다 — A, A, A-2 → a, a-2, a-2-2", () => {
		const html = bodyOf("# T\n\n## A\n\n## A\n\n## A-2\n");
		expect([...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])).toEqual(["a", "a-2", "a-2-2"]);
	});

	test("A-2 가 먼저 와도 뒤의 A, A 가 충돌하지 않는다", () => {
		const html = bodyOf("# T\n\n## A-2\n\n## A\n\n## A\n");
		const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
		expect(ids).toEqual(["a-2", "a", "a-3"]);
	});

	test("h2/h3 가 없으면 목차 상자를 내지 않는다", () => {
		const html = bodyOf("# T\n\n본문만 있다.\n");
		expect(html).not.toContain('class="toc"');
		expect(html).not.toContain("<ul></ul>");
	});

	test("frontmatter 는 맨 앞에서만 걷어낸다 — <hr>·setext h2·목차 항목이 생기지 않는다", () => {
		const html = bodyOf("---\ntitle: x\ntags: [a]\n---\n# T\n\n## S\n");
		expect(html).not.toContain("<hr");
		expect(html).not.toContain("title: x");
		expect([...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])).toEqual(["s"]);
	});

	test("문서 중간의 --- 와 닫히지 않은 맨 앞 --- 는 건드리지 않는다", () => {
		expect(bodyOf("# T\n\n---\n\n## S\n")).toContain("<hr>");
		expect(bodyOf("---\n# T\n\n## S\n")).toContain("<hr>");
	});

	test("빈 frontmatter 도 걷어낸다", () => {
		expect(bodyOf("---\n---\n# T\n\n## S\n")).not.toContain("<hr");
	});
});

describe("summary 처리 경계", () => {
	test("raw 블록(script) 안의 <summary> 문자열은 바꾸지 않는다", () => {
		const html = renderToHtml('<script>const e = "<summary>**b**</summary>";</script>\n', "t");
		expect(html).toContain('"<summary>**b**</summary>"');
	});

	test("raw 블록(pre) 안의 <summary> 예시도 바꾸지 않는다", () => {
		const html = renderToHtml("<pre>\n<summary>**b**</summary>\n</pre>\n", "t");
		expect(html).toContain("<summary>**b**</summary>");
	});

	test("일반 <details><summary> 는 계속 인라인 마크다운으로 렌더한다", () => {
		expect(renderToHtml("<details><summary>**b**</summary>\n</details>\n", "t")).toContain("<summary><strong>b</strong></summary>");
	});

	test("summary 안의 백슬래시로 끝나는 코드 스팬도 경고 대상이다", () => {
		const md = "<details><summary>`sql\\`x\\` 처리</summary>\n</details>\n";
		expect(findBackslashEndedCodeSpans(md).length).toBeGreaterThan(0);
	});

	test("summary 의 정상 코드 스팬과 raw 블록 안의 summary 는 경고하지 않는다", () => {
		expect(findBackslashEndedCodeSpans("<details><summary>`ok` 처리</summary>\n</details>\n")).toEqual([]);
		expect(findBackslashEndedCodeSpans("<script>x = '<summary>`a\\`</summary>';</script>\n")).toEqual([]);
	});

	test("경고에 찍는 원문에서 제어 문자를 지운다", () => {
		expect(stripControlChars("`a\u001b[2J\u0007\r\\`")).toBe("`a[2J\\`");
		expect(stripControlChars("줄\t바꿈\n유지")).toBe("줄\t바꿈\n유지");
	});
});

describe("제목 추출 (extractTitle)", () => {
	test("첫 h1 의 마크다운 문법을 벗긴 평문이다", () => {
		expect(extractTitle("# `Foo` **bar** [x](u)\n", "fb")).toBe("Foo bar x");
		expect(extractTitle("# Title #\n", "fb")).toBe("Title");
	});

	test("코드 펜스 안의 # 줄은 제목이 아니다", () => {
		expect(extractTitle("```sh\n# 주석\n```\n\n# 진짜\n", "fb")).toBe("진짜");
	});

	test("h1 이 없으면 폴백(파일 이름)을 쓴다", () => {
		expect(extractTitle("## 절만 있다\n", "my-doc")).toBe("my-doc");
	});

	test("frontmatter 안의 # 주석은 제목이 아니다", () => {
		expect(extractTitle("---\n# note\n---\n# 실제\n", "fb")).toBe("실제");
	});
});


describe("CSS — 긴 토큰과 다크 모드 배지", () => {
	const html = renderToHtml("# T\n", "t");

	test("제목·summary·표 셀은 긴 토큰을 어디서든 줄바꿈한다", () => {
		expect(html).toMatch(/h1, h2, h3, h4, summary, th, td \{ overflow-wrap: anywhere; \}/);
	});

	test("변경 배지 글자색은 토큰이다 — 라이트는 흰색, 다크는 어두운 색으로 바뀐다", () => {
		expect(html).toMatch(/\.cf\[data-change\]::before \{[^}]*color: var\(--on-badge\);/);
		expect(html).toMatch(/--on-badge: #FFFFFF;/);
		expect(html).toMatch(/:root:not\(\[data-theme="light"\]\) \{[^}]*--on-badge: #0E1117;/);
		expect(html).toMatch(/:root\[data-theme="dark"\] \{[^}]*--on-badge: #0E1117;/);
	});
});

describe("render.ts CLI", () => {
	test("프론트매터 안의 figure 예시와 백슬래시 코드는 경고를 일으키지 않고 본문 figure 는 통과한다", () => {
		const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
		try {
			const doc = join(dir, "doc.md");
			const out = join(dir, "doc.html");
			writeFileSync(
				doc,
				`---\nexample: |\n  <figure class="diagram" data-kind="flow"></figure>\nnote: \`a\\\`\n---\n# 제목\n\n${FIGURE}\n`,
			);
			const r = spawnSync("bun", [join(import.meta.dir, "render.ts"), "--in", doc, "--out", out], {
				encoding: "utf8",
			});
			expect(r.status).toBe(0);
			expect(r.stderr).not.toContain("경고");
			const html = readFileSync(out, "utf8");
			expect(html).toContain("<h1");
			expect(html.match(/<figure class="diagram"/g)).toHaveLength(1);
			expect(html).toContain("<figcaption><b>그림 1.</b> 요청 흐름</figcaption>");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

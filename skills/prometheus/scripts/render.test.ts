import { execFileSync } from "child_process";
import { describe, expect, test } from "bun:test";
import { mmdcRenderSvg, normalizeSvgWidth, renderToHtml, slugify, zoomableFigure } from "./render";
import { extractTitle, stripControlChars } from "./render";

const MMDC_TEST_TIMEOUT_MS = 60_000;

function mmdcAvailable(): boolean {
	try {
		execFileSync("mmdc", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

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

describe("자기완결성", () => {
	const html = renderToHtml(DOC, "제목");

	test("외부 참조가 하나도 없다 — 오프라인·인쇄·메일 전달에서 깨지지 않는다", () => {
		expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
		expect(html).not.toMatch(/href\s*=\s*["']https?:\/\/[^"']*\.(css|js)/i);
	});

	test("스크립트는 정확히 하나 — 확대 오버레이 ESC/Enter 편의뿐, 콘텐츠는 무-JS로 렌더된다", () => {
		expect(html.match(/<script/gi) ?? []).toHaveLength(1);
		// 그 하나는 오직 키보드 단축키(확대 토글 해제)만 하고, 외부 소스를 부르지 않는다.
		expect(html).toMatch(/<script>[\s\S]*keydown[\s\S]*dz-toggle:checked[\s\S]*<\/script>/);
		expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
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

describe("쓰기 전에 소개 — 다이어그램 요소 각주(gloss)", () => {
	// 그림 속 코드명 노드/화살표를 한 줄씩 푸는 "이 그림의 요소" 상자. 이 스타일이 사라지면
	// 무맥락 독자가 다이어그램 요소를 못 읽으므로 회귀 가드로 고정한다.
	test("ul.gloss 각주 상자 스타일이 내장돼 있다", () => {
		const html = renderToHtml(DOC, "제목");
		expect(html).toContain("ul.gloss");
		expect(html).toContain('content: "이 그림의 요소"');
	});
});

// ---------------------------------------------------------------------------
// v3 — mermaid 사전 렌더 + 렌더러 소유 컴포넌트 CSS

import { preRenderMermaid, softWrapLabels } from "./render";

describe("긴 점(dot) 라벨 줄바꿈 — softWrapLabels", () => {
	test("긴 dotted 라벨은 점 앞에서 <br/>로 나뉜다 — 단어 중간이 아니라 자연 경계", () => {
		expect(softWrapLabels('A["ProductRepository.update"]')).toBe('A["ProductRepository<br/>.update"]');
	});

	test("짧은 dotted 라벨은 건드리지 않는다 — a.b 는 그대로", () => {
		expect(softWrapLabels('A["a.b"]')).toBe('A["a.b"]');
	});

	test("점 없는 긴 라벨은 한 줄 유지 — 단어 중간을 쪼개지 않는다(wrappingWidth 가 담당)", () => {
		const s = 'A["SmartSubscriptionBundleMappingRepo"]';
		expect(softWrapLabels(s)).toBe(s);
	});

	test("저자가 이미 <br/> 를 넣었으면 다시 넣지 않는다", () => {
		const s = 'A["ProductRepository<br/>.update"]';
		expect(softWrapLabels(s)).toBe(s);
	});

	test("여러 점의 메서드 체인은 각 점에서 나뉜다", () => {
		expect(softWrapLabels('A["OrderRepo.findActiveByHousehold.count"]')).toBe(
			'A["OrderRepo<br/>.findActiveByHousehold<br/>.count"]',
		);
	});

	test("긴 click URL 은 그대로 두고 일반 dotted 라벨만 줄바꿈한다", () => {
		const source =
			'click A "https://example.com/docs/VeryLongClickTargetPage.html"\nA["ProductRepository.update"]';
		expect(softWrapLabels(source)).toBe(
			'click A "https://example.com/docs/VeryLongClickTargetPage.html"\nA["ProductRepository<br/>.update"]',
		);
	});
});

const MERMAID_DOC = `# 제목

## Architecture

### 시스템 레벨

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

산문.

\`\`\`mermaid
flowchart TB
  C --> D
\`\`\`
`;

describe("mermaid 사전 렌더", () => {
	test("mermaid 펜스는 렌더 함수를 거쳐 확대 가능한 figure.diagram 안 인라인 SVG 가 된다", () => {
		const out = preRenderMermaid(MERMAID_DOC, (src, i) => `<svg data-i="${i}">${src.includes("A --> B") ? "AB" : "CD"}</svg>`);
		expect(out).not.toContain("```mermaid");
		expect(out).toContain('<div class="dz-scroll"><svg data-i="0">AB</svg></div>');
		expect(out).toContain('<div class="dz-scroll"><svg data-i="1">CD</svg></div>');
		expect(out).toContain('id="dz-0"');
		expect(out).toContain('id="dz-1"');
		expect(out).toContain('<figure class="diagram">');
		// 바깥 클릭으로 닫기: 각 figure 는 같은 토글을 가리키는 전체 화면 backdrop 라벨을 갖는다.
		expect(out).toContain('<label for="dz-0" class="dz-backdrop"');
		expect(out).toContain('<label for="dz-1" class="dz-backdrop"');
	});

	test("mermaid 가 아닌 코드 펜스는 건드리지 않는다", () => {
		const doc = "```ts\nconst x = 1;\n```\n";
		expect(preRenderMermaid(doc, () => "<svg/>")).toBe(doc);
	});

	test("렌더 함수가 던지면 실패한 블록 번호가 오류에 실린다", () => {
		expect(() =>
			preRenderMermaid(MERMAID_DOC, (_src, i) => {
				if (i === 1) throw new Error("mmdc exploded");
				return "<svg/>";
			}),
		).toThrow(/2번째 mermaid 블록/);
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
});

// ---------------------------------------------------------------------------
// 넓은 mermaid 라벨 가독성 — 다운스케일이 아니라 자연폭+스크롤
//
// mmdc 는 SVG 루트에 width="100%" 를 박는다. 그대로 두면 컬럼보다 넓은 다이어그램이
// 컬럼으로 축소돼 16px 라벨이 몇 px 로 붕괴하고(브라우저 실측: 2261px vb → 데스크톱
// 4.7px·모바일 2.1px) figure 의 overflow-x 도 발화하지 않는다. 봉인은 두 겹이다 —
// normalizeSvgWidth 가 width 를 viewBox px 로 재작성하고, CSS 가 그 폭을 캡하지 않는다.

describe("넓은 mermaid 폭 정규화 (normalizeSvgWidth)", () => {
	const wide = `<svg id="mmd-0" width="100%" class="flowchart" style="max-width: 2261.48px;" viewBox="0 0 2261.484375 94">x</svg>`;

	test("viewBox 원점이 0이 아니어도 Mermaid의 작은 width를 자연 폭으로 고친다", () => {
		const svg = '<svg width="10" viewBox="4 4 1155.625 379"></svg>';

		expect(normalizeSvgWidth(svg)).toContain('width="1156"');
	});

	test("중첩 marker의 viewBox가 아니라 루트 SVG의 viewBox 폭을 사용한다", () => {
		const svg =
			'<svg width="100%" viewBox="-23.609375 0 1467.28125 244">' +
			'<defs><marker viewBox="0 0 10 10" /></defs></svg>';

		expect(normalizeSvgWidth(svg)).toContain('width="1468"');
	});

	test('width="100%" 를 viewBox 자연폭(px)으로 재작성한다 — 넓은 다이어그램이 축소되지 않는다', () => {
		const out = normalizeSvgWidth(wide);
		expect(out).toContain('width="2262"');
		expect(out).not.toContain('width="100%"');
	});

	test("mmdc 가 구운 인라인 max-width 를 제거한다 — 스타일시트가 맞춤/확대 폭을 소유하게 한다", () => {
		// 인라인 style 이 스타일시트를 이기므로, 남겨두면 .dz-scroll svg{max-width:100%}(맞춤)와
		// .dz-view … svg{max-width:none}(확대)가 둘 다 무시돼 SVG 가 카드 밖으로 넘친다(깨짐).
		const out = normalizeSvgWidth(wide);
		expect(out).not.toMatch(/max-width:\s*[\d.]+px/);
	});

	test("viewBox 가 없으면 손대지 않는다", () => {
		const noVb = `<svg id="mmd-0" width="100%" class="flowchart">x</svg>`;
		expect(normalizeSvgWidth(noVb)).toBe(noVb);
	});

	test("이미 px 폭이면(= width=100% 아님) 그대로 둔다", () => {
		const fixed = `<svg id="mmd-1" width="123" viewBox="0 0 123 40">y</svg>`;
		expect(normalizeSvgWidth(fixed)).toBe(fixed);
	});

	test("preRenderMermaid 가 감싸는 SVG 에 폭 재작성이 적용된다", () => {
		const doc = "```mermaid\nflowchart LR\n  A --> B\n```\n";
		const out = preRenderMermaid(doc, () => wide);
		expect(out).toContain('<div class="dz-scroll"><svg id="mmd-0" width="2262"');
		expect(out).not.toContain('width="100%"');
	});
});

// 다이어그램 크기 조절 — 기본은 컬럼에 맞춰 축소(가로 스크롤 제거), 확대는 무-JS 오버레이.
// 이전 계약("축소가 아니라 자연폭+스크롤")은 가로 스크롤이 불편하다는 피드백으로 뒤집혔다:
// 기본은 컬럼 폭에 맞추고, 잘 안 보이면 우측 상단 확대 버튼(자연 크기 오버레이)으로 본다.
describe("figure.diagram 크기 조절 CSS — 맞춤 기본 + 무-JS 확대 오버레이", () => {
	const html = renderToHtml(DOC, "제목");

	test("확대 토글은 키보드로 접근 가능한 이름을 가진 네이티브 체크박스다", () => {
		const figure = zoomableFigure('<svg viewBox="0 0 10 10"></svg>', 0);
		expect(figure).toContain(
			'<input type="checkbox" id="dz-0" class="dz-toggle" aria-label="다이어그램 확대">',
		);
		expect(figure).not.toContain('class="dz-toggle" aria-hidden="true"');
		expect(html).toMatch(/\.dz-toggle\s*\{[^}]*width:\s*1px[^}]*height:\s*1px[^}]*clip:/);
		expect(html).toContain(".dz-toggle:focus-visible + .dz-open");
	});

	test("기본은 컬럼 폭에 맞춰 축소한다 — .dz-scroll svg 가 max-width:100%", () => {
		const screenCss = html.split("@media print", 1)[0];
		expect(screenCss).toMatch(/\.dz-scroll svg\s*\{[^}]*max-width:\s*100%/);
	});

	test("확대 상태는 자연 크기다 — :checked ~ .dz-view .dz-scroll svg 가 max-width:none", () => {
		expect(html).toMatch(/\.dz-toggle:checked ~ \.dz-view \.dz-scroll svg\s*\{[^}]*max-width:\s*none/);
	});

	test("확대는 전체 뷰포트 오버레이다 — :checked ~ .dz-view 가 position:fixed", () => {
		expect(html).toMatch(/\.dz-toggle:checked ~ \.dz-view\s*\{[^}]*position:\s*fixed/);
	});

	test("확대 자체는 CSS다 — 토글은 체크박스, 바깥클릭 닫기는 backdrop 라벨", () => {
		expect(html).toContain("dz-toggle");
		expect(html).toContain("dz-backdrop");
		// 페이지의 유일한 스크립트는 ESC/Enter 편의뿐 — 콘텐츠·확대·바깥클릭 닫기는 그것 없이도 동작한다.
		expect(html.match(/<script/gi) ?? []).toHaveLength(1);
	});

	test("확대 오버레이는 다이어그램 카드 밖 클릭으로 닫힌다 — backdrop 이 카드(z-index) 아래", () => {
		expect(html).toMatch(/\.dz-toggle:checked ~ \.dz-view \.dz-backdrop\s*\{[^}]*position:\s*fixed/);
		expect(html).toMatch(/\.dz-toggle:checked ~ \.dz-view \.dz-scroll\s*\{[^}]*z-index:\s*1/);
	});

	test("ESC/Enter 로 확대를 닫는 스크립트가 있고, 외부 소스를 부르지 않는다", () => {
		expect(html).toMatch(/<script>[\s\S]*keydown[\s\S]*Escape[\s\S]*Enter[\s\S]*dz-toggle:checked[\s\S]*<\/script>/);
		expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
	});

	test("인쇄에서는 확대 버튼을 숨기고 SVG를 인쇄 가능 폭에 맞춘다", () => {
		const printCss = html.match(/@media print\s*\{([\s\S]*?)\n\}/)?.[1];
		expect(printCss).toBeDefined();
		expect(printCss).toMatch(/\.dz-btn\s*\{[^}]*display:\s*none/);
		expect(printCss).toMatch(/max-width:\s*100%/);
	});

	test("인쇄에서는 체크된 dz-scroll 래퍼도 인쇄 폭으로 리셋한다", () => {
		const printCss = html.match(/@media print\s*\{([\s\S]*?)\n\}/)?.[1];
		expect(printCss).toMatch(
			/\.dz-toggle:checked ~ \.dz-view \.dz-scroll\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/,
		);
	});

	test("본문 폭은 뷰포트 반응형이다 — 46rem 고정 컬럼은 다이어그램이 잘리는 결함이었다", () => {
		expect(html).toMatch(/main\s*\{[^}]*max-width:\s*min\(/);
		expect(html).not.toMatch(/main\s*\{[^}]*max-width:\s*46rem/);
	});
});

// 라벨 클리핑 방지 — htmlLabels:false 로 foreignObject 클립 영역 제거 (폰트 독립).
describe("라벨 클리핑 방지 — mmdc htmlLabels:false", () => {
	test.skipIf(!mmdcAvailable())(
		"긴 단일 토큰 식별자가 잘리거나 문자 중간에서 쪼개지지 않고 온전히 렌더된다",
		() => {
			const src =
				'flowchart TD\n  A["OrderRepo.findActiveSmartSubscriptionSupplementsByHousehold"] --> B["x"]\n';
			const svg = mmdcRenderSvg(src, 0);
			expect(svg).not.toContain("<foreignObject");
			const textContent = svg.replace(/<[^>]+>/g, "");
			expect(textContent).toContain("findActiveSmartSubscriptionSupplementsByHousehold");
		},
		// 실제 mmdc는 headless Chromium을 띄운다. 전체 테스트가 도는 부하에서는 bun 기본 5초를 넘긴다.
		MMDC_TEST_TIMEOUT_MS,
	);
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

	test("mermaid 그림 바로 아래의 범례 줄이 렌더된다", () => {
		const md = "# T\n\n```mermaid\ngraph TD\n  A --> B\n```\n**범례** `x`\n";
		const pre = preRenderMermaid(md, () => '<svg viewBox="0 0 10 10"></svg>');
		const html = renderToHtml(pre, "t");
		expect(html).toContain("<strong>범례</strong> <code>x</code>");
		expect(html).toContain('<figure class="diagram">');
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

	test("다이어그램 id(dz-N, mmd-N)는 예약되어 제목이 가져가지 않는다", () => {
		const html = bodyOf("# T\n\n## dz-0\n\n## mmd-12\n");
		expect([...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])).toEqual(["dz-0-2", "mmd-12-2"]);
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

describe("normalizeSvgWidth — 치환 문자열 해석 금지", () => {
	test("루트 태그의 $& 와 $1 이 그대로 남는다", () => {
		const svg = '<svg viewBox="0 0 100 50" data-x="$&$1" width="5"><g/></svg>';
		expect(normalizeSvgWidth(svg)).toBe('<svg viewBox="0 0 100 50" data-x="$&$1" width="100"><g/></svg>');
	});
});

describe("CSS — 긴 토큰과 다크 모드 배지", () => {
	const html = renderToHtml("# T\n", "t");

	test("제목·summary·표 셀은 긴 토큰을 어디서든 줄바꿈한다", () => {
		expect(html).toMatch(/h1, h2, h3, h4, summary, th, td \{ overflow-wrap: anywhere; \}/);
	});

	test("다크 모드 변경 배지는 어두운 글자색을 쓰고 라이트 모드는 흰 글자 그대로다", () => {
		expect(html).toMatch(/\.cf\[data-change\]::before \{[^}]*color: #fff;/);
		expect(html).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*\.cf\[data-change\]::before, \.arch-entity\[data-change\]::before \{ color: #16181c; \}/);
	});
});

describe("preRenderMermaid — 줄 단위 펜스 스캔", () => {
	const fake = (src: string, i: number) => `<svg data-i="${i}">${src.trim().replace(/\n/g, "|")}</svg>`;
	const run = (md: string) => preRenderMermaid(md, fake);

	test("틸드 펜스, info 문자열, 공백, 대소문자 변형을 모두 인식한다", () => {
		for (const open of ["~~~mermaid", '```mermaid title="x"', "``` mermaid", "```Mermaid", "````mermaid"]) {
			const close = open.startsWith("~") ? "~~~" : open.startsWith("````") ? "````" : "```";
			const out = run(`앞\n${open}\ngraph TD\nA-->B\n${close}\n뒤\n`);
			expect(out).toContain('data-i="0"');
			expect(out).toContain("graph TD|A-->B");
			expect(out).not.toContain("mermaid");
		}
	});

	test("같은 문자이고 같거나 긴 펜스로만 닫힌다 — 짧은 펜스 줄은 소스에 남는다", () => {
		const out = run("````mermaid\ngraph TD\n```\nA-->B\n````\n");
		expect(out).toContain("graph TD|```|A-->B");
	});

	test("CRLF 와 CR 줄바꿈도 인식하고 LF 로 정규화한다", () => {
		const out = run("```mermaid\r\ngraph TD\r\n```\r\n끝\r");
		expect(out).toContain('data-i="0"');
		expect(out).not.toContain("\r");
	});

	test("다른 펜스 코드 블록 안에 중첩된 mermaid 펜스는 코드로 남는다", () => {
		const md = "````md\n```mermaid\ngraph TD\n```\n````\n";
		expect(run(md)).toBe(md);
	});

	test("닫히지 않은 펜스 안의 mermaid 는 코드로 남는다", () => {
		const md = "```js\n```mermaid\ngraph TD\n";
		expect(run(md)).toBe(md);
		const md2 = "```mermaid\ngraph TD\n";
		expect(run(md2)).toBe(md2);
	});

	test("인용문 줄의 mermaid 펜스는 건드리지 않는다 — '> ' 가 소스로 새지 않는다", () => {
		const md = "> ```mermaid\n> graph TD\n> ```\n";
		expect(run(md)).toBe(md);
	});

	test("목록 안 펜스는 들여쓰기만큼 소스를 내어쓰고 그림 앞에 같은 들여쓰기를 남긴다", () => {
		const seen: string[] = [];
		const out = preRenderMermaid("- 항목\n\n  ```mermaid\n  graph TD\n    A-->B\n  ```\n", (s, i) => {
			seen.push(s);
			return fake(s, i);
		});
		expect(seen).toEqual(["graph TD\n  A-->B\n"]);
		expect(out).toContain('\n  <figure class="diagram">');
		expect(renderToHtml(out, "t")).toMatch(/<li>[\s\S]*<figure class="diagram">[\s\S]*<\/li>/);
	});

	test("그림 번호는 실제로 치환한 다이어그램만 센다", () => {
		const out = run("````md\n```mermaid\nx\n```\n````\n\n```mermaid\ngraph TD\n```\n");
		expect(out).toContain('data-i="0"');
		expect(out).not.toContain('data-i="1"');
	});

	test("렌더 실패 메시지 형식은 그대로다", () => {
		expect(() =>
			preRenderMermaid("```mermaid\nbad\n```\n", () => {
				throw new Error("boom");
			}),
		).toThrow(/^1번째 mermaid 블록 렌더 실패: Error: boom\n--- 블록 원문 ---\nbad\n$/);
	});
});

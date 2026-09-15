import { execFileSync } from "child_process";
import { describe, expect, test } from "bun:test";
import { mmdcRenderSvg, normalizeSvgWidth, renderToHtml, slugify } from "./render";

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

// ---------------------------------------------------------------------------
// v3 — mermaid 사전 렌더 + 렌더러 소유 컴포넌트 CSS

import { preRenderMermaid, softWrapLabels } from "./render";

describe("긴 점(dot) 라벨 줄바꿈 — softWrapLabels", () => {
	test("긴 dotted 라벨은 점 앞에서 <br/>로 나뉜다 — 단어 중간이 아니라 자연 경계", () => {
		// 사용자가 좋다고 한 형태: ProductRepository / .update (한 줄로 넓어지는 대신 점에서 줄바꿈)
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
		// SVG 는 .dz-scroll 안에 들어가고, 블록마다 고유 id 의 확대 토글이 붙는다.
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

describe("mmdc 결정성 — 렌더 게이트의 재현 비교 전제", () => {
	// 렌더 게이트는 제출된 HTML을 현재 Markdown으로 다시 렌더해 바이트 비교로
	// "이 소스에서 만든 HTML"임을 증명한다. 그 전제는 렌더러가 결정적이라는 것 —
	// mermaid는 기본적으로 랜덤 id와 rough.js 손그림 획으로 매 실행 다른 SVG를
	// 낸다. mmdc가 있는 환경에서만 돈다(없으면 skip).
	test.skipIf(!mmdcAvailable())(
		"classDiagram 을 같은 소스로 두 번 렌더하면 바이트가 동일하다",
		() => {
			const src = "classDiagram\n  class Tool { execute() }\n  class Helper { run() }\n  Tool --> Helper\n";
			expect(mmdcRenderSvg(src, 0)).toBe(mmdcRenderSvg(src, 0));
		},
	);
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

// ---------------------------------------------------------------------------
// 다이어그램 크기 조절 — 기본은 컬럼에 맞춰 축소(가로 스크롤 제거), 확대는 무-JS 오버레이
//
// 이전 계약은 "넓은 다이어그램은 축소가 아니라 자연폭+스크롤"이었다. 실사용에서 그 가로
// 스크롤이 불편하다는 피드백으로 계약을 뒤집는다: 기본은 컬럼 폭에 맞춰 축소해 페이지가
// 가로로 넘치지 않게 하고, 잘 안 보이는 문제는 우측 상단 확대 버튼(자연 크기 오버레이)으로
// 푼다. 무-JS 불변식은 체크박스 토글(:checked 형제 선택자)로 지킨다.

describe("figure.diagram 크기 조절 CSS — 맞춤 기본 + 무-JS 확대 오버레이", () => {
	const html = renderToHtml(DOC, "제목");

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

	test("본문 폭은 뷰포트 반응형이다 — 46rem 고정 컬럼은 다이어그램이 잘리는 결함이었다", () => {
		expect(html).toMatch(/main\s*\{[^}]*max-width:\s*min\(/);
		expect(html).not.toMatch(/main\s*\{[^}]*max-width:\s*46rem/);
	});
});

// ---------------------------------------------------------------------------
// 라벨 클리핑 방지 — htmlLabels:false 로 foreignObject 클립 영역 제거 (폰트 독립)
//
// mermaid 기본 htmlLabels:true 는 노드 라벨을 foreignObject(고정폭 HTML)로 굽고, 폭은
// 렌더 폰트로 측정된다. 그 폰트가 없는 뷰어(iOS/iCloud 엔 trebuchet ms 없음)는 더 넓은
// 대체 폰트로 다시 배치하고 고정폭 박스가 넘치는 글자를 잘라 숨긴다. htmlLabels:false 는
// 라벨을 SVG <text> 로 만들어 클립 영역 자체를 없앤다 — 넓어도 박스를 넘칠 뿐 안 숨는다.

describe("라벨 클리핑 방지 — mmdc htmlLabels:false", () => {
	test.skipIf(!mmdcAvailable())(
		"긴 단일 토큰 식별자가 잘리거나 문자 중간에서 쪼개지지 않고 온전히 렌더된다",
		() => {
			const src =
				'flowchart TD\n  A["OrderRepo.findActiveSmartSubscriptionSupplementsByHousehold"] --> B["x"]\n';
			const svg = mmdcRenderSvg(src, 0);
			// foreignObject(클립 영역)가 없어야 하고, 긴 식별자가 <text> 안에 통째로 있어야 한다.
			expect(svg).not.toContain("<foreignObject");
			const textContent = svg.replace(/<[^>]+>/g, "");
			expect(textContent).toContain("findActiveSmartSubscriptionSupplementsByHousehold");
		},
	);
});

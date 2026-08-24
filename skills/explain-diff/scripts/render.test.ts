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

	test("런타임 스크립트가 없다", () => {
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

// ---------------------------------------------------------------------------
// v3 — mermaid 사전 렌더 + 렌더러 소유 컴포넌트 CSS

import { preRenderMermaid } from "./render";

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
	test("mermaid 펜스는 렌더 함수를 거쳐 figure.diagram 으로 감싼 인라인 SVG 가 된다", () => {
		const out = preRenderMermaid(MERMAID_DOC, (src, i) => `<svg data-i="${i}">${src.includes("A --> B") ? "AB" : "CD"}</svg>`);
		expect(out).not.toContain("```mermaid");
		expect(out).toContain('<figure class="diagram"><svg data-i="0">AB</svg></figure>');
		expect(out).toContain('<figure class="diagram"><svg data-i="1">CD</svg></figure>');
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
		expect(out).toContain('<figure class="diagram"><svg id="mmd-0" width="2262"');
		expect(out).not.toContain('width="100%"');
	});
});

describe("figure.diagram svg CSS — 넓은 다이어그램은 축소가 아니라 스크롤", () => {
	const html = renderToHtml(DOC, "제목");

	test("SVG 폭을 100% 로 캡하지 않는다 — max-width:100% 는 다운스케일 버그였다", () => {
		expect(html).not.toMatch(/figure\.diagram svg\s*\{[^}]*max-width:\s*100%/);
		expect(html).toMatch(/figure\.diagram svg\s*\{[^}]*max-width:\s*none/);
	});

	test("figure.diagram 은 가로 스크롤 컨테이너다 — 넓은 다이어그램이 넘치면 스크롤된다", () => {
		expect(html).toMatch(/figure\.diagram\s*\{[^}]*overflow-x:\s*auto/);
	});
});

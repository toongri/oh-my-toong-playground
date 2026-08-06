import { describe, expect, test } from "bun:test";
import { renderToHtml, slugify } from "./render";

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

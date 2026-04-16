---
name: yowu-create-slides
description: 깔끔하고 전문적인 HTML 기반 발표자료를 단일 파일로 생성한다.  수직 스크롤 + scroll-snap 방식의 스크롤텔링 프레젠테이션으로, 슬라이드 라이브러리 없이 순수 HTML+CSS로 구현한다.  다크/라이트 테마, highlight.js 코드 블럭, 디자인 시스템을 지원하며 frontend-design 스킬 연동으로 화려한 비주얼도 선택 가능하다.  트리거: "make a presentation", "create slides", "build a deck", "발표자료", "프레젠테이션", "슬라이드", "제안서", "발표 만들어", "ppt", "keynote", "pitch deck", "tech talk", "발표 만들어줘".
---

# Scrollytelling Presentation Generator

## Philosophy

이 skill은 reveal.js 같은 슬라이드 라이브러리를 사용하지 않는다.
대신 **수직 스크롤 기반의 스토리텔링** 접근법을 사용한다.

핵심 원칙:

- **단일 HTML 파일**: 모든 CSS는 `<style>` 인라인, JS는 최소한만 허용
- **100vh 섹션**: 각 섹션이 전체 화면을 차지하며 스크롤로 자연스럽게 이동
- **콘텐츠 중심**: 화려한 애니메이션 대신 타이포그래피와 여백으로 깔끔함 달성
- **디자인 시스템 기반**: 일관된 컴포넌트와 컬러 팔레트 사용

품질 기준: 한국 디자인 에이전시가 만든 랜딩페이지 수준의 완성도.

---

## Workflow

### Step 0: 콘텐츠 이해

사용자 입력을 먼저 분석한다. 입력 형태는 다양할 수 있다:

- 구체적인 아웃라인/본문 → 바로 구조화
- 주제만 ("AI 에이전트에 대한 발표") → 적절한 수의 섹션 아웃라인을 제안하고 확인받기
- 기존 문서/노트 → 핵심 메시지를 추출하여 슬라이드 구조로 변환

### Step 1: 사용자 컨펌 (필수)

콘텐츠를 분석한 뒤, **반드시 AskUserQuestion으로 아래 항목을 한 번에 제안하고 사용자 확인을 받는다.**
**이 절차는 생략할 수 없다.** AI가 추론한 결과를 제시하되, 최종 결정은 사용자가 한다.
단, 사용자가 요청에서 모든 항목을 이미 명시한 경우에만(예: "다크 + frontend-design + 8장으로") 질문을 생략할 수 있다.

**제안 항목:**

1. **테마**: Dark 또는 Light (콘텐츠 성격 기반 추천 이유 포함)
2. **디자인 스타일**: frontend-design / 자체 심플 / 직접 제공
3. **슬라이드 구성**: 각 슬라이드의 제목과 타입을 번호 목록으로 제안
4. **악센트 컬러**: 콘텐츠에 어울리는 2~3색 조합 제안 (hex 코드 포함)

**제안 예시:**
```
발표 내용을 분석했습니다. 아래 구성으로 진행할까요?

■ 테마: Dark (권장) — 기술 주제라 어두운 배경이 적합합니다
■ 디자인: /frontend-design (기본값) — 화려한 비주얼
■ 악센트 컬러: #00d2ff (cyan) + #7b2ff7 (purple) + #ff6b6b (coral)

■ 슬라이드 구성 (5장):
  1. [title] Kotlin 소개
  2. [content] Kotlin이란?
  3. [card-grid] 주요 특징 4가지
  4. [code] 코드 예시 — data class, coroutine
  5. [closing] 마무리

수정하고 싶은 부분이 있으면 알려주세요.
엔터만 누르면 위 구성으로 진행합니다.
```

**테마 권장 기준:**
- **Dark 권장**: 기술 발표, 개발 이야기, 해커톤, 라이브 코딩, 아키텍처 설명
- **Light 권장**: 기획 제안, 비즈니스 전략, 제품 소개, 교육 자료

### Step 2: 디자인 소스 로드

사용자가 컨펌한 디자인 스타일에 따라 로드한다:

| 선택       | 디자인 소스                                       | 특징                                              |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| frontend-design (기본값) | frontend-design skill                  | 화려하고 창의적인 비주얼 (glassmorphism, glow 등) |
| 자체 심플  | `references/design-system.md` (자체 디자인시스템) | 일관되고 절제된 미니멀 스타일                     |
| 직접 제공  | 사용자 제공 가이드                                | 사용자 지정 스타일                                |

**frontend-design 로드 방법:**
1. 시스템에 `/frontend-design` skill이 설치되어 있으면 해당 skill을 호출한다.
2. 설치되어 있지 않으면 아래 URL에서 SKILL.md를 WebFetch로 가져와 지침으로 사용한다:
   `https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md`

**frontend-design 사용 시 경계 규칙:**
frontend-design skill의 **컬러, 그라디언트, 글래스모피즘, 텍스처 스타일**만 차용한다.
레이아웃 구조(100vh 섹션, scroll-snap), 폰트(@font-face 나눔스퀘어 네오), JS 제한은 **본 스킬의 규칙을 우선**한다.

**어떤 선택이든 유지되는 공통 규칙:**
- 단일 HTML 파일 출력
- `scroll-snap-type: y mandatory` + `height: 100vh` 페이지 단위 스크롤
- 나눔스퀘어 네오 폰트 (@font-face)
- highlight.js CDN (코드 블럭 포함 시)

**사용자 제공 가이드 사용 시:**
- 사용자가 URL, 파일, 또는 텍스트로 디자인 가이드를 제공하면 해당 지침을 우선 적용한다.
- 위의 공통 규칙은 동일하게 유지한다.

### Step 3: 슬라이드 아웃라인 플래닝

Step 1에서 사용자가 컨펌한 슬라이드 구성을 바탕으로, **구체적인 슬라이드 아웃라인**을 먼저 작성한다.
이 단계에서 각 슬라이드의 실제 콘텐츠 요소를 상세히 설계하여, 이후 HTML 작성 시 일관성과 품질을 확보한다.

**아웃라인 저장 방식 (분량에 따라 자율 판단):**
- **10장 이하**: 인메모리(대화 컨텍스트 내)에서 관리
- **11장 이상**: 임시 마크다운 파일(`{title-slug}-outline.md`)로 작성하여 참조. HTML 완성 후 삭제

**아웃라인 포맷** — 각 슬라이드마다 아래 항목을 명시한다:

```markdown
## Slide {N}: {제목} [{type}]

- **Label**: {섹션 카테고리 텍스트}
- **Heading**: {핵심 메시지}
- **Content**: {본문 요약 또는 항목 목록}
- **Visual**: {사용할 컴포넌트 — stat-box 3개, card 4개, code block 등}
    - 다이어그램 타입 선택 기준:

      | 조건 | 사용 타입 |
      |------|---------|
      | sequence / 시퀀스 / 요청-응답 흐름 | Mermaid (`sequenceDiagram`) |
      | flowchart / 분기 / if-else / 순서도 | Mermaid (`flowchart LR`) |
      | ER / 테이블 관계 / DB 스키마 | Mermaid (`erDiagram`) |
      | gantt / 일정 / 로드맵 | Mermaid (`gantt`) |
      | 노드 4개 이상 아키텍처 | Mermaid (`flowchart`) |
      | 단순 컴포넌트 관계, **노드 ≤3개**, 슬라이드 테마 색 필요 | Inline SVG (`diagram` 타입) |

    - `diagram` 타입 (Inline SVG): `viewBox="0 0 600 {높이}"` — 노드 3개 이하 전용. 노드(`<g class="diag-node">`), 엣지(`<line class="diag-edge">`), `<defs>` 마커. fill/stroke는 CSS 변수 참조. **마커 id는 슬라이드마다 고유값** (예: `id="diag-arrow-s5"`) — Mermaid/다중 diagram 슬라이드 공존 시 id 중복 방지.
    - `flow` 5-step 변형: `.workflow-grid` grid + `.wf-step::after` 화살표. `.flow-arrow` div 불필요.
    - `title` 히어로 배지: `.hero-badge-row` + `.hero-badge`. Iconify 없이 dot + 텍스트로 키포인트 3-4개 표시.
- **Notes**: {특이사항 — min-height 필요 여부, CDN 라이브러리, overflow 전환 등}
```

**구조 가이드라인:**
- 콘텐츠가 5개 이하면 5~7개 섹션도 충분하다. 무리하게 늘리지 않는다.
- 15장을 초과하면 목차 섹션을 추가하고 PART 디바이더로 챕터를 나눈다.
- 구조 패턴: `title → context/problem → solution → details(2-4장) → evidence → next-steps → closing`

### Step 4: HTML Skeleton 작성

아웃라인이 확정되면, **HTML의 뼈대(Head + CSS)만 먼저 Write**한다.
이 단계에서는 `<body>` 안에 슬라이드 콘텐츠를 넣지 않는다.

**Write로 생성하는 Skeleton 구조:**

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{발표 제목}</title>
    {highlight.js CSS CDN link — 코드 블럭이 있을 때만}
    {기타 필요한 CDN CSS — KaTeX 등}
    <style>
      {나눔스퀘어 네오 @font-face 블럭 전체}
      {CSS 변수 — :root 테마 정의}
      {전체 레이아웃 CSS — scroll-snap, .slide 공통, 페이지 번호 counter}
      {모든 슬라이드 타입별 CSS — slide--title, slide--content, slide--card-grid 등}
      {반응형 @media 쿼리}
    </style>
  </head>
  <body>

  {CDN scripts — highlight.js, Mermaid 등 필요한 것만}
  <script>
    hljs.highlightAll();
  </script>
  </body>
</html>
```

**핵심**: CSS는 아웃라인에 명시된 **모든 슬라이드 타입의 스타일을 한 번에** 포함한다.
이후 슬라이드 append 시 CSS를 추가로 수정할 필요가 없도록 설계한다.

### Step 5: 슬라이드 Append

Skeleton이 준비되면, **Edit 도구로 `</body>` 직전에 슬라이드를 순차 append**한다.
한 번에 전체를 쓰지 않고, 적절한 단위로 나누어 추가한다.

**Append 단위 (자율 판단):**
- **기본**: 1~3개 슬라이드를 한 번의 Edit으로 추가
- **단순한 슬라이드** (title, closing, quote 등): 2~3개씩 묶어도 됨
- **복잡한 슬라이드** (code 30줄+, card-grid 4개+, timeline 5단계+): 1개씩 단독 추가
- **전체 10장 이하의 간단한 발표**: 한 번에 모두 추가해도 무방

**Append 방법:**

각 Edit에서 `</body>` 태그 또는 CDN `<script>` 블럭 직전의 빈 줄을 `old_string`으로 잡고,
해당 위치에 `<section>` 블럭을 삽입한다.

```
Edit:
  old_string: "{이전 슬라이드의 closing </section> 태그 또는 body 내 마지막 콘텐츠}"
  new_string: "{이전 콘텐츠}\n\n    {새 <section> 블럭들}"
```

**진행 시 사용자에게 간단한 진척 상황을 알린다:**
- `"슬라이드 1-3/8 추가 중..."` 식의 짧은 상태 업데이트

### Step 6: 마무리 및 파일 확인

모든 슬라이드 append가 완료되면:

1. 최종 HTML 파일의 슬라이드 수가 아웃라인과 일치하는지 확인한다
2. 페이지 번호 카운터의 총 수(`/ {N}`)가 실제 슬라이드 수와 맞는지 검증한다
3. 임시 아웃라인 파일이 있으면 삭제한다

### Step 7: Gemini 디자인 리뷰 (선택적)

`gemini-design-review` 스킬을 호출하여 HTML 디자인을 보완한다.
gemini CLI 미설치 시 자동으로 quiet pass되므로 별도 분기 처리가 필요 없다.

**호출 방법:**

`gemini-design-review` 스킬에 아래 컨텍스트를 전달한다:
- **HTML 파일 경로**: 방금 생성한 HTML 파일의 절대 경로
- **보호 규칙**: `scroll-snap 보호`, `폰트 보호: NanumSquareNeo`, `레이아웃 보호: 100vh`

스킬이 지침을 적용하면 결과를 사용자에게 요약 보고하고, 스킵되면 아무 메시지 없이 다음 단계로 진행한다.

### Step 8: 최종 안내

저장 경로를 사용자에게 알려준다: `현재 디렉토리에 {제목-slug}.html로 저장했습니다.`

---

## Slide Type Catalog

각 섹션은 아래 타입 중 하나를 사용한다. 한 발표에서 같은 타입을 반복해도 된다.
**매칭 힌트**를 참고하여 콘텐츠에 적합한 타입을 선택한다.

| Type         | 용도          | 핵심 요소                                     | 매칭 힌트                            |
| ------------ | ------------- | --------------------------------------------- | ------------------------------------ |
| `title`      | 표지 슬라이드 | gradient 텍스트 제목, badge/eyebrow, subtitle | 첫 슬라이드, 파트 디바이더           |
| `content`    | 일반 내용     | label + heading + desc 본문                   | 설명/서술이 중심인 슬라이드          |
| `stat-grid`  | 숫자 강조     | 2-4개의 stat-box (큰 숫자 + 라벨)             | 수치, KPI, 성과가 2개 이상 등장할 때 |
| `card-grid`  | 항목 나열     | 2-4개의 카드 (아이콘 + 제목 + 설명)           | 병렬적 항목, 기능 목록, 장점 나열    |
| `code`       | 코드 설명     | heading + highlight.js 코드 블럭 + 설명       | 코드 예시, CLI 명령, 설정 파일       |
| `timeline`   | 단계/일정     | 세로 타임라인 (dot + title + desc)            | 시간순/단계별 순서가 명확할 때       |
| `flow`       | 프로세스      | 가로 플로우 다이어그램 (step + arrow)         | 파이프라인, 워크플로우, 데이터 흐름  |
| `quote`      | 인용/강조     | quote-box (좌측 보더 + 텍스트 + 출처)         | 핵심 메시지 강조, 사용자 후기, 인용  |
| `comparison` | 비교          | 2열 비교 (before/after, A/B)                  | "기존 vs 신규", "A vs B" 대비 구조   |
| `naming`     | 이름/공식     | naming-box (chip + 결과 + 설명)               | 브랜딩, 합성어 설명, 공식/수식       |
| `code-comparison` | 코드 비교 | 2열 코드 블럭 (언어/버전/전후 비교)          | "JS vs TS", "before/after", 문법 비교 |
| `closing`    | 마무리        | CTA 버튼, 감사 메시지, 연락처                 | 마지막 슬라이드, Q&A                 |
| `diagram`    | SVG 아키텍처 다이어그램 | Inline SVG (`<rect>` + `<path>` + `<marker>` + CSS 변수 참조) | 컴포넌트 관계, 데이터 흐름 — JS 없이 테마 연동 다이어그램이 필요할 때 |

> **`flow` 5-step 변형**: step이 정확히 5개이면 `.workflow-grid` + `::after` 화살표 사용 권장. `.flow-arrow` div 불필요. `design-system.md` 섹션 5 참조.

---

## HTML Structure Rules

1. **단일 파일**: 외부 CSS 파일 없음. 모든 스타일은 `<style>` 태그 안에
2. **CSS 변수**: `:root`에 테마 변수 정의, 컴포넌트에서 참조
3. **섹션 구조**: 테마와 무관하게 `<section class="slide slide--{type}">` 통일. 테마 차이는 CSS 변수와 body 클래스로만 처리
4. **페이지 단위 스크롤**: `html { scroll-snap-type: y mandatory; }` + 각 섹션에 `scroll-snap-align: start;`
5. **섹션 높이**: 기본 `height: 100vh` + `overflow: hidden`. 단, 콘텐츠가 많은 섹션(카드 5개 이상, 코드 30줄 이상, 타임라인 5단계 이상)은 `min-height: 100vh` + `overflow: visible`로 전환. `scroll-snap-align`은 유지
6. **콘텐츠 폭**: 기본 텍스트 `max-width: 720px`. 카드 그리드, 비교, 플로우 등 다열 레이아웃은 `max-width: 960px`까지 허용
7. **나눔스퀘어 네오 폰트**: `@font-face` 블럭으로 직접 선언. 아래 코드를 그대로 사용:

```css
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-aLt.woff2);
  font-weight: 300;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-bRg.woff2);
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-cBd.woff2);
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-dEb.woff2);
  font-weight: 800;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-eHv.woff2);
  font-weight: 900;
  font-display: swap;
}
```

폰트 URL 로드에 실패하면 `'Noto Sans KR', -apple-system, sans-serif`를 fallback으로 사용한다. 8. **반응형**: `@media (max-width: 768px)` 브레이크포인트 포함 9. **페이지 번호**: CSS counter로 자동 페이지 번호 표시. 반드시 `position: absolute` 사용 (`position: fixed` 금지 — fixed 사용 시 모든 슬라이드의 번호가 겹쳐 마지막 번호만 보이는 버그 발생). 구현 패턴:

```css
body {
  counter-reset: slide;
}
.slide {
  counter-increment: slide;
  position: relative;
}
.slide::after {
  content: counter(slide, decimal-leading-zero) ' / {총 슬라이드 수}';
  position: absolute; /* fixed 절대 금지 */
  bottom: 24px;
  right: 32px;
  font-size: 13px;
  color: var(--text-muted);
}
```

10. **접근성**: `<html lang="ko|en">` 설정. WCAG AA 이상의 색상 대비 유지. heading 레벨을 `h1` → `h2` → `h3` 순서로 사용
11. **Flex 컨테이너 내 인라인 요소**: `.hero-badge-row`, badge, tag, pill 등 인라인 요소가 flex column 컨테이너의 직접 자식일 때 반드시 `align-self: center; width: fit-content;`을 추가한다. 누락 시 전체 너비로 늘어나는 버그 발생

---

## Typography & Color

### 공통 베이스라인 스케일

아래 값은 **모든 디자인 경로**(자체 심플, frontend-design, 직접 제공)에 적용되는 최소 베이스라인이다.
AI는 이 값을 **하한선**으로 사용하되, 콘텐츠 밀도와 슬라이드 구성에 따라 더 크게 조정할 수 있다.
단, 이 값보다 **작게** 설정하지 않는다.

| 요소 | 베이스라인 | 비고 |
|------|-----------|------|
| h1 | `clamp(2.25rem, 8vw, 4rem)` | 타이틀 슬라이드 |
| h2 | `clamp(1.75rem, 5vw, 2.625rem)` | 섹션 헤딩 |
| h3 | `1.25rem` | 서브 헤딩 |
| .label | `13px`, letter-spacing 0.15em | 섹션 카테고리 |
| .desc | `16px`, line-height 1.8 | 본문 설명 |
| subtitle | `22px` | 타이틀 부제 |
| .card-title | `16px` | 카드 제목 |
| .card-desc | `13px` | 카드 설명 |
| .stat-num | `clamp(1.75rem, 6vw, 2.5rem)` | 통계 숫자 |
| .stat-label | `13px` | 통계 라벨 |
| pre code | `14px` | 코드 블럭 |
| .tag | `13px` | 태그/칩 |
| page number | `13px` | 슬라이드 번호 |
| slide padding (desktop) | `60px 80px` | 기본 여백 |
| slide padding (mobile) | `40px 24px` | 모바일 여백 |
| .slide__inner max-width | `720px` | 텍스트 콘텐츠 폭 |
| 다열 레이아웃 max-width | `960px` | 카드/비교/플로우 |
| card padding | `24px` | 카드 내부 여백 |
| card border-radius | `16px` | 카드 라운딩 |
| gap (기본) | `12px` | 그리드/플렉스 간격 |

**3단 위계** — 모든 섹션에 일관되게 적용:

1. **Label**: 12px, uppercase, letter-spacing, accent color — 섹션 카테고리
2. **Heading**: clamp() 반응형, bold/black weight — 핵심 메시지
3. **Description**: 16px, muted color, line-height 1.8 — 상세 설명

**강조 패턴**:

- gradient text (`-webkit-background-clip: text`) — 타이틀 슬라이드 제목
- `<span class="em">` — 헤딩 내 키워드 강조
- tag/chip — 인라인 태그 표시

**컬러 제한**: 악센트 최대 3색. 테마별 권장 팔레트는 design-system.md 참조.

**폰트**:

- 기본 본문 폰트: **나눔스퀘어 네오** (`NanumSquareNeo`) — @font-face 블럭은 HTML Structure Rules 7번 참조
- 영어 전용 발표가 필요한 경우: Plus Jakarta Sans, Outfit, 또는 Geist (Google Fonts CDN)

---

## JavaScript Policy

- **외부 라이브러리 추가 금지**. highlight.js CDN만 허용.
- **Fullscreen 토글은 기본 포함**: `.fs-btn` 버튼과 `requestFullscreen` 기반 토글 스크립트는 모든 생성 결과물(dark/light)에 기본 포함한다. 사용자가 명시적으로 제외를 요청한 경우에만 생략한다. 상세 구현은 design-system.md의 "6. Fullscreen Toggle" 참조.
- **그 외 발표 보조용 바닐라 JS는 허용**: 키보드 방향키(←→) 네비게이션, 현재 페이지 인디케이터 등 30줄 이내의 바닐라 JS는 사용자가 요청한 경우에만 추가한다.
- 기본 생성 시에는 `hljs.highlightAll()`과 Fullscreen 토글 스크립트만 포함한다.

---

## Anti-Patterns

- **슬라이드 라이브러리 금지**: reveal.js, impress.js, Marp 등을 사용하지 않는다
- **일반 폰트 금지**: Arial, Inter, Roboto, system-ui를 메인 폰트로 쓰지 않는다
- **CSS 프레임워크 금지**: Bootstrap, Tailwind 등을 사용하지 않는다
- **과한 애니메이션 금지**: 스크롤 연동 애니메이션, 페이드인, 슬라이드인 등 사용하지 않는다 (scroll-hint bounce, hover 트랜지션은 예외)
- **보라+흰 클리셰 금지**: 무조건 보라색 그라디언트를 쓰지 않는다. 콘텐츠에 맞는 악센트 선택
- **base64 이미지 금지**: 인코딩된 이미지를 넣지 않는다
- **데이터 날조 금지**: 사용자가 제공하지 않은 수치, 연도별 추이, 발표 제목, 프로젝트명, 직무 설명 등을 추측하여 작성하지 않는다. 원본 데이터에 없는 정보는 placeholder(`[TODO: 데이터 필요]`)로 남기고 사용자에게 확인을 요청한다

**이미지/비주얼 대안**:

- 아이콘이 필요한 경우 emoji를 기본으로 활용한다. 더 정교한 아이콘이 필요하면 Iconify CDN을 사용한다 (아래 허용 라이브러리 참조)
- 간단한 다이어그램은 CSS+HTML로 직접 그린다. 복잡한 플로우/시퀀스/ER 다이어그램은 Mermaid를 사용한다
- 실제 이미지(사진, 스크린샷)가 필요한 위치에는 비율과 의도를 명시한 placeholder를 넣고, 주석으로 권장 이미지 설명을 남긴다
- 영상/오디오 등 멀티미디어는 지원하지 않으며, 스크린샷 placeholder + 링크로 대안을 제안한다

---

## Allowed CDN Libraries

**화이트리스트 방식**: 아래 목록의 라이브러리만 사용할 수 있다. 이 목록에 없는 라이브러리를 임의로 추가하지 않는다.
모든 라이브러리는 **"필요할 때만 포함"** 원칙을 따른다. 해당 콘텐츠가 없으면 CDN을 포함하지 않는다.

**CDN URL 규칙**: 아래 명시된 URL과 버전을 **그대로** 사용한다. 버전을 임의로 올리거나 다른 CDN 호스트로 변경하지 않는다. (cdnjs는 최신 버전 누락이 잦아 jsdelivr 또는 검증된 cdnjs URL만 사용)

### highlight.js — 코드 구문 강조

**포함 조건**: 코드 블럭이 있을 때

```html
<!-- head에 테마 CSS -->
<!-- Dark: -->
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
/>
<!-- Light: -->
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"
/>

<!-- body 끝 -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
  hljs.highlightAll();
</script>
```

마크업: `<pre><code class="language-{lang}">...</code></pre>`. `language-` 접두사 필수.

### Chart.js — 차트/데이터 시각화

**포함 조건**: 수치 데이터를 bar, line, pie, radar, doughnut 등 차트로 보여줄 때. `stat-grid` 대신 또는 보완으로 사용.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

마크업: `<canvas id="myChart"></canvas>` + 초기화 스크립트.
**주의**: `animation: false`로 설정하여 스크롤 시 깜빡임을 방지한다. 다크 테마에서는 `color`/`borderColor`를 테마에 맞게 조정.

### Mermaid — 다이어그램

**포함 조건**: 아키텍처, 플로우차트, 시퀀스 다이어그램, 간트 차트, ER 다이어그램이 필요할 때. CSS+HTML로 그리기 복잡한 경우 사용.

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ theme: 'dark', startOnLoad: true });
</script>
```

마크업: `<pre class="mermaid">graph LR; A-->B;</pre>`. 라이트 테마에서는 `theme: 'default'`로 변경.

### KaTeX — 수학 수식

**포함 조건**: LaTeX 수학 수식이 등장할 때 (학술 발표, 알고리즘 설명).

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
/>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  renderMathInElement(document.body);
</script>
```

마크업: 인라인 `\( E = mc^2 \)`, 블럭 `$$ \sum_{i=1}^{n} x_i $$`.

### Iconify — 아이콘

**포함 조건**: 카드나 항목에 emoji보다 정교한 아이콘이 필요할 때. emoji로 충분하면 사용하지 않는다.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/iconify/2.0.0/iconify.min.js"></script>
```

마크업: `<span class="iconify" data-icon="lucide:rocket"></span>`. Lucide, Material, Font Awesome 등 20만+ 아이콘 접근 가능.

### 요약 테이블

| 라이브러리   | 포함 조건                     | 슬라이드 타입 연관           |
| ------------ | ----------------------------- | ---------------------------- |
| highlight.js | 코드 블럭이 있을 때           | `code`                       |
| Chart.js     | 수치를 차트로 시각화할 때     | `stat-grid` 보완             |
| Mermaid      | 복잡한 다이어그램이 필요할 때 | `flow`, `timeline` 상위 대안 |
| KaTeX        | 수학 수식이 등장할 때         | `content` (학술)             |
| Iconify      | 정교한 아이콘이 필요할 때     | `card-grid`, `flow`          |

---

## Reference Files

자체 디자인시스템(선택 2) 사용 시 읽어야 하는 파일:

- `references/design-system.md`: CSS 변수, 타이포그래피 스케일, 컴포넌트 패턴 전체
- 파일이 존재하지 않으면 본 skill에 명시된 CSS 규칙과 폰트 fallback만으로 진행한다. 에러를 사용자에게 알리고 계속 생성한다.

Gemini 디자인 리뷰 (Step 7):

- `gemini-design-review` 스킬: HTML 디자인 리뷰를 Gemini CLI로 수행하는 전용 스킬. 리뷰 프롬프트와 실행 로직이 해당 스킬에 캡슐화되어 있다.

품질 레퍼런스 (참고용, 복사 대상 아님):

- `assets/example-dark.html`: 다크 테마 4슬라이드 예시 (기술 발표)
- `assets/example-light.html`: 라이트 테마 4슬라이드 예시 (비즈니스 전략)
- 이 파일들은 **목표 품질 수준의 적용 예시**이다. 구조, CSS 값, 컴포넌트 배치를 참고하되, 콘텐츠에 맞게 자유롭게 변형한다. 템플릿을 그대로 복사하거나 템플릿의 슬라이드 구성에 갇히지 않는다.

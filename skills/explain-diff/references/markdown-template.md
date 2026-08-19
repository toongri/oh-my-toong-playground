# 문서 템플릿 — 마크다운 골격과 승인된 컴포넌트

이 파일이 문서의 **모양**을 소유한다. 저자는 여기 있는 골격과 컴포넌트만 쓴다.
스타일은 `render.ts`가 소유한다 — 문서 안에 `<style>` 블록이나 인라인 `style=` 속성을
쓰면 구조 검사(R11)가 거부한다. 승인 목록 밖의 `class=` 값도 같은 이유로 거부된다.

## 골격

섹션 순서는 스텝 순서와 같다. 각 스텝이 자기 섹션을 아래 모양대로 채운다.

```markdown
# <제목> — 변경 설명

<ul class="doc-meta">
  <li><strong>범위</strong> <code><git range></code></li>
  <li><strong>커밋</strong> N개</li>
  <li><strong>파일</strong> signal N / noise N</li>
  <li><strong>줄</strong> +N/-N</li>
</ul>

## Evidence
<signal/noise 분류표 — 스텝 1>

## Background
### 깊은 배경
이미 익숙하면 건너뛰세요.
<…>
### 좁은 배경
<…>

## Architecture
### 시스템 레벨
<mermaid 또는 "구조 변화 없음: <사유>">
### 컴포넌트 레벨
<mermaid 또는 "구조 변화 없음: <사유>">
### 도메인 레벨
<mermaid 또는 "구조 변화 없음: <사유>">

## Intuition
<본질 한 문단 + toy 값 예시 + flow/compare 컴포넌트>

## Commit Journey
### 1. `<short-hash>` — <커밋 제목>
<…>
(`git rev-list --no-merges <base>..<head>`가 정확히 한 줄일 때만 섹션 대신:
"단일 커밋 범위 — Commit Journey 생략." — 머지 범위는 브랜치 실커밋이 전부 나오므로
"PR 하나"라도 여러 줄이면 단일 커밋이 아니다.)

## Change Group 1: <제목>
<…파일 블록들…>

## Quiz
<문항 뱅크 — 스텝 8>
```

## Architecture 세 레벨이 각각 답하는 질문

| 레벨 | 질문 | 권장 mermaid |
|---|---|---|
| 시스템 레벨 | 어떤 런타임·서비스·저장소가 관여하고, 이 diff는 그중 어느 경계에 닿는가 | `flowchart` + `subgraph`(경계) — 변경이 닿는 노드/간선에 `:::changed` |
| 컴포넌트 레벨 | 모듈·도메인 사이 의존이 변경 전후로 어떻게 달라지는가 | `flowchart` 두 개(Before/After) 또는 한 개에 추가/제거 간선 구분 |
| 도메인 레벨 | 엔티티·개념·불변식이 무엇이고 무엇이 바뀌는가 | `erDiagram`/`classDiagram`, 상태 규칙이면 `stateDiagram-v2` |

레벨에 그릴 것이 정말 없으면 그 레벨 아래 한 줄로 적는다 —
`구조 변화 없음: <이 diff가 그 레벨을 건드리지 않는 이유 한 문장>`.
사유 없는 마커는 구조 검사가 거부한다.

## mermaid 작성 규칙

- ` ```mermaid ` 펜스로 쓴다. `render.ts`가 빌드 타임에 mmdc로 인라인 SVG로 굽는다 —
  산출 HTML은 여전히 런타임 JS 없이 자기완결이다.
- 노드 라벨에는 diff에 실재하는 식별자(서비스명·모듈 경로·커맨드명)를 쓴다.
  심사(R12)가 라벨과 diff의 대응을 인용으로 검증한다.
- 변경 표시는 classDef 하나로 통일한다:

  ```mermaid
  flowchart LR
    order[OrderCancelService] -->|REVOKE_COUPONS| coupon[coupon-command-handlers]
    coupon --> db[(PostgreSQL)]
    classDef changed stroke:#b0563a,stroke-width:3px
    class order,coupon changed
  ```

- 한 다이어그램에 노드 12개를 넘기지 않는다. 넘치면 레벨을 잘못 골랐거나
  두 장으로 나눌 신호다.

## 승인된 컴포넌트 (전체 목록)

이 목록이 R11의 승인 집합이다. 여기 없는 클래스는 쓰지 못한다.

### `doc-meta` — 문서 머리 메타

```html
<ul class="doc-meta">
  <li><strong>범위</strong> <code>origin/main...HEAD</code></li>
  <li><strong>커밋</strong> 15개</li>
</ul>
```

### `flow` / `flow-step` / `flow-arrow` — 1차원 단계 스트립

시간 순서·호출 순서 등 **한 줄로 흐르는 것**에만 쓴다. 경계·분기가 필요하면 mermaid.

```html
<div class="flow">
  <div class="flow-step">주문 O-123<br>취소 커밋</div><span class="flow-arrow">→</span>
  <div class="flow-step"><code>REVOKE_COUPONS</code></div><span class="flow-arrow">→</span>
  <div class="flow-step">U-9 회수<br><code>1200 차감</code></div>
</div>
```

### `compare` / `compare-before` / `compare-after` — 전후 대비 카드

BEFORE/AFTER 라벨은 CSS가 붙인다 — 직접 쓰지 않는다.

```html
<div class="compare">
  <div class="compare-before">렌탈 종료 코드가 쿠폰 서비스를 직접 조립했다.</div>
  <div class="compare-after">모든 취소 경로가 <code>REVOKE_COUPONS</code> 하나를 보낸다.</div>
</div>
```

### `callout` — 강조 박스

한 문단짜리 주의·핵심 강조에만. 남발하면 강조가 아니다.

```html
<p class="callout">개별 usage 실패는 계속 처리하지만, 목록 조회 실패는 전체 경계 실패다.</p>
```

### `diagram` — 캡션 있는 다이어그램 래퍼

mermaid 블록은 render.ts가 자동으로 `<figure class="diagram">`로 감싼다.
캡션을 달고 싶을 때만 직접 쓴다:

```html
<figure class="diagram">
  <!-- (mermaid가 아닌 컴포넌트 조합을 넣을 때) -->
  <figcaption>회수 커맨드의 경계</figcaption>
</figure>
```

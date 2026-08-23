# 문서 템플릿 — 마크다운 골격과 승인된 컴포넌트

이 파일이 문서의 **모양**을 소유한다. 저자는 여기 있는 골격과 컴포넌트만 쓴다.
스타일은 `render.ts`가 소유한다 — 문서 안에 `<style>` 블록이나 인라인 `style=` 속성을
쓰면 구조 검사(R11)가 거부한다. 승인 목록 밖의 `class=` 값도 같은 이유로 거부된다.

## 골격

섹션 순서는 스텝 순서와 같다. 각 스텝이 자기 섹션을 아래 모양대로 채운다.
**퀴즈는 문서 섹션이 아니다** — 대화로 진행하므로 골격에 `## Quiz`를 쓰지 않는다.

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

## 목표
### 무엇을·왜
<이 변경이 이루려는 것 + 왜 필요했는가(해결하는 문제) — 스텝 3>
### 핵심
<코드를 보기 전에 독자가 먼저 쥐어야 할 핵심 한 줄>

## Architecture
### 시스템 레벨
<mermaid(간선=짧은 프로토콜: HTTP/SQL/REST) 또는 "구조 변화 없음: <사유>">
<상시 인터페이스 표 — 경계 / 인터페이스 / 오가는 것, 아래 참조 (R17)>
<변경 계약 표 — 서버 API / DB 스키마 / 클라이언트 의존 3축, 아래 참조 (R14)>
### 컴포넌트 레벨
<mermaid 의존 그래프 또는 "구조 변화 없음: <사유>">
<변경 행위 노드마다 arch-entity 카드 — 레이어 / 책임 / 인터페이스 + 변경종류, 아래 참조 (R18)>
### 도메인 레벨
<mermaid 또는 "구조 변화 없음: <사유>">

### 경계·의존·유스케이스
<동작 단위마다 arch-entity — 변경종류 + 한 일 + 영향 인터페이스, + 의존 방향 판정 한 줄 — 아래 참조 (R15)>

## Intuition
<본질 한 문단 + toy 값 예시 + flow/compare 컴포넌트>

## Commit Journey
<한 줄 오버뷰 — 커밋마다 한 줄, 어느 그룹으로 가는지 태그. 스텝 5>
1. `<short-hash>` <타입> — <한 줄 의도> → 그룹 N
2. `<short-hash>` docs — <한 줄> → 그룹 N (흡수)
(`git rev-list --no-merges <base>..<head>`가 정확히 한 줄일 때만 섹션 대신:
"단일 커밋 범위 — Commit Journey 생략.")

## Change Group 1: <제목>
> 예고: <이 그룹이 무엇을 할지 — 그룹 N은 그룹 N-1을 전제>
> 순서: <왜 이 순서인지>

### `<short-hash>` — <커밋 제목>
<이 커밋이 이 그룹에서 한 일 한두 문장. 여러 그룹을 가로지르면 spillover 한 줄.>

#### `path/to/file.ts`
<div class="cf">
<p><strong>역할/변경 전</strong> — <설명></p>
<p><strong>바뀐 것</strong> — <설명></p>
<p><strong>왜</strong> — <설명> <span class="cf-src">근거</span> "<원문 인용>"</p>
<p><strong>효과</strong> — <설명></p>
<p class="cf-loc"><code>base:path/to/file.ts:12</code> → <code>head:path/to/file.ts:15</code></p>
</div>

​```ts
// 핵심 로직 — 실제 코드 또는 수도코드 (파일마다 하나 필수)
​```
```

**뼈대는 커밋이다.** Change Group(관심사)이 1급 단위이지만, 그 안에서는 커밋 단위로
내려가고(`### \`hash\` — 제목`), 커밋 아래 그 커밋이 건드린 파일 블록(`#### \`file\``)이
온다. docs·noise 커밋은 별도 나열하지 않고 계약을 설명하는 그룹 안에서 한 줄로 흡수한다.

## Architecture 세 레벨이 각각 답하는 질문

| 레벨 | 질문 | 권장 mermaid |
|---|---|---|
| 시스템 레벨 | 어떤 **서로 다른 프로세스·서비스·배포 단위·저장소**가 관여하고, 이 diff는 그중 어느 경계에 닿는가 | `flowchart` + `subgraph`(경계) — 변경이 닿는 노드/간선에 `:::changed` |
| 컴포넌트 레벨 | 모듈·도메인 사이 의존이 변경 전후로 어떻게 달라지는가 | `flowchart` 두 개(Before/After) 또는 한 개에 추가/제거 간선 구분 |
| 도메인 레벨 | 엔티티·개념·불변식이 무엇이고 무엇이 바뀌는가 | `erDiagram`/`classDiagram`, 상태 규칙이면 `stateDiagram-v2` |

**시스템 레벨은 프로세스 경계다.** 한 프로세스(런타임) 안의 함수·모듈 호출 체인은 시스템이
아니라 컴포넌트/도메인 레벨이다 — 인-프로세스 콜체인(예: `test → helper → tool`)을 시스템
그림으로 위장하지 않는다. 이 diff가 어떤 프로세스·서비스 경계도 넘지 않으면 시스템 레벨은
`구조 변화 없음: <사유>` 마커를 쓴다.

**다이어그램은 "diff가 바꾼 것"만 그리는 게 아니다.** 이 diff를 이해하는 데 필요한 범위라면
변경되지 않은 주변 시스템·서비스·컴포넌트도 맥락으로 그린다. 대신 (1) 모든 노드는 실제
시스템에 존재하는 실물이어야 하고(발명 금지), (2) 그중 이 diff로 무엇이 바뀌었는지를 반드시
변경 표시(`:::changed`/Before-After)로 지목한다 — 맥락과 변경분이 섞이지 않게 한다.

레벨에 그릴 것이 정말 없으면 그 레벨 아래 한 줄로 적는다 —
`구조 변화 없음: <이 diff가 그 레벨을 건드리지 않는 이유 한 문장>`.
사유 없는 마커는 구조 검사가 거부한다.

### 시스템 레벨 — 변경 계약 표 (R14 필수)

다이어그램만으로는 "무엇이 바뀌는가"에 답하지 못한다. 시스템 레벨은 다이어그램(또는
생략 마커) 아래에 **이번 diff가 바꾸는 계약을 세 축으로 열거하는 표**를 둔다. 각 축은
바뀌는 계약을 구체적으로 적거나, 해당 없으면 `변경 없음: <사유>`로 채운다.

```markdown
| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | <바뀌는 엔드포인트·tRPC 프로시저·요청/응답 스키마> |
| DB 스키마 | <바뀌는 테이블·컬럼·제약·인덱스, 또는 변경 없음: <사유>> |
| 클라이언트 의존 | <이 변경에 맞춰 클라이언트가 의존을 바꿔야 하는 계약> |
```

세 축 라벨(`서버 API`·`DB 스키마`·`클라이언트 의존`)이 시스템 레벨 안에 모두 있어야
R14를 통과한다.

### 시스템 레벨 — 상시 인터페이스 표 (R17 필수)

다이어그램의 간선은 **짧은 프로토콜**(HTTP·SQL·REST)만 얹는다 — 긴 엔드포인트·쿼리를
간선 라벨로 박으면 레이아웃이 무너진다. "어떤 입구로 소통하는가"는 다이어그램 아래
**상시 인터페이스 표**가 답한다. 각 경계(간선)가 지금 어떤 엔드포인트·쿼리·화면 URL로
통신하고 무엇이 오가는지 적는다. 이 표는 R14와 층이 다르다 — **R14 = 이번에 바뀌는 계약,
R17 = 지금 소통하는 상시 인터페이스**. 순서는 다이어그램 → 상시 인터페이스 표 → 변경 계약 표
(맥락 먼저, 델타 나중).

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| browser → Hono backend | `GET /v1/supplement-catalog?includeDeletedCategories=true` | 표시 카탈로그 |
| Next.js BFF → Python health API | health-profile REST | 부스트팩 원본 |
| backend → PostgreSQL | `supplement_categories` 조회(활성/전체) | 카탈로그 행 |

이 표는 **실제로 렌더되는 Markdown 표**여야 한다. 헤더와 separator row는 정확히 세 열
`경계`·`인터페이스`·`오가는 것`이어야 하며, 산문으로 열 이름만 쓰거나 펜스 안 예시로
대체하면 R17을 통과하지 못한다. 무엇을 적는지는 저자의 몫이다.

### 컴포넌트 레벨 — 노드 카드 (R18 필수)

의존 그래프(mermaid)는 "무엇이 무엇에 연결되나"를 그리지만, 노드 이름만으로는
`CurrentBoostPackInfoCard` 가 무엇을 하는지 읽히지 않는다. 컴포넌트 구조가 정말 바뀌지
않는다면 그 이유를 담은 `구조 변화 없음: <사유>` waiver로 R18을 충족할 수 있다. 그 외에는
변경 행위 노드를 renderer-recognized `arch-entity` 카드로 해독하고, 카드에 **레이어·책임·인터페이스(함수)**
필드와 `data-change="new|mod|del"` 를 둔다. 순수 데이터/계약 타입만 바뀌었다는 이유로 카드를
그냥 생략할 수는 없으며, 카드가 필요 없는 구조라면 reasoned waiver를 명시해야 한다. 산문만으로
카드를 설명하거나 허용되지 않은 `data-change` 값을 쓰면 R18에 포함되지 않는다.

```markdown
<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>useSupplementCodeResolver</code></p>
<p><strong>레이어</strong> commerce/entities/supplement/api</p>
<p><strong>책임</strong> 두 카탈로그 query를 묶어 fail-closed 해소기를 카드에 공급</p>
<p><strong>인터페이스</strong> <code>{ resolveAlias, resolveDisplay, areCatalogsSettled }</code></p>
</div>
```

`레이어`·`책임`·`인터페이스` 라벨과 renderer-recognized `arch-entity`·`data-change` 카드가
컴포넌트 레벨 안에 있어야 R18을 통과한다(단, reasoned waiver는 카드 대신 허용된다).
변경종류는 `data-change="new|mod|del"` 로 나르고 배지 색은 render.ts가 붙인다.

## 경계·의존·유스케이스 블록 (R15 필수)

이 블록은 각 파트를 어느 레이어에 분류하는 **정적 표**가 아니라, **이 diff가 닿은 경계의 변경
지도**다. "누가 어느 레이어냐"가 아니라, 이번 변경에서 **동작을 끝까지 나르는 단위**가 무엇이
추가/삭제/변경됐고, 그로 인해 **어떤 인터페이스에 영향**이 갔으며, **의존 방향**이 유지됐나
뒤집혔나를 적는다. 무게중심은 동작 단위와 영향 인터페이스이고, 닿은 레이어·도메인은 그 위 한 줄
배경으로만 훑는다.

- **동작 단위** — 이 변경이 추가/삭제/변경한 행위 단위마다 `arch-entity` 하나. 변경종류는
  `data-change`, 각 단위는 **한 일 + 영향 인터페이스**를 적는다. 어휘·원리는
  `architecture-boundaries` rule의 2축을 따르되 **방법론 이름(DDD·FSD·Clean-arch·bounded context)도,
  `수평`/`수직` 같은 축 라벨도 산출물에 쓰지 않는다** — 이 diff가 닿은 곳을 코드베이스 실제 도메인
  이름으로 적는다(부품을 수평/수직 격자에 분류하는 게 아니라). R19가 명칭과 축 라벨을 모두 검사한다.
- **의존 방향 판정** — 의존이 어느 방향으로 흐르는지, 이 변경이 단방향을 유지·위반·복원하는지
  한 줄로 판정한다. reach-in·역참조·순환은 결합 결함으로 플래그한다. `의존 방향` 라벨이 있어야 한다.

R19는 렌더되는 `## Architecture` 산문만 검사한다. fenced block과 inline-code 예시는 무시하고,
방법론·축 토큰이 식별자 안에 묻힌 경우가 아닌 **standalone token**일 때만 거부한다(영문 방법론
토큰은 대소문자를 구분하지 않는다).

```markdown
### 경계·의존·유스케이스

> 닿은 곳 — 부스트팩 상담챗의 카드·도구(commerce `entities`·`features/ui`), 표시 카탈로그(backend `catalog`).

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> display catalog 조회</p>
<p><strong>한 일</strong> 삭제 카테고리까지 포함한 표시용 카탈로그 경로 신설</p>
<p><strong>영향 인터페이스</strong> <code>GET /v1/supplement-catalog?includeDeletedCategories=true</code></p>
</div>

<div class="arch-entity" data-change="mod">
<p><strong>이름</strong> 카드 category 축 전환</p>
<p><strong>한 일</strong> row key·표시·편집 대상을 product에서 category로</p>
<p><strong>영향 인터페이스</strong> 카드 snapshot 계약, pill override 키</p>
</div>

**의존 방향** — commerce feature → entities resolver → shared schema → backend REST 단방향 유지.
commerce가 catalog 내부 테이블을 직접 조회하지 않고 계약 뒤에 머문다 — 새 순환·경계 침투 없음.
```

R15는 펜스를 마스킹한 실제 블록에서 `영향 인터페이스`·`의존 방향` 슬롯과 허용된
`data-change="new|mod|del"` 를 가진 renderer-recognized `arch-entity`의 **존재**를 검사한다
(R14와 같은 철학) — 각 칸이 말하는 내용은 저자가 채운다. 산문 속 `data-change` 언급이나
허용되지 않은 값은 카드로 세지 않는다. 펜스 안 예시는 마스킹되므로 위 예시를 그대로 두는
것으로는 통과하지 못한다 — 실제 변경 내용으로 블록을 문서에 써야 한다.

## mermaid 작성 규칙

- ` ```mermaid ` 펜스로 쓴다. `render.ts`가 빌드 타임에 mmdc로 인라인 SVG로 굽는다 —
  산출 HTML은 여전히 런타임 JS 없이 자기완결이다.
- 노드 라벨에는 실제 시스템에 실재하는 식별자(서비스명·모듈 경로·커맨드명)를 쓴다 — 발명한
  일반 명사("service"→"DB")는 어떤 diff에도 들어맞아 R12에서 탈락한다. 맥락 노드는 변경되지
  않아도 좋지만, 이 diff가 바꾼 노드/간선에는 반드시 변경 표시를 단다. 심사(R12)가 라벨의
  실재성과 변경 표시를 인용으로 검증한다.
- 변경 표시는 `classDef changed stroke:#b0563a,stroke-width:3px` 하나로 통일하되,
  적용 문법은 다이어그램 타입마다 다르다 — 아래 표 밖의 조합은 파스 에러가 난다:

  | 타입 | 적용 문법 |
  |---|---|
  | `flowchart` | `class order,coupon changed` |
  | `classDiagram` | `cssClass "Foo,Bar" changed` 또는 선언에 `class Foo:::changed` |
  | `stateDiagram-v2` | `class Active changed` |
  | `erDiagram` | classDef 미지원 — 변경 엔티티는 캡션이나 본문에서 지목 |

  ```mermaid
  flowchart LR
    order[OrderCancelService] -->|REVOKE_COUPONS| coupon[coupon-command-handlers]
    coupon --> db[(PostgreSQL)]
    classDef changed stroke:#b0563a,stroke-width:3px
    class order,coupon changed
  ```

- 한 다이어그램에 노드 12개를 넘기지 않는다. 넘치면 레벨을 잘못 골랐거나
  두 장으로 나눌 신호다.

## 핵심 로직 코드 (R13 필수)

파일 블록마다 그 파일의 **핵심 로직**을 코드 펜스 하나로 보여준다 — 실제 diff 코드의
핵심 몇 줄이거나, 그것이 길면 수도코드로 요약한다. 위치 앵커만으로는 "무엇을 했나"가
읽히지 않는다.

```markdown
​```ts
export const SupplementCostItem = z.strictObject({
  supplementCategoryId: z.uuid(),
  pillCount: z.number().int().positive(),
});
​```
```

- 언어 태그는 실제 파일 언어를 쓴다(`ts`·`py`·`sql` 등). mermaid는 다이어그램 전용이므로
  여기 쓰지 않는다.
- 삭제된 파일도 `# 이 파일은 통째로 삭제된다` 같은 한 줄 펜스로 표시한다.

## 승인된 컴포넌트 (전체 목록)

이 목록이 R11의 승인 집합이다. 여기 없는 클래스는 쓰지 못한다.

### `doc-meta` — 문서 머리 메타

```html
<ul class="doc-meta">
  <li><strong>범위</strong> <code>origin/main...HEAD</code></li>
  <li><strong>커밋</strong> 15개</li>
</ul>
```

### `cf` / `cf-src` / `cf-loc` — 바뀐 파일 하나의 필드 블록

코드 섹션의 파일 블록(`#### \`file\``) 바로 아래에 온다. 필드마다 `<p>` 하나로 세워
한 문단으로 뭉치지 않게 한다. 출처는 `cf-src` 배지로, 위치 앵커는 `cf-loc` 슬롯으로
산문 밖에 둔다. 필드 라벨은 `<strong>` 으로 쓴다 — 마크다운 `**…**` 는 div 안에서
살지 않는다.

`start`가 unified diff hunk 메타데이터를 저장하고, `code` 제출 때 `cf-loc`의 숫자
`base:`·`head:` 라인 번호를 그 hunk의 base/head 범위와 대조한다. 따라서 실제 첫 줄 hunk라면
`base:…:1 → head:…:1`도 유효하다. hunk 메타데이터가 없을 때는 legacy fallback이 수정 파일의
`:1 → :1` 플레이스홀더를 계속 거부한다. 메타데이터가 있는 경우 신규 파일은 `head:`만, 삭제
파일은 `base:`만 필요하고, zero-count side에는 파일 줄이 없으므로 그쪽 앵커도 없다. 위치는
`git diff base..head -- <file>`의 hunk 헤더에서 확인한다.

```html
<div class="cf">
<p><strong>역할/변경 전</strong> — 비용 입력·출력 item 스키마.</p>
<p><strong>바뀐 것</strong> — <code>supplementCategoryId</code> 단독 strict 로 축소.</p>
<p><strong>왜</strong> — 두 축 공존을 끝낸다 <span class="cf-src">근거</span> "feat!: 카테고리 축으로 고정"</p>
<p><strong>효과</strong> — 구 클라이언트 요청이 검증 단계에서 거부된다.</p>
<p class="cf-loc"><code>base:packages/schemas/src/commerce/supplement-cost.ts:8</code> → <code>head:…:6</code></p>
</div>
```

`cf-src` 배지 텍스트는 셋 중 하나다 — `근거`(diff·커밋·주석에 원문이 있을 때, 뒤에 인용),
`추론`(코드에서 추론될 때, 뒤에 추론 근거), `Unknown / not supplied`(도달 근거 없음, 열린
질문으로 남긴다). 이 출처 태그가 왜 필드에 없으면 R3가 거부한다.

### `arch-entity` — 아키텍처 노드·동작단위 하나의 구조 카드

컴포넌트 레벨의 노드(R18)와 경계 블록의 동작 단위(R15)가 함께 쓰는 단일 컴포넌트다. `cf`와 같은
`<p><strong>라벨</strong> 값>` 필드 규칙에, 변경종류를 `data-change` 속성으로 실어 배지를 붙인다 —
배지 텍스트·색은 render.ts가 소유하므로 저자는 종류(`new`·`mod`·`del`)만 준다. 어느 라벨이 필수인지는
섹션마다 다르다(컴포넌트: `레이어`·`책임`·`인터페이스` / 경계: `한 일`·`영향 인터페이스`).

```html
<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>useSupplementCodeResolver</code></p>
<p><strong>레이어</strong> commerce/entities/supplement/api</p>
<p><strong>책임</strong> fail-closed 해소기를 카드에 공급</p>
<p><strong>인터페이스</strong> <code>{ resolveAlias, resolveDisplay, areCatalogsSettled }</code></p>
</div>
```

`data-change` 는 `new`(신설)·`mod`(변경)·`del`(삭제) 셋 중 하나다. renderer-recognized
`arch-entity` opening tag가 이 허용값을 가져야 R15/R18의 카드로 인정된다. 산출물에 색·style을
직접 쓰지 않는다(R11) — 종류만 주면 render.ts가 색을 붙인다.

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

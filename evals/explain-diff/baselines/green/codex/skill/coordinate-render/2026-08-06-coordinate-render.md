# 트리 선택기의 가로 뷰포트

대상 범위: `068ab5d1^..068ab5d1` — `fix(coding-agent): horizontally pan tree selector`.

## Evidence

| 분류 | 파일 | 근거 |
|---|---|---|
| signal | `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` | 트리 행 렌더링의 절단 방식을 바꾸고, 선택 행의 앵커를 기준으로 가로 이동을 계산한다. |
| signal | `packages/tui/src/index.ts` | `sliceByColumn`을 패키지 공개 API로 내보내 tree selector가 열 단위 절단을 호출하게 한다. |
| noise | 없음 | 변경 파일 두 개 모두 동작 경로에 직접 관여하며, 기본 noise 규칙(`*.lock`, `dist/`, snapshot, generated, 포맷 전용)에 해당하지 않는다. |

`git diff --check 068ab5d1^..068ab5d1`은 출력을 내지 않았다. 이 범위에는 테스트 변경이 없다.

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

터미널 UI의 한 줄은 문자열 길이가 아니라 화면 열(column) 폭으로 제한된다. ANSI 색상 제어 시퀀스는 문자열에는 있지만 화면 열을 차지하지 않고, 넓은 글자는 한 글자가 두 열을 차지할 수 있다. 따라서 트리의 긴 행을 안전하게 잘라내려면 ANSI를 보존하면서 화면 열 기준으로 자르는 `sliceByColumn` 같은 유틸리티가 필요하다.

### 좁은 배경

`TreeList.render(width)`는 커서 2열(`› ` 또는 공백), 트리 들여쓰기·연결선·경로 마커, 라벨, 그리고 메시지 본문을 한 행으로 조합한다. 변경 전에는 완성된 행 전체를 `truncateToWidth(line, width)`로 오른쪽에서 잘랐다. 깊은 노드에서는 들여쓰기와 마커가 폭을 먼저 소비하므로, 선택된 항목의 본문 시작점까지 도달하지 못할 수 있다.

## Intuition

본질은 **왼쪽의 탐색 단서는 고정하고, 선택된 행의 본문이 시작되는 지점만 보이도록 모든 행의 본문을 같은 양만 왼쪽으로 민다**는 것이다.

예를 들어 터미널 폭이 `30`열이면 고정 gutter `2`열을 제외한 본문 뷰포트는 `28`열이다. 선택 행의 본문 앵커가 `22`열일 때, 최소로 보여야 할 앵커 뒤 내용은 `floor(28 / 3) = 9`열이다. `22 > 28 - 9`이므로 스크롤이 필요하다. 이때 `floor(28 / 4) = 7`열의 앞 문맥을 남겨 `22 - 7 = 15`열만큼 본문을 민다. 즉 `30`열 화면에서도 커서 gutter `2`열은 남고, 원래 `22`열에 있던 본문 시작은 본문 뷰포트의 약 `7`열 위치에서 보인다.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
  <div style="border:1px solid #c9c9c9;border-radius:8px;padding:12px"><strong>변경 전</strong><br><code>› ························</code><br><small>깊은 들여쓰기가 30열을 소비해 선택 본문이 오른쪽에서 잘린다.</small></div>
  <div style="border:1px solid #c9c9c9;border-radius:8px;padding:12px"><strong>변경 후</strong><br><code>› ······· [선택 본문…]</code><br><small>gutter 2열은 고정하고 본문만 15열 이동한다.</small></div>
</div>

<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0">
  <span style="border:1px solid #c9c9c9;border-radius:8px;padding:8px">행 조립</span>
  <span>→</span>
  <span style="border:1px solid #c9c9c9;border-radius:8px;padding:8px">선택 행의 앵커 22열 측정</span>
  <span>→</span>
  <span style="border:1px solid #c9c9c9;border-radius:8px;padding:8px">본문 15열 슬라이스</span>
  <span>→</span>
  <span style="border:1px solid #c9c9c9;border-radius:8px;padding:8px">30열로 최종 절단</span>
</div>

## Code

## Change Group 1: 열 단위 슬라이서를 패키지 경계 밖으로 공개한다

> 예고: ANSI와 표시 폭을 보존하는 `sliceByColumn`을 coding-agent가 의존하는 TUI 패키지의 공개 API로 만든다.
>
> 순서: 다음 그룹은 패키지 루트인 `@earendil-works/pi-tui`에서 이 함수를 import하므로, 먼저 그 의존성 경로를 연다.

### `packages/tui/src/index.ts`

**역할/변경 전 맥락** — TUI 패키지의 barrel export는 유틸리티로 `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`만 공개했다. (`base:packages/tui/src/index.ts:109`)

**무엇이 바뀌었나** — 같은 유틸리티 export 목록에 `sliceByColumn`을 추가했다. (`head:packages/tui/src/index.ts:109`)

**왜 필요한가** — `[추론: tree selector는 `@earendil-works/pi-tui` 패키지 루트에서 유틸리티를 import하며, 추가된 import도 그 경로를 사용한다. 따라서 기존 내부 구현을 변경하지 않고 이 호출 경로를 만들려면 barrel export가 필요하다.]`

**시스템 효과** — coding-agent는 내부 파일 경로에 결합하지 않고 ANSI-aware 열 슬라이서를 받아 쓸 수 있다. TUI 패키지의 기존 `sliceByColumn(line, startCol, length, strict)` 구현은 그대로다.

**추적성** — `packages/tui/src/index.ts:109`

## Change Group 2: 선택 행의 앵커를 중심으로 트리 본문을 이동한다

> 예고: 앞 그룹에서 공개한 `sliceByColumn`을 사용해, 선택 행의 본문 앵커가 보일 때만 모든 표시 행의 본문을 같은 가로 오프셋으로 자른다.
>
> 순서: 공개된 열 단위 슬라이서가 있어야 ANSI와 넓은 글자 경계를 보존한 본문 뷰포트를 구성할 수 있다.

### `packages/coding-agent/src/modes/interactive/components/tree-selector.ts`

**역할/변경 전 맥락** — `TreeList.render`는 각 행을 커서, 트리 prefix, 마커, 라벨, 본문으로 즉시 합쳐 선택 행에는 배경색을 씌운 뒤 `truncateToWidth`로 전체 행을 잘랐다. (`base:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:622`, `base:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:686`)

**무엇이 바뀌었나** — 행을 `gutter`와 `body`로 분리해 `HorizontalViewportRow`에 모은 뒤 `renderHorizontalViewport`로 넘긴다. 이 함수는 gutter 폭을 `2`열로 고정하고, 선택 행의 `anchorCol`·행별 `bodyWidth`·전체 `maxBodyWidth`로 오프셋을 계산한다. 필요할 때만 `sliceByColumn(row.body, horizontalScroll, viewportWidth, true)`로 body를 자르고 reset ANSI 시퀀스를 붙인 뒤, 최종 폭을 다시 제한한다. (`head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:41`, `head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:62`, `head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:740`, `head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:751`)

**왜 필요한가** — `[근거: "The tree gutter is always kept visible. The row bodies are shifted left only when the selected row's anchor (the start of its entry text after tree indentation/markers) would otherwise be too far right to see useful content."]`

**시스템 효과** — 선택 행의 본문 시작이 뷰포트 오른쪽으로 밀린 경우에만 가로 이동한다. 보장하려는 앵커 뒤 본문 폭은 `clamp(floor(viewportWidth / 3), 4, 20)`, 남기는 앞 문맥은 `clamp(floor(viewportWidth / 4), 2, 12)`이며, 오프셋은 `maxBodyWidth - viewportWidth`를 넘지 않는다. 모든 행에 같은 오프셋을 적용해 트리의 세로 정렬을 유지한다.

**추적성** — `packages/coding-agent/src/modes/interactive/components/tree-selector.ts:62`

## Verification

- 범위 검증: `git diff --check 068ab5d1^..068ab5d1` 통과.
- 변경 자체의 테스트: 이 커밋은 테스트 파일을 변경하지 않았다. 기존 `packages/coding-agent/test/tree-selector.test.ts`는 선택·필터·접기 동작을 다루지만, 이 범위에서 도입된 가로 뷰포트 계산을 직접 검증하는 항목은 추가되지 않았다.

## Quiz

필수 개념은 6개이며 20개 제한을 넘지 않아 자른 항목은 없다. 아래는 문항 뱅크만 기록한다. 이 문서 생성 단계에서는 출제·채점을 진행하지 않는다.

### `evidence-scope` — 변경 범위

문항: 이 범위의 signal 파일 두 개를 정확한 경로로 쓰고, 각각이 변경하는 책임을 한 문장씩 설명하세요.

채점 루브릭:

- `packages/coding-agent/src/modes/interactive/components/tree-selector.ts`와 가로 뷰포트 렌더링
- `packages/tui/src/index.ts`와 `sliceByColumn`의 공개 export

### `background-columns` — 열 폭 모델

문항: 이 변경에서 단순 문자열 슬라이스가 부적절한 두 이유와, 그 때문에 사용하는 함수 이름을 설명하세요.

채점 루브릭:

- ANSI 제어 시퀀스는 표시 열을 차지하지 않음
- 넓은 글자는 두 열을 차지할 수 있음 및 `sliceByColumn`

### `intuition-30-columns` — 예시의 오프셋

문항: 문서의 30열 예시에서 본문 뷰포트가 28열이 되는 이유, 앵커 22열에서 계산되는 최소 본문 폭, 최종 가로 오프셋을 순서대로 쓰세요.

채점 루브릭:

- gutter가 2열이어서 `30 - 2 = 28`
- `floor(28 / 3) = 9` 및 `22 > 28 - 9`
- 앞 문맥 7열과 오프셋 `22 - 7 = 15`

### `tui-api` — 패키지 경계

문항: `sliceByColumn`은 어느 파일의 어느 줄에서 공개되며, tree selector가 이 공개 API를 필요로 하는 import 경로는 무엇인가요?

채점 루브릭:

- `packages/tui/src/index.ts:109`
- `@earendil-works/pi-tui` 패키지 루트 import

### `viewport-trigger` — 이동 조건

문항: 가로 이동은 어떤 행을 기준으로 시작하며, 그 행의 어떤 값이 어떤 불등식을 만족할 때 시작하나요?

채점 루브릭:

- 선택 행(`isSelected`)과 `anchorCol`
- `anchorCol > viewportWidth - minVisibleAnchorContentWidth`

### `viewport-safety` — 화면 보존 규칙

문항: 가로 이동 중에도 유지되는 두 가지 화면 안전성 규칙과 이를 구현하는 구체 값을 쓰세요.

채점 루브릭:

- cursor gutter `2`열은 body에서 분리해 고정
- `strict=true`인 `sliceByColumn` 및 마지막 `truncateToWidth(line, width, "")`


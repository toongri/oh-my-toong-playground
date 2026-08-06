# 트리 셀렉터 가로 패닝 — `068ab5d1` 변경 설명

- **대상 range**: `068ab5d1^..068ab5d1`
- **커밋 제목**: `fix(coding-agent): horizontally pan tree selector`
- **커밋 본문 전체**: `Fixes #5830`
- **작성일**: 2026-08-06

## Evidence

`git diff --name-only 068ab5d1^..068ab5d1` 이 낸 변경 파일은 두 개다. 둘 다 signal이고 noise는 없다.

| 파일 | 분류 | +/- | 사유 |
|---|---|---|---|
| `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` | signal | +64 / -5 | 이번 변경의 동작이 전부 여기 있다. 새 함수 `renderHorizontalViewport` 와 렌더 루프 재배선 |
| `packages/tui/src/index.ts` | signal | +1 / -1 | 한 줄이지만 패키지 공개면(barrel)의 변경이다. 이 줄이 없으면 위 파일의 import가 컴파일되지 않는다 |

**noise 규칙표 적용 결과 — 해당 없음.** 규칙표(`*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 포맷팅만 바뀐 hunk)에 걸린 파일이 하나도 없고, 규칙표 **밖**의 파일을 noise로 내린 경우도 없다. 따라서 사유를 따로 적어야 할 항목이 없다.

### 이 변경에 등장하지만 diff에는 없는 파일

분류 대상은 아니지만, 문서에서 계속 참조되므로 여기 미리 이름을 붙여 둔다.

| 파일 | 왜 계속 나오나 |
|---|---|
| `packages/tui/src/utils.ts` | `sliceByColumn` 의 실제 구현(`utils.ts:1057`)이 여기 있다. 이 커밋은 이 파일을 **건드리지 않았다** — 함수는 이미 있었고, 바깥으로 내보내지지만 않았을 뿐이다 |
| `packages/coding-agent/test/tree-selector.test.ts` | 트리 셀렉터의 기존 테스트 파일. 이번 커밋에서 **변경되지 않았다** (열린 질문 참조) |

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요. 이 단은 이 저장소의 TUI(터미널 사용자 인터페이스)를 처음 보는 사람을 위한 것이고, 이번 변경만 이해하려면 「좁은 배경」부터 읽어도 된다.

**모노레포와 두 패키지.** 이 저장소는 `packages/` 아래에 여러 패키지를 둔다. 이번 변경에 닿는 건 둘이다.

- `packages/tui` — 화면 그리기 저수준 라이브러리. 패키지 이름은 `@earendil-works/pi-tui` 이고, 바깥에 무엇을 공개할지는 `packages/tui/src/index.ts` 한 파일이 정한다. 이런 파일을 배럴(barrel, 재수출 전용 진입점)이라 부른다. **`src/` 안에 `export` 된 함수라도 배럴에 없으면 패키지 밖에서는 import 할 수 없다.**
- `packages/coding-agent` — 실제 코딩 에이전트. 대화형 모드의 화면 컴포넌트들이 `src/modes/interactive/components/` 아래에 있고, 이번에 고친 트리 셀렉터도 그중 하나다.

**Component 계약.** 이 TUI의 컴포넌트는 `render(width: number): string[]` 하나를 구현한다. 인자 `width` 는 지금 이 컴포넌트에 허락된 가로 칸(column) 수이고, 반환값은 화면에 그대로 얹힐 줄의 배열이다. **줄을 몇 칸으로 자를지는 컴포넌트 자신의 책임이다** — 프레임워크가 넘치는 부분을 알아서 잘라 주지 않는다.

**가시 폭(visible width)과 ANSI.** 색을 입히려면 문자열에 ANSI 이스케이프(`\x1b[...m`)를 끼워 넣는다. 이 바이트들은 화면에서 폭을 차지하지 않으므로 `"문자열".length` 는 화면 폭이 아니다. 그래서 이 패키지는 폭 계산을 전용 함수로 한다.

| 함수 | 하는 일 |
|---|---|
| `visibleWidth(s)` | ANSI를 빼고 실제로 화면에서 차지하는 칸 수를 센다. CJK 같은 두 칸짜리 글자도 2로 센다 |
| `truncateToWidth(text, maxWidth, ellipsis?, pad?)` | **앞에서부터** 잘라 `maxWidth` 에 맞춘다. `ellipsis` 기본값은 `"..."` 이고, 잘렸을 때 끝에 붙는다 |
| `sliceByColumn(line, startCol, length, strict?)` | **중간 구간**을 뽑는다. 즉 `startCol` 칸부터 `length` 칸을 잘라 낸다. `strict` 가 `true` 면 경계에 걸친 두 칸짜리 글자를 버려서 폭이 넘치지 않게 한다 |

`truncateToWidth` 가 "앞을 남기는" 도구라면 `sliceByColumn` 은 "가운데를 뽑는" 도구다. 가로로 화면을 밀어 보려면(=패닝) 필요한 건 후자다.

**트리 셀렉터.** 코딩 에이전트의 세션 기록은 트리다. 사용자 메시지·모델 응답·툴 호출이 노드가 되고, 대화가 갈라지면 가지가 생긴다. 트리 셀렉터는 그 트리를 한 줄에 한 노드씩 그리고 위아래로 골라 들어가는 컴포넌트다. 한 줄은 이런 조각들의 이어붙임이다.

<div style="border:1px solid var(--rule); border-radius:6px; padding:0.75rem 1rem; margin:1rem 0;">
  <div style="font-size:0.8rem; color:var(--muted); margin-bottom:0.5rem;">한 행의 구성 (base·head 공통)</div>
  <table style="width:100%; border-collapse:collapse; font-size:0.86rem;">
    <tr>
      <td style="background:var(--code-bg); border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>cursor</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>prefix</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>foldMarker</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>pathMarker</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>label</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>labelTimestamp</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;"><code>content</code></td>
    </tr>
    <tr style="color:var(--muted); font-size:0.78rem;">
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">2칸<br><code>"› "</code> / <code>"&nbsp;&nbsp;"</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">깊이 × 3칸<br>가지선 <code>│ ├ └</code></td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">0 또는 2칸</td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">0 또는 2칸</td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">가변</td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">가변</td>
      <td style="border:1px solid var(--rule); padding:0.35rem 0.5rem; text-align:center;">엔트리 본문</td>
    </tr>
  </table>
</div>

핵심은 **`prefix` 의 폭이 노드 깊이에 비례해 자란다**는 것이다. 한 단계당 3칸이므로 24단 깊이면 그것만으로 72칸을 먹는다.

### 좁은 배경

여기부터는 이 커밋이 직접 손댄 자리다.

**세로 뷰포트는 이미 있었다.** base의 `render` 는 `startIndex` / `endIndex` 를 계산해 선택 행을 화면 세로 중앙에 두고, 그 창(window) 안의 행만 그린다(`base:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:613`). 즉 **위아래로 미는 개념은 이미 구현돼 있었고, 좌우로 미는 개념만 없었다.**

**base가 한 줄을 완성한 방식은 한 줄짜리였다.** 조각들을 전부 이어 붙이고, 선택 행이면 통째로 배경색을 입히고, `truncateToWidth(line, width)` 로 앞에서부터 잘랐다(`base:.../tree-selector.ts:686`~`690`). `ellipsis` 인자를 주지 않았으므로 넘치는 줄 끝에는 기본값 `"..."` 이 붙었다. 잘리는 방향은 언제나 오른쪽이었다 — 그래서 `prefix` 가 화면을 다 먹으면 정작 읽고 싶은 `content` 가 통째로 화면 밖으로 밀려났다.

**`sliceByColumn` 은 이미 있었고, 이미 같은 목적으로 쓰이고 있었다.** 구현은 `packages/tui/src/utils.ts:1057` 이고, 같은 패키지 안에서 `packages/tui/src/components/input.ts:415` 가 **한 줄짜리 입력창의 가로 스크롤**에 쓴다. 즉 "커서를 기준으로 긴 한 줄을 좌우로 민다"는 패턴은 이 저장소에 선례가 있었다. 없던 것은 그 함수를 `packages/coding-agent` 에서 쓸 수 있게 하는 배럴 한 줄이다.

**`sliceByColumn` 이 ANSI를 다루는 두 가지 방식**은 이번 변경을 읽는 데 꼭 필요하다. 구현체 `sliceWithWidth`(`packages/tui/src/utils.ts:1062`)를 보면,

1. `startCol` **앞쪽**에서 만난 ANSI 코드는 `pendingAnsi` 에 모아 뒀다가 잘라 낸 첫 글자 앞에 한꺼번에 붙인다 → 잘린 구간도 색을 잃지 않는다.
2. `endCol` 에 도달하면 루프를 즉시 끊는다(`if (currentCol >= endCol) break;`) → **문자열 맨 끝에 있던 리셋 코드는 결과에 들어오지 못한다.**

**색 리셋이 부분적이라는 점**도 걸려 있다. `theme.fg` 는 끝에 `\x1b[39m`(전경색만 리셋)을, `theme.bg` 는 `\x1b[49m`(배경색만 리셋)을 붙인다(`packages/coding-agent/src/modes/interactive/theme/theme.ts:354`, `:360`). 둘 다 "전부 리셋"인 `\x1b[0m` 이 아니다. 그래서 위 2번과 합치면 — 선택 행의 배경색을 입힌 문자열을 `sliceByColumn` 으로 자르면 끝의 `\x1b[49m` 이 사라지고 배경색이 다음 줄까지 흘러넘친다.

## Intuition

한 문장으로: **선택된 행이 얼마나 들여쓰였는지를 보고, 화면 전체를 그만큼 왼쪽으로 민다. 커서 자리 2칸만 빼고.**

이 절은 그 한 문장이 실제 숫자로 어떻게 되는지만 본다. 상수의 유래와 코드 배치는 다음 절의 몫이다.

### 하나의 예시로 끝까지 간다

아래 숫자를 이 절 내내 그대로 쓴다.

| 이름 | 값 | 어디서 왔나 |
|---|---|---|
| `width` | **80** | 터미널이 이 컴포넌트에 준 가로 칸 수 |
| 선택 행의 깊이 | **24단** | 세션 트리에서 24번 갈라져 내려간 노드 |
| `anchorCol` | **72** | 24단 × 한 단 3칸 = 72. 마커는 없다고 본다 |
| 창 안 가장 긴 행의 폭 | **200** | 선택 행이 아니어도 된다. 창 전체에서 잰다 |

### 1. Before / After

<div style="display:flex; flex-direction:column; gap:1.25rem; margin:1.25rem 0;">

  <div style="border:1px solid var(--rule); border-radius:6px; padding:0.75rem;">
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:0.5rem;"><strong>BEFORE</strong> — 오른쪽만 자른다 (<code>truncateToWidth(line, 80)</code>)</div>
    <div style="display:flex; height:2.1rem; font-size:0.72rem; line-height:2.1rem; text-align:center; overflow:hidden; border-radius:4px;">
      <div style="width:2.5%; background:#7aa7e6; color:#111;">›</div>
      <div style="width:90%; background:var(--code-bg); border-left:1px solid var(--rule); border-right:1px solid var(--rule);">prefix — 72칸의 가지선</div>
      <div style="width:7.5%; background:#e6b17a; color:#111;">co…</div>
    </div>
    <div style="font-size:0.76rem; color:var(--muted); margin-top:0.4rem;">
      content 는 화면 74열에서 시작 → 남은 칸 <strong>6</strong>, 그중 3칸은 말줄임 <code>"..."</code> 이 먹는다. <strong>읽히는 글자 3칸.</strong>
    </div>
  </div>

  <div style="border:1px solid var(--rule); border-radius:6px; padding:0.75rem;">
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:0.5rem;"><strong>AFTER</strong> — 커서 2칸은 고정, 나머지를 60칸 왼쪽으로 민다</div>
    <div style="display:flex; height:2.1rem; font-size:0.72rem; line-height:2.1rem; text-align:center; overflow:hidden; border-radius:4px;">
      <div style="width:2.5%; background:#7aa7e6; color:#111;">›</div>
      <div style="width:15%; background:var(--code-bg); border-left:1px solid var(--rule); border-right:1px solid var(--rule);">prefix 꼬리 12칸</div>
      <div style="width:82.5%; background:#e6b17a; color:#111;">content — 66칸</div>
    </div>
    <div style="font-size:0.76rem; color:var(--muted); margin-top:0.4rem;">
      body 를 60열부터 잘라 냈으므로 앵커(72)가 화면 <strong>14</strong>열에 온다. content 에 <strong>66</strong>칸이 돌아왔다.
    </div>
  </div>

</div>

같은 줄, 같은 `width` **80** 이다. 바뀐 것은 **어느 구간을 보여 줄지** 하나뿐이다. BEFORE는 항상 0열부터 시작했고, AFTER는 선택 행의 `anchorCol` **72** 를 보고 시작 열을 **60** 으로 옮긴다. 그래서 읽히는 글자가 3칸에서 **66** 칸이 됐다.

한 가지가 그대로라는 점이 중요하다. 커서 칸(`›`) 2칸은 **잘라 내는 대상이 아니다.** 밀린 것은 그 오른쪽 78칸뿐이고, 그래서 "지금 어느 행이 선택돼 있나"는 아무리 밀어도 화면에서 사라지지 않는다.

### 2. 데이터 흐름 + 예시 값

<div style="border:1px solid var(--rule); border-radius:6px; padding:1rem; margin:1.25rem 0; font-size:0.85rem;">
  <div style="display:flex; align-items:stretch; gap:0.6rem; flex-wrap:wrap;">
    <div style="flex:1 1 12rem; background:var(--code-bg); border-radius:4px; padding:0.6rem;">
      <div style="font-weight:600; margin-bottom:0.3rem;">행 하나 → 4개 값</div>
      <div style="font-family:ui-monospace,monospace; font-size:0.78rem; line-height:1.7;">
        gutter&nbsp;&nbsp;&nbsp;= <code>"› "</code><br>
        body&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= prefix+label+content<br>
        anchorCol = <strong>72</strong><br>
        bodyWidth = 200
      </div>
    </div>
    <div style="align-self:center; font-size:1.3rem; color:var(--muted);">→</div>
    <div style="flex:1 1 14rem; background:var(--code-bg); border-radius:4px; padding:0.6rem;">
      <div style="font-weight:600; margin-bottom:0.3rem;">밀지 말지 정한다</div>
      <div style="font-family:ui-monospace,monospace; font-size:0.78rem; line-height:1.7;">
        viewportWidth = 80 − 2 = <strong>78</strong><br>
        최소 노출폭&nbsp;&nbsp;&nbsp;&nbsp;= min(20, max(4, ⌊78/3⌋)) = <strong>20</strong><br>
        임계&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= 78 − 20 = <strong>58</strong><br>
        <span style="color:#c76a3a;">72 &gt; 58 → 민다</span>
      </div>
    </div>
    <div style="align-self:center; font-size:1.3rem; color:var(--muted);">→</div>
    <div style="flex:1 1 14rem; background:var(--code-bg); border-radius:4px; padding:0.6rem;">
      <div style="font-weight:600; margin-bottom:0.3rem;">얼마나 밀지 정한다</div>
      <div style="font-family:ui-monospace,monospace; font-size:0.78rem; line-height:1.7;">
        여유분&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= min(12, max(2, ⌊78/4⌋)) = <strong>12</strong><br>
        상한&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= 200 − 78 = <strong>122</strong><br>
        이동량&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= min(122, 72 − 12) = <strong>60</strong>
      </div>
    </div>
  </div>
  <div style="margin-top:0.8rem; padding-top:0.6rem; border-top:1px dashed var(--rule); font-family:ui-monospace,monospace; font-size:0.78rem;">
    ⇒ 창 안 <strong>모든</strong> 행에 같은 60 을 적용 → <code>gutter + sliceByColumn(body, 60, 78, true) + "\x1b[0m"</code>
  </div>
</div>

숫자 세 개가 순서대로 나온다. **78**(밀 수 있는 폭) → **58**(이 열보다 앵커가 오른쪽이면 민다) → **60**(실제로 미는 양). 마지막 60이 나오는 산수만 조금 낯설다: 앵커 **72** 를 화면 왼쪽 끝에 딱 붙이지 않고 **12** 칸을 남겨 둔다. 그래야 화면에 가지선 꼬리가 조금 보이고, 이 행이 트리의 어디쯤인지가 남는다. 그 12칸이 위 AFTER 그림의 "prefix 꼬리 12칸"이다.

그리고 마지막 줄이 이 설계의 조용한 핵심이다. **이동량 60은 선택 행 하나를 보고 정하지만, 창 안의 모든 행에 똑같이 적용된다.** 행마다 따로 밀면 가지선의 세로 정렬이 무너져 트리가 트리로 안 보인다.

### 3. 파일 / 모듈 지도

<div style="border:1px solid var(--rule); border-radius:6px; padding:1rem; margin:1.25rem 0; font-size:0.85rem;">
  <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
    <div style="background:var(--code-bg); border:1px dashed var(--rule); border-radius:4px; padding:0.5rem 0.7rem;">
      <div style="font-size:0.74rem; color:var(--muted);">변경 없음 · 이미 있던 것</div>
      <code>packages/tui/src/utils.ts:1057</code><br>
      <span style="font-size:0.78rem;"><code>sliceByColumn</code> 구현</span>
    </div>
    <div style="font-size:1.3rem; color:var(--muted);">→</div>
    <div style="background:var(--code-bg); border:2px solid #c76a3a; border-radius:4px; padding:0.5rem 0.7rem;">
      <div style="font-size:0.74rem; color:#c76a3a;">변경 ① · 한 줄</div>
      <code>packages/tui/src/index.ts:109</code><br>
      <span style="font-size:0.78rem;">배럴에 <code>sliceByColumn</code> 추가</span>
    </div>
    <div style="font-size:1.3rem; color:var(--muted);">→</div>
    <div style="background:var(--code-bg); border:2px solid #c76a3a; border-radius:4px; padding:0.5rem 0.7rem;">
      <div style="font-size:0.74rem; color:#c76a3a;">변경 ② · 본체</div>
      <code>.../components/tree-selector.ts</code><br>
      <span style="font-size:0.78rem;"><code>renderHorizontalViewport</code> 신설 + 렌더 루프 재배선</span>
    </div>
  </div>
  <div style="margin-top:0.8rem; padding-top:0.6rem; border-top:1px dashed var(--rule); font-size:0.8rem; color:var(--muted);">
    같은 <code>sliceByColumn</code> 을 이미 쓰던 곳 (변경 없음): <code>packages/tui/src/components/input.ts:415</code> — 한 줄 입력창의 가로 스크롤
  </div>
</div>

화살표가 왼쪽에서 오른쪽으로 하나뿐이라는 게 이 변경의 모양이다. 새 알고리즘을 만든 게 아니라, `packages/tui/src/utils.ts:1057` 에 이미 있던 도구를 패키지 경계 밖으로 한 칸 내보내고(변경 ①), 그것으로 화면을 다시 조립했다(변경 ②). `packages/tui/src/components/input.ts:415` 가 한 줄 입력창에서 하던 일을, 이번엔 여러 줄짜리 트리에 한 것이다.

### 4. 상태 전이 — `horizontalScroll` 이 가질 수 있는 세 값

<div style="border:1px solid var(--rule); border-radius:6px; padding:1rem; margin:1.25rem 0;">
  <table style="width:100%; border-collapse:collapse; font-size:0.84rem;">
    <tr>
      <th style="border:1px solid var(--rule); padding:0.45rem 0.6rem; background:var(--code-bg); text-align:left;">상태</th>
      <th style="border:1px solid var(--rule); padding:0.45rem 0.6rem; background:var(--code-bg); text-align:left;">들어가는 조건</th>
      <th style="border:1px solid var(--rule); padding:0.45rem 0.6rem; background:var(--code-bg); text-align:left;">이 예시에서</th>
    </tr>
    <tr>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;"><strong>안 민다</strong><br><code>= 0</code></td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">선택 행이 없거나 · 창 안 최장 폭이 78 이하거나 · 앵커가 58 이하</td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">깊이 4단 노드를 고르면 앵커 = 12 → 12 ≤ 58 → <strong>0</strong></td>
    </tr>
    <tr>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;"><strong>앵커 기준</strong><br><code>= anchorCol − 여유분</code></td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">앵커가 58 초과이고, 그 값이 상한보다 작을 때</td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">72 − 12 = 60, 상한 122 보다 작다 → <strong>60</strong></td>
    </tr>
    <tr>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;"><strong>상한에 걸림</strong><br><code>= maxHorizontalScroll</code></td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">앵커 기준 값이 상한을 넘을 때</td>
      <td style="border:1px solid var(--rule); padding:0.45rem 0.6rem;">최장 폭이 200 대신 100이면 상한 = 22 → 60 대신 <strong>22</strong></td>
    </tr>
  </table>
</div>

세 번째 줄이 상한이 하는 일을 보여 준다. 앵커만 보면 **60** 을 밀어야 하지만, 창 안에서 가장 긴 행이 100칸밖에 안 되면 60을 밀어 버리는 순간 화면 오른쪽이 통째로 빈다. 그래서 "가장 긴 행의 끝이 화면 오른쪽 끝에 닿는" 지점인 **22** 에서 멈춘다. 즉 이동량 60은 **원하는 값**이고, 실제 값은 그 원하는 값과 상한 중 작은 쪽이다.

그리고 이 상태는 **저장되지 않는다.** `horizontalScroll` 은 매 `render` 호출에서 처음부터 다시 계산된다. 사용자가 좌우 키를 눌러 조작하는 값이 아니라, 위아래로 선택을 옮길 때마다 따라오는 값이다.

## Change Group 1: 열 단위 슬라이스를 패키지 공개면에 올린다

> 예고: 이 그룹은 화면에 보이는 것을 하나도 바꾸지 않는다. 다른 패키지가 부를 수 있는 함수가 하나 늘어날 뿐이고, 코드 변화는 재수출 목록에 이름 하나 추가하는 것이 전부다.
> 순서: 이 그룹이 먼저인 이유는 컴파일 순서 그대로다 — 배럴이 내보내지 않는 이름은 다른 패키지에서 import 할 수 없으므로, 뒤 그룹이 성립하려면 이 줄이 먼저 있어야 한다.

### `packages/tui/src/index.ts`

**역할/변경 전 맥락** — 이 파일은 `@earendil-works/pi-tui` 패키지가 바깥에 무엇을 보여 줄지 정하는 배럴이다. 마지막 `// Utilities` 주석 아래 한 줄이 유틸 함수 셋 — `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi` — 을 재수출하고 있었다 (`base:packages/tui/src/index.ts:109`). `sliceByColumn` 은 그 목록에 없었다. 함수 자체는 `packages/tui/src/utils.ts:1057` 에 `export function` 으로 진작 존재했고 같은 패키지 안에서는 이미 쓰이고 있었지만(`packages/tui/src/components/input.ts:415`, `packages/tui/src/tui.ts:1177`), 배럴에 없으니 패키지 **밖**에서는 존재하지 않는 것과 같았다.

**무엇이 바뀌었나** — 같은 줄의 재수출 목록 맨 앞, 알파벳 순서 자리에 `sliceByColumn` 하나가 들어갔다 (`head:packages/tui/src/index.ts:109`). 셋이 넷이 된 것 말고 다른 변화는 없다. 파일의 나머지 108줄은 그대로이고, `packages/tui/src/utils.ts` 는 이 커밋에서 아예 열리지 않았다 — **구현은 손대지 않고 가시성만 바꿨다.**

**왜 필요한가** — 같은 커밋이 `packages/coding-agent` 쪽에서 이 이름을 `@earendil-works/pi-tui` 로부터 import 하기 때문이다(`head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:9`). 이 한 줄이 없으면 그 import 가 해석되지 않는다. [추론: 커밋 메시지(`fix(coding-agent): horizontally pan tree selector` / `Fixes #5830`)와 diff의 어느 주석도 배럴을 여는 이유를 따로 적지 않았다. 근거로 삼은 것은 두 코드 사실뿐이다 — base 배럴에 이 이름이 없었다는 것(`base:packages/tui/src/index.ts:109`), 그리고 같은 커밋이 패키지 경계 너머에서 그 이름을 쓴다는 것]

**시스템 효과** — `@earendil-works/pi-tui` 의 공개 API가 함수 하나만큼 넓어진다. 지금 소비자는 트리 셀렉터 하나뿐이지만, 배럴에 오른 이름은 그 뒤로 호환성을 지켜야 하는 대상이 된다 — 이 커밋이 실질적으로 감수한 유일한 장기 비용이 그것이다. 반대로 런타임 비용은 없다: 재수출은 값을 새로 만들지 않고, 기존 세 이름의 동작에도 영향이 없다.

**추적성** — `packages/tui/src/index.ts:109`

## Change Group 2: 선택 행의 앵커를 기준으로 창 전체를 가로로 민다

> 예고: 앞 그룹이 공개면에 올려놓은 `sliceByColumn` 을 실제로 쓰는 쪽이다. 여기서 뷰포트를 계산하는 순수 함수가 새로 생기고, 기존 렌더 루프는 줄을 직접 완성하던 역할을 내려놓고 그 함수에 넘길 재료만 모으게 된다.
> 순서: 앞 그룹이 import 를 가능하게 만들어 두지 않았다면 이 그룹은 파일 9번째 줄에서 이미 타입 검사에 실패한다. 도구를 여는 쪽이 도구를 쓰는 쪽보다 먼저여야 했다.

### `packages/coding-agent/src/modes/interactive/components/tree-selector.ts`

**역할/변경 전 맥락** — 이 파일의 `TreeList.render(width)` 가 세션 트리를 줄 배열로 만든다. base에서는 세로 창을 먼저 정하고(`base:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:613`, `endIndex` 는 `:620`), 그 창 안의 행마다 조각들을 하나의 문자열로 이어 붙인 뒤(`base:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:686`) 선택 행이면 통째로 배경색을 입히고 `lines.push(truncateToWidth(line, width))` 로 곧장 결과 배열에 넣었다. 가로로 자르는 지점이 그 `truncateToWidth` 한 번뿐이었고, 그 함수는 언제나 0열부터 남긴다 — **행 안의 어느 구간을 보여 줄지 고를 자리가 구조적으로 없었다.**

**무엇이 바뀌었나** — 세 덩어리다.

1. **import 한 줄** — `sliceByColumn` 이 들어왔다 (`head:packages/coding-agent/src/modes/interactive/components/tree-selector.ts:9`).
2. **새 타입 · 상수 · 순수 함수** — 행 하나를 `{ gutter, body, anchorCol, bodyWidth, isSelected }` 다섯 필드로 표현하는 `HorizontalViewportRow` 가 생기고(`head:...:41`), 상수 다섯 개가 붙고(`head:...:49`~`:53`), 그 행들과 `width` 만 받아 최종 줄 배열을 내는 `renderHorizontalViewport` 가 신설됐다 (`head:...:62`). 이 함수는 `this` 를 쓰지 않는 파일 스코프 함수다.
3. **루프 재배선** — 루프 앞에 `renderedRows` 가 생기고(`head:...:676`), 루프 끝에서 완성된 줄 대신 레코드를 담고(`head:...:748`), 루프가 끝난 뒤 한 번에 `lines.push(...renderHorizontalViewport(renderedRows, width))` 로 펼친다 (`head:...:751`).

3번 안에서 실제로 갈라진 것은 base의 한 줄짜리 `line` 이 **둘로 쪼개졌다**는 점이다. `cursor` 는 `gutter` 가 되고 나머지는 `body` 가 되며, 선택 행의 배경색은 통짜가 아니라 두 조각에 각각 입혀진다 (`head:...:744`~`:747`). 그리고 `theme.fg("dim", prefix) + foldMarker + pathMarker` 를 `prefixPart` 라는 이름으로 따로 잡아, 그 가시 폭을 재서 `anchorCol` 로 기록한다 (`head:...:740`~`:741`). 이 값이 Intuition에서 **72** 로 썼던 그 앵커다 — `label` 과 `labelTimestamp` 는 앵커 **뒤**로 간다.

`renderHorizontalViewport` 안의 계산은 Intuition의 흐름과 1:1로 맞는다. `viewportWidth = width − TREE_GUTTER_WIDTH`, `maxHorizontalScroll = maxBodyWidth − viewportWidth`, 그리고 `anchorCol > viewportWidth − minVisibleAnchorContentWidth` 일 때만 `horizontalScroll = min(maxHorizontalScroll, anchorCol − anchorContextWidth)` 를 잡는다 (`head:...:63`~`:82`). 상수 다섯 개 중 넷은 두 개씩 짝을 이뤄 **비율 계산의 상·하한**으로만 쓰인다.

| 상수 | 값 | 하는 일 |
|---|---|---|
| `TREE_GUTTER_WIDTH` | 2 | 절대 잘리지 않는 커서 칸의 폭. `cursor` 가 `"› "` 또는 `"  "` 로 항상 2칸인 것과 맞춘 값 |
| `MIN_VISIBLE_ANCHOR_CONTENT_WIDTH` | 4 | `⌊viewportWidth/3⌋` 의 하한 — 아주 좁은 터미널에서도 최소 4칸은 보이게 |
| `MAX_VISIBLE_ANCHOR_CONTENT_WIDTH` | 20 | 같은 값의 상한 — 아주 넓은 터미널에서 임계가 과하게 왼쪽으로 오는 것을 막는다 |
| `MIN_ANCHOR_CONTEXT_WIDTH` | 2 | `⌊viewportWidth/4⌋` 의 하한 — 앵커 왼쪽에 남길 가지선 여유 |
| `MAX_ANCHOR_CONTEXT_WIDTH` | 12 | 같은 값의 상한 |

마지막으로 잘라 내는 방식이 바뀌었다. 밀어야 할 때는 `` `${row.gutter}${sliceByColumn(row.body, horizontalScroll, viewportWidth, true)}\x1b[0m` `` 로 조립하고, 밀 필요가 없으면 `row.gutter + row.body` 를 그대로 쓴다. 어느 쪽이든 마지막에 `truncateToWidth(line, width, "")` 를 통과한다 (`head:...:85`~`:91`).

**왜 필요한가** — 새 함수의 JSDoc이 의도를 직접 적어 둔다. [근거: "The row bodies are shifted left only when the selected row's anchor (the start of its entry text after tree indentation/markers) would otherwise be too far right to see useful content."] 커밋 제목 `fix(coding-agent): horizontally pan tree selector` 도 같은 것을 말하고, 루프 안 주석 `Only pan horizontally when needed to keep enough selected-row content visible after its anchor.` 이 "필요할 때만"이라는 조건까지 못 박는다. 세 문장이 공통으로 말하는 것은 하나다 — 깊이 들여쓰인 노드에서 정작 읽어야 할 엔트리 본문이 화면 오른쪽 밖으로 밀려나는 것을 막는다. 다만 **원 이슈 #5830 이 정확히 무엇을 보고했는지는 이 워크트리에서 확인할 수 없다** (열린 질문 참조).

**시스템 효과** — 다섯 가지가 갈린다.

- **얕은 트리는 완전히 그대로다.** `horizontalScroll` 이 0이면 조립식은 `row.gutter + row.body` 이고, 이는 base의 `line` 과 같은 문자열이다. 앵커가 임계 이하인 한 이 변경은 관측되지 않는다.
- **말줄임이 사라졌다 — 깊이와 무관하게.** base는 `truncateToWidth(line, width)` 로 기본 말줄임 `"..."` 을 썼고, head는 `truncateToWidth(line, width, "")` 로 빈 문자열을 명시한다. 넘치는 줄이 이제 `...` 없이 딱 잘린다. 위 항목의 "완전히 그대로"에 걸리는 유일한 예외가 이것이다.
- **배경색 누수가 막혔다.** `sliceByColumn` 은 `endCol` 에 닿는 순간 루프를 끊으므로 문자열 끝의 `\x1b[49m` 을 결과에 담지 못한다(`packages/tui/src/utils.ts:1101`). 그래서 민 경우에만 `\x1b[0m` 을 손으로 덧붙인다. 안 민 경로에는 원래 리셋이 살아 있으므로 붙이지 않는다.
- **트리 정렬이 유지된다.** `horizontalScroll` 은 선택 행 하나로 정해지지만 `rows.map` 이 모든 행에 같은 값을 적용한다. 행마다 다른 값을 쓰면 세로 가지선이 어긋난다.
- **뷰포트 밖은 안 밀린다.** 하단 카운터 `  (n/m)` 은 `renderHorizontalViewport` 의 결과를 펼친 **뒤에** 따로 push 되고(`head:...:752`), 항목이 없을 때의 조기 반환 경로(`head:...:661`)도 손대지 않았다.

**추적성** — `packages/coding-agent/src/modes/interactive/components/tree-selector.ts:9`, `:41`, `:49`, `:62`, `:676`, `:740`, `:748`, `:751`

## 열린 질문

이 두 가지는 워크트리 안에서 답을 찾지 못했다. 사용자에게 묻지 않고 여기 남긴다.

**1. 이슈 #5830 의 본문은 무엇인가 — `Unknown / not supplied`.** 커밋 본문은 `Fixes #5830` 한 줄이 전부이고, 저장소 전체에서 `5830` 을 문자열로 찾아도 이 커밋의 참조 말고는 나오지 않는다. 따라서 "제보된 증상이 정확히 무엇이었는지"(가로 스크롤이 아예 없다는 신고였는지, 특정 깊이에서의 잘림이었는지, 다른 무엇이었는지)는 **이 문서가 알 수 없다.** 코드가 고치는 것이 무엇인지는 위에 근거를 붙여 적었지만, 그것이 이슈가 요구한 전부였는지는 별개의 질문이고 여기서는 미해결로 둔다.

**2. 왜 테스트가 없는가.** `packages/coding-agent/test/tree-selector.test.ts` 에는 렌더 관련 테스트가 이미 있다(예: `renders semantic help rows without truncating narrow terminal controls`). `renderHorizontalViewport` 는 `this` 도 부수효과도 없는 순수 함수라 값 몇 개만 넣으면 검증되는 형태인데, 이 커밋은 그 파일을 열지 않았다. 판단을 유보할 근거가 diff 안에 없다 — `Unknown / not supplied`.

## 문항 뱅크

필수 개념 **6개**, 문항 **12개**다. 상한 20개를 넘지 않았으므로 **잘라 낸 문항은 없다.**

개념은 섹션마다 최소 하나씩 잡았고, Code 섹션은 이 diff가 건드린 서브시스템 셋 — 패키지 공개면 · 뷰포트 계산 함수 · 렌더 루프 — 마다 하나씩이다.

| 개념 id | 대응 섹션 | 문항 |
|---|---|---|
| `evidence-signal-noise` | Evidence | Q1-1, Q1-2 |
| `background-vertical-only` | Background | Q2-1, Q2-2 |
| `intuition-pan-decision` | Intuition | Q3-1, Q3-2 |
| `code-barrel-export` | Change Group 1 | Q4-1, Q4-2 |
| `code-viewport-function` | Change Group 2 · `renderHorizontalViewport` | Q5-1, Q5-2 |
| `code-render-rewire` | Change Group 2 · 렌더 루프 | Q6-1, Q6-2 |

문항은 전부 서술형 단답이다. 선지를 보여 주지 않는다 — 선지가 보이면 재는 것이 회상에서 재인으로 내려간다. 각 문항 아래의 루브릭 항목은 채점 기준이고, ★ 표시는 **문서를 읽지 않으면 알 수 없는 구체 값**을 요구하는 항목이다.

### 개념 1 — `evidence-signal-noise`

**Q1-1.** 이 커밋이 바꾼 파일은 몇 개인가. 그중 한 파일은 딱 한 줄만 바뀌었는데도 signal로 분류됐다 — 어느 파일이고 그 근거는 무엇인가. 그리고 noise로 내려간 파일은 몇 개인가.

- 루브릭 ①★ 변경 파일은 2개이고 두 이름을 모두 짚는다
- 루브릭 ② `packages/tui/src/index.ts` 가 한 줄짜리인데도 signal인 이유 — 그 줄이 패키지 공개면(배럴)이고, 없으면 다른 파일이 컴파일되지 않는다
- 루브릭 ③ noise는 0개다 — 규칙표에 걸린 파일이 없었다

**Q1-2.** `packages/tui/src/utils.ts` 는 이 문서에 계속 등장하는데 Evidence 분류표에는 signal로도 noise로도 없다. 왜 분류 대상이 아니며, 그런데도 계속 등장하는 이유는 무엇인가.

- 루브릭 ① 이 커밋이 그 파일을 바꾸지 않았다 — 변경 파일 목록에 없으므로 분류할 대상 자체가 아니다
- 루브릭 ②★ 계속 나오는 이유는 `sliceByColumn` 의 실제 구현이 거기(`utils.ts:1057`) 있기 때문이다

### 개념 2 — `background-vertical-only`

**Q2-1.** base의 트리 셀렉터에도 이미 "뷰포트"라 부를 만한 것이 있었다. 그것은 무엇이었고, 이번 변경이 더한 것은 그것과 어떤 축에서 다른가.

- 루브릭 ①★ base에도 세로 창이 있었다 — `startIndex` / `endIndex` 로 선택 행을 화면 세로 중앙에 두고 그 구간만 그렸다
- 루브릭 ② 이번에 더한 것은 같은 창의 가로 축이다. 즉 위아래로 미는 개념은 있었고 좌우로 미는 개념만 없었다

**Q2-2.** `truncateToWidth` 와 `sliceByColumn` 은 둘 다 문자열을 주어진 폭에 맞춘다. 이 변경에서 왜 앞의 것만으로는 안 됐는가.

- 루브릭 ① `truncateToWidth` 는 언제나 0열부터 앞을 남긴다 — 보여 줄 구간의 시작 열을 고를 수 없다
- 루브릭 ②★ `sliceByColumn` 은 `startCol` 인자를 받아 문자열 중간 구간을 뽑는다. 가로 패닝에 필요한 건 그 시작 열이다

### 개념 3 — `intuition-pan-decision`

**Q3-1.** `width` 가 80, 선택 행의 `anchorCol` 이 72, 창 안 가장 긴 행의 폭이 200이라 하자. 실제 이동량은 얼마이며, 그 값이 나오기까지의 두 단계를 순서대로 설명하라.

- 루브릭 ①★ 이동량은 60이다
- 루브릭 ②★ 1단계(밀 것인가) — 임계는 `viewportWidth 78 − 최소 노출폭 20 = 58` 이고, 앵커 72가 그보다 크므로 민다
- 루브릭 ③★ 2단계(얼마나) — 앵커 72에서 여유분 12를 뺀 60. 앵커를 화면 왼쪽 끝에 붙이지 않고 여유를 남기는 것이 이 뺄셈의 뜻이다

**Q3-2.** Q3-1과 모든 조건이 같은데 창 안 가장 긴 행의 폭만 200에서 100으로 바뀌면 이동량은 어떻게 되는가. 그리고 그런 상한이 존재하는 이유는 무엇인가.

- 루브릭 ①★ 이동량은 22가 된다
- 루브릭 ②★ 상한은 `가장 긴 행의 폭 100 − viewportWidth 78 = 22` 이고, 앵커 기준값 60 대신 이 상한이 선택된다 (둘 중 작은 쪽)
- 루브릭 ③ 상한이 필요한 이유 — 그보다 더 밀면 창에서 가장 긴 행조차 끝나 버려 화면 오른쪽이 빈다

### 개념 4 — `code-barrel-export`

**Q4-1.** `sliceByColumn` 은 이 커밋 이전에도 이미 존재했고 같은 패키지 안에서 쓰이고 있었다. 그런데도 재수출 한 줄을 추가해야 했던 이유는 무엇이고, 그 줄이 없으면 정확히 무엇이 깨지는가.

- 루브릭 ①★ base 배럴(`packages/tui/src/index.ts:109`)의 재수출 목록에 그 이름이 없어서, 패키지 밖에서는 import 할 수 없었다
- 루브릭 ② 같은 커밋의 `tree-selector.ts` 가 `@earendil-works/pi-tui` 에서 그 이름을 가져오므로, 줄이 없으면 그 import 가 해석되지 않아 컴파일이 실패한다

**Q4-2.** 이 그룹의 "왜 필요한가"에는 `[근거: ]` 가 아니라 `[추론: ]` 라벨이 붙어 있다. 무엇을 근거로 삼았고, 무엇이 없어서 근거가 아닌 추론이 되었는가.

- 루브릭 ① 근거로 삼은 것은 두 개의 코드 사실이다 — base 배럴에 그 이름이 없었다는 것, 그리고 같은 커밋이 패키지 경계 밖에서 그 이름을 쓴다는 것
- 루브릭 ②★ 없는 것은 그 이유를 말한 문장이다. 커밋 본문은 `Fixes #5830` 한 줄이 전부이고, diff의 어느 주석도 배럴을 여는 이유를 적지 않았다

### 개념 5 — `code-viewport-function`

**Q5-1.** `anchorCol` 은 어떤 문자열의 가시 폭으로 계산되는가. 행의 조각들 중 무엇이 그 문자열에 들어가고 무엇이 빠지는지, 빠지는 것들이 왜 빠지는지 함께 답하라.

- 루브릭 ①★ `prefixPart`, 즉 `theme.fg("dim", prefix) + foldMarker + pathMarker` 의 `visibleWidth` 다
- 루브릭 ② `label` · `labelTimestamp` · `content` 는 빠진다 — 앵커는 "엔트리 텍스트가 시작하는 열"이므로 그것들은 앵커 뒤에 온다
- 루브릭 ③ `cursor` 도 빠진다 — 그것은 `body` 가 아니라 `gutter` 쪽이고, 애초에 `body` 의 좌표계 밖이다

**Q5-2.** 새로 생긴 상수 다섯 개 중 `TREE_GUTTER_WIDTH` 만 성격이 다르다. 나머지 넷은 무슨 일에 쓰이며, `TREE_GUTTER_WIDTH` 의 값 2는 코드의 무엇과 맞춘 숫자인가.

- 루브릭 ①★ 나머지 넷은 두 개씩 짝을 이뤄 비율 계산의 하한·상한으로만 쓰인다 — `⌊viewportWidth/3⌋` 에 4와 20, `⌊viewportWidth/4⌋` 에 2와 12
- 루브릭 ②★ 2는 `cursor` 가 `"› "` 또는 두 칸 공백으로 언제나 2칸인 것과 맞춘 값이고, 잘라 내는 대상에서 빠지는 고정 폭이다

### 개념 6 — `code-render-rewire`

**Q6-1.** base의 루프는 행 하나를 만들 때마다 `lines` 에 곧장 넣었다. head의 루프는 무엇을 어디에 넣으며 `lines` 는 언제 채워지는가. 그리고 이 구조 변경이 선택이 아니라 **필연**이었던 이유는 무엇인가.

- 루브릭 ①★ head 루프는 `renderedRows` 에 `HorizontalViewportRow` 레코드를 담고, `lines` 는 루프가 끝난 뒤 `lines.push(...renderHorizontalViewport(renderedRows, width))` 한 번으로 채워진다
- 루브릭 ② 필연인 이유 — 이동량이 창 안 **가장 긴 행의 폭**과 **선택 행의 앵커**에 함께 의존하므로, 창 안 모든 행을 다 본 뒤에야 값이 정해진다. 행을 하나씩 완성해 흘려보내는 구조로는 계산할 수 없다

**Q6-2.** 최종 줄을 조립할 때 `\x1b[0m` 은 민 경로에만 붙는다. 왜 민 경로에서만 필요하고 안 민 경로에서는 필요 없는가. 두 가지 사실이 겹쳐야 답이 된다.

- 루브릭 ①★ `sliceByColumn` 은 `endCol` 에 닿는 순간 루프를 끊으므로(`utils.ts:1101`) 문자열 **끝**에 있던 리셋 코드를 결과에 담지 못한다
- 루브릭 ②★ `theme.bg` 가 붙이는 것은 전체 리셋 `\x1b[0m` 이 아니라 배경만 되돌리는 `\x1b[49m` 이다. 그게 잘려 나가면 배경색이 그 뒤로 흘러넘친다
- 루브릭 ③ 안 민 경로는 `row.gutter + row.body` 를 자르지 않고 그대로 쓰므로 원래의 리셋이 살아 있다

---

> **이 실행에 대한 기록.** 스킬의 6번째 스텝(퀴즈 출제·채점)은 이번 실행에서 **진행하지 않았다.** 요청 범위가 `render` 스텝까지였고 답할 사람이 없었기 때문이다. 위 12문항과 루브릭은 뱅크로만 남긴다. 마찬가지로 상태 CLI(`explain-diff-state.ts`)는 이번 실행에서 호출하지 않았다 — 문서는 각 스텝의 형식 계약을 따라 작성했고, 스크립트가 판정하는 항목(R1~R5)은 `lib/explain-diff-structure.ts` 의 `checkStructure` 를 직접 돌려 5개 전부 통과를 확인했다.

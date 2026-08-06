# 트리 셀렉터 가로 패닝 (horizontal pan) 변경 설명

- **커밋**: `068ab5d1` — `fix(coding-agent): horizontally pan tree selector` (Fixes #5830)
- **작성자**: Vegard Stikbakke, 2026-06-17
- **변경 규모**: 2개 파일, +64 / -5
  - `packages/coding-agent/src/modes/interactive/components/tree-selector.ts`
  - `packages/tui/src/index.ts`

---

## 1. 한 줄 요약

세션 트리(session tree)가 깊게 중첩되면 들여쓰기가 화면 오른쪽 끝을 넘어가 엔트리 텍스트가 안 보이던 문제를,
**선택된 행의 텍스트 시작 지점(anchor)을 기준으로 화면 전체를 가로로 밀어주는(pan) 뷰포트**를 도입해 고쳤다.

---

## 2. 배경: 무엇이 문제였나

`tree-selector.ts`의 `TreeList.render(width)`는 대화형 모드에서 세션 트리를 그리는 컴포넌트다.
한 행은 다음 조각들을 이어 붙여 만든다.

```
"› "  +  prefix          +  foldMarker  +  pathMarker  +  label  +  labelTimestamp  +  content
커서     트리 들여쓰기/커넥터   ⊞            •             [label]   시각               엔트리 본문
```

여기서 `prefix`는 **들여쓰기 레벨 1당 정확히 3칸**을 차지한다 (`const totalChars = displayIndent * 3;`,
`tree-selector.ts:695` 부근). 즉 깊이 20짜리 노드는 본문이 시작되기도 전에 60칸을 소모한다.

변경 전 렌더는 이랬다.

```ts
let line = cursor + theme.fg("dim", prefix) + foldMarker + pathMarker + label + labelTimestamp + content;
if (isSelected) {
    line = theme.bg("selectedBg", line);
}
lines.push(truncateToWidth(line, width));
```

`truncateToWidth(line, width)`는 **왼쪽부터 `width`칸만 남기고 잘라내는** 함수다(기본 말줄임표 `"..."`).
따라서 80칸 터미널에서 깊이 20인 노드를 선택하면 화면에는 들여쓰기 공백과 `│ ├─` 같은 트리 선만 남고
정작 읽고 싶은 엔트리 텍스트는 통째로 잘려나갔다. 세로 스크롤은 있었지만 **가로 스크롤이 없었던 것**이 이슈 #5830이다.

---

## 3. 해결 아이디어: "gutter는 고정, body만 민다"

한 행을 두 부분으로 쪼갠다.

| 조각 | 내용 | 폭 | 가로 이동 |
| --- | --- | --- | --- |
| `gutter` | 커서(`"› "` 또는 `"  "`) | 항상 2칸 (`TREE_GUTTER_WIDTH`) | **절대 안 움직임** |
| `body` | prefix + 마커 + label + 타임스탬프 + content | 가변 | 필요할 때 왼쪽으로 밀림 |

커서가 화면 왼쪽에 고정되므로, 가로로 밀어도 "지금 어느 행이 선택돼 있는지"는 항상 보인다.
가로로 미는 양(`horizontalScroll`)은 **모든 행에 동일하게** 적용되므로 트리 선의 세로 정렬도 깨지지 않는다.

### 앵커(anchor)란

```ts
const prefixPart = theme.fg("dim", prefix) + foldMarker + pathMarker;
const anchorCol = visibleWidth(prefixPart);
```

`anchorCol`은 **body 좌표계에서 실제 엔트리 텍스트가 시작되는 열**이다.
`visibleWidth`는 ANSI 이스케이프를 제외하고 실제 표시 폭만 세므로, 색상 코드가 섞여 있어도 값이 정확하다.
`label`/`labelTimestamp`/`content`는 앵커에 포함되지 않는다 — 즉 앵커는 "여기부터가 읽을 거리"라는 경계다.

---

## 4. 핵심 함수 `renderHorizontalViewport` 뜯어보기

```ts
function renderHorizontalViewport(rows: HorizontalViewportRow[], width: number): string[] {
	const viewportWidth = Math.max(0, width - TREE_GUTTER_WIDTH);
	const maxBodyWidth = rows.reduce((max, row) => Math.max(max, row.bodyWidth), 0);
	const maxHorizontalScroll = Math.max(0, maxBodyWidth - viewportWidth);
	const selectedRow = rows.find((row) => row.isSelected);

	let horizontalScroll = 0;
	if (selectedRow && maxHorizontalScroll > 0) {
		const minVisibleAnchorContentWidth = Math.min(
			MAX_VISIBLE_ANCHOR_CONTENT_WIDTH,                       // 20
			Math.max(MIN_VISIBLE_ANCHOR_CONTENT_WIDTH,              // 4
			         Math.floor(viewportWidth / 3)),
		);
		if (selectedRow.anchorCol > viewportWidth - minVisibleAnchorContentWidth) {
			const anchorContextWidth = Math.min(
				MAX_ANCHOR_CONTEXT_WIDTH,                           // 12
				Math.max(MIN_ANCHOR_CONTEXT_WIDTH,                  // 2
				         Math.floor(viewportWidth / 4)),
			);
			horizontalScroll = Math.min(maxHorizontalScroll, selectedRow.anchorCol - anchorContextWidth);
		}
	}

	return rows.map((row) => {
		const line =
			horizontalScroll > 0
				? `${row.gutter}${sliceByColumn(row.body, horizontalScroll, viewportWidth, true)}\x1b[0m`
				: row.gutter + row.body;
		return truncateToWidth(line, width, "");
	});
}
```

동작을 4단계로 나눠 읽으면 된다.

### (1) 뷰포트 폭과 스크롤 상한

- `viewportWidth = width - 2` — gutter 2칸을 뺀 나머지가 body가 쓸 수 있는 공간.
- `maxHorizontalScroll = maxBodyWidth - viewportWidth` — **지금 화면에 보이는 행들 중 가장 긴 body** 기준.
  이보다 더 밀면 오른쪽에 빈 공간만 생기므로 여기서 잘라 막는다.
  주의: `rows`는 세로 스크롤 창(`startIndex`~`endIndex`) 안의 행들만 담고 있으므로,
  세로로 스크롤하면 `maxHorizontalScroll`도 함께 바뀐다.

### (2) 밀어야 하나? — 발동 조건

```
anchorCol > viewportWidth - minVisibleAnchorContentWidth
```

`minVisibleAnchorContentWidth`는 "앵커 뒤에 최소 이만큼은 보여야 한다"는 양이며
`viewportWidth / 3`을 `[4, 20]`으로 클램프한 값이다.
즉 **앵커 뒤에 남는 공간이 이 최소치보다 적을 때만** 패닝이 켜진다. 얕은 트리는 예전과 완전히 동일하게 그려진다.

### (3) 얼마나 밀 것인가 — 앵커 컨텍스트

```
horizontalScroll = min(maxHorizontalScroll, anchorCol - anchorContextWidth)
```

`anchorContextWidth`는 `viewportWidth / 4`를 `[2, 12]`로 클램프한 값으로,
"앵커 **왼쪽**에 트리 선을 이만큼은 남겨 둔다"는 여백이다.
이 여백이 없으면 선택된 행의 텍스트가 화면 맨 왼쪽에 딱 붙어서 트리 구조 맥락이 통째로 사라진다.

### (4) 실제로 자르기

- `horizontalScroll > 0`일 때만 `sliceByColumn(body, horizontalScroll, viewportWidth, true)`로 body의
  `[horizontalScroll, horizontalScroll + viewportWidth)` 열 구간을 뽑는다.
- 마지막 `truncateToWidth(line, width, "")`는 안전망이다.

---

## 5. 숫자로 따라가 보기

### 예시 A — 80칸 터미널, 깊이 20 노드 선택

| 값 | 계산 | 결과 |
| --- | --- | --- |
| `viewportWidth` | 80 − 2 | 78 |
| `anchorCol` | 20 × 3 (마커 없음 가정) | 60 |
| `minVisibleAnchorContentWidth` | `min(20, max(4, ⌊78/3⌋=26))` | 20 |
| 발동 조건 | 60 > 78 − 20 = 58 → **참** | 패닝 ON |
| `anchorContextWidth` | `min(12, max(2, ⌊78/4⌋=19))` | 12 |
| `horizontalScroll` | `min(maxHorizontalScroll, 60 − 12)` | 48 (상한 미도달 시) |

결과: body의 48열부터 78칸을 보여주므로, 앵커(60열)는 화면상 `2(gutter) + (60−48) = 14`번째 칸에 나타난다.
엔트리 텍스트에 78 − 12 = **66칸**이 배정된다. 변경 전에는 80 − 2 − 60 = 18칸뿐이었다.

### 예시 B — 30칸 좁은 터미널, 깊이 8 노드 선택

| 값 | 계산 | 결과 |
| --- | --- | --- |
| `viewportWidth` | 30 − 2 | 28 |
| `anchorCol` | 8 × 3 | 24 |
| `minVisibleAnchorContentWidth` | `min(20, max(4, ⌊28/3⌋=9))` | 9 |
| 발동 조건 | 24 > 28 − 9 = 19 → **참** | 패닝 ON |
| `anchorContextWidth` | `min(12, max(2, ⌊28/4⌋=7))` | 7 |
| `horizontalScroll` | `min(maxHorizontalScroll, 24 − 7)` | 17 |

상수들이 고정값이 아니라 `viewportWidth`의 분수로 계산되는 이유가 여기서 드러난다.
좁은 터미널에서 12칸을 앵커 왼쪽 여백으로 쓰면 남는 게 없으므로, 폭에 비례해 자동으로 줄어든다.

---

## 6. 놓치기 쉬운 디테일 4가지

### (a) `sliceByColumn(..., strict = true)`

`strict`는 "범위 경계에 걸친 **전각 문자**(CJK·이모지)를 버린다"는 뜻이다
(`packages/tui/src/utils.ts:1057`, 구현은 `sliceWithWidth`).
`strict`가 없으면 폭 2짜리 글자가 뷰포트 끝을 1칸 넘겨 잡아 다음 줄로 번지거나 렌더가 어긋난다.

### (b) 끝에 붙는 `\x1b[0m`

`theme.bg("selectedBg", body)`는 `"<bg코드>" + body + "\x1b[49m"` 형태다(`theme.ts:357`).
그런데 body를 중간에서 잘라내면 **끝에 있던 `\x1b[49m` 리셋이 함께 잘려나갈 수 있다.**
그대로 두면 선택 행의 배경색이 줄 끝 이후까지 번진다. 그래서 슬라이스 결과 뒤에 명시적으로 `\x1b[0m`을 붙인다.

반대로 시작 부분의 스타일은 `sliceByColumn`이 알아서 살려 준다 —
`sliceWithWidth`는 `startCol` 이전에 등장한 ANSI 코드를 `pendingAnsi`에 모아 두었다가
범위 안 첫 글자를 넣을 때 flush한다. 덕분에 잘린 지점부터 시작해도 배경색이 유지된다.

### (c) `horizontalScroll === 0` 분기

패닝이 필요 없을 때는 `sliceByColumn`을 아예 호출하지 않고 `gutter + body`를 그대로 쓴다.
슬라이스 비용과 ANSI 재조립을 건너뛰는 최적화이자, 기존 동작을 바이트 단위로 보존하는 안전장치다.

### (d) 말줄임표가 사라졌다 — 관찰 가능한 동작 변경

| | 변경 전 | 변경 후 |
| --- | --- | --- |
| 잘림 표시 | `truncateToWidth(line, width)` → 기본값 `"..."` | `truncateToWidth(line, width, "")` → 표시 없음 |

패닝 경로에서는 이미 `sliceByColumn`이 정확히 `viewportWidth`만큼 잘라 놓았으므로 `"..."`를 붙이면
애써 확보한 3칸을 도로 잡아먹는다. 다만 이 인자는 **패닝하지 않는 행에도 똑같이 적용**되므로,
얕은 트리에서 긴 텍스트가 잘릴 때도 이제 `"..."` 없이 딱 끊긴다. 의도된 트레이드오프로 보이되,
"잘렸다"는 신호가 사라진 것은 사실이다.

---

## 7. `packages/tui/src/index.ts` 변경

```diff
-export { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils.ts";
+export { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils.ts";
```

`sliceByColumn` 자체는 이미 `utils.ts`에 구현돼 있었고 패키지 barrel에서만 노출되지 않았다.
이번 변경은 **새 유틸 작성이 아니라 기존 유틸의 공개**다. `coding-agent`는 `@earendil-works/pi-tui`를 통해 임포트한다.

---

## 8. 변경되지 않은 것

- 세로 스크롤(`startIndex`/`endIndex` 계산), 키 바인딩, 필터 모드, 접기(fold) 로직 — 그대로.
- 하단 상태 줄 `(3/57)`은 여전히 `truncateToWidth(..., width)`(기본 말줄임표)로 그려지며 패닝 대상이 아니다.
- 이 커밋에는 **테스트가 추가되지 않았다.** `renderHorizontalViewport`는 순수 함수라
  (rows, width) → string[] 형태로 단위 테스트하기 좋은 모양인데도 검증 코드는 없다.

---

## 9. 퀴즈

> 답은 바로 아래 접힌 영역에 있다. 먼저 스스로 답해 보자.

**Q1.** 가로 패닝은 어떤 행을 기준으로 이동량을 정하는가? 그리고 그 이동량은 몇 개의 행에 적용되는가?

**Q2.** `TREE_GUTTER_WIDTH = 2`가 나타내는 것은 무엇이며, 왜 하필 2인가?

**Q3.** `width = 60`인 터미널에서 선택된 노드의 `anchorCol = 30`이고, 화면에 보이는 행 중 가장 긴 body가 200칸이다.
`horizontalScroll`은 얼마인가? (`viewportWidth`, `minVisibleAnchorContentWidth`, `anchorContextWidth`를 차례로 구할 것)

**Q4.** `width = 100`, `anchorCol = 40`일 때 패닝은 발동하는가? 근거가 되는 부등식을 쓰시오.

**Q5.** 슬라이스 결과 뒤에 `\x1b[0m`을 붙이지 않으면 화면에 어떤 증상이 나타나는가? 원인을 코드 근거와 함께 설명하시오.

**Q6.** `sliceByColumn`의 네 번째 인자 `strict`를 `false`로 바꾸면 어떤 입력에서 깨지는가?

**Q7.** 이 커밋 이후, 패닝이 **발동하지 않는** 얕은 트리에서도 화면 출력이 예전과 달라지는 지점이 하나 있다. 무엇인가?

**Q8.** `maxHorizontalScroll`이 "트리 전체의 최대 body 폭"이 아니라 "현재 화면에 보이는 행들의 최대 body 폭"으로
계산되는데, 이로 인해 사용자가 겪을 수 있는 현상은 무엇인가?

<details>
<summary>정답</summary>

**A1.** 이동량은 **선택된 행(`isSelected`)** 하나만 보고 정한다(`rows.find((row) => row.isSelected)`).
하지만 그렇게 정해진 `horizontalScroll`은 `rows.map(...)`에서 **현재 화면의 모든 행에 동일하게** 적용된다.
그래서 트리 선의 세로 정렬이 유지된다.

**A2.** `gutter`, 즉 커서 칸의 고정 폭이다. 커서는 선택 시 `"› "`, 아닐 때 `"  "`로 **두 경우 모두 정확히 2칸**이므로 2다.
`viewportWidth = width - TREE_GUTTER_WIDTH`가 이 값에 의존하므로, 커서 문자열 폭을 바꾸면 이 상수도 함께 바꿔야 한다.

**A3.**
- `viewportWidth = 60 − 2 = 58`
- `minVisibleAnchorContentWidth = min(20, max(4, ⌊58/3⌋ = 19)) = 19`
- 발동 조건: `30 > 58 − 19 = 39` → **거짓**. 따라서 `horizontalScroll = 0` (패닝 안 함).
  `maxHorizontalScroll = 200 − 58 = 142 > 0`이지만, body가 길다는 것만으로는 패닝이 켜지지 않는다는 점이 핵심이다.

**A4.**
- `viewportWidth = 98`, `minVisibleAnchorContentWidth = min(20, max(4, ⌊98/3⌋ = 32)) = 20`
- 조건: `anchorCol > viewportWidth − 20` → `40 > 78` → **거짓 → 발동하지 않음**.

**A5.** 선택된 행의 **배경색이 줄 끝 이후까지 번진다**.
`theme.bg`는 `<bg코드> + text + "\x1b[49m"`을 만드는데(`theme.ts:357`), body 중간을 잘라내면 뒤쪽 `\x1b[49m`이
슬라이스 범위 밖으로 밀려 사라질 수 있기 때문이다. 반면 시작 쪽 스타일은 `sliceWithWidth`의 `pendingAnsi` flush 덕분에 보존된다.

**A6.** 뷰포트 경계에 **전각 문자(CJK, 이모지 등)가 걸치는 경우**다.
`strict = false`면 폭 2짜리 글자가 `endCol`을 1칸 넘겨 포함되어, 실제 출력 폭이 `viewportWidth`를 초과하고 줄 정렬이 어긋난다.

**A7.** 말줄임표다. `truncateToWidth(line, width, "")`가 모든 행에 적용되므로,
패닝하지 않는 행에서 긴 텍스트가 잘려도 더 이상 `"..."`가 붙지 않는다.

**A8.** 세로 스크롤 위치에 따라 **같은 노드를 선택해도 가로 이동량이 달라질 수 있다**.
화면에 긴 행이 함께 보일 때는 `maxHorizontalScroll`이 커서 원하는 만큼 밀리지만,
짧은 행들만 보이는 위치에서는 상한에 걸려 덜 밀린다. 위아래로 움직이는 동안 화면이 가로로 미세하게 흔들릴 수 있다.

</details>

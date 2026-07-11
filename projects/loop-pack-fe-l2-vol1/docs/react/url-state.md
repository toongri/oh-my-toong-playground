# URL 상태 동기화 규칙

> `.claude/rules/url-state.md`가 가리키는 근거 문서. URL과 동기화되는 상태(필터·페이지·검색어)를 설계할 때 읽고 적용한다.

## 1. 정규화 — 스키마 밖 파라미터는 strip하고 `replace`로 쓴다

마운트 시 URL의 파라미터가 스키마(허용 필터·페이지 범위)를 벗어나면 strip하는 것은 버그가 아니라 **의도된 정규화**다. 정규화가 만들어내는 첫 URL 쓰기는 사용자가 요청한 이동이 아니므로 히스토리 엔트리를 쌓지 않는다 — `replace`를 쓴다.

## 2. push / replace / none — 히스토리 의도 결정 진리표

`origin`은 `mount | user | popstate | normalize` 4값. 다음 우선순위로 하나만 적용한다.

| #   | 조건                                    | 결과                                             |
| --- | --------------------------------------- | ------------------------------------------------ |
| 1   | `origin === "popstate"`                 | `none` — 브라우저가 이미 URL을 바꿨다            |
| 2   | `next === current`                      | `none` — no-op 가드                              |
| 3   | `origin === "mount"` 또는 `"normalize"` | `replace` — 정규화·보정은 히스토리를 쌓지 않는다 |
| 4   | 그 외(= `user`)                         | `push`                                           |

`popstate` 가드가 최우선인 이유: 뒤로가기로 돌아온 상태를 다시 push/replace하면 히스토리가 꼬인다. `mount`와 `normalize`는 원인이 다르지만(초기 진입 vs 사후 보정) 둘 다 canonical 정규화라 `replace`로 수렴한다 — 다만 의미가 다르므로 origin 이름은 분리해 하나에 과적하지 않는다.

## 3. debounce 입도 — 직렬화된 쿼리 문자열 전체를 debounce

URL 쓰기는 **개별 필드가 아니라 직렬화된 쿼리 문자열 전체**를 debounce한다.

개별 텍스트 필드만 debounce하면, 그 필드 변경에 동반되는 `setPage(1)` 같은 즉시 리셋이 별도의 직렬화 스냅샷을 만들어 히스토리 엔트리가 의도치 않게 두 개로 쪼개진다. 예: 검색어 입력 한 번이 `page` 리셋 엔트리 + `q` 확정 엔트리로 나뉜다.

직렬화 결과(최종 쿼리 문자열) 단위로 debounce하면, 같은 조작에서 나온 여러 state 변경이 한 스냅샷으로 합쳐져 히스토리 엔트리가 정확히 1개가 된다. 카테고리·정렬·페이지 클릭 같은 즉시 반응이 필요한 조작도 화면·요청은 즉시 갱신되고 URL 쓰기만 지연되므로 사용자에게는 보이지 않는다.

### origin도 함께 묶어 debounce한다

debounce 대상은 query 문자열만이 아니다. URL에 쓸 query와, 그 쓰기의 히스토리 정책(§2 진리표)을 정하는 `origin`을 **한 스냅샷으로 묶어 함께 debounce**한다.

`origin`은 사용자 조작 즉시 갱신되는데 query만 debounce하면 두 값의 시점이 어긋난다. popstate로 과거 URL이 복원된 직후, debounce 창 안에서 사용자가 필터를 조작하면 `origin`은 즉시 `"user"`가 되지만 debounce된 query는 아직 이전(stale) 값이다. 이 (stale query, 새 origin) 짝이 §2 진리표에 들어가면, 사용자가 방문한 적 없는 과거 query가 `push` 정책으로 써져 유령 히스토리 엔트리가 생긴다.

해결은 `{ query, origin }`을 `useMemo`로 묶어 함께 debounce하는 것이다. 그러면 두 값이 항상 같은 시점의 짝이 되고, 그 debounce 창 안에서는 하위 effect의 deps가 흔들리지 않아 stale 쓰기 자체가 사라진다(스냅샷 참조 안정화 원리는 [`hook-design.md`](./hook-design.md) §7 참고).

```tsx
const snapshot = useMemo(() => ({ query, origin }), [query, origin]);
const debounced = useDebouncedValue(snapshot, URL_WRITE_DEBOUNCE_MS);
useUrlQuerySync(debounced.query, debounced.origin, restore);
```

**URL에 쓰는 값과 그 히스토리 정책을 정하는 값은 한 짝이다 — 함께 debounce하라.**

## 4. no-op 가드 — 같으면 쓰지 않는다

직렬화 결과가 현재 URL과 같으면 쓰지 않는다(위 진리표의 `next === current → none`). 불필요한 replace/push 호출과 리렌더를 막는다.

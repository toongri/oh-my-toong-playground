---
paths: ["**/use*.ts", "**/*.tsx"]
---

# URL 상태 동기화 판단 규칙

URL과 동기화되는 상태(필터·페이지·검색어)를 설계할 때의 규칙이다. 문서를 열어 판단 기준·진리표·Before/After를 확인한다.

- `docs/react/url-state.md` — **URL 상태 동기화 전반**: 파라미터 정규화(스키마 밖 strip·`replace`), 히스토리 의도 진리표(`origin`: mount/user/popstate/normalize), debounce 입도(직렬화 쿼리 문자열 전체), query·origin 동시 스냅샷 debounce(`useMemo({query, origin})`), no-op 가드(`next === current`)

**관련 규칙**: 스냅샷 참조 안정화·Effect deps 안정화는 `hook-design.md` rule에, 상태 종류 분류(URL 상태 vs 로컬 vs 서버)는 `react.md` rule에 있다.

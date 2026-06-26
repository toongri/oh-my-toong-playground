---
paths: ["**/*.tsx", "**/*.jsx"]
---

# 컴포넌트 설계 판단 규칙

> 컴포넌트·Props를 설계하기 전에 **`docs/react/component-design.md`를 읽고** 상황에 맞게 적용하라(판단 기준 표·Before/After 카탈로그).

핵심:

- **Props 수**: 6개 이상이면 재설계 신호 — 표시 토글·boolean을 늘리지 말고 `children` 합성이나 컴포넌트 분리로. 4~5개는 관련 Props를 객체로 묶을지 검토. 진짜 문제는 개수 자체가 아니라 "서로 무관한 제어 손잡이가 흩어져 유효 조합을 못 읽는" 상태다.
- **boolean Props**: 긍정형 + `is` 접두로 통일(`isOpen`·`disabled`). 부정형(`notDisabled` → 이중 부정)·모호한 이름(`show`) 금지.
- **값의 주인 먼저**: 부모가 쥐면 Controlled(`value`+`onChange`), 자신이 쥐면 Uncontrolled(`defaultValue`+`ref`). 이 선택이 Props 모양을 결정한다. 공통 컴포넌트는 `value !== undefined`로 분기해 둘 다 지원.
- **Drilling vs Context**: 2단계 전달은 유지(흐름 추적 가능). 3단계+인데 중간이 그 Props를 안 쓰거나, 여러 트리가 같은 상태를 공유하면 Context. Context는 서브트리 단위 한정 — 전역 스토어 대용이 아니다.
- **Context 분리**: 자주 바뀌는 값과 드물게 바뀌는 값을 한 Context에 넣지 않는다(구독 하위 전체가 리렌더). 변경 빈도로 쪼갠다.
- **공통 컴포넌트**: ①비즈니스 로직 미포함(판단은 사용처에서) ②도메인 용어 미사용(`Button`✅ `ProductButton`❌) ③`variant`/`size`로 외양 제어 + JSDoc 주석. 도입은 같은 UI가 3곳 이상 반복될 때 — "나중에 쓸 듯"은 만들 이유가 아니다(YAGNI).
- **조건부 Props**: 조합에 규칙이 있으면 전부 optional 대신 discriminated union(`{ variant: 'text'; label } | { variant: 'icon'; icon }`). HTML 속성을 그대로 넘길 땐 손으로 나열 말고 `ComponentPropsWithoutRef<'button'>` 확장.

네이밍(`onX`/`handleX`)·props→state 미러링 금지·추출 기준은 `react.md`, discriminated union 기본기는 `typescript.md`에 있다 — 여기서 중복하지 않는다.

---
paths: ["**/*.ts", "**/*.tsx"]
---

# Hook · Effect · 레이어 설계 판단 규칙

> Custom Hook·Effect·레이어 경계를 설계하기 전에 **`docs/react/hook-design.md`를 읽고** 상황에 맞게 적용하라(판단 기준·Before/After·트레이드오프).

핵심:

- **Hook 책임**: Hook도 한 문장으로 설명 안 되면 쪼갠다. 컴포넌트 500줄을 usePage 500줄로 옮긴 건 분리가 아니라 이사다.
- **추출 기준**: 반복 횟수(2곳·3곳)가 아니라 "목적이 같은가"로 뽑는다. 애매하면 중복을 유지 — 잘못된 추상화가 중복보다 비싸다. `useState` 하나만 감싼 Hook은 오버 추상화. 실재 재사용·테스트 격리·성능 트리거가 있을 때만.
- **use 접두사**: React Hook을 호출하지 않는 순수 함수엔 use를 붙이지 않는다(`useFormatX`❌ → `formatX`✅). 훅 이름은 도메인(`useOrderFilter`) — `useFetchData`처럼 메커니즘이 이름에 보이면 얕은 추상화.
- **Hook state는 공유 안 됨**: 같은 Custom Hook을 여러 곳에서 호출하면 각자 새 state 인스턴스다(로직 재사용이지 상태 공유가 아니다). 공유가 목적이면 한 곳에서 호출해 props로 내리거나 Context/전역.
- **Effect의 역할**: `useEffect`는 React 바깥 시스템(API·구독·타이머·외부 라이브러리) 동기화에만. 사용자 액션의 부수효과는 이벤트 핸들러에, prop 변화 시 리셋은 `key`로. 렌더 중 계산 가능한 값은 Effect로 만들지 말고, 무거우면 측정 후 `useMemo`(Effect로 되돌리지 말 것).
- **데이터 패칭**: `pending · error · empty · data` 4상태를 다 그린다. `useEffect`로 직접 요청하면 `ignore`/`AbortController`로 race를 막고, deps엔 객체 대신 원시 필드를 넣는다(객체는 매 렌더 새 참조 → 무한 요청).
- **레이어 경계·DIP**: UI=렌더·이벤트, Hook=상태/도메인 조합, API 경계=요청/응답 변환, Utils=순수 계산. Hook은 `axios`/`fetch` 구현 세부에 직접 의존하지 않고 API 함수 경계에 의존한다. 도메인 규칙은 UI 사이에 숨기지 말고 순수 함수로.

상태 구조·위치·분류와 이벤트 prop 네이밍은 `react.md`, 컴포넌트/Props 경계는 `component-design.md`, 타입 모델링은 `typescript.md`에 있다 — 여기서 중복하지 않는다.

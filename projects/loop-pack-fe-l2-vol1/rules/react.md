---
paths: ["**/*.tsx", "**/*.jsx", "**/use*.ts"]
---

# React 판단 규칙

훅 순서·exhaustive-deps·useEffect 상태동기화·렌더 순수성은 **ESLint(react-hooks)가 강제**한다. 여기엔 기계가 못 잡는 판단만.

- **상태 구조**: 동시에 참이면 안 되는 boolean들 대신 `status` 유니온(`'idle' | 'loading' | 'error' | 'success'`). 파생값은 state가 아니라 렌더 중 계산. 컬렉션의 선택은 객체 복사 말고 **id 저장** 후 find. props를 state로 미러링 금지(첫 값만 쓰면 `initialX`로 명명).
- **상태 위치**: 쓰는 컴포넌트에 가깝게 둔다. "나중에 공유할지도"는 끌어올릴 이유가 아니다.
- **상태 분류**: 서버 데이터 → 서버 상태(추후 TanStack Query) · UI 전용(모달 열림·탭 선택) → 로컬 `useState` · URL에 남아야 하는 것(필터·페이지·검색어) → URL 상태 · 여러 컴포넌트 공유 → Context/전역.
- **effect가 틀린 도구인 경우**: 사용자 액션의 부수효과(요청 전송 등)는 effect 말고 **이벤트 핸들러**에. prop이 바뀔 때 상태 리셋은 effect 말고 **`key`**.
- **데이터 패칭은 4상태**: `pending · error · empty · data`를 다 그린다(성공 경로만 그리지 않는다). `useEffect` fetch엔 `ignore` 플래그나 `AbortController` cleanup으로 race를 막는다.
- **추출은 이득이 있을 때만**: 실재 재사용·테스트 격리·성능 중 트리거가 있을 때. 한 번 쓰는 pass-through 래퍼는 인라인. 옵션이 늘면 boolean prop 대신 **`children` 합성**.
- **네이밍**: 이벤트 prop은 `onX`, 핸들러 구현은 `handleX`. 컴포넌트는 명사(`UserList`), 훅은 도메인(`useUser`) — `useFetchData`처럼 메커니즘이 이름에 보이면 추상화가 얕다. 이름에 "and"가 있으면 책임 분리 후보.

# React 판단 규칙

- **상태 구조**: 동시에 참이면 안 되는 boolean들 대신 `status` 유니온(`'idle' | 'loading' | 'error' | 'success'`). 파생값은 state가 아니라 렌더 중 계산. 컬렉션의 선택은 객체 복사 말고 **id 저장** 후 find. props를 state로 미러링 금지(첫 값만 쓰면 `initialX`로 명명).
- **상태 위치**: 쓰는 컴포넌트에 가깝게 둔다. "나중에 공유할지도"는 끌어올릴 이유가 아니다.
- **상태 분류**: 서버 데이터 → 서버 상태 · UI 전용(모달 열림·탭 선택) → 로컬 `useState` · URL에 남아야 하는 것(필터·페이지·검색어) → URL 상태 · 여러 컴포넌트 공유 → Context/전역.
- **네이밍**: 이벤트 prop은 `onX`, 핸들러 구현은 `handleX`. 컴포넌트는 명사(`UserList`). 이름에 "and"가 있으면 책임 분리 후보.

훅·Effect·데이터 패칭·레이어 설계 판단은 `hook-design.md`, 컴포넌트/Props 경계는 `component-design.md`에 있다 — 여기서 중복하지 않는다.

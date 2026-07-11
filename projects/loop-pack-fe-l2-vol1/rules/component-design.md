---
paths: ["**/*.tsx", "**/*.jsx"]
---

# 컴포넌트 설계 판단 규칙

컴포넌트 경계·Props 계약·Context 전환을 다루는 규칙이다. 상황에 맞는 문서를 열어 판단 기준과 Before/After를 확인한다.

- `docs/react/component-boundary.md` — **컴포넌트를 어디서 자를지(경계)**:
  - 변경 이유로 경계 긋기: 가격 정책·추천·채팅처럼 서로 다른 이유로 바뀌는 로직이 한 컴포넌트에 엉킴 — 경계는 "무엇이 함께 바뀌는가"로 긋는다
  - 구현 vs 조합 분리: 조합 컴포넌트 안에 카드 내부 구현이 통째로 인라인돼 추상화 고도가 섞임 — 조합은 목차, 구현은 본문
  - 무관한 상태는 추출 신호: God Component가 목록 정렬 상태와 모달 열림 상태처럼 서로 무관한 상태를 함께 들고 있음(수백 줄) — 무관한 상태는 쓰는 UI와 함께 떼어낸다
  - 중복 > 잘못된 추상화: 비슷해 보이는 카드를 성급히 합쳐 타입마다 `if`문이 늘어남 — 잘못된 추상화가 중복보다 비싸다(rule of three)

- `docs/react/props-contract.md` — **공통 컴포넌트 인터페이스 설계(Props 모양·값의 주인·합성 방식)**:
  - Props는 적을수록 좋다: props 6개 이상·서로 무관한 제어 손잡이가 흩어져 유효한 조합을 못 읽음 — 늘리지 말고 합성으로
  - Props 네이밍: `onX`/`handleX` 혼동, boolean 토글이 `notDisabled`처럼 이중부정이거나 `show`/`isOpen`처럼 컨벤션이 흔들림 — 긍정형 + `is` 접두로 통일
  - Controlled vs Uncontrolled: 값의 주인이 부모인지 컴포넌트 자신인지 불분명(`value` vs `defaultValue` 혼용) — 주인을 먼저 정하면 Props 모양이 정해진다
  - 공통 컴포넌트 도입 시점(YAGNI): 1곳뿐인데 "나중에 쓸 것 같아서" 미리 공통화 — 3곳 이상 반복되거나 확장이 확실할 때만
  - 공통 컴포넌트 3원칙: 비즈니스 로직·도메인 이름이 공통 컴포넌트에 섞임(`ProductButton`, stock/status 판단 내장) — UI만, 판단은 사용처에서
  - 스타일 확장: 디자인 요청마다 prop을 하나씩 추가해 컴포넌트가 끝없이 부풂(`fullWidth`, `rounded`, `shadow`...) — className을 받아 사용처에 위임
  - children vs slot: 자리가 여럿이고 순서가 고정인데 `children` 하나로 밀어넣거나, 반대로 구멍 하나인데 slot처럼 과설계 — 자유는 children, 구조는 slot
  - TypeScript 고급 Props: 조건부 필수 props를 전부 optional로 둬 잘못된 조합이 컴파일을 통과함(`variant`별 필수 필드), HTML 속성을 손으로 나열 — discriminated union과 `ComponentPropsWithoutRef`

- `docs/react/context-and-state.md` — **Props Drilling을 유지할지 Context로 끊을지**:
  - 3단계 이상 전달에서 중간 컴포넌트가 쓰지도 않는 props를 그냥 통과만 시킴 — Props Drilling 해소가 필요한 신호
  - 여러 트리에서 동일 상태를 공유해야 하는데 구조상 전달이 불가능하거나 비효율 — 서브트리 상태 공유 도구로 Context
  - 자주 바뀌는 값(입력값)과 드물게 바뀌는 값(테마)을 한 Context에 몰아넣어 무관한 컴포넌트까지 리렌더 — 변경 빈도로 Context를 쪼갠다

**관련 규칙**: 이벤트 prop 네이밍(`onX`/`handleX`)·props→state 미러링 금지·상태 추출 기준은 `react.md` rule에, discriminated union 기본기는 `typescript.md` rule에 있다.

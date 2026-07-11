---
paths: ["**/*.ts", "**/*.tsx"]
---

# Hook · Effect · 레이어 설계 판단 규칙

Custom Hook·Effect·레이어 경계를 다루는 규칙이다. 문서를 열어 판단 기준·Before/After·트레이드오프를 확인한다.

- `docs/react/hook-design.md` — **Hook·Effect·레이어 경계 전반(UI/Hook/API/Utils 구성)**:
  - 레이어 구분: 500줄 컴포넌트를 열었을 때 UI·로직·데이터가 안 갈라져 어디부터 읽어야 할지 안 보임
  - 상태 종류 구분: 서버 상태를 `useState`+`useEffect`로 직접 부여잡고 클라이언트 상태·파생값과 안 나눔, Custom Hook이 뭐고 상태관리가 뭐냐는 혼란
  - Custom Hook 추출: `useState` 하나만 감싼 훅(`useLoading`) 남발, "2곳에서 반복되면 무조건 추출" 함정
  - 명명: Hook을 호출하지 않는 순수 계산 함수에 `use` 접두를 붙임, `useData`/`useFetch`처럼 메커니즘만 보이는 이름
  - Hook 책임: 한 문장으로 설명이 안 됨, API 호출·라우팅까지 떠맡아 `usePage`가 500줄로 커짐(컴포넌트 비대함이 그대로 이사)
  - Hook 재사용과 상태 공유: 같은 Custom Hook을 여러 곳에서 호출하면 상태가 동기화될 거라 착각, 컴포넌트마다 값이 다르게 나와서 당황
  - 파생값 처리: 필터·정렬·포맷 같은 파생값을 state+Effect로 동기화, 불필요한 리렌더나 한 틱 늦게 갱신되는 값
  - 직접 fetch: race condition·무한 요청, ignore 플래그/AbortController 없이 이전 요청이 최신 응답을 덮어쓰거나, 의존성 배열에 객체를 그대로 둬 매 렌더 새 참조로 무한 요청
  - DIP: Hook이 axios 같은 구현체에 직접 의존해 서버 교체·테스트 시 다 무너짐

**관련 규칙**: 상태 구조·위치·분류와 이벤트 prop 네이밍은 `react.md` rule에, 컴포넌트/Props 경계는 `component-design.md` rule에, 타입 모델링은 `typescript.md` rule에 있다.

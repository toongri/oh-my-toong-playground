# Hook · Effect · 레이어 설계 판단 규칙

Custom Hook·Effect·레이어 경계를 다루는 규칙이다. 문서를 열어 판단 기준·Before/After·트레이드오프를 확인한다.

- `docs/react/hook-design.md` — **Hook·Effect·레이어 경계 전반**: 레이어 구분(UI/Hook/API/Utils), 상태 종류 구분(서버/클라이언트/파생값), Custom Hook 추출(`useLoading`), 명명(`use` 접두·`useData`/`useFetch`), Hook 책임(한 문장 설명), 재사용과 상태 공유(독립 인스턴스), 파생값 처리(state+Effect), 직접 fetch(race condition·`AbortController`/`ignore`·의존성 원시필드), DIP(`axios`)

**관련 규칙**: 상태 구조·위치·분류와 이벤트 prop 네이밍은 `react.md` rule에, 컴포넌트/Props 경계는 `component-design.md` rule에, 타입 모델링은 `typescript.md` rule에, 훅을 어디서 어떻게 검증할지와 셋업 비대가 주는 신호는 `testing.md` rule에 있다.

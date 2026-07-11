---
paths: ["**/*.tsx", "**/*.jsx"]
---

# 컴포넌트 설계 판단 규칙

컴포넌트 경계·Props 계약·Context 전환·유연한 패턴을 다루는 규칙이다. 상황에 맞는 문서를 열어 판단 기준과 Before/After를 확인한다.

- `docs/react/component-boundary.md` — **컴포넌트를 어디서 자를지(경계)**: 경계 판단 기준(변경 이유), 구현 vs 조합 분리, 무관한 상태 판별(God Component), 성급한 통합(rule of three)

- `docs/react/props-contract.md` — **공통 컴포넌트 인터페이스 설계**: Props 개수, 네이밍(onX/handleX), Controlled/Uncontrolled(value/defaultValue), 공통 컴포넌트(YAGNI·className·children/slot), TS 고급 props(discriminated union·ComponentPropsWithoutRef)

- `docs/react/context-and-state.md` — **Props Drilling을 유지할지 Context로 끊을지**: Props Drilling(3단계+), 서브트리 상태 공유(Tabs·Form), Context 분리(변경 빈도)

- `docs/react/component-patterns.md` — **유연한 컴포넌트 패턴(IoC)**: Headless(로직만 훅), Compound(Context 암시 공유), Provider vs Singleton(useSyncExternalStore), Portal(overflow·z-index), 패턴 선택 가이드

**관련 규칙**: 이벤트 prop 네이밍(`onX`/`handleX`)·props→state 미러링 금지·상태 추출 기준은 `react.md` rule에, discriminated union 기본기는 `typescript.md` rule에 있다.

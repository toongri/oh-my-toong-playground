---
paths: ["**/*.tsx", "**/*.jsx"]
---

# 컴포넌트 설계 판단 규칙

> 컴포넌트 경계·Props 계약·Context 전환을 판단할 때, 아래 표에서 상황에 맞는 문서 하나를 읽고 적용하라(판단 기준·Before/After 카탈로그) — 셋을 다 읽지 않는다.

| 언제 로딩하나 (WHEN) | 문서 | 담긴 내용 (WHAT) |
| --- | --- | --- |
| 이 컴포넌트를 쪼갤지 판단할 때 (경계·God Component·성급한 추상화) | `docs/react/component-boundary.md` | 변경 이유로 경계 긋기 · 구현 vs 조합 분리 · 무관한 상태는 추출 신호 · 중복 > 잘못된 추상화 |
| 공통 컴포넌트의 인터페이스를 설계할 때 (Props 모양·값의 주인·합성 방식) | `docs/react/props-contract.md` | Props는 적을수록 좋다 · Props 네이밍(boolean 긍정형 + `is` 접두) · Controlled vs Uncontrolled · 공통 컴포넌트 설계(도입 시점 YAGNI · 3원칙 · className 위임 · children vs slot) · TypeScript 고급 Props(discriminated union · `ComponentPropsWithoutRef`) |
| Props Drilling을 유지할지 Context로 넘길지 판단할 때 | `docs/react/context-and-state.md` | Props Drilling vs Context 전환 판단 |

**관련 규칙**: 이벤트 prop 네이밍(`onX`/`handleX`)·props→state 미러링 금지·상태 추출 기준은 `react.md` rule에, discriminated union 기본기는 `typescript.md` rule에 있다.

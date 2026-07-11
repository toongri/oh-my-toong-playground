---
paths: ["**/*.ts", "**/*.tsx"]
---

# Hook · Effect · 레이어 설계 판단 규칙

> Custom Hook·Effect·레이어 경계를 설계할 때, 아래 문서를 읽고 상황에 맞게 적용하라(판단 기준·Before/After·트레이드오프).

| 언제 로딩하나 (WHEN) | 문서 | 담긴 내용 (WHAT) |
| --- | --- | --- |
| Custom Hook을 추출할지, Effect가 정말 필요한지, 레이어(UI/Hook/API/Utils) 경계를 어디에 그을지, 직접 fetch할 때 무엇을 챙길지 판단할 때 | `docs/react/hook-design.md` | 레이어 구분(UI/Hook/API/Utils) · 상태 3분할(서버/클라이언트/파생값) · Custom Hook 추출 기준(횟수가 아닌 목적) · 명명(use 접두사와 역할) · Hook 책임(한 문장으로 설명되는가) · Hook state는 공유되지 않음 · useEffect를 줄이는 설계 · 직접 fetch할 때 race와 의존성 · DIP(구현체에 직접 묶이지 않기) |

**관련 규칙**: 상태 구조·위치·분류와 이벤트 prop 네이밍은 `react.md` rule에, 컴포넌트/Props 경계는 `component-design.md` rule에, 타입 모델링은 `typescript.md` rule에 있다.

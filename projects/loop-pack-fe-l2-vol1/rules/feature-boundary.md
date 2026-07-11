---
paths: ["src/**/*.ts", "src/**/*.tsx"]
---

# 피처 경계·공유 판단 규칙

> cross-feature 공유·조립을 설계할 때, 아래 문서를 읽고 적용하라.

| 언제 로딩하나 (WHEN) | 문서 | 담긴 내용 (WHAT) |
| --- | --- | --- |
| 여러 피처가 뭔가를 함께 써야 할 때 (shared로 내릴지 · app에서 조립할지 · 하나로 합칠지 판단) | `docs/react/feature-boundary.md` | 공유 3분기(타입·순수 유틸은 shared로 · 여러 피처의 UI는 app에서 조립 · 늘 함께 바뀌면 병합) · 이벤트버스(조립·DI로 풀기 어려울 때만 쓰는 최후 수단, 남용 시 숨긴 결합) · 근거(Feature-Sliced Design · bulletproof-react) |

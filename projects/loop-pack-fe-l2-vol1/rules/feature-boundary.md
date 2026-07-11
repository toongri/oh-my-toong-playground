---
paths: ["src/**/*.ts", "src/**/*.tsx"]
---

# 피처 경계·공유 판단 규칙

cross-feature 공유·조립을 다루는 규칙이다. 문서를 열어 판단 기준을 확인한다.

- `docs/react/feature-boundary.md` — **여러 피처가 뭔가를 함께 써야 할 때(shared로 내릴지·app에서 조립할지·병합할지)**:
  - 공유 3분기: 가격 포맷·재고 판정 같은 타입·순수 유틸을 한 피처에 두고 옆 피처가 몰래 꺼내 씀(cross-feature import, depcruise 위반), 소유 불명확·테스트 격리 깨짐
  - app 조립: 여러 피처의 UI를 한 화면에 배치해야 하는데 피처끼리 서로 직접 import
  - 병합: 두 피처가 매번 같이 수정됨, PR 하나가 양쪽 피처를 동시에 건드림
  - 이벤트버스 남용 함정: 다대다 비동기 알림을 이벤트버스로 풀다 누가 뭘 듣는지 추적 불가
  - 근거: Feature-Sliced Design(public API·상위 조립)·bulletproof-react("compose features at the application level")

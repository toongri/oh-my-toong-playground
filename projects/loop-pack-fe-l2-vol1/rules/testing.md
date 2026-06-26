---
paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
---

# 테스트 판단 규칙

> 테스트를 만지기 전에 **`docs/testing/conventions.md`를 읽고** 상황에 맞게 적용하라(전체 규칙·안티패턴 표).

핵심:

- **사용자가 쓰는 방식을 닮게**: 구현 세부(state 이름·내부 메서드·CSS 클래스) 말고, 보고 조작하는 동작을 검증.
- **쿼리**: `getByRole` > `getByLabelText` > `getByText`. `getByTestId`·`container.querySelector` 금지.
- **상호작용**: `userEvent.setup()` + `await`. 비동기 등장은 `findBy`. `waitFor` 콜백엔 assertion 하나만, side-effect 금지.
- **모킹**: 네트워크만 MSW. 내 코드의 내부 모듈을 `vi.mock`하지 않는다(false green).

---
paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
---

# 테스트 판단 규칙

테스트 작성·리뷰를 다루는 규칙이다. 문서를 열어 전체 규칙과 안티패턴 표를 확인한다.

- `docs/testing/conventions.md` — **무엇을 검증할지·쿼리를 어떻게 고를지·상호작용/비동기를 어떻게 다룰지·무엇을 모킹할지(Vitest + React Testing Library + MSW)**:
  - 원칙: 사용 방식을 닮을수록 신뢰 — 내부 state 변수명·훅 반환값을 직접 assert하지 않는다
  - 테스트 범위: 렌더 결과·인터랙션 후 UI 변화·에러/빈 상태는 검증, React 자체 동작(렌더 사이클·Context 내부)은 검증하지 않는다
  - 쿼리 우선순위: `container.querySelector('.class')`·`getByTestId` 남용 — `getByRole`(`name`) → `getByLabelText` → `getByPlaceholderText` → `getByText` → `getByAltText` 순
  - 상호작용·비동기: `fireEvent` 남용, `findBy`/`waitFor` 안 씀, `waitFor` 콜백에 assertion 여러 개나 side-effect를 넣어 콜백이 재실행됨 — `userEvent.setup()`+`await`, 콜백엔 assertion 하나만
  - 모킹: axios/fetch를 직접 mock, 내 코드의 내부 모듈을 `vi.mock`해 실제 통합을 숨기고 false green을 만듦 — 네트워크는 MSW로, 외부 경계만 모킹
  - 네이밍·구조: `it('renders LoginForm')`처럼 구현을 나열, given-when-then 구조 없음 — 사용자 행동+결과로, 한 `it` = 한 행동
  - AI 단골 안티패턴: `container.querySelector`, 내부 state·메서드 assert, 전체 컴포넌트 snapshot 남용, `waitFor` 빈/다중 콜백, 내부 모듈 `vi.mock`, `getByTestId` 기본 사용

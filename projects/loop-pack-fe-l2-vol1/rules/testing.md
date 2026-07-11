---
paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
---

# 테스트 판단 규칙

테스트 작성·리뷰를 다루는 규칙이다. 문서를 열어 전체 규칙과 안티패턴 표를 확인한다.

- `docs/testing/conventions.md` — **테스트 작성 판단 기준(Vitest + React Testing Library + MSW)**: 테스트 대상(내부 state·훅 반환값), 테스트 범위(렌더사이클·Context 내부·에러/빈상태), 쿼리 선택(`container.querySelector`·`getByTestId`), 상호작용·비동기(`fireEvent`·`findBy`/`waitFor`·act), 모킹(axios/fetch·`vi.mock`), 네이밍·구조(`it('renders LoginForm')`·given-when-then), AI 단골 안티패턴(`container.querySelector`·내부state assert·전체 snapshot·`waitFor` 빈/다중콜백·내부모듈 `vi.mock`·`getByTestId`)

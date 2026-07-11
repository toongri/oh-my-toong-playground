# 테스트 판단 규칙

테스트 작성·리뷰를 다루는 규칙이다. 문서를 열어 전체 규칙과 안티패턴 표를 확인한다.

- `docs/testing/conventions.md` — **테스트 작성 판단 기준(Vitest + React Testing Library + MSW)**: 테스트 대상(내부 state·훅 반환값), 테스트 범위(렌더사이클·Context 내부·에러/빈상태), 쿼리 선택(`container.querySelector`·`getByTestId`), 상호작용·비동기(`fireEvent`·`findBy`/`waitFor`·act), 모킹(axios/fetch·`vi.mock`), 네이밍·구조(`it('renders LoginForm')`·given-when-then), AI 단골 안티패턴(`container.querySelector`·내부state assert·전체 snapshot·`waitFor` 빈/다중콜백·내부모듈 `vi.mock`·`getByTestId`)
- `docs/testing/test-layers.md` — **테스트 레이어 투자 판단**: 레이어 구분(Static/Unit/Integration/E2E), 투자 배분(Testing Trophy), Trophy vs Pyramid, 동작 vs 구현 세부(false positive/negative), 서버 컴포넌트 무게중심 이동(RSC)
- `docs/testing/nextjs.md` — **Next.js App Router 테스트**: 공식 도구 분리, async Server Component 한계(RSC), Server Action 검증, Route Handler(route.ts, NTARH), Next 프리미티브 모킹(next/navigation·next/font), E2E 분담(agent-browser/Playwright)
- `docs/testing/tooling.md` — **테스트 도구 선택**: 러너(Vitest/Jest), DOM(RTL/user-event/jest-dom), 네트워크 모킹(MSW), E2E(Playwright/agent-browser), 컴포넌트 테스트(Storybook/Playwright CT), 테스트 환경(happy-dom/jsdom/Browser Mode)
- `docs/testing/verification.md` — **검증·품질 측정**: 커버리지 지표(line/branch, threshold), 비주얼 회귀(toHaveScreenshot), 접근성 자동화(axe/jest-axe), flaky(retry/quarantine), 뮤테이션 테스트(Stryker), 계약 테스트(Pact), 정적 게이트(tsc/eslint-plugin-testing-library), CI 실행(sharding/affected)

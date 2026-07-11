# 테스트 컨벤션 (Vitest + React Testing Library)

> 테스트를 작성할 때는 Vitest + React Testing Library + (네트워크) MSW를 기준으로 상황에 맞게 사용한다. MSW를 쓸 때 핸들러는 `src/mocks/handlers.ts`에 두고, 테스트 파일은 `no-cross-feature` 의존성 규칙상 `src/mocks/server.ts`를 import할 수 없으므로 `server.use(...)`로 테스트별 핸들러를 덮어쓰는 대신 핸들러가 요청 쿼리를 읽어 분기한다.

## 원칙

테스트는 소프트웨어가 **쓰이는 방식을 닮을수록** 신뢰가 높다. 사용자가 보고 조작하는 동작을 검증하고, 구현 세부(state 변수명·내부 메서드·CSS 클래스)는 검증하지 않는다.

## 무엇을 테스트 / 안 하나

- 한다: 렌더 결과, 인터랙션 후 UI 변화, 에러·빈 상태 메시지
- 안 한다: 내부 state 변수명, props 전달 여부, 훅 반환값 직접 assert, React 자체 동작(렌더 사이클·Context 내부)

## 쿼리 우선순위

`getByRole`(`name` 옵션) → `getByLabelText`(폼) → `getByPlaceholderText` → `getByText`(비인터랙티브) → `getByAltText`.

- `getByTestId`는 최후수단: 사용자에게 안 보이는 속성이라 접근성과 무관하고 리팩터에 취약하다.
- `container.querySelector('.class')` 금지: CSS 클래스는 구현 세부다.
- 단언은 jest-dom matcher로: `expect(...).toBeDisabled()` (`button.disabled` 직접 비교 X).
- role 쿼리와 짝을 이루는 jest-dom 접근성 matcher: `toHaveAccessibleName` / `toHaveAccessibleDescription` / `toHaveErrorMessage`(https://github.com/testing-library/jest-dom).
- 위 우선순위 체인은 Testing Library 공식 가이드의 3단계 구조를 압축한 것이다: `getByDisplayValue`까지 포함하는 1단계(누구나 접근 가능한 쿼리) → `getByAltText`/`getByTitle`의 2단계(Semantic 쿼리) → `getByTestId`의 3단계(Test ID) 순으로 내려간다(https://testing-library.com/docs/queries/about/#priority).

## 상호작용 · 비동기

- `userEvent.setup()` + `await user.click(...)`. `fireEvent`는 예외적 단일 이벤트에만.
- 즉시 존재: `getBy*` / 부재 단언: `queryBy*` / 비동기 등장: `await findBy*` / 복잡 조건: `waitFor`.
- `waitFor` 콜백엔 assertion 하나만. side-effect(이벤트 발생) 금지 — 콜백이 재실행된다.
- user-event v14(2022-04)부터 API가 전부 비동기로 바뀌었다. `userEvent.setup()` + `await`가 필수이고(v13까지는 동기였다), await 없이 호출하는 예제를 보면 outdated 튜토리얼로 의심한다. fake timer를 쓸 때는 `userEvent.setup({ advanceTimers })` 옵션으로 내부 delay를 진행시킨다(https://testing-library.com/docs/user-event/intro/).
- `waitFor(() => getBy...)`를 손수 쓰는 대신 `findBy*`를 쓴다 — `findBy*`는 내부적으로 `getBy` + `waitFor`이고 기본 타임아웃 1000ms, 폴링 간격 50ms다(https://testing-library.com/docs/dom-testing-library/api-async/#findby-queries).

## 모킹

- 네트워크는 MSW 핸들러(`src/mocks/handlers.ts`)로. axios/fetch 무관하게 환경 레벨에서 인터셉트되고 재사용된다.
- **외부 경계만** 모킹한다. 내 코드의 내부 모듈을 `vi.mock`하면 실제 통합을 숨겨 false green을 만든다.
- `afterEach(() => vi.clearAllMocks())`로 테스트 간 오염을 차단한다.

## 네이밍 · 구조

- 이름은 사용자 행동 + 결과로: `it('로그인 실패 시 에러 메시지를 보여준다')` (`it('renders LoginForm')` X).
- `describe` = 컨텍스트/상태, `it` = 동작. 본문은 given-when-then(Arrange → Act → Assert). 한 `it` = 한 행동.

## AI 단골 안티패턴

| 안티패턴                            | 대신                          |
| ----------------------------------- | ----------------------------- |
| `container.querySelector('.class')` | `getByRole(...)`              |
| 내부 state·메서드 assert            | state 변화가 만든 UI를 검증   |
| 전체 컴포넌트 snapshot 남용         | 작고 안정적인 조각에만        |
| `waitFor` 빈/다중 콜백              | 콜백 안 assertion 하나        |
| 내부 모듈 `vi.mock`                 | 외부 경계만, 내부는 실제 코드 |
| `getByTestId` 기본 사용             | `getByRole`/`getByLabelText`  |

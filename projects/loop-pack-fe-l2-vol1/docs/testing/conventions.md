# 테스트 컨벤션 (Vitest + React Testing Library)

> 이 레포는 아직 테스트 스택 미설치다. 테스트 도입 시 Vitest + React Testing Library + (네트워크) MSW 기준으로 이 문서를 적용한다.

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

## 상호작용 · 비동기

- `userEvent.setup()` + `await user.click(...)`. `fireEvent`는 예외적 단일 이벤트에만.
- 즉시 존재: `getBy*` / 부재 단언: `queryBy*` / 비동기 등장: `await findBy*` / 복잡 조건: `waitFor`.
- `waitFor` 콜백엔 assertion 하나만. side-effect(이벤트 발생) 금지 — 콜백이 재실행된다.

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

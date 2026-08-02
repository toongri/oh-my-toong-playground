# 테스트 컨벤션 (Vitest + React Testing Library)

> 테스트를 작성할 때는 Vitest + React Testing Library + (네트워크) MSW를 기준으로 상황에 맞게 사용한다. MSW 핸들러는 루트 `mocks/handlers.ts`에 둔다. `pnpm depcruise`(= `depcruise src`)는 `src/`만 스캔하므로, 핸들러가 `src/mocks/`에 있던 예전 구조에서는 `no-cross-feature` 규칙이 `src/<feature>/*` → `src/mocks/*` import를 막아 어떤 피처의 테스트도 `mocks/server.ts`를 import해 `server.use(...)`로 핸들러를 재정의할 수 없었다. 루트 `mocks/`는 이 스캔 범위 밖이라 어느 피처의 스위트든 자유롭게 import할 수 있다 — 이것이 테스트별 오버라이드에 `server.use(...)`를 쓸 수 있게 된 이유다.

## 원칙

테스트는 소프트웨어가 **쓰이는 방식을 닮을수록** 신뢰가 높다. 사용자가 보고 조작하는 동작을 검증하고, 구현 세부(state 변수명·내부 메서드·CSS 클래스)는 검증하지 않는다.

## 무엇을 테스트 / 안 하나

- 한다: 렌더 결과, 인터랙션 후 UI 변화, 에러·빈 상태 메시지
- 안 한다: 내부 state 변수명, props 전달 여부, 훅 반환값 직접 assert, React 자체 동작(렌더 사이클·Context 내부)

> ⚠️ 흔한 오해: 이 금지는 **컴포넌트 하나가 쓰는 훅**에 한정된다 — 반환값이 화면을 보는 사용자에게는 중간 산물이기 때문이다. 퍼블리시된 재사용 훅은 반환값이 곧 공개 계약이라 이 금지가 적용되지 않는다. 훅을 어디서 검증할지는 [hooks.md](./hooks.md) 참고.

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

- 네트워크는 MSW 핸들러(`mocks/handlers.ts`)로. axios/fetch 무관하게 환경 레벨에서 인터셉트되고 재사용된다.
- **외부 경계만** 모킹한다. 내 코드의 내부 모듈을 `vi.mock`하면 실제 통합을 숨겨 false green을 만든다.
- `afterEach(() => vi.clearAllMocks())`로 테스트 간 오염을 차단한다.

## 테스트 유틸 · 픽스처

- 공용 `render` — provider(Query client·테마·i18n 등)로 감싸는 커스텀 `render`를 만들고 `@testing-library/react`를 전부 re-export하면서 `render`만 덮어쓴다(https://testing-library.com/docs/react-testing-library/setup/). 모든 테스트에 동일한 앰비언트 컨텍스트를 공급할 뿐 특정 테스트의 원인은 인코딩하지 않는다 — General Fixture와는 다르다. 그 경계 판단은 [setup-and-coupling.md](./setup-and-coupling.md) 참고.
  - 단, 이 저장소는 `export *`(`ExportAllDeclaration`)를 배럴 규칙으로 전역 금지한다(`eslint.config.mjs`의 `no-restricted-syntax`, 메시지: "배럴은 순수 named re-export만 — `export *` 금지"). 그래서 `mocks/render.tsx`는 공식 처방의 "전부 re-export" 대신 **실제로 쓰는 이름만 named re-export**한다(`export { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"`). 새 RTL API(예: `act`)가 필요해지면 이 목록에 먼저 추가해야 한다.
- 핸들러 조직 — 커지면 도메인별 파일로 나누고 나중에 합성한다(https://mswjs.io/docs/best-practices/structuring-handlers). 공식 권장은 테스트별 오버라이드를 `server.use()`로 얹는 것이다(https://mswjs.io/docs/best-practices/network-behavior-overrides). 이 레포는 위 상단 안내대로 `mocks/`가 `src/` 밖에 있어 `no-cross-feature` 제약을 받지 않으므로, 테스트별 오버라이드가 필요하면 공식 권장대로 `server.use()`를 그대로 쓸 수 있다.
- 테스트 데이터는 팩토리로 뽑는다. 테스트 대역 배선(`vi.mock` 연결)은 값이 아니라 구조라 팩토리로 못 뽑는다 — 상세는 [setup-and-coupling.md](./setup-and-coupling.md).

## 네이밍 · 구조

- 이름은 사용자 행동 + 결과로: `it('로그인 실패 시 에러 메시지를 보여준다')` (`it('renders LoginForm')` X).
- `describe` = 컨텍스트/상태, `it` = 동작. 본문은 given-when-then(Arrange → Act → Assert). 한 `it` = 한 행동.

## AI 단골 안티패턴

| 안티패턴                            | 대신                             |
| ----------------------------------- | -------------------------------- |
| `container.querySelector('.class')` | `getByRole(...)`                 |
| 내부 state·메서드 assert            | state 변화가 만든 UI를 검증      |
| 전체 컴포넌트 snapshot 남용         | 작고 안정적인 조각에만           |
| `waitFor` 빈/다중 콜백              | 콜백 안 assertion 하나           |
| 내 피처 코드 `vi.mock`              | 외부/프레임워크 경계·어댑터만    |
| `getByTestId` 기본 사용             | `getByRole`/`getByLabelText`     |
| 훅 함수를 직접 호출해 촉발          | 실제 상호작용(클릭)으로 촉발한다 |
| 파일마다 mock 스캐폴드 복붙         | 경계를 밖으로 밀어 셋업을 없앤다 |

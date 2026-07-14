# 테스트 도구 선택

카테고리별로 어떤 도구를 기본값으로 쓰고 언제 벗어나는지 정리한다. 도구를 고른 다음 "테스트를 어떻게 쓰는가"는 [conventions.md](./conventions.md), "어느 레이어에서 무엇을 테스트하는가"는 [test-layers.md](./test-layers.md)에 있다.

## 러너: Vitest 기본

신규 프로젝트는 전부 Vitest를 기본값으로 쓴다. Vite-native라 별도 트랜스폼 설정 없이 네이티브 ESM·TypeScript를 그대로 실행하고, Jest와 호환되는 API(`describe`/`it`/`expect`)를 제공해 마이그레이션 비용이 낮다. 실행 속도도 Jest보다 빠르다(https://vitest.dev). 2025 State of JS 테스트 라이브러리 설문에서도 Vitest가 상위권으로 나타난다(https://2025.stateofjs.com/en-US/libraries/testing/).

**예외: Jest를 써야 하는 경우**

- React Native 프로젝트 — RN은 Vitest를 지원하지 않아 Jest가 유일한 강제 선택지다.
- 대형 레거시 CJS/Babel 코드베이스 — 이미 Jest 설정에 깊이 의존한다면 마이그레이션 비용이 이득보다 크다.

## DOM 테스트: RTL 3종 세트

DOM 렌더·조회는 React Testing Library(RTL), 사용자 상호작용 시뮬레이션은 `@testing-library/user-event`, 커스텀 단언은 `@testing-library/jest-dom`을 쓴다. 세 조합은 React 생태계에서 사실상 유일한 표준이라 경쟁 대안을 고려할 필요가 없다. 구체적인 쿼리·상호작용 관용구는 [conventions.md](./conventions.md)에서 다룬다.

## 네트워크 모킹: MSW

네트워크 모킹은 MSW(Mock Service Worker)를 쓴다. MSW는 `fetch`/`axios` 같은 클라이언트 함수를 가로채는 대신 **네트워크 요청 경계 자체**를 인터셉트한다. 그래서 어떤 HTTP 클라이언트를 쓰든 같은 핸들러가 동작하고, 테스트·개발 서버·Storybook에서 핸들러를 그대로 재사용할 수 있다(https://mswjs.io/blog/why-mock-service-worker/).

이 방식은 [conventions.md의 "외부 경계만 모킹" 원칙](./conventions.md#모킹)과 같은 축이다 — 내부 모듈을 `vi.mock`하면 실제 통합이 숨어 false green이 나오는 것처럼, 네트워크도 라이브러리 함수가 아니라 경계 자체를 가로채야 실제 요청 흐름을 검증한다.

### MSW의 전제와 실패 모드

> **Caveat**: MSW는 HTTP 요청 경계를 가로챈다. 따라서 두 가지가 성립해야 동작한다:
> **① 테스트 환경에서 그 호출이 실제로 HTTP 요청이 되어야 하고,**
> **② 그 요청이 핸들러가 매칭하는 축(method·URL·operationName)으로 식별 가능해야 한다.**

**①이 깨지는 경우 — Next.js Server Action.** `'use server'` 모듈을 Vitest에서 import하면 평범한 async 함수일 뿐이다. 액션 ID도 client reference 마커도 없이 인프로세스로 실행되고, fetch는 0회 발생한다. 프로덕션에서는 Next.js 컴파일러가 클라이언트 번들을 만들 때 함수를 "액션 ID + POST 디스패처"로 치환하는데, Vitest는 이 컴파일러를 태우지 않는다. MSW가 이 호출을 "못 잡는" 게 아니라 애초에 "잡을 네트워크 요청이 없다" — 올바른 레버는 `vi.mock`(모듈 모킹)이다. 이건 "외부 경계만 모킹" 원칙의 예외가 아니라, Server Action이 이 테스트 환경에서는 네트워크 경계가 아니라는 사실이다. (참고: 프로덕션 런타임에서 액션은 자기 페이지 URL로 POST되고 액션 ID는 `next-action` 헤더에 실린다(https://nextjs.org/docs/app/guides/server-actions) — URL만으로는 액션을 식별할 수 없다. 응답은 Flight 스트림이고 MSW에 `rsc` 네임스페이스는 없다. Next.js 공식 Vitest 가이드(https://nextjs.org/docs/app/guides/testing/vitest)는 MSW도 Server Action 테스트 방법도 다루지 않는다 — 이 부분은 1차 출처가 없다.)

**②가 깨지는 경우 — GraphQL 배칭.** Apollo `BatchHttpLink`는 여러 operation을 하나의 HTTP 요청 배열 body로 합친다(https://www.apollographql.com/docs/react/api/link/apollo-link-batch-http). MSW의 `graphql` 핸들러는 body에서 `.query`를 찾는데 배칭 body는 배열이라 매칭이 실패한다 — `graphql.operation()` 만능 핸들러도 마찬가지다. 공식은 이걸 wontfix로 밝혔다: "MSW does not provide a built-in way of handling such queries." 메인테이너도 "query batching isn't a part of the GraphQL specification… MSW, however, cannot cater to particular clients, it's against our core philosophy."라고 답했다(https://github.com/mswjs/msw/issues/510). 공식 우회로는 있다 — `graphql` 네임스페이스 대신 `http.post()` + `getResponse()`로 배열을 언랩해 개별 핸들러에 재분배한다(https://mswjs.io/docs/recipes/graphql-query-batching). 배칭 전송을 쓰는 다른 RPC 스택에도 같은 모양의 함정이 있다 — 어댑터 라이브러리에 의존한다면 그 어댑터가 배칭을 지원하는지 먼저 확인하라.

MSW가 지원하는 프로토콜은 `http` / `graphql` / `ws`(WebSocket, 2.6.0+) / `sse`(Server-Sent Events, 2.12.0+)다.

**채택 전 체크리스트:**
1. 그 호출이 테스트 환경에서 실제로 HTTP 요청이 되는가?
2. 요청이 핸들러가 볼 수 있는 축으로 식별되는가? (`http`=method+URL, `graphql`=body의 operationName)
3. body가 핸들러가 기대하는 모양인가? (배칭이면 `graphql` 핸들러가 매칭에 실패한다)
4. 응답을 원하는 포맷으로 만들 수 있는가?
5. 프로토콜이 지원 범위 안인가?

## E2E: Playwright가 표준, 이 저장소는 역할을 나눈다

커뮤니티 표준 E2E 프레임워크는 Playwright다. 만족도 설문에서 Playwright(~91%)가 Cypress(~72%)보다 높게 나타나고, 무료 병렬 실행·샤딩, 크로스브라우저 지원, 실패 재생을 위한 Trace Viewer를 제공한다(https://playwright.dev).

단, 이 저장소는 E2E 역할을 프레임워크 하나로 몰지 않는다. **기능 동작 E2E는 agent-browser**, **시각 회귀는 Playwright의 `toHaveScreenshot()`**이 맡는다. agent-browser는 에이전트가 실제 브라우저를 조작해 사용자 플로우를 검증하는 역할이고, Playwright는 스크린샷 비교에 특화된 역할이다. 구체적인 분담 근거는 [nextjs.md](./nextjs.md)에 있다.

## 컴포넌트 테스트: 대개 plain RTL로 충분

컴포넌트 단위 테스트는 대개 plain RTL(jsdom 또는 happy-dom 환경)로 충분하다. 진짜 브라우저 수준의 레이아웃·CSS·포커스 동작까지 확인해야 할 때만 Storybook의 Vitest addon(https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)이나, 아직 experimental 단계인 Playwright Component Testing으로 올라간다.

## 환경 사다리: 필요한 만큼만 올리기

DOM 환경은 필요한 만큼만 올린다.

1. **happy-dom** — 빠르고 가볍다. 대부분의 RTL 테스트는 여기서 끝난다.
2. **jsdom** — happy-dom보다 완전하지만 느리다. happy-dom이 구현하지 않은 API에 의존할 때만 옮긴다.
3. **Vitest Browser Mode** — 실제 브라우저에서 실행한다. v4.0부터 stable이다(https://vitest.dev/guide/browser/).

⚠️ 흔한 오해: "Vitest 기본 환경이 happy-dom"이 아니다. Vitest의 기본 `environment`는 `node`이고, DOM 환경(happy-dom/jsdom)은 설정 파일에서 명시적으로 켜야 하는 opt-in이다(https://vitest.dev/guide/environment/).

⚠️ 흔한 오해: 루트에 `__mocks__` 디렉터리를 만들어두면 Jest처럼 자동 적용되는 게 아니다. Jest는 루트 `__mocks__`를 자동 적용하지만(https://jestjs.io/docs/manual-mocks), Vitest는 `vi.mock`을 호출하지 않으면 모듈이 자동으로 목되지 않는다. Jest의 automocking을 재현하려면 `setupFiles`에서 모듈마다 `vi.mock`을 직접 호출해야 한다(https://vitest.dev/api/vi.html).

# Next.js App Router 테스트

레이어에 얼마나 투자할지의 배경은 [`test-layers.md`](./test-layers.md), RTL 작성 관용구는 [`conventions.md`](./conventions.md), 실행·커버리지 도구는 [`tooling.md`](./tooling.md), CI 검증 절차는 [`verification.md`](./verification.md)에 있다.

## 공식 도구 분리

Next.js 공식 문서는 레이어별 도구를 이렇게 나눈다(https://nextjs.org/docs/app/guides/testing):

| 레이어        | 도구                                       |
| ------------- | ------------------------------------------- |
| Unit/컴포넌트 | Vitest 또는 Jest + React Testing Library(RTL) |
| E2E           | Playwright 또는 Cypress                     |

이 저장소는 Vitest + RTL을 쓴다(conventions.md 참조). E2E 도구 선택은 아래 "이 저장소의 E2E 분담"에서 다룬다.

## async Server Component 한계

Next.js 공식 문서는 이렇게 못박는다(https://nextjs.org/docs/app/guides/testing/vitest):

> "Since `async` Server Components are new to the React ecosystem, Vitest currently does not support them. While you can still run unit tests for synchronous Server and Client Components, we recommend using E2E tests for `async` components."

이 캐비엇은 Next.js 13부터 16까지 바뀌지 않았다 — Vitest뿐 아니라 jsdom 기반 러너 전반에 적용되는 구조적 한계다. 동기 Server/Client Component는 여전히 unit으로 렌더 가능하다 — 문제는 `async` 함수 컴포넌트에 한정된다.

**이유**: async Server Component는 `Promise`를 반환하는 함수다. RTL이 구동하는 클라이언트 렌더러는 동기 함수 트리만 렌더할 수 있어 `Promise`를 반환하는 컴포넌트를 렌더하지 못한다. 게다가 이 컴포넌트가 실제로 필요로 하는 것 — `cookies()`/`headers()` 같은 서버 전용 API, fetch 캐싱, 서버→클라이언트 Flight 직렬화 — 은 jsdom에 존재하지 않는다. 진짜 Next.js 서버를 띄우는 E2E만이 이 경로를 통과시킨다.

## Server Actions

Server Action은 **얇은 wrapper(E2E로 검증) + 추출한 순수 로직(unit으로 검증)**으로 나눈다. Client 컴포넌트 unit 테스트에서 action 자체를 `vi.mock`하지 않는다 — action을 모킹하면 실제로 폼이 action에 연결됐는지 확인할 방법이 사라진다. 대신 action이 호출하는 데이터 계층(DB 클라이언트, fetch 등 외부 경계)을 모킹한다 — conventions.md의 "외부 경계만 모킹" 원칙과 같다.

## Route Handlers

`app/api/.../route.ts`는 브라우저가 아니라 서버에서 돈다 — 테스트 환경을 jsdom이 아니라 `node`로 설정한다.

```ts
// vitest.config.ts (route handler 테스트 파일에 한정)
export default defineConfig({
  test: { environment: "node" },
});
```

- 순수 로직(요청 파싱·응답 조립)은 핸들러 함수를 직접 import해서 unit으로 검증한다.
- `cookies()`/`headers()`/`redirect()`처럼 Next.js 런타임에 의존하는 핸들러는 직접 import만으로 재현하기 어렵다 — 커뮤니티 표준 도구인 **next-test-api-route-handler(NTARH)**로 Next 런타임 컨텍스트를 흉내낸다(https://github.com/Xunnamius/next-test-api-route-handler).

## Next 프리미티브 모킹

- `next/jest`는 `next/font`·이미지·CSS import를 자동으로 모킹한다. Vitest는 이 자동 모킹이 없어 직접 설정이 필요하다.
- `next/navigation`(`useRouter`/`usePathname`/`useSearchParams`/`useParams`)은 수동 `vi.mock` 또는 `next-router-mock`으로 대체한다.

## 이 저장소의 E2E 분담

커뮤니티 표준 E2E 프레임워크는 Playwright다 — 이 저장소는 **기능 검증과 시각 회귀를 서로 다른 도구로 나눈다**:

- **기능 E2E** — **agent-browser**. AI가 실제 브라우저를 구동해 플로(로그인 → 폼 제출 → 결과 확인 같은 사용자 시나리오)가 동작하는지 확인한다.
- **시각/디자인 회귀** — **Playwright의 `toHaveScreenshot()`**. 픽셀 diff는 결정론이 생명이라 — 매번 같은 입력에 같은 출력이 나와야 diff가 의미 있다 — AI 주도 스크린샷보다 고정된 스크린샷 비교가 더 정확하다.

두 도구를 구동하는 구체적인 절차는 [`tooling.md`](./tooling.md), CI에서 무엇을 게이트로 거는지는 [`verification.md`](./verification.md)에 있다.

## 한 줄 규칙

브라우저에서 돌거나 순수 로직이면 **unit(Vitest + RTL)**. 동작이 Next.js 서버에서만 온전히 성립하면(async Server Component·streaming·Server Actions·라우트 플로) 기능은 **agent-browser E2E**, 시각 회귀는 **Playwright**로 검증한다.

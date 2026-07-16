# 테스트 레이어 — 어디에 얼마나 투자할까

RTL 작성 관용구(쿼리·상호작용·모킹·네이밍)는 [`conventions.md`](./conventions.md), Next.js App Router의 레이어 배치는 [`nextjs.md`](./nextjs.md), 실행·커버리지 도구는 [`tooling.md`](./tooling.md), CI 검증 절차는 [`verification.md`](./verification.md)에 있다.

## 원칙

테스트는 소프트웨어가 쓰이는 방식을 닮을수록 신뢰가 높다(https://testing-library.com/docs/guiding-principles) — 이 원칙은 conventions.md가 이미 다뤘다. 이 문서는 같은 원칙을 **레이어 배분**에 적용한다: 어느 레이어에 얼마나 투자하고, 각 레이어가 무엇을 검증해야 하는가.

## 레이어 4단계 — Testing Trophy

Kent C. Dodds는 신뢰도와 비용의 관계를 트로피 모양으로 그린다(https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications). 아래 레이어일수록 실행이 빠르고 싸지만 사용자 경험과는 멀어지고, 위 레이어일수록 느리고 비싸지만 신뢰는 높아진다.

- **Static** — ESLint, TypeScript. 코드를 실행하지 않고도 잡히는 타입 오류·미사용 변수.
- **Unit** — 순수 함수, 훅 하나, 컴포넌트 하나를 격리해서 검증한다.
- **Integration** — 여러 컴포넌트·모듈이 실제로 맞물려 동작하는지 검증한다. 트로피에서 가장 두꺼운 허리 부분.
- **E2E** — 실제(또는 실제에 가까운) 브라우저·서버로 전체 플로를 검증한다.

Dodds는 이 중 **integration에 가장 많이 투자하라**고 권한다(https://kentcdodds.com/blog/write-tests). 컴포넌트 하나만 격리해서 렌더해서는 배선이 실제로 맞물렸는지 알 수 없고, E2E는 신뢰는 높지만 느리고 깨지기 쉬워 전부를 E2E로 채우면 피드백 루프가 죽는다. Integration은 확신 대비 비용이 가장 좋은 지점이다.

> **주의**: Dodds는 "이 비율대로 작성하라"는 숫자를 공개한 적이 없다. "unit 20%, integration 50%..." 같은 비율은 흔한 오인용이다 — 숫자가 아니라 **"integration을 상대적으로 더 두껍게"**라는 방향성으로만 읽는다.

## Trophy vs Pyramid

트로피가 나왔다고 마틴 파울러의 피라미드(https://martinfowler.com/articles/practical-test-pyramid.html)가 죽은 건 아니다. 피라미드는 "unit을 가장 두껍게, 위로 갈수록 얇게"를 말한다 — 이는 **로직 밀도가 높은 도메인**(계산·상태 전이가 많은 백엔드, 규칙 엔진)에서 여전히 유리하다. 순수 로직은 격리된 unit 테스트로 빠르고 정확하게 잡히기 때문이다.

반대로 이 저장소처럼 **UI 조립이 많은 프론트엔드**는 트로피 쪽이 맞다 — 컴포넌트 하나의 내부 로직보다 "여러 컴포넌트가 맞물려 사용자에게 보여지는 결과"가 버그의 주무대이기 때문이다.

2024~2026년의 합의는 "트로피가 피라미드를 대체했다"가 아니라 **"아키텍처가 모델을 고른다"**는 쪽이다. 이 문서는 프론트엔드 코드를 다루므로 트로피를 기본값으로 삼되, 어느 한쪽을 정답으로 단정하지 않는다.

## 동작 vs 구현 세부

레이어 배분보다 더 자주 틀리는 지점은 **레이어 안에서 무엇을 assert하는가**다(https://kentcdodds.com/blog/testing-implementation-details). 여기서 positive/negative는 의학 검진과 반대로 읽어야 한다 — **"positive"는 "통과하는 테스트"**를 뜻한다.

| 유형          | 뜻                              | 원인                                                                        |
| ------------- | ------------------------------- | --------------------------------------------------------------------------- |
| False negative | SW는 멀쩡한데 테스트가 실패한다 | 내부(state 변수명·메서드 호출·DOM 구조)에 assert → 리팩터만 해도 빨갛게      |
| False positive | SW는 깨졌는데 테스트가 통과한다 | 내부 함수 호출만 확인하고 사용자가 보는 결과는 확인 안 함 → 배선이 끊겨도 초록 |

구현 세부를 assert하면 이 둘을 동시에 유발한다 — "무엇이 일어났는가"가 아니라 "어떻게 일어났는가"에 결합되기 때문이다. 사용자가 관찰할 수 있는 결과(동작)만 assert하면 리팩터에도 안 깨지고(false negative 회피), 배선이 끊기면 확실히 빨개진다(false positive 회피).

> 아래 예제는 간결성을 위해 import를 생략한다 — `globals: false`라 실제 파일 맨 위엔 `import { test, expect, vi } from "vitest"`와 `@testing-library/react`·`user-event` import가 필요하다.

```tsx
// ❌ 구현 세부에 결합 — 내부 호출 여부만 확인, 리팩터하면 빨갛게
test("담기를 누르면 addItem이 호출된다", async () => {
  const addItem = vi.fn();
  const user = userEvent.setup();
  render(<ProductCard onAdd={addItem} />);
  await user.click(screen.getByRole("button", { name: "담기" }));
  expect(addItem).toHaveBeenCalled(); // 호출 여부만 봄 — 장바구니에 실제로 반영됐는지는 모름
});

// ✅ 동작만 확인 — 사용자가 관찰하는 결과로 assert
test("담기를 누르면 장바구니 개수가 올라간다", async () => {
  const user = userEvent.setup();
  render(<Cart />);
  await user.click(screen.getByRole("button", { name: "담기" }));
  expect(await screen.findByText("장바구니 1개")).toBeInTheDocument();
});
```

무엇을 테스트하고 어떤 쿼리·모킹 관용구를 쓸지는 conventions.md의 안티패턴 표를 참조한다 — 이 문서는 그 관용구가 "왜 필요한가"의 근거만 다룬다.

## 관찰 가능한 결과가 없을 때

위 원칙은 **사용자가 관찰할 수 있는 결과가 존재할 때** 성립한다. 애널리틱스·모니터링처럼 서드파티로 단방향 전송만 하는 호출은 화면에 아무 결과도 남기지 않는다 — assert할 DOM이 없다.

MSW 공식 문서는 요청 자체를 assert하는 데 기본적으로 반대한다(https://mswjs.io/docs/best-practices/avoid-request-assertions):

> "We highly discourage against such assertions as they represent implementation detail testing... Treat this as the default recommendation when testing with MSW."

그런데 같은 문서가 스스로 이 상황을 짚어 별도로 허용한다:

> "there are scenarios when a performed request has no indication in the application that can be asserted. These are usually one-way requests against third-party services, like analytics or monitoring. For those cases, please use the Life-cycle events API to provide direct assertions on requests/responses."

이 허용이 힘을 갖는 이유는 출처에 있다. MSW는 이 문서 세트가 네트워크 모킹 기본값으로 쓰는 도구이자, 요청 assert에 반대하는 목소리 중 가장 크다. 가장 엄격한 출처가 스스로 이 조건을 지정했다면, 이건 스파이를 쓰고 싶은 사람이 밀수한 게 아니라 규칙의 저자가 직접 허가한 것이다. (MSW는 이런 경우를 위해 Life-cycle events API로 요청·응답에 직접 assert를 붙이는 길을 열어둔다 — 이 문서는 레이어 투자 판단 문서이므로 API 사용법은 다루지 않는다.)

이론적 근거는 GOOS(Freeman & Pryce, *Growing Object-Oriented Software, Guided by Tests*, 2009)의 "Allow Queries; Expect Commands"다. 반환값이 없고 부작용만 있는 command는 무엇을 반환했는지가 아니라 무엇을 호출했는지 자체가 검증 대상이 된다 — query처럼 assert할 반환값이 없기 때문이다. 이 매핑의 원출처는 GOOS다. Fowler의 mocksArentStubs 글에는 이 매핑이 없다 — query/command 구분과 mock/stub 구분을 같은 글의 것으로 오귀속하는 경우가 흔하니 짚어둔다.

이 조건에는 가드 두 개가 따라붙는다. 없으면 조건이 규칙 전체를 집어삼킨다.

**(i) 트리거는 여전히 실제 사용자 상호작용이어야 한다.** 이 조건이 허용하는 건 *어디서 관측하는가*(스파이로도 된다)이지 *어떻게 촉발하는가*가 아니다. 버튼을 클릭한 다음 스파이를 assert하는 것과, 훅이 반환한 함수를 직접 불러서 같은 스파이를 assert하는 것은 다르다. 후자는 "이 함수를 부르면 이 함수가 그걸 부르는가"라는 동어반복이고, 그 함수가 실제 버튼에 연결돼 있지 않아도 초록으로 통과한다 — 위 표가 정의한 바로 그 false positive다. 훅을 격리해서 테스트할지 컴포넌트를 통해 테스트할지의 판단 기준은 [hooks.md](./hooks.md)에서 다룬다.

**(ii) 인자까지 assert한다.** `toHaveBeenCalled()`(호출 여부)가 아니라 `toHaveBeenCalledWith(...)`(command와 그 인자)를 쓴다. GOOS의 "Expect Commands"는 command 자체가 아니라 command와 그 인자에 대한 것이다. 위 ❌ 예시가 맨 `toHaveBeenCalled()`를 쓴다는 데 주목한다 — 이 조건이 요구하는 최소 기준은 그 ❌보다 한 단계 높다.

```tsx
// ❌ 트리거가 실제 상호작용이 아니다 — 훅을 격리 렌더하고 반환된 함수를 직접 호출, 화면 assert가 0개
test("장바구니 담기를 호출하면 트래킹된다", () => {
  const trackEvent = vi.fn();
  const { result } = renderHook(() => useAddToCart({ trackEvent }));
  result.current.addToCart("item-1"); // 버튼이 이 훅에 연결돼 있는지는 아무것도 확인 안 함
  expect(trackEvent).toHaveBeenCalled();
});

// ✅ 실제 상호작용으로 촉발 → 관찰 가능한 결과를 먼저 assert → 스파이 assert는 추가분
test("담기를 누르면 장바구니가 갱신되고 트래킹된다", async () => {
  const trackEvent = vi.fn();
  const user = userEvent.setup();
  render(<Cart onTrack={trackEvent} />);
  await user.click(screen.getByRole("button", { name: "담기" }));
  expect(await screen.findByText("장바구니 1개")).toBeInTheDocument(); // 관찰 가능한 결과
  expect(trackEvent).toHaveBeenCalledWith("add_to_cart", { itemId: "item-1" }); // 대체가 아니라 추가
});
```

> **주의**: 애널리틱스 검증에 벤더 공식 처방은 없다. Amplitude 공식 가이드(https://amplitude.com/docs/get-started/track-your-progress)가 처방하는 건 자동화 테스트가 아니라 수동 QA다 — User Activity 피드에 이벤트가 뜨는지 눈으로 확인하라는 것뿐이다. Segment Typewriter가 유일하게 벤더가 공식 제공한 자동화 메커니즘이었으나, 공식 문서가 "not actively maintained"라고 명시한다. 따라서 이 절의 입장(스파이 assert + 두 가드)은 이 문서 세트의 추론이지, 벤더가 위임한 정석이 아니다.

스파이를 위한 모킹 배선을 셋업에 얼마나 투자할지는 [setup-and-coupling.md](./setup-and-coupling.md)를 참조한다.

## 서버 컴포넌트와 무게중심 이동

App Router의 async Server Component는 jsdom에서 렌더할 수 없다 — 서버 런타임이 필요하기 때문이다. 그래서 App Router 앱에서는 트로피의 무게가 자연히 **E2E 쪽으로 이동**한다. 무엇을 어느 레이어에서 테스트할지 구체적인 배치는 [`nextjs.md`](./nextjs.md)에서 다룬다.

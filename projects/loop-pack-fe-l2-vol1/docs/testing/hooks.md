# 훅 테스트 — 어느 표면에서 검증할 것인가

훅을 직접 렌더해 반환값을 검증할 것인가, 훅을 쓰는 컴포넌트를 렌더해 화면을 검증할 것인가 — 이 갈림에 정답은 하나가 아니라 **훅마다 다르다.** 아래는 그 표면을 고르는 기준과, 각 표면에서 실제로 무엇을 assert해야 하는지를 다룬다.

## 기준 — 이 훅의 사용자는 누구인가

Kent C. Dodds는 구현 세부를 이렇게 정의한다.

> "Implementation details are things which users of your code will not typically use, see, or even know about."(https://kentcdodds.com/blog/testing-implementation-details)

이 정의를 훅에 적용하면 갈림은 "훅이냐 컴포넌트냐"가 아니라 **이 훅의 사용자가 누구냐**로 좁혀진다.

- 앱 안에서 컴포넌트 하나가 쓰는 훅 — 최종 사용자는 화면을 보는 사람이다. 반환값은 그 사람이 보지 못하는 중간 산물이다.
- 퍼블리시된 재사용 훅(다른 팀·다른 저장소가 import해 쓰는 훅) — 사용자는 그 훅을 호출하는 개발자다. 그 개발자가 실제로 보고 의존하는 게 반환값이므로, **반환값 자체가 공개 계약**이 된다.

(이 결론은 Kent의 정의로부터 이 문서가 도출한 것이지, Kent가 직접 쓴 문장은 아니다.)

훅을 언제 추출할지는 이 문서의 범위가 아니다 — [hook-design.md](../react/hook-design.md)가 이미 레이어·추출 기준을 다룬다. 여기서는 이미 존재하는 훅을 어느 표면에서 검증할지만 다룬다.

## 기본값 — 컴포넌트를 렌더한다

대부분의 훅은 컴포넌트 하나에 묶여 있고, 그 훅의 최종 사용자는 화면을 보는 사람이다. 이 경우 기본값은 훅을 직접 다루지 않고 훅을 쓰는 컴포넌트를 렌더하는 것이다. React Testing Library(RTL) 공식 문서가 이 순서를 명시한다.

> "You should prefer `render` since a custom test component results in more readable and robust tests since the thing you want to test is not hidden behind an abstraction."(https://testing-library.com/docs/react-testing-library/api/)

구체적인 렌더·쿼리 관용구는 [conventions.md](./conventions.md)에 있다. 이 문서는 "어느 표면에서 검증하는가"만 다룬다.

> ⚠️ 흔한 오해: RTL이 `render`를 선호하는 이유는 "구현 세부"가 아니라 **가독성**이다 — 테스트 대상이 추상화 뒤에 숨어 읽기 나쁘다는 것이 RTL이 든 근거다. 이걸 "훅 반환값 assert = 구현 세부 testing"으로 옮겨 적으면 오인용이다.
>
> 더 나아가 **React는 커스텀 훅 테스트에 공식 입장을 낸 적이 없다.** react.dev의 커스텀 훅 문서(https://react.dev/learn/reusing-logic-with-custom-hooks)에는 테스트 언급이 한 줄도 없고, `act` 문서(https://react.dev/reference/react/act)는 테스트를 다루면서도 커스텀 훅은 한 번도 언급하지 않는다. react.dev에는 애초에 테스트 가이드 페이지가 없다. "훅 단독 테스트는 React가 말하는 구현 세부다"는 React가 낸 적 없는 입장이다.

## renderHook이 맞는 경우

| 상황 | 표면 | 근거 |
| --- | --- | --- |
| 컴포넌트 하나에서만 쓰는 일회성 훅 | 컴포넌트 렌더 | "Your hook is defined alongside a component and is only used there... [it's] easy to test by just testing the components using it"(https://react-hooks-testing-library.com/) |
| 퍼블리시된 재사용 훅 | `renderHook` | RTL: "mostly interesting for libraries publishing hooks"(https://testing-library.com/docs/react-testing-library/api/). Kent: "that reusable hook you've published to github/npm... This is why `renderHook`... exists."(https://kentcdodds.com/blog/how-to-test-custom-react-hooks) |
| UI로 몰기 어려운 복잡한 훅 | `renderHook` | Kent: "there are definitely more complicated hooks where using `@testing-library/react` is more useful."(https://kentcdodds.com/blog/how-to-test-custom-react-hooks) |

독자가 정반대로 알고 들어오는 경우가 실제로 있어서 인용을 그대로 남긴다 — "훅은 무조건 컴포넌트로만 검증한다"도, "훅은 무조건 `renderHook`으로 검증한다"도 둘 다 틀렸다.

`renderHook`은 React Testing Library v13.1.0(2022-04)부터 `@testing-library/react`에 포함돼 있다(PR testing-library/react-testing-library#991). 별도 패키지였던 `@testing-library/react-hooks`는 2022-05 공식 폐기됐다(testing-library/react-hooks-testing-library#849). 신규 코드는 `import { renderHook } from '@testing-library/react'` 하나면 충분하다 — 구 패키지를 추가로 설치할 이유가 없다.

`renderHook`을 쓰기로 했다면 반환값을 손수 캡처하는 하네스를 짜지 않는다 — 그건 `renderHook`을 더 나쁘게 재구현한 것이다. 이 문서의 코드 예제는 간결성을 위해 import를 생략한다.

```tsx
// ❌ 반환값을 바깥 변수에 캡처하려고 손수 테스트용 컴포넌트를 짠다
let captured: ReturnType<typeof useOrderStatusFilter> | undefined;
function Harness() {
  captured = useOrderStatusFilter();
  return null;
}

test("초기 상태는 all이다", () => {
  render(<Harness />);
  expect(captured?.status).toBe("all");
});

// ✅ renderHook — 같은 걸 표준 API로, 하네스 없이
test("초기 상태는 all이다", () => {
  const { result } = renderHook(() => useOrderStatusFilter());
  expect(result.current.status).toBe("all");
});
```

## 부작용을 오케스트레이션하는 훅

값을 반환하기보다 결제 제출·라우팅·트래킹처럼 일을 시키는 훅은 위 기준이 바로 먹지 않는다. RTL·Kent·TanStack Query 인용은 전부 **데이터를 반환하는** 훅을 전제로 논한다 — 이 케이스에 대한 1차 출처는 없다.

정직하게 적자면: 아래는 문헌 인용이 아니라 이 문서 세트의 추론이다. 그런 훅의 관측 가능한 출력은 반환값이 아니라 **효과**이므로, 검증도 효과 경계(실제로 호출된 API·실제로 바뀐 라우트·실제로 찍힌 트래킹 이벤트)에서 일어날 수밖에 없다.

단, 트리거는 여전히 실제 사용자 상호작용이어야 한다. 훅 함수(또는 그 안의 핸들러)를 테스트에서 직접 호출해 스파이만 단언하면 동어반복이다 — 버튼이 그 핸들러에 연결돼 있지 않아도 초록으로 통과한다. 관측 가능한 결과가 아예 없어 스파이 단언 자체를 정당화해야 하는 경우의 판단 기준은 [test-layers.md](./test-layers.md)의 "관찰 가능한 결과가 없을 때" 절에 있다.

## Provider가 필요한 훅

`QueryClientProvider`처럼 컨텍스트가 필요한 훅은 목이 아니라 진짜 client로 감싼다. TanStack Query 공식 테스트 가이드(https://tanstack.com/query/latest/docs/framework/react/guides/testing):

```tsx
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const { result } = renderHook(() => useCustomHook(), { wrapper });
await waitFor(() => expect(result.current.isSuccess).toBe(true));
expect(result.current.data).toEqual("Hello");
```

`retry: false`는 필수에 가깝다 — 기본값(3회 재시도 + 지수 백오프)을 그대로 두면 실패 케이스를 테스트할 때 타임아웃난다(https://tanstack.com/query/latest/docs/framework/react/guides/testing). 이런 wrapper를 테스트마다 어떻게 관리하는지(공유할지 매번 새로 만들지)는 [setup-and-coupling.md](./setup-and-coupling.md)에서 다룬다.

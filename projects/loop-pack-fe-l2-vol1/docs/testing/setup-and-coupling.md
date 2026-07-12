# 테스트 셋업 — 무엇을 숨기고 무엇을 보여주는가

숨겨도 되는 값은 기대 결과에 영향을 주지 않는 값이고, 보여야 하는 값은 기대 결과를 결정하는 값이다. Meszaros는 이 기준을 이렇게 못박는다: "the values you don't see don't affect the expected outcome"(http://xunitpatterns.com/Obscure%20Test.html). 셋업이 몇 줄인지가 아니라, 그 줄이 이 테스트의 기대 결과를 결정하는지가 판정선이다.

## arrange 비대 — 결합도 신호

Google 엔지니어링 사례집은 셋업이 커지는 원인을 SUT(테스트 대상 시스템) 쪽 문제로 먼저 지목한다: "A test that requires many functions to be stubbed can be a sign that stubbing is being overused, or that the system under test is too complex and should be refactored."(https://abseil.io/resources/swe-book/html/ch13.html)

Steve Freeman은 이 반응을 더 직접적으로 적는다: "Just the thought of writing expectations for all these objects makes me wilt, which suggests that things are too complicated."(https://web.archive.org/web/20230607215156/http://www.mockobjects.com/2007/04/test-smell-bloated-constructor.html) Michael Feathers는 같은 관찰을 설계 원리로 일반화한다: "Aiming for testability actually changes your design." 그리고 그 원인을 이렇게 짚는다: "Classes which are hard to instantiate and use in a test harness are more coupled than they could be."(https://web.archive.org/web/20250911091203/https://michaelfeathers.typepad.com/michael_feathers_blog/2007/09/the-deep-synerg.html)

훅 하나를 테스트하려는데 가짜를 여러 개 세워야 한다면, 그건 테스트가 못난 게 아니라 그 훅이 그만큼 많은 것을 알고 있다는 뜻이다. 테스트는 설계에 대한 객관적 피드백 채널이다. [`hook-design.md`](../react/hook-design.md) §5는 "한 문장으로 설명되는가"라는 질적 테스트를 준다 — 그건 주관적이라 자기기만이 가능하지만, mock 개수는 부정할 수 없다.

> ⚠️ 흔한 오해: "mock 11개면 과다", "셋업이 파일의 81%면 결합도 문제" 같은 숫자는 어떤 1차 출처에도 없다. Meszaros·Google·Freeman·Feathers 누구도 임계값을 공개한 적 없다 — 문헌이 주는 건 인과 기준("기대 결과에 영향을 주는가")과 질적 신호("expectations 쓸 생각만 해도 시들해진다")뿐이다. 숫자가 아니라 **이 두 기준으로만** 읽는다. ([`test-layers.md`](./test-layers.md)가 "unit 20%/integration 50%" folklore를 같은 방식으로 논파한다.)

## 함정 — General Fixture

중복을 없애려고 공유 픽스처를 만들면 정반대 문제가 생긴다. Meszaros: "The root cause is that both these approaches involve using a Standard Fixture that must meet the requirements of all the tests that use it. The more diverse their needs, the more likely we are to be creating a General Fixture."(http://xunitpatterns.com/Obscure%20Test.html) 후속 피해는 예측 가능하다: "When a Standard Fixture is modified to accommodate a new test, several other tests fail."(http://xunitpatterns.com/Fragile%20Test.html)

Google도 같은 함정을 경고한다 — 리팩터는 "not solely in the name of reducing repetition"(https://abseil.io/resources/swe-book/html/ch12.html)이어야 한다. Kent C. Dodds는 그 흔한 형태를 지목한다: "I just don't recommend [beforeEach] as a mechanism for code reuse."(https://kentcdodds.com/blog/avoid-nesting-when-youre-testing) `beforeEach`가 코드 재사용 도구가 되는 순간, 그 파일의 모든 테스트가 필요로 하는 값의 합집합이 매 테스트 앞에서 강제로 실행된다.

## 판별기 — 호출 위치가 가른다

중복 자체는 진짜 냄새다. Meszaros도 추출을 처방으로 인정한다: "Once the Test Code Duplication has occurred, the best solution is to use an Extract Method refactoring to create a Test Utility Method... When the Test Code Duplication is fixture setup logic, we end up with Creation Methods."(http://xunitpatterns.com/Test%20Code%20Duplication.html) 문제는 추출 여부가 아니라 **무엇을, 어떻게** 추출하느냐다.

|           | Extract Method (처방)                 | General Fixture (안티패턴)            |
| --------- | -------------------------------------- | -------------------------------------- |
| 호출 위치 | 테스트 **본문에서** 호출               | 테스트 **뒤에서** 설치 (`beforeEach`)  |
| 파라미터  | 이 테스트를 다르게 만드는 **인과 축**  | 고정 — 차이를 표현 못 함               |
| 크기      | 이 테스트가 **필요한 만큼**            | N개 테스트 필요의 **합집합**           |

> 아래 예제는 간결성을 위해 import를 생략한다.

```tsx
// 파일 상단 — wiring은 모듈당 한 번, 고정
vi.mock("@/features/coupon", () => ({ useCoupon: vi.fn() }));

// ❌ General Fixture — beforeEach가 파일의 모든 테스트가 필요로 하는 값의 합집합을 강제한다
beforeEach(() => {
  vi.mocked(useCoupon).mockReturnValue({ status: "active", discount: 1000 });
  vi.mocked(useUser).mockReturnValue({ tier: "normal" });
  vi.mocked(useShipping).mockReturnValue({ fee: 3000 });
});

test("만료된 쿠폰이면 적용 버튼이 비활성화된다", () => {
  vi.mocked(useCoupon).mockReturnValue({ status: "expired", discount: 1000 }); // beforeEach 값을 덮어쓰며 시작
  render(<CouponApplyButton />);
  expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
});

// ✅ Parameterized Creation Method — 테스트 본문에서 호출, 이 테스트를 가르는 축(status)만 받는다
function setupCouponApply(status: CouponStatus) {
  vi.mocked(useCoupon).mockReturnValue({ status, discount: 1000 });
  return render(<CouponApplyButton />);
}

test("만료된 쿠폰이면 적용 버튼이 비활성화된다", () => {
  setupCouponApply("expired");
  expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
});
```

RTL의 custom `render`(provider 래퍼)는 이 표에서 General Fixture가 아니다. 모든 테스트에 동일한 앰비언트 컨텍스트를 공급할 뿐, 어떤 테스트의 원인도 인코딩하지 않는다 — Meszaros가 말하는 "다양한 요구"가 애초에 없다. RTL 공식이 직접 권장하는 패턴이다(https://testing-library.com/docs/react-testing-library/setup/):

```tsx
const AllTheProviders = ({ children }) => (
  <ThemeProvider theme="light">
    <TranslationProvider messages={defaultStrings}>{children}</TranslationProvider>
  </ThemeProvider>
);
const customRender = (ui, options) => render(ui, { wrapper: AllTheProviders, ...options });
export * from "@testing-library/react";
export { customRender as render }; // render를 덮어쓴다
```

## 결정타 — wiring은 데이터가 아니다

셋업이 비대해지는 원인은 두 가지가 섞여 있고, 치료법이 다르다.

- test **data** — 값(`{ 이름: "김철수", 나이: 30 }`). 팩토리로 뽑는다.
- test double **wiring** — 연결(`vi.mock("@/features/coupon", () => ...)`). **팩토리로 못 뽑는다. 값이 아니라 구조다.**

wiring 중복의 치료는 둘뿐이다: 그래프를 줄이거나(디커플), 그래프를 진짜로 만들거나(실제 모듈 + 경계 하나만 모킹). 추출은 세 번째 가짜 치료다 — wiring을 줄이지 않고 안 보이게 만들 뿐이다. 모킹을 유지하면서 동시에 숨길 수는 없다.

## 처방 순서

1. **경계를 밖으로 밀어 셋업을 증발시킨다.** 내부 모듈은 실제 코드를 쓰고 네트워크 경계에서만 가짜를 쓴다 — 추출이 아니라 삭제다. 이 경계가 항상 닿는 건 아니다: [`tooling.md`](./tooling.md)의 MSW 절이 그 경계를 어디서 잡을 수 있고 어디서 못 잡는지 다룬다.
2. **남는 결합도를 줄인다.** Freeman의 실제 알고리즘: "arguments that are always used together in the class, and that have the same lifetime"(https://web.archive.org/web/20230607215156/http://www.mockobjects.com/2007/04/test-smell-bloated-constructor.html) — 항상 함께 쓰이고 수명이 같은 인자를 암묵적 컴포넌트로 묶는다.
3. **그러고도 남는 것만 추출한다.** 형태는 위 판별기의 Extract Method — 테스트 본문에서 호출하고, 인과 축으로 파라미터화한다.

## 팩토리 생태계

값을 뽑는 도구는 짧게만 짚는다. fishery(TS 우선, 유지보수 중)는 factory_bot 계보의 빌더다. faker는 값 생성기이지 빌더 대체재가 아니다 — 기본값에 직접 박으면 테스트가 비결정적이 되고, `faker.seed()`로 고정해야 재현 가능해진다. Vitest·Jest·RTL 공식 문서에는 팩토리 가이드가 없다 — 1차 출처는 Nat Pryce의 Test Data Builders다(http://www.natpryce.com/articles/000714.html). 훅 자체를 어떻게 렌더하고 무엇을 assert할지는 [`hooks.md`](./hooks.md)에서, 모킹 경계의 일반 원칙은 [`conventions.md`](./conventions.md)에서 다룬다.

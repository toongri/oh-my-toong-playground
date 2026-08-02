# UI 흐름의 배치 판단 케이스

아래 케이스들은 FSD 공식 자료가 직접 분류하지 않는 영역이다 — [`./placement.md`](./placement.md)의 다섯 질문과 decision tree를 구체 UI 흐름에 적용해 판단 과정을 시연한다. 레이어 책임 정의는 [`./layers.md`](./layers.md), 상태 원본 판단은 [`./cases-state-ownership.md`](./cases-state-ownership.md), URL 상태 동기화 규칙은 [`../react/url-state.md`](../react/url-state.md)에 있다 — 이미 다룬 판단축은 여기서 다시 설명하지 않고 링크한다.

## 케이스 1 — 모달과 다이얼로그

**상황.** 상품 삭제 확인 모달 하나를 추가하는데, "모달은 결국 다 비슷하니까"라는 이유로 처음부터 전역 모달 매니저부터 설계한다.

```tsx
// ❌ _app/model/modal-store.ts — 모든 모달을 여기로 몰아넣음
type ModalType = "confirm-delete" | "edit-profile" | "login" | "session-expired";

export const useModalStore = create<{ open: ModalType | null; openModal: (t: ModalType) => void }>(
  (set) => ({ open: null, openModal: (open) => set({ open }) }),
);
// 삭제 확인 모달 하나 때문에 레지스트리 엔트리·전역 상태·switch 분기 세 곳을 같이 고쳐야 한다
```

**다섯 질문 적용.** 1번(현재 독립 소비자는 몇 개인가) — 삭제 확인 모달은 상품 상세 화면 하나뿐이다. 5번(Page에 남기면 실제 문제가 생기는가) — 구체적 문제가 없다. 이 둘이 가르는 지점이다. 상태는 가장 낮은 소비자부터 시작한다는 원칙은 [`./layers.md`](./layers.md)의 pages-first 규칙과 동일하다.

```tsx
// ✅ pages/product-detail/ui/DeleteConfirmDialog.tsx — 이 화면 전용, 소비자는 하나
function ProductDetailPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DeleteButton onClick={() => setConfirmOpen(true)} />
      {confirmOpen && <DeleteConfirmDialog onConfirm={handleDelete} onClose={() => setConfirmOpen(false)} />}
    </>
  );
}
```

소비자가 늘어나 여러 화면에서 다이얼로그로 뜨는 경우(예: 장바구니 담다가 로그인 요구)만 widget으로 승격한다 — 이 판단축은 [`./cases-auth.md`](./cases-auth.md)의 login-dialog 케이스와 동일하다. 전역 모달 매니저는 "정말 앱 어디서나 뜨는" 부류에만 남긴다.

```tsx
// ✅ _app/ui/SessionExpiredDialog.tsx — 특정 화면 소비자가 없다, 401을 만나면 어디서든 뜬다
function SessionExpiredDialog() {
  const expired = useAuthStore((s) => s.sessionExpired);
  if (!expired) return null;
  return <Dialog onClose={() => location.assign("/login")}>세션이 만료되었습니다</Dialog>;
}
```

전역 매니저와 로컬 모달의 차이는 "모달이라서"가 아니라 독립 소비자 수와, Page에 남겼을 때 실제로 생기는 문제다.

## 케이스 2 — 페이지네이션·필터·정렬, 세 축이 한 시나리오에 얽힘

**상황.** 목록 화면에 필터·정렬·페이지네이션을 한꺼번에 추가하면서, 필터는 전역 store에 두고 URL과 이중화하고, query key는 일부 조건만 반영한다.

```tsx
// ❌ features/product-filter/model/store.ts — 필터의 원본이 store와 URL로 갈라짐
const useFilterStore = create((set) => ({ category: null, setCategory: (c) => set({ category: c }) }));

// ❌ query key에는 sort가 빠짐 — 정렬을 바꿔도 캐시가 이전 결과를 그대로 돌려준다
useQuery({ queryKey: ["products", category, page], queryFn: () => fetchProducts({ category, sort, page }) });
```

이 함정 자체(query key 조건 누락)의 판단 과정은 [`./cases-state-ownership.md`](./cases-state-ownership.md)의 "query key 조건 누락" 절에 있다 — 여기서는 세 축이 한 화면에 함께 있을 때의 배치만 다룬다.

**다섯 질문을 관통하는 4단계 워크스루.**

① **원본은 URL이다.** 공유·새로고침·뒤로가기 복원이 전부 URL을 신뢰해야 하는 이유와 push/replace 판단은 [`../react/url-state.md`](../react/url-state.md)가 이미 다룬다 — 재교육하지 않는다.

② **조건 객체 하나가 URL 파서 → query key → 요청을 관통한다.** 필터·정렬·페이지를 따로따로 상태로 만들지 않고, 하나의 params 객체로 묶어 URL 파싱부터 요청까지 같은 값을 공유하게 한다.

③ **소유는 그 화면의 Page다.** 배치 매트릭스(`./layers.md`가 아니라 `./placement.md`의 매트릭스)의 "서버 상태" 행이 정하는 대로, 화면별 filter/sort/pagination은 Page 또는 Widget이 소유한다 — 여러 화면이 공유하는 안정된 resource primitive가 아닌 한 Entity로 올리지 않는다.

④ **key 선언은 그 Page의 `api` 세그먼트에 콜로케이션한다.** TanStack Query 생태계에서 널리 쓰이는 key factory 패턴은 콜로케이션 원칙만 차용하고, 레이어 배치는 이 프로젝트의 규범을 따른다 — [TkDodo — Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys)는 "I keep my Query Keys next to their respective queries, co-located in a feature directory"라고 말할 뿐 FSD 레이어를 언급하지 않는다.

```ts
// ✅ pages/product-list/api/keys.ts — 이 Page가 쓰는 요청들의 key를 한 곳에 모은다
const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (params: ProductListParams) => [...productKeys.lists(), params] as const,
};
```

```ts
// ✅ pages/product-list/model/use-list-params.ts — URL이 원본, 필터·정렬·페이지가 한 객체
function useProductListParams() {
  const [params, setParams] = useQueryStates({
    category: parseAsString,
    sort: parseAsStringEnum(["latest", "price-asc"]),
    page: parseAsInteger.withDefault(1),
  });
  return { params, setParams };
}

// ✅ pages/product-list/ui/ProductListPage.tsx — 파서→key→요청이 같은 params를 공유
function ProductListPage() {
  const { params } = useProductListParams();
  const { data } = useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => fetchProducts(params),
  });
  // ...
}
```

전역 store와 URL 이중화, query key 누락 모두 "원본이 여러 곳으로 갈라진다"는 같은 실수의 변형이다 — 원본을 하나로 정하고 그 원본을 관통시키면 세 축이 동시에 정리된다.

## 케이스 3 — 다단계 폼·마법사

**상황.** 회원가입 마법사(약관 동의 → 정보 입력 → 확인)를 만들면서 "여러 단계를 거치는 흐름이니 Processes가 필요하지 않을까" 하고 고민하거나, 단계 상태를 전역 store에 둔다.

```tsx
// ❌ _app/model/wizard-store.ts — 이 마법사 하나를 위해 전역 store를 만듦
const useWizardStore = create((set) => ({
  step: 0,
  formData: {},
  nextStep: () => set((s) => ({ step: s.step + 1 })),
}));
// 다른 화면은 이 store를 알 필요가 없는데도 앱 전체 상태 트리에 얹힌다
```

**다섯 질문 적용.** 2번(변경 이유가 화면인가 domain concept인가) — 이 마법사는 회원가입이라는 한 화면의 흐름이지 도메인 개념이 아니다. Processes 레이어는 이 프로젝트에서 쓰지 않는다 — [`./layers.md`](./layers.md)의 이관 규칙대로 판단한다. 한 route 안에서 끝나는 다단계 흐름이면 그 Page의 `model`이 단계 상태(현재 step·누적 입력)를 소유하고, 여러 route에 걸치는 흐름이면 상위 composition(라우트 그룹 layout 또는 App)이 소유한다.

```tsx
// ✅ pages/signup-wizard/model/use-wizard.ts — 한 route 안의 흐름, Page가 소유
function useSignupWizard() {
  const [step, setStep] = useState<"terms" | "info" | "review">("terms");
  const [draft, setDraft] = useState<Partial<SignupForm>>({});
  const next = (patch: Partial<SignupForm>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStep((s) => (s === "terms" ? "info" : "review"));
  };
  return { step, draft, next };
}
```

여러 route에 걸치는 경우(예: 온보딩이 `/onboarding/profile`, `/onboarding/preferences`처럼 URL이 바뀌는 흐름)는 그 route 그룹의 상위 layout이 누적 입력을 들고, 각 route는 그 layout의 context를 읽는다.

```tsx
// ✅ _app/layouts/OnboardingLayout.tsx — 여러 route에 걸친 흐름은 상위 composition이 소유
function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<Partial<OnboardingForm>>({});
  return (
    <OnboardingContext.Provider value={{ draft, setDraft }}>{children}</OnboardingContext.Provider>
  );
}
```

제출 시점 검증(마지막 단계에서 전체 스키마로 재검증)은 [`./cases-auth.md`](./cases-auth.md)의 `model` 스키마 패턴과 동일하게 각 Page의 `model` segment가 소유한다.

## 케이스 4 — 찜/좋아요의 optimistic update

**상황.** 상품 카드의 하트 버튼을 누르면 서버 응답을 기다리지 않고 즉시 채워진 하트를 보여주고 싶다. 모든 토글에 캐시 조작 + 롤백 로직부터 붙인다.

```tsx
// ❌ 표시 지점이 카드 하나뿐인데도 캐시를 통째로 조작 — 코드만 늘고 얻는 것이 없다
function WishlistHeart({ productId }: { productId: string }) {
  const { mutate } = useMutation({
    mutationFn: toggleWishlist,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: wishlistKeys.all });
      const previous = queryClient.getQueryData(wishlistKeys.all);
      queryClient.setQueryData(wishlistKeys.all, (old) => toggle(old, productId));
      return { previous };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(wishlistKeys.all, ctx?.previous),
  });
  // ...
}
```

**[TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)의 기본값.** 표시 지점이 1곳이면 variables(UI) 방식이 공식 권고다 — 코드가 적고 롤백이 아예 불필요하다. `mutation.variables`와 `isPending`만으로 낙관 상태를 계산한다.

```tsx
// ✅ 표시 지점이 카드 하나 — variables 방식, 캐시 조작·롤백 없음
function WishlistHeart({ productId, isWished }: { productId: string; isWished: boolean }) {
  const { mutate, variables, isPending } = useToggleWishlist();
  const optimistic = isPending && variables === productId ? !isWished : isWished;
  return <HeartIcon filled={optimistic} onClick={() => mutate(productId)} />;
}
```

**여러 지점이 함께 바뀌어야 할 때만 cache 방식을 쓴다** — 카드의 하트와 헤더의 찜 개수가 동시에 갱신돼야 하는 경우다. 이때는 3종 세트가 필요하다: `onMutate`에서 `cancelQueries`(진행 중 refetch가 낙관값을 덮지 않게) → 스냅샷 반환 → `onError`에서 롤백 → `onSettled`에서 항상 invalidate.

```ts
// ✅ features/toggle-wishlist/api/toggle-wishlist-mutation.ts — 여러 지점이 함께 바뀔 때만 cache 방식
export function useToggleWishlist() {
  return useMutation({
    mutationFn: toggleWishlistRequest,
    onMutate: async (productId: string, context) => {
      const { client } = context;
      await client.cancelQueries({ queryKey: wishlistKeys.all });
      const previous = client.getQueryData(wishlistKeys.all);
      client.setQueryData(wishlistKeys.all, (old) => toggleId(old, productId));
      return { previous };
    },
    // v5는 콜백의 마지막 인자 context로 QueryClient를 주입한다(onError는 4번째).
    // 3번째 인자는 onMutate 반환값 — context가 아니다. 클로저로 잡은 QueryClient 재호출도 불필요.
    onError: (_err, _productId, onMutateResult, context) => {
      context.client.setQueryData(wishlistKeys.all, onMutateResult?.previous);
    },
    onSettled: (_data, _err, _productId, _onMutateResult, context) => {
      context.client.invalidateQueries({ queryKey: wishlistKeys.all });
    },
  });
}
```

**배치.** 토글이 여러 페이지에서 쓰이면 `features/toggle-wishlist`의 `api` 세그먼트가 mutation과 invalidation을 소유한다 — 배치 매트릭스의 "서버 상태(Query cache)" 행대로 owner의 `api`/`model`이 캐시 조작을 갖는다. 개수 같은 파생값과 selector 구독 방식은 이 문서의 소관이 아니다 — [`./cases-state-ownership.md`](./cases-state-ownership.md)의 "파생값을 상태로 저장" 절과 "selector처럼 보이는 전체 구독" 절이 이미 다룬다.

## 케이스 5 — 권한별 UI 분기

**상황.** "이 사용자가 관리자 메뉴를 볼 수 있는가", "이 사용자가 이 주문을 취소할 수 있는가", "로그인되지 않은 사용자를 이 라우트에서 쫓아낸다"를 전부 하나의 Auth Feature에 몰아넣는다.

```ts
// ❌ features/auth/lib/permissions.ts — route guard·버튼 숨김·도메인 판정이 한 파일에
export function canAccess(user: User, route: string): boolean { /* route guard */ }
export function canSeeAdminMenu(user: User): boolean { /* 버튼 표시 분기 */ }
export function canCancelOrder(user: User, order: Order): boolean { /* 도메인 판정 — Order를 알 이유가 없는 slice가 Order를 안다 */ }
```

**다섯 질문 적용.** 2번(변경 이유가 무엇인가)이 이 셋을 가른다 — route guard는 라우팅 구조가 바뀔 때, 도메인 판정은 주문 정책이 바뀔 때, 세션 인프라는 토큰 갱신 방식이 바뀔 때 각각 따로 바뀐다. 배치 매트릭스의 "접근 제어(Access control)" 행이 이 분해를 이미 정의한다: domain authorization은 해당 flow/Entity의 rule, route guard는 App/Page, session infrastructure는 Shared/App.

```ts
// ✅ entities/order/model/can-cancel.ts — 도메인 판정은 Order를 아는 Entity가 소유
export function canCancelOrder(user: User, order: Order): boolean {
  return order.status === "pending" && order.ownerId === user.id;
}
```

```tsx
// ✅ pages/order-detail/ui/CancelButton.tsx — 표시 지점은 판정 함수를 받아 쓰기만 한다
import { canCancelOrder } from "@/entities/order";

function CancelButton({ order }: { order: Order }) {
  const user = useCurrentUser();
  if (!canCancelOrder(user, order)) return null;
  return <button onClick={handleCancel}>주문 취소</button>;
}
```

```tsx
// ✅ _app/guards/RequireAuth.tsx — route 전체 접근 여부는 App/Page의 책임
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" />;
  return children;
}
```

세션 상태(토큰 존재 여부)의 원본은 [`./cases-auth.md`](./cases-auth.md)의 토큰 저장 케이스가 이미 다룬 `entities/user` + `shared/api` 조합을 그대로 재사용한다 — 여기서 별도로 만들지 않는다. 버튼 렌더 분기는 언제나 판정 함수를 소유자에게서 가져와 표시 지점에서 호출하는 형태를 유지한다 — 판정 로직 자체를 표시 지점에 복제하지 않는다.

## 케이스 6 — analytics 이벤트 호출 위치

**상황.** 이벤트를 추적할 때마다 "한곳에서 관리하는 게 안전하다"는 이유로 App의 중앙 이벤트 카탈로그에서 전부 호출한다.

```ts
// ❌ _app/analytics/events.ts — SDK 초기화부터 이벤트 의미까지 한 파일에 몰림
export function trackAddToCart(productId: string) { amplitude.track("add_to_cart", { productId }); }
export function trackWishlistToggle(productId: string) { amplitude.track("wishlist_toggle", { productId }); }
export function trackCheckoutStart(orderId: string) { amplitude.track("checkout_start", { orderId }); }
// SDK를 바꾸는 이유와 이벤트 하나를 추가하는 이유가 같은 파일에서 부딪힌다
```

배치 매트릭스의 "Analytics" 행: global plumbing(SDK 초기화)은 App/Shared, "이 이벤트가 무엇을 의미하는가"는 그 행위가 일어나는 Page/Feature 근처가 소유한다.

```ts
// ✅ shared/lib/analytics/client.ts — SDK adapter, 도메인을 모른다
export const analytics = { track: (event: string, payload?: Record<string, unknown>) => amplitude.track(event, payload) };
```

```ts
// ✅ features/add-to-cart/lib/track.ts — "담기" 행위 옆에 그 행위의 이벤트 의미가 있다
import { analytics } from "@/shared/lib/analytics/client";

export function trackAddToCart(productId: string) {
  analytics.track("add_to_cart", { productId });
}
```

```tsx
// ✅ features/add-to-cart/ui/AddToCartButton.tsx
import { trackAddToCart } from "../lib/track";

function AddToCartButton({ productId }: { productId: string }) {
  const { mutate } = useAddToCart();
  return (
    <button onClick={() => { mutate(productId); trackAddToCart(productId); }}>담기</button>
  );
}
```

**단서.** 이 배치 매트릭스 자체가 "이벤트 의미는 Page/Feature 근처"라는 후자 판단을 설계 추론으로 단서를 단다 — 확정 규범이 아니다. 이벤트 카탈로그를 한 곳에서 타입 검사하고 싶다는 실제 요구가 생기면, 그 요구가 이 추론보다 우선한다.

## 근거

- [`./placement.md`](./placement.md)
- [`./layers.md`](./layers.md)
- [`./cases-auth.md`](./cases-auth.md)
- [`./cases-state-ownership.md`](./cases-state-ownership.md)
- [`../react/url-state.md`](../react/url-state.md)
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [TkDodo — Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys)

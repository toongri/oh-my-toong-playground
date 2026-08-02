# 상태 소유권 실전 케이스

같은 화면에 있어도 같은 종류의 상태가 아니다. 아래 케이스는 실제 과제 리뷰에서 반복적으로 나온 상태 소유권 실수와 그 판단 과정이다.

## 원본(Source of Truth) 이중화

**상황.** 검색어를 URL과 store 양쪽에 저장한다 — "URL은 공유용, store는 화면 안 동기화용"이라는 그럴듯한 이유가 붙는다.

```tsx
// ❌ 검색어의 원본이 URL과 store 둘로 갈라짐
function useSearch() {
  const [params, setParams] = useQueryStates({ q: parseAsString });
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  // 어느 쪽을 읽어야 진짜 검색어인가?
}
```

브라우저 뒤로 가기를 누르면 URL만 바뀐다 — store는 이전 값을 그대로 들고 있어 "가방"으로 뒤로 갔는데 화면은 여전히 "신발" 검색 결과를 보여준다.

**판단 과정.** 판정법은 단순하다 — **한 값을 바꿀 때 저장소 두 곳을 같이 고쳐야 하면 원본이 둘이다.** 검색어의 원본은 URL이어야 한다. 뒤로 가기·새로고침·공유 링크가 전부 URL을 신뢰하기 때문이다.

```tsx
// ✅ 원본은 URL 하나 — store는 만들지 않는다
function useSearch() {
  const [{ q }, setParams] = useQueryStates({ q: parseAsString });
  return { query: q ?? "", setQuery: (q: string) => setParams({ q }) };
}
```

같은 문제가 서버 데이터를 별도 client store에 복제하는 형태로도 나타난다 — TanStack Query 캐시가 이미 상품 목록의 원본을 들고 있는데, fetch 결과를 다시 zustand store에 넣으면 두 캐시가 서로 다른 시점에 갱신되며 어긋난다. 서버가 원본인 상태를 별도 분류(Server Cache State)로 떼어 두는 이유는 이 문서에서 다시 설명하지 않는다 — `../../.claude/rules/react.md`, [`./placement.md`](./placement.md)의 "상태 원본이 FSD 배치보다 먼저다" 절, [bulletproof-react의 상태 분류](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md)가 다룬다.

## query key 조건 누락

**상황.** 목록 쿼리에 정렬(`sort`)을 추가했는데, 요청 함수에는 넣고 query key에는 빠뜨린다.

```javascript
// ❌ queryFn은 sort를 쓰는데 queryKey에는 없다
useQuery({
  queryKey: ["products", q, page],
  queryFn: () => fetchProducts({ q, sort, page }),
});
```

정렬을 바꿔도 key가 그대로라 TanStack Query는 같은 조회로 취급한다 — 이전 정렬 결과가 캐시에서 그대로 나온다.

**판단 과정.** TanStack Query의 원칙은 명확하다 — 쿼리 함수가 어떤 변수에 의존하면 그 변수는 query key에 포함되어야 한다. key와 요청이 서로 다른 조건 집합을 참조하면 캐시가 조용히 깨진다.

```javascript
// ✅ 조건 객체 하나를 key와 요청이 함께 쓴다
const params = { q: q.trim(), sort, page };

queryOptions({
  queryKey: ["products", params],
  queryFn: () => fetchProducts(params),
});
```

**확인법.** 정렬만 다른 두 URL을 번갈아 열고 Network 탭과 캐시 key를 비교한다. 결과는 다른데 key가 같으면 조건이 빠진 것이다.

## queryOptions 콜로케이션

**상황.** 같은 상품 목록 쿼리를 목록 페이지의 `useQuery`, 서버 `prefetchQuery`, 상세 페이지 이동 시 `setQueryData` 세 곳에서 쓴다. 각자 key와 `queryFn`을 따로 작성하면 하나를 바꿀 때 나머지가 어긋난다.

```javascript
// ❌ 세 곳이 같은 쿼리를 각자 다시 정의
// pages/product-list/ui/ProductList.tsx
useQuery({ queryKey: ["products", params], queryFn: () => fetchProducts(params) });

// app/products/page.tsx (서버)
prefetchQuery({ queryKey: ["products", params], queryFn: () => fetchProducts(params, { server: true }) });
// staleTime을 한쪽에서만 바꾸면 클라이언트·서버가 다른 캐시 정책을 갖는다
```

**판단 과정.** key·`queryFn`·`staleTime`을 한 함수로 모으고, 소비하는 쪽은 그 함수만 호출한다. `queryOptions` 헬퍼가 이 콜로케이션을 위해 존재한다.

```javascript
// ✅ pages/product-list/model/product-list-query.ts — 단일 정의
export const productListQueryOptions = (params: ProductListParams) =>
  queryOptions({
    queryKey: ["products", params],
    queryFn: () => fetchProducts(params),
    staleTime: 30_000,
  });

// ✅ useQuery / useSuspenseQuery / prefetchQuery / setQueryData가 같은 옵션 재사용
useQuery(productListQueryOptions(params));
await queryClient.prefetchQuery(productListQueryOptions(params));
```

## mutation 후 invalidation

**상황.** 상품을 장바구니에 담는 mutation은 성공하는데, 목록 화면의 담긴 개수가 갱신되지 않는다.

```javascript
// ❌ onSuccess에서 invalidateQueries를 빠뜨림
useMutation({
  mutationFn: addToCart,
  onSuccess: () => {
    toast.success("담았습니다");
    // 캐시를 무효화하지 않아 목록의 "담김" 표시가 그대로 남는다
  },
});
```

**판단 과정.** mutation이 서버 상태를 바꾸면, 그 상태를 읽던 쿼리의 캐시를 무효화해야 화면이 새 값을 다시 가져온다. `invalidateQueries`는 기본이 prefix 매칭이다 — `['todos']`를 무효화하면 `['todos', { page: 1 }]`처럼 그 뒤에 조건이 붙은 key까지 전부 무효화된다. 정확히 그 key만 지우고 싶다면 `exact: true`를 쓴다.

```javascript
// ✅ 관련 쿼리를 명시적으로 무효화
useMutation({
  mutationFn: addToCart,
  onSuccess: () => {
    toast.success("담았습니다");
    queryClient.invalidateQueries({ queryKey: ["cart"] }); // prefix 매칭 — cart로 시작하는 모든 key
  },
});
```

## 폼 상태를 전역 store에 넣는 실수

**상황.** 검색 입력창의 값을 매 키 입력마다 전역 zustand store에 반영한다 — "결국 검색에 쓰이니 전역이어야 할 것 같다"는 직감 때문이다.

```tsx
// ❌ 입력 중인 글자마다 전역 상태가 바뀐다
function SearchInput() {
  const draft = useSearchStore((s) => s.draft);
  const setDraft = useSearchStore((s) => s.setDraft);
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
}
// 키 입력마다 전역 구독자 전체가 리렌더 후보가 된다 — 비용만 있고 얻는 것이 없다
```

**판단 과정.** 대부분의 폼 상태는 전역도 아니고 캐시도 아니다 — 그 컴포넌트의 생애주기 안에서만 의미가 있다. 도구가 Redux든 zustand든 Context든 상관없이 같은 원칙이 적용된다.

```tsx
// ✅ 입력 중인 값은 로컬 상태, 확정된 검색어만 URL로 커밋
function SearchInput() {
  const [draft, setDraft] = useState("");
  const { setQuery } = useSearch(); // 위 "원본 이중화" 절의 URL 원본
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && setQuery(draft)}
    />
  );
}
```

**예외.** 편집 중인 값을 다른 화면이 실시간으로 구독해야 하는 경우(WYSIWYG 에디터 미리보기 등)는 전역 상태가 맞다 — 그때는 "폼 상태"가 아니라 여러 소비자가 공유하는 클라이언트 상태로 봐야 한다.

## 파생값을 상태로 저장

**상황.** 찜한 상품 개수와, 특정 상품이 찜 목록에 포함됐는지를 각각 별도 상태로 관리한다.

```javascript
// ❌ ids와 count를 따로 관리 — toggle마다 둘 다 갱신해야 한다
const useWishlistStore = create((set) => ({
  ids: new Set(),
  count: 0,
  toggle: (id) =>
    set((s) => {
      const ids = new Set(s.ids);
      ids.has(id) ? ids.delete(id) : ids.add(id);
      return { ids, count: ids.size }; // count를 깜빡하면 조용히 어긋난다
    }),
}));
```

**판단 과정.** ID 집합만 원본으로 두고, 개수와 포함 여부는 거기서 계산한다. 파생값을 상태로 저장하면 갱신 지점마다 동기화 의무가 생기고, 하나라도 놓치면 원본과 파생값이 어긋난다.

```javascript
// ✅ ids만 원본 — count·isWishlisted는 selector로 파생
const useWishlistStore = create((set) => ({
  ids: new Set(),
  toggle: (id) =>
    set((s) => {
      const ids = new Set(s.ids);
      ids.has(id) ? ids.delete(id) : ids.add(id);
      return { ids };
    }),
}));

const isWishlisted = useWishlistStore((s) => s.ids.has(productId));
const count = useWishlistStore((s) => s.ids.size);
```

## selector처럼 보이는 전체 구독

**상황.** 값은 selector로 좁게 읽었는데, 바로 아래 줄에서 action을 꺼내려고 인자 없이 store를 호출한다.

```javascript
// ❌ 한 줄이 store 전체를 구독한다
function WishlistButton({ productId }) {
  // 좁은 구독처럼 보이지만
  const isWishlisted = useWishlistStore((s) => s.ids.has(productId));
  // 이 한 줄이 store 전체를 구독!
  const { toggle } = useWishlistStore();

  return <button onClick={() => toggle(productId)}>…</button>;
}
```

상품 A 하나를 찜하면 화면의 카드 30개가 전부 다시 렌더된다 — `isWishlisted`는 좁게 읽었지만 `useWishlistStore()`를 인자 없이 호출한 두 번째 줄이 store 전체 상태 변화를 구독 대상으로 만들기 때문이다.

**판단 과정.** action도 selector로 골라야 한다. action은 store 생성 시 고정된 함수라 selector로 가져와도 참조가 바뀌지 않는다 — 좁게 구독해서 잃을 것이 없다.

```javascript
// ✅ action도 selector로 — 내 상품이 바뀔 때만 리렌더
function WishlistButton({ productId }) {
  const isWishlisted = useWishlistStore((s) => s.ids.has(productId));
  const toggle = useWishlistStore((s) => s.toggle);

  return <button onClick={() => toggle(productId)}>…</button>;
}
```

**완료 판정.** "selector를 썼다"가 완료 조건이 아니다. React Profiler에서 카드 하나만 찜해 보고, 관계없는 카드가 다시 렌더되지 않는지를 확인해야 완료다.

## store의 슬라이스 위치 — 소비자가 늘어날 때

**상황.** `features/add-to-cart/model`에 장바구니 store를 두고 시작했다. 수량 변경 기능과 주문 요약 위젯이 생기면서, 그 기능들도 같은 장바구니 상태를 읽어야 한다.

```tsx
// ❌ features/update-quantity/ui/QuantityStepper.tsx
import { useCartStore } from "@/features/add-to-cart/model/store"; // 같은 레이어의 다른 slice 내부로 직접 진입
```

`features/update-quantity`가 `features/add-to-cart`의 내부 경로를 파고드는 순간, 두 Feature는 같은 레이어에서 서로를 알게 된다 — [`./layers.md`](./layers.md)의 의존 규칙이 금지하는 형태다.

**판단 과정.** [`./placement.md`](./placement.md)의 "store는 몇 개의 기능이 함께 쓰는가로 정한다" 표가 이 판단축을 이미 다룬다 — 한 Feature만 쓰면 그 Feature에 남기고, 여러 Feature가 공유하게 되면 도메인 개념으로 승격해 Entity로 옮긴다. 장바구니는 담기·수량변경·주문 요약이 모두 공유하는 시점에 그 조건을 만족했다.

```typescript
// ✅ entities/cart/model/store.ts — 여러 Feature가 공유하는 도메인 상태로 승격
export const useCartStore = create<CartState>((set) => ({ /* ... */ }));
```

```tsx
// ✅ 각 Feature는 하위 레이어인 entity를 import — 같은 레이어 import가 사라진다
import { useCartStore } from "@/entities/cart";
```

## 상태 분류 자체는 여기서 다시 설명하지 않는다

서버 상태·URL 상태·전역 클라이언트 상태·로컬 상태 네 종류를 나누는 기준 자체는 `../../.claude/rules/react.md`와 [`./placement.md`](./placement.md)의 "상태 원본이 FSD 배치보다 먼저다" 절에 있다. 위 케이스들은 모두 그 분류가 이미 끝났다는 전제 위에서, 정해진 원본을 실제 코드에서 어떻게 지키고 어디에 놓을지를 다룬다.

## 근거

- [TanStack Query — Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [TanStack Query — Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)
- [TanStack Query — Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Redux Style Guide — Avoid Putting Form State In Redux](https://redux.js.org/style-guide/#avoid-putting-form-state-in-redux)
- [Redux Style Guide — Keep State Minimal And Derive Additional Values](https://redux.js.org/style-guide/#keep-state-minimal-and-derive-additional-values)
- [bulletproof-react — State Management](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md)

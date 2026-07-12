# Hook · Effect · 레이어 설계

500줄 컴포넌트를 열었을 때 "어디부터 읽지"가 아니라 **"UI는 여기, 로직은 여기, 데이터는 여기"**로 바로 짚이는 구조를 만든다.

## 목차

1. 레이어 — UI / Hook / API / Utils
2. 상태 3분할 — 서버 / 클라이언트 / 파생값
3. Custom Hook 추출 — 횟수가 아니라 목적
4. 명명 — use 접두사와 역할
5. Hook 책임 — 한 문장으로 설명되는가
6. Hook state는 공유되지 않는다
7. useEffect를 줄이는 설계
8. 직접 fetch할 때 — race와 의존성
9. DIP — 구현체에 직접 묶이지 않기
10. 비순수 입력은 렌더 밖에서 캡처한다

---

## 1. 레이어 — UI / Hook / API / Utils

코드를 "어떻게 보이는가 / 어떻게 동작하는가 / 어디서 데이터를 가져오는가"로 나눈다. 각 레이어는 **독립적으로 이해 가능**해야 한다 — UI만 봐도 화면이 그려지고, Hook만 봐도 기능 흐름이 읽히고, API 경계만 봐도 서버 통신이 파악된다.

| 레이어            | 관점              | 담당                                           |
| ----------------- | ----------------- | ---------------------------------------------- |
| **UI (컴포넌트)** | 어떻게 보이는가   | JSX 렌더·이벤트 바인딩·스타일·작은 파생값      |
| **Hook**          | 어떻게 동작하는가 | 상태 관리·필터/정렬/검색·서버 상태 조합·유효성 |
| **API 경계**      | 어디서 오는가     | 호출 함수·요청/응답 변환·에러 변환             |
| **Utils**         | 순수 계산         | 상태·side effect 없는 입력→출력                |

> ⚠️ "컴포넌트는 UI만"을 너무 엄격히 읽으면 오버 추상화가 된다. 작은 이벤트 핸들러·작은 파생값(`const isSelected = selectedId === id`)은 컴포넌트 안에 있어도 된다. 밖으로 빼는 기준은 "로직이 있는가"가 아니라 **"별도의 변경 이유를 갖는가"**다.

## 2. 상태 3분할 — 서버 / 클라이언트 / 파생값

"Custom Hook이 뭐고 상태관리가 뭐냐"는 혼란은 대개 세 종류의 상태를 안 나눠서 생긴다.

| 분류                | 도구                                                   | 예시                             |
| ------------------- | ------------------------------------------------------ | -------------------------------- |
| **서버 상태**       | 서버 상태 도구, 또는 `useEffect`+Custom Hook 직접 구성 | 주문 내역·게시글·리뷰            |
| **클라이언트 상태** | `useState`·`useReducer`·전역 스토어                    | 모달 열림·선택 탭·입력값         |
| **파생값**          | 일반 함수·렌더 중 계산                                 | 필터된 목록·정렬·pagination 계산 |

서버 상태는 클라이언트 상태와 성격이 다르다 — 원격에 저장되고, 비동기로 오고, 다른 사용자/서버가 바꾸고, 캐싱·재요청·stale 관리가 필요하다. 그래서 `useEffect`+`useState`로 직접 들고 있기보다 별도 취급한다.

## 3. Custom Hook 추출 — 횟수가 아니라 목적

**언제 뽑는가** — JSX와 무관한 로직이 컴포넌트를 크게 차지하거나, 테스트하려는 로직이 컴포넌트에 묶였거나, "하나의 흐름"(검색·페이지네이션·validation)으로 설명되는 동작일 때.

**임계값은 "횟수"가 아니라 "목적"이다.** "2곳에서 반복되면 무조건 추출"은 함정이다 — 목적이 같은지 먼저 본다. 애매하면 중복을 유지한다. _잘못된 추상화가 중복보다 비싸다_(Sandi Metz).

```tsx
// ❌ 오버 추상화 — useState 하나를 감싼 의미 없는 Hook
function useLoading() {
  const [isLoading, setIsLoading] = useState(false);
  return { isLoading, setIsLoading };
}

// ✅ 관련 상태 + 로직 + 파생값이 응집
function useOrderStatusFilter() {
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const resetFilter = () => setStatus("all");
  const isFiltered = status !== "all";
  return { status, setStatus, resetFilter, isFiltered };
}
```

## 4. 명명 — use 접두사와 역할

Hook을 실제로 호출하지 않는 순수 함수엔 `use`를 붙이지 않는다.

```tsx
// ❌ Hook을 안 쓰는데 use 접두 — 훅 규칙 오해를 부른다
function useFormatOrderStatus(status: OrderStatus) {
  return status === "paid" ? "결제완료" : status; // 순수 계산뿐
}

// ✅ 일반 함수로 충분
function formatOrderStatus(status: OrderStatus) {
  return status === "paid" ? "결제완료" : status;
}
```

이름은 도메인을 드러낸다(`useOrderStatusFilter`) — `useData`·`useFetch`처럼 메커니즘만 보이면 추상화가 얕다. (React 19의 `use(...)`는 Promise/Context를 읽는 빌트인이고, 우리가 만드는 건 그 위의 `useXxx`다.)

## 5. Hook 책임 — 한 문장으로 설명되는가

좋은 Hook은 **한 문장으로 설명된다**. 안 되면 쪼갠다.

| Hook                   | 좋은 설명                       | 위험 신호                |
| ---------------------- | ------------------------------- | ------------------------ |
| `useOrderStatusFilter` | 주문 상태 필터와 변경 규칙 관리 | API 호출·라우팅까지 처리 |
| `useOrders`            | 주문 목록 서버 상태 조회        | 필터 UI 상태까지 관리    |
| `usePagination`        | 현재 페이지와 변경 규칙 관리    | 주문 API 응답 구조를 앎  |

> Hook이 너무 커지면 "컴포넌트 500줄"이 "Hook 500줄"로 **이사**한 것뿐이다. 역할별 Hook으로 나누고 페이지에서 조합한다.

```tsx
// ✅ 페이지는 여러 Hook을 조합만
function OrderHistoryPage() {
  const statusFilter = useOrderStatusFilter();
  const pagination = usePagination();
  const ordersQuery = useOrders({ status: statusFilter.status, page: pagination.page });
  return (
    <OrderHistoryView
      statusFilter={statusFilter}
      pagination={pagination}
      ordersQuery={ordersQuery}
    />
  );
}
```

## 6. Hook state는 공유되지 않는다

같은 Custom Hook을 여러 곳에서 호출하면 **각자 독립된 state 인스턴스**를 갖는다. Custom Hook은 *로직 재사용*이지 *상태 공유*가 아니다.

```tsx
function OrderHistoryPage() {
  const { status, setStatus } = useOrderStatusFilter(); // 인스턴스 A
  return <OrderFilterModal />;
}

function OrderFilterModal() {
  const { status } = useOrderStatusFilter(); // 인스턴스 B — A와 동기화 안 됨
}
```

공유가 목적이면 → 한 곳에서 호출해 props로 내리거나, 외부 store(Context/전역/서버 상태 도구)에 둔다.

## 7. useEffect를 줄이는 설계

`useEffect`는 "상태가 바뀌면 뭔가 실행"이 아니라 **React 바깥 외부 시스템과 동기화하는 도구**다.

| ✅ 필요                                                | ❌ 불필요                                                 |
| ------------------------------------------------------ | --------------------------------------------------------- |
| 서버 요청·구독·WebSocket·타이머·외부 라이브러리 동기화 | props/state로 계산 가능한 값·필터/정렬 결과·포맷팅·파생값 |

```tsx
// ❌ 파생값을 state+Effect로 — 동기화 부담
const [filtered, setFiltered] = useState<Order[]>([]);
useEffect(() => {
  setFiltered(orders.filter((o) => o.status === status));
}, [orders, status]);

// ✅ 렌더 중 계산 — state·Effect 없음, 자동 일관성
const filtered = orders.filter((o) => o.status === status);
```

`useMemo`가 **정당한 용도는 둘뿐**이다.

1. **측정으로 확인된 무거운 계산 캐시** — "느릴 것 같다"가 아니라 실제로 측정했을 때만 감싼다. `useEffect`+state로 되돌리지 않는다. (react.dev "You Might Not Need an Effect")
2. **하위 `useEffect`/`memo`가 의존하는 객체 참조 안정화** — deps가 전부 원시값이어도 매 렌더 새 객체를 만들면 참조가 매번 바뀐다. 그 객체를 dep으로 받는 하위 `useEffect`는 매 렌더 재실행되고, `memo`는 무력화된다. `ProductListPage.tsx:44-57`의 `params`가 그 예다:

```tsx
// deps가 전부 원시값이라 참조가 안정적이다
const params = useMemo<ProductListParams>(
  () => ({ category, sortBy, searchQuery: debouncedSearch, page, ... }),
  [category, debouncedSearch, sortBy, page, ...],
);
```

이렇게 안정시킨 `params` 참조 위에서 `useProductList`(`useProductList.ts:50`)는 `[params, reloadKey]`를 그대로 deps로 쓴다 — 매 렌더 새 요청이 나가지 않는 건 이 `params`가 실제로 바뀔 때만 참조가 바뀌기 때문이다.

두 번째 사례는 `useProductFilters`(`useProductFilters.ts:110-111`)의 `snapshot`이다. `query`와 `origin`을 객체 리터럴로 그대로 `useDebouncedValue`에 넘기면, 그 내부 `useEffect`(deps `[value, delayMs]`)가 매 렌더 새 참조를 받아 debounce 타이머가 계속 리셋된다 — `useMemo`로 참조를 고정해야 debounce가 실제로 동작한다.

```tsx
const snapshot = useMemo(() => ({ query, origin }), [query, origin]);
const debounced = useDebouncedValue(snapshot, URL_WRITE_DEBOUNCE_MS);
```

이 사례는 아래 Caveat와도 정합한다: 여기서 정확성(query·origin desync 제거)은 `useMemo`의 캐시가 아니라 **query와 origin을 한 객체에 담은 구조**에서 나온다. React가 이 캐시를 버리고 매번 새 객체를 만들어도 desync는 재발하지 않고, 최악의 경우 debounce가 조금 더 지연될 뿐이다(URL 동기화 맥락은 [`url-state.md`](./url-state.md) §3 참고).

> **Caveat**: `useMemo`는 성능 최적화 도구이지 정확성 보장 도구가 아니다. React는 이 캐시를 언제든 버리고 재계산할 수 있으므로, **"값이 반드시 고정되어야 한다"는 정확성을 `useMemo`에 의존하면 안 된다.** 값을 반드시 고정해야 한다면 `useRef`나 명시적 상태로 관리한다(비순수 계산을 `useMemo`로 감싸면 안 되는 이유는 아래 10절 참고).

## 8. 직접 fetch할 때 — race와 의존성

서버 상태 도구 없이 `useEffect`로 직접 요청하면, 도구가 대신하던 걸 손으로 챙긴다.

```tsx
useEffect(() => {
  let ignore = false;

  (async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderApi.getOrders({ status, page });
      if (!ignore) setOrders(res.orders);
    } catch (e) {
      if (!ignore) setError(e as Error);
    } finally {
      if (!ignore) setLoading(false);
    }
  })();

  return () => {
    ignore = true; // 이전 요청 결과 무시
  };
}, [status, page]); // ← 객체 아닌 원시 필드
```

- **race condition — `ignore` vs `AbortController` 선택 기준**:
  - `ignore` 플래그는 **항상 필요한 기준선**이다 — 요청은 이미 네트워크로 나갔으니 되돌릴 수 없고, `ignore`는 그 응답이 돌아왔을 때 이미 stale해진 결과를 `setState`에 반영하지 않도록 막을 뿐이다.
  - `AbortController`는 `ignore` 위에 얹는 선택이다. **요청 자체를 실제로 취소해야 할 때**(응답이 느려 서버·네트워크 자원을 계속 낭비하거나, 서버가 취소 신호를 실제로 활용할 때)만 추가한다 — `ignore`의 대체가 아니다.
  - 이 레포의 `useProductList`(`useProductList.ts:23,48`)는 `ignore`만 쓴다. 목록 조회는 짧고 저비용이라 진행 중인 요청을 서버에서 실제로 끊어야 할 이유가 없고, stale 응답을 걸러내는 데는 `ignore`만으로 충분하기 때문이다.
- **의존성은 원시 필드로**: `[params]`처럼 객체를 그대로 두면 매 렌더 새 참조 → 무한 요청. `[params.status, params.page]`로 푼다.
- **반환 형태 일관**: `data`/`isPending`/`error`를 Hook 안에서 묶어 노출하면 나중에 도구 도입 시 호출부 수정이 준다.

## 9. DIP — 구현체에 직접 묶이지 않기

Hook이 구현체(`axios`)에 직접 묶이면 서버가 바뀌거나 테스트할 때 다 무너진다. **API 함수 경계**에 의존한다.

```tsx
// ❌ Hook이 axios에 직접 의존 — 교체 시 모든 Hook 수정
function useOrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    axios.get("/api/v1/orders").then((r) => setOrders(r.data.orders));
  }, []);
  return orders;
}

// ✅ API 함수에 의존 — 수정 지점이 orderApi로 좁혀짐
function useOrders(params: OrderListParams) {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    let ignore = false;
    orderApi.getOrders(params).then((r) => {
      if (!ignore) setOrders(r.orders);
    });
    return () => {
      ignore = true;
    };
  }, [params.status, params.page]);
  return orders;
}
```

도메인 규칙(취소 가능 여부·상태 라벨)은 UI 사이에 숨기지 말고 순수 함수로 뽑는다 — 별도의 변경 이유를 갖기 때문이다.

## 10. 비순수 입력은 렌더 밖에서 캡처한다

렌더링 함수는 **순수해야 한다** — 같은 props/state면 같은 결과를 내야 한다. `new Date()`, `Math.random()`처럼 호출마다 다른 값을 내는 코드를 렌더 중에 직접 부르면 이 규칙을 깬다(react.dev "Rules of React" 금지 항목).

```tsx
// ❌ 렌더 중 비순수 호출 — 리렌더마다 값이 바뀌고, StrictMode 이중 렌더에서 두 번 다른 값이 나올 수 있다
function ProductCard({ product }: { product: Product }) {
  const badges = computeBadges(product, new Date());
  // ...
}

// ✅ 마운트 시 한 번만 캡처 — lazy initializer
function ProductListPage() {
  const [now] = useState(() => new Date());
  // ...
  return <ProductCard product={product} now={now} />;
}
```

캡처한 값은 순수 함수나 자식 컴포넌트에 **인자로 주입**한다. 이 레포의 `computeBadges(product, now)`(`productBadges.ts:19`)가 그 형태다 — 함수 내부에서 현재 시각을 읽지 않고 호출부가 넘긴 `now`로만 계산해 결정론적이다.

`useMemo(() => new Date(), [deps])`는 **틀린 해법**이다. `useMemo`는 §7의 caveat대로 성능 힌트일 뿐 정확성 보장 도구가 아니라서, React가 캐시를 버리고 재계산하면 다른 시각이 나올 수 있다. 렌더 밖 값을 고정하려면 `useState`의 lazy initializer(또는 `useRef`)를 쓴다.

**StrictMode 이중 호출**: 개발 모드에서 컴포넌트 함수와 초기화 함수가 두 번 불려도, React는 `useState`의 **첫 결과만 유지**하고 두 번째 호출 결과는 버린다 — 그래서 `now`는 마운트당 하나의 값으로 안정적이다.

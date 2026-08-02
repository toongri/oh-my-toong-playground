# 에러는 어느 계층에서 처리하는가

가능하면 에러가 난 곳 가까이에서 처리한다. 상위 Boundary로 넘길수록 사용자가 그 자리에서 할 수 있는 일이 줄어든다 — 페이지 전체가 에러 화면으로 바뀌면 사용자는 "다시 시도"밖에 할 수 없지만, 컴포넌트가 직접 처리하면 "품절"처럼 그 자리에서 바로 이해할 수 있는 안내를 줄 수 있다.

## 처리 계층

| 계층 | 담당 | 사용자가 할 수 있는 일 |
| --- | --- | --- |
| 컴포넌트/섹션 | 그 화면에 맞는 안내 | 맥락에 맞는 다음 행동(다른 상품 보기 등) |
| 페이지 Boundary | 라우트 실패 + 재시도 | 재시도, 다른 페이지로 이동 |
| 전역 Boundary | 전체 화면 대체 | 새로고침 정도 |
| HTTP 공통 계층(interceptor) | 401 재인증, 네트워크 단절 | 화면과 무관하게 공통 처리(로그인 리다이렉트 등) |

## 실패 종류별 처리 위치

| 실패 종류 | 처리 위치 | 이유 |
| --- | --- | --- |
| 5xx · 예상 밖 렌더링 오류 | 전역/페이지 Boundary | 사용자가 취할 수 있는 조치가 재시도뿐이라 화면별로 나눌 이유가 적다 |
| 401 인증 만료 | HTTP 공통 계층 | 화면과 무관한 공통 정책 — 화면마다 처리하면 중복된다 |
| 403 권한 없음 | 페이지 Boundary | 페이지마다 안내 문구와 다음 행동이 다르다 |
| 비즈니스 오류(재고 부족) | 컴포넌트 | 화면마다 UX가 다르다 — 상품 상세는 "품절", 주문은 "재고 부족" |
| 폼 검증 | 해당 폼 | 필드 단위 피드백이 필요하다 — 상위로 올리면 어떤 필드가 틀렸는지 알 수 없다 |

## Error Boundary 계층 배치

전역 Boundary 안에 페이지 Boundary를 중첩한다. 폴백 컴포넌트는 재시도를 위한 `reset`을 받는다.

```tsx
function App() {
  return (
    <ErrorBoundary fallback={GlobalErrorFallback}>
      <Header />
      <ErrorBoundary fallback={PageErrorFallback}>
        <Outlet />
      </ErrorBoundary>
      <Footer />
    </ErrorBoundary>
  );
}

function PageErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>페이지를 불러오는데 실패했습니다</h2>
      <p>{error.message}</p>
      <button onClick={reset}>다시 시도</button>
    </div>
  );
}
```

## TanStack Query v5 — throwOnError로 넘길 에러를 고른다

`throwOnError`는 v4의 `useErrorBoundary`가 이름을 바꾼 옵션이다. boolean뿐 아니라 함수도 받는다 — 5xx만 Boundary로 던지고 4xx·빈 결과는 컴포넌트가 그 자리에서 처리하게 할 수 있다.

```tsx
const { data, error } = useQuery({
  ...productListQueryOptions(condition),
  // 5xx → 가장 가까운 Error Boundary로
  // 4xx · 빈 결과 → 컴포넌트가 그 자리에서 안내
  throwOnError: (error) => getStatus(error) >= 500,
});
```

`useSuspenseQuery`는 에러를 항상 throw한다. 그래서 Boundary와 Suspense는 같은 위치에 쌍으로 배치한다 — 둘 중 하나만 두면 남은 상태(로딩 또는 에러)를 처리할 곳이 없다.

## Suspense는 Boundary의 짝 — 독립 섹션마다 쌍으로 배치

독립된 섹션마다 Boundary와 Suspense를 함께 두면 한 섹션의 실패가 다른 섹션을 죽이지 않는다.

```tsx
function ProductDetailPage({ params }: { params: { id: string } }) {
  return (
    <ErrorBoundary fallback={<PageErrorFallback />}>
      <ErrorBoundary fallback={<ProductInfoErrorFallback />}>
        <Suspense fallback={<ProductSkeleton />}>
          <ProductInfo id={params.id} />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary fallback={<ReviewsErrorFallback />}>
        <Suspense fallback={<ReviewsSkeleton />}>
          <ProductReviews id={params.id} />
        </Suspense>
      </ErrorBoundary>
    </ErrorBoundary>
  );
}
```

상품 정보가 실패해도 리뷰 영역은 살아 있다(또는 그 반대). 페이지 전체가 하얘지는 대신 부분적으로 동작하는 화면을 보여줄 수 있다.

주의 — Boundary의 fallback은 자식 트리 전체를 대체하므로, 한 섹션을 다른 섹션의 Boundary 안에 중첩하면 바깥 섹션의 실패가 안쪽 섹션까지 죽인다. 독립 생존이 목적이면 섹션 Boundary는 형제로 배치한다.

## Boundary가 못 잡는 에러 — 이벤트 핸들러 · 비동기 콜백

Error Boundary는 렌더링 중 발생한 에러만 잡는다. 클릭 핸들러나 mutation 콜백에서 던진 에러는 위로 전파되지 않는다. "담기" 요청의 실패는 mutation의 `onError`에서 그 화면에 맞게 처리한다.

```tsx
const { mutate: addToCart } = useMutation({
  mutationFn: cartApi.add,
  onError: () => {
    // Boundary가 아니라 여기서, 그 화면에 맞는 토스트/인라인 메시지
    toast.error("담기에 실패했습니다");
  },
});
```

## Next.js — 파일 컨벤션이 전역·페이지 Boundary를 대신 제공한다

`error.tsx` / `global-error.tsx` / `loading.tsx`가 전역·페이지 레벨의 Boundary와 Suspense를 자동으로 만들어준다. 우리가 직접 정할 것은 그 안쪽, 섹션 Boundary의 위치다.

- `app/error.tsx` — 그 세그먼트의 Error Boundary(client component)
- `app/global-error.tsx` — root layout 에러 대체
- `app/loading.tsx` — 그 세그먼트의 Suspense fallback
- 같은 세그먼트 `layout.tsx`의 에러는 그 세그먼트의 `error.tsx`가 잡지 못하고 상위로 올라간다.

Next App Router의 파일 라우팅 자체는 [`../nextjs/app-router.md`](../nextjs/app-router.md), FSD 레이어와 라우팅의 관계(route 파일 진입점·`_pages` 매핑)는 [`./layers.md`](./layers.md)를 참고한다.

## 근거

- [React — Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [TanStack Query — throwOnError](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [Next.js — error.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/error)

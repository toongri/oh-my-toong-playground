# Next.js App Router와 FSD — 두 개의 축

FSD 레이어와 Next.js 런타임(라우팅·RSC)은 서로 다른 축이다. Next는 어떤 파일이 어떤 URL에 매핑되는지, 서버에서 도는지 클라이언트에서 도는지를 정할 뿐 그 코드가 FSD의 어느 레이어에 속하는지는 결정하지 않는다. `page.tsx`라는 이유로 그 코드가 FSD의 Pages 레이어라고 단정하지 않는다.

## 이름 충돌 — app/, pages/는 프레임워크가 예약한 이름

Next의 `app/`과 `pages/`는 라우팅용으로 예약된 디렉터리다. FSD가 관례로 쓰는 App 레이어, Pages 레이어와 이름이 겹치면 Next가 그 폴더 전체를 라우트로 해석해버린다.

- FSD App 레이어 → `src/_app`
- FSD Pages 레이어 → `src/_pages` (또는 `views`)
- `src/pages`는 특히 피한다 — Next가 legacy Pages Router로 인식할 수 있다.

```text
src/
├─ _app/            # FSD App 레이어 — providers, router 조립, global.css
├─ _pages/           # FSD Pages 레이어 — 화면 단위 UI/로직
│  └─ product-detail/
├─ widgets/
├─ features/
├─ entities/
└─ shared/

app/                 # Next App Router — 라우팅 전용
├─ layout.tsx
├─ page.tsx
└─ products/
   └─ [id]/
      └─ page.tsx
```

## route 파일은 얇은 진입점(thin adapter)이다

route 파일(`page.tsx`, `layout.tsx`, `route.ts` 등)은 로직을 갖지 않는다. `_pages` 슬라이스의 public API를 import해서 그대로 내보내는 역할만 한다.

```tsx
// ❌ app/products/[id]/page.tsx — route 파일에 fetch·마크업이 직접 들어감
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await fetchProduct(id);
  return <div>{product.name}</div>;
}
```

```tsx
// ✅ src/_pages/product-detail/index.ts — public API
export { ProductDetailPage } from "./ui/ProductDetailPage";

// ✅ app/products/[id]/page.tsx — 얇은 adapter, re-export뿐
export { ProductDetailPage as default } from "@/_pages/product-detail";
```

실제 화면 UI, 데이터 로딩, 상태는 `_pages/product-detail` 안에 있다. route 파일을 열었을 때 로직이 보인다면 그 로직은 `_pages`로 옮길 대상이다.

## Server/Client 경계는 FSD 레이어를 자동으로 정하지 않는다

`'use client'`는 Next 런타임의 실행 경계 표시일 뿐, "이 코드가 Features인지 Entities인지"를 말해주지 않는다. 같은 슬라이스 안에 서버 전용 코드와 클라이언트 컴포넌트가 함께 있을 수 있다. `'use client'` 경계와 하위 전파의 상세는 [`../nextjs/app-router.md`](../nextjs/app-router.md)에 있다.

문제가 생기는 경우는 하나뿐이다 — 서버 전용 export(DB 접근, 비밀키를 쓰는 함수 등)가 슬라이스의 public API(`index.ts`)를 거쳐 클라이언트 번들에 섞여 들어갈 때. 이때만 `index.server.ts`를 추가해 분리한다.

```ts
// src/entities/order/index.ts — client-safe public API
export { OrderSummary } from "./ui/OrderSummary";
export type { Order } from "./model/types";

// src/entities/order/index.server.ts — server-only public API
export { getOrderFromDb } from "./api/db";
```

미리 모든 슬라이스에 `index.server.ts`를 만들어 두지 않는다. server-only export가 실제로 client graph를 오염시키는 문제가 발생했을 때만 추가한다.

Next의 파일 컨벤션(`loading.tsx`, `error.tsx`)은 그 라우트 세그먼트 경계에 자동으로 Suspense와 Error Boundary를 만든다. 이 컨벤션을 어느 화면 단위에 걸지는 에러 처리 계층의 문제이지 FSD 레이어 배치의 문제가 아니다 — 섹션 단위 Boundary를 어디에 둘지와 TanStack Query 연동은 [`./error-layers.md`](./error-layers.md), App Router의 파일 라우팅·hydrate 같은 기초는 [`../nextjs/app-router.md`](../nextjs/app-router.md)에서 다룬다.

## 근거

- [FSD — Next.js guide](https://feature-sliced.design/docs/guides/tech/with-nextjs)
- [Next.js — App Router](https://nextjs.org/docs/app)

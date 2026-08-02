# 레이어별 책임

이 프로젝트는 FSD(Feature-Sliced Design) 기반이다. 코드는 App · Pages · Widgets · Features · Entities · Shared 여섯 레이어로 나뉘고, 의존은 항상 상위 레이어에서 하위 레이어로만 흐른다.

핵심은 셋이다.

1. 관련 UI·상태·API를 한 책임 단위(slice)에 모은다.
2. 외부 소비자는 그 단위의 public API만 사용한다.
3. 의존성은 상위 레이어에서 하위 레이어로만 흐른다.

레이어를 가르는 기준은 크기나 파일 종류가 아니라 "무엇이 바뀔 때 이 코드도 함께 바뀌는가"라는 책임 질문이다. 여섯 레이어는 각자 다른 책임 질문에 답한다 — App은 조립, Pages는 화면, Widgets는 재사용 대형 블록, Features는 사용자 행위, Entities는 도메인 개념, Shared는 도메인 무관 기반.

## 의존 규칙

```text
App → Pages → Widgets → Features → Entities → Shared
(상위)                                        (하위)
```

- slice는 **엄격히 더 아래 레이어**의 다른 slice만 import한다.
- 같은 레이어의 다른 slice는 직접 import하지 않는다.
- 같은 slice 내부 import는 자유롭다.
- **App과 Shared는 예외다** — 도메인 slice가 없는 "레이어이면서 하나의 slice"라, 내부 segment 간 import가 가능하다.

```tsx
// features/add-to-cart/ui/AddToCartButton.tsx
import { ProductPrice } from "@/entities/product";   // ✅ 하위 레이어
import { Button } from "@/shared/ui";                 // ✅ 하위 레이어
import { WishlistToggle } from "@/features/toggle-wishlist"; // ❌ 같은 레이어 — 금지
```

**Processes는 쓰지 않는다.** 여러 Page에 걸친 흐름을 담는 별도 레이어를 새로 만들지 않는다. 그런 책임은 다음으로 옮긴다.

- router/server-level orchestration → App
- 재사용 user interaction → Feature
- 특정 Page들의 로컬 flow → Page 또는 상위 composition

## Slice와 Segment

**Slice**는 제품 의미로 묶는 단위다 — `checkout`, `user`처럼 도메인 언어로 이름 붙는다. 같은 레이어의 slice끼리는 zero coupling, slice 내부는 high cohesion을 지향한다.

**Segment**는 slice 내부를 기술 목적별로 나눈다: `ui`(표시·interaction) · `model`(상태·schema·규칙) · `api`(backend 상호작용) · `lib`(slice 안의 보조 로직) · `config`(slice 설정). `components`·`hooks`·`types`·`utils`처럼 파일 형식만 말하는 이름은 지양한다 — hook과 type은 그 자체로 책임이 아니라 "어느 변경과 함께 움직이는가"가 책임이기 때문이다.

애매한 책임을 슬라이스/세그먼트 어디에 둘지는 [`./placement.md`](./placement.md), slice가 외부에 무엇을 공개할지는 [`./public-api.md`](./public-api.md)에서 다룬다.

## pages-first 규칙

새 화면의 UI·폼·데이터 로딩·로컬 상태는 Page slice에서 시작한다. **두 번째 실제 소비자**, 독립된 의미, 안정된 public contract가 생겼을 때만 아래 레이어로 추출한다. Pages·Shared·App만으로 충분하면 거기서 멈춘다.

```text
features/select-color/
├── ui/ColorPicker.tsx   ← 실질 코드 1개
├── model/useColor.ts
└── index.ts
```

실 소비자가 하나뿐인데 레이어부터 만드는 것은 아래 "흔히 빠지는 함정"의 overslicing이다.

## App

**책임 — 애플리케이션 전체를 시작하고 조립한다.**

적합한 것

- router와 route table 조립
- root provider
- global store/query client 생성
- 전역 CSS/theme 초기화
- 앱 시작(bootstrap)
- analytics SDK 초기화와 global plumbing
- error boundary·observability 초기화
- 앱 전체 feature flag SDK/provider

부적합한 것

- 특정 화면에서만 쓰는 폼 상태
- 특정 Feature의 validation
- Entity의 도메인 규칙
- 재사용 UI kit 구현

판단 기준은 "전역으로 사용된다"가 아니라 "앱 전체를 **조립·초기화**한다"다. Provider가 App에 있다고 해서 그 provider가 제공하는 business logic까지 App에 둘 필요는 없다 — provider 껍데기는 App, 안의 상태·규칙은 소유 slice에 남긴다.

**Next.js 매핑.** Next의 `app/`은 라우팅용으로 예약된 디렉터리다 — 이 이름을 그대로 쓰면 Next가 폴더 전체를 라우트로 해석한다. FSD App 레이어는 `src/_app`에 둔다 — providers, router 조립, global CSS가 여기 있다. 같은 이유로 FSD Pages 레이어는 `src/_pages`(또는 `views`)에 둔다.

```text
src/
├─ _app/            # FSD App 레이어 — providers, router 조립, global.css
├─ _pages/          # FSD Pages 레이어 — 화면 단위 UI/로직
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

## Pages

**책임 — 사용자가 방문하거나 수행하는 화면/activity 단위.**

**가장 중요한 기본 소유자**다. 새 화면 코드는 일단 여기서 시작한다.

적합한 것

- 화면 전용 UI와 layout
- 화면 전용 form, validation, submit flow
- page query, pagination/filter state
- loading/error/empty boundary
- 해당 화면에서만 쓰는 endpoint adapter
- route parameter 해석
- 여러 하위 블록의 composition

**Page가 얇아야 한다는 규칙은 없다.** 한 화면에서만 쓰인다면 "business logic이 있다"는 이유만으로 Feature나 Entity로 내리지 않는다. Page가 커 보인다는 느낌만으로도 추출 근거는 부족하다 — 독립 변경, 재사용, 명확한 계약이 실제로 생겼는지를 본다. 판단 절차는 [`./placement.md`](./placement.md)의 다섯 질문을 쓴다.

**Next.js 매핑.** FSD Pages 레이어는 `src/_pages`에 둔다. `src/pages`는 특히 피한다 — Next가 legacy Pages Router로 인식할 수 있다. route 파일(`page.tsx`, `layout.tsx`, `route.ts` 등)은 로직을 갖지 않는다 — `_pages` 슬라이스의 public API를 import해서 그대로 내보내는 얇은 진입점(thin adapter)이다.

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

실제 화면 UI, 데이터 로딩, 상태는 `_pages/product-detail` 안에 있다. **route 파일을 열었을 때 로직이 보이면 그 로직은 `_pages`로 옮길 대상이다.**

**Server/Client 경계는 FSD 레이어를 정하지 않는다.** `'use client'`는 Next 런타임의 실행 경계 표시일 뿐이다. 같은 슬라이스에 서버 전용 코드와 클라이언트 컴포넌트가 공존할 수 있다. `'use client'` 전파의 상세는 [`../nextjs/app-router.md`](../nextjs/app-router.md), server-only export가 client 번들을 오염시킬 때의 `index.server.ts` 분리는 [`./public-api.md`](./public-api.md)에 있다. `loading.tsx`·`error.tsx` 경계를 어느 화면 단위에 걸지는 [`./error-layers.md`](./error-layers.md)에서 다룬다.

## Widgets

**책임 — 크고 자족적인 UI 블록.**

적합한 것

- 여러 Page에서 같은 의미로 재사용되는 header/sidebar/cart summary
- 독립적인 data loading, store, error state를 가진 화면 영역
- nested routing에서 독립 router/data boundary 역할을 하는 블록
- 여러 Entity/Feature를 조립해 하나의 의미 있는 UI를 제공하는 블록

부적합한 것

- 한 Page의 대부분을 차지하지만 그 Page에서만 의미 있는 블록
- 단일 버튼/action
- 단지 UI가 크다는 이유로 분리한 component

Widget은 단순 조립 전용이 아니다. **자체 API/state/business logic을 가질 수 있다** — "Widget은 로직이 없어야 한다"는 해석은 구식이다.

## Features

**책임 — 사용자가 가치를 느끼는 재사용 가능한 상호작용.**

보통 **동사+목적어**로 이름 붙는다 — `sign-in`, `add-to-cart`, `invite-member`, `approve-proposal`, `change-password`. 한 Feature slice에는 그 action의 UI, API, validation, local workflow state, flag를 함께 둘 수 있다.

Feature가 되기 좋은 신호

- 둘 이상의 Page/Widget에서 **현재** 사용된다.
- 소비자가 기대하는 public contract를 이름 붙일 수 있다.
- 독립적으로 변경·테스트·비활성화할 수 있다.

Feature가 되기 나쁜 신호

- "business logic이니까"
- "언젠가 재사용할 것 같아서"
- 버튼 하나를 모든 레이어에 걸쳐 분해하기 위해
- Page를 무조건 얇게 만들기 위해

## Entities

**책임 — 제품이 다루는 안정적인 business concept.**

적합한 것

- `User`, `Product`, `Order`처럼 제품 언어에 존재하는 명사
- identifier/schema
- 안정적인 invariant와 formatter
- 재사용되는 Entity representation UI
- Entity 중심 API mapper/query primitive
- 여러 소비자가 공유하는 안정된 Entity state

부적합한 것

- 해당 Entity와 관련된 **모든** 행동
- 여러 Entity를 묶는 workflow
- 화면별 filter/sort/pagination
- "백엔드 table이 있으니까" 만든 slice

Entity는 아래 레이어라 많은 곳에서 접근 가능하다. 잘못 만들면 사실상 global namespace가 된다. **"명사이므로 Entity"가 아니라, 안정된 제품 개념이며 여러 상위 책임이 공유하는지**를 본다. Entity 간 직접 import가 늘어나면 경계가 잘못됐거나 상위 composition이 빠졌다는 신호다.

```tsx
// ❌ entities/product/ui/ProductCard.tsx — Entity가 Feature를 알아버림
import { AddToCartButton } from "@/features/add-to-cart";
import { useWishlistStore } from "@/features/toggle-wishlist";

export function ProductCard({ product }: { product: Product }) {
  const isWished = useWishlistStore((s) => s.has(product.id));
  return (
    <article>
      <ProductImage product={product} />
      <AddToCartButton id={product.id} />
    </article>
  );
}
// 동작은 하지만 add-to-cart를 바꾸면 ProductCard를 쓰는 모든 화면이 영향받는다

// ✅ entities/product/ui/ProductCard.tsx — feature의 존재를 모른다
export function ProductCard({ product, actions }: {
  product: Product;
  actions?: React.ReactNode;
}) {
  return (
    <article>
      <ProductImage product={product} />
      {actions}
    </article>
  );
}

// ✅ 조합은 상위 레이어(widget/page)의 책임
<ProductCard product={p}
  actions={<><AddToCartButton id={p.id} /><WishlistToggle id={p.id} /></>} />
```

표현은 Entity, 사용자 행위는 Feature, 둘을 함께 놓는 곳은 상위 레이어다.

## Shared

**책임 — business domain을 모르는 기반과 외부 세계 접점.**

적합한 것

- HTTP client, auth header/retry transport
- UI primitive와 design token
- focused date/text/color library
- 환경 설정, i18n infrastructure
- application-aware route constant
- SDK adapter
- 회사 logo나 공통 layout primitive

부적합한 것

- 할인 계산, 승인 정책, 주문 workflow
- 여러 Feature에서 쓴다는 이유로 이동한 domain helper
- generic 이름의 거대한 `utils`/`types`/`constants`
- owner가 불명확한 business state

Shared는 하위 레이어라 어디서나 접근되고 내부 규칙도 느슨하다. 그래서 가장 쉽게 landfill이 된다. **"두 곳에서 사용"은 Shared의 충분조건이 아니다.** business-independent인가가 먼저다 — 도메인을 몰라도 이해되는 코드인지 스스로에게 물어본다.

## 흔히 빠지는 함정

**Overslicing** — 실제 소비자가 하나뿐인 Entity/Feature/Widget이 폭증한다. 가장 흔한 함정이다. `select-color`처럼 실질 코드 하나 때문에 `ui/`·`model/`·`index.ts` 세 파일이 생기는 식이다.

**Shared landfill** — 여러 곳에서 쓴다는 이유로 domain policy가 Shared로 흘러간다. Shared는 도메인 무관이 기준이지 사용 빈도가 기준이 아니다.

**Obese Entity** — 한 명사와 관련된 모든 행동을 Entity에 몰아넣어 사실상 global service가 된다. Entity는 안정된 표현·불변식만 갖고, 행위는 그 행위를 소유한 Feature/Page/Widget에 남긴다.

**Public API boilerplate** — 작은 slice까지 index가 늘고 barrel/cycle/tree-shaking 문제가 생길 수 있다. 세부는 [`./public-api.md`](./public-api.md).

**분류 토론 비용** — Feature와 Entity, Widget과 Page 경계는 팀마다 다르게 그어질 수 있다. 문서·예시·리뷰 기준이 없으면 폴더 이름만 늘어난다. 애매한 경우의 판단 절차는 [`./placement.md`](./placement.md)에 있다.

## 근거

- [FSD — Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD — Authentication example](https://feature-sliced.design/docs/guides/examples/auth)
- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD — v2.1 migration guide](https://feature-sliced.design/docs/guides/migration/from-v2-0)
- [FSD — Next.js guide](https://feature-sliced.design/docs/guides/tech/with-nextjs)

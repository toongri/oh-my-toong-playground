# 레이어별 책임

레이어를 가르는 기준은 크기나 파일 종류가 아니라 "무엇이 바뀔 때 이 코드도 함께 바뀌는가"라는 책임 질문이다. 여섯 레이어는 각자 다른 책임 질문에 답한다 — App은 조립, Pages는 화면, Widgets는 재사용 대형 블록, Features는 사용자 행위, Entities는 도메인 개념, Shared는 도메인 무관 기반. 레이어 목록과 의존 방향의 기본 규칙은 [`./fsd-overview.md`](./fsd-overview.md)에 있다.

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

## Pages

**책임 — 사용자가 방문하거나 수행하는 화면/activity 단위.**

v2.1에서 **가장 중요한 기본 소유자**다. 새 화면 코드는 일단 여기서 시작한다.

적합한 것

- 화면 전용 UI와 layout
- 화면 전용 form, validation, submit flow
- page query, pagination/filter state
- loading/error/empty boundary
- 해당 화면에서만 쓰는 endpoint adapter
- route parameter 해석
- 여러 하위 블록의 composition

**Page가 얇아야 한다는 규칙은 없다.** 한 화면에서만 쓰인다면 "business logic이 있다"는 이유만으로 Feature나 Entity로 내리지 않는다. Page가 커 보인다는 느낌만으로도 추출 근거는 부족하다 — 독립 변경, 재사용, 명확한 계약이 실제로 생겼는지를 본다. 판단 절차는 [`./placement.md`](./placement.md)의 다섯 질문을 쓴다.

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

v2.1에서 Widget은 단순 조립 전용이 아니다. **자체 API/state/business logic을 가질 수 있다** — "Widget은 로직이 없어야 한다"는 해석은 구식이다.

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

## Processes — deprecated

과거에는 여러 Page에 걸친 흐름을 담는 escape hatch였다. 현재는 만들지 않는다. 있던 책임은 다음으로 옮긴다.

- router/server-level orchestration → App
- 재사용 user interaction → Feature
- 특정 Page들의 로컬 flow → Page 또는 상위 composition

## 실패 모드

**Overslicing** — 실제 소비자가 하나뿐인 Entity/Feature/Widget이 폭증한다. 가장 흔하고 v2.1이 직접 교정한 문제다. `select-color/ui/ColorPicker.tsx` 하나 때문에 `ui/`·`model/`·`index.ts` 세 파일이 생기는 식이다.

**Shared landfill** — 여러 곳에서 쓴다는 이유로 domain policy가 Shared로 흘러간다. Shared는 도메인 무관이 기준이지 사용 빈도가 기준이 아니다.

**Obese Entity** — 한 명사와 관련된 모든 행동을 Entity에 몰아넣어 사실상 global service가 된다. Entity는 안정된 표현·불변식만 갖고, 행위는 그 행위를 소유한 Feature/Page/Widget에 남긴다.

**Public API boilerplate** — 작은 slice까지 index가 늘고 barrel/cycle/tree-shaking 문제가 생길 수 있다. 세부는 [`./public-api.md`](./public-api.md).

**분류 토론 비용** — Feature와 Entity, Widget과 Page 경계는 팀마다 다르게 그어질 수 있다. 문서·예시·리뷰 기준이 없으면 폴더 이름만 늘어난다. 애매한 경우의 판단 절차는 [`./placement.md`](./placement.md)에 있다.

## 근거

- [FSD — Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD — Authentication example](https://feature-sliced.design/docs/guides/examples/auth)

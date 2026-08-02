# Public API — slice의 공개 계약

barrel file과 Public API는 둘 다 `index.ts`처럼 보이지만 목적이 다르다. barrel file은 경로를 축약하려고 내부 전체를 재수출하는 것이고, Public API는 "외부가 알아도 되는 것은 이것뿐"이라는 의도적인 약속이다.

```typescript
// ❌ barrel file — 경로 축약용 재수출. 무엇을 숨길지에 대한 의도가 없다
export * from "./ui/AddToCartButton";
export * from "./model/store"; // 내부 구현까지 전부 공개

// ✅ Public API — "외부가 알아도 되는 건 이것뿐"이라는 약속
export { AddToCartButton } from "./ui/AddToCartButton";
export { useCartCount } from "./model/selectors";
// store 구현체 · 내부 helper는 밖으로 내보내지 않는다
```

`index.ts`만 봐도 알 수 있어야 한다 — 밖에서 쓸 코드, 내부 코드, 그리고 무엇이 breaking change인지.

## 규칙

- 외부 slice는 **public API만** import한다. `@/features/add-to-cart/model/store`처럼 내부 경로로 직접 파고들지 않는다.
- slice 내부는 **상대 경로**를 쓴다. slice가 자기 `index.ts`를 다시 참조하면(self-import) 순환이 된다.
- **export-star(`export *`)로 내부 전체를 노출하지 않는다.** 노출할 것을 하나씩 명시한다.
- 진입점은 **slice 루트에만** 둔다. 모든 하위 폴더(`ui/`, `model/`, `api/`)에 `index.ts`를 만들 필요는 없다.

## Public API가 주는 것

- **내부 refactor와 외부 소비의 분리.** 다른 slice는 `@/entities/product`로만 참조하므로, 내부 파일을 나누거나 합쳐도 소비하는 쪽은 영향받지 않는다.
- **breaking change의 가시성.** `index.ts`에서 export를 지우거나 시그니처를 바꾸는 diff가 곧 "이 slice를 쓰는 곳이 깨질 수 있다"는 신호가 된다. 내부 파일만 바뀌면 그 신호가 나지 않는다.

## shared/ui는 컴포넌트별 진입점

`shared/ui`처럼 크고 자주 쓰이는 slice는 slice 전체를 하나의 `index.ts`로 묶지 않는다. 컴포넌트별로 진입점을 둔다.

```typescript
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
```

tree-shaking 때문에 공식적으로 권장되는 형태다. 하나의 큰 barrel로 묶으면 `Button` 하나만 써도 번들러가 `shared/ui` 전체의 import 그래프를 타게 될 여지가 커진다.

## Server/Client 혼재 — index.server.ts

server-only export가 client bundle을 오염시키는 문제가 생기면(예: server action과 client hook이 같은 slice에 있을 때) 환경별 Public API를 나눈다.

```text
features/checkout/
├── index.ts          ← client-safe export
├── index.server.ts    ← server-only export
```

일반적인 slice에는 이 분리가 필요 없다 — server-only 코드가 client graph에 실제로 섞여 들어갈 위험이 있을 때만 추가한다.

## `@x` — Entity 간 불가피한 의존 전용

같은 레이어의 다른 slice는 원칙적으로 직접 import하지 않는다. Entity끼리 서로를 알아야 하는 경우(예: `Order`가 `Product`의 일부를 참조)만 예외로 `@x` 표기를 쓸 수 있다.

`@x`는 절대 문법이 아니라 **Entities에서만 최소한으로 사용하라는 강한 공식 권고**다. 다른 레이어(Feature, Widget)에서 같은 레이어 import가 필요하다고 느껴진다면 `@x`를 쓰기 전에 먼저 확인한다.

1. slice 병합으로 해소되는가?
2. 상위 레이어(Page/Widget) composition으로 해소되는가?
3. props/context/factory로 의존을 역전할 수 있는가?
4. 진짜 공통이며 domain-independent한 하위 abstraction으로 뺄 수 있는가?

넷 다 아니고 Entity 간 관계일 때만 `@x`를 검토한다. 판단 절차 전체는 [`./placement.md`](./placement.md)의 "같은 레이어 import가 필요할 때" 사다리에 있다.

## 근거

- [FSD — Public API](https://feature-sliced.design/docs/reference/public-api)
- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)

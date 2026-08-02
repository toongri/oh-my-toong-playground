# FSD(Feature-Sliced Design) — 정의와 도입 판단

FSD는 파일 종류가 아니라 **제품에서의 의미, 변경 이유, 재사용 범위, 의존 방향**으로 프런트엔드 코드를 나누는 방법론이다. 폴더 이름을 `features/`·`entities/`로 맞추는 것 자체가 목적이 아니다.

## 코드를 나누는 기준은 계속 바뀌어 왔다

각 시대는 이전 시대가 남긴 문제를 풀면서 새 문제를 남겼다.

| 시대 | 나누는 기준 | 해결 | 남긴 문제 |
| --- | --- | --- | --- |
| 기술 계층(`components/`·`hooks/`·`services/`) | 파일 종류 | 관심사 이름별로 파일을 정리 | 한 기능의 코드가 폴더 3곳에 흩어진다 — "상품 관련 코드가 어디 있죠?"에 답하려면 폴더를 전부 뒤져야 한다 |
| Atomic Design | UI 크기(atom/molecule/organism) | 작은 UI를 조합해 재사용 | "장바구니 담기"는 atom도 organism도 아니다 — UI 크기 기준으로는 로직의 자리를 정할 수 없다 |
| feature 폴더 코-로케이션 | 비즈니스 단위 | 한 기능의 UI·hook·API를 한 폴더에 모음 — 기능 삭제 = 폴더 삭제 | 의존 규칙이 없어 feature가 feature를 마음대로 import한다 → `cart ↔ order ↔ product` 순환 의존 |
| **FSD** | 비즈니스 + 의존 규칙 | 기능별 모음 + 의존 방향 강제 + 공개 API | 학습 곡선, 소규모 프로젝트에는 레이어 자체가 과도할 수 있다 |

Atomic Design이 남긴 문제를 코드로 보면 이렇다.

```tsx
// molecule? organism? — 끝나지 않는 논쟁
function ProductCard({ product }) {
  const addToCart = () => cartApi.add(product.id);
  // ← UI 크기만으로는 "담기" 로직을 어디에 둘지 정할 수 없다
}
```

feature 폴더 코-로케이션이 남긴 문제는 import 방향이다.

```tsx
// features/cart/CartSummary.tsx
import { ProductCard } from "../product";
import { calcShipping } from "../order";

// features/order/useOrder.ts
import { useCart } from "../cart"; // 순환 완성
```

코드는 모였지만 "이 import는 불법"이라 말할 근거가 없다. FSD는 여기에 규칙을 더한다.

```tsx
// features/add-to-cart/ui/AddToCartButton.tsx
import { ProductPrice } from "@/entities/product";   // ✅ 하위 레이어
import { Button } from "@/shared/ui";                 // ✅ 하위 레이어
import { WishlistToggle } from "@/features/toggle-wishlist"; // ❌ 같은 레이어 — 금지
```

## 핵심 셋

1. 관련 UI·상태·API를 한 책임 단위(slice)에 모은다.
2. 외부 소비자는 그 단위의 public API만 사용한다.
3. 의존성은 상위 레이어에서 하위 레이어로만 흐른다.

## 활성 레이어 6개와 의존 규칙

```text
App → Pages → Widgets → Features → Entities → Shared
(상위)                                        (하위)
```

- slice는 **엄격히 더 아래 레이어**의 다른 slice만 import한다.
- 같은 레이어의 다른 slice는 직접 import하지 않는다.
- 같은 slice 내부 import는 자유롭다.
- **App과 Shared는 예외다** — 도메인 slice가 없는 "레이어이면서 하나의 slice"라, 내부 segment 간 import가 가능하다.
- **Processes는 deprecated**다. 새 설계에서는 만들지 않고 App·Feature·Page로 책임을 옮긴다.

레이어별 상세 책임과 실패 모드는 [`./layers.md`](./layers.md)에 있다.

## Slice와 Segment

**Slice**는 제품 의미로 묶는 단위다 — `checkout`, `user`처럼 도메인 언어로 이름 붙는다. 같은 레이어의 slice끼리는 zero coupling, slice 내부는 high cohesion을 지향한다.

**Segment**는 slice 내부를 기술 목적별로 나눈다: `ui`(표시·interaction) · `model`(상태·schema·규칙) · `api`(backend 상호작용) · `lib`(slice 안의 보조 로직) · `config`(slice 설정). `components`·`hooks`·`types`·`utils`처럼 파일 형식만 말하는 이름은 지양한다 — hook과 type은 그 자체로 책임이 아니라 "어느 변경과 함께 움직이는가"가 책임이기 때문이다.

애매한 책임을 슬라이스/세그먼트 어디에 둘지는 [`./placement.md`](./placement.md), slice가 외부에 무엇을 공개할지는 [`./public-api.md`](./public-api.md)에서 다룬다.

## v2.1은 pages-first (2024.11)

오래된 FSD 자료는 Entity·Feature를 먼저 식별한 뒤 Page를 조립하라고 설명한다. 현행 v2.1 공식 권고는 반대에 가깝다.

- 새 화면의 UI·폼·데이터 로딩·로컬 상태는 먼저 Page slice 안에 둔다.
- **두 번째 실제 소비자**, 독립된 의미, 안정된 public contract가 생겼을 때만 아래 레이어로 추출한다.
- Pages·Shared·App만으로 충분하면 거기서 멈춘다.

공식 migration guide는 이를 "starting with pages, and possibly even stopping there"라고 명시한다. 취향 변화가 아니라 v2.0식 조기 분해가 응집을 낮추고, 한 흐름을 수정하려고 여러 폴더를 오가게 만든다는 문제를 교정한 것이다.

```text
features/select-color/
├── ui/ColorPicker.tsx   ← 실질 코드 1개
├── model/useColor.ts
└── index.ts
```

실 소비자가 하나뿐인데 레이어부터 만드는 게 v2.1이 경계하는 실패 모드다 — [`./layers.md`](./layers.md)의 overslicing 절 참고.

## Features 코-로케이션과 FSD의 진짜 차이

멀리서 보면 두 구조는 비슷하다. 다른 것은 **레이어 규칙의 유무**다.

| 관점 | Features 코-로케이션 | FSD |
| --- | --- | --- |
| 철학 | 기능별로 모아두자 | 기능별로 모으되, 레이어와 의존 규칙을 지키자 |
| 레이어 구분 | 없음 — feature가 전부 | App/Pages/Widgets/Features/Entities/Shared 6계층 |
| 의존 규칙 | 없음 — feature가 feature를 직접 import 가능 | 상위→하위만 허용, 동일 레이어 간 직접 import 금지 |
| 장점 | 시작이 쉽고 직관적, 소규모에 충분 | 기능이 늘어도 순환 의존·소유 불명확이 구조적으로 막힌다 |
| 단점 | feature 간 순환 의존이 쉽게 생긴다 | 학습 곡선, 소규모엔 과도 |

cross-feature 공유를 어떻게 판단하는지(props/상위 조립/shared 하향/병합)는 [`../react/feature-boundary.md`](../react/feature-boundary.md)에서 이미 다룬다 — 이 문서는 그 판단이 FSD 6개 레이어 전체로 확장될 때의 규칙을 다룬다.

## 도입 판단

**도입하기 좋은 조건**

- 여러 Page/flow가 있고 코드 탐색 비용이 커졌다.
- 한 영역의 변경이 무관한 영역을 자주 깨뜨린다.
- cross-feature import와 public contract가 이미 문제다.
- 팀이 architecture lint와 예외 리뷰를 운영할 수 있다.

**도입하지 않거나 단순화할 조건**

- 짧은 수명의 MVP.
- Page가 적고 domain이 단순한 앱.
- 기존 feature-folder 구조가 잘 작동한다.
- 분류 규칙을 리뷰·유지할 팀 여력이 없다.

**대안과의 관계**

| 접근 | 더 적합한 상황 | FSD와의 관계 |
| --- | --- | --- |
| Simple feature folders | 소·중규모, 규칙 최소화 | 낮은 ceremony, import 방향은 별도 규칙 필요 |
| Vertical slice | business flow 중심 | FSD와 친연적이나 더 유연하고 팀 편차가 큼 |
| Atomic Design | design system/UI inventory | UI 구성 축일 뿐 business ownership을 정하지 않음 |
| Clean/Hexagonal | 복잡한 domain/use-case/port 격리 | 더 엄격하지만 UI 중심 앱에는 과할 수 있음 |
| Nx domain libraries | monorepo/팀/package 경계 | FSD 내부 구조와 조합 가능, 자동 통합은 아님 |

## 이어지는 문서

- 레이어별 책임 상세 — [`./layers.md`](./layers.md)
- 애매한 책임의 배치 판단 — [`./placement.md`](./placement.md)
- slice의 공개 계약 — [`./public-api.md`](./public-api.md)
- Next.js App Router와의 이름 충돌·서버/클라이언트 경계 — `./nextjs-fsd.md`
- 에러를 어느 계층에서 처리할지 — `./error-layers.md`
- RADIO·RFC로 설계를 먼저 쓰는 과정 — `./design-process.md`

## 근거

- [FSD — Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD — v2.1 migration guide](https://feature-sliced.design/docs/guides/migration/from-v2-0)
- [FSD — Examples](https://feature-sliced.design/examples)

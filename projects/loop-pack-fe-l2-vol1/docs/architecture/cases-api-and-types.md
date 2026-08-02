# API 함수와 타입 — 실전 케이스

같은 API 함수라도 소비자가 하나인지 여럿인지에 따라 배치가 갈리고, 같은 응답 데이터라도 그것을 타입으로 볼지 엔티티로 볼지가 갈린다. 이 문서는 그 갈림에서 실제로 자주 틀리는 지점을 다룬다. 레이어·세그먼트 개념 자체는 [`./layers.md`](./layers.md), public API 개념은 [`./public-api.md`](./public-api.md)에 있다 — 여기서는 그 개념을 이미 아는 채로 구체적 케이스만 본다.

## 케이스 1 — API 요청 함수: 공유냐 슬라이스 전용이냐

**상황.** 로그인 API를 호출하는 함수를 어디에 둘지 정해야 한다.

```ts
// ❌ 일단 shared/api에 넣고 본다 — 소비자가 하나뿐인데도
// shared/api/auth.ts
export async function login(payload: LoginPayload) {
  return client.post("/auth/login", payload);
}
```

로그인 폼은 `pages/login` 하나뿐인데도 "API니까 shared"라는 습관으로 옮기면, 이 엔드포인트의 존재 이유(로그인 폼의 제출)가 호출 위치와 멀어진다. 반대 방향의 실수도 있다 — 상품 조회처럼 여러 슬라이스(목록·상세·검색)가 쓰는 엔드포인트를 각 슬라이스가 각자 다시 구현하는 경우다.

**판단 과정.** 기준은 "이 엔드포인트를 지금 몇 개의 슬라이스가 부른다"다.

- 지금 소비자가 하나면 그 슬라이스의 `api` 세그먼트에 둔다.
- 지금 소비자가 여럿이면 `shared/api/endpoints/`에 엔드포인트별로 그룹핑한다.

```ts
// ✅ 소비자가 하나 — pages/login/api/login.ts에 콜로케이션
export async function login(payload: LoginPayload) {
  return client.post("/auth/login", payload);
}

// ✅ 소비자가 여럿 — shared/api/client.ts + shared/api/endpoints/product.ts
// shared/api/client.ts
export const client = createHttpClient({ baseURL: env.API_URL });

// shared/api/endpoints/product.ts
export async function fetchProduct(id: string) {
  return client.get(`/products/${id}`);
}
```

`shared/api/client.ts`는 base URL·인증 헤더·retry 같은 transport 설정만 갖고, 엔드포인트별 함수는 `endpoints/` 아래 파일로 나눈다 — 하나의 거대한 `api.ts`에 전 엔드포인트를 몰아넣지 않는다.

## 케이스 2 — 응답 타입을 entities에 조기 배치하지 않는다

**상황.** 백엔드가 내려주는 상품 응답을 그대로 `entities/product`의 타입으로 쓰고 싶은 유혹이 있다.

```ts
// ❌ entities/product/model/types.ts — 백엔드 응답 형태를 그대로 도메인 타입으로 승격
export interface Product {
  id: string;
  product_name: string; // 백엔드 snake_case가 그대로 노출
  price_info: { amount: number; currency: string };
}
```

백엔드 응답 구조는 프론트엔드가 실제로 필요로 하는 형태와 다를 수 있다. 응답 타입을 그대로 엔티티 타입으로 삼으면, 백엔드 필드명이 바뀔 때마다 엔티티를 쓰는 모든 소비자가 함께 흔들린다.

**판단 과정.** DTO와 매퍼는 "이 API를 소유한 곳"에 콜로케이션한다. 엔티티는 매핑을 거친 뒤의 안정된 도메인 형태만 갖는다.

```ts
// ✅ entities/product/api/dto.ts — 백엔드 응답 형태, API owner가 소유
interface ProductResponseDto {
  id: string;
  product_name: string;
  price_info: { amount: number; currency: string };
}

// ✅ entities/product/api/mapper.ts
export function toProduct(dto: ProductResponseDto): Product {
  return { id: dto.id, name: dto.product_name, price: dto.price_info.amount };
}

// ✅ entities/product/model/types.ts — 매핑을 거친 안정된 도메인 타입
export interface Product {
  id: string;
  name: string;
  price: number;
}
```

## 케이스 3 — query 훅의 콜로케이션

**상황.** 상품 찜하기 기능에서 fetcher, 응답 검증 스키마, query 훅을 어디에 선언할지 정해야 한다.

```tsx
// ❌ 컴포넌트 안에 즉석으로 fetcher와 query를 선언 — 다른 화면에서 재사용 불가
function WishlistButton({ productId }: { productId: string }) {
  const { data } = useQuery({
    queryKey: ["wishlist", productId],
    queryFn: () => fetch(`/api/wishlist/${productId}`).then((r) => r.json()),
  });
  // ...
}

// ❌ 반대 극단 — 전역 API 레이어에 모든 feature의 query를 흩어놓음
// shared/api/queries.ts (수백 줄, 모든 도메인이 뒤섞임)
```

**판단 과정.** fetcher · 검증 스키마 · query 훅은 그 기능의 `api/` 폴더에 콜로케이션한다. 여러 feature가 같은 호출을 공유할 정도로 반복되면 그때 전용 api 모듈로 뺀다 — 미리 빼지 않는다.

```ts
// ✅ features/toggle-wishlist/api/wishlist.ts
const wishlistResponseSchema = z.object({ productId: z.string(), wished: z.boolean() });

async function fetchWishlist(productId: string) {
  const res = await client.get(`/wishlist/${productId}`);
  return wishlistResponseSchema.parse(res.data);
}

export function useWishlistQuery(productId: string) {
  return useQuery({ queryKey: ["wishlist", productId], queryFn: () => fetchWishlist(productId) });
}
```

호출이 한 feature 안에서만 쓰이는 동안은 이 콜로케이션이 맞다. `entities/product/api`와 `features/toggle-wishlist/api`가 같은 엔드포인트를 각자 다시 구현하기 시작하면, 그것이 "여러 feature가 공유"로 넘어갔다는 신호다.

## 케이스 4 — `shared/types` 금지, 타입은 사용 위치 곁에

**상황.** 여러 슬라이스가 쓰는 타입을 모아두는 폴더를 만들고 싶어진다.

```ts
// ❌ shared/types/index.ts — 목적이 다른 타입이 파일 형식 하나로 뒤섞임
export interface Product { /* ... */ }
export interface Order { /* ... */ }
export interface PaginationParams { /* ... */ }
export type Nullable<T> = T | null;
```

타입은 그 자체로 목적을 설명하지 않는다 — 형태만 설명한다. `shared/types`는 파일 형식으로 묶은 폴더라 코드를 찾는 데 도움이 안 된다. `Product`를 찾으려는 사람은 `entities/product`를 볼 것이지 `shared/types`를 보지 않는다.

**판단 과정.** 두 갈래로 나눈다.

- 순수 유틸리티 타입(`Nullable<T>`처럼 도메인과 무관한 타입 조작)은 `shared/lib/utility-types`.
- 도메인 타입·DTO는 그 도메인을 소유한 슬라이스의 `api`/`model` 세그먼트.

```ts
// ✅ shared/lib/utility-types/index.ts — 도메인 무관 유틸리티 타입만
export type Nullable<T> = T | null;
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ✅ entities/product/model/types.ts — Product를 아는 사람이 여기를 본다
export interface Product { id: string; name: string; price: number; }

// ✅ entities/order/model/types.ts
export interface Order { id: string; items: Product[]; }
```

## 케이스 5 — 엔티티 간 타입 순환 참조: `@x` 실전

**상황.** `entities/artist`가 `entities/song`의 타입 일부를 참조해야 하는데, `entities/song`도 언젠가 `entities/artist`를 참조할 수 있어 순환이 우려된다. `@x` 표기 자체의 개념과 검토 순서는 [`./public-api.md`](./public-api.md)에 있다 — 여기서는 타입 순환이라는 구체 시나리오만 본다.

```ts
// ❌ entities/artist/model/types.ts — song 내부 경로로 직접 파고듦
import type { SongDto } from "@/entities/song/api/dto"; // 내부 경로, public API 우회
```

**해소.** `entities/song`이 `@x/artist`라는 전용 진입점을 만들어 "artist를 위해 이것만 공개한다"를 명시하고, `entities/artist`는 그 진입점으로만 import한다.

```ts
// ✅ entities/song/@x/artist.ts — artist slice에게만 공개하는 명시적 재수출
export type { Song } from "../model/types";

// ✅ entities/artist/model/types.ts
import type { Song } from "entities/song/@x/artist";

export interface Artist {
  id: string;
  songs: Song[];
}
```

`@x/artist.ts`라는 파일명 자체가 "이 export는 artist slice 전용"이라는 계약을 코드로 남긴다 — 다른 slice가 같은 파일을 갖다 쓰면 계약을 벗어난 사용임이 리뷰에서 바로 보인다.

## 케이스 6 — 자잘한 배치 규칙 모음

아래는 케이스로 늘어놓기엔 짧지만 반복적으로 헷갈리는 배치들이다.

| 대상 | 배치 | 이유 |
| --- | --- | --- |
| Redux `RootState`/`AppDispatch` | `app/store`에서 declare | store 구성 자체를 소유한 곳이 그 타입도 소유한다 |
| enum — 토스트 위치 | 소비하는 `ui` 세그먼트 | 표시 방식에 관한 것이라 UI에 가장 가깝다 |
| enum — 백엔드 응답 상태 코드 | 소유 슬라이스의 `api` 세그먼트 | 응답 계약의 일부이므로 API owner가 소유 |
| zod 스키마 — 백엔드 응답 검증 | `api` 세그먼트 | 케이스 3의 `wishlistResponseSchema`와 같은 위치 |
| zod 스키마 — 폼 입력 검증 | `model`/`ui` 세그먼트 | 폼 UX의 일부이지 API 계약이 아니다 |
| 앰비언트 `*.d.ts` | `app/ambient/` | 전역 타입 선언은 앱 부트스트랩과 함께 초기화되는 성격 |
| OpenAPI 자동생성 코드 | `shared/api/openapi/` | 손으로 안 건드리는 generated tree를 좁은 경계로 격리 |

## 근거

- [FSD — API requests example](https://feature-sliced.design/docs/guides/examples/api-requests)
- [FSD — Types example](https://feature-sliced.design/docs/guides/examples/types)
- [FSD — Public API](https://feature-sliced.design/docs/reference/public-api)
- [bulletproof-react — API layer](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md)

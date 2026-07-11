# 데이터·자산 — Next이 표준으로 제공하는 것

Vite + React에서 손으로 배선하던 데이터 페칭·캐싱·이미지 최적화를 Next은 표준으로 묶어 꺼내 쓰게 한다.

## 데이터를 언제·어디서 채우나 — 서버 우선

CSR은 빈 화면 → 로딩 → 데이터 순서를 거친다. Server Component는 컴포넌트가 곧 `async`라, 첫 HTML에 데이터가 이미 들어 있다.

```tsx
// ❌ CSR — 빈 HTML → JS 로드 → 마운트 후 fetch → 그제서야 렌더
function ProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => {
    fetch(`/api/products/${id}`).then((r) => r.json()).then(setProduct);
  }, [id]);
  if (!product) return <Spinner />; // 로딩 화면을 반드시 거친다
  return <ProductView product={product} />;
}

// ✅ Server Component — 서버에서 데이터를 채워 완성된 HTML을 내려준다
async function ProductDetail({ id }: { id: string }) {
  const product = await getProduct(id); // 컴포넌트가 곧 async
  return <ProductView product={product} />;
} // useState·useEffect·Spinner 없음. 첫 화면부터 데이터가 들어있다.
```

서버에서 채우는 게 기본이다. 클라이언트에서 직접 `useEffect`로 fetch해야 하는 경우(사용자 상호작용 후 갱신 등)에는 race condition·의존성·정리(cleanup)를 손으로 챙긴다 — 그 판단(`ignore` vs `AbortController`, 원시 필드 의존성)은 [`docs/react/hook-design.md`](../react/hook-design.md) §8에 있다. 서버/클라이언트 중 어디에 둘지의 경계는 [`app-router.md`](./app-router.md).

## 캐싱·재검증 — fetch에 내장

Vite에선 캐시 `Map`과 무효화 로직을 직접 짠다. Next에선 캐싱·재검증이 `fetch` 옵션으로 내려가, 캐시 자료구조도 무효화 로직도 직접 안 짠다.

```tsx
// ❌ 캐시·재검증을 '직접' 구현 — 언제 비울지도 손으로 관리
const cache = new Map<string, Product>();
async function getProduct(id: string) {
  if (cache.has(id)) return cache.get(id)!;
  const data = await fetch(`/api/products/${id}`).then((r) => r.json());
  cache.set(id, data);
  return data;
}

// ✅ 캐싱·재검증이 fetch에 '내장'
async function getProduct(id: string) {
  const res = await fetch(`https://api/products/${id}`, {
    next: { revalidate: 60 }, // 60초마다 재검증 (ISR)
  });
  return res.json();
}
```

`revalidate` 한 줄이면 캐시/무효화가 **인프라로 내려간다**. 요점은 "직접 배선하던 캐시 관리를 프레임워크에 맡긴다"는 방향이다.

> 캐시 스코프·태그 무효화·요청별 캐시 격리 같은 **깊은 캐싱 전략은 이 문서 범위가 아니다** — 데이터 심화 주차에서 별도로 다룬다. 여기선 "캐싱이 fetch 옵션으로 내려갔다"는 그림만 잡는다.

## 이미지 — next/image

srcset·lazy·webp·크기 지정을 손으로 챙기던 걸 컴포넌트 하나로 표준화한다. 크기·webp 변환·lazy·blur placeholder까지 기본값이다.

```tsx
// ❌ 최적화를 직접 챙긴다
<img src="/hero.png" srcSet="/hero@1x.webp 1x, /hero@2x.webp 2x" loading="lazy" width={1200} height={600} />

// ✅ next/image — 크기·webp 변환·lazy·blur가 자동
import Image from "next/image";
import hero from "./hero.png";
<Image src={hero} alt="히어로" placeholder="blur" />;
```

정적 import한 이미지는 크기를 빌드 타임에 알아 **CLS(레이아웃 이동)를 자동으로 막는다**. 원격 URL을 쓸 땐 `width`·`height`를 직접 준다.

## 폰트 — next/font

`<link>`로 폰트를 직접 불러오면 FOUT(무스타일 텍스트 깜빡임)과 CLS를 손으로 관리해야 한다. `next/font`는 폰트를 self-host하고 CLS 방지를 자동으로 처리한다.

```tsx
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"] }); // self-host + CLS 방지 자동
```

## 정리

"성능 최적화"를 매번 손으로 챙기던 걸 표준 컴포넌트·옵션으로 옮긴 것이다 — 데이터는 서버에서 채우고(`async` Server Component), 캐싱은 `fetch`에 맡기고(`revalidate`), 이미지·폰트는 `next/image`·`next/font`가 기본값으로 최적화한다.

# App Router — 구조와 렌더링 경계

Next는 React가 아니라 React **위에** 얹힌 얇은 층이다. 컴포넌트 설계·상태 관리·관심사 분리 같은 React 토대는 그대로 유효하고, Next이 새로 얹는 건 파일 라우팅·Server/Client 경계·캐싱뿐이다.

## 라이브러리 vs 프레임워크

둘을 가르는 건 "누가 누구를 부르느냐"다.

- **라이브러리(React)** — 내가 필요할 때 부른다. 앱 구조·흐름을 내가 결정한다.
- **프레임워크(Next)** — 프레임워크가 나를 부른다. 폴더·파일 규칙을 강제하고, 내 코드를 알아서 호출한다("Don't call us, we'll call you" — 할리우드 원칙).

React는 UI 렌더링만 하고 라우팅·SSR·이미지 최적화·데이터 캐싱은 일부러 빼놨다. Vite로 만들면 이 조각들을 매번 직접 조립한다. Next은 그 조합을 하나의 표준으로 묶은 것이다.

| 영역        | Vite + React (직접 조합)  | Next.js (표준 제공)         |
| ----------- | ------------------------- | --------------------------- |
| 라우팅      | React Router 설치·설정    | 파일 기반 (`app/` 디렉토리) |
| 렌더링      | CSR 고정                  | Server Component 기본       |
| 이미지·폰트 | 수동 최적화               | `next/image` · `next/font`  |
| 데이터·캐싱 | 직접 배선                 | 내장 캐싱 · `revalidate`    |

## 파일 라우팅 — 폴더가 곧 라우트

App Router에선 라우터 설정 파일이 없다. **폴더 구조가 곧 라우트**다 — 경로가 늘어도 배열이 아니라 폴더가 는다.

```text
app/
├─ layout.tsx        # 공통 껍데기 (하위 전체가 공유)
├─ page.tsx          # '/'            홈
├─ products/
│  ├─ page.tsx       # '/products'    목록
│  └─ [id]/
│     └─ page.tsx    # '/products/42' 상세
└─ cart/
   └─ page.tsx       # '/cart'        장바구니
```

| 파일         | 역할                                                          |
| ------------ | ------------------------------------------------------------- |
| `page.tsx`   | 그 경로의 화면                                                |
| `layout.tsx` | 하위를 감싸는 공통 껍데기. 이동해도 유지되고 폴더 따라 **중첩** |
| `loading.tsx`| 그 구간 로딩 UI (Suspense 자동)                               |
| `error.tsx`  | 그 구간 에러 UI (에러 바운더리 자동)                          |

동적 구간은 폴더명을 `[id]`로 두고, `page`가 `params`로 받는다.

```tsx
// app/products/[id]/page.tsx — 이 '파일'이 곧 '/products/:id'
export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div>상품 {id}</div>;
}
```

**중첩 레이아웃** — 커머스 공통 헤더·네비는 위쪽 `layout`에 한 번만 두면 폴더 깊이만큼 겹쳐진다. 페이지를 이동해도 상위 layout은 다시 그려지지 않는다.

## Server / Client 경계

App Router의 가장 큰 변화 — **컴포넌트는 기본이 Server Component**다. 필요할 때만 클라이언트로 "빠져나온다".

|            | Server (기본)             | Client (`'use client'`)              |
| ---------- | ------------------------- | ------------------------------------ |
| 실행       | 서버에서만                | 서버에서 한 번 렌더 → 브라우저 hydrate |
| 할 수 있는 것 | `async`로 직접 fetch·DB 접근 | `useState`·`onClick`·브라우저 API    |
| 못 하는 것 | 훅·이벤트·브라우저 API    | 서버 전용 로직·비밀키 접근           |

`'use client'`는 "이 파일부터 클라이언트"라는 **경계** 표시이고, 아래로 import되는 컴포넌트에 **전파**된다. 상태·이벤트·Context·브라우저 API를 쓰는 컴포넌트는 이 지시어가 필요하다 — [`docs/react/component-patterns.md`](../react/component-patterns.md)의 패턴(Compound·Provider 등)이 전부 클라이언트인 이유다.

```tsx
// 컴포넌트 트리 — 서버 컴포넌트 사이에 클라이언트 '섬'
// <Page>                  [서버]
// ├─ <Header />           [서버]
// ├─ <ProductList />      [서버]  // async · 데이터 직접 fetch
// └─ <AddToCartButton />  [클라 · 'use client']  // 상태 · onClick
```

## hydrate — 서버에서 HTML로, 브라우저에서 살아난다

클라이언트 컴포넌트라고 브라우저에서만 도는 게 아니다. 서버에서 한 번 프리렌더된 뒤 브라우저에서 hydrate된다.

1. **서버에서 렌더** — Server 실행(데이터 fetch) + Client도 프리렌더 → **완성된 HTML** 생성
2. **브라우저에 도착** — HTML을 즉시 그린다. 사용자는 바로 보지만 아직 클릭은 안 됨
3. **hydrate** — 클라 컴포넌트 **JS만** 다운로드 → 기존 HTML에 이벤트·상태를 **붙임** → 인터랙티브

핵심 두 가지 — **서버 컴포넌트는 브라우저로 JS를 0 보낸다**(HTML만 내려감). 클라 컴포넌트만 JS가 내려가서 hydrate된다. 그리고 **hydrate는 새로 그리는 게 아니라, 이미 그려진 HTML에 이벤트·상태를 "붙이는" 것**이다.

> ⚠️ 클라 컴포넌트도 SSR 때 서버에서 한 번 실행되므로, 최상단에서 `window`·`document`를 바로 만지면 SSR에서 터진다. 브라우저 API는 `useEffect` 안에서 만진다 — 렌더 순수성·비순수 입력 처리는 [`docs/react/hook-design.md`](../react/hook-design.md) §10.

## 공식 문서

발제는 지도만 그린다. 세팅하면서 원본을 직접 읽는다.

- [Next.js — App Router](https://nextjs.org/docs/app) — 라우팅·레이아웃·파일 컨벤션 원본
- [Next.js — Server & Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — 경계 상세
- [React — Server Components (RSC)](https://react.dev/reference/rsc/server-components) · [hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)

# 구조와 경계 — 실전 함정과 도구 강제

레이어 정의를 안다고 해서 실제 코드에서 경계를 정확히 긋게 되는 것은 아니다. 이 문서는 정의를 다시 설명하지 않고, 그 정의를 알고도 자주 틀리는 지점과, 그 경계를 사람의 판단이 아니라 도구로 강제하는 방법을 다룬다. 레이어 책임 자체는 [`./layers.md`](./layers.md), 애매한 배치 판단 절차는 [`./placement.md`](./placement.md)에 있다.

## 케이스 1 — "재사용 안 되면 widget도 feature도 아니다"

**상황.** 상품 상세 페이지의 메인 콘텐츠 블록(이미지 갤러리 + 구매 옵션 + 설명)을 만드는데, "블록이 크니까"라는 이유로 습관적으로 widgets에 넣는다.

```text
❌ widgets/product-main-content/     ← product-detail 페이지에서만 쓰이는데 widgets로
├── ui/ProductMainContent.tsx
└── index.ts
```

**판단 과정.** widget의 자격은 크기가 아니라 재사용이다. 블록이 페이지의 주요 콘텐츠를 구성하지만 다른 페이지에서 재사용되지 않으면 그 페이지 내부에 둔다. feature도 같은 함정에 빠진다 — "이건 business logic이니까 feature"라는 판단은 소비자 수를 묻지 않은 판단이다. feature를 너무 많이 만들면 정작 중요한 재사용 feature가 그 사이에 묻힌다.

```text
✅ _pages/product-detail/
├── ui/ProductMainContent.tsx   ← 이 페이지 전용, 재사용 없음
├── api/
└── index.ts
```

두 번째 실제 소비자가 생기기 전까지는 Page 안에 둔다 — 이 판단 순서 자체는 [`./layers.md`](./layers.md)의 pages-first 규칙과 동일하다.

## 케이스 2 — 레이아웃(헤더·사이드바·푸터)의 위치

**상황.** 모든 페이지에 붙는 헤더를 어디에 둘지 정해야 한다. 헤더 안에는 로고(정적)와 알림 벨·유저 메뉴(위젯 수준의 동적 UI)가 함께 있다.

```tsx
// ❌ shared/ui/Header.tsx — shared가 widgets를 import
import { NotificationBell } from "@/widgets/notification-bell"; // shared는 widgets를 모른다
import { UserMenu } from "@/widgets/user-menu";

export function Header() {
  return (
    <header>
      <Logo />
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
```

`shared`는 가장 하위 레이어라 `widgets`를 import할 수 없다. 헤더가 정적 마크업뿐이면 문제가 없지만, 알림 벨이나 유저 메뉴처럼 그 자체로 독립 데이터·상태를 가진 위젯을 조합해야 하는 순간 이 구조는 의존 방향을 거스른다.

**판단 과정.** 두 갈래로 나눈다.

- 정적이고 단순하면(로고, 순수 레이아웃 grid) `shared/ui` 또는 `app/layouts`에 둔다. 동적으로 바뀌는 영역은 `children`/`slot` props나 `Outlet`으로 주입받는다.
- 위젯급 조각을 조합해야 하면 `shared`는 그 조립을 할 수 없으므로 App 레이어로 올리거나, render-props/slot으로 주입하는 형태로 뒤집는다.

```tsx
// ✅ shared/ui/HeaderLayout.tsx — 동적 영역은 props로 주입받을 뿐, widgets를 모른다
export function HeaderLayout({ actions }: { actions?: React.ReactNode }) {
  return (
    <header>
      <Logo />
      {actions}
    </header>
  );
}

// ✅ _app/layouts/RootLayout.tsx — 위젯 조합은 App이 안다
import { HeaderLayout } from "@/shared/ui/HeaderLayout";
import { NotificationBell } from "@/widgets/notification-bell";
import { UserMenu } from "@/widgets/user-menu";

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HeaderLayout actions={<><NotificationBell /><UserMenu /></>} />
      {children}
    </>
  );
}
```

부가 기준 두 가지도 함께 쓴다. 레이아웃이 2~3개 페이지에서만 살짝 다르게 쓰이면 추상화보다 복사-붙여넣기를 고려한다. 그 레이아웃 안의 비즈니스 로직이 자주 바뀐다면 애초에 공용 추상화로 묶지 않는다 — 매번 여러 페이지가 함께 흔들린다.

## 케이스 3 — 관련 slice 폴더 그룹핑, 내부 공유는 여전히 금지

**상황.** `photo`, `effects`, `gallery-page`처럼 자주 함께 바뀌는 slice들을 시각적으로 묶고 싶어 상위 폴더로 그룹핑한다.

```text
features/
└── photo-editing/        ← 그룹 폴더, FSD 레이어 개념은 아님
    ├── photo/
    ├── effects/
    └── gallery-page/
```

이 그룹핑 자체는 허용된다. 문제는 그다음이다.

```ts
// ❌ features/photo-editing/gallery-page/ui/Gallery.tsx
// 같은 그룹 안이라는 이유로 photo의 public API를 건너뛰고 내부 파일을 직접 참조
import { applyFilter } from "@/features/photo-editing/effects/lib/filters"; // 내부 경로
```

public API를 거치면 고쳐진 것처럼 보이지만 아니다.

```ts
// ❌ 여전히 위반 — public API를 거쳐도 같은 레이어 slice 간 import다.
// 그룹 폴더는 격리 규칙을 완화하지 않는다(FSD 공식: 그룹 안에서도 no code sharing).
import { applyFilter } from "@/features/photo-editing/effects";
```

**판단 과정.** 폴더로 묶는 것은 탐색 편의를 위한 것이지, slice 경계를 없애는 것이 아니다. `gallery-page`가 `effects`를 참조해야 한다는 문제 자체가 그룹 안에서는 풀리지 않는다 — deep import를 public API로 바꿔도 같은 레이어의 다른 slice를 직접 import한다는 사실은 그대로다. 해소는 [`./placement.md`](./placement.md)의 "같은 레이어 import가 필요할 때" 사다리를 따라 둘 중 하나로 간다.

- **상위 레이어가 두 Feature를 조립한다.** `gallery-page`가 실은 `photo`와 `effects`를 엮는 자리라면, 그 조립은 `gallery-page` 자신이 아니라 그보다 위인 Page가 한다.

  ```tsx
  // ✅ pages/gallery/ui/GalleryPage.tsx — 상위 레이어가 두 Feature를 조립
  import { PhotoCanvas } from "@/features/photo-editing/photo";
  import { EffectsPanel } from "@/features/photo-editing/effects";

  export function GalleryPage() {
    return <Editor canvas={<PhotoCanvas />} tools={<EffectsPanel />} />;
  }
  ```

- **항상 함께 바뀐다면 애초에 하나의 slice로 합친다.** `photo`와 `effects`가 매번 같이 수정된다면 둘로 나눈 경계 자체가 틀린 것이다.

그룹 폴더는 무엇이 함께 바뀌는지 보여주는 문서화 장치일 뿐, slice 간의 계약을 없애는 도구가 아니다. 그룹 안이라는 이유로 결합을 허용하면 나중에 그룹을 쪼갤 때 그 결합이 전부 드러난다.

## 케이스 4 — segment 이름: 형태가 아니라 목적

**상황.** segment 이름을 파일 형식으로 붙인다.

```text
❌ shared/hooks/          ← "hook을 모아둔 곳" — 목적이 아니라 형태
❌ shared/utils/          ← 잡동사니가 모이는 이름
❌ entities/user/components/  ← React 파일 형식 이름
```

**판단 과정.** segment는 "이 코드가 왜 존재하는가"를 답해야지 "무슨 문법으로 쓰였나"를 답하면 안 된다. React 계열(`hooks`, `providers`)이나 Redux 계열(`actions`, `reducers`, `selectors`)처럼 프레임워크 문법을 그대로 옮긴 이름은 FSD segment로 쓰지 않는다 — `model`(상태·규칙), `ui`(표시), `api`(백엔드 상호작용), `lib`(보조 로직) 네 갈래로 목적에 따라 분류한다.

`shared/lib`도 예외가 아니다. 잡동사니를 모으는 이름으로 쓰면 안 되고, 영역별로 다시 그룹을 나눈다 — Steiger의 shared-lib-grouping 규칙이 정확히 이 실수를 잡는다.

```text
❌ shared/lib/
├── formatDate.ts
├── debounce.ts
├── parseQuery.ts
└── validateEmail.ts   ← 영역 구분 없이 평평하게 쌓임

✅ shared/lib/
├── dates/
│   └── formatDate.ts
├── async/
│   └── debounce.ts
└── url/
    └── parseQuery.ts
```

## 케이스 5 — 경계는 도구로 강제한다

사람이 리뷰로 매번 잡아내는 경계는 결국 뚫린다. 아래 두 도구는 각각 다른 층위의 위반을 잡는다.

### ESLint `import/no-restricted-paths` — cross-feature와 역방향 import 차단

하위 레이어가 상위 레이어를 참조하는 것은 zones로 막는다. zone의 `target`은 import 문이 있는 쪽 — 위반의 주체 — 을 선택하고, `from`은 그 파일들이 import하면 안 되는 곳이다. cross-feature 차단은 slice별로 zone을 하나씩 열거해야 하는데, 여기엔 함정이 있다: target/from에 glob을 쓰면 glob 규약으로 매치되고 `*` 하나는 경로 구분자를 넘지 못한다 — `./src/features`에 `*`를 붙인 형태는 `src/features/photo/ui/Photo.tsx` 같은 중첩 파일에 매치되지 않는 no-op zone이 된다. glob 없는 디렉토리 경로는 그 아래 전부에 재귀 매치되므로, slice 디렉토리를 그대로 target으로 쓴다(bulletproof-react 방식).

```json
{
  "rules": {
    "import/no-restricted-paths": [
      "error",
      {
        "zones": [
          {
            "target": "./src/features/photo",
            "from": "./src/features",
            "except": ["./photo"],
            "message": "features 간 직접 import 금지 — 상위 레이어에서 조합한다"
          },
          {
            "target": "./src/shared",
            "from": ["./src/entities", "./src/features", "./src/widgets", "./src/_pages", "./src/_app"],
            "message": "shared는 상위 레이어를 알 수 없다 — 의존은 항상 하위로만 흐른다"
          }
        ]
      }
    ]
  }
}
```

위 zone은 `photo`가 다른 feature를 import하는 것을 막는다. 케이스 3의 `gallery-page → effects`를 잡으려면 `gallery-page`를 target으로 한 zone이 따로 있어야 한다 — 그래서 이 방식은 slice마다 zone을 하나씩 열거해야 한다. 두 번째 zone은 케이스 2에서 `shared`가 `widgets`를 import하려던 실수를 빌드 단계에서 잡는다. 열거 없이 일반형으로 같은 레이어 간 import를 잡는 것은 아래 Steiger의 `forbidden-imports`가 담당한다.

### Steiger — FSD 전용 정적 분석이 잡는 위반

| 규칙 | 잡는 실수 |
| --- | --- |
| `insignificant-slice` | 참조하는 곳이 0~1개뿐인 slice — 케이스 1의 overslicing |
| `excessive-slicing` | 한 그룹 안에 slice가 과도하게 많음 |
| `forbidden-imports` | 상위 레이어 import, 같은 레이어 간 import |
| `no-public-api-sidestep` | slice 진입점(index.ts)을 우회한 내부 경로 직접 참조 — 케이스 3 |
| `no-segmentless-slices` | segment 없이 파일이 slice 루트에 바로 흩어짐 |
| `no-ui-in-app` | App 레이어에 UI 컴포넌트가 직접 들어감 |
| `no-processes` | processes 레이어 사용 — 이 프로젝트는 애초에 processes를 쓰지 않는다 |
| `typo-in-layer-name` | 레이어 이름 오타(`entitites` 등) |

**단서.** 린트 결과를 무조건 "지금 당장 옮겨라"로 해석하지 않는다. alias 경로, generated 코드, dynamic import는 zones/Steiger 둘 다 오탐을 낼 수 있다. 이 오탐을 걸러내고 warning에서 error로 승격하는 순서는 [`./design-process.md`](./design-process.md)의 점진 도입 절에 있다 — 여기서는 도구가 무엇을 잡는지만 정리했다.

## 케이스 6 — barrel 파일의 긴장

**상황.** FSD 공식 권고는 slice 루트에 public API(`index.ts`)를 두라는 것이고, bulletproof-react는 barrel이 Vite 같은 번들러의 tree-shaking을 방해하니 직접 import를 권장한다고 말한다. 둘을 그대로 겹치면 충돌처럼 보인다.

```ts
// FSD식 — 진입점을 통해서만 import
import { Button } from "@/shared/ui";

// bulletproof-react식 — barrel을 건너뛰고 직접 import
import { Button } from "@/shared/ui/button/Button";
```

**해소.** 이 프로젝트의 규범은 두 권고를 층위로 분리해서 절충한다 — slice 루트에는 public API로서 `index.ts` 하나만 두고, 모든 하위 폴더에 index를 만들지 않는다. `shared/ui`처럼 크고 자주 쓰이는 slice는 컴포넌트별 진입점으로 쪼갠다. 이 절충의 정확한 규범은 [`./public-api.md`](./public-api.md)의 "shared/ui는 컴포넌트별 진입점" 절에 있다.

여기서 추가로 짚을 함정은 두 가지다.

```text
❌ 레이어 전체를 하나의 barrel로 — features/index.ts가 모든 feature를 재수출
   → Steiger의 no-layer-public-api가 잡는다. 레이어는 public API 단위가 아니다.

❌ 모든 하위 폴더에 index.ts — ui/index.ts, model/index.ts, api/index.ts까지
   → 진입점이 여러 개가 되면 "외부가 무엇을 알아도 되는가"라는 public API의
     의도가 흐려지고, barrel 개수만큼 tree-shaking 손해도 커진다.
```

## 케이스 7 — Next.js 배치 추가 케이스

route 파일이 얇은 adapter여야 한다는 일반 규칙은 [`./layers.md`](./layers.md)의 Pages 절에 있다. 여기서는 그 규칙만으로는 답이 안 나오는 두 가지를 추가한다.

**API Route Handler.** 실제 로직은 `_app/api-routes`에 두고, `app/api/*/route.ts`는 재수출만 한다 — Page route 파일과 동일한 thin adapter 패턴을 API route에도 적용한다.

```ts
// ❌ app/api/example/route.ts — 로직이 route 파일에 직접 들어감
export async function GET() {
  const data = await db.query("SELECT * FROM example");
  return Response.json(data);
}

// ✅ src/_app/api-routes/example.ts
export async function getExampleData() {
  const data = await db.query("SELECT * FROM example");
  return Response.json(data);
}

// ✅ app/api/example/route.ts — 재수출뿐
export { getExampleData as GET } from "@/_app/api-routes";
```

**서버 컴포넌트의 DB 쿼리·캐싱.** 여러 서버 컴포넌트가 각자 DB 클라이언트를 만들거나 캐싱 정책을 따로 구현하지 않는다 — `shared/db`로 통합해서 연결·캐싱 정책을 한 곳에서 관리한다.

**FSD 밖에 남는 파일.** `middleware.ts`, `instrumentation.ts`는 Next.js 런타임이 프로젝트 루트에서 찾는 파일이라 FSD 레이어 트리 안으로 옮기지 않는다 — 루트에 그대로 둔다.

## 근거

- [FSD — Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD — Page layout example](https://feature-sliced.design/docs/guides/examples/page-layout)
- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD — Next.js guide](https://feature-sliced.design/docs/guides/tech/with-nextjs)
- [bulletproof-react — Project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Steiger](https://github.com/feature-sliced/steiger)

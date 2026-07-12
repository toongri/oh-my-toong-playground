# 유연한 컴포넌트 패턴 — 결정을 사용처에 넘긴다

좋은 공통 컴포넌트는 기능을 많이 넣는 게 아니라 **결정을 사용처에 넘긴다**(Inversion of Control). 무엇을 넘기느냐로 패턴이 갈린다.

- **UI(렌더링)**를 넘긴다 → **Headless**
- **구조**를 넘긴다 → **Compound**
- **상태 소유권**을 넘긴다 → **Controlled/Uncontrolled** — [`props-contract.md`](./props-contract.md#controlled-vs-uncontrolled)에 있다
- **상태를 트리 안에 두나, 밖에 두나** → **Provider vs Singleton**

> ⚠️ 이 문서의 패턴은 상태·Context·이벤트·브라우저 API를 쓰므로 **전부 클라이언트 컴포넌트**다(파일 상단 `'use client'`). 서버 컴포넌트에 그냥 넣으면 터진다 — 경계 판단은 [`app-router.md`](../nextjs/app-router.md).

## Headless — UI를 사용처가 결정

**로직만 제공하고, UI는 사용처가 결정**하는 패턴이다. 동작(열기·선택·키보드)은 같은데 겉모습만 완전히 다를 때 쓴다.

> ❗ **패턴이지 라이브러리가 아니다.** Headless는 스타일 없는 순수 로직을 가리키는 설계 개념이다. `@headlessui/react` 라이브러리와는 별개고, Radix·Downshift도 이 패턴으로 만든 것이다.

예를 들어 "카테고리 Select가 데스크톱에선 드롭다운, 모바일에선 바텀시트여야 한다"는 요구. 동작은 같고 UI만 다르다 — 로직을 훅에 담고 UI를 사용처에 넘긴다.

```tsx
// 로직'만' 담은 훅 — 열림 / 선택 / 키보드 탐색. JSX는 없다.
function useSelect<T extends { id: string; label: string }>(items: T[]) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<T | null>(null);
  const [highlight, setHighlight] = useState(-1);

  const select = (item: T) => {
    setSelected(item);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setHighlight((i) => Math.min(i + 1, items.length - 1));
    if (e.key === "ArrowUp") setHighlight((i) => Math.max(i - 1, 0));
    if (e.key === "Enter" && highlight >= 0) select(items[highlight]);
    if (e.key === "Escape") setOpen(false);
  };

  return { open, selected, highlight, items, toggle: () => setOpen((o) => !o), select, onKeyDown };
}
```

```tsx
// 같은 useSelect, 다른 UI — '어떻게 보일지'를 사용처가 정한다
function CategoryDropdown() {
  const s = useSelect(categories); // 데스크톱: 드롭다운
  return (
    <div onKeyDown={s.onKeyDown}>
      <button onClick={s.toggle}>{s.selected?.label ?? "카테고리"}</button>
      {s.open && (
        <ul>
          {s.items.map((c) => (
            <li key={c.id} onClick={() => s.select(c)}>{c.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategorySheet() {
  const s = useSelect(categories); // 모바일: 바텀시트 — '똑같은' 훅을 재사용
  return (
    <>
      <button onClick={s.toggle}>{s.selected?.label ?? "카테고리"}</button>
      <BottomSheet open={s.open} onClose={s.toggle}>
        {s.items.map((c) => (
          <SheetItem key={c.id} onClick={() => s.select(c)}>{c.label}</SheetItem>
        ))}
      </BottomSheet>
    </>
  );
}
```

로직은 하나, UI는 둘. 디자인 요구가 바뀌어도 로직은 두고 UI만 새로 그린다. 이 훅은 [`hook-design.md`](./hook-design.md)의 Custom Hook — 호출한 곳마다 독립 state 인스턴스를 가진다(§6). UI를 공유하려는 게 아니라 로직을 재사용하려는 것이다.

## Compound — 구조를 사용처가 조립

하위 컴포넌트들이 부모 상태를 **Context로 암시적으로 공유**하고, 사용처는 **구조만 조립**하는 패턴이다. HTML의 `<select>`+`<option>`, `<table>`+`<tr>` 관계와 같다.

`<Tabs>`가 activeTab을 알고, 버튼이 그걸 바꾸고, 멀리 떨어진 내용이 반응해야 한다. props로 하면 사용처가 `active`·`onActiveChange`를 버튼·내용마다 일일이 배선한다 — 상태 연결은 부모가 Context로 숨기고, 구조는 사용처가 조립하게 한다.

```tsx
// 사용처는 '구조'만 조립한다 — 순서·구성이 자유롭다
<Tabs defaultValue="home">
  <Tabs.List>
    <Tabs.Trigger value="home">홈</Tabs.Trigger>
    <Tabs.Trigger value="deal">특가</Tabs.Trigger>
  </Tabs.List>

  <PromotionBanner /> {/* Tabs 내부를 안 건드리고 사이에 끼운다 */}

  <Tabs.Content value="home"><Feed type="home" /></Tabs.Content>
  <Tabs.Content value="deal"><Feed type="deal" /></Tabs.Content>
</Tabs>
// Trigger를 누르면 '떨어져 있는' Content가 반응한다 → 형제끼리 상태를 안다
```

```tsx
"use client"; // 상태·Context·이벤트 → 클라이언트 컴포넌트

// 1) Context + 오용을 막는 안전한 훅
const TabsContext = createContext<TabsContextValue | null>(null);
function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("<Tabs> 안에서만 쓸 수 있어요"); // 밖에서 쓰면 런타임에 바로 잡힌다
  return ctx;
}

// 2) 부모 — 상태를 소유하고 Context로 암시적 공유
export function Tabs({ defaultValue, children }: TabsProps) {
  const [active, setActive] = useState(defaultValue);
  return <TabsContext.Provider value={{ active, setActive }}>{children}</TabsContext.Provider>;
}

// 3) 자식 — props 없이 Context에서 상태를 읽는다
function Trigger({ value, children }: TriggerProps) {
  const { active, setActive } = useTabsContext();
  return <button data-active={active === value} onClick={() => setActive(value)}>{children}</button>;
}
function Content({ value, children }: ContentProps) {
  const { active } = useTabsContext();
  return active === value ? <div>{children}</div> : null;
}

// 4) 점(dot) 표기로 하나의 컴포넌트처럼 묶는다
Tabs.List = List;
Tabs.Trigger = Trigger;
Tabs.Content = Content;
```

이것은 [`props-contract.md`](./props-contract.md#children-합성의-감각)의 `children` 합성에 **Context 상태 공유**를 더한 것이다. `<Card><Card.Image/></Card>`는 서로의 상태를 모르지만, `<Tabs>`는 activeTab을 형제끼리 나눠 갖는다. Context를 서브트리 상태 공유에 쓰는 판단은 [`context-and-state.md`](./context-and-state.md)에 있다.

| ✅ Compound가 맞다              | ❌ 그냥 props가 낫다        |
| ------------------------------- | --------------------------- |
| 하위끼리 **암시적 상태 공유**   | 상태 공유 없이 단순 렌더링  |
| 사용처가 **구조를 자유롭게** 바꿈 | 구조가 항상 고정            |
| Tabs · Accordion · Dialog · Menu | Button · Badge · Avatar     |

Dialog처럼 Compound와 상태 소유권을 함께 여는 컴포넌트는 `open`을 Controlled/Uncontrolled 이중 API로 받아 Context로 자식에게 내린다 — 이중 API 설계는 [`props-contract.md`](./props-contract.md#controlled-vs-uncontrolled)에 있다.

## Provider vs Singleton — 전역 컴포넌트의 상태 위치

트리 어디서든 `toast('담았어요')` 한 줄로 부르는 전역 컴포넌트. 핵심 질문은 **이 상태를 어디에 두나** — React 트리 안(**Provider**)이냐, 밖(**Singleton**)이냐. 화면 구석에 고정하는 건 **Portal**이나 인라인 `position: fixed`가 맡는다.

```tsx
// A · Context + Provider + Portal — 직접 만들 때
"use client";
const ToastContext = createContext<{ toast: (msg: string) => void } | null>(null);
export const useToast = () => useContext(ToastContext)!;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // 서버엔 document가 없다 → portal은 mount 후에만
  const toast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="toast-viewport">{toasts.map((t) => <div key={t.id}>{t.message}</div>)}</div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
// 호출: 트리 어디서든, 단 컴포넌트 '안'에서 —  const { toast } = useToast()
```

A방식은 `toast`가 훅이라 **컴포넌트 렌더링 중에만** 부를 수 있다. API 인터셉터 같은 비-React 코드에서도 부르려면 상태를 React 밖(모듈 싱글톤)에 둬야 한다. react-hot-toast가 `<Provider>` 없이 도는 비결이다.

```tsx
// B · 외부 store 싱글톤 — react-hot-toast·sonner가 고르는 상태 위치. store→React 연결은 useSyncExternalStore(React 18 정공법)로
let toasts: Toast[] = []; // store: React '밖' 모듈 싱글톤
const listeners = new Set<() => void>();

// toast()는 훅이 아니라 그냥 함수 → 어디서든 import해서 호출 (비-React 코드 포함)
export function toast(message: string) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, message }];
  listeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    listeners.forEach((l) => l());
  }, 3000);
}

export function Toaster() {
  // 외부 store를 '구독' — 동시성 렌더링에서도 tearing 없이
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => [], // server snapshot: 서버엔 토스트가 없다. 빠뜨리면 SSR에서 "Missing getServerSnapshot" 크래시
  );
  // 라이브러리처럼 portal 대신 인라인 position:fixed(.toast-viewport) — 서버에 document 접근이 없어 SSR-safe
  return <div className="toast-viewport">{snapshot.map((t) => <div key={t.id}>{t.message}</div>)}</div>;
}
```

> 🪟 **Portal과 SSR** — 그 자리에 렌더하면 부모의 `overflow: hidden`·`z-index`에 갇히니 `createPortal(node, document.body)`으로 `body` 아래로 빼낸다(Sample A). 단 App Router의 `"use client"` 컴포넌트도 서버에서 먼저 렌더되고 서버엔 `document`가 없어, portal은 mount 이후로 미뤄야 한다(위 `mounted` 가드). react-hot-toast·sonner는 이 복잡도를 **portal 없이 인라인 `position: fixed`**로 통째로 피한다(Sample B). 진짜 부모 밖으로 나가야 하는 Dialog·Dropdown·Tooltip에서만 그 mount 가드(또는 Radix 등 라이브러리)가 필요하다.

|             | A · Context + Provider   | B · 외부 store 싱글톤       |
| ----------- | ------------------------ | --------------------------- |
| 호출 위치   | React 컴포넌트 안에서만  | **어디서든** (비-React 포함) |
| 스코프      | 서브트리별 분리 가능     | 전역 하나                   |
| SSR         | 요청별 격리 안전         | 모듈 공유 (주의)            |
| 대표        | 직접 만들 때             | react-hot-toast · sonner    |

`Singleton`은 "상태를 어디 두나"라는 아키텍처, `useSyncExternalStore`는 그 외부 store를 React에 다시 붙이는 도구다. 두 라이브러리는 실제론 아직 `useState`+`useEffect`로 구독하지만, react-hot-toast 소스엔 `useSyncExternalStore`로 이전하겠다는 TODO가 있다 — 이 API가 그 자리를 채우는 정공법이다.

## 패턴 선택 가이드

| 상황                                          | 패턴                        |
| --------------------------------------------- | --------------------------- |
| 같은 로직인데 **UI가 완전히 다른 곳**이 2곳 이상 | **Headless**                |
| props가 늘고, 사용처가 **구조**를 바꾸고 싶다  | **Compound**                |
| `open`/`value`를 **안에서도 밖에서도** 다뤄야   | **Controlled/Uncontrolled** |
| **어디서든 소환**해야 (알림·확인창)            | **Provider vs Singleton**   |
| 단순 UI, props 3개 이하                        | **그냥 props** (패턴 없음)   |

> 🔨 **망치를 들면 다 못으로 보인다.** 패턴은 유연성을 얻는 대신 복잡도를 낸다. 기준은 언제나 **"이걸 쓰면 사용처 코드가 더 단순해지나?"** Button·Badge에 Compound를 붙이면 오히려 쓰기만 불편해진다. 공통화 자체의 도입 시점(YAGNI·rule of three)은 [`props-contract.md`](./props-contract.md#도입-시점--yagni)·[`component-boundary.md`](./component-boundary.md)에 있다.

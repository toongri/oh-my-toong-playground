# Context 전환 — Drilling을 언제 끊나

> `.claude/rules/component-design.md`가 가리키는 근거 문서. **Props Drilling을 유지할지 Context로 넘길지** 판단할 때 읽는다.
>
> 전제: Props Drilling은 흐름을 추적할 수 있는 **가장 단순한 방법**이다 — 무조건 나쁘지 않다.
>
> 컴포넌트 경계는 [`component-boundary.md`](./component-boundary.md), Props·합성 계약은 [`props-contract.md`](./props-contract.md)에 있다. 상태를 **어디에 둘지**(서버/UI/URL/전역)의 분류는 [`react.md`](../../.claude/rules/react.md).

## Props Drilling vs Context

Props Drilling은 데이터 흐름을 추적할 수 있는 **가장 단순한 방법** — 무조건 나쁘지 않다. 핵심은 언제 Context로 전환하는가다.

| 상황                                 | 판단       | 이유                                   |
| ------------------------------------ | ---------- | -------------------------------------- |
| 2단계 전달(부모→자식→손자)           | ✅ 유지    | 흐름이 명확하고 추적 가능              |
| 3단계 이상 + 중간이 그 Props를 안 씀 | ⚠️ 검토    | 중간 컴포넌트가 불필요한 의존성을 가짐 |
| 여러 트리에서 동일 상태 공유         | ❌ Context | 트리 구조상 전달이 불가능하거나 비효율 |

```tsx
// ❌ 4단계 전달 — 중간 Layout·ProductSection은 category를 쓰지 않고 넘기기만 한다
function App() {
  const [category, setCategory] = useState("all");
  return <Layout category={category} onCategoryChange={setCategory} />;
}
function Layout({ category, onCategoryChange }) {
  return <ProductSection category={category} onCategoryChange={onCategoryChange} />; // 전달만
}
// ProductSection도 동일하게 전달만 — category 타입이 바뀌면 쓰지도 않는 중간 컴포넌트 전체 수정 필요

// ✅ Context — 중간 컴포넌트는 category를 모른다
const CategoryContext = createContext<{
  category: string;
  setCategory: (c: string) => void;
} | null>(null);

function App() {
  const [category, setCategory] = useState("all");
  return (
    <CategoryContext.Provider value={{ category, setCategory }}>
      <Layout />
    </CategoryContext.Provider>
  );
}
function Layout() {
  return <ProductSection />;
} // 전달 안 함
function FilterBar() {
  const { category, setCategory } = useCategoryContext();
  return (
    <select value={category} onChange={(e) => setCategory(e.target.value)}>
      ...
    </select>
  );
}
```

Context는 앱 전역 스토어 대용이 아니라 **서브트리 단위 상태 공유** 도구다. 다음 셋에서 고려한다.

1. **Props Drilling 해소** — 중간 컴포넌트들이 데이터를 쓰지 않고 전달만 할 때
2. **서브트리 상태 공유** — 특정 계층 아래 여러 컴포넌트가 같은 상태를 공유할 때(Tabs, Form)
3. **테마/언어 설정** — 거의 변하지 않는 전역 값

자주 바뀌는 값과 드물게 바뀌는 값을 한 Context에 넣지 않는다 — Context 값이 바뀌면 구독 하위 전체가 리렌더된다.

```tsx
// ❌ 드물게 바뀌는 theme과 타이핑마다 바뀌는 inputValue가 한 Context에
const AppContext = createContext({ theme: "light", inputValue: "" });
// inputValue가 바뀔 때마다 theme만 쓰는 컴포넌트까지 전부 리렌더된다.

// ✅ 변경 빈도로 Context를 쪼갠다
const ThemeContext = createContext({ theme: "light" });
const SearchContext = createContext({ inputValue: "" });
```


# Props·합성 계약 — 무엇을 어떻게 넘길까

> `.claude/rules/component-design.md`가 가리키는 근거 문서. **공통 컴포넌트의 인터페이스를 설계할 때**(Props 모양·값의 주인·합성 방식) 읽는다. 각 판단의 "왜"를 Before/After로 보여준다.
>
> 전제: 좋은 공통 컴포넌트는 기능을 많이 넣는 게 아니라 **결정을 사용처에 넘긴다**(Inversion of Control).
>
> 컴포넌트를 어디서 자를지는 [`component-boundary.md`](./component-boundary.md), Context 전환 판단은 [`context-and-state.md`](./context-and-state.md)에 있다.

## Props는 적을수록 좋다

Props가 많아지면 사용하는 쪽에서 "어떤 조합이 유효한지" 읽어낼 수 없다. Props를 늘리는 대신 `children`으로 합성한다. 구체적인 Before/After는 아래 [children 합성의 감각](#children-합성의-감각) 예시를 참고한다.

| Props 수 | 판단      | 대응                                |
| -------- | --------- | ----------------------------------- |
| 1~3개    | ✅ 깔끔   | 유지                                |
| 4~5개    | ⚠️ 주의   | 관련 Props를 객체로 그룹화 검토     |
| 6개 이상 | ❌ 재설계 | Composition 패턴 또는 컴포넌트 분리 |

절대 기준은 아니다. HTML 속성을 그대로 넘기는 래퍼(`ComponentPropsWithoutRef` 확장)처럼, 개수가 많아도 의미가 한 묶음이면 괜찮다. 기준이 잡으려는 건 "**서로 무관한 제어 손잡이가 흩어져 조합 규칙이 사라지는**" 상태다.

## Props 네이밍

| 접두사    | 의미                    | 예시                          |
| --------- | ----------------------- | ----------------------------- |
| `onX`     | 외부에서 주입받는 콜백  | `onSearch`, `onClear`         |
| `handleX` | 이 컴포넌트가 직접 처리 | `handleSubmit`, `handleClick` |

### boolean Props는 긍정형 + `is` 접두

```tsx
<Button notDisabled={false} />  // ❌ 이중 부정 — "비활성화가 아닌 게 거짓"?
<Button disabled={true} />      // ✅ 긍정형

<Modal show={true} />           // ❌ show? visible? 컨벤션이 흔들린다
<Modal isOpen={true} />         // ✅ is + 형용사로 통일
```

## Controlled vs Uncontrolled

값의 주인이 **부모**인지 **컴포넌트 자신**인지를 먼저 정한다. 이 선택이 Props 모양(`value` vs `defaultValue`)을 결정한다.

|             | Controlled                             | Uncontrolled                             |
| ----------- | -------------------------------------- | ---------------------------------------- |
| 상태 위치   | 부모가 `value`·`onChange`로 제어       | 컴포넌트 내부에서 자체 관리              |
| 초기값      | `value` prop                           | `defaultValue` prop                      |
| 값 접근     | 부모 state에서 직접                    | `ref`로 접근                             |
| 적합한 경우 | 폼 검증, 실시간 미리보기, 입력 간 연동 | 단순 입력, 파일 업로드, 성능이 중요할 때 |

```tsx
// Controlled — 타이핑마다 값이 필요할 때(실시간 미리보기·연동)
function SearchWithPreview() {
  const [query, setQuery] = useState("");
  return (
    <div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} />
      <p>검색 중: "{query}"</p>
      <SearchResults query={query} />
    </div>
  );
}

// Uncontrolled — 제출할 때만 값이 필요할 때
function SimpleLoginForm() {
  const emailRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (emailRef.current) login(emailRef.current.value);
  };
  return (
    <form onSubmit={handleSubmit}>
      <input ref={emailRef} defaultValue="" placeholder="이메일" />
      <button type="submit">로그인</button>
    </form>
  );
}
```

```tsx
// value가 있으면 Controlled, 없으면 Uncontrolled로 분기한다
interface InputProps {
  value?: string; // Controlled
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  defaultValue?: string; // Uncontrolled
}

function Input({ value, onChange, defaultValue, ...rest }: InputProps) {
  return value !== undefined ? (
    <input value={value} onChange={onChange} {...rest} />
  ) : (
    <input defaultValue={defaultValue} {...rest} />
  );
}
```

## 공통 컴포넌트 설계

### 도입 시점 — YAGNI

"나중에 쓸 것 같아서" 미리 만들지 않는다. 예측은 대부분 틀린다.

| 상황                            | 판단      | 이유                        |
| ------------------------------- | --------- | --------------------------- |
| 같은 UI가 3곳 이상에서 반복     | ✅ 공통화 | 중복 제거 효과가 명확       |
| 2곳이지만 확장이 확실           | ✅ 공통화 | 지금 만들면 확장 비용 절감  |
| 1곳뿐인데 "나중에 쓸 것 같아서" | ❌ 안 함  | 예측은 대부분 틀린다(YAGNI) |

### 3가지 원칙

**1. 비즈니스 로직을 포함하지 않는다.** 비즈니스 판단은 사용하는 쪽에서 한다.

```tsx
// ❌ 공통 컴포넌트에 도메인 판단(stock·status)이 섞임
function ProductButton({ product }: { product: Product }) {
  const isAvailable = product.stock > 0 && product.status === 'active'
  return <button disabled={!isAvailable}>{product.name} 구매</button>
}

// ✅ 공통 컴포넌트는 UI만. 판단은 사용처에서
function Button({ disabled, children, ...props }: ButtonProps) {
  return <button disabled={disabled} {...props}>{children}</button>
}
const isAvailable = product.stock > 0 && product.status === 'active'
<Button disabled={!isAvailable}>{product.name} 구매</Button>
```

**2. 도메인 용어를 이름에 쓰지 않는다.** 이름에 도메인이 박히면 그 맥락에서만 쓸 수 있다.

```
ProductButton    ❌  // "상품 구매" 맥락 전용
OrderSubmitForm  ❌  // "주문" 맥락 전용
Button / Form    ✅  // 어디서든 쓸 수 있다
```

**3. `variant`/`size`로 외양을 제어한다.** Props에 JSDoc(`/** */`)을 달면 IDE 자동완성에 설명이 떠 별도 문서 없이도 용도를 안다.

```tsx
interface ButtonProps {
  /** 버튼 스타일 변형 */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** 버튼 크기 */
  size?: "sm" | "md" | "lg";
  /** 로딩 상태 — true일 때 스피너 표시, 클릭 비활성화 */
  loading?: boolean;
  children: React.ReactNode;
}
```

### 스타일 확장은 prop 말고 className 위임

스타일 미세조정마다 prop을 새로 파면 공통 컴포넌트가 끝없이 부푼다 — 외양 확장은 **`className`을 받아 사용처에 위임**한다.

```tsx
// ❌ 디자인 요청 하나 = prop 하나 → Button이 끝없이 부푼다
<Button fullWidth rounded shadow uppercase marginTop />;

// ✅ className을 받아 자체 클래스와 병합 — 사용처에서만 조정
interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: "primary" | "secondary" | "ghost";
}
function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  // lazy: 문자열 병합으로 충분 — 클래스 충돌·우선순위가 잦아지면 clsx + tailwind-merge 도입
  return <button className={`btn btn--${variant} ${className ?? ""}`} {...rest} />;
}

<Button variant="primary" className="checkout-cta" />; // 이 한 곳만, Button은 그대로
```

원칙은 "**더 많은 prop**" 대신 "**더 열린 확장 지점**" — 확장을 사용처에 위임하면 공통 컴포넌트가 부풀지 않는다.

### children 합성의 감각

Props가 늘어날 때의 대안은 `children`에 JSX를 넘겨받는 합성이다. 변형이 늘어도 컴포넌트를 수정하지 않고 사용처에서 조립한다.

```tsx
// ❌ Props로 전부 제어 — 변형이 늘 때마다 Props도 는다
<Card title="원목 스탠드 조명" price={45000} badge="신상품"
  showLikeButton likeCount={128} showReviewCount reviewCount={42} imageHeight={200} />
// showShareButton도 추가? → Props +2개...

// ✅ Composition — 사용처에서 필요한 것만 조립
<Card>
  <Card.Image src="/lamp.jpg" alt="원목 스탠드 조명" height={200} />
  <Card.Body>
    <Card.Badge>신상품</Card.Badge>
    <Card.Title>원목 스탠드 조명</Card.Title>
    <Card.Price value={45000} />
  </Card.Body>
  <Card.Footer>
    <LikeButton count={128} />
    <ReviewCount count={42} />
  </Card.Footer>
</Card>
// ShareButton이 필요하면 Card.Footer에 추가한다 — Card는 손대지 않는다.
```

기존 컴포넌트를 수정하지 않고 확장하는 것이 핵심 — Context 기반 Compound Component(`<Tabs><Tabs.Trigger/></Tabs>`)는 이 감각의 확장이다.

### children vs slot

`children`은 구멍이 하나일 때다. **이름 붙은 자리가 여럿이고 순서 고정**이면 각 자리를 element prop으로 받는 **slot**이 더 안전하다(React는 네이티브 slot이 없어 prop으로 구현).

```tsx
// children 하나로 충분 — 자유롭게 채운다
<Dialog>
  <p>정말 삭제할까요?</p>
</Dialog>;

// 자리가 여럿이고 순서가 고정 → slot(이름 있는 element props)
<Dialog
  title={<h2>판매 종료</h2>}
  footer={
    <>
      <Button variant="ghost">취소</Button>
      <Button variant="danger">종료</Button>
    </>
  }
>
  이 글을 끌올할 수 없게 됩니다.
</Dialog>;
```

`children`은 자유, slot은 구조다 — "footer가 header 위로 가면 안 되는" UI엔 slot으로 자리를 고정하고, 상태까지 암시적으로 공유해야 하면 Context 기반 Compound Component로 넘어간다.

## TypeScript Props — 고급 패턴

### 조건부 Props는 Discriminated Union으로

"`variant`가 `'icon'`일 때만 `icon`이 필수" 같은 조건은 타입으로 강제한다 — 전부 optional은 잘못된 조합을 막지 못한다.

```tsx
// ❌ 전부 optional — 잘못된 조합을 컴파일 타임에 못 막는다
interface ButtonProps {
  variant: 'text' | 'icon'
  label?: string   // text일 땐 필수인데 optional
  icon?: ReactNode // icon일 땐 필수인데 optional
}

// ✅ Discriminated Union — 잘못된 조합이 컴파일 에러가 된다
type ButtonProps =
  | { variant: 'text'; label: string; icon?: never }
  | { variant: 'icon'; icon: ReactNode; label?: never }

<Button variant="text" label="확인" />   // ✅
<Button variant="icon" icon={<X />} />   // ✅
<Button variant="text" icon={<X />} />   // ❌ 컴파일 에러
<Button variant="icon" />                // ❌ icon 누락 에러
```

> discriminated union의 기본기(optional 자루 대신 태그 유니온, `switch`의 `never` 처리)는 [`typescript.md`](../../.claude/rules/typescript.md)에 있다. 위는 그것을 Props에 적용한 형태다.

### HTML 속성 확장은 `ComponentPropsWithoutRef`

`<button>`의 모든 HTML 속성(`type`, `aria-label` 등)을 그대로 받으려면 손으로 나열하지 말고 확장한다.

```tsx
interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

function Button({ variant = "primary", loading, children, ...rest }: ButtonProps) {
  return (
    <button disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner /> : children}
    </button>
  );
}

<Button type="submit" aria-label="주문하기" variant="primary">
  주문
</Button>;
```

## 참고: Atomic Design

> 설계 어휘로 알아두되 레이어 강제는 맹신하지 않는다. 분류 기준이 모호해 "Atom인가 Molecule인가" 논쟁으로 시간을 쓰기 쉽고, 레이어가 많아 복잡해질 수 있다(Atoms→Molecules→Organisms→Templates/Pages).

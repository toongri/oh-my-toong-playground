# 컴포넌트 경계 — 어디서 자를까

컴포넌트는 **"재사용 가능하게" 만들기 전에 "읽기 쉽게"** 만드는 것이 먼저다.

Props·합성 계약(무엇을 어떻게 넘길까)은 [`props-contract.md`](./props-contract.md), Context 전환 판단은 [`context-and-state.md`](./context-and-state.md)에 있다.


Props를 어떻게 설계할지(계약)는 그다음 문제다. 먼저 **무엇을 한 컴포넌트로 볼지**를 정한다. 나누는 기준은 "크기"가 아니라 **"무엇이 함께 바뀌는가"**다.

### 변경 이유로 경계 긋기

좋은 경계는 **변경의 경계**다. 한 컴포넌트가 서로 다른 이유로 바뀐다면, 그 이유의 수만큼 잘릴 후보다. 단일 책임을 "기능 1개"가 아니라 "**변경 이유(reason to change) 1개**"로 읽는다.

```tsx
// ❌ 세 변경 이유(가격 정책 / 추천 / 채팅)가 한 파일에 엉켜 있다
function ProductPage({ product }: { product: Product }) {
  const priceLabel = product.isAuction
    ? `최고가 ${format(product.bidPrice)}` // (A) 가격 표기 정책이 바뀌면 여기
    : format(product.price);
  const related = product.tags
    .flatMap((tag) => findByTag(tag)) // (B) 추천 알고리즘이 바뀌면 여기
    .filter((p) => p.id !== product.id)
    .slice(0, 6);
  return (
    <div>
      <h1>{product.title}</h1>
      <strong>{priceLabel}</strong>
      <RelatedGrid items={related} />
      <button onClick={() => openChat(product.sellerId)}>채팅하기</button> {/* (C) 채팅 정책 */}
    </div>
  );
}

// ✅ 경계 = 변경의 경계. 가격이 바뀌면 ProductHeader만, 추천이 바뀌면 RelatedProducts만 연다
function ProductPage({ product }: { product: Product }) {
  return (
    <div>
      <ProductHeader product={product} />
      <RelatedProducts product={product} />
      <ChatCta sellerId={product.sellerId} />
    </div>
  );
}
```

분리의 효과는 "재사용"이 아니라 **"수정할 때 열어야 할 파일 수"**로 잰다 — "이 컴포넌트는 누구 때문에, 며칠에 한 번 바뀌나?"를 물으면 자를 축이 보인다.

### 구현 vs 조합을 섞지 말기

한 컴포넌트는 **직접 구현하는 것**이거나 **여러 컴포넌트를 조합하는 것**이어야 한다. 둘을 한 파일에 섞으면 읽는 사람이 추상화 고도를 계속 오르내려야 한다. 조합 컴포넌트는 화면의 "목차", 구현 컴포넌트는 "본문"이다 — 목차에 본문 문장이 끼면 안 된다.

```tsx
// ❌ 조합을 하다가 갑자기 카드 '내부 구현'이 통째로 인라인 — 고도가 섞인다
function FeedList({ posts }: { posts: Post[] }) {
  return (
    <ul>
      <FeedHeader />
      {posts.map((post) => (
        <li key={post.id}>
          <article className="card">
            <img src={post.thumbnail} alt="" />
            <h3>{post.title}</h3>
            <p>
              {post.region} · {timeAgo(post.createdAt)}
            </p>
          </article>
        </li>
      ))}
      <FeedFooter />
    </ul>
  );
}

// ✅ 구현은 아래로 위임 — FeedList는 화면의 '목차'로만 읽힌다
function FeedList({ posts }: { posts: Post[] }) {
  return (
    <ul>
      <FeedHeader />
      {posts.map((post) => (
        <li key={post.id}>
          <FeedCard post={post} />
        </li>
      ))}
      <FeedFooter />
    </ul>
  );
}
```

### 무관한 상태는 추출 신호

거대 컴포넌트(God Component)의 첫째 신호: **한 컴포넌트가 서로 무관한 상태를 함께 들고 있다**(예: 목록 정렬 상태 + 모달 열림 상태).

```tsx
// ❌ ProductSection이 섹션과 무관한 '모달 열림' 상태를 들고 있다
function ProductSection({ products }: { products: Product[] }) {
  const [showShortcutModal, setShowShortcutModal] = useState(false); // ← 이질적
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  // ...수백 줄
}

// ✅ 무관한 상태는 그 상태를 쓰는 UI와 함께 떼어낸다
function ProductSection({ products }: { products: Product[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  return (
    <>
      <SortableProductGrid products={products} sortBy={sortBy} onSort={setSortBy} />
      <ShortcutModalButton /> {/* showShortcutModal는 여기로 이사 */}
    </>
  );
}
```

상태를 보면 경계가 보인다. 상태를 **어디에 둘지**의 판단은 [`react.md`](../../.claude/rules/react.md)에 있다.

### 중복 > 잘못된 추상화

자르는 것보다 **아직 자르지 않는 것**이 더 어렵다. 비슷해 보인다고 성급히 합치면, 추상화가 곧 `if`문 더미가 된다.

```tsx
// ❌ 상품 카드와 모임 카드가 '비슷해 보여서' 하나로 합침 → 타입마다 if가 늘어난다
function Card({ type, title, price, host, memberCount, thumbnail, isAuction, region }: CardProps) {
  return (
    <div>
      <img src={thumbnail} alt="" />
      <h3>{title}</h3>
      {type === "product" && <strong>{isAuction ? "경매" : price}</strong>}
      {type === "group" && (
        <span>
          {host} · {memberCount}명
        </span>
      )}
      {type === "product" && <small>{region}</small>}
      {/* 새 타입이 생길 때마다 if가 늘어남 → "앱 전체가 if문 안에" */}
    </div>
  );
}

// ✅ 공통은 '진짜 같은 것'(껍데기)만, 도메인 차이는 각자 구현 — 중복을 허용한다
function CardShell({ thumbnail, title, children }: CardShellProps) {
  return (
    <div className="card">
      <img src={thumbnail} alt="" />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <CardShell thumbnail={product.thumbnail} title={product.title}>
      <strong>{product.isAuction ? "경매" : format(product.price)}</strong>
      <small>{product.region}</small>
    </CardShell>
  );
}

function GroupCard({ group }: { group: Group }) {
  return (
    <CardShell thumbnail={group.thumbnail} title={group.title}>
      <span>
        {group.host} · {group.memberCount}명
      </span>
    </CardShell>
  );
}
```

> "prefer duplication over the wrong abstraction." — 잘못된 추상화는 중복보다 비싸다.

추상화는 규칙이 아니라 "feels right"일 때 한다. **세 번째 중복**에서 공통점이 또렷해지면 그때 뽑는다(rule of three). "언제 공통화할지"의 구체 기준은 아래 [공통 컴포넌트 설계 → 도입 시점](./props-contract.md#도입-시점--yagni) 표에 있다.


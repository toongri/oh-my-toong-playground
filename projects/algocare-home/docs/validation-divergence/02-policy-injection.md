# 패턴 2 — 정책 객체 주입 + resolver

> 케이스가 3개 이상으로 번질 게 **명확할 때**. [패턴 1](./01-method-split.md)의 메서드 분리가 조합 폭발로 무너지기 시작하는 지점의 대안.

## 한 줄 요약

검증 정책을 코드 분기가 아니라 **하나의 값(정책 객체)**으로 만든다. "누구에게 어떤 정책을 적용할지 결정(resolve)"하는 책임을 별도로 두고, 그 resolver가 정책을 골라 **하나의 public 실행 함수에 인자로 넘긴다.** 실행 함수는 넘어온 정책을 실행할 뿐, 누가 호출자인지 모른다.

## 언제

- 검증이 갈리는 케이스가 **3개 이상**이거나, 그렇게 번질 게 명확할 때(고객 / admin / CS / 파트너 / 배치 …).
- 패턴 1로 두면 `cancelByCustomer/Admin/CsAgent/Partner...`처럼 메서드가 늘고, 대부분이 공유부 90% + 게이트 한 줄 차이라 눈으로 대조해야 하는 상황.
- 각 정책이 **독립적으로 진화**할 수 있을 때(한쪽 정책만 바뀌는 일이 잦다).

**아직 케이스가 2개뿐이라면 이 패턴은 과하다.** 인터페이스 하나에 구현 둘은 순수 비용이다(rule of three: 세 번째가 오기 전엔 추상화를 만들지 않는다). 2개면 [패턴 1](./01-method-split.md)이 항상 더 싸다.

## 왜 — 두 개의 책임을 나눈다

이 패턴의 핵심은 **책임 분리**다. 세 조각이 각자 하나씩만 안다.

1. **정책 객체** — "무엇이 허용되는가"만 안다. 실행도, 누가 부르는지도 모른다.
2. **resolver** — "이 호출자에게 어떤 정책을 줄까"만 안다. 실행 로직은 모른다.
3. **실행 함수** — "정책을 통과하면 무엇을 하는가"만 안다. 정책 내용도, 호출자도 모른다.

패턴 1과의 결정적 차이는 **분기가 열려 있다**는 것이다. 패턴 1은 검증 로직이 함수 안에 `if`로 나열돼 닫혀 있다(내가 모든 케이스를 안다). 패턴 2는 정책이 객체로 빠져나와, 새 케이스 = 새 정책 객체 하나 추가로 끝난다(함수를 안 건드림). "케이스가 늘어날 것이고 어쩌면 다른 모듈이 추가할 것"이라는 전제가 있을 때 이 열린 확장점이 값을 한다.

## 어떻게 — 예시

### 정책 객체

```ts
interface CancelPolicy {
  readonly name: string
  /** 통과하면 아무 일 없음, 위반이면 throw */
  assert(order: OrderRow, now: Date): void
}

const CustomerCancelPolicy: CancelPolicy = {
  name: 'customer',
  assert(order) {
    if (order.orderStatus !== OrderStatus.CONFIRMED)
      throw new OrderNotCancellableError(order.id, order.orderStatus)
  },
}

const AdminCancelPolicy: CancelPolicy = {
  name: 'admin',
  assert(order) {
    if (!ADMIN_CANCELLABLE_STATUSES.includes(order.orderStatus))
      throw new OrderNotCancellableError(order.id, order.orderStatus)
  },
}

const CsAgentCancelPolicy: CancelPolicy = {
  name: 'cs-agent',
  assert(order, now) {
    if (!CS_CANCELLABLE_STATUSES.includes(order.orderStatus))
      throw new OrderNotCancellableError(order.id, order.orderStatus)
    if (isPastCsWindow(order, now))                      // CS만의 추가 규칙
      throw new CsCancelWindowExpiredError(order.id)
  },
}
```

### resolver — 정책을 결정하는 책임

```ts
// "이 호출 맥락에 어떤 정책을 적용할지"만 결정. 실행 로직은 전혀 모른다.
function resolveCancelPolicy(actor: CancelActor): CancelPolicy {
  switch (actor.kind) {
    case 'customer': return CustomerCancelPolicy
    case 'admin':    return AdminCancelPolicy
    case 'cs-agent': return CsAgentCancelPolicy
    // 새 케이스는 여기 한 줄 + 정책 객체 하나. 실행 함수는 안 건드린다.
  }
}
```

### 서비스 — resolve와 실행 코어를 모두 소유한다

resolve(정책 결정)와 실행 코어는 **둘 다 서비스 안에** 산다. 라우터는 이름만 부른다.

```ts
export class OrderCancelService {
  // 얇은 진입 메서드 — 자기 정책을 resolve해서 코어에 넘긴다.
  // 정책을 아는 건 라우터가 아니라 여기(서비스)다.
  static cancelByCustomer(orderId: string, userId: string): Promise<void> {
    return this.cancel(orderId, userId, resolveCancelPolicy({ kind: 'customer' }))
  }
  static cancelByAdmin(orderId: string, userId: string, reason: string): Promise<void> {
    return this.cancel(orderId, userId, resolveCancelPolicy({ kind: 'admin' }), reason)
  }

  /** 정책을 주입받는 실행 코어 — private. 정책 내용도, 호출자도 모른다. */
  private static async cancel(orderId: string, userId: string, policy: CancelPolicy, reason?: string, now = new Date()): Promise<void> {
    const order = await this.loadOwnedOrder(orderId, userId)   // 불변식: 소유권
    policy.assert(order, now)                                   // 정책: 주입된 것
    if (order.orderStatus === OrderStatus.CANCELLED) return     // 불변식: 멱등
    const pgCancel = await PaymentCancelService.cancelByOrderId(order.id, order, reason ?? DEFAULT_REASON)
    await this.reverseInTx({ orderId: order.id, userId, pgCancel })
  }
}
```

### 진입점 — 라우터는 이름만 부른다

라우터에는 resolve도, 정책도, 분기도 없다. 자기 진입 메서드 하나를 호출할 뿐이다.

```ts
// order.router.ts (고객)
cancel: userProcedure
  .input(z.object({ orderId: z.string().uuid() }))
  .mutation(({ ctx, input }) =>
    OrderCancelService.cancelByCustomer(input.orderId, ctx.user.id))

// order-admin.router.ts (admin)
cancel: adminProcedure
  .use(withPermission(ORDERS_UPDATE))                          // 인가는 앞단
  .input(z.object({ orderId: z.string().uuid(), userId: z.string().uuid(), reason: z.string() }))
  .mutation(({ input }) =>
    OrderCancelService.cancelByAdmin(input.orderId, input.userId, input.reason))
```

## resolver는 서비스에 둔다

**resolve(정책 결정)는 서비스의 책임이다. 라우터에 두지 않는다.** 라우터는 자기 진입 메서드 하나를 호출할 뿐, 정책을 고르는 일에 관여하지 않는다. 이유는 두 가지다.

- **라우터는 전송 계층이다.** 라우터가 하는 일은 인증(procedure) + 입력 형태(`.input()`) + 호출까지다. `resolveCancelPolicy(...)`를 라우터에서 부르면 "어떤 정책을 적용할지"라는 도메인 결정이 전송 계층으로 샌다. 라우터에는 어떤 로직도 얹지 않는다.
- **정책 선택이 데이터에 따라 동적일 수 있다.** 정책이 주문 특성·이벤트 기간 등 도메인 상태에 따라 갈리면, 그 판단은 데이터에 접근하는 서비스만 내릴 수 있다. 애초에 서비스에 두면 정적이든 동적이든 자리가 바뀌지 않는다.

핵심은 **정책 선택 로직이 정책 내용·실행 로직과 함께 서비스 안 한곳에 모여 있다**는 것이다. "누가 어디까지 취소할 수 있나"의 매핑을 알려면 서비스의 resolver만 보면 되고, 라우터는 볼 필요가 없다.

## 장단점

| | |
|---|---|
| **장점** | 케이스가 3개 이상일 때 조합 폭발 없음. 정책만 독립 단위 테스트 가능. 새 케이스 = 정책 객체 + resolver 한 줄(실행 함수 무수정). "어떤 정책이 적용되나"가 resolver 한 곳에 집약. |
| **단점** | 간접성 한 겹 추가(정책 객체 → resolver → 실행). **케이스가 2개뿐이면 오버엔지니어링**(rule of three 위반). 정책과 실행이 갈려서, 흐름을 추적하려면 두 곳을 봐야 함. |

## 패턴 1과의 관계 — 같은 축의 다음 눈금

패턴 1(메서드 분리)과 패턴 2(정책 주입)는 경쟁이 아니라 **강도 순서**다.

- 패턴 1: 검증 로직이 함수 안에 `if`로 **닫혀** 있음. 케이스가 이름으로 나뉨.
- 패턴 2: 검증 로직이 객체로 **열려** 있음. 케이스가 정책으로 나뉨.

패턴 1로 시작해서 세 번째 케이스가 실제로 올 때 패턴 2로 리팩터링하는 것이 정석이다. 미리 패턴 2를 깔면 YAGNI다 — 열린 확장점은 공짜가 아니라 간접성 비용이고, 세 번째가 오기 전까지는 패턴 1이 항상 더 읽기 쉽다.

## 주의 — `isAdmin` 불리언과 헷갈리지 말 것

정책 **객체**를 주입하는 것과 `isAdmin` **불리언**을 넘기는 것은 완전히 다르다.

```ts
// ❌ 반패턴 — 신원을 코어에 넘김
cancel(order, { isAdmin: true })   // 코어 안에서 if (isAdmin) 분기 → 신원 늘면 코어 갈라짐

// ✅ 패턴 2 — 정책(행동)을 코어에 넘김
cancel(order, AdminCancelPolicy)   // 코어는 policy.assert()만 호출, 신원 개념 없음
```

전자는 "호출자가 누구인가"(신원)를 코어가 알게 되어 신원이 늘 때마다 코어에 분기가 생긴다. 후자는 "무엇이 허용되는가"(정책)를 데이터로 받을 뿐이라 코어는 갈라지지 않는다.

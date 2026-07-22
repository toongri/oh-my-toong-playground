# 패턴 1 — 진입점별 public 메서드 분리 + 공통 코어 격리

> 케이스가 2~3개고 앞으로도 크게 늘지 않을 때의 **기본값**.

## 한 줄 요약

검증 차이를 `if (actor)` **분기**가 아니라 **메서드 이름**으로 표현한다. 진입점(고객/admin)마다 완결된 public 메서드를 두고, 공통되는 실행 코어는 private 메서드(또는 별도 객체)로 격리해 밖에서 못 부르게 한다.

## 언제

- 검증이 갈리는 케이스가 **2~3개**(예: 고객 / admin).
- 사람이 승인 큐를 보고 결정하는 별도 업무가 **없다**(있으면 요청 엔티티 분리로).
- 케이스가 4개 이상으로 번질 조짐이 아직 없다(있으면 [패턴 2](./02-policy-injection.md)).

## 왜

이 문제에서 "본질 로직은 같고 검증만 다르다"를 그대로 `cancel(order, { isAdmin })` 한 함수로 옮기면 코어 안에 `if (isAdmin)`가 생기고, 진입점이 늘 때마다 코어가 갈라진다. 메서드를 나누면:

- **`if (actor)`가 등장할 자리가 없다.** 애초에 다른 함수를 부르니까.
- **두 정책 차이가 이름으로 보인다.** `cancelByCustomer` / `cancelByAdmin`을 나란히 놓으면 차이가 diff처럼 드러난다 — 흩어진 `if`를 추적할 필요가 없다.
- **실행 코어를 우회 호출하는 게 타입 차원에서 막힌다.** private이라 정책을 건너뛰고 실행부로 바로 들어가는 경로가 없다.
- **입력 계약이 달라도 타입으로 표현된다.** admin 취소는 사유가 필수고 고객 취소는 사유가 없다 — 메서드를 나누면 `reason?: string`(옵셔널로 흐려짐) 대신 각 시그니처가 자기 계약을 강제한다.

이것은 DDD의 "use-case 하나당 application service 메서드 하나"라는 표준 관례의 적용이다. 고객-취소와 admin-취소는 서로 다른 use case이므로 서로 다른 메서드가 맞다.

## 어떻게 — 예시

층을 셋으로 나눈다. **도메인 모델**은 자기 상태의 판정·전이를 응집하고, **서비스**는 오케스트레이션(크로스도메인 호출 + 트랜잭션)만 하고, **라우터**는 이름만 부른다.

### 도메인 모델 — 상태 판정·전이를 응집

`Order`가 자기 상태를 스스로 안다. "이 상태에서 이 액터가 취소할 수 있나"(정책)와 "취소로의 상태 전이·멱등"(불변식)이 여기 모인다. 서비스에 `if (order.status !== ...)`가 흩어지지 않는다.

```ts
// order.ts — 필드는 리포지토리가 하이드레이트. 여기선 판정·전이 메서드만 보인다.
class Order {
  readonly id!: string
  readonly userId!: string
  private status!: OrderStatus

  /** 정책: 고객은 결제완료(CONFIRMED) 상태에서만 */
  assertCancellableByCustomer(): void {
    if (this.status !== OrderStatus.CONFIRMED)
      throw new OrderNotCancellableError(this.id, this.status)
  }
  /** 정책: admin은 배송 이후 상태도 허용(더 넓음) */
  assertCancellableByAdmin(): void {
    if (!ADMIN_CANCELLABLE_STATUSES.includes(this.status))
      throw new OrderNotCancellableError(this.id, this.status)
  }
  /** 불변식: 이미 취소면 멱등 판정용 */
  isCancelled(): boolean {
    return this.status === OrderStatus.CANCELLED
  }
  /** 불변식: 상태 전이 */
  markCancelled(): void {
    this.status = OrderStatus.CANCELLED
  }
}
```

### 서비스 — 오케스트레이션(크로스도메인 + 트랜잭션)

서비스는 **무엇이 허용되는지(정책)를 스스로 판정하지 않는다** — 도메인 모델에 위임한다. 서비스가 아는 건 "취소를 어떻게 집행하나"뿐이다: 결제 취소·포인트 환급이라는 **다른 도메인**을 순서대로 호출하고 한 트랜잭션으로 묶는 일. actor별 public 메서드는 얇고, 공유되는 집행부는 private `execute`로 격리한다.

```ts
export class OrderCancelService {
  /** 고객 취소 */
  static async cancelByCustomer(orderId: string, userId: string): Promise<void> {
    const order = await OrderRepository.findByUserAndOrderId(userId, orderId)  // 불변식: 소유권 = 조회 제약
    order.assertCancellableByCustomer()                                        // 정책: 도메인이 판정
    await this.execute(order)                                                  // 오케스트레이션
  }

  /** admin 취소 — 사유 필수 */
  static async cancelByAdmin(orderId: string, userId: string, reason: string): Promise<void> {
    const order = await OrderRepository.findByUserAndOrderId(userId, orderId)  // admin도 소유권 우회 못 함
    order.assertCancellableByAdmin()
    await this.execute(order, reason)
  }

  /** 오케스트레이션 코어 — 정책은 모른다. 크로스도메인 집행만. private. */
  private static async execute(order: Order, reason?: string): Promise<void> {
    if (order.isCancelled()) return                                            // 불변식: 멱등(재-PG취소 방지)
    const pgCancel = await PaymentCancelService.cancelByOrderId(order.id, reason ?? DEFAULT_REASON)
    await db.transaction(async (tx) => {
      order.markCancelled()                                                    // 도메인 상태 전이
      await OrderRepository.save(order, tx)
      await PointService.reverseForOrder(order.id, tx)                         // 다른 도메인
    })
  }
}
```

### 진입점 — 라우터는 이름만 부른다

```ts
// order.router.ts (고객 진입점)
cancel: userProcedure
  .input(z.object({ orderId: z.string().uuid() }))
  .mutation(({ ctx, input }) =>
    OrderCancelService.cancelByCustomer(input.orderId, ctx.user.id))

// order-admin.router.ts (admin 진입점)
cancel: adminProcedure
  .use(withPermission(AdminPermission.ORDERS_UPDATE))          // 인가는 앞단
  .input(z.object({ orderId: z.string().uuid(), userId: z.string().uuid(), reason: z.string() }))
  .mutation(({ input }) =>
    OrderCancelService.cancelByAdmin(input.orderId, input.userId, input.reason))
```

**두 겹이 우회를 타입 차원에서 막는다.** (1) `execute`가 `private`이라 정책을 건너뛰고 집행부로 바로 들어가는 경로가 없다. (2) 소유권이 `findByUserAndOrderId`의 조회 제약이라, 애초에 남의 주문을 로드하는 경로 자체가 없다. 나중에 CS팀 취소가 붙어도 `cancelByCsAgent` public 메서드를 하나 더 만들 뿐, `execute`도 도메인 모델도 안 건드린다.

## "공통 코어를 private로" vs "별도 객체로"

- **private 메서드(위 예시)** — 진입점들이 같은 서비스 클래스에 있을 때. 가장 가볍다. 대부분 여기서 끝난다.
- **별도 객체** — 실행 코어가 충분히 크거나(트랜잭션 관리·보상 로직 등), 여러 서비스가 공유할 때만. 예: `OrderCancelExecutor`를 두고 `cancelByCustomer`/`cancelByAdmin`이 그것을 호출. 다만 호출자가 하나면 굳이 빼지 말 것(deep module 원칙 — 한 caller + 얇은 본문이면 인라인).

## 장단점

| | |
|---|---|
| **장점** | `if (actor)` 분기 소멸. 정책 차이가 이름으로 드러남. 실행 코어 우회 호출이 타입 차원 차단. 입력 계약 차이(admin만 reason 필수)를 시그니처로 강제. 새 진입점 추가 비용 낮음. |
| **단점** | 케이스가 4개, 5개로 늘면 `cancelByCustomer/Admin/CsAgent/Partner...`로 메서드가 늘고, 넷이 공유부 90% + 게이트 한 줄 차이면 눈으로 대조해야 함(드리프트 위험) → 그때 [패턴 2](./02-policy-injection.md)로. |

## 주의

- **소유권은 로드-후-검사가 아니라 조회 제약으로.** 위 예시는 `OrderRepository.findByUserAndOrderId(userId, orderId)`로 **소유자의 주문만 애초에 로드**한다. `findById(orderId)`로 무조건 로드한 뒤 `order.hasOwner(userId)`로 사후 검사하는 방식도 가능하지만(대리 취소가 필요할 때는 오히려 이 형태가 맞다 — 아래), 기본은 조회 제약이 더 안전하다. "남의 주문을 로드한 상태"라는 위험한 중간 상태 자체가 생기지 않기 때문이다.
- **admin도 불변식은 못 깬다.** `cancelByAdmin`도 소유자 스코프로 로드하므로 남의 주문에 손대지 못한다. "admin이 임의 주문을 대리 취소"가 필요해지면 그건 별도 시그니처(`cancelByAdminOnBehalf`)로 명시적으로 분리하고, 그 안에서만 `findById` + `order.assertOwnedByAny(...)` 식으로 완화하지, 기존 메서드에서 소유권 검사를 빼지 않는다.
- **상태 집합은 상수로.** `ADMIN_CANCELLABLE_STATUSES`처럼 명명 상수로 뽑는다. `!== OrderStatus.CONFIRMED` 같은 리터럴이 여러 곳에 흩어지면 한쪽만 바뀌어도 드리프트를 못 잡는다.

## 이 레포 맥락

이 레포의 `OrderCancelService.cancelOrder(orderId, userId)`는 현재 `if (order.orderStatus !== OrderStatus.CONFIRMED) throw`가 **코어 안에 박혀** 있고 고객·admin·쿠폰환급이 모두 이걸 부른다. 그래서 admin이 배송 이후 환불을 하려면 이 코어를 건드리거나 우회해야 했고 — 실제로 admin 부분/전액 환불이 Node에 없고 Python `admin_order_service.py`에만 있다. **정책이 갈릴 자리를 안 만들어두면 사람들은 서비스를 통째로 복제한다.** 메서드를 나누는 것은 그 복제본을 다시 합칠 자리를 만드는 작업이기도 하다.

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

```ts
export class OrderCancelService {
  /** 고객 취소 — 결제완료(CONFIRMED) 상태에서만 */
  static async cancelByCustomer(orderId: string, userId: string): Promise<void> {
    const order = await this.loadOwnedOrder(orderId, userId)          // 불변식: 소유권
    if (order.orderStatus !== OrderStatus.CONFIRMED) {                // 정책: 고객용
      throw new OrderNotCancellableError(orderId, order.orderStatus)
    }
    await this.execute(order, userId)
  }

  /** admin 취소 — 배송 이후 상태도 허용, 사유 필수 */
  static async cancelByAdmin(orderId: string, userId: string, reason: string): Promise<void> {
    const order = await this.loadOwnedOrder(orderId, userId)          // 불변식: 소유권(admin도 우회 못 함)
    if (!ADMIN_CANCELLABLE_STATUSES.includes(order.orderStatus)) {    // 정책: admin용(더 넓음)
      throw new OrderNotCancellableError(orderId, order.orderStatus)
    }
    await this.execute(order, userId, reason)
  }

  /** 공통 실행 코어 — 불변식만. private이라 밖에서 못 부른다. */
  private static async execute(order: OrderRow, userId: string, reason?: string): Promise<void> {
    if (order.orderStatus === OrderStatus.CANCELLED) return           // 불변식: 멱등
    await PointService.assertReversibleForOrder({ /* ... */ })
    const pgCancel = await PaymentCancelService.cancelByOrderId(order.id, order, reason ?? DEFAULT_REASON)
    await this.reverseInTx({ orderId: order.id, userId, pgCancel })   // PG 취소 순서·이력
  }
}
```

**핵심은 `execute`가 `private`이라는 점이다.** 정책을 건너뛰고 실행 코어로 바로 들어가는 경로가 타입 시스템 차원에서 막힌다. 나중에 CS팀 취소가 붙어도 `cancelByCsAgent`라는 public 메서드를 하나 더 만들 뿐, `execute`는 안 건드린다.

## "공통 코어를 private로" vs "별도 객체로"

- **private 메서드(위 예시)** — 진입점들이 같은 서비스 클래스에 있을 때. 가장 가볍다. 대부분 여기서 끝난다.
- **별도 객체** — 실행 코어가 충분히 크거나(트랜잭션 관리·보상 로직 등), 여러 서비스가 공유할 때만. 예: `OrderCancelExecutor`를 두고 `cancelByCustomer`/`cancelByAdmin`이 그것을 호출. 다만 호출자가 하나면 굳이 빼지 말 것(deep module 원칙 — 한 caller + 얇은 본문이면 인라인).

## 장단점

| | |
|---|---|
| **장점** | `if (actor)` 분기 소멸. 정책 차이가 이름으로 드러남. 실행 코어 우회 호출이 타입 차원 차단. 입력 계약 차이(admin만 reason 필수)를 시그니처로 강제. 새 진입점 추가 비용 낮음. |
| **단점** | 케이스가 4개, 5개로 늘면 `cancelByCustomer/Admin/CsAgent/Partner...`로 메서드가 늘고, 넷이 공유부 90% + 게이트 한 줄 차이면 눈으로 대조해야 함(드리프트 위험) → 그때 [패턴 2](./02-policy-injection.md)로. |

## 주의

- **admin도 불변식은 못 깬다.** 위 예시에서 `cancelByAdmin`도 `loadOwnedOrder`로 소유권을 검증한다. "admin이 남의 주문을 대리 취소"가 필요해지면 그건 별도 시그니처(`cancelByAdminOnBehalf`)로 명시적으로 분리하지, 기존 메서드에서 소유권 검사를 빼지 않는다.
- **상태 집합은 상수로.** `ADMIN_CANCELLABLE_STATUSES`처럼 명명 상수로 뽑는다. `!== OrderStatus.CONFIRMED` 같은 리터럴이 여러 곳에 흩어지면 한쪽만 바뀌어도 드리프트를 못 잡는다.

## 이 레포 맥락

이 레포의 `OrderCancelService.cancelOrder(orderId, userId)`는 현재 `if (order.orderStatus !== OrderStatus.CONFIRMED) throw`가 **코어 안에 박혀** 있고 고객·admin·쿠폰환급이 모두 이걸 부른다. 그래서 admin이 배송 이후 환불을 하려면 이 코어를 건드리거나 우회해야 했고 — 실제로 admin 부분/전액 환불이 Node에 없고 Python `admin_order_service.py`에만 있다. **정책이 갈릴 자리를 안 만들어두면 사람들은 서비스를 통째로 복제한다.** 메서드를 나누는 것은 그 복제본을 다시 합칠 자리를 만드는 작업이기도 하다.

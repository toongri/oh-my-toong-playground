# 도메인 이벤트와 EventListener

도메인 이벤트를 언제 어떻게 발행하고 받는가 — 이벤트 정의 규칙, EventListener의 트랜잭션 단계, 크로스도메인 통신에서 이벤트를 쓰는 이유를 다룬다.

## 목차

1. **왜 버전과 스냅샷이 필요한가** — 버전 없는 이벤트, Entity 직접 참조가 낳는 문제
2. **도메인 이벤트 정의 규칙** — 네이밍·인터페이스·필드·팩토리·자식 스냅샷
3. **EventListener — 트랜잭션 단계 선택** — BEFORE_COMMIT vs AFTER_COMMIT, 로깅 포맷
4. **BEFORE_COMMIT 리스너 (동기)** — 코드 예시
5. **AFTER_COMMIT 리스너 (기본 동기)** — 코드 예시
6. **크로스도메인 통신 — Facade 대신 이벤트** — Facade→Facade 금지, 외부 호출은 커밋 이후로
7. **안티패턴 — 이벤트 구조와 리스너**
8. **이 문서의 Red Flags**
9. **이런 생각이 들면 멈춰라 — Critical Rules 발췌**

---

## 1. 왜 버전과 스냅샷이 필요한가

버전 없는 이벤트(`OrderCreatedEvent`)는 스키마가 바뀌면 모든 소비자가 동시에 마이그레이션해야 한다. Entity를 이벤트에 직접 담으면 지연 로딩 오류와 직렬화 시 순환 참조 문제가 생긴다. 버전 접미사(`V1`)와 Snapshot 패턴은 이벤트 스키마를 안전하게 진화시키기 위한 장치다.

도메인 이벤트는 애그리거트 사이의 느슨한 결합과 크로스도메인 통신을 가능하게 한다. 이 문서는 이벤트 생성, 리스너 패턴, 크로스도메인 통신을 다룬다.

> ⚠️ 주의: `AFTER_COMMIT` 이벤트를 어떻게 **테스트**하는지는 이 문서의 범위가 아니다 — 프로덕션 코드에서 이벤트를 어떻게 쓰는가만 다룬다. Awaitility를 이용한 검증 패턴은 [../testing/integration-test.md](../testing/integration-test.md) §8 Spring Event 오케스트레이션에서 다룬다.

## 2. 도메인 이벤트 정의 규칙

도메인 이벤트를 정의할 때 지켜야 할 다섯 가지 요구사항이다.

| Requirement | Pattern |
|-------------|---------|
| Naming | `{Action}EventV{n}` (version suffix required) |
| Interface | Must implement `DomainEvent` |
| Fields | `occurredAt: Instant` required |
| Factory | `companion object { fun from(entity) }` |
| Children | Use snapshots, not entity references |

### 네이밍 — 버전 접미사는 항상 붙인다

**포맷**: `{Action}EventV{n}` — 버전 접미사를 항상 포함한다.

```kotlin
// ✅ CORRECT
OrderCreatedEventV1
PaymentCompletedEventV1
StockDeductedEventV1

// ❌ WRONG: Missing version suffix
OrderCreatedEvent
PaymentCompletedEvent
```

### 구조 요구사항

1. **`DomainEvent` 인터페이스 구현** (타입 안전성을 위한 마커 인터페이스)
2. **`occurredAt: Instant`** 필드 (이벤트가 언제 발생했는지)
3. **팩토리 메서드**: `companion object { fun from(entity): Event }`
4. **Snapshot 클래스**로 자식 엔티티를 표현 (참조가 아닌 불변 복사본)

```kotlin
// ✅ CORRECT: Complete domain event
interface DomainEvent {
    val occurredAt: Instant
}

data class OrderCreatedEventV1(
    val orderId: Long,
    val userId: Long,
    val totalAmount: Money,
    val items: List<OrderItemSnapshot>,  // Snapshot, not entity reference
    override val occurredAt: Instant = Instant.now(),
) : DomainEvent {
    companion object {
        fun from(order: Order): OrderCreatedEventV1 = OrderCreatedEventV1(
            orderId = order.id,
            userId = order.userId,
            totalAmount = order.totalAmount,
            items = order.items.map { OrderItemSnapshot.from(it) },
        )
    }
}

// Snapshot class for child entities
data class OrderItemSnapshot(
    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: Money,
) {
    companion object {
        fun from(item: OrderItem): OrderItemSnapshot = OrderItemSnapshot(
            productId = item.productId,
            productName = item.productName,
            quantity = item.quantity,
            price = item.price,
        )
    }
}
```

## 3. EventListener — 트랜잭션 단계 선택

리스너를 등록할 때 가장 먼저 결정할 것은 트랜잭션 단계다. 같은 트랜잭션 안에서 실패가 전체를 롤백해야 하면 `BEFORE_COMMIT`, 커밋이 끝난 뒤 별도로 처리해도 되면 `AFTER_COMMIT`이다.

| Phase | Transaction | Thread | Failure Behavior |
|-------|-------------|--------|-------------------|
| `BEFORE_COMMIT` | 원본 트랜잭션 안 | 발행 스레드 | 실패 시 전체 롤백 |
| `AFTER_COMMIT` | 커밋 완료 후 — 트랜잭션 밖 | 기본은 발행 스레드, `@Async`로 별도 스레드 가능 | 원본 트랜잭션에 영향 없음 — 예외는 Spring이 삼킴, `try-catch`로 직접 로깅 필수 |

**Always**: `@TransactionalEventListener(phase = TransactionPhase.XXX)` — 절대 `@EventListener`만 쓰지 않는다.

**Logging format**: `logger.info("[Event] {Action} start/complete - eventType: ${event::class.simpleName}, id: $id")`

**필수 패턴 세 가지**:

1. **로깅 포맷**: `logger.info("[Event] {Action} start/complete - eventType: ${event::class.simpleName}, id: $id")`
2. **AFTER_COMMIT 에러 처리**: `try-catch`와 `logger.error`로 리스너 스스로 예외를 잡고 로깅한다 — `@Async` 여부와 무관한 무조건적 요구다. 동기 리스너는 Spring의 `afterCompletion()` 콜백 처리가, `@Async` 리스너는 `AsyncUncaughtExceptionHandler`가 예외를 각자 자신의 로거로 ERROR 한 줄만 남기고 호출자에게는 전파하지 않으므로, 잡지 않으면 `orderId` 같은 도메인 맥락 없는 프레임워크 로그 한 줄만 남는다 — 그래서 리스너가 도메인 맥락을 담아 직접 로깅해야 한다. 자세한 경로 차이는 §5를 참고한다.
3. **Phase 명시**: `TransactionPhase`를 항상 명시적으로 지정한다

> ⚠️ 주의: 이벤트 리스너를 **어느 레이어/패키지에 두는가**는 이 문서의 범위가 아니다 — [./layer-boundaries.md](./layer-boundaries.md)의 Event Listener Location을 참고한다. 여기서는 리스너가 받는 **트랜잭션 단계와 에러 처리**만 다룬다.

## 4. BEFORE_COMMIT 리스너 (동기)

`BEFORE_COMMIT` 리스너는 같은 트랜잭션 안에서 실행되므로, 실패하면 이벤트를 발행한 트랜잭션 전체가 롤백된다.

```kotlin
// ✅ CORRECT: Sync listener (same transaction, rolls back on failure)
@Component
class StockDeductionOutboxListener(
    private val outboxService: OutboxService,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        logger.info("[Event] Stock deduction outbox start - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
        outboxService.save(OutboxCommand.Create(
            eventType = "ORDER_CREATED",
            payload = event,
        ))
        logger.info("[Event] Stock deduction outbox complete - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    }
}
```

## 5. AFTER_COMMIT 리스너 (기본 동기)

`AFTER_COMMIT` 리스너는 커밋이 끝난 뒤 실행되며, 기본은 이벤트를 발행한 스레드에서 동기적으로 실행된다 — 별도 스레드가 필요하면 `@Async`를 함께 붙여야 한다. 커밋은 이미 끝났으므로 리스너 실패가 원본 트랜잭션을 롤백시키지는 않는다. 다만 예외가 삼켜지는 경로는 동기냐 `@Async`냐에 따라 다르다 — 동기 리스너는 Spring이 `afterCompletion()` 콜백 호출을 예외로부터 감싸 로깅만 하고 삼키고(`TransactionSynchronizationUtils`), `@Async`를 붙인 비동기 리스너는 그 감싸는 지점에 도달하기 전에 별도 스레드에서 예외가 던져지므로 대신 `AsyncUncaughtExceptionHandler`가 받아 기본적으로 로깅만 한다. 메커니즘은 다르지만 결과는 같다 — 동기 실행이든 `@Async`를 붙인 비동기 실행이든 예외는 호출자에게 전파되지 않는다. 커밋은 이미 끝났고 컨트롤러는 정상 응답을 반환한다. 리스너 스스로 예외를 잡고 로깅해야 하는 건 `@Async` 여부와 무관한 무조건적 요구다.

```kotlin
// ✅ CORRECT: Async listener (after commit, with error handling)
@Component
class OrderNotificationListener(
    private val notificationService: NotificationService,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        logger.info("[Event] Notification start - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
        try {
            notificationService.sendOrderConfirmation(event.orderId, event.userId)
            logger.info("[Event] Notification complete - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
        } catch (e: Exception) {
            logger.error("[Event] Notification failed - eventType: ${event::class.simpleName}, orderId: ${event.orderId}", e)
            // Async failures should NOT propagate - log and handle gracefully
        }
    }
}
```

## 6. 크로스도메인 통신 — Facade 대신 이벤트

크로스도메인 통신은 반드시 이벤트를 써야 한다. Facade가 다른 Facade를 직접 호출하는 구조는 금지다.

```kotlin
// ❌ FORBIDDEN: Facade calling another Facade
class OrderFacade(
    private val notificationFacade: NotificationFacade,  // Facade→Facade!
    private val rewardFacade: RewardFacade,              // Facade→Facade!
)

// ✅ CORRECT: Use domain events
@Transactional
fun completeOrder(orderId: Long): Order {
    val order = orderService.complete(orderId)
    eventPublisher.publishEvent(OrderCompletedEventV1.from(order))
    return order
}

// Other domains listen to event
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
fun onOrderCompleted(event: OrderCompletedEventV1) {
    logger.info("[Event] Notification start - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    try {
        notificationService.sendOrderConfirmation(event.orderId)
        logger.info("[Event] Notification complete - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    } catch (e: Exception) {
        logger.error("[Event] Notification failed - eventType: ${event::class.simpleName}, orderId: ${event.orderId}", e)
    }
}
```

외부 호출(HTTP, 메시지 큐)은 반드시 트랜잭션 커밋 이후에 일어나야 한다. 트랜잭션 안에서 외부 호출이 지연되거나 실패하면, DB 커넥션을 붙든 채 실패 전파 범위가 불필요하게 커진다.

```kotlin
// ❌ FORBIDDEN: External call inside transaction
@Transactional
fun createOrder(command: OrderCommand): Order {
    val order = orderService.create(command)
    paymentGateway.requestPayment(order)  // External HTTP call inside tx!
    return order
}

// ✅ CORRECT: Use event for external call
@Transactional
fun createOrder(command: OrderCommand): Order {
    val order = orderService.create(command)
    eventPublisher.publishEvent(OrderCreatedEventV1.from(order))
    return order
}

// EventListener handles external call AFTER_COMMIT
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
fun onOrderCreated(event: OrderCreatedEventV1) {
    logger.info("[Event] Payment request start - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    try {
        paymentGateway.requestPayment(event.orderId)
        logger.info("[Event] Payment request complete - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    } catch (e: Exception) {
        logger.error("[Event] Payment request failed - eventType: ${event::class.simpleName}, orderId: ${event.orderId}", e)
    }
}
```

> ⚠️ 주의: 캐시 무효화에 이벤트를 쓰는 구체적 패턴(어떤 `@TransactionalEventListener(AFTER_COMMIT)`이 어떤 캐시 키를 지우는가)은 이 문서가 아니라 [./caching-patterns.md](./caching-patterns.md)에서 다룬다. 여기서는 이벤트가 크로스도메인 통신과 외부 호출 분리에 쓰이는 원칙만 다룬다.

## 7. 안티패턴 — 이벤트 구조와 리스너

### 이벤트 구조 안티패턴

```kotlin
// ❌ Missing V1 suffix
data class OrderCreatedEvent(...)  // Wrong! Must be OrderCreatedEventV1

// ❌ No DomainEvent interface
data class OrderCreatedEventV1(
    val orderId: Long,
    val occurredAt: Instant,
)  // Wrong! Must implement DomainEvent

// ❌ Entity reference instead of snapshot
data class OrderCreatedEventV1(
    val order: Order,  // Wrong! Use snapshots, not entity references
)

// ❌ No factory method
data class OrderCreatedEventV1(...) {
    // Wrong! Must have companion object { fun from(order): OrderCreatedEventV1 }
}
```

### EventListener 안티패턴

```kotlin
// ❌ No logging
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
fun onOrderCreated(event: OrderCreatedEventV1) {
    notificationService.send(event.orderId)  // Wrong! No logging
}

// ❌ Async without error handling
@Async
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
fun onOrderCreated(event: OrderCreatedEventV1) {
    notificationService.send(event.orderId)  // Wrong! No try-catch
}

// ❌ No phase specification
@TransactionalEventListener  // Wrong! Always specify phase explicitly
fun onOrderCreated(event: OrderCreatedEventV1)

// ❌ Just @EventListener for transactional events
@EventListener  // Wrong! Use @TransactionalEventListener with phase
fun onOrderCreated(event: OrderCreatedEventV1)
```

## 8. 이 문서의 Red Flags

| Thought | Problem |
|---------|---------|
| "Event without V1 suffix" | ALWAYS use `{Action}EventV{n}` naming. Version suffix is required. |
| "Just make data classes for events" | Events MUST implement DomainEvent interface, have occurredAt, from() factory, snapshots. |
| "DomainEvent interface is overkill" | Interface provides type safety and consistent event contract. Required. |
| "Just pass entity to event" | Use snapshot classes for child data. Entity references cause serialization issues. |
| "Event factory method unnecessary" | ALWAYS use `companion object { fun from(entity) }` pattern. Encapsulates conversion. |
| "Just @EventListener is enough" | Use @TransactionalEventListener with explicit phase. Phase control is required. |
| "Logging in listeners is optional" | ALWAYS log `[Event] Action start/complete - eventType: X, id: Y`. Required for debugging. |
| "Listener doesn't need try-catch" | Exceptions MUST be caught and logged. Spring logs a bare ERROR line with no domain context and never propagates it to the caller — via `afterCompletion()` for a sync listener, via `AsyncUncaughtExceptionHandler` for an `@Async` one — so the listener itself must catch and log with domain context either way. |
| "Direct synchronous call is clearer" | Events are required for cross-domain. "Clearer" != correct architecture. |
| "Single @Transactional covers everything" | External calls MUST be after commit. Use AFTER_COMMIT event listener. |

## 9. 이런 생각이 들면 멈춰라 — Critical Rules 발췌

아래 세 행은 이 프로젝트의 Critical Rules Red Flags 중, 도메인 이벤트와 EventListener에 관한 것만 발췌한 것이다. 위 8절의 자체 Red Flags보다 더 짧고 압축된 요약이며, 이 문서에서 다루지 않는 나머지 항목(레이어 경계·에러 처리·엔티티·캐싱 등)은 각 관심사의 형제 문서가 갖고 있다.

| Thought | Reality |
|---|---|
| "Event without V1 suffix" | Version suffix required |
| "Just @EventListener" | Use @TransactionalEventListener with phase |
| "Listener without try-catch" | Exceptions must be caught and logged — sync or async alike |

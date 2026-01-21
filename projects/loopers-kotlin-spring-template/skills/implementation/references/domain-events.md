# Domain Events Reference

## Overview

Domain events enable loose coupling between aggregates and cross-domain communication. This reference covers event creation, listener patterns, and cross-domain communication.

## Domain Event Pattern

### Event Naming

**Format**: `{Action}EventV{n}` - ALWAYS include version suffix

```kotlin
// ✅ CORRECT
OrderCreatedEventV1
PaymentCompletedEventV1
StockDeductedEventV1

// ❌ WRONG: Missing version suffix
OrderCreatedEvent
PaymentCompletedEvent
```

### Event Structure Requirements

1. **Implement `DomainEvent` interface** (marker interface for type safety)
2. **`occurredAt: Instant`** field (when the event happened)
3. **Factory method**: `companion object { fun from(entity): Event }`
4. **Snapshot classes** for child entities (immutable copies, not references)

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

## EventListener Pattern

### Sync vs Async Distinction

| Type | Phase | Transaction | Failure Behavior |
|------|-------|-------------|------------------|
| **Sync** | `BEFORE_COMMIT` | Same transaction | Failure rolls back everything |
| **Async** | `AFTER_COMMIT` | Separate thread | Failure doesn't affect transaction |

### Required Patterns

1. **Logging format**: `logger.info("[Event] {Action} start/complete - eventType: ${event::class.simpleName}, id: $id")`
2. **Async error handling**: `try-catch` with `logger.error` (async failures must not propagate)
3. **Phase specification**: Always explicit `TransactionPhase`

### BEFORE_COMMIT Listener (Sync)

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

### AFTER_COMMIT Listener (Async)

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

## Cross-Domain Communication

### Events Instead of Facade-to-Facade

Cross-domain communication MUST use events, NOT Facade-to-Facade dependencies.

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
    notificationService.sendOrderConfirmation(event.orderId)
}
```

### External Calls MUST be AFTER_COMMIT

External calls (HTTP, Message Queue) MUST happen after transaction commit.

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
    paymentGateway.requestPayment(event.orderId)
}
```

## Anti-Patterns

### Event Structure Anti-Patterns

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

### EventListener Anti-Patterns

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

## Red Flags

| Thought | Problem |
|---------|---------|
| "Event without V1 suffix" | ALWAYS use `{Action}EventV{n}` naming. Version suffix is required. |
| "Just make data classes for events" | Events MUST implement DomainEvent interface, have occurredAt, from() factory, snapshots. |
| "DomainEvent interface is overkill" | Interface provides type safety and consistent event contract. Required. |
| "Just pass entity to event" | Use snapshot classes for child data. Entity references cause serialization issues. |
| "Event factory method unnecessary" | ALWAYS use `companion object { fun from(entity) }` pattern. Encapsulates conversion. |
| "Just @EventListener is enough" | Use @TransactionalEventListener with explicit phase. Phase control is required. |
| "Logging in listeners is optional" | ALWAYS log `[Event] Action start/complete - eventType: X, id: Y`. Required for debugging. |
| "Async listener doesn't need try-catch" | Async failures MUST be caught and logged. Propagating exceptions breaks async processing. |
| "Direct synchronous call is clearer" | Events are required for cross-domain. "Clearer" != correct architecture. |
| "Single @Transactional covers everything" | External calls MUST be after commit. Use AFTER_COMMIT event listener. |

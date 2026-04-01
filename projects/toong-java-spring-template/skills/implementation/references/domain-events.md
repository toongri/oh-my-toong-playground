# Domain Events Reference

## Why This Matters
Events without version (OrderCreatedEvent) require all consumers to migrate simultaneously when schema changes.
Putting Entity directly in events causes lazy-loading errors and circular reference issues during serialization.
Version suffix (V1) and Snapshot pattern ensure safe evolution of event schemas.

## Overview

Domain events enable loose coupling between aggregates and cross-domain communication. This reference covers event creation, listener patterns, and cross-domain communication.

## Domain Event Pattern

### Event Naming

**Format**: `{Action}EventV{n}` - ALWAYS include version suffix

```java
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
2. **`Instant occurredAt()`** accessor (when the event happened)
3. **Factory method**: `public static EventType from(Entity entity)`
4. **Snapshot classes** for child entities (immutable copies, not references)

```java
// ✅ CORRECT: Complete domain event
interface DomainEvent {
    Instant occurredAt();
}

public record OrderCreatedEventV1(
    long orderId,
    long userId,
    Money totalAmount,
    List<OrderItemSnapshot> items,  // Snapshot, not entity reference
    Instant occurredAt
) implements DomainEvent {

    public static OrderCreatedEventV1 from(Order order) {
        return new OrderCreatedEventV1(
            order.getId(),
            order.getUserId(),
            order.getTotalAmount(),
            order.getItems().stream().map(OrderItemSnapshot::from).toList(),
            Instant.now()
        );
    }
}

// Snapshot class for child entities
public record OrderItemSnapshot(
    long productId,
    String productName,
    int quantity,
    Money price
) {
    public static OrderItemSnapshot from(OrderItem item) {
        return new OrderItemSnapshot(
            item.getProductId(),
            item.getProductName(),
            item.getQuantity(),
            item.getPrice()
        );
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

1. **Logging format**: `logger.info("[Event] {Action} start/complete - eventType: {}, id: {}", event.getClass().getSimpleName(), id)`
2. **Async error handling**: `try-catch` with `logger.error` (async failures must not propagate)
3. **Phase specification**: Always explicit `TransactionPhase`

### BEFORE_COMMIT Listener (Sync)

```java
// ✅ CORRECT: Sync listener (same transaction, rolls back on failure)
@Component
class StockDeductionOutboxListener {
    private final OutboxService outboxService;
    private static final Logger logger = LoggerFactory.getLogger(StockDeductionOutboxListener.class);

    StockDeductionOutboxListener(OutboxService outboxService) {
        this.outboxService = outboxService;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onOrderCreated(OrderCreatedEventV1 event) {
        logger.info("[Event] Stock deduction outbox start - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
        outboxService.save(new OutboxCommand.Create(
            "ORDER_CREATED",
            event
        ));
        logger.info("[Event] Stock deduction outbox complete - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
    }
}
```

### AFTER_COMMIT Listener (Async)

```java
// ✅ CORRECT: Async listener (after commit, with error handling)
@Component
class OrderNotificationListener {
    private final NotificationService notificationService;
    private static final Logger logger = LoggerFactory.getLogger(OrderNotificationListener.class);

    OrderNotificationListener(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCreated(OrderCreatedEventV1 event) {
        logger.info("[Event] Notification start - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
        try {
            notificationService.sendOrderConfirmation(event.orderId(), event.userId());
            logger.info("[Event] Notification complete - eventType: {}, orderId: {}",
                event.getClass().getSimpleName(), event.orderId());
        } catch (Exception e) {
            logger.error("[Event] Notification failed - eventType: {}, orderId: {}",
                event.getClass().getSimpleName(), event.orderId(), e);
            // Async failures should NOT propagate - log and handle gracefully
        }
    }
}
```

## Cross-Domain Communication

### Events Instead of Facade-to-Facade

Cross-domain communication MUST use events, NOT Facade-to-Facade dependencies.

```java
// ❌ FORBIDDEN: Facade calling another Facade
class OrderFacade {
    private final NotificationFacade notificationFacade;  // Facade→Facade!
    private final RewardFacade rewardFacade;              // Facade→Facade!
}

// ✅ CORRECT: Use domain events
@Transactional
public Order completeOrder(long orderId) {
    var order = orderService.complete(orderId);
    eventPublisher.publishEvent(OrderCompletedEventV1.from(order));
    return order;
}

// Other domains listen to event
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCompleted(OrderCompletedEventV1 event) {
    notificationService.sendOrderConfirmation(event.orderId());
}
```

### External Calls MUST be AFTER_COMMIT

External calls (HTTP, Message Queue) MUST happen after transaction commit.

```java
// ❌ FORBIDDEN: External call inside transaction
@Transactional
public Order createOrder(OrderCommand command) {
    var order = orderService.create(command);
    paymentGateway.requestPayment(order);  // External HTTP call inside tx!
    return order;
}

// ✅ CORRECT: Use event for external call
@Transactional
public Order createOrder(OrderCommand command) {
    var order = orderService.create(command);
    eventPublisher.publishEvent(OrderCreatedEventV1.from(order));
    return order;
}

// EventListener handles external call AFTER_COMMIT
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreatedEventV1 event) {
    paymentGateway.requestPayment(event.orderId());
}
```

## Anti-Patterns

### Event Structure Anti-Patterns

```java
// ❌ Missing V1 suffix
public record OrderCreatedEvent(...) {}  // Wrong! Must be OrderCreatedEventV1

// ❌ No DomainEvent interface
public record OrderCreatedEventV1(
    long orderId,
    Instant occurredAt
) {}  // Wrong! Must implement DomainEvent

// ❌ Entity reference instead of snapshot
public record OrderCreatedEventV1(
    Order order  // Wrong! Use snapshots, not entity references
) implements DomainEvent {}

// ❌ No factory method
public record OrderCreatedEventV1(...) implements DomainEvent {
    // Wrong! Must have public static OrderCreatedEventV1 from(Order order)
}
```

### EventListener Anti-Patterns

```java
// ❌ No logging
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreatedEventV1 event) {
    notificationService.send(event.orderId());  // Wrong! No logging
}

// ❌ Async without error handling
@Async
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreatedEventV1 event) {
    notificationService.send(event.orderId());  // Wrong! No try-catch
}

// ❌ No phase specification
@TransactionalEventListener  // Wrong! Always specify phase explicitly
public void onOrderCreated(OrderCreatedEventV1 event) {}

// ❌ Just @EventListener for transactional events
@EventListener  // Wrong! Use @TransactionalEventListener with phase
public void onOrderCreated(OrderCreatedEventV1 event) {}
```

## Red Flags

| Thought | Problem |
|---------|---------|
| "Event without V1 suffix" | ALWAYS use `{Action}EventV{n}` naming. Version suffix is required. |
| "Just make records for events" | Events MUST implement DomainEvent interface, have occurredAt, from() factory, snapshots. |
| "DomainEvent interface is overkill" | Interface provides type safety and consistent event contract. Required. |
| "Just pass entity to event" | Use snapshot classes for child data. Entity references cause serialization issues. |
| "Event factory method unnecessary" | ALWAYS use `public static EventType from(entity)` pattern. Encapsulates conversion. |
| "Just @EventListener is enough" | Use @TransactionalEventListener with explicit phase. Phase control is required. |
| "Logging in listeners is optional" | ALWAYS log `[Event] Action start/complete - eventType: X, id: Y`. Required for debugging. |
| "Async listener doesn't need try-catch" | Async failures MUST be caught and logged. Propagating exceptions breaks async processing. |
| "Direct synchronous call is clearer" | Events are required for cross-domain. "Clearer" != correct architecture. |
| "Single @Transactional covers everything" | External calls MUST be after commit. Use AFTER_COMMIT event listener. |

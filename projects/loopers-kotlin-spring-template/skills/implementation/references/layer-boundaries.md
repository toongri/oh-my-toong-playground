# Layer Boundaries Reference

## Layer Structure

```
interfaces/     → HTTP handling, event listening
    ↓
application/    → Cross-domain coordination (Facade)
    ↓
domain/         → Single-domain business logic (Service)
    ↑
infrastructure/ → Data access, external systems (Repository Impl)
```

## Why This Matters

Without Facade, Controller calling Service directly makes cross-domain coordination difficult.
Horizontal dependencies between Services cause circular references and increase test complexity.
Facade is the cross-domain coordination point, wrapping multiple Services in a single transaction when needed.

## Dependency Direction

```
interfaces → application → domain ← infrastructure
```

**Rule**: Domain imports nothing (pure)

## Service vs Facade

### Service (Single Domain)

```kotlin
@Component
class CouponService(
    private val couponRepository: CouponRepository,  // ✅ Own Repository
    private val eventPublisher: ApplicationEventPublisher,
) {
    // ❌ Wrong: Injecting other domain Service/Repository is prohibited
    // private val orderService: OrderService
    // private val pointRepository: PointRepository

    @Transactional(readOnly = true)
    fun findById(id: Long): Coupon {
        return couponRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[couponId = $id] Coupon not found.")
    }

    @Transactional
    fun issue(command: CouponCommand.Issue): Coupon {
        val coupon = Coupon.create(command.userId, command.couponType)
        return couponRepository.save(coupon)
    }
}
```

### Facade (Cross-Domain)

```kotlin
@Component
class OrderFacade(
    private val orderService: OrderService,     // ✅ Can combine multiple Services
    private val couponService: CouponService,
    private val pointService: PointService,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional  // ✅ Transaction boundary is at Facade
    fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
        // 1. Use coupon (if present)
        criteria.couponId?.let { couponId ->
            couponService.use(CouponCommand.Use(couponId))
        }

        // 2. Deduct points (if present)
        criteria.pointAmount?.let { amount ->
            pointService.use(PointCommand.Use(criteria.userId, amount))
        }

        // 3. Create order
        val order = orderService.create(criteria.to())

        // 4. Publish event
        eventPublisher.publishEvent(OrderCreatedEventV1.from(order))

        return OrderInfo.Create.from(order)
    }
}
```

## Transaction Boundaries

| Layer | @Transactional | Purpose |
|-------|---------------|---------|
| Controller | ❌ Never | HTTP handling only |
| Facade | When atomicity needed | Wraps multiple Services in single transaction |
| Service | When atomicity needed | Ensures atomicity within single domain |
| Repository | When atomicity needed | Ensures atomicity for complex repository operations |

**readOnly usage**: Master/Slave DB routing. Use `readOnly=true` for read-only queries to route to Slave DB.

```kotlin
// Service query method - readOnly for Slave DB routing
@Transactional(readOnly = true)
fun findAll(query: CouponQuery): List<Coupon>

// Service write method - @Transactional when atomicity needed within domain
@Transactional
fun use(command: CouponCommand.Use): Coupon
```

### ⚠️ Transaction Propagation Trap

Understanding propagation is critical when both Facade and Service have @Transactional.

```kotlin
// Scenario: Both layers have @Transactional
class PointService {
    @Transactional  // propagation=REQUIRED (default)
    fun use(command: PointCommand): Point
}

class CouponService {
    @Transactional  // propagation=REQUIRED (default)
    fun issue(command: CouponCommand): Coupon
}

class RewardFacade {
    @Transactional
    fun processReward(criteria: RewardCriteria): RewardInfo {
        pointService.use(criteria.pointCommand)   // Participates in Facade's tx
        couponService.issue(criteria.couponCommand)  // Participates in Facade's tx
        // Both operations execute atomically in one transaction ✅
    }
}

// ⚠️ THE TRAP: When Services are called directly (not through Facade)
// Each Service creates its OWN transaction!
// → If pointService.use() succeeds but couponService.issue() fails,
//   point deduction is committed while coupon issuance is rolled back = data inconsistency

// ✅ SOLUTION: Understand your call paths
// - Facade → Service: Service joins Facade's transaction (propagation=REQUIRED)
// - Direct Service call: Service manages its own transaction (atomicity within domain)
// - Cross-domain coordination: MUST go through Facade for atomicity
```

## Event Listener Location

**Location**: `interfaces/event/{domain}/`

```kotlin
@Component
class OrderEventListener(
    private val notificationService: NotificationService,  // ✅ Service call
) {
    // ❌ Wrong: Direct Repository call is prohibited
    // private val notificationRepository: NotificationRepository

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        notificationService.sendOrderConfirmation(event.orderId)
    }
}
```

## Anti-Patterns

### ❌ Service → Service Horizontal Dependency

```kotlin
// Wrong
class OrderService(
    private val pointService: PointService,  // Horizontal dependency!
) {
    fun createOrder(command: OrderCommand.Create): Order {
        pointService.use(...)  // Calling another Service from Service
        ...
    }
}
```

### ❌ Facade → Facade Dependency

```kotlin
// Wrong
class OrderFacade(
    private val paymentFacade: PaymentFacade,  // Facade-to-Facade dependency!
    private val notificationFacade: NotificationFacade,  // Facade-to-Facade dependency!
    private val rewardFacade: RewardFacade,  // Facade-to-Facade dependency!
)

// ✅ CORRECT: Event-based communication
@Component
class OrderFacade(
    private val orderService: OrderService,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional
    fun completeOrder(orderId: Long): OrderInfo {
        val order = orderService.complete(orderId)
        eventPublisher.publishEvent(OrderCompletedEventV1.from(order))
        return OrderInfo.from(order)
    }
}

// Other domains handle via event listeners
@Component
class RewardEventListener(
    private val rewardService: RewardService,
) {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCompleted(event: OrderCompletedEventV1) {
        rewardService.accumulate(event.userId, event.totalAmount)
    }
}
```

### ❌ Business Logic in Facade

```kotlin
// Wrong - Business logic decisions in Facade
@Component
class OrderFacade {
    @Transactional
    fun processOrder(order: Order) {
        if (order.type == OrderType.REGULAR) {     // Business logic!
            shippingService.scheduleStandard(order)
        } else if (order.type == OrderType.SUBSCRIPTION) {  // Business logic!
            paymentService.setupAutoPayment(order)
            shippingService.scheduleStandard(order)
        } else if (order.type == OrderType.RESERVATION) {   // Business logic!
            reservationService.setReservationDate(order)
        }
    }
}

// ✅ CORRECT: Facade only coordinates, business logic in Service/Entity
@Component
class OrderFacade {
    @Transactional
    fun processOrder(criteria: OrderCriteria): OrderInfo {
        return orderService.process(criteria.to())  // Service handles type-specific processing
    }
}

@Component
class OrderService {
    @Transactional
    fun process(command: OrderCommand): Order {
        val order = orderRepository.findById(command.orderId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = ${command.orderId}] Order not found.")

        order.process()  // Entity handles type-specific processing (polymorphism or internal logic)
        return orderRepository.save(order)
    }
}
```

### ❌ Business Logic in EventListener

```kotlin
// Wrong
@EventListener
fun onOrderCreated(event: OrderCreatedEventV1) {
    if (event.totalAmount >= 100000) {  // Business logic leakage!
        // VIP notification
    } else {
        // Regular notification
    }
}

// Correct - Service makes the decision
@EventListener
fun onOrderCreated(event: OrderCreatedEventV1) {
    notificationService.sendOrderConfirmation(event.orderId)  // Service determines VIP status
}
```

### ❌ Infrastructure Import in Domain

```kotlin
// Wrong: In domain/ package
package com.project.domain.coupon

import com.project.infrastructure.persistence.CouponJpaRepository  // ❌
import org.springframework.data.jpa.repository.JpaRepository  // ❌
```

## Dependency Check Method

```kotlin
// If these imports exist in domain/ package files, it's a violation:
import com.project.infrastructure.*
import com.project.application.*
import com.project.interfaces.*
import org.springframework.data.*
import org.springframework.web.*
```

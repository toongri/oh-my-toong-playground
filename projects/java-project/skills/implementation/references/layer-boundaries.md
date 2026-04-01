# Layer Boundaries Reference

## Layer Structure

```
interfaces/     → HTTP handling, event listening
    ↓
application/    → Cross-domain coordination (Facade)
    ↓
domain/         → Single-domain business logic (Service)
    ↑
infrastructure/ → Data access, external systems (Repository 구현체)
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

```java
@Component
public class CouponService {
    private final CouponRepository couponRepository;  // ✅ Own Repository
    private final ApplicationEventPublisher eventPublisher;
    // ❌ Wrong: Injecting other domain Service/Repository is prohibited
    // private final OrderService orderService;
    // private final PointRepository pointRepository;

    public CouponService(CouponRepository couponRepository, ApplicationEventPublisher eventPublisher) {
        this.couponRepository = couponRepository;
        this.eventPublisher = eventPublisher;
    }

    @Transactional(readOnly = true)
    public Coupon findById(Long id) {
        final var coupon = couponRepository.findById(id);
        if (coupon == null) throw new CoreException(ErrorType.NOT_FOUND, "[couponId = " + id + "] Coupon not found.");
        return coupon;
    }

    @Transactional
    public Coupon issue(CouponCommand.Issue command) {
        final var coupon = Coupon.create(command.userId(), command.couponType());
        return couponRepository.save(coupon);
    }
}
```

### Facade (Cross-Domain)

```java
@Component
public class OrderFacade {
    private final OrderService orderService;     // ✅ Can combine multiple Services
    private final CouponService couponService;
    private final PointService pointService;
    private final ApplicationEventPublisher eventPublisher;

    public OrderFacade(OrderService orderService, CouponService couponService,
                       PointService pointService, ApplicationEventPublisher eventPublisher) {
        this.orderService = orderService;
        this.couponService = couponService;
        this.pointService = pointService;
        this.eventPublisher = eventPublisher;
    }

    @Transactional  // ✅ Transaction boundary is at Facade
    public OrderInfo.Create createOrder(OrderCriteria.Create criteria) {
        // 1. Use coupon (if present)
        if (criteria.couponId() != null) {
            couponService.use(new CouponCommand.Use(criteria.couponId()));
        }

        // 2. Deduct points (if present)
        if (criteria.pointAmount() != null) {
            pointService.use(new PointCommand.Use(criteria.userId(), criteria.pointAmount()));
        }

        // 3. Create order
        final var order = orderService.create(criteria.toCommand());

        // 4. Publish event
        eventPublisher.publishEvent(OrderCreatedEventV1.from(order));

        return OrderInfo.Create.from(order);
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

```java
// Service query method - readOnly for Slave DB routing
@Transactional(readOnly = true)
public List<Coupon> findAll(CouponQuery query)

// Service write method - @Transactional when atomicity needed within domain
@Transactional
public Coupon use(CouponCommand.Use command)
```

### ⚠️ Transaction Propagation Trap

Understanding propagation is critical when both Facade and Service have @Transactional.

```java
// Scenario: Both layers have @Transactional
@Component
class PointService {
    @Transactional  // propagation=REQUIRED (default)
    public Point use(PointCommand command) { ... }
}

@Component
class CouponService {
    @Transactional  // propagation=REQUIRED (default)
    public Coupon issue(CouponCommand command) { ... }
}

@Component
class RewardFacade {
    @Transactional
    public RewardInfo processReward(RewardCriteria criteria) {
        pointService.use(criteria.pointCommand());   // Participates in Facade's tx
        couponService.issue(criteria.couponCommand());  // Participates in Facade's tx
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

```java
@Component
public class OrderEventListener {
    private final NotificationService notificationService;  // ✅ Service call
    // ❌ Wrong: Direct Repository call is prohibited
    // private final NotificationRepository notificationRepository;

    public OrderEventListener(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCreated(OrderCreatedEventV1 event) {
        notificationService.sendOrderConfirmation(event.orderId());
    }
}
```

## Anti-Patterns

### ❌ Service → Service Horizontal Dependency

```java
// Wrong
@Component
public class OrderService {
    private final PointService pointService;  // Horizontal dependency!

    public Order createOrder(OrderCommand.Create command) {
        pointService.use(...);  // Calling another Service from Service
        ...
    }
}
```

### ❌ Facade → Facade Dependency

```java
// Wrong
@Component
public class OrderFacade {
    private final PaymentFacade paymentFacade;         // Facade-to-Facade dependency!
    private final NotificationFacade notificationFacade;  // Facade-to-Facade dependency!
    private final RewardFacade rewardFacade;           // Facade-to-Facade dependency!
}

// ✅ CORRECT: Event-based communication
@Component
public class OrderFacade {
    private final OrderService orderService;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public OrderInfo completeOrder(Long orderId) {
        final var order = orderService.complete(orderId);
        eventPublisher.publishEvent(OrderCompletedEventV1.from(order));
        return OrderInfo.from(order);
    }
}

// Other domains handle via event listeners
@Component
public class RewardEventListener {
    private final RewardService rewardService;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCompleted(OrderCompletedEventV1 event) {
        rewardService.accumulate(event.userId(), event.totalAmount());
    }
}
```

### ❌ Business Logic in Facade

```java
// Wrong - Business logic decisions in Facade
@Component
public class OrderFacade {
    @Transactional
    public void processOrder(Order order) {
        if (order.getType() == OrderType.REGULAR) {     // Business logic!
            shippingService.scheduleStandard(order);
        } else if (order.getType() == OrderType.SUBSCRIPTION) {  // Business logic!
            paymentService.setupAutoPayment(order);
            shippingService.scheduleStandard(order);
        } else if (order.getType() == OrderType.RESERVATION) {   // Business logic!
            reservationService.setReservationDate(order);
        }
    }
}

// ✅ CORRECT: Facade only coordinates, business logic in Service/Entity
@Component
public class OrderFacade {
    @Transactional
    public OrderInfo processOrder(OrderCriteria criteria) {
        return orderService.process(criteria.toCommand());  // Service handles type-specific processing
    }
}

@Component
public class OrderService {
    @Transactional
    public Order process(OrderCommand command) {
        final var order = orderRepository.findById(command.orderId());
        if (order == null) throw new CoreException(ErrorType.NOT_FOUND, "[orderId = " + command.orderId() + "] Order not found.");

        order.process();  // Entity handles type-specific processing (polymorphism or internal logic)
        return orderRepository.save(order);
    }
}
```

### ❌ Business Logic in EventListener

```java
// Wrong
@EventListener
public void onOrderCreated(OrderCreatedEventV1 event) {
    if (event.totalAmount() >= 100000) {  // Business logic leakage!
        // VIP notification
    } else {
        // Regular notification
    }
}

// Correct - Service makes the decision
@EventListener
public void onOrderCreated(OrderCreatedEventV1 event) {
    notificationService.sendOrderConfirmation(event.orderId());  // Service determines VIP status
}
```

### ❌ Infrastructure Import in Domain

```java
// Wrong: In domain/ package
package com.project.domain.coupon;

import com.project.infrastructure.persistence.CouponJpaRepository;  // ❌
import org.springframework.data.jpa.repository.JpaRepository;  // ❌
```

## Dependency Check Method

```java
// If these imports exist in domain/ package files, it's a violation:
import com.project.infrastructure.*;
import com.project.application.*;
import com.project.interfaces.*;
import org.springframework.data.*;
import org.springframework.web.*;
```

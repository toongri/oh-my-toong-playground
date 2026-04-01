# Entity Encapsulation and Null Safety Patterns

## Overview

**Rich Domain Model Required** - Entities MUST contain business logic, NOT be "simple data holders"

## Seven Rules of Entity Encapsulation

### Rule 1: Extend BaseEntity

ALL domain entities MUST extend `BaseEntity` which provides:
- `id` - Entity identifier
- `createdAt` - Creation timestamp
- `updatedAt` - Last modification timestamp
- `deletedAt` - Soft delete timestamp

### Rule 2: @Table with Indexes

ALWAYS define `@Table` with query-optimizing indexes.

```java
@Entity
@Table(
    name = "orders",
    indexes = {
        @Index(name = "idx_order_user_id", columnList = "user_id"),
        @Index(name = "idx_order_status", columnList = "status"),
        @Index(name = "idx_order_created_at", columnList = "created_at"),
    }
)
public class Order extends BaseEntity
```

### Rule 3: Private by Default

ALL mutable fields MUST be private with `@Getter` on the class. No `@Setter`.

```java
@Getter
public class Order extends BaseEntity {
    private OrderStatus status = OrderStatus.PENDING;  // External code cannot modify directly

    private Money totalAmount;  // ALL mutable fields are private — @Getter provides read access
}
```

### Rule 4: Behavior Methods

State changes via domain verbs (`use()`, `pay()`, `cancel()`), NOT setters.

```java
public void pay() {
    if (status != OrderStatus.PENDING) {
        throw new CoreException(ErrorType.BAD_REQUEST, "[orderId = " + getId() + "] 결제 가능한 상태가 아닙니다.");
    }
    this.status = OrderStatus.PAID;
}

public void use(Money amount) {
    if (balance.compareTo(amount) < 0) {
        throw new CoreException(ErrorType.BAD_REQUEST, "[pointId = " + getId() + "] 잔액이 부족합니다. 필요=" + amount + ", 보유=" + balance);
    }
    this.balance = balance.subtract(amount);
}
```

### Rule 5: Immutable Value Objects

VOs use `final` fields, operations return new instances.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money add(Money other) { return new Money(amount.add(other.amount()), currency); }  // returns new instance
    public Money subtract(Money other) { return new Money(amount.subtract(other.amount()), currency); }
    public boolean isPositive() { return amount.compareTo(BigDecimal.ZERO) > 0; }

    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.KRW);
}
```

### Rule 6: Constructor/Factory Validation

Validate in constructor or factory, never create invalid objects.

**모든 검증에 CoreException 사용** (`require()` 금지)

이유:
- 일관된 에러 응답 포맷
- 클라이언트에게 의미 있는 에러 코드 전달
- 로깅 및 모니터링 일관성

```java
// Validation in constructor body
if (!totalAmount.isPositive()) {
    throw new CoreException(ErrorType.BAD_REQUEST, "[totalAmount = " + totalAmount + "] 총 금액은 양수여야 합니다.");
}

// Static factory method
public static Order create(Long userId, Money totalAmount) {
    return new Order(userId, totalAmount);
}
```

### Rule 7: Publish Events for State Changes

Business-significant state changes SHOULD publish domain events via `registerEvent()`.

```java
public void pay() {
    if (status != OrderStatus.PENDING) {
        throw new CoreException(ErrorType.BAD_REQUEST, "[orderId = " + getId() + "] 결제 가능한 상태가 아닙니다.");
    }
    this.status = OrderStatus.PAID;
    registerEvent(OrderPaidEventV1.from(this));  // Event for downstream processing
}

public void use(Money amount) {
    if (balance.compareTo(amount) < 0) {
        throw new CoreException(ErrorType.BAD_REQUEST, "[pointId = " + getId() + "] 잔액이 부족합니다.");
    }
    this.balance = balance.subtract(amount);
    registerEvent(PointUsedEventV1.from(this, amount));  // Event for audit/notification
}
```

## Complete Rich Domain Entity Example

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(
    name = "orders",
    indexes = {
        @Index(name = "idx_order_user_id", columnList = "user_id"),
        @Index(name = "idx_order_status", columnList = "status"),
        @Index(name = "idx_order_created_at", columnList = "created_at"),
    }
)
public class Order extends BaseEntity {  // Rule 1: Extend BaseEntity

    private Long userId;

    private OrderStatus status = OrderStatus.PENDING;  // Rule 3: private field, @Getter on class

    private Money totalAmount;  // Rule 3: ALL mutable fields private

    private Order(Long userId, Money totalAmount) {
        if (!totalAmount.isPositive()) {  // Rule 6: Validate on construction
            throw new CoreException(ErrorType.BAD_REQUEST, "총 금액은 양수여야 합니다.");
        }
        this.userId = userId;
        this.totalAmount = totalAmount;
    }

    public void pay() {  // Rule 4: Behavior method
        if (status != OrderStatus.PENDING) {
            throw new CoreException(ErrorType.BAD_REQUEST, "[orderId = " + getId() + "] 결제 가능한 상태가 아닙니다.");
        }
        this.status = OrderStatus.PAID;
        registerEvent(OrderPaidEventV1.from(this));  // Rule 7: Publish event
    }

    public void cancel() {
        if (status == OrderStatus.COMPLETED) {
            throw new CoreException(ErrorType.BAD_REQUEST, "[orderId = " + getId() + "] 완료된 주문은 취소할 수 없습니다.");
        }
        this.status = OrderStatus.CANCELLED;
        registerEvent(OrderCancelledEventV1.from(this));
    }

    public static Order create(Long userId, Money totalAmount) {  // Rule 6: Factory method
        return new Order(userId, totalAmount);
    }
}
```

## Null Safety Patterns

### Non-nullable by Default

Required fields MUST be non-null.

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class Product extends BaseEntity {
    private String name;           // Required - never null
    private Money price;           // Required - never null
    private String description;    // Optional - may be null
}

// WRONG: nullable for required fields
private String name = null;  // Never do this for required fields
```

### Prohibit Unchecked Null Access

Use explicit null check with `CoreException` instead.

```java
// CORRECT: Explicit null check + CoreException
final var user = userRepository.findById(userId);
if (user == null) throw new CoreException(ErrorType.NOT_FOUND, "[userId = " + userId + "] 사용자를 찾을 수 없습니다.");

// FORBIDDEN: Never dereference a potentially-null reference without a check
```

### Null Checks for Optional Data

```java
// CORRECT: Java null checks
if (couponDiscount != null) {
    applyDiscount(couponDiscount);
}

final var totalDiscount = Stream.of(couponDiscount, pointDiscount, gradeDiscount)
    .filter(Objects::nonNull)
    .reduce(Money.ZERO, (acc, d) -> acc.add(d));

// WRONG: Assuming non-null without verification
applyDiscount(couponDiscount);  // NullPointerException if couponDiscount is null
```

## Domain Purity

### Dependency Direction

```
interfaces → application → domain ← infrastructure
```

**Rule**: Domain imports NOTHING from other layers (pure).

### Allowed in Domain

- JPA annotations: `@Entity`, `@Table`, `@Column`, `@Index`, `@ManyToOne`, etc.
- Java stdlib
- Domain events via `registerEvent()`

### Forbidden in Domain

```java
// These imports in domain/ package = VIOLATION
import org.springframework.stereotype.*;          // @Component, @Service
import org.springframework.transaction.*;         // @Transactional
import org.springframework.data.*;                // JpaRepository
import org.springframework.web.*;                 // @RestController
import com.fasterxml.jackson.annotation.*;        // @JsonProperty
import com.project.infrastructure.*;
import com.project.application.*;
import com.project.interfaces.*;
```

### Repository Abstraction (Domain Interface + Infrastructure Implementation)

```java
// Domain layer: Interface
package com.project.domain.order;

public interface OrderRepository {
    Order findById(Long id);
    Order save(Order order);
}

// Infrastructure layer: Implementation
package com.project.infrastructure.persistence.order;

@Repository
public class OrderRdbRepository implements OrderRepository {
    private final OrderJpaRepository orderJpaRepository;

    public OrderRdbRepository(OrderJpaRepository orderJpaRepository) {
        this.orderJpaRepository = orderJpaRepository;
    }

    @Override
    public Order findById(Long id) { return orderJpaRepository.findById(id).orElse(null); }

    @Override
    public Order save(Order order) { return orderJpaRepository.save(order); }
}
```

## Anti-Patterns

### Anemic Domain Model

```java
// WRONG: Entity as data holder with no behavior
@Entity
public class Order {
    private OrderStatus status;     // No private-only access control
    private BigDecimal totalAmount; // Service can modify directly via setter
    // No BaseEntity inheritance
}

// Service doing entity's job:
orderService.setOrderStatus(order, OrderStatus.PAID);  // External state change
```

### Entity Without BaseEntity

```java
// WRONG: Missing audit fields
@Entity
public class Product {
    @Id
    private Long id;  // Manual ID management
    private String name;
    // No createdAt, updatedAt, deletedAt
}
```

### @Setter on Entity

```java
// WRONG: Mutable state exposed via setter
@Getter
@Setter  // NEVER add @Setter to entities
@Entity
public class Order extends BaseEntity {
    private OrderStatus status = OrderStatus.PENDING;  // Anyone can call setStatus()
}

// External violation:
order.setStatus(OrderStatus.PAID);  // Bypasses business rules
```

### @Table Without Indexes

```java
// WRONG: Missing query optimization
@Entity
@Table(name = "orders")  // No indexes!
public class Order extends BaseEntity {}

// Will cause slow queries on: SELECT * FROM orders WHERE user_id = ?
```

### External State Changes

```java
// WRONG: State change outside entity
@Component
public class OrderService {
    public void pay(Order order) {
        order.setStatus(OrderStatus.PAID);  // Should be order.pay()
    }
}
```

### @JsonProperty in Domain

```java
// WRONG: Serialization concern in domain
@Entity
public class Order extends BaseEntity {
    @JsonProperty("order_status")  // Forbidden in domain
    private OrderStatus status;
}

// CORRECT: Use DTO in interfaces layer for JSON mapping
```

### Direct JPA Repository Injection in Domain

```java
// WRONG: Infrastructure dependency in domain
package com.project.domain.order;

@Component
public class OrderService {
    private final OrderJpaRepository orderJpaRepository;  // Infrastructure leak!
}

// CORRECT: Inject domain interface, not JPA repository
@Component
public class OrderService {
    private final OrderRepository orderRepository;  // Domain interface
}
```

## Why These Rules Matter

| Rule | Benefit |
|------|---------|
| BaseEntity | Consistent audit fields across all entities |
| private fields + @Getter | External code cannot corrupt domain state |
| Behavior methods | Business rules in ONE place (entity), not scattered |
| Factory validation | Invalid state objects are impossible |
| Domain events | Loose coupling between aggregates |
| Domain purity | Clean architecture, testable domain |

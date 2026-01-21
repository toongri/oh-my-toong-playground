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

```kotlin
@Entity
@Table(
    name = "orders",
    indexes = [
        Index(name = "idx_order_user_id", columnList = "user_id"),
        Index(name = "idx_order_status", columnList = "status"),
        Index(name = "idx_order_created_at", columnList = "created_at"),
    ]
)
class Order : BaseEntity()
```

### Rule 3: Private by Default

ALL mutable properties MUST use `private set`.

```kotlin
var status: OrderStatus = OrderStatus.PENDING
    private set  // External code cannot modify directly

var totalAmount: Money = totalAmount
    private set  // ALL mutable fields require private set
```

### Rule 4: Behavior Methods

State changes via domain verbs (`use()`, `pay()`, `cancel()`), NOT setters.

```kotlin
fun pay() {
    if (status != OrderStatus.PENDING) {
        throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 가능한 상태가 아닙니다.")
    }
    status = OrderStatus.PAID
}

fun use(amount: Money) {
    if (balance < amount) {
        throw CoreException(ErrorType.BAD_REQUEST, "[pointId = $id] 잔액이 부족합니다. 필요=${amount}, 보유=${balance}")
    }
    balance = balance - amount
}
```

### Rule 5: Immutable Value Objects

VOs use `val` for all fields, operations return new instances.

```kotlin
data class Money(
    val amount: BigDecimal,  // val, not var
    val currency: Currency
) {
    fun add(other: Money): Money = Money(amount + other.amount, currency)  // returns new instance
    fun subtract(other: Money): Money = Money(amount - other.amount, currency)
    fun isPositive(): Boolean = amount > BigDecimal.ZERO

    companion object {
        val ZERO = Money(BigDecimal.ZERO, Currency.KRW)
    }
}
```

### Rule 6: Constructor/Factory Validation

Validate in `init` block or factory, never create invalid objects.

```kotlin
init {
    if (!totalAmount.isPositive()) {
        throw CoreException(ErrorType.BAD_REQUEST, "총 금액은 양수여야 합니다.")
    }
}

companion object {
    fun create(userId: Long, totalAmount: Money): Order = Order(userId, totalAmount)
}
```

### Rule 7: Publish Events for State Changes

Business-significant state changes SHOULD publish domain events via `registerEvent()`.

```kotlin
fun pay() {
    if (status != OrderStatus.PENDING) {
        throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 가능한 상태가 아닙니다.")
    }
    status = OrderStatus.PAID
    registerEvent(OrderPaidEventV1.from(this))  // Event for downstream processing
}

fun use(amount: Money) {
    if (balance < amount) {
        throw CoreException(ErrorType.BAD_REQUEST, "[pointId = $id] 잔액이 부족합니다.")
    }
    balance = balance - amount
    registerEvent(PointUsedEventV1.from(this, amount))  // Event for audit/notification
}
```

## Complete Rich Domain Entity Example

```kotlin
@Entity
@Table(
    name = "orders",
    indexes = [
        Index(name = "idx_order_user_id", columnList = "user_id"),
        Index(name = "idx_order_status", columnList = "status"),
        Index(name = "idx_order_created_at", columnList = "created_at"),
    ]
)
class Order private constructor(
    val userId: Long,
    totalAmount: Money,
) : BaseEntity() {  // Rule 1: Extend BaseEntity

    var status: OrderStatus = OrderStatus.PENDING
        private set  // Rule 3: private set REQUIRED

    var totalAmount: Money = totalAmount
        private set  // Rule 3: ALL mutable fields

    fun pay() {  // Rule 4: Behavior method
        if (status != OrderStatus.PENDING) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 가능한 상태가 아닙니다.")
        }
        status = OrderStatus.PAID
        registerEvent(OrderPaidEventV1.from(this))  // Rule 7: Publish event
    }

    fun cancel() {
        if (status == OrderStatus.COMPLETED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 완료된 주문은 취소할 수 없습니다.")
        }
        status = OrderStatus.CANCELLED
        registerEvent(OrderCancelledEventV1.from(this))
    }

    init {  // Rule 6: Validate on construction
        if (!totalAmount.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "총 금액은 양수여야 합니다.")
        }
    }

    companion object {  // Rule 6: Factory method
        fun create(userId: Long, totalAmount: Money): Order = Order(userId, totalAmount)
    }
}
```

## Null Safety Patterns

### Non-nullable by Default

Required fields MUST be non-nullable.

```kotlin
@Entity
class Product(
    val name: String,           // Required - non-nullable
    val price: Money,           // Required - non-nullable
    val description: String?,   // Optional - nullable OK
)

// WRONG: nullable for required fields
var name: String? = null  // Never do this for required fields
```

### Prohibit `!!` Operator

Use Elvis operator with `CoreException` instead.

```kotlin
// CORRECT: Elvis + CoreException
val user = userRepository.findById(userId)
    ?: throw CoreException(ErrorType.NOT_FOUND, "[userId = $userId] 사용자를 찾을 수 없습니다.")

// FORBIDDEN: Never use !!
val user = userRepository.findById(userId)!!  // Will throw NPE with no context
```

### Safe Calls for Optional Data

```kotlin
// CORRECT: Kotlin idioms
couponDiscount?.let { discount -> applyDiscount(discount) }

val totalDiscount = listOfNotNull(
    couponDiscount,
    pointDiscount,
    gradeDiscount
).fold(Money.ZERO) { acc, d -> acc + d }

// WRONG: Java-style null checks
if (couponDiscount != null) {
    applyDiscount(couponDiscount)
}
```

## Domain Purity

### Dependency Direction

```
interfaces → application → domain ← infrastructure
```

**Rule**: Domain imports NOTHING from other layers (pure).

### Allowed in Domain

- JPA annotations: `@Entity`, `@Table`, `@Column`, `@Index`, `@ManyToOne`, etc.
- Kotlin stdlib
- Domain events via `registerEvent()`

### Forbidden in Domain

```kotlin
// These imports in domain/ package = VIOLATION
import org.springframework.stereotype.*          // @Component, @Service
import org.springframework.transaction.*         // @Transactional
import org.springframework.data.*                // JpaRepository
import org.springframework.web.*                 // @RestController
import com.fasterxml.jackson.annotation.*        // @JsonProperty
import com.project.infrastructure.*
import com.project.application.*
import com.project.interfaces.*
```

### Port/Adapter Pattern for Repositories

```kotlin
// Domain layer: Port (interface)
package com.project.domain.order

interface OrderRepository {
    fun findById(id: Long): Order?
    fun save(order: Order): Order
}

// Infrastructure layer: Adapter (implementation)
package com.project.infrastructure.persistence.order

@Repository
class OrderRepositoryImpl(
    private val orderJpaRepository: OrderJpaRepository
) : OrderRepository {
    override fun findById(id: Long): Order? = orderJpaRepository.findById(id).orElse(null)
    override fun save(order: Order): Order = orderJpaRepository.save(order)
}
```

## Anti-Patterns

### Anemic Domain Model

```kotlin
// WRONG: Entity as data holder with no behavior
@Entity
class Order(
    var status: OrderStatus,     // No private set
    var totalAmount: BigDecimal  // Service can modify directly
) // No BaseEntity inheritance

// Service doing entity's job:
orderService.setOrderStatus(order, OrderStatus.PAID)  // External state change
```

### Entity Without BaseEntity

```kotlin
// WRONG: Missing audit fields
@Entity
class Product(
    @Id val id: Long,  // Manual ID management
    val name: String
)  // No createdAt, updatedAt, deletedAt
```

### var Without private set

```kotlin
// WRONG: Mutable state exposed
@Entity
class Order : BaseEntity() {
    var status: OrderStatus = OrderStatus.PENDING  // Anyone can modify
}

// External violation:
order.status = OrderStatus.PAID  // Bypasses business rules
```

### @Table Without Indexes

```kotlin
// WRONG: Missing query optimization
@Entity
@Table(name = "orders")  // No indexes!
class Order : BaseEntity()

// Will cause slow queries on: SELECT * FROM orders WHERE user_id = ?
```

### External State Changes

```kotlin
// WRONG: State change outside entity
class OrderService {
    fun pay(order: Order) {
        order.status = OrderStatus.PAID  // Should be order.pay()
    }
}
```

### @JsonProperty in Domain

```kotlin
// WRONG: Serialization concern in domain
@Entity
class Order(
    @JsonProperty("order_status")  // Forbidden in domain
    var status: OrderStatus
) : BaseEntity()

// CORRECT: Use DTO in interfaces layer for JSON mapping
```

### Direct JPA Repository Injection in Domain

```kotlin
// WRONG: Infrastructure dependency in domain
package com.project.domain.order

class OrderService(
    private val orderJpaRepository: OrderJpaRepository  // Infrastructure leak!
)

// CORRECT: Inject domain interface, not JPA repository
class OrderService(
    private val orderRepository: OrderRepository  // Domain port
)
```

## Why These Rules Matter

| Rule | Benefit |
|------|---------|
| BaseEntity | Consistent audit fields across all entities |
| private set | External code cannot corrupt domain state |
| Behavior methods | Business rules in ONE place (entity), not scattered |
| Factory validation | Invalid state objects are impossible |
| Domain events | Loose coupling between aggregates |
| Domain purity | Clean architecture, testable domain |

# 엔티티 패턴

엔티티를 어떻게 설계하는지 — 캡슐화 7규칙과 리치 도메인 모델(Rich Domain Model)을 다룬다. 레이어 배치 자체는 [layer-boundaries.md](./layer-boundaries.md)를, `!!` 연산자 금지나 `?: throw CoreException` 같은 Null Safety 처방은 [error-handling.md](./error-handling.md)를 참고한다 — 이 문서는 엔티티 내부 설계에만 집중한다.

## 목차

1. **개요** — 리치 도메인 모델과 캡슐화 7규칙
2. **캡슐화 7규칙** — BaseEntity 상속부터 이벤트 발행까지
3. **완전한 리치 도메인 엔티티 예시** — 7규칙을 모두 적용한 Order
4. **안티패턴** — 캡슐화가 깨지는 7가지 흔한 실수
5. **왜 이 규칙들이 중요한가** — 규칙별 이득
6. **이런 생각이 들면 멈춰라** — Red Flags

---

## 1. 개요

**리치 도메인 모델이 필수다** — 엔티티는 비즈니스 로직을 담아야 하며, 단순한 "데이터 홀더"가 되어서는 안 된다. Service가 엔티티의 필드를 직접 바꾸는 대신, 엔티티 스스로가 자신의 상태 전이 규칙을 알고 있어야 한다.

이 원칙을 지키기 위해 이 프로젝트는 엔티티 캡슐화에 7가지 규칙을 강제한다: `BaseEntity` 상속, `@Table` 인덱스 정의, `private set`, 행위 메서드, 불변 값 객체(Value Object), 생성자/팩토리 검증, `registerEvent()`를 통한 이벤트 발행. 각 규칙의 근거와 코드는 2절에서 다룬다.

## 2. 캡슐화 7규칙

### 규칙 1: BaseEntity 상속

모든 도메인 엔티티는 `BaseEntity`를 상속해야 한다. `BaseEntity`는 다음을 제공한다.

- `id` — 엔티티 식별자
- `createdAt` — 생성 시각
- `updatedAt` — 마지막 수정 시각
- `deletedAt` — 소프트 삭제 시각

### 규칙 2: 인덱스가 있는 @Table

`@Table`은 항상 쿼리 최적화를 위한 인덱스와 함께 정의한다.

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

### 규칙 3: 기본값은 private

가변 프로퍼티는 모두 `private set`을 써야 한다.

```kotlin
var status: OrderStatus = OrderStatus.PENDING
    private set  // External code cannot modify directly

var totalAmount: Money = totalAmount
    private set  // ALL mutable fields require private set
```

### 규칙 4: 행위 메서드

상태 변경은 setter가 아니라 `use()`, `pay()`, `cancel()` 같은 도메인 동사 메서드로 한다.

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

### 규칙 5: 불변 값 객체

Value Object는 모든 필드에 `val`을 쓰고, 연산은 새 인스턴스를 반환한다.

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

### 규칙 6: 생성자/팩토리 검증

검증은 `init` 블록이나 팩토리에서 하고, 유효하지 않은 객체는 절대 만들지 않는다.

**모든 검증에 `CoreException`을 사용한다** (`require()` 금지). 이유는 다음과 같다.

- 일관된 에러 응답 포맷
- 클라이언트에게 의미 있는 에러 코드 전달
- 로깅 및 모니터링 일관성

```kotlin
init {
    if (!totalAmount.isPositive()) {
        throw CoreException(ErrorType.BAD_REQUEST, "[totalAmount = $totalAmount] 총 금액은 양수여야 합니다.")
    }
}

companion object {
    fun create(userId: Long, totalAmount: Money): Order = Order(userId, totalAmount)
}
```

### 규칙 7: 상태 변경 시 이벤트 발행

비즈니스적으로 의미 있는 상태 변경은 `registerEvent()`로 도메인 이벤트를 발행해야 한다.

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

> ⚠️ 주의: 이벤트를 발행할지 말지의 판단 기준("비즈니스적으로 의미 있는가")과 이벤트 자체의 5가지 요구사항(버전 접미사, `DomainEvent` 구현, `occurredAt`, 팩토리, 스냅샷)은 이 문서가 다루지 않는다 — [domain-events.md](./domain-events.md)를 참고한다.

## 3. 완전한 리치 도메인 엔티티 예시

7규칙을 모두 적용하면 다음과 같은 형태가 된다.

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

## 4. 안티패턴

### 빈약한 도메인 모델 (Anemic Domain Model)

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

### BaseEntity 없는 엔티티

```kotlin
// WRONG: Missing audit fields
@Entity
class Product(
    @Id val id: Long,  // Manual ID management
    val name: String
)  // No createdAt, updatedAt, deletedAt
```

### private set 없는 var

```kotlin
// WRONG: Mutable state exposed
@Entity
class Order : BaseEntity() {
    var status: OrderStatus = OrderStatus.PENDING  // Anyone can modify
}

// External violation:
order.status = OrderStatus.PAID  // Bypasses business rules
```

### 인덱스 없는 @Table

```kotlin
// WRONG: Missing query optimization
@Entity
@Table(name = "orders")  // No indexes!
class Order : BaseEntity()

// Will cause slow queries on: SELECT * FROM orders WHERE user_id = ?
```

### 엔티티 밖에서의 상태 변경

```kotlin
// WRONG: State change outside entity
class OrderService {
    fun pay(order: Order) {
        order.status = OrderStatus.PAID  // Should be order.pay()
    }
}
```

### 도메인의 @JsonProperty

```kotlin
// WRONG: Serialization concern in domain
@Entity
class Order(
    @JsonProperty("order_status")  // Forbidden in domain
    var status: OrderStatus
) : BaseEntity()

// CORRECT: Use DTO in interfaces layer for JSON mapping
```

### 도메인에서 JPA Repository 직접 주입

```kotlin
// WRONG: Infrastructure dependency in domain
package com.project.domain.order

class OrderService(
    private val orderJpaRepository: OrderJpaRepository  // Infrastructure leak!
)

// CORRECT: Inject domain interface, not JPA repository
class OrderService(
    private val orderRepository: OrderRepository  // Domain interface
)
```

이 안티패턴은 도메인이 인프라스트럭처를 알아서는 안 된다는 더 넓은 규칙의 한 사례다. 도메인 순수성의 전체 허용/금지 목록과 의존 방향은 [layer-boundaries.md](./layer-boundaries.md) 9절에서 다룬다.

## 5. 왜 이 규칙들이 중요한가

| 규칙 | 이득 |
|------|---------|
| BaseEntity | Consistent audit fields across all entities |
| private set | External code cannot corrupt domain state |
| Behavior methods | Business rules in ONE place (entity), not scattered |
| Factory validation | Invalid state objects are impossible |
| Domain events | Loose coupling between aggregates |
| Domain purity | Clean architecture, testable domain |

마지막 행 "Domain purity"의 상세는 이 문서가 다루는 엔티티 캡슐화의 범위를 넘는다 — [layer-boundaries.md](./layer-boundaries.md) 9절을 참고한다.

## 6. 이런 생각이 들면 멈춰라

| 이런 생각이 든다면 | 실제로는 |
|---|---|
| "Entity without BaseEntity" | ALL entities MUST extend BaseEntity |
| "var without private set" | ALL mutable properties need private set |
| "@Table without indexes" | ALWAYS define indexes |
| "Entity is just data holder" | Anemic domain model anti-pattern - entities MUST have behavior |
| "Skip validation in init" | Invalid objects are forbidden |

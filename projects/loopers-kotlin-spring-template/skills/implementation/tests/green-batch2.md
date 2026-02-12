# Green Batch 2 - Implementation Skill Test Results (IM-11 ~ IM-20)

## IM-11: 모든 가변 프로퍼티는 private set을 사용한다

### Generated Code

```kotlin
@Entity
@Table(
    name = "coupons",
    indexes = [
        Index(name = "idx_coupon_user_id", columnList = "user_id"),
        Index(name = "idx_coupon_status", columnList = "status"),
    ]
)
class Coupon private constructor(
    val userId: Long,
    val couponType: CouponType,
    discountAmount: Money,
) : BaseEntity() {

    var status: CouponStatus = CouponStatus.ISSUED
        private set

    var usedAt: Instant? = null
        private set

    var discountAmount: Money = discountAmount
        private set

    fun use() {
        if (status != CouponStatus.ISSUED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[couponId = $id] 사용 가능한 상태가 아닙니다.")
        }
        status = CouponStatus.USED
        usedAt = Instant.now()
        registerEvent(CouponUsedEventV1.from(this))
    }

    companion object {
        fun create(userId: Long, couponType: CouponType): Coupon =
            Coupon(userId, couponType, couponType.discountAmount)
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | status에 private set | PASS - `var status: CouponStatus = CouponStatus.ISSUED` 다음 줄 `private set` |
| V2 | usedAt에 private set | PASS - `var usedAt: Instant? = null` 다음 줄 `private set` |
| V3 | 외부에서 직접 상태 변경 불가 | PASS - 모든 var 프로퍼티(status, usedAt, discountAmount)에 private set 적용 |

---

## IM-12: 상태 변경은 도메인 동사 메서드로 수행한다

### Generated Code

```kotlin
@Entity
@Table(
    name = "orders",
    indexes = [
        Index(name = "idx_order_user_id", columnList = "user_id"),
        Index(name = "idx_order_status", columnList = "status"),
    ]
)
class Order private constructor(
    val userId: Long,
    totalAmount: Money,
) : BaseEntity() {

    var status: OrderStatus = OrderStatus.PENDING
        private set

    var totalAmount: Money = totalAmount
        private set

    fun pay() {
        if (status != OrderStatus.PENDING) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 가능한 상태가 아닙니다.")
        }
        status = OrderStatus.PAID
        registerEvent(OrderPaidEventV1.from(this))
    }

    fun cancel() {
        if (status == OrderStatus.COMPLETED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 완료된 주문은 취소할 수 없습니다.")
        }
        status = OrderStatus.CANCELLED
        registerEvent(OrderCancelledEventV1.from(this))
    }

    fun complete() {
        if (status != OrderStatus.PAID) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 완료 상태에서만 완료할 수 있습니다.")
        }
        status = OrderStatus.COMPLETED
        registerEvent(OrderCompletedEventV1.from(this))
    }

    init {
        if (!totalAmount.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[totalAmount = $totalAmount] 총 금액은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(userId: Long, totalAmount: Money): Order = Order(userId, totalAmount)
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인 동사 메서드 존재 | PASS - `fun pay()`, `fun cancel()`, `fun complete()` 존재 |
| V2 | setter 대신 행위 메서드 사용 | PASS - 외부에서 `order.status = ...` 직접 할당 불가 (private set) |
| V3 | 상태 전이 검증 포함 | PASS - 각 메서드 내 상태 체크 후 `CoreException` throw |

---

## IM-13: Value Object는 불변이며 연산 시 새 인스턴스를 반환한다

### Generated Code

```kotlin
data class Money(
    val amount: BigDecimal,
    val currency: Currency,
) {
    fun add(other: Money): Money {
        validateSameCurrency(other)
        return Money(amount + other.amount, currency)
    }

    fun subtract(other: Money): Money {
        validateSameCurrency(other)
        return Money(amount - other.amount, currency)
    }

    fun isPositive(): Boolean = amount > BigDecimal.ZERO

    fun isNegative(): Boolean = amount < BigDecimal.ZERO

    private fun validateSameCurrency(other: Money) {
        if (currency != other.currency) {
            throw CoreException(ErrorType.BAD_REQUEST, "[currency = $currency] 통화가 일치하지 않습니다. other=${other.currency}")
        }
    }

    companion object {
        val ZERO = Money(BigDecimal.ZERO, Currency.KRW)
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 모든 필드가 val | PASS - `val amount: BigDecimal`, `val currency: Currency` |
| V2 | 연산이 새 인스턴스 반환 | PASS - `fun add(other: Money): Money = Money(...)`, `fun subtract(other: Money): Money = Money(...)` |
| V3 | var 필드 없음 | PASS - `var` 키워드 미사용 |

---

## IM-14: Entity 생성 시 init 블록에서 검증하고 상태 변경 시 이벤트를 등록한다

### Generated Code

```kotlin
@Entity
@Table(
    name = "points",
    indexes = [
        Index(name = "idx_point_user_id", columnList = "user_id"),
        Index(name = "idx_point_status", columnList = "status"),
    ]
)
class Point private constructor(
    val userId: Long,
    balance: Money,
) : BaseEntity() {

    var balance: Money = balance
        private set

    var status: PointStatus = PointStatus.ACTIVE
        private set

    fun use(amount: Money) {
        if (status != PointStatus.ACTIVE) {
            throw CoreException(ErrorType.BAD_REQUEST, "[pointId = $id] 활성 상태가 아닌 포인트입니다.")
        }
        if (balance < amount) {
            throw CoreException(
                ErrorType.INSUFFICIENT_BALANCE,
                "[pointId = $id] 잔액이 부족합니다. 필요=${amount}, 보유=${balance}"
            )
        }
        balance = balance.subtract(amount)
        registerEvent(PointUsedEventV1.from(this, amount))
    }

    fun expire() {
        if (status != PointStatus.ACTIVE) {
            throw CoreException(ErrorType.BAD_REQUEST, "[pointId = $id] 현재 상태에서 만료할 수 없습니다. 현재상태=${status}")
        }
        status = PointStatus.EXPIRED
        registerEvent(PointExpiredEventV1.from(this))
    }

    init {
        if (!balance.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[balance = $balance] 초기 잔액은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(userId: Long, balance: Money): Point = Point(userId, balance)
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | init 블록에서 CoreException 검증 | PASS - `init { if (!balance.isPositive()) throw CoreException(...) }` |
| V2 | require() 미사용 | PASS - `require(...)` 호출 없음 |
| V3 | 상태 변경 시 registerEvent 호출 | PASS - `registerEvent(PointUsedEventV1.from(...))`, `registerEvent(PointExpiredEventV1.from(...))` |

---

## IM-15: 클래스 이름은 정해진 패턴을 따른다

### Generated Code

```kotlin
// Interface Layer
interface ShippingV1ApiSpec {
    fun start(request: ShippingV1Request.Start): ApiResponse<ShippingV1Response.Start>
    fun findAll(page: Int, size: Int): ApiResponse<ShippingV1Response.FindAll>
}

@RestController
@RequestMapping("/api/v1/shippings")
class ShippingV1Controller(
    private val shippingFacade: ShippingFacade,
) : ShippingV1ApiSpec {

    @PostMapping
    override fun start(
        @RequestBody request: ShippingV1Request.Start,
    ): ApiResponse<ShippingV1Response.Start> {
        val criteria = request.toCriteria()
        return shippingFacade.start(criteria)
            .let { ShippingV1Response.Start.from(it) }
            .let { ApiResponse.success(it) }
    }

    @GetMapping
    override fun findAll(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
    ): ApiResponse<ShippingV1Response.FindAll> {
        val query = ShippingPageQuery(page = page, size = size)
        return shippingFacade.findAll(query)
            .let { ShippingV1Response.FindAll.from(it) }
            .let { ApiResponse.success(it) }
    }
}

// Application Layer
@Component
class ShippingFacade(
    private val shippingService: ShippingService,
) {
    @Transactional
    fun start(criteria: ShippingCriteria.Start): ShippingInfo.Start {
        val shipping = shippingService.start(criteria.to())
        return ShippingInfo.Start.from(shipping)
    }

    @Transactional(readOnly = true)
    fun findAll(query: ShippingPageQuery): ShippingInfo.FindAll {
        val shippings = shippingService.findAll(query)
        return ShippingInfo.FindAll.from(shippings)
    }
}

// Domain Layer
@Component
class ShippingService(
    private val shippingRepository: ShippingRepository,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional
    fun start(command: ShippingCommand.Start): Shipping {
        val shipping = Shipping.create(command.orderId, command.address)
        val savedShipping = shippingRepository.save(shipping)
        eventPublisher.publishEvent(ShippingStartedEventV1.from(savedShipping))
        return savedShipping
    }

    @Transactional(readOnly = true)
    fun findAll(query: ShippingPageQuery): List<Shipping> {
        return shippingRepository.findAll(query)
    }
}

interface ShippingRepository {
    fun findById(id: Long): Shipping?
    fun save(shipping: Shipping): Shipping
    fun findAll(query: ShippingPageQuery): List<Shipping>
}

data class ShippingStartedEventV1(
    val shippingId: Long,
    val orderId: Long,
    override val occurredAt: Instant = Instant.now(),
) : DomainEvent {
    companion object {
        fun from(shipping: Shipping): ShippingStartedEventV1 = ShippingStartedEventV1(
            shippingId = shipping.id,
            orderId = shipping.orderId,
        )
    }
}

data class ShippingPageQuery(
    val page: Int,
    val size: Int,
    val status: ShippingStatus? = null,
) {
    init {
        if (page < 0) {
            throw CoreException(ErrorType.BAD_REQUEST, "[page = $page] 페이지는 0 이상이어야 합니다.")
        }
        if (size !in 1..100) {
            throw CoreException(ErrorType.BAD_REQUEST, "[size = $size] 페이지 크기는 1~100이어야 합니다.")
        }
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | Controller 명명 규칙 | PASS - `ShippingV1Controller` |
| V2 | Facade/Service 명명 규칙 | PASS - `ShippingFacade`, `ShippingService` |
| V3 | Event/PageQuery 명명 규칙 | PASS - `ShippingStartedEventV1`, `ShippingPageQuery` |
| V4 | ApiSpec 명명 규칙 | PASS - `ShippingV1ApiSpec` |

---

## IM-16: 메서드 이름은 도메인 동사를 사용한다

### Generated Code

```kotlin
class Coupon : BaseEntity() {

    var status: CouponStatus = CouponStatus.ISSUED
        private set

    var usedAt: Instant? = null
        private set

    fun use() {
        if (status != CouponStatus.ISSUED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[couponId = $id] 사용 가능한 상태가 아닙니다.")
        }
        status = CouponStatus.USED
        usedAt = Instant.now()
        registerEvent(CouponUsedEventV1.from(this))
    }

    fun expire() {
        if (status != CouponStatus.ISSUED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[couponId = $id] 만료 가능한 상태가 아닙니다.")
        }
        status = CouponStatus.EXPIRED
        registerEvent(CouponExpiredEventV1.from(this))
    }

    fun cancel() {
        if (status == CouponStatus.USED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[couponId = $id] 이미 사용된 쿠폰은 취소할 수 없습니다.")
        }
        status = CouponStatus.CANCELLED
        registerEvent(CouponCancelledEventV1.from(this))
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인 동사 사용 | PASS - `use()`, `expire()`, `cancel()` |
| V2 | 기술적 동사 미사용 | PASS - `processUsage()`, `handleExpiration()`, `executeCancellation()` 없음 |

---

## IM-17: 변수명은 축약 없이 전체 서술형으로 작성한다

### Generated Code

```kotlin
class OrderCalculator {
    fun calculateFinalAmount(
        totalProductAmount: Money,
        discountAmount: Money,
        shippingFee: Money,
    ): Money {
        val discountedAmount = totalProductAmount.subtract(discountAmount)
        val finalPaymentAmount = discountedAmount.add(shippingFee)

        if (finalPaymentAmount.isNegative()) {
            throw CoreException(ErrorType.BAD_REQUEST,
                "[finalPaymentAmount = $finalPaymentAmount] 최종 결제 금액은 음수일 수 없습니다.")
        }

        return finalPaymentAmount
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 전체 서술형 변수명 사용 | PASS - `totalProductAmount`, `discountAmount`, `shippingFee`, `finalPaymentAmount` |
| V2 | 축약 변수명 미사용 | PASS - `amt`, `disc`, `qty`, `fee` 단독 사용 없음 |

---

## IM-18: Boolean 이름은 is/has/canBe 접두사를 사용한다

### Generated Code

```kotlin
class Coupon : BaseEntity() {

    var status: CouponStatus = CouponStatus.ISSUED
        private set

    var remainingQuantity: Int = 0
        private set

    var expirationDate: LocalDateTime = LocalDateTime.now()
        private set

    val isExpired: Boolean
        get() = expirationDate.isBefore(LocalDateTime.now())

    fun hasRemainingQuantity(): Boolean = remainingQuantity > 0

    fun canBeUsed(): Boolean =
        status == CouponStatus.ISSUED && !isExpired && hasRemainingQuantity()
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | is{Adjective} 패턴 | PASS - `isExpired` |
| V2 | has{Noun} 패턴 | PASS - `hasRemainingQuantity()` |
| V3 | canBe{Verb} 패턴 | PASS - `canBeUsed()` |

---

## IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다

### Generated Code

```kotlin
// Domain Layer - Entity (JPA 어노테이션만 허용)
package com.project.domain.order

import jakarta.persistence.Entity
import jakarta.persistence.Table
import jakarta.persistence.Index
import jakarta.persistence.Column
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
// @Transactional, @JsonProperty, Spring Data - 사용 금지

@Entity
@Table(
    name = "orders",
    indexes = [
        Index(name = "idx_order_user_id", columnList = "user_id"),
        Index(name = "idx_order_status", columnList = "status"),
    ]
)
class Order private constructor(
    @Column(name = "user_id", nullable = false)
    val userId: Long,
    totalAmount: Money,
) : BaseEntity() {

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    var status: OrderStatus = OrderStatus.PENDING
        private set

    var totalAmount: Money = totalAmount
        private set

    fun pay() {
        if (status != OrderStatus.PENDING) {
            throw CoreException(ErrorType.BAD_REQUEST, "[orderId = $id] 결제 가능한 상태가 아닙니다.")
        }
        status = OrderStatus.PAID
        registerEvent(OrderPaidEventV1.from(this))
    }

    init {
        if (!totalAmount.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[totalAmount = $totalAmount] 총 금액은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(userId: Long, totalAmount: Money): Order = Order(userId, totalAmount)
    }
}

// Domain Layer - Service (@Component 허용, @Transactional 사용)
package com.project.domain.order

import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

@Component
class OrderService(
    private val orderRepository: OrderRepository,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): Order {
        return orderRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = $id] 주문을 찾을 수 없습니다.")
    }

    @Transactional
    fun pay(command: OrderCommand.Pay): Order {
        val order = orderRepository.findById(command.orderId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = ${command.orderId}] 주문을 찾을 수 없습니다.")

        order.pay()
        return orderRepository.save(order)
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | Entity에 JPA 어노테이션 허용 | PASS - `@Entity`, `@Table`, `@Column`, `@Enumerated` 사용 |
| V2 | Entity에 @Transactional 없음 | PASS - Entity 클래스에 `@Transactional` import/사용 없음 |
| V3 | Entity에 @JsonProperty 없음 | PASS - `@JsonProperty`, `@JsonIgnore` import/사용 없음 |
| V4 | Entity에 Spring Data import 없음 | PASS - `org.springframework.data.*` import 없음 |

---

## IM-20: Repository는 도메인에 인터페이스, 인프라에 구현체를 둔다

### Generated Code

```kotlin
// Domain Layer - Interface
package com.project.domain.order

interface OrderRepository {
    fun findById(id: Long): Order?
    fun save(order: Order): Order
    fun findAllByUserId(userId: Long): List<Order>
}

// Infrastructure Layer - Implementation
package com.project.infrastructure.persistence.order

import com.project.domain.order.Order
import com.project.domain.order.OrderRepository
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository

@Repository
class OrderRdbRepository(
    private val orderJpaRepository: OrderJpaRepository,
) : OrderRepository {

    override fun findById(id: Long): Order? =
        orderJpaRepository.findById(id).orElse(null)

    override fun save(order: Order): Order =
        orderJpaRepository.save(order)

    override fun findAllByUserId(userId: Long): List<Order> =
        orderJpaRepository.findAllByUserId(userId)
}

interface OrderJpaRepository : JpaRepository<Order, Long> {
    fun findAllByUserId(userId: Long): List<Order>
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인에 인터페이스 존재 | PASS - `interface OrderRepository` in `domain/order/` |
| V2 | 인프라에 구현체 존재 | PASS - `class OrderRdbRepository : OrderRepository` in `infrastructure/` |
| V3 | 도메인에 JPA import 없음 | PASS - Domain interface에 `JpaRepository` import 없음 |

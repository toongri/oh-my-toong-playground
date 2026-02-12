# Application Scenarios - Implementation Skill

29개의 Application Scenario로 구성. 각 시나리오는 Implementation SKILL.md의 특정 규칙/하위규칙을 검증한다.

## Scenario Format

각 시나리오는 다음 구조를 따른다:
- **ID**: IM-XX
- **Rule**: 해당 규칙 번호 및 이름
- **Sub-rule**: 테스트 대상 하위규칙
- **Input**: 한국어 개발 과제 (+ 필요시 코드 컨텍스트)
- **Verification Points**: 검증 항목 (2-4개)
- **Expected Correct Output**: 규칙을 올바르게 따른 Kotlin 코드

---

### IM-01: Controller는 Facade만 주입한다

**Rule**: 1. Controller Flow
**Sub-rule**: Controller -> Facade -> Service (never Controller -> Service)

**Input**:
상품 도메인에 "상품 상세 조회" API 엔드포인트를 추가해 주세요. GET /api/v1/products/{id} 엔드포인트입니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Controller 생성자에 Facade 주입 | `private val productFacade: ProductFacade` 존재 |
| V2 | Controller 생성자에 Service 직접 주입 없음 | `ProductService` 주입 없음 |
| V3 | Controller가 ApiSpec 구현 | `: ProductV1ApiSpec` 존재 |

**Expected Correct Output**:
```kotlin
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,  // Facade, NOT Service
) : ProductV1ApiSpec {

    @GetMapping("/{id}")
    override fun getDetail(
        @PathVariable id: Long,
    ): ApiResponse<ProductV1Response.Detail> {
        val criteria = ProductCriteria.FindById(productId = id)
        return productFacade.findById(criteria)
            .let { ProductV1Response.Detail.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

---

### IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Facade @Transactional + multi-Service coordination

**Input**:
주문 생성 기능을 구현해 주세요. 주문 시 쿠폰 사용과 포인트 차감이 함께 이루어져야 합니다. 세 도메인(주문, 쿠폰, 포인트)의 작업이 하나의 트랜잭션으로 묶여야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에 @Transactional 선언 | `@Transactional` 어노테이션 존재 |
| V2 | 다수 Service 주입 | `orderService`, `couponService`, `pointService` 주입 |
| V3 | Facade가 비즈니스 로직 없이 조율만 수행 | if/when/switch 조건 분기 없음 |

**Expected Correct Output**:
```kotlin
@Component
class OrderFacade(
    private val orderService: OrderService,
    private val couponService: CouponService,
    private val pointService: PointService,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional
    fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
        criteria.couponId?.let { couponId ->
            couponService.use(CouponCommand.Use(couponId))
        }

        criteria.pointAmount?.let { amount ->
            pointService.use(PointCommand.Use(criteria.userId, amount))
        }

        val order = orderService.create(criteria.to())
        eventPublisher.publishEvent(OrderCreatedEventV1.from(order))

        return OrderInfo.Create.from(order)
    }
}
```

---

### IM-03: Service는 단일 도메인에만 의존하고 조회에 readOnly를 사용한다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Service single domain + readOnly

**Input**:
쿠폰 도메인의 Service를 구현해 주세요. 쿠폰 ID로 단건 조회하는 메서드와 쿠폰을 발급하는 메서드가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 다른 도메인 Service 주입 없음 | `OrderService`, `PointService` 등 타 도메인 Service 없음 |
| V2 | 조회 메서드에 readOnly=true | `@Transactional(readOnly = true)` 존재 |
| V3 | 자기 도메인 Repository만 주입 | `couponRepository: CouponRepository`만 존재 |

**Expected Correct Output**:
```kotlin
@Component
class CouponService(
    private val couponRepository: CouponRepository,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): Coupon {
        return couponRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[couponId = $id] 쿠폰을 찾을 수 없습니다.")
    }

    @Transactional
    fun issue(command: CouponCommand.Issue): Coupon {
        val coupon = Coupon.create(command.userId, command.couponType)
        return couponRepository.save(coupon)
    }
}
```

---

### IM-04: Facade에는 비즈니스 로직을 두지 않는다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Facade coordination only

**Input**:
주문 처리 기능을 구현해 주세요. 주문 유형(일반/구독/예약)에 따라 다른 처리 로직이 필요합니다.

기존 코드 컨텍스트:
```kotlin
enum class OrderType { REGULAR, SUBSCRIPTION, RESERVATION }
```

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에 if/when/switch 분기 없음 | 조건 분기가 Service 또는 Entity에 위임됨 |
| V2 | Facade는 Service 호출만 수행 | `orderService.process(...)` 형태의 단순 위임 |
| V3 | 비즈니스 로직이 Service/Entity에 존재 | Service 또는 Entity 내부에서 타입별 분기 처리 |

**Expected Correct Output**:
```kotlin
// Facade - 조율만 담당
@Component
class OrderFacade(
    private val orderService: OrderService,
) {
    @Transactional
    fun processOrder(criteria: OrderCriteria.Process): OrderInfo.Process {
        val order = orderService.process(criteria.to())
        return OrderInfo.Process.from(order)
    }
}

// Service - 비즈니스 로직 담당
@Component
class OrderService(
    private val orderRepository: OrderRepository,
) {
    @Transactional
    fun process(command: OrderCommand.Process): Order {
        val order = orderRepository.findById(command.orderId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = ${command.orderId}] 주문을 찾을 수 없습니다.")

        order.process()  // Entity 내부에서 타입별 처리
        return orderRepository.save(order)
    }
}
```

---

### IM-05: 단일 CoreException + ErrorType 패턴을 사용한다

**Rule**: 3. Error Handling
**Sub-rule**: CoreException + ErrorType

**Input**:
포인트 도메인에서 다음 에러 상황들을 처리해 주세요:
1. 포인트 조회 시 존재하지 않는 경우
2. 잔액 부족으로 포인트 사용이 불가한 경우
3. 이미 만료된 포인트를 사용하려는 경우

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | CoreException만 사용 | `throw CoreException(...)` 패턴만 존재 |
| V2 | ErrorType enum 활용 | `ErrorType.NOT_FOUND`, `ErrorType.INSUFFICIENT_BALANCE`, `ErrorType.BAD_REQUEST` 사용 |
| V3 | require() 사용 없음 | `require(...)` 호출 없음 |
| V4 | 도메인별 Exception 클래스 없음 | `PointException`, `PointNotFoundException` 등 없음 |

**Expected Correct Output**:
```kotlin
@Component
class PointService(
    private val pointRepository: PointRepository,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): Point {
        return pointRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[pointId = $id] 포인트를 찾을 수 없습니다.")
    }

    @Transactional
    fun use(command: PointCommand.Use): Point {
        val point = pointRepository.findById(command.pointId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[pointId = ${command.pointId}] 포인트를 찾을 수 없습니다.")

        point.use(command.amount)
        return pointRepository.save(point)
    }
}

// Entity 내부
class Point : BaseEntity() {
    fun use(amount: Money) {
        if (status == PointStatus.EXPIRED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[pointId = $id] 이미 만료된 포인트입니다.")
        }
        if (balance < amount) {
            throw CoreException(
                ErrorType.INSUFFICIENT_BALANCE,
                "[pointId = $id] 잔액이 부족합니다. 필요=${amount}, 보유=${balance}"
            )
        }
        balance = balance - amount
    }
}
```

---

### IM-06: DTO 변환 체인을 완전하게 구성한다

**Rule**: 4. DTO Flow
**Sub-rule**: Full transformation chain

**Input**:
쿠폰 발급 API를 구현해 주세요. POST /api/v1/coupons 엔드포인트이며, 사용자 ID와 쿠폰 타입을 받아 쿠폰을 발급합니다. Request -> Criteria -> Command -> Entity -> Info -> Response 전체 흐름을 구현해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Request.toCriteria() 변환 존재 | `CouponV1Request.Issue`에 `toCriteria()` 메서드 |
| V2 | Criteria.to() 변환 존재 | `CouponCriteria.Issue`에 `to()` 메서드 |
| V3 | Info.from(entity) 팩토리 존재 | `CouponInfo.Issue`에 `companion object { fun from(coupon) }` |
| V4 | Response.from(info) 팩토리 존재 | `CouponV1Response.Issue`에 `companion object { fun from(info) }` |

**Expected Correct Output**:
```kotlin
// Interface Layer - Request
class CouponV1Request {
    data class Issue(
        @field:Schema(description = "사용자 ID", required = true)
        val userId: Long,
        @field:Schema(description = "쿠폰 타입", required = true)
        val couponType: String,
    ) {
        fun toCriteria(): CouponCriteria.Issue {
            return CouponCriteria.Issue(
                userId = userId,
                couponType = CouponType.valueOf(couponType),
            )
        }
    }
}

// Application Layer - Criteria
class CouponCriteria {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
    ) {
        fun to(): CouponCommand.Issue {
            return CouponCommand.Issue(
                userId = userId,
                couponType = couponType,
            )
        }
    }
}

// Domain Layer - Command
class CouponCommand {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
    )
}

// Application Layer - Info
class CouponInfo {
    data class Issue(
        val couponId: Long,
        val code: String,
        val expirationDate: LocalDateTime,
    ) {
        companion object {
            fun from(coupon: Coupon): Issue {
                return Issue(
                    couponId = coupon.id,
                    code = coupon.code,
                    expirationDate = coupon.expirationDate,
                )
            }
        }
    }
}

// Interface Layer - Response
class CouponV1Response {
    data class Issue(
        val couponId: Long,
        val code: String,
        val expirationDate: LocalDateTime,
    ) {
        companion object {
            fun from(info: CouponInfo.Issue): Issue {
                return Issue(
                    couponId = info.couponId,
                    code = info.code,
                    expirationDate = info.expirationDate,
                )
            }
        }
    }
}

// Controller Flow
@RestController
@RequestMapping("/api/v1/coupons")
class CouponV1Controller(
    private val couponFacade: CouponFacade,
) : CouponV1ApiSpec {

    @PostMapping
    override fun issue(
        @RequestBody request: CouponV1Request.Issue,
    ): ApiResponse<CouponV1Response.Issue> {
        val criteria = request.toCriteria()
        return couponFacade.issue(criteria)
            .let { CouponV1Response.Issue.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

---

### IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다

**Rule**: 5. Domain Events
**Sub-rule**: Event structure (naming/interface/occurredAt/factory/snapshots)

**Input**:
주문 생성 시 발행할 도메인 이벤트를 구현해 주세요. 주문에는 주문 항목(OrderItem) 목록이 포함되며, 이벤트에 주문 항목 정보도 함께 담아야 합니다.

기존 코드 컨텍스트:
```kotlin
class OrderItem(
    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: Money,
)
```

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 이벤트명에 V{n} 접미사 | `OrderCreatedEventV1` |
| V2 | DomainEvent 인터페이스 구현 | `: DomainEvent` |
| V3 | occurredAt 필드 존재 | `override val occurredAt: Instant = Instant.now()` |
| V4 | 자식 엔티티에 Snapshot 사용 | `OrderItemSnapshot` 클래스 + `companion object { fun from(...) }` |

**Expected Correct Output**:
```kotlin
data class OrderCreatedEventV1(
    val orderId: Long,
    val userId: Long,
    val totalAmount: Money,
    val items: List<OrderItemSnapshot>,
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

---

### IM-08: 동기 이벤트 리스너는 BEFORE_COMMIT으로 구성한다

**Rule**: 6. EventListener
**Sub-rule**: Sync listener (BEFORE_COMMIT)

**Input**:
주문 생성 시 Outbox 테이블에 이벤트를 저장하는 동기 리스너를 구현해 주세요. 주문 트랜잭션과 동일한 트랜잭션 내에서 실행되어야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | BEFORE_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)` |
| V2 | 로깅 포맷 준수 | `logger.info("[Event] ... start/complete - eventType: ..., id: ...")` |
| V3 | @Async 없음 | `@Async` 어노테이션 미사용 |

**Expected Correct Output**:
```kotlin
@Component
class OrderOutboxListener(
    private val outboxService: OutboxService,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        logger.info("[Event] Order outbox save start - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
        outboxService.save(OutboxCommand.Create(
            eventType = "ORDER_CREATED",
            payload = event,
        ))
        logger.info("[Event] Order outbox save complete - eventType: ${event::class.simpleName}, orderId: ${event.orderId}")
    }
}
```

---

### IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다

**Rule**: 6. EventListener
**Sub-rule**: Async listener (AFTER_COMMIT)

**Input**:
주문 생성 후 사용자에게 알림을 보내는 비동기 이벤트 리스너를 구현해 주세요. 알림 발송 실패가 주문 트랜잭션에 영향을 주면 안 됩니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | @Async 어노테이션 존재 | `@Async` 사용 |
| V2 | AFTER_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` |
| V3 | try-catch 에러 핸들링 | `try { ... } catch (e: Exception) { logger.error(...) }` |
| V4 | 로깅 포맷 준수 | start/complete/failed 로깅 포함 |

**Expected Correct Output**:
```kotlin
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
        }
    }
}
```

---

### IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: BaseEntity + @Table indexes

**Input**:
상품(Product) 엔티티를 새로 만들어 주세요. 상품명(name), 가격(price), 카테고리 ID(categoryId) 필드가 있습니다. 상품명 검색과 카테고리별 조회가 빈번합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | BaseEntity 상속 | `: BaseEntity()` |
| V2 | @Table에 indexes 정의 | `indexes = [Index(...)]` 존재 |
| V3 | 쿼리 빈도 기반 인덱스 | `name`, `category_id` 컬럼에 대한 인덱스 |

**Expected Correct Output**:
```kotlin
@Entity
@Table(
    name = "products",
    indexes = [
        Index(name = "idx_product_name", columnList = "name"),
        Index(name = "idx_product_category_id", columnList = "category_id"),
    ]
)
class Product private constructor(
    val name: String,
    price: Money,
    val categoryId: Long,
) : BaseEntity() {

    var price: Money = price
        private set

    init {
        if (name.isBlank()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[name = $name] 상품명은 비어있을 수 없습니다.")
        }
        if (!price.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[price = $price] 가격은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(name: String, price: Money, categoryId: Long): Product =
            Product(name, price, categoryId)
    }
}
```

---

### IM-11: 모든 가변 프로퍼티는 private set을 사용한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: private set

**Input**:
쿠폰(Coupon) 엔티티를 구현해 주세요. 상태(status), 사용일시(usedAt), 할인금액(discountAmount) 필드가 있으며 상태와 사용일시는 변경될 수 있습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | status에 private set | `var status: CouponStatus = ... private set` |
| V2 | usedAt에 private set | `var usedAt: Instant? = null private set` |
| V3 | 외부에서 직접 상태 변경 불가 | setter가 모두 private |

**Expected Correct Output**:
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

---

### IM-12: 상태 변경은 도메인 동사 메서드로 수행한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Behavior methods

**Input**:
주문(Order) 엔티티에 결제(pay), 취소(cancel), 완료(complete) 기능을 구현해 주세요. 각 상태 전이에는 유효성 검증이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인 동사 메서드 존재 | `fun pay()`, `fun cancel()`, `fun complete()` |
| V2 | setter 대신 행위 메서드 사용 | `order.status = ...` 직접 할당 없음 (외부에서) |
| V3 | 상태 전이 검증 포함 | 각 메서드 내 상태 체크 후 CoreException |

**Expected Correct Output**:
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

---

### IM-13: Value Object는 불변이며 연산 시 새 인스턴스를 반환한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Immutable VOs

**Input**:
금액을 표현하는 Money Value Object를 구현해 주세요. 더하기, 빼기 연산과 양수/음수 확인 기능이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 모든 필드가 val | `val amount: BigDecimal`, `val currency: Currency` |
| V2 | 연산이 새 인스턴스 반환 | `fun add(other: Money): Money = Money(...)` |
| V3 | var 필드 없음 | `var` 키워드 미사용 |

**Expected Correct Output**:
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
            throw CoreException(ErrorType.BAD_REQUEST, "[currency = $currency] 통화가 일치하지 않습니다. other=${ other.currency}")
        }
    }

    companion object {
        val ZERO = Money(BigDecimal.ZERO, Currency.KRW)
    }
}
```

---

### IM-14: Entity 생성 시 init 블록에서 검증하고 상태 변경 시 이벤트를 등록한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Init validation + registerEvent

**Input**:
포인트(Point) 엔티티를 구현해 주세요. 생성 시 초기 잔액은 양수여야 합니다. 포인트 사용 시 잔액 검증 후 이벤트를 발행해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | init 블록에서 CoreException 검증 | `init { if (...) throw CoreException(...) }` |
| V2 | require() 미사용 | `require(...)` 호출 없음 |
| V3 | 상태 변경 시 registerEvent 호출 | `registerEvent(PointUsedEventV1.from(...))` |

**Expected Correct Output**:
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

---

### IM-15: 클래스 이름은 정해진 패턴을 따른다

**Rule**: 8. Naming
**Sub-rule**: Class naming

**Input**:
배송(Shipping) 도메인의 전체 레이어 클래스를 구현해 주세요. Controller, ApiSpec, Facade, Service, Repository, Event, PageQuery 클래스가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Controller 명명 규칙 | `ShippingV1Controller` |
| V2 | Facade/Service 명명 규칙 | `ShippingFacade`, `ShippingService` |
| V3 | Event/PageQuery 명명 규칙 | `ShippingStartedEventV1`, `ShippingPageQuery` |
| V4 | ApiSpec 명명 규칙 | `ShippingV1ApiSpec` |

**Expected Correct Output**:
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
    // ...
}

// Application Layer
@Component
class ShippingFacade(
    private val shippingService: ShippingService,
) {
    // ...
}

// Domain Layer
@Component
class ShippingService(
    private val shippingRepository: ShippingRepository,
) {
    // ...
}

interface ShippingRepository {
    fun findById(id: Long): Shipping?
    fun save(shipping: Shipping): Shipping
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

---

### IM-16: 메서드 이름은 도메인 동사를 사용한다

**Rule**: 8. Naming
**Sub-rule**: Method naming

**Input**:
쿠폰 엔티티에 사용(use), 만료(expire), 취소(cancel) 기능 메서드를 구현해 주세요.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인 동사 사용 | `use()`, `expire()`, `cancel()` |
| V2 | 기술적 동사 미사용 | `processUsage()`, `handleExpiration()`, `executeCancellation()` 없음 |

**Expected Correct Output**:
```kotlin
class Coupon : BaseEntity() {

    var status: CouponStatus = CouponStatus.ISSUED
        private set

    fun use() {
        if (status != CouponStatus.ISSUED) {
            throw CoreException(ErrorType.BAD_REQUEST, "[couponId = $id] 사용 가능한 상태가 아닙니다.")
        }
        status = CouponStatus.USED
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

---

### IM-17: 변수명은 축약 없이 전체 서술형으로 작성한다

**Rule**: 8. Naming
**Sub-rule**: Variable naming

**Input**:
주문 금액 계산 로직을 구현해 주세요. 상품 총액, 할인 금액, 배송비, 최종 결제 금액을 계산합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 전체 서술형 변수명 사용 | `totalProductAmount`, `discountAmount`, `shippingFee`, `finalPaymentAmount` |
| V2 | 축약 변수명 미사용 | `amt`, `disc`, `qty`, `fee` 단독 사용 없음 |

**Expected Correct Output**:
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

---

### IM-18: Boolean 이름은 is/has/canBe 접두사를 사용한다

**Rule**: 8. Naming
**Sub-rule**: Boolean naming

**Input**:
쿠폰 엔티티에 다음 상태 확인 기능을 추가해 주세요:
- 만료 여부 확인
- 잔여 수량 보유 여부
- 사용 가능 여부

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | is{Adjective} 패턴 | `isExpired` |
| V2 | has{Noun} 패턴 | `hasRemainingQuantity()` |
| V3 | canBe{Verb} 패턴 | `canBeUsed()` |

**Expected Correct Output**:
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

---

### IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다

**Rule**: 9. Domain Purity
**Sub-rule**: No infrastructure imports

**Input**:
주문(Order) 도메인 엔티티와 Service를 구현해 주세요. 엔티티에는 JPA 어노테이션이 필요하고, Service에는 트랜잭션 관리가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Entity에 JPA 어노테이션 허용 | `@Entity`, `@Table`, `@Column` 사용 |
| V2 | Entity에 @Transactional 없음 | `@Transactional` import/사용 없음 |
| V3 | Entity에 @JsonProperty 없음 | `@JsonProperty`, `@JsonIgnore` import/사용 없음 |
| V4 | Entity에 Spring Data import 없음 | `org.springframework.data.*` import 없음 |

**Expected Correct Output**:
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
```

---

### IM-20: Repository는 도메인에 인터페이스, 인프라에 구현체를 둔다

**Rule**: 9. Domain Purity
**Sub-rule**: Repository Abstraction

**Input**:
주문(Order) 도메인의 Repository를 구현해 주세요. 도메인 레이어에 인터페이스를, 인프라스트럭처 레이어에 JPA 기반 구현체를 만들어야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인에 인터페이스 존재 | `interface OrderRepository` in `domain/order/` |
| V2 | 인프라에 구현체 존재 | `class OrderRdbRepository : OrderRepository` in `infrastructure/` |
| V3 | 도메인에 JPA import 없음 | `JpaRepository` import 없음 (도메인 내) |

**Expected Correct Output**:
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

---

### IM-21: 필수 필드는 Non-nullable로 선언한다

**Rule**: 10. Null Safety
**Sub-rule**: Non-nullable by default

**Input**:
상품(Product) 엔티티의 필드를 정의해 주세요. 상품명(name)과 가격(price)은 필수, 설명(description)은 선택입니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 필수 필드 Non-nullable | `val name: String`, `val price: Money` (? 없음) |
| V2 | 선택 필드 Nullable | `val description: String?` |
| V3 | 필수 필드에 `?` 없음 | `String?` 형태가 필수 필드에 사용되지 않음 |

**Expected Correct Output**:
```kotlin
@Entity
@Table(
    name = "products",
    indexes = [
        Index(name = "idx_product_category_id", columnList = "category_id"),
    ]
)
class Product private constructor(
    val name: String,
    price: Money,
    val categoryId: Long,
    val description: String? = null,
) : BaseEntity() {

    var price: Money = price
        private set

    init {
        if (name.isBlank()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[name = $name] 상품명은 비어있을 수 없습니다.")
        }
        if (!price.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[price = $price] 가격은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(
            name: String,
            price: Money,
            categoryId: Long,
            description: String? = null,
        ): Product = Product(name, price, categoryId, description)
    }
}
```

---

### IM-22: 조회 실패 시 !! 대신 ?: throw CoreException을 사용한다

**Rule**: 10. Null Safety
**Sub-rule**: ?: throw (no !!)

**Input**:
주문 Service에서 주문 ID로 조회하는 기능을 구현해 주세요. 존재하지 않는 주문의 경우 적절한 에러를 반환해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Elvis + CoreException 패턴 | `?: throw CoreException(ErrorType.NOT_FOUND, ...)` |
| V2 | !! 연산자 미사용 | `!!` 없음 |
| V3 | 에러 메시지에 컨텍스트 포함 | `[orderId = $id]` 형태 |

**Expected Correct Output**:
```kotlin
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

---

### IM-23: Optional 데이터는 안전 호출 연산자를 사용한다

**Rule**: 10. Null Safety
**Sub-rule**: Safe calls

**Input**:
주문 금액 계산 시 쿠폰 할인, 포인트 할인, 등급 할인이 각각 선택적으로 적용됩니다. null일 수 있는 할인 값들을 안전하게 처리하는 로직을 구현해 주세요.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | ?.let{} 패턴 사용 | `couponDiscount?.let { ... }` |
| V2 | listOfNotNull() 사용 | `listOfNotNull(couponDiscount, pointDiscount, gradeDiscount)` |
| V3 | Java 스타일 null 체크 미사용 | `if (x != null)` 대신 `?.let{}` 사용 |

**Expected Correct Output**:
```kotlin
class OrderAmountCalculator {
    fun calculateFinalAmount(
        totalProductAmount: Money,
        couponDiscount: Money?,
        pointDiscount: Money?,
        gradeDiscount: Money?,
        shippingFee: Money,
    ): Money {
        val totalDiscount = listOfNotNull(
            couponDiscount,
            pointDiscount,
            gradeDiscount,
        ).fold(Money.ZERO) { accumulated, discount -> accumulated.add(discount) }

        val discountedAmount = totalProductAmount.subtract(totalDiscount)
        val finalPaymentAmount = discountedAmount.add(shippingFee)

        couponDiscount?.let { discount ->
            if (discount.isNegative()) {
                throw CoreException(ErrorType.BAD_REQUEST,
                    "[couponDiscount = $discount] 쿠폰 할인 금액은 음수일 수 없습니다.")
            }
        }

        return finalPaymentAmount
    }
}
```

---

### IM-24: API 문서는 ApiSpec 인터페이스에 분리한다

**Rule**: 11. API Patterns
**Sub-rule**: ApiSpec interface

**Input**:
상품 API의 Swagger 문서화를 구현해 주세요. 상품 검색 엔드포인트에 대한 @Tag, @Operation, @ApiResponses, @Parameter 어노테이션이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | ApiSpec 인터페이스에 Swagger 어노테이션 | `@Tag`, `@Operation`, `@ApiResponses` in interface |
| V2 | Controller에 Swagger 어노테이션 없음 | Controller 클래스에 `@Operation` 등 없음 |
| V3 | Controller가 ApiSpec 구현 | `class ProductV1Controller : ProductV1ApiSpec` |

**Expected Correct Output**:
```kotlin
// ApiSpec Interface - Swagger 어노테이션은 여기에만
@Tag(name = "상품 API", description = "상품 조회 및 관리 API")
interface ProductV1ApiSpec {

    @Operation(summary = "상품 검색", description = "키워드와 카테고리로 상품을 검색합니다.")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "검색 성공"),
        ApiResponse(responseCode = "400", description = "잘못된 요청"),
    ])
    fun search(
        @Parameter(description = "검색 키워드", example = "노트북")
        keyword: String?,
        @Parameter(description = "페이지 번호", example = "0")
        page: Int,
        @Parameter(description = "페이지 크기", example = "20")
        size: Int,
    ): ApiResponse<ProductV1Response.Search>
}

// Controller - Swagger 어노테이션 없이 구현만
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,
) : ProductV1ApiSpec {

    @GetMapping("/search")
    override fun search(
        @RequestParam keyword: String?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
    ): ApiResponse<ProductV1Response.Search> {
        val query = ProductPageQuery.of(page, size, keyword)
        return productFacade.search(query)
            .let { ProductV1Response.Search.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

---

### IM-25: 페이지네이션은 PageQuery 객체로 캡슐화하고 init에서 검증한다

**Rule**: 11. API Patterns
**Sub-rule**: PageQuery

**Input**:
상품 목록 조회를 위한 페이지네이션 Query 객체를 구현해 주세요. page는 0 이상, size는 1~100 범위만 허용합니다. 키워드와 카테고리 ID로 필터링할 수 있습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | init 블록에서 검증 | `init { if (page < 0) throw CoreException(...) }` |
| V2 | CoreException 사용 (require 아님) | `throw CoreException(ErrorType.BAD_REQUEST, ...)` |
| V3 | 에러 메시지에 [field = $value] 접두사 | `[page = $page]`, `[size = $size]` |

**Expected Correct Output**:
```kotlin
data class ProductPageQuery(
    val page: Int,
    val size: Int,
    val keyword: String? = null,
    val categoryId: Long? = null,
) {
    init {
        if (page < 0) {
            throw CoreException(ErrorType.BAD_REQUEST, "[page = $page] 페이지는 0 이상이어야 합니다.")
        }
        if (size !in 1..100) {
            throw CoreException(ErrorType.BAD_REQUEST, "[size = $size] 페이지 크기는 1~100이어야 합니다.")
        }
    }

    companion object {
        fun of(
            page: Int = 0,
            size: Int = 20,
            keyword: String? = null,
            categoryId: Long? = null,
        ): ProductPageQuery = ProductPageQuery(page, size, keyword, categoryId)
    }
}
```

---

### IM-26: 에러 메시지는 한국어이며 [field = $value] 접두사로 시작한다

**Rule**: 12. Messages
**Sub-rule**: Korean + [field=$value] prefix

**Input**:
사용자 서비스에서 다음 에러 상황들의 메시지를 작성해 주세요:
1. 사용자 조회 실패
2. 이메일 중복
3. 비밀번호 형식 오류

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 한국어 메시지 | 영문 메시지 없음 |
| V2 | [field = $value] 접두사가 맨 앞 | 메시지 시작이 `[` |
| V3 | 접두사가 맨 뒤에 오지 않음 | `... [field = $value]` 형태 없음 |

**Expected Correct Output**:
```kotlin
@Component
class UserService(
    private val userRepository: UserRepository,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): User {
        return userRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[userId = $id] 사용자를 찾을 수 없습니다.")
    }

    @Transactional
    fun register(command: UserCommand.Register): User {
        if (userRepository.existsByEmail(command.email)) {
            throw CoreException(ErrorType.CONFLICT, "[email = ${command.email}] 이미 존재하는 이메일입니다.")
        }

        if (!command.password.matches(PASSWORD_REGEX)) {
            throw CoreException(ErrorType.BAD_REQUEST,
                "[password = ***] 비밀번호는 8자 이상, 영문/숫자/특수문자를 포함해야 합니다.")
        }

        val user = User.create(command.email, command.password, command.name)
        return userRepository.save(user)
    }

    companion object {
        private val PASSWORD_REGEX = Regex("^(?=.*[A-Za-z])(?=.*\\d)(?=.*[@\$!%*?&]).{8,}$")
    }
}
```

---

### IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다

**Rule**: 13. Caching
**Sub-rule**: Cache in Facade + CacheTemplate

**Input**:
랭킹 조회 기능에 캐싱을 적용해 주세요. 주간/월간 랭킹만 캐싱 대상이며, 빈 결과는 캐싱하지 않습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에서 캐싱 로직 수행 | `RankingFacade`에서 `cacheTemplate` 사용 |
| V2 | @Cacheable 미사용 | `@Cacheable` 어노테이션 없음 |
| V3 | CacheTemplate API 사용 | `cacheTemplate.get(...)`, `cacheTemplate.put(...)` |

**Expected Correct Output**:
```kotlin
@Component
class RankingFacade(
    private val rankingService: RankingService,
    private val cacheTemplate: CacheTemplate,
) {
    fun findRankings(criteria: RankingCriteria.FindRankings): RankingInfo.FindRankings {
        val cacheKey = RankingCacheKeys.RankingList(
            period = criteria.period,
            baseDate = criteria.baseDate,
            offset = criteria.offset,
            limit = criteria.limit,
        )

        if (!cacheKey.shouldCache()) {
            val rankings = rankingService.findRankings(criteria.to())
            return RankingInfo.FindRankings.from(rankings)
        }

        val cached = cacheTemplate.get(cacheKey, TYPE_CACHED_RANKING_V1)
        if (cached != null) {
            return RankingInfo.FindRankings.from(cached.toProductRankings())
        }

        val rankings = rankingService.findRankings(criteria.to())

        if (rankings.isNotEmpty()) {
            cacheTemplate.put(cacheKey, CachedRankingV1.from(rankings))
        }

        return RankingInfo.FindRankings.from(rankings)
    }
}
```

---

### IM-28: 캐시 키는 sealed class로 정의하고 TTL을 내장한다

**Rule**: 13. Caching
**Sub-rule**: Cache Key sealed class

**Input**:
상품 도메인의 캐시 키를 정의해 주세요. 상품 상세(1시간 TTL)와 상품 목록(30분 TTL) 두 가지 캐시 키가 필요합니다. 키에 버전 정보를 포함해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | sealed class 구조 | `sealed class ProductCacheKeys(...) : CacheKey` |
| V2 | TTL 내장 | `ttl = Duration.ofHours(1)`, `ttl = Duration.ofMinutes(30)` |
| V3 | key에 버전 포함 | `"product-cache:v1:..."` |

**Expected Correct Output**:
```kotlin
sealed class ProductCacheKeys(override val ttl: Duration) : CacheKey {

    data class ProductDetail(
        private val productId: Long,
    ) : ProductCacheKeys(ttl = Duration.ofHours(1)) {

        override val key: String = "product-cache:v1:detail:$productId"
        override val traceKey: String = "product-detail-cache"
    }

    data class ProductList(
        private val categoryId: Long?,
        private val keyword: String?,
        private val page: Int,
        private val size: Int,
    ) : ProductCacheKeys(ttl = Duration.ofMinutes(30)) {

        override val key: String = "product-cache:v1:list:${categoryId ?: "all"}:${keyword ?: "none"}:$page:$size"
        override val traceKey: String = "product-list-cache"

        fun shouldCache(): Boolean = keyword == null
    }
}
```

---

### IM-29: 캐시 모델은 CachedXxxV1으로 버전화하고 도메인 이벤트로 무효화한다

**Rule**: 13. Caching
**Sub-rule**: CachedXxxV1 + invalidation

**Input**:
상품 캐시 모델과 무효화 로직을 구현해 주세요. 상품 정보가 변경될 때 해당 상품의 캐시만 선택적으로 무효화해야 합니다. Entity나 Response를 직접 캐싱하면 안 됩니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | CachedXxxV1 버전화 DTO | `CachedProductDetailV1` data class |
| V2 | Entity/Response 직접 캐싱 없음 | `Product`, `ProductV1Response` 캐싱 없음 |
| V3 | 도메인 이벤트 기반 무효화 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` |
| V4 | 선택적 evict (@CacheEvict/allEntries 아님) | `cacheTemplate.evict(ProductCacheKeys.ProductDetail(...))` |

**Expected Correct Output**:
```kotlin
// Cache Model - 전용 DTO (Entity/Response 아님)
data class CachedProductDetailV1(
    val productId: Long,
    val name: String,
    val price: BigDecimal,
    val categoryId: Long,
    val description: String?,
) {
    fun toProductDetail(): ProductDetail =
        ProductDetail(productId, name, Money(price, Currency.KRW), categoryId, description)

    companion object {
        fun from(product: ProductDetail): CachedProductDetailV1 =
            CachedProductDetailV1(
                productId = product.productId,
                name = product.name,
                price = product.price.amount,
                categoryId = product.categoryId,
                description = product.description,
            )
    }
}

// Cache Invalidation - 도메인 이벤트 리스너
@Component
class ProductCacheEvictionListener(
    private val cacheTemplate: CacheTemplate,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onProductUpdated(event: ProductUpdatedEventV1) {
        logger.info("[Event] Product cache eviction start - eventType: ${event::class.simpleName}, productId: ${event.productId}")
        cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))
        logger.info("[Event] Product cache eviction complete - eventType: ${event::class.simpleName}, productId: ${event.productId}")
    }
}
```

# GREEN Phase - Batch 1 (IM-01 ~ IM-10)

Implementation Skill 적용 후 생성된 코드. 모든 VP를 통과해야 한다.

---

## IM-01: Controller는 Facade만 주입한다

### Generated Code

```kotlin
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,
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

## IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다

### Generated Code

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

## IM-03: Service는 단일 도메인에만 의존하고 조회에 readOnly를 사용한다

### Generated Code

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

## IM-04: Facade에는 비즈니스 로직을 두지 않는다

### Generated Code

```kotlin
// Facade - coordination only
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

// Service - business logic
@Component
class OrderService(
    private val orderRepository: OrderRepository,
) {
    @Transactional
    fun process(command: OrderCommand.Process): Order {
        val order = orderRepository.findById(command.orderId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = ${command.orderId}] 주문을 찾을 수 없습니다.")

        order.process()  // Entity handles type-specific processing internally
        return orderRepository.save(order)
    }
}
```

---

## IM-05: 단일 CoreException + ErrorType 패턴을 사용한다

### Generated Code

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

// Entity
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

## IM-06: DTO 변환 체인을 완전하게 구성한다

### Generated Code

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

## IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다

### Generated Code

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

## IM-08: 동기 이벤트 리스너는 BEFORE_COMMIT으로 구성한다

### Generated Code

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

## IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다

### Generated Code

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

## IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다

### Generated Code

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

# Red Raw Output - Standard Kotlin/Spring Developer Code

## IM-01: 상품 상세 조회 API 엔드포인트

### Generated Code

```kotlin
@RestController
@RequestMapping("/api/v1/products")
class ProductController(
    private val productService: ProductService
) {
    @GetMapping("/{id}")
    fun getProduct(@PathVariable id: Long): ResponseEntity<ProductResponse> {
        val product = productService.findById(id)
        return ResponseEntity.ok(ProductResponse.from(product))
    }
}

data class ProductResponse(
    val id: Long,
    val name: String,
    val price: BigDecimal,
    val categoryId: Long
) {
    companion object {
        fun from(product: Product): ProductResponse {
            return ProductResponse(
                id = product.id!!,
                name = product.name,
                price = product.price,
                categoryId = product.categoryId
            )
        }
    }
}

@Service
class ProductService(
    private val productRepository: ProductRepository
) {
    fun findById(id: Long): Product {
        return productRepository.findById(id)
            .orElseThrow { EntityNotFoundException("Product not found with id: $id") }
    }
}
```

## IM-02: 주문 생성 (쿠폰 사용 + 포인트 차감 트랜잭션)

### Generated Code

```kotlin
@Service
class OrderService(
    private val orderRepository: OrderRepository,
    private val couponService: CouponService,
    private val pointService: PointService
) {
    @Transactional
    fun createOrder(request: CreateOrderRequest): Order {
        // 1. 쿠폰 사용 처리
        val discount = if (request.couponId != null) {
            couponService.useCoupon(request.couponId, request.userId)
        } else {
            BigDecimal.ZERO
        }

        // 2. 최종 금액 계산
        val totalAmount = request.orderItems.sumOf { it.price * it.quantity.toBigDecimal() }
        val finalAmount = totalAmount - discount

        // 3. 포인트 차감
        if (request.pointsToUse > 0) {
            pointService.usePoints(request.userId, request.pointsToUse)
        }

        // 4. 주문 생성
        val order = Order(
            userId = request.userId,
            totalAmount = totalAmount,
            discountAmount = discount,
            pointsUsed = request.pointsToUse,
            finalAmount = finalAmount - request.pointsToUse.toBigDecimal(),
            status = OrderStatus.CREATED
        )

        return orderRepository.save(order)
    }
}

data class CreateOrderRequest(
    val userId: Long,
    val orderItems: List<OrderItemRequest>,
    val couponId: Long? = null,
    val pointsToUse: Int = 0
)

data class OrderItemRequest(
    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: BigDecimal
)
```

## IM-05: 포인트 도메인 에러 처리

### Generated Code

```kotlin
class PointNotFoundException(userId: Long) :
    RuntimeException("Point not found for user: $userId")

class InsufficientPointBalanceException(available: Int, requested: Int) :
    RuntimeException("Insufficient point balance. Available: $available, Requested: $requested")

class ExpiredPointException(pointId: Long, expiredAt: LocalDateTime) :
    RuntimeException("Point $pointId has expired at $expiredAt")

@Service
class PointService(
    private val pointRepository: PointRepository
) {
    fun getPoints(userId: Long): Point {
        return pointRepository.findByUserId(userId)
            ?: throw PointNotFoundException(userId)
    }

    @Transactional
    fun usePoints(userId: Long, amount: Int) {
        val point = pointRepository.findByUserId(userId)
            ?: throw PointNotFoundException(userId)

        if (point.expiredAt.isBefore(LocalDateTime.now())) {
            throw ExpiredPointException(point.id!!, point.expiredAt)
        }

        if (point.balance < amount) {
            throw InsufficientPointBalanceException(point.balance, amount)
        }

        point.balance -= amount
        pointRepository.save(point)
    }
}

@RestControllerAdvice
class PointExceptionHandler {

    @ExceptionHandler(PointNotFoundException::class)
    fun handlePointNotFound(ex: PointNotFoundException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse(ex.message ?: "Point not found"))
    }

    @ExceptionHandler(InsufficientPointBalanceException::class)
    fun handleInsufficientBalance(ex: InsufficientPointBalanceException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse(ex.message ?: "Insufficient balance"))
    }

    @ExceptionHandler(ExpiredPointException::class)
    fun handleExpiredPoint(ex: ExpiredPointException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse(ex.message ?: "Point expired"))
    }
}

data class ErrorResponse(val message: String)
```

## IM-06: 쿠폰 발급 API (Request -> Response 전체 흐름)

### Generated Code

```kotlin
// Request DTO
data class IssueCouponRequest(
    val userId: Long,
    val couponType: String
)

// Response DTO
data class CouponResponse(
    val id: Long,
    val userId: Long,
    val couponType: String,
    val discountAmount: BigDecimal,
    val issuedAt: LocalDateTime,
    val expiredAt: LocalDateTime,
    val used: Boolean
) {
    companion object {
        fun from(coupon: Coupon): CouponResponse {
            return CouponResponse(
                id = coupon.id!!,
                userId = coupon.userId,
                couponType = coupon.couponType,
                discountAmount = coupon.discountAmount,
                issuedAt = coupon.issuedAt,
                expiredAt = coupon.expiredAt,
                used = coupon.used
            )
        }
    }
}

// Entity
@Entity
@Table(name = "coupons")
class Coupon(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    val userId: Long,
    val couponType: String,
    val discountAmount: BigDecimal,
    val issuedAt: LocalDateTime = LocalDateTime.now(),
    val expiredAt: LocalDateTime,
    var used: Boolean = false
)

// Controller
@RestController
@RequestMapping("/api/v1/coupons")
class CouponController(
    private val couponService: CouponService
) {
    @PostMapping
    fun issueCoupon(@RequestBody request: IssueCouponRequest): ResponseEntity<CouponResponse> {
        val coupon = couponService.issue(request)
        return ResponseEntity.status(HttpStatus.CREATED).body(CouponResponse.from(coupon))
    }
}

// Service
@Service
class CouponService(
    private val couponRepository: CouponRepository
) {
    @Transactional
    fun issue(request: IssueCouponRequest): Coupon {
        val discountAmount = when (request.couponType) {
            "FIXED_1000" -> BigDecimal(1000)
            "FIXED_5000" -> BigDecimal(5000)
            "PERCENT_10" -> BigDecimal(10)
            else -> throw IllegalArgumentException("Unknown coupon type: ${request.couponType}")
        }

        val coupon = Coupon(
            userId = request.userId,
            couponType = request.couponType,
            discountAmount = discountAmount,
            expiredAt = LocalDateTime.now().plusDays(30)
        )

        return couponRepository.save(coupon)
    }
}

// Repository
interface CouponRepository : JpaRepository<Coupon, Long>
```

## IM-07: 주문 생성 도메인 이벤트 (OrderItem 포함)

### Generated Code

```kotlin
class OrderItem(
    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: Money,
)

data class OrderCreatedEvent(
    val orderId: Long,
    val userId: Long,
    val totalAmount: BigDecimal,
    val orderItems: List<OrderItemInfo>,
    val createdAt: LocalDateTime = LocalDateTime.now()
)

data class OrderItemInfo(
    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: BigDecimal
) {
    companion object {
        fun from(orderItem: OrderItem): OrderItemInfo {
            return OrderItemInfo(
                productId = orderItem.productId,
                productName = orderItem.productName,
                quantity = orderItem.quantity,
                price = orderItem.price.amount
            )
        }
    }
}

@Entity
class Order(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,
    val userId: Long,
    val totalAmount: BigDecimal,
    val status: OrderStatus = OrderStatus.CREATED,
    @OneToMany(mappedBy = "order", cascade = [CascadeType.ALL])
    val orderItems: MutableList<OrderItemEntity> = mutableListOf()
) : AbstractAggregateRoot<Order>() {

    fun create(): Order {
        registerEvent(
            OrderCreatedEvent(
                orderId = this.id!!,
                userId = this.userId,
                totalAmount = this.totalAmount,
                orderItems = this.orderItems.map {
                    OrderItemInfo(
                        productId = it.productId,
                        productName = it.productName,
                        quantity = it.quantity,
                        price = it.price
                    )
                }
            )
        )
        return this
    }
}
```

## IM-09: 주문 생성 후 비동기 알림 이벤트 리스너

### Generated Code

```kotlin
@Component
class OrderNotificationListener(
    private val notificationService: NotificationService
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Async
    fun handleOrderCreated(event: OrderCreatedEvent) {
        try {
            notificationService.sendOrderConfirmation(event.userId, event.orderId)
            log.info("Order notification sent successfully for order: ${event.orderId}")
        } catch (e: Exception) {
            log.error("Failed to send order notification for order: ${event.orderId}", e)
        }
    }
}

@Service
class NotificationService {
    private val log = LoggerFactory.getLogger(javaClass)

    fun sendOrderConfirmation(userId: Long, orderId: Long) {
        // Send notification (email, push, etc.)
        log.info("Sending order confirmation to user: $userId for order: $orderId")
    }
}

@Configuration
@EnableAsync
class AsyncConfig
```

## IM-10: 상품(Product) 엔티티

### Generated Code

```kotlin
@Entity
@Table(
    name = "products",
    indexes = [
        Index(name = "idx_product_name", columnList = "name"),
        Index(name = "idx_product_category_id", columnList = "category_id")
    ]
)
class Product(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false)
    val name: String,

    @Column(nullable = false)
    val price: BigDecimal,

    @Column(name = "category_id", nullable = false)
    val categoryId: Long
)

interface ProductRepository : JpaRepository<Product, Long> {
    fun findByNameContaining(name: String): List<Product>
    fun findByCategoryId(categoryId: Long): List<Product>
}
```

## IM-15: 배송(Shipping) 도메인 전체 레이어

### Generated Code

```kotlin
// Entity
@Entity
@Table(name = "shippings")
class Shipping(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    val orderId: Long,
    val address: String,
    val recipientName: String,
    val recipientPhone: String,

    @Enumerated(EnumType.STRING)
    var status: ShippingStatus = ShippingStatus.PENDING,

    val createdAt: LocalDateTime = LocalDateTime.now(),
    var shippedAt: LocalDateTime? = null,
    var deliveredAt: LocalDateTime? = null
)

enum class ShippingStatus {
    PENDING, SHIPPED, IN_TRANSIT, DELIVERED, CANCELLED
}

// Event
data class ShippingStatusChangedEvent(
    val shippingId: Long,
    val orderId: Long,
    val previousStatus: ShippingStatus,
    val newStatus: ShippingStatus,
    val changedAt: LocalDateTime = LocalDateTime.now()
)

// Repository
interface ShippingRepository : JpaRepository<Shipping, Long> {
    fun findByOrderId(orderId: Long): Shipping?
}

// Service
@Service
class ShippingService(
    private val shippingRepository: ShippingRepository,
    private val applicationEventPublisher: ApplicationEventPublisher
) {
    @Transactional
    fun createShipping(orderId: Long, address: String, recipientName: String, recipientPhone: String): Shipping {
        val shipping = Shipping(
            orderId = orderId,
            address = address,
            recipientName = recipientName,
            recipientPhone = recipientPhone
        )
        return shippingRepository.save(shipping)
    }

    @Transactional
    fun updateStatus(shippingId: Long, newStatus: ShippingStatus): Shipping {
        val shipping = shippingRepository.findById(shippingId)
            .orElseThrow { EntityNotFoundException("Shipping not found: $shippingId") }

        val previousStatus = shipping.status
        shipping.status = newStatus

        when (newStatus) {
            ShippingStatus.SHIPPED -> shipping.shippedAt = LocalDateTime.now()
            ShippingStatus.DELIVERED -> shipping.deliveredAt = LocalDateTime.now()
            else -> {}
        }

        applicationEventPublisher.publishEvent(
            ShippingStatusChangedEvent(
                shippingId = shipping.id!!,
                orderId = shipping.orderId,
                previousStatus = previousStatus,
                newStatus = newStatus
            )
        )

        return shippingRepository.save(shipping)
    }

    fun findByOrderId(orderId: Long): Shipping {
        return shippingRepository.findByOrderId(orderId)
            ?: throw EntityNotFoundException("Shipping not found for order: $orderId")
    }
}

// Controller
@RestController
@RequestMapping("/api/v1/shippings")
class ShippingController(
    private val shippingService: ShippingService
) {
    @PostMapping
    fun createShipping(@RequestBody request: CreateShippingRequest): ResponseEntity<ShippingResponse> {
        val shipping = shippingService.createShipping(
            orderId = request.orderId,
            address = request.address,
            recipientName = request.recipientName,
            recipientPhone = request.recipientPhone
        )
        return ResponseEntity.status(HttpStatus.CREATED).body(ShippingResponse.from(shipping))
    }

    @PatchMapping("/{id}/status")
    fun updateStatus(
        @PathVariable id: Long,
        @RequestBody request: UpdateShippingStatusRequest
    ): ResponseEntity<ShippingResponse> {
        val shipping = shippingService.updateStatus(id, request.status)
        return ResponseEntity.ok(ShippingResponse.from(shipping))
    }

    @GetMapping("/orders/{orderId}")
    fun getByOrderId(@PathVariable orderId: Long): ResponseEntity<ShippingResponse> {
        val shipping = shippingService.findByOrderId(orderId)
        return ResponseEntity.ok(ShippingResponse.from(shipping))
    }
}

data class CreateShippingRequest(
    val orderId: Long,
    val address: String,
    val recipientName: String,
    val recipientPhone: String
)

data class UpdateShippingStatusRequest(
    val status: ShippingStatus
)

data class ShippingResponse(
    val id: Long,
    val orderId: Long,
    val address: String,
    val recipientName: String,
    val recipientPhone: String,
    val status: ShippingStatus,
    val createdAt: LocalDateTime,
    val shippedAt: LocalDateTime?,
    val deliveredAt: LocalDateTime?
) {
    companion object {
        fun from(shipping: Shipping): ShippingResponse {
            return ShippingResponse(
                id = shipping.id!!,
                orderId = shipping.orderId,
                address = shipping.address,
                recipientName = shipping.recipientName,
                recipientPhone = shipping.recipientPhone,
                status = shipping.status,
                createdAt = shipping.createdAt,
                shippedAt = shipping.shippedAt,
                deliveredAt = shipping.deliveredAt
            )
        }
    }
}
```

## IM-19: 주문(Order) 도메인 엔티티 및 Service

### Generated Code

```kotlin
// Entity
@Entity
@Table(name = "orders")
class Order(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false)
    val userId: Long,

    @Column(nullable = false)
    val totalAmount: BigDecimal,

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var status: OrderStatus = OrderStatus.CREATED,

    @OneToMany(mappedBy = "order", cascade = [CascadeType.ALL], orphanRemoval = true)
    val items: MutableList<OrderItemEntity> = mutableListOf(),

    val createdAt: LocalDateTime = LocalDateTime.now(),
    var updatedAt: LocalDateTime = LocalDateTime.now()
) {
    fun addItem(item: OrderItemEntity) {
        items.add(item)
        item.order = this
    }

    fun cancel() {
        require(status == OrderStatus.CREATED) {
            "Only CREATED orders can be cancelled. Current status: $status"
        }
        status = OrderStatus.CANCELLED
        updatedAt = LocalDateTime.now()
    }
}

@Entity
@Table(name = "order_items")
class OrderItemEntity(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    val productId: Long,
    val productName: String,
    val quantity: Int,
    val price: BigDecimal,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    var order: Order? = null
)

enum class OrderStatus {
    CREATED, CONFIRMED, SHIPPED, DELIVERED, CANCELLED
}

// Repository
interface OrderRepository : JpaRepository<Order, Long> {
    fun findByUserId(userId: Long): List<Order>
}

// Service
@Service
class OrderService(
    private val orderRepository: OrderRepository
) {
    @Transactional
    fun createOrder(userId: Long, items: List<OrderItemEntity>): Order {
        val totalAmount = items.sumOf { it.price * it.quantity.toBigDecimal() }

        val order = Order(
            userId = userId,
            totalAmount = totalAmount
        )

        items.forEach { order.addItem(it) }

        return orderRepository.save(order)
    }

    @Transactional(readOnly = true)
    fun findById(id: Long): Order {
        return orderRepository.findById(id)
            .orElseThrow { EntityNotFoundException("Order not found with id: $id") }
    }

    @Transactional(readOnly = true)
    fun findByUserId(userId: Long): List<Order> {
        return orderRepository.findByUserId(userId)
    }

    @Transactional
    fun cancelOrder(id: Long): Order {
        val order = findById(id)
        order.cancel()
        return orderRepository.save(order)
    }
}
```

## IM-22: 주문 ID 조회 및 에러 처리

### Generated Code

```kotlin
class OrderNotFoundException(id: Long) :
    RuntimeException("Order not found with id: $id")

@Service
class OrderService(
    private val orderRepository: OrderRepository
) {
    @Transactional(readOnly = true)
    fun getOrderById(id: Long): Order {
        return orderRepository.findById(id)
            .orElseThrow { OrderNotFoundException(id) }
    }
}

@RestControllerAdvice
class OrderExceptionHandler {

    @ExceptionHandler(OrderNotFoundException::class)
    fun handleOrderNotFound(ex: OrderNotFoundException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse(
                code = "ORDER_NOT_FOUND",
                message = ex.message ?: "Order not found"
            ))
    }
}

data class ErrorResponse(
    val code: String,
    val message: String,
    val timestamp: LocalDateTime = LocalDateTime.now()
)
```

## IM-24: 상품 API Swagger 문서화

### Generated Code

```kotlin
@Tag(name = "Product", description = "상품 API")
@RestController
@RequestMapping("/api/v1/products")
class ProductController(
    private val productService: ProductService
) {
    @Operation(
        summary = "상품 검색",
        description = "상품명 키워드 또는 카테고리 ID로 상품을 검색합니다."
    )
    @ApiResponses(
        value = [
            ApiResponse(
                responseCode = "200",
                description = "검색 성공",
                content = [Content(
                    mediaType = "application/json",
                    array = ArraySchema(schema = Schema(implementation = ProductResponse::class))
                )]
            ),
            ApiResponse(
                responseCode = "400",
                description = "잘못된 요청 파라미터",
                content = [Content(schema = Schema(implementation = ErrorResponse::class))]
            )
        ]
    )
    @GetMapping("/search")
    fun searchProducts(
        @Parameter(description = "검색할 상품명 키워드", example = "노트북")
        @RequestParam(required = false) keyword: String?,

        @Parameter(description = "카테고리 ID", example = "1")
        @RequestParam(required = false) categoryId: Long?,

        @Parameter(description = "페이지 번호 (0부터 시작)", example = "0")
        @RequestParam(defaultValue = "0") page: Int,

        @Parameter(description = "페이지 크기", example = "20")
        @RequestParam(defaultValue = "20") size: Int
    ): ResponseEntity<Page<ProductResponse>> {
        val products = productService.search(keyword, categoryId, PageRequest.of(page, size))
        return ResponseEntity.ok(products.map { ProductResponse.from(it) })
    }
}
```

## IM-26: 사용자 서비스 에러 메시지

### Generated Code

```kotlin
class UserNotFoundException(userId: Long) :
    RuntimeException("User not found with id: $userId")

class DuplicateEmailException(email: String) :
    RuntimeException("Email already exists: $email")

class InvalidPasswordFormatException :
    RuntimeException("Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.")

@Service
class UserService(
    private val userRepository: UserRepository
) {
    fun findById(id: Long): User {
        return userRepository.findById(id)
            .orElseThrow { UserNotFoundException(id) }
    }

    fun register(email: String, password: String, name: String): User {
        if (userRepository.existsByEmail(email)) {
            throw DuplicateEmailException(email)
        }

        if (!isValidPassword(password)) {
            throw InvalidPasswordFormatException()
        }

        val user = User(email = email, password = password, name = name)
        return userRepository.save(user)
    }

    private fun isValidPassword(password: String): Boolean {
        val regex = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@\$!%*?&])[A-Za-z\\d@\$!%*?&]{8,}$"
        return password.matches(Regex(regex))
    }
}

@RestControllerAdvice
class UserExceptionHandler {

    @ExceptionHandler(UserNotFoundException::class)
    fun handleUserNotFound(ex: UserNotFoundException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse(code = "USER_NOT_FOUND", message = ex.message!!))
    }

    @ExceptionHandler(DuplicateEmailException::class)
    fun handleDuplicateEmail(ex: DuplicateEmailException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ErrorResponse(code = "DUPLICATE_EMAIL", message = ex.message!!))
    }

    @ExceptionHandler(InvalidPasswordFormatException::class)
    fun handleInvalidPassword(ex: InvalidPasswordFormatException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse(code = "INVALID_PASSWORD_FORMAT", message = ex.message!!))
    }
}
```

## IM-27: 랭킹 조회 캐싱

### Generated Code

```kotlin
@Service
class RankingService(
    private val rankingRepository: RankingRepository
) {
    @Cacheable(
        value = ["ranking"],
        key = "#type.name() + '_' + #period.name()",
        condition = "#period == T(RankingPeriod).WEEKLY || #period == T(RankingPeriod).MONTHLY",
        unless = "#result.isEmpty()"
    )
    fun getRanking(type: RankingType, period: RankingPeriod): List<RankingEntry> {
        return rankingRepository.findByTypeAndPeriod(type, period)
    }

    @CacheEvict(value = ["ranking"], allEntries = true)
    fun refreshRanking() {
        // Cache will be cleared and recalculated on next access
    }
}

enum class RankingPeriod {
    DAILY, WEEKLY, MONTHLY
}

enum class RankingType {
    SALES, VIEWS, REVIEWS
}

data class RankingEntry(
    val rank: Int,
    val productId: Long,
    val productName: String,
    val score: Long
)

interface RankingRepository {
    fun findByTypeAndPeriod(type: RankingType, period: RankingPeriod): List<RankingEntry>
}

@Configuration
@EnableCaching
class CacheConfig {

    @Bean
    fun cacheManager(): CacheManager {
        val caffeine = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(30))
            .maximumSize(100)

        val cacheManager = CaffeineCacheManager("ranking")
        cacheManager.setCaffeine(caffeine)
        return cacheManager
    }
}
```

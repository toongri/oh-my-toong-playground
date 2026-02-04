# Comprehensive Pressure Test Scenarios

This document contains pressure test scenarios covering all areas from reference files (argus.md, architecture-reviewer.md, codebase-patterns.md).

---

# Part 1: Code Quality (from argus.md)

## 1.1 Naming - Class Naming

### Scenario: Creating New Domain Classes

**Context**: Need to create classes for inventory management feature.

**Pressure**: "Can't I just name them my way? StockManager, StockHandler sound more intuitive."

**Task**:
```kotlin
// Create classes for inventory management:
// - Inventory entity
// - Inventory service
// - Inventory repository
```

**Expected Violations Without Skill**:
- Using `StockManager` instead of `StockService` pattern
- Non-standard suffixes like `StockHandler`
- Inconsistency with existing project patterns

**Correct Pattern**:
```kotlin
Stock.kt           // Entity
StockService.kt    // Service
StockRepository.kt // Repository interface
StockFacade.kt     // Cross-domain (if needed)
```

---

## 1.2 Naming - Method Naming

### Scenario: Adding Domain Action Methods

**Context**: Need to add various actions to Coupon entity.

**Pressure**: "processExpiration(), handleUsage() are clearer names."

**Task**:
```kotlin
// Add to Coupon entity:
// - Coupon usage processing
// - Coupon expiration processing
// - Coupon issuance cancellation
```

**Expected Violations Without Skill**:
- Using `processCouponUsage()` instead of `use()`
- Using `handleExpiration()` instead of `expire()`
- Using technical verbs (process, handle, execute)

**Correct Pattern**:
```kotlin
fun use()      // Domain verb
fun expire()   // Domain verb
fun cancel()   // Domain verb
```

---

## 1.3 Naming - Variable Naming

### Scenario: Implementing Complex Calculation Logic

**Context**: Need to implement order total calculation logic.

**Pressure**: "Can I use short variable names? Like amt, qty, disc."

**Task**:
```kotlin
// Implement order total calculation:
// - Product amount sum
// - Discount application
// - Shipping fee addition
// - Final payment amount
```

**Expected Violations Without Skill**:
- Using `amt` instead of `amount`
- Using `qty` instead of `quantity`
- Using `disc` instead of `discountAmount`
- Unclear intent in variable names

**Correct Pattern**:
```kotlin
val totalProductAmount: Money
val discountAmount: Money
val shippingFee: Money
val finalPaymentAmount: Money
```

---

## 1.4 Naming - Boolean Naming

### Scenario: Adding Status Check Methods

**Context**: Need to add status check methods to Point entity.

**Pressure**: "expired(), used() - short names are fine, right?"

**Task**:
```kotlin
// Add status check methods to Point:
// - Check if expired
// - Check if usable
// - Check if balance is sufficient
```

**Expected Violations Without Skill**:
- Using `expired()` instead of `isExpired`
- Using `canUse()` instead of `isUsable` or `canBeUsed`
- Inconsistent boolean property/method naming

**Correct Pattern**:
```kotlin
val isExpired: Boolean
val isUsable: Boolean
fun hasEnoughBalance(amount: Long): Boolean
fun canBeUsed(): Boolean
```

---

## 1.5 Error Handling - CoreException Pattern

### Scenario: Handling Various Error Situations

**Context**: Need to handle multiple error situations in order service.

**Pressure**: "Creating exception classes for each situation is more type-safe. Like OrderNotFoundException, InsufficientStockException."

**Task**:
```kotlin
// Handle errors in OrderService:
// - Order not found
// - Insufficient stock
// - Already cancelled order
// - Payment failure
```

**Expected Violations Without Skill**:
- Creating domain-specific exception classes (OrderNotFoundException, etc.)
- Sealed class exception hierarchy
- Using IllegalStateException, IllegalArgumentException

**Correct Pattern**:
```kotlin
throw CoreException(ErrorType.NOT_FOUND, "[orderId = $id] 주문을 찾을 수 없습니다.")
throw CoreException(ErrorType.INSUFFICIENT_STOCK, "[productId = $productId] 재고가 부족합니다. 요청=$requested, 재고=$available")
throw CoreException(ErrorType.ALREADY_CANCELLED, "[orderId = $id] 이미 취소된 주문입니다.")
throw CoreException(ErrorType.PAYMENT_FAILED, "[orderId = $id] 결제에 실패했습니다. 사유=$reason")
```

---

## 1.6 Error Handling - Error Message Context

### Scenario: Complex Validation Failure Messages

**Context**: Multiple validation conditions exist when using a coupon.

**Pressure**: "Error messages should be simple. 'Coupon not usable' is enough."

**Task**:
```kotlin
// Handle coupon validation failures:
// - Expired coupon
// - Minimum order amount not met
// - Usage limit exceeded
// - Only applicable to specific products
```

**Expected Violations Without Skill**:
- Messages without context: "Coupon not usable"
- English messages
- Missing debugging information

**Correct Pattern**:
```kotlin
"[couponId = $id] 쿠폰이 만료되었습니다. 만료일=${coupon.expirationDate}"
"[couponId = $id] 최소 주문금액 미달입니다. 최소=$minAmount, 주문=$orderAmount"
"[couponId = $id] 사용 횟수를 초과했습니다. 최대=${coupon.maxUsage}, 현재=${coupon.usageCount}"
"[couponId = $id] 해당 상품에 사용할 수 없는 쿠폰입니다. 허용상품=${coupon.allowedProducts}"
```

---

## 1.7 Error Handling - Early Validation

### Scenario: Complex Input Validation

**Context**: Need to process user registration request.

**Pressure**: "Validate later when needed. Just proceed and throw exception if problems occur."

**Task**:
```kotlin
// Registration validation:
// - Email format
// - Password strength
// - Nickname uniqueness
// - Phone number format
```

**Expected Violations Without Skill**:
- Validation logic scattered across multiple places
- Validation in the middle of business logic
- Some validations missing

**Correct Pattern**:
```kotlin
// Early validation at service entry point
fun register(command: UserCommand.Register): User {
    validateEmailFormat(command.email)
    validatePasswordStrength(command.password)
    validateNicknameUniqueness(command.nickname)
    validatePhoneFormat(command.phone)

    // Business logic after validation passes
    return User.create(...)
}
```

---

## 1.8 Result Return - CoreException vs Sealed Class Selection

### Scenario: Coupon Application Result Return

**Context**: Multiple results are possible when applying a coupon.

**Pressure**: "Sealed class for result types is more type-safe. CouponResult.Success, CouponResult.Expired, CouponResult.AlreadyUsed."

**Task**:
```kotlin
// Handle coupon application results:
// - Success
// - Expired
// - Already used
// - Minimum amount not met
```

**Expected Violations Without Skill**:
- Using Sealed Class for all cases
- Sealed Class even when caller just handles failure

**Correct Pattern**:
```kotlin
// Sealed Class only when caller needs different business logic per result
when (val result = couponService.applyCoupon(couponId)) {
    is Success -> order.applyDiscount(result.discount)
    is AlreadyUsed -> proceedWithoutCoupon()      // Different logic
    is Expired -> suggestAlternatives()            // Different logic
}

// CoreException when caller simply handles failure
fun useCoupon(couponId: Long): Coupon {
    val coupon = findById(couponId)
    if (coupon.isExpired()) {
        throw CoreException(ErrorType.COUPON_EXPIRED, "...")  // Simple failure
    }
    ...
}
```

---

## 1.9 Null Safety - Non-nullable by Default

### Scenario: Entity Field Definition

**Context**: Need to define a new product entity.

**Pressure**: "Making it nullable gives flexibility later. Just use nullable for now."

**Task**:
```kotlin
// Define Product entity fields:
// - Product name
// - Price
// - Description
// - Category
// - Stock quantity
```

**Expected Violations Without Skill**:
- Unnecessary nullable fields: `var name: String? = null`
- Declaring nullable "just in case"
- Scattered null check logic

**Correct Pattern**:
```kotlin
@Entity
class Product(
    name: String,
    price: Money,
    description: String,      // Required
    category: Category,       // Required
    stockQuantity: Int,       // Required
) : BaseEntity() {
    var name: String = name
        private set
    // Only nullable if description is truly optional
}
```

---

## 1.10 Null Safety - Prohibit !! Operator

### Scenario: Repository Query Result Handling

**Context**: Need to query and process multiple entities.

**Pressure**: "Using !! makes code concise. We know it exists anyway."

**Task**:
```kotlin
// Order processing logic:
// - Query user
// - Query product
// - Query coupon (if exists)
// - Query shipping address
```

**Expected Violations Without Skill**:
- `userRepository.findById(userId)!!`
- `productRepository.findById(productId)!!`
- Possible NPE without clear error message

**Correct Pattern**:
```kotlin
val user = userRepository.findById(userId)
    ?: throw CoreException(ErrorType.NOT_FOUND, "[userId = $userId] 사용자를 찾을 수 없습니다.")

val product = productRepository.findById(productId)
    ?: throw CoreException(ErrorType.NOT_FOUND, "[productId = $productId] 상품을 찾을 수 없습니다.")

// For optional cases
val coupon = couponId?.let { id ->
    couponRepository.findById(id)
        ?: throw CoreException(ErrorType.NOT_FOUND, "[couponId = $id] 쿠폰을 찾을 수 없습니다.")
}
```

---

## 1.11 Null Safety - Using Safe Calls

### Scenario: Optional Data Processing

**Context**: Need to process optionally applied discount information on an order.

**Pressure**: "Just use if (discount != null) check."

**Task**:
```kotlin
// Process order discount information:
// - Coupon discount (optional)
// - Point discount (optional)
// - Grade discount (optional)
```

**Expected Violations Without Skill**:
- Java-style null check: `if (x != null) { x.something() }`
- Nested null checks
- Not using early return pattern

**Correct Pattern**:
```kotlin
// Using safe call and let
couponDiscount?.let { discount ->
    order.applyCouponDiscount(discount)
}

pointDiscount?.let { discount ->
    order.applyPointDiscount(discount)
}

// Combining multiple optionals
val totalDiscount = listOfNotNull(
    couponDiscount,
    pointDiscount,
    gradeDiscount
).sumOf { it.amount }
```

---

## 1.12 Encapsulation - Private by Default

### Scenario: Entity State Management

**Context**: Need to manage order entity state.

**Pressure**: "Making it public is convenient. Can change from outside when needed."

**Task**:
```kotlin
// Order entity state management:
// - Order status (PENDING, PAID, SHIPPED, DELIVERED, CANCELLED)
// - Total amount
// - Shipping information
```

**Expected Violations Without Skill**:
- `var status: OrderStatus = PENDING` (public setter)
- Allowing direct state changes from outside
- Not applying state transition rules

**Correct Pattern**:
```kotlin
@Entity
class Order(...) : BaseEntity() {
    @Enumerated(EnumType.STRING)
    var status: OrderStatus = OrderStatus.PENDING
        private set  // ✅ Cannot modify from outside

    var totalAmount: Money = totalAmount
        private set

    // ✅ State transitions only through behavior methods
    fun pay() {
        if (status != OrderStatus.PENDING) {
            throw CoreException(ErrorType.INVALID_STATE, "[orderId = $id] 결제할 수 없는 상태입니다. 현재=$status")
        }
        status = OrderStatus.PAID
        registerEvent(OrderPaidEventV1.from(this))
    }

    fun ship(trackingNumber: String) {
        if (status != OrderStatus.PAID) {
            throw CoreException(ErrorType.INVALID_STATE, "[orderId = $id] 배송할 수 없는 상태입니다. 현재=$status")
        }
        status = OrderStatus.SHIPPED
        this.trackingNumber = trackingNumber
    }
}
```

---

## 1.13 Encapsulation - Behavior Methods vs Setters

### Scenario: Point Balance Management

**Context**: Need to implement point earn/use/expire functions.

**Pressure**: "Just create setBalance() and adjust from outside. More flexible."

**Task**:
```kotlin
// Point balance management:
// - Point earning
// - Point usage
// - Point expiration
// - Point refund
```

**Expected Violations Without Skill**:
- `fun setBalance(newBalance: Long)`
- External code: `point.balance = point.balance - amount`
- Validation logic located outside

**Correct Pattern**:
```kotlin
class Point(...) : BaseEntity() {
    var balance: Long = balance
        private set

    fun earn(amount: Long) {
        require(amount > 0)
        balance += amount
        registerEvent(PointEarnedEventV1.from(this, amount))
    }

    fun use(amount: Long) {
        if (balance < amount) {
            throw CoreException(ErrorType.INSUFFICIENT_BALANCE,
                "[pointId = $id] 잔액이 부족합니다. 필요=$amount, 보유=$balance")
        }
        balance -= amount
        registerEvent(PointUsedEventV1.from(this, amount))
    }

    fun expire() {
        if (status != PointStatus.ACTIVE) return  // Idempotency
        val expiredAmount = balance
        balance = 0
        status = PointStatus.EXPIRED
        registerEvent(PointExpiredEventV1.from(this, expiredAmount))
    }
}
```

---

## 1.14 Encapsulation - Prefer Immutable

### Scenario: Value Object Definition

**Context**: Need to define a Value Object representing money.

**Pressure**: "Using var allows modification later, more convenient."

**Task**:
```kotlin
// Define Money Value Object:
// - Amount
// - Currency
// - Operations (add, subtract, multiply)
```

**Expected Violations Without Skill**:
- Mutable fields: `var amount: Long`
- In-place modification: `money.amount += 100`
- Mutable VO with state changes

**Correct Pattern**:
```kotlin
@Embeddable
data class Money(
    val amount: Long,        // val - immutable
    val currency: Currency = Currency.KRW
) {
    init {
        require(amount >= 0) { "Amount must be 0 or greater." }
    }

    operator fun plus(other: Money): Money {
        require(currency == other.currency)
        return Money(amount + other.amount, currency)  // Return new object
    }

    operator fun minus(other: Money): Money {
        require(currency == other.currency)
        return Money(amount - other.amount, currency)  // Return new object
    }

    operator fun times(multiplier: Int): Money {
        return Money(amount * multiplier, currency)
    }
}
```

---

## 1.15 Encapsulation - Validation in Constructor/Factory

### Scenario: Entity Creation Validation

**Context**: Need to validate multiple conditions when creating a coupon entity.

**Pressure**: "Just create first, validate in Service later."

**Task**:
```kotlin
// Coupon creation validation:
// - Discount rate between 0-100%
// - Expiration date in the future
// - Minimum order amount >= 0
```

**Expected Violations Without Skill**:
- Constructor without validation
- Validation in Service after creation
- Possible invalid state objects

**Correct Pattern**:
```kotlin
@Entity
class Coupon private constructor(
    discountRate: Int,
    expirationDate: LocalDateTime,
    minimumOrderAmount: Money,
) : BaseEntity() {

    init {
        require(discountRate in 0..100) { "Discount rate must be between 0-100." }
        require(expirationDate.isAfter(LocalDateTime.now())) { "Expiration date must be in the future." }
        require(minimumOrderAmount.amount >= 0) { "Minimum order amount must be 0 or greater." }
    }

    companion object {
        fun create(
            discountRate: Int,
            expirationDate: LocalDateTime,
            minimumOrderAmount: Money,
        ): Coupon {
            return Coupon(discountRate, expirationDate, minimumOrderAmount)
        }
    }
}
```

---

## 1.16 Code Duplication - Exact Duplication

### Scenario: Same Validation in Multiple Services

**Context**: User permission validation is done in multiple places.

**Pressure**: "Just copy-paste to each service. Can clean up later."

**Task**:
```kotlin
// Permission validation needed in:
// - OrderService.cancel() - Only owner can cancel
// - ReviewService.delete() - Only owner can delete
// - AddressService.update() - Only owner can update
```

**Expected Violations Without Skill**:
- Same validation logic copied to 3 places
- Inconsistency when only some are modified

**Correct Pattern**:
```kotlin
// Extract common validation method
private fun validateOwnership(resourceUserId: Long, requestUserId: Long, resourceName: String) {
    if (resourceUserId != requestUserId) {
        throw CoreException(ErrorType.FORBIDDEN,
            "[resourceUserId = $resourceUserId, requestUserId = $requestUserId] 본인의 ${resourceName}만 수정할 수 있습니다.")
    }
}

// Use in each service
fun cancel(orderId: Long, userId: Long) {
    val order = findById(orderId)
    validateOwnership(order.userId, userId, "주문")
    order.cancel()
}
```

---

## 1.17 Code Duplication - Structural Duplication

### Scenario: Similar CRUD Patterns

**Context**: Similar query logic exists for multiple entities.

**Pressure**: "They're slightly different, so implement each separately."

**Task**:
```kotlin
// Similar query patterns:
// - findById() with NOT_FOUND exception
// - findAllByIds() with partial result handling
// - findByIdWithLock() for pessimistic locking
```

**Expected Violations Without Skill**:
- Same pattern repeated in each service
- Inconsistent error message formats
- Inconsistent lock handling

**Correct Pattern**:
```kotlin
// Apply BaseService or common pattern
fun findById(id: Long): Entity {
    return repository.findById(id)
        ?: throw CoreException(ErrorType.NOT_FOUND, "[id = $id] ${entityName}를 찾을 수 없습니다.")
}

// Or standardize with extension function
fun <T> T?.orThrowNotFound(id: Long, entityName: String): T {
    return this ?: throw CoreException(ErrorType.NOT_FOUND, "[id = $id] ${entityName}를 찾을 수 없습니다.")
}
```

---

## 1.18 Pattern Consistency - Entity Pattern

### Scenario: Adding New Domain Entity

**Context**: Adding an entity for wishlist feature.

**Pressure**: "Can't I just do it the way I used in other projects?"

**Task**:
```kotlin
// Create Wishlist entity:
// - Wishlist per user
// - Add/remove products
// - Domain event publishing
```

**Expected Violations Without Skill**:
- Not extending BaseEntity
- Not using factory methods
- Not applying private set
- Inconsistent domain event pattern

**Correct Pattern**:
```kotlin
@Entity
@Table(name = "wishlists")
class Wishlist(
    userId: Long,
) : BaseEntity() {  // ✅ Extend BaseEntity

    @Column(nullable = false)
    var userId: Long = userId
        private set  // ✅ private set

    @OneToMany(mappedBy = "wishlist", cascade = [CascadeType.ALL])
    private val _items: MutableList<WishlistItem> = mutableListOf()
    val items: List<WishlistItem> get() = _items.toList()

    fun addItem(productId: Long) {
        if (_items.any { it.productId == productId }) return  // Idempotency
        _items.add(WishlistItem.create(this, productId))
        registerEvent(WishlistItemAddedEventV1.from(this, productId))
    }

    companion object {
        fun create(userId: Long): Wishlist = Wishlist(userId)  // ✅ factory
        fun of(userId: Long): Wishlist = Wishlist(userId)      // ✅ for tests
    }
}
```

---

## 1.19 Pattern Consistency - Service Pattern

### Scenario: Adding New Domain Service

**Context**: Adding a service for review domain.

**Pressure**: "I think this structure looks better."

**Task**:
```kotlin
// Create ReviewService:
// - Create review
// - Update review
// - Delete review
// - Query reviews
```

**Expected Violations Without Skill**:
- Adding other Service dependencies
- Using @Transactional directly (except readOnly)
- Not using Command DTO
- Inconsistent error handling pattern

**Correct Pattern**:
```kotlin
@Component
class ReviewService(
    private val reviewRepository: ReviewRepository,  // ✅ Only own Repository
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional(readOnly = true)  // ✅ readOnly for queries
    fun findById(id: Long): Review {
        return reviewRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[reviewId = $id] 리뷰를 찾을 수 없습니다.")
    }

    // ✅ No @Transactional for writes (managed by Facade)
    fun create(command: ReviewCommand.Create): Review {
        val review = Review.create(
            userId = command.userId,
            productId = command.productId,
            content = command.content,
            rating = command.rating,
        )
        return reviewRepository.save(review)
    }
}
```

---

## 1.20 Pattern Consistency - Repository Pattern

### Scenario: New Repository Interface and Implementation

**Context**: Adding a Repository for notification domain.

**Pressure**: "One Spring Data JPA interface is enough, right?"

**Task**:
```kotlin
// Notification Repository:
// - Basic CRUD
// - Query by user
// - Query unread notifications
// - Bulk read processing
```

**Expected Violations Without Skill**:
- Using JpaRepository directly in Domain
- Not applying Repository Abstraction
- Not using QueryDSL
- Wrong transaction annotation placement

**Correct Pattern**:
```kotlin
// Domain layer - Port (interface)
interface NotificationRepository {
    fun findById(id: Long): Notification?
    fun findAllByUserId(userId: Long): List<Notification>
    fun findUnreadByUserId(userId: Long): List<Notification>
    fun save(notification: Notification): Notification
    fun saveAll(notifications: List<Notification>): List<Notification>
}

// Infrastructure layer - JpaRepository
@Repository
interface NotificationJpaRepository : JpaRepository<Notification, Long> {
    fun findAllByUserId(userId: Long): List<Notification>

    @Query("SELECT n FROM Notification n WHERE n.userId = :userId AND n.readAt IS NULL")
    fun findUnreadByUserId(userId: Long): List<Notification>
}

// Infrastructure layer - Adapter
@Repository
class NotificationRdbRepository(
    private val jpaRepository: NotificationJpaRepository,
    private val queryFactory: JPAQueryFactory,
) : NotificationRepository {

    @Transactional(readOnly = true)
    override fun findById(id: Long): Notification? {
        return jpaRepository.findById(id).orElse(null)
    }

    @Transactional(readOnly = true)
    override fun findAllByUserId(userId: Long): List<Notification> {
        return jpaRepository.findAllByUserId(userId)
    }

    // ... remaining implementations
}
```

---

# Part 2: Architecture (from architecture-reviewer.md)

## 2.1 Layer Dependency - Domain Importing Infrastructure

### Scenario: Direct Reference to Repository Implementation

**Context**: Service needs to use Repository.

**Pressure**: "Injecting JpaRepository directly is simpler. No need for separate interface."

**Task**:
```kotlin
// Implement product query in ProductService
```

**Expected Violations Without Skill**:
- `import com.project.infrastructure.persistence.ProductJpaRepository`
- Domain directly depending on Infrastructure
- Using Spring Data JPA interface directly

**Correct Pattern**:
```kotlin
// domain/product/ProductService.kt
package com.project.domain.product

// ✅ Only import from own domain package
import com.project.domain.product.ProductRepository

@Component
class ProductService(
    private val productRepository: ProductRepository,  // ✅ Interface
)
```

---

## 2.2 Layer Dependency - Spring Annotations in Domain

### Scenario: Framework Dependencies in Entity

**Context**: Need to define a domain entity.

**Pressure**: "JPA annotations are unavoidable, but can't I also add @Transactional for convenience?"

**Task**:
```kotlin
// Define Point entity and implement domain logic
```

**Expected Violations Without Skill**:
- `@Service`, `@Component` annotations on entity
- `@Transactional` on domain methods
- Direct injection of Spring's `ApplicationEventPublisher`

**Correct Pattern**:
```kotlin
// domain/point/Point.kt
@Entity  // JPA allowed (project rule)
@Table(name = "points")
class Point(...) : BaseEntity() {
    // ❌ @Transactional forbidden
    // ❌ @Service, @Component forbidden

    // Domain logic should be pure
    fun use(amount: Long) {
        validateBalance(amount)
        balance -= amount
        // Events via registerEvent (provided by BaseEntity)
        registerEvent(PointUsedEventV1.from(this, amount))
    }
}
```

---

## 2.3 Domain Purity - Infrastructure Concern Leakage

### Scenario: JSON/HTTP Concerns in Domain

**Context**: Need to process external API response.

**Pressure**: "Adding @JsonProperty to domain object makes conversion easier."

**Task**:
```kotlin
// Handle PG company response in payment domain
```

**Expected Violations Without Skill**:
- `@JsonProperty`, `@JsonIgnore` on domain entity
- HTTP status code reference in domain
- Using ObjectMapper in domain

**Correct Pattern**:
```kotlin
// domain/payment/Payment.kt - Pure domain
@Entity
class Payment(...) : BaseEntity() {
    var status: PaymentStatus = PaymentStatus.PENDING
        private set

    fun complete(transactionId: String) {
        status = PaymentStatus.COMPLETED
        this.transactionId = transactionId
    }
}

// infrastructure/pg/PgResponse.kt - Conversion in infrastructure layer
data class PgResponse(
    @JsonProperty("transaction_id")
    val transactionId: String,
    @JsonProperty("status_code")
    val statusCode: String,
) {
    fun toDomain(): PaymentResult {
        return PaymentResult(
            transactionId = transactionId,
            status = mapStatus(statusCode)
        )
    }
}
```

---

## 2.4 Service/Facade Boundaries - Service Calling Another Service

### Scenario: Multiple Domain Integration on Order Creation

**Context**: Order creation requires stock deduction, coupon usage, point deduction.

**Pressure**: "Handling everything in OrderService makes it easy to see in one place."

**Task**:
```kotlin
// Order creation logic:
// 1. Stock check and deduction
// 2. Coupon application
// 3. Point usage
// 4. Order creation
// 5. Payment request
```

**Expected Violations Without Skill**:
- OrderService injecting StockService, CouponService, PointService, PaymentService
- Horizontal dependencies between Services
- Unclear transaction boundaries

**Correct Pattern**:
```kotlin
// application/order/OrderFacade.kt
@Component
class OrderFacade(
    private val orderService: OrderService,
    private val stockService: StockService,
    private val couponService: CouponService,
    private val pointService: PointService,
    private val paymentService: PaymentService,
) {
    @Transactional
    fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
        // 1. Stock deduction
        stockService.decrease(criteria.toStockCommand())

        // 2. Coupon usage
        criteria.couponId?.let { couponId ->
            couponService.use(CouponCommand.Use(couponId))
        }

        // 3. Point usage
        criteria.pointAmount?.let { amount ->
            pointService.use(PointCommand.Use(criteria.userId, amount))
        }

        // 4. Order creation
        val order = orderService.create(criteria.toCommand())

        // 5. Payment creation (async via event)
        return OrderInfo.Create.from(order)
    }
}

// domain/order/OrderService.kt
@Component
class OrderService(
    private val orderRepository: OrderRepository,
    // ❌ No other Service injection
) {
    fun create(command: OrderCommand.Create): Order {
        return orderRepository.save(Order.create(command))
    }
}
```

---

## 2.5 Service/Facade Boundaries - Business Logic in Facade

### Scenario: Conditional Branching in Facade

**Context**: Different processing needed based on order type.

**Pressure**: "Just use if statements in Facade. Simple."

**Task**:
```kotlin
// Processing by order type:
// - Regular order: Standard shipping
// - Subscription: Auto-payment setup
// - Reservation: Set shipping reservation date
```

**Expected Violations Without Skill**:
- Business rules (if, switch statements) in Facade
- Domain logic leaking to Facade
- State decisions outside Service/Entity

**Correct Pattern**:
```kotlin
// application/order/OrderFacade.kt
@Component
class OrderFacade(...) {
    @Transactional
    fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
        // ✅ Facade only coordinates, decisions in Service/Entity
        val order = orderService.create(criteria.toCommand())
        // Type-specific handling inside orderService.create()
        return OrderInfo.Create.from(order)
    }
}

// domain/order/OrderService.kt
@Component
class OrderService(...) {
    fun create(command: OrderCommand.Create): Order {
        // ✅ Business logic in Service or Entity
        return when (command.orderType) {
            OrderType.REGULAR -> Order.createRegular(command)
            OrderType.SUBSCRIPTION -> Order.createSubscription(command)
            OrderType.RESERVATION -> Order.createReservation(command)
        }
    }
}
```

---

## 2.6 Service/Facade Boundaries - Facade Calling Another Facade

### Scenario: Complex Business Process

**Context**: Multiple follow-up actions needed after order completion.

**Pressure**: "OrderFacade can just call NotificationFacade, RewardFacade."

**Task**:
```kotlin
// Follow-up processing after order completion:
// - Send notification
// - Accumulate rewards
// - Update statistics
```

**Expected Violations Without Skill**:
- Facade calling another Facade
- Possible circular dependency between Facades
- Nested transaction boundaries

**Correct Pattern**:
```kotlin
// ✅ Separate with event-based approach
// application/order/OrderFacade.kt
@Component
class OrderFacade(...) {
    @Transactional
    fun completeOrder(criteria: OrderCriteria.Complete): OrderInfo.Complete {
        val order = orderService.complete(criteria.orderId)
        // Trigger follow-up processing via event publishing
        eventPublisher.publishEvent(OrderCompletedEventV1.from(order))
        return OrderInfo.Complete.from(order)
    }
}

// interfaces/event/notification/NotificationEventListener.kt
@Component
class NotificationEventListener(
    private val notificationService: NotificationService,  // ✅ Call Service
) {
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCompleted(event: OrderCompletedEventV1) {
        notificationService.sendOrderCompletionNotification(event.orderId)
    }
}
```

---

## 2.7 Transaction Boundaries - @Transactional on Service

### Scenario: Transactions on Multiple Service Methods

**Context**: Each Service method has independent transaction.

**Pressure**: "Adding @Transactional to each Service is safe."

**Task**:
```kotlin
// Process point earning and coupon issuance together
```

**Expected Violations Without Skill**:
- `@Transactional` on each Service method
- Separate transactions when called from Facade
- Consistency broken on partial failure

**Correct Pattern**:
```kotlin
// ❌ Wrong
class PointService {
    @Transactional  // Individual transaction
    fun earn(command: PointCommand.Earn): Point { ... }
}

class CouponService {
    @Transactional  // Individual transaction
    fun issue(command: CouponCommand.Issue): Coupon { ... }
}

// ✅ Correct
class PointService {
    // No @Transactional
    fun earn(command: PointCommand.Earn): Point { ... }
}

class CouponService {
    // No @Transactional
    fun issue(command: CouponCommand.Issue): Coupon { ... }
}

class PromotionFacade {
    @Transactional  // ✅ Entire operation in one transaction
    fun applyPromotion(criteria: PromotionCriteria.Apply): PromotionInfo.Apply {
        val point = pointService.earn(criteria.toPointCommand())
        val coupon = couponService.issue(criteria.toCouponCommand())
        // Both succeed or both rollback
        return PromotionInfo.Apply.from(point, coupon)
    }
}
```

---

## 2.8 Transaction Boundaries - Transaction Scope Mismatch

### Scenario: Operations That Should Be Atomic Are Separated

**Context**: Stock deduction and order creation must happen together.

**Pressure**: "Can't we deduct stock first, then create order separately?"

**Task**:
```kotlin
// Ensure atomicity of stock deduction + order creation
```

**Expected Violations Without Skill**:
- Stock not restored if order creation fails after stock deduction
- Processing in separate transactions
- Missing compensation transaction

**Correct Pattern**:
```kotlin
@Component
class OrderFacade(...) {
    @Transactional  // ✅ One transaction
    fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
        // Stock deduction
        stockService.decrease(criteria.toStockCommand())

        // Order creation - stock deduction also rolls back on failure
        val order = orderService.create(criteria.toCommand())

        return OrderInfo.Create.from(order)
    }
}
```

---

## 2.9 Aggregate Integrity - Repository for Non-Root Entity

### Scenario: Direct Access to Order Item

**Context**: Need to change order item quantity.

**Pressure**: "Creating OrderItemRepository for direct modification is faster."

**Task**:
```kotlin
// Change order item quantity
```

**Expected Violations Without Skill**:
- Creating `OrderItemRepository` (non-root entity)
- Directly modifying `OrderItem` from outside
- Possible inconsistency between `Order` and `OrderItem`

**Correct Pattern**:
```kotlin
// ❌ Wrong
interface OrderItemRepository {
    fun findById(id: Long): OrderItem?
    fun save(item: OrderItem): OrderItem
}

// Direct modification from outside
val item = orderItemRepository.findById(itemId)!!
item.quantity = newQuantity
orderItemRepository.save(item)

// ✅ Correct - Modify only through Aggregate Root
class Order(...) {
    private val _items: MutableList<OrderItem> = mutableListOf()

    fun updateItemQuantity(itemId: Long, newQuantity: Int) {
        val item = _items.find { it.id == itemId }
            ?: throw CoreException(ErrorType.NOT_FOUND, "[itemId = $itemId] 주문 항목을 찾을 수 없습니다.")
        item.updateQuantity(newQuantity)
        recalculateTotalAmount()  // Update related state together
    }
}

// Usage in Facade
fun updateOrderItemQuantity(criteria: OrderCriteria.UpdateItemQuantity) {
    val order = orderService.findById(criteria.orderId)
    order.updateItemQuantity(criteria.itemId, criteria.quantity)
    orderRepository.save(order)
}
```

---

## 2.10 Aggregate Integrity - Direct Creation of Child Entity

### Scenario: Adding Order Item

**Context**: Need to add an item to existing order.

**Pressure**: "Just call OrderItem.create() and OrderItemRepository.save()."

**Task**:
```kotlin
// Add product to existing order
```

**Expected Violations Without Skill**:
- Independent creation of `OrderItem`
- Manual relationship setup with `Order`
- Broken aggregate consistency

**Correct Pattern**:
```kotlin
// ❌ Wrong
val item = OrderItem.create(orderId, productId, quantity)
orderItemRepository.save(item)

// ✅ Correct
class Order(...) {
    fun addItem(productId: Long, quantity: Int, price: Money) {
        val item = OrderItem.create(this, productId, quantity, price)
        _items.add(item)
        recalculateTotalAmount()
        registerEvent(OrderItemAddedEventV1.from(this, item))
    }
}

// Usage
val order = orderService.findById(orderId)
order.addItem(productId, quantity, price)
orderRepository.save(order)
```

---

## 2.11 Single Responsibility - God Service

### Scenario: One Service Doing Too Much

**Context**: OrderService keeps growing.

**Pressure**: "It's order-related, so put everything in OrderService."

**Task**:
```kotlin
// Functions in OrderService:
// - Create order
// - Query order
// - Cancel order
// - Process refund
// - Track shipping
// - Manage reviews
// - Process exchange
```

**Expected Violations Without Skill**:
- Unrelated functions in one Service
- Service class with hundreds or thousands of lines
- Multiple Repository injections from other domains

**Correct Pattern**:
```kotlin
// Separate by domain
OrderService          // Order creation, query, status change
RefundService         // Refund processing
ShipmentService       // Shipping tracking
ReviewService         // Review management (separate domain)
ExchangeService       // Exchange processing

// Each Service has only its own Repository
class OrderService(
    private val orderRepository: OrderRepository,
)

class RefundService(
    private val refundRepository: RefundRepository,
)
```

---

## 2.12 Single Responsibility - Method Grouping

### Scenario: Methods in Service Divide into Groups

**Context**: ProductService has mixed product and inventory related methods.

**Pressure**: "Products and inventory are related, so they can be in one Service."

**Task**:
```kotlin
// ProductService methods:
// Group 1: Product information
// - create(), update(), findById(), findAll()
// Group 2: Inventory management
// - increaseStock(), decreaseStock(), checkStock()
// Group 3: Price management
// - updatePrice(), applyDiscount(), removeDiscount()
```

**Expected Violations Without Skill**:
- Different responsibilities in one class
- Groups of methods with no interaction
- Multiple reasons to change the class

**Correct Pattern**:
```kotlin
// Separate by responsibility
ProductService     // Product information CRUD
StockService       // Inventory management (can be separate domain)
PricingService     // Price/discount management

// Or make Stock a VO of Product
class Product {
    @Embedded
    var stock: Stock
        private set

    fun decreaseStock(quantity: Int) {
        stock = stock.decrease(quantity)
    }
}
```

---

## 2.13 Event Listener Placement - Wrong Layer

### Scenario: Event Listener Location

**Context**: Need to handle order creation event.

**Pressure**: "Just add @EventListener to Service or domain."

**Task**:
```kotlin
// On order creation:
// - Stock deduction (sync)
// - Send notification (async)
// - Update statistics (async)
```

**Expected Violations Without Skill**:
- `@EventListener` in Domain or Application layer
- Direct event handling in Service
- Inverted dependency direction

**Correct Pattern**:
```kotlin
// Located in interfaces/event/ layer
// interfaces/event/order/OrderEventListener.kt
@Component
class OrderEventListener(
    private val stockService: StockService,
) {
    // Sync - same transaction
    @EventListener
    fun onOrderCreated(event: OrderCreatedEventV1) {
        stockService.decrease(StockCommand.Decrease(
            productId = event.productId,
            quantity = event.quantity
        ))
    }
}

// interfaces/event/notification/NotificationEventListener.kt
@Component
class NotificationEventListener(
    private val notificationService: NotificationService,
) {
    // Async - after commit
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        notificationService.sendOrderCreatedNotification(event.orderId)
    }
}
```

---

## 2.14 Event Listener - Business Logic Leakage

### Scenario: Conditional Branching in Listener

**Context**: Send different notifications based on order amount.

**Pressure**: "Just check amount in listener and branch."

**Task**:
```kotlin
// Notification on order completion:
// - VIP (100k or more): VIP-only notification + additional benefits info
// - Regular: Regular notification
```

**Expected Violations Without Skill**:
- Amount comparison logic in listener
- Business rule in interface layer
- Need to modify listener when rules change

**Correct Pattern**:
```kotlin
// ❌ Wrong - Business logic in listener
@EventListener
fun onOrderCompleted(event: OrderCompletedEventV1) {
    if (event.totalAmount >= 100000) {  // Business rule!
        notificationService.sendVipNotification(event.orderId)
    } else {
        notificationService.sendRegularNotification(event.orderId)
    }
}

// ✅ Correct - Listener only delegates
@EventListener
fun onOrderCompleted(event: OrderCompletedEventV1) {
    notificationService.sendOrderCompletionNotification(event.orderId)
    // Service internally determines VIP status
}

// domain/notification/NotificationService.kt
fun sendOrderCompletionNotification(orderId: Long) {
    val order = orderReader.findById(orderId)
    val template = if (order.isVipOrder()) {  // Domain decides
        NotificationTemplate.VIP_ORDER_COMPLETE
    } else {
        NotificationTemplate.REGULAR_ORDER_COMPLETE
    }
    send(order.userId, template)
}
```

---

## 2.15 Event Listener - Direct Repository Call

### Scenario: Direct Data Save in Listener

**Context**: Save notification record on order creation.

**Pressure**: "Calling Repository in listener is fast."

**Task**:
```kotlin
// Order creation → Save notification record
```

**Expected Violations Without Skill**:
- Direct `Repository` injection in listener
- Bypassing Service layer
- Scattered business logic

**Correct Pattern**:
```kotlin
// ❌ Wrong
@Component
class OrderEventListener(
    private val notificationRepository: NotificationRepository,  // Direct injection
) {
    @EventListener
    fun onOrderCreated(event: OrderCreatedEventV1) {
        val notification = Notification.create(...)
        notificationRepository.save(notification)  // Direct save
    }
}

// ✅ Correct
@Component
class OrderEventListener(
    private val notificationService: NotificationService,  // Through Service
) {
    @EventListener
    fun onOrderCreated(event: OrderCreatedEventV1) {
        notificationService.createOrderNotification(event.orderId, event.userId)
    }
}
```

---

# Part 3: Codebase Patterns (from codebase-patterns.md)

## 3.1 Controller Pattern

### Scenario: Adding New API Endpoint

**Context**: Need to add product search API.

**Pressure**: "Just call Service directly from Controller. No need for Facade."

**Task**:
```kotlin
// GET /api/v1/products/search
// - Keyword search
// - Category filter
// - Price range filter
// - Pagination
```

**Expected Violations Without Skill**:
- Controller calling Service directly
- Returning Entity directly
- Missing DTO conversion

**Correct Pattern**:
```kotlin
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,  // ✅ Through Facade
) : ProductV1ApiSpec {

    @GetMapping("/search")
    override fun search(
        @RequestParam keyword: String?,
        @RequestParam categoryId: Long?,
        @RequestParam minPrice: Long?,
        @RequestParam maxPrice: Long?,
        @RequestParam(defaultValue = "0") offset: Long,
        @RequestParam(defaultValue = "20") limit: Long,
    ): ApiResponse<ProductV1Response.Search> {
        val criteria = ProductCriteria.Search(
            keyword = keyword,
            categoryId = categoryId,
            priceRange = PriceRange(minPrice, maxPrice),
            offset = offset,
            limit = limit,
        )
        return productFacade.search(criteria)
            .let { ProductV1Response.Search.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

---

## 3.2 ApiSpec Pattern

### Scenario: API Documentation

**Context**: Define ApiSpec for Swagger documentation.

**Pressure**: "Just add @Operation directly to Controller. No need for separate interface."

**Task**:
```kotlin
// Document product search API
```

**Expected Violations Without Skill**:
- Swagger annotations directly on Controller
- Not separating interface
- Missing Korean descriptions

**Correct Pattern**:
```kotlin
@Tag(name = "Product V1 API", description = "상품 API")
interface ProductV1ApiSpec {
    @Operation(
        summary = "상품 검색",
        description = "키워드, 카테고리, 가격 범위로 상품을 검색합니다.",
    )
    fun search(
        @Parameter(
            name = "keyword",
            description = "검색 키워드",
            required = false,
            `in` = ParameterIn.QUERY,
        )
        keyword: String?,

        @Parameter(
            name = "categoryId",
            description = "카테고리 ID",
            required = false,
            `in` = ParameterIn.QUERY,
        )
        categoryId: Long?,
        // ...
    ): ApiResponse<ProductV1Response.Search>
}
```

---

## 3.3 Request/Response Pattern

### Scenario: Complex Request/Response DTOs

**Context**: Define order creation request and response.

**Pressure**: "Just make single classes. Nested class pattern is complicated."

**Task**:
```kotlin
// Order creation Request/Response
```

**Expected Violations Without Skill**:
- Single classes like `CreateOrderRequest`, `CreateOrderResponse`
- Not using namespace pattern
- Missing `toCriteria()`, `from()` methods

**Correct Pattern**:
```kotlin
class OrderV1Request {
    @Schema(description = "주문 생성 요청")
    data class Create(
        @field:Schema(description = "사용자 ID", required = true)
        val userId: Long,

        @field:Schema(description = "주문 항목 목록", required = true)
        val items: List<OrderItemRequest>,

        @field:Schema(description = "쿠폰 ID (선택)")
        val couponId: Long? = null,
    ) {
        fun toCriteria(): OrderCriteria.Create {
            return OrderCriteria.Create(
                userId = userId,
                items = items.map { it.toCriteria() },
                couponId = couponId,
            )
        }
    }

    data class OrderItemRequest(
        val productId: Long,
        val quantity: Int,
    ) {
        fun toCriteria(): OrderCriteria.OrderItem {
            return OrderCriteria.OrderItem(productId, quantity)
        }
    }
}

class OrderV1Response {
    data class Create(
        val orderId: Long,
        val totalAmount: Long,
        val status: String,
    ) {
        companion object {
            fun from(info: OrderInfo.Create): Create {
                return Create(
                    orderId = info.orderId,
                    totalAmount = info.totalAmount.amount,
                    status = info.status.name,
                )
            }
        }
    }
}
```

---

## 3.4 Criteria/Command/Info Pattern

### Scenario: Application ↔ Domain DTOs

**Context**: Define DTOs for coupon issuance feature.

**Pressure**: "Just convert directly from Request to Entity. Why need intermediate DTOs?"

**Task**:
```kotlin
// Coupon issuance: Request → Criteria → Command → Entity → Info → Response
```

**Expected Violations Without Skill**:
- Converting directly from Request to Command
- Response directly from Entity without Info
- Ignoring layer boundaries

**Correct Pattern**:
```kotlin
// application/coupon/CouponCriteria.kt
class CouponCriteria {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
        val expirationDays: Int = 30,
    ) {
        fun to(): CouponCommand.Issue {
            return CouponCommand.Issue(
                userId = userId,
                couponType = couponType,
                expirationDate = LocalDateTime.now().plusDays(expirationDays.toLong()),
            )
        }
    }
}

// domain/coupon/CouponCommand.kt
class CouponCommand {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
        val expirationDate: LocalDateTime,
    )
}

// application/coupon/CouponInfo.kt
class CouponInfo {
    data class Issue(
        val couponId: Long,
        val code: String,
        val discountAmount: Long,
        val expirationDate: LocalDateTime,
    ) {
        companion object {
            fun from(coupon: Coupon): Issue {
                return Issue(
                    couponId = coupon.id,
                    code = coupon.code,
                    discountAmount = coupon.discountAmount.amount,
                    expirationDate = coupon.expirationDate,
                )
            }
        }
    }
}
```

---

## 3.5 Query/PageQuery Pattern

### Scenario: Paged Query

**Context**: Pagination needed for product list query.

**Pressure**: "Just pass offset, limit as parameters. Why need Query object?"

**Task**:
```kotlin
// Product list query with pagination
```

**Expected Violations Without Skill**:
- Passing primitive type parameters
- Scattered validation logic
- Inconsistent default values

**Correct Pattern**:
```kotlin
data class ProductPageQuery(
    val categoryId: Long? = null,
    val status: ProductStatus? = null,
    val offset: Long,
    val limit: Long,
) {
    init {
        if (offset < 0) {
            throw CoreException(ErrorType.BAD_REQUEST, "offset은 0 이상이어야 합니다.")
        }
        if (limit <= 0 || limit > MAX_LIMIT) {
            throw CoreException(ErrorType.BAD_REQUEST, "limit은 1~$MAX_LIMIT 이어야 합니다.")
        }
    }

    companion object {
        private const val MAX_LIMIT = 100L

        fun of(
            categoryId: Long? = null,
            status: ProductStatus? = null,
            offset: Long? = null,
            limit: Long? = null,
        ): ProductPageQuery {
            return ProductPageQuery(
                categoryId = categoryId,
                status = status,
                offset = offset ?: 0L,
                limit = limit ?: 20L,
            )
        }
    }
}
```

---

## 3.6 Event Pattern

### Scenario: Domain Event Definition

**Context**: Need to define order status change events.

**Pressure**: "Just make data classes. No need to complicate."

**Task**:
```kotlin
// Order status change events:
// - Order created
// - Payment completed
// - Shipping started
// - Delivery completed
```

**Expected Violations Without Skill**:
- Missing V1 suffix
- Not implementing DomainEvent interface
- Missing occurredAt
- Not using factory method

**Correct Pattern**:
```kotlin
data class OrderCreatedEventV1(
    val orderId: Long,
    val userId: Long,
    val totalAmount: Long,
    val items: List<OrderItemSnapshot>,
    override val occurredAt: Instant = Instant.now(),
) : DomainEvent {

    data class OrderItemSnapshot(
        val productId: Long,
        val quantity: Int,
        val price: Long,
    )

    companion object {
        fun from(order: Order): OrderCreatedEventV1 {
            return OrderCreatedEventV1(
                orderId = order.id,
                userId = order.userId,
                totalAmount = order.totalAmount.amount,
                items = order.items.map { item ->
                    OrderItemSnapshot(
                        productId = item.productId,
                        quantity = item.quantity,
                        price = item.price.amount,
                    )
                },
            )
        }
    }
}
```

---

## 3.7 EventListener Pattern

### Scenario: Event Listener Implementation

**Context**: Implement a listener to handle order creation event.

**Pressure**: "Just add @EventListener and done."

**Task**:
```kotlin
// On order creation:
// - Sync: Stock deduction (via Outbox at BEFORE_COMMIT)
// - Async: Send notification (AFTER_COMMIT)
```

**Expected Violations Without Skill**:
- No sync/async distinction
- Transaction phase not specified
- Inconsistent logging pattern
- Missing error handling

**Correct Pattern**:
```kotlin
@Component
class OrderEventListener(
    private val stockService: StockService,
) {
    private val logger = LoggerFactory.getLogger(OrderEventListener::class.java)

    // Sync - when processing in same transaction is needed
    @EventListener
    fun onOrderCreatedSync(event: OrderCreatedEventV1) {
        logger.info("[OrderCreatedEventV1] Stock deduction start - orderId: ${event.orderId}")
        stockService.decreaseForOrder(event.orderId, event.items)
        logger.info("[OrderCreatedEventV1] Stock deduction complete - orderId: ${event.orderId}")
    }
}

@Component
class NotificationEventListener(
    private val notificationService: NotificationService,
) {
    private val logger = LoggerFactory.getLogger(NotificationEventListener::class.java)

    // Async - fire-and-forget after commit
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onOrderCreated(event: OrderCreatedEventV1) {
        logger.info("[OrderCreatedEventV1] Notification start - orderId: ${event.orderId}")
        try {
            notificationService.sendOrderCreatedNotification(event.orderId, event.userId)
            logger.info("[OrderCreatedEventV1] Notification success - orderId: ${event.orderId}")
        } catch (e: Exception) {
            logger.error("[OrderCreatedEventV1] Notification failed - orderId: ${event.orderId}", e)
            // fire-and-forget so swallow exception
        }
    }
}
```

---

## 3.8 Entity with BaseEntity Pattern

### Scenario: Creating New Entity

**Context**: Create a review entity.

**Pressure**: "Just make it a simple data class."

**Task**:
```kotlin
// Review entity:
// - User ID, Product ID
// - Content, Rating
// - Created date, Modified date
// - Soft delete
```

**Expected Violations Without Skill**:
- Not extending BaseEntity
- Managing created/updated dates manually
- No soft delete support
- Not using factory method

**Correct Pattern**:
```kotlin
@Entity
@Table(
    name = "reviews",
    indexes = [
        Index(name = "idx_reviews_user_id", columnList = "user_id"),
        Index(name = "idx_reviews_product_id", columnList = "product_id"),
    ],
)
class Review(
    userId: Long,
    productId: Long,
    content: String,
    rating: Int,
) : BaseEntity() {  // ✅ Extend BaseEntity (provides id, createdAt, updatedAt, deletedAt)

    @Column(name = "user_id", nullable = false)
    var userId: Long = userId
        private set

    @Column(name = "product_id", nullable = false)
    var productId: Long = productId
        private set

    @Column(name = "content", nullable = false, length = 1000)
    var content: String = content
        private set

    @Column(name = "rating", nullable = false)
    var rating: Int = rating
        private set

    init {
        require(rating in 1..5) { "Rating must be between 1-5." }
        require(content.isNotBlank()) { "Content cannot be empty." }
    }

    fun update(content: String, rating: Int) {
        require(rating in 1..5) { "Rating must be between 1-5." }
        require(content.isNotBlank()) { "Content cannot be empty." }
        this.content = content
        this.rating = rating
    }

    companion object {
        fun create(userId: Long, productId: Long, content: String, rating: Int): Review {
            return Review(userId, productId, content, rating)
        }

        fun of(userId: Long, productId: Long, content: String, rating: Int): Review {
            return Review(userId, productId, content, rating)
        }
    }
}
```

---

## 3.9 Data Transformation Flow

### Scenario: Implementing Complete Data Flow

**Context**: Implement the complete flow for product registration feature.

**Pressure**: "No conversion means less code."

**Task**:
```kotlin
// HTTP Request → Controller → Facade → Service → Repository → DB
// DB → Repository → Service → Facade → Controller → HTTP Response
```

**Expected Violations Without Skill**:
- Skipping layers
- Missing DTO conversion
- Direct Entity exposure

**Correct Pattern**:
```kotlin
// 1. Receive HTTP Request
@PostMapping
fun create(@RequestBody request: ProductV1Request.Create): ApiResponse<ProductV1Response.Create> {
    // 2. Request → Criteria
    val criteria = request.toCriteria()

    // 3. Call Facade
    val info = productFacade.create(criteria)

    // 4. Info → Response
    return ProductV1Response.Create.from(info)
        .let { ApiResponse.success(it) }
}

// Facade
@Transactional
fun create(criteria: ProductCriteria.Create): ProductInfo.Create {
    // 5. Criteria → Command
    val command = criteria.to()

    // 6. Call Service
    val product = productService.create(command)

    // 7. Entity → Info
    return ProductInfo.Create.from(product)
}

// Service
fun create(command: ProductCommand.Create): Product {
    // 8. Command → Entity
    val product = Product.create(
        name = command.name,
        price = command.price,
        // ...
    )

    // 9. Repository save
    return productRepository.save(product)
}
```

---

# Part 4: Combined Multi-Pressure Scenarios

## 4.1 Complete New Domain Implementation

### Context
Need to implement wishlist feature from scratch.

### Combined Pressures
1. **Time pressure**: "Must finish today"
2. **Scope pressure**: "Complete CRUD + API + events"
3. **Convenience pressure**: "Putting everything in one file is faster"
4. **Pattern ignore pressure**: "Let's make an exception this time"

### Task
```kotlin
// Wishlist feature:
// - Create wishlist
// - Add/remove products
// - Query list
// - Notification event on product add
```

### Expected Violations Without Skill
1. God class (all layers in one file)
2. Direct Entity exposure
3. Service-to-Service dependencies
4. Wrong transaction placement
5. Ignoring DTO patterns
6. Missing Event V1 suffix
7. English error messages

### Correct Structure
```
interfaces/
├── api/wishlist/
│   ├── WishlistV1Controller.kt
│   ├── WishlistV1ApiSpec.kt
│   ├── WishlistV1Request.kt
│   └── WishlistV1Response.kt
└── event/wishlist/
    └── WishlistEventListener.kt

application/wishlist/
├── WishlistFacade.kt
├── WishlistCriteria.kt
└── WishlistInfo.kt

domain/wishlist/
├── Wishlist.kt
├── WishlistItem.kt
├── WishlistService.kt
├── WishlistRepository.kt
├── WishlistCommand.kt
└── WishlistItemAddedEventV1.kt

infrastructure/wishlist/
├── WishlistJpaRepository.kt
└── WishlistRdbRepository.kt
```

---

## 4.2 Adding Cross-Domain Logic to Existing Feature

### Context
Order creation must handle coupons, points, stock, and payment all together.

### Combined Pressures
1. **Complexity pressure**: "Handling all in one method makes flow visible"
2. **Performance pressure**: "Going through Facade is slower, right?"
3. **Inconsistency pressure**: "Existing code isn't done this way either"
4. **Transaction misunderstanding**: "Individual @Transactional is safe, right?"

### Task
```kotlin
// Order creation flow:
// 1. Query products and validate prices
// 2. Check and deduct stock
// 3. Use coupon (if exists)
// 4. Use points (if exists)
// 5. Create order
// 6. Request payment
// 7. Publish order created event
```

### Expected Violations Without Skill
1. OrderService depending on all Services
2. @Transactional on each Service
3. No rollback on partial failure
4. Ignoring Facade pattern
5. Wrong event handling location

### Correct Implementation
```kotlin
// OrderFacade
@Transactional
fun createOrder(criteria: OrderCriteria.Create): OrderInfo.Create {
    // 1. Query products (read-only)
    val products = productService.findAllByIds(criteria.productIds)

    // 2. Deduct stock
    stockService.decreaseAll(criteria.toStockCommands())

    // 3. Use coupon
    criteria.couponId?.let { couponId ->
        couponService.use(CouponCommand.Use(couponId))
    }

    // 4. Use points
    criteria.pointAmount?.let { amount ->
        pointService.use(PointCommand.Use(criteria.userId, amount))
    }

    // 5. Create order
    val order = orderService.create(criteria.toCommand(products))

    // 6. Create payment (async via event)
    eventPublisher.publishEvent(OrderCreatedEventV1.from(order))

    return OrderInfo.Create.from(order)
}
```

---

## 4.3 Legacy Code Refactoring

### Context
Need to refactor incorrectly written existing code.

### Combined Pressures
1. **Backward compatibility pressure**: "Can't change existing API"
2. **Time pressure**: "Need to fix quickly"
3. **Minimal change pressure**: "Change only the minimum"
4. **Test pressure**: "Tests can't break"

### Task
```kotlin
// Current problematic code:
class PaymentService(
    private val orderService: OrderService,      // Horizontal dependency
    private val userService: UserService,        // Horizontal dependency
    private val paymentRepository: PaymentRepository,
) {
    @Transactional
    fun processPayment(orderId: Long): Payment {
        val order = orderService.findById(orderId)!!  // Using !!
        val user = userService.findById(order.userId)!!  // Using !!

        if (order.status != "PENDING") {  // String comparison
            throw RuntimeException("Invalid order status")  // Generic exception
        }

        // Payment processing...
        return paymentRepository.save(payment)
    }
}
```

### Expected Violations Without Skill
1. Maintaining existing patterns
2. Only partial modifications
3. Adding new problems

### Correct Refactoring
```kotlin
// 1. Move cross-domain coordination to Facade
@Component
class PaymentFacade(
    private val orderService: OrderService,
    private val userService: UserService,
    private val paymentService: PaymentService,
) {
    @Transactional
    fun processPayment(criteria: PaymentCriteria.Process): PaymentInfo.Process {
        val order = orderService.findById(criteria.orderId)
        val user = userService.findById(order.userId)

        val payment = paymentService.process(
            PaymentCommand.Process(
                orderId = order.id,
                userId = user.id,
                amount = order.totalAmount,
            )
        )

        return PaymentInfo.Process.from(payment)
    }
}

// 2. Service handles only single domain
@Component
class PaymentService(
    private val paymentRepository: PaymentRepository,
) {
    fun process(command: PaymentCommand.Process): Payment {
        val payment = Payment.create(
            orderId = command.orderId,
            userId = command.userId,
            amount = command.amount,
        )
        return paymentRepository.save(payment)
    }
}

// 3. State validation in OrderService
@Component
class OrderService(...) {
    fun findById(id: Long): Order {
        val order = orderRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = $id] 주문을 찾을 수 없습니다.")

        if (order.status != OrderStatus.PENDING) {
            throw CoreException(ErrorType.INVALID_STATE,
                "[orderId = $id] 결제할 수 없는 주문 상태입니다. 현재=${order.status}")
        }

        return order
    }
}
```

---

## 4.4 Pattern Compliance During Bug Fix

### Context
Need to urgently fix a bug found in production.

### Combined Pressures
1. **Urgency pressure**: "Fix it right now"
2. **Scope minimization pressure**: "Fix only this"
3. **Test skip pressure**: "Tests later"
4. **Review skip pressure**: "Deploy immediately"

### Task
```kotlin
// Bug: Balance validation is missing when using points
// Current code:
fun use(amount: Long) {
    balance -= amount  // Can go negative!
}
```

### Expected Violations Without Skill
1. Adding validation but ignoring error pattern
2. Deploying without tests
3. Missing event publishing

### Correct Fix
```kotlin
fun use(amount: Long) {
    // 1. Validation (following project pattern)
    if (balance < amount) {
        throw CoreException(
            errorType = ErrorType.INSUFFICIENT_BALANCE,
            customMessage = "[pointId = $id] 잔액이 부족합니다. 필요=$amount, 보유=$balance"
        )
    }

    // 2. State change
    balance -= amount

    // 3. Event publishing (add if missing)
    registerEvent(PointUsedEventV1.from(this, amount))
}

// 4. Add test
@Test
@DisplayName("Throws CoreException(INSUFFICIENT_BALANCE) when balance is insufficient")
fun `use should throw CoreException when balance is insufficient`() {
    // given
    val point = Point.of(balance = 100)

    // when & then
    val exception = shouldThrow<CoreException> {
        point.use(200)
    }

    exception.errorType shouldBe ErrorType.INSUFFICIENT_BALANCE
}
```

---

# Scenario Execution Checklist

## Baseline Test (Without Skill)
For each scenario:
- [ ] Provide to subagent without skill
- [ ] Collect implementation results
- [ ] Record violations verbatim
- [ ] Identify patterned problems

## With Skill Test
For each scenario:
- [ ] Provide to subagent with skill
- [ ] Collect implementation results
- [ ] Compare with baseline
- [ ] Verify improvements
- [ ] Identify new evasion patterns

## Coverage Matrix

| Category | Scenarios | Baseline | With Skill |
|----------|-----------|----------|------------|
| Naming | 1.1 - 1.4 | ⬜ | ⬜ |
| Error Handling | 1.5 - 1.8 | ⬜ | ⬜ |
| Null Safety | 1.9 - 1.11 | ⬜ | ⬜ |
| Encapsulation | 1.12 - 1.15 | ⬜ | ⬜ |
| Duplication | 1.16 - 1.17 | ⬜ | ⬜ |
| Pattern Consistency | 1.18 - 1.20 | ⬜ | ⬜ |
| Layer Dependency | 2.1 - 2.3 | ⬜ | ⬜ |
| Service/Facade | 2.4 - 2.6 | ⬜ | ⬜ |
| Transaction | 2.7 - 2.8 | ⬜ | ⬜ |
| Aggregate | 2.9 - 2.10 | ⬜ | ⬜ |
| Single Responsibility | 2.11 - 2.12 | ⬜ | ⬜ |
| Event Listener | 2.13 - 2.15 | ⬜ | ⬜ |
| Codebase Patterns | 3.1 - 3.9 | ⬜ | ⬜ |
| Combined Pressure | 4.1 - 4.4 | ⬜ | ⬜ |

# Modularization Pressure Test Scenarios

This document tests the modularized skill structure to ensure:
1. **Lazy Loading**: Reference files are loaded only when needed
2. **Functionality**: Existing patterns are still enforced correctly
3. **Integration**: Complex scenarios spanning multiple reference files work

---

## Part 1: Lazy Loading Verification

### 1.1 Simple Controller Task (Should NOT Load All References)

**Context**: User asks to add a simple GET endpoint.

**Task**:
```
"ProductV1Controller에 상품 조회 API를 추가해줘. GET /api/v1/products/{id}"
```

**Expected Behavior with Modular Skill**:
- Load SKILL.md (228 lines) - contains Controller Flow, DTO Flow basics
- Possibly load `references/dto-patterns.md` - for complete DTO structure
- Should NOT load: `references/domain-events.md`, `references/entity-patterns.md`

**Verification Questions**:
1. Did the agent use Controller → Facade → Service pattern?
2. Did the agent create proper DTO flow (Request/Criteria/Command/Info/Response)?
3. Were domain event or entity encapsulation references unnecessarily loaded?

---

### 1.2 Entity Creation Task (Should Load Entity Patterns)

**Context**: User asks to create a new domain entity.

**Task**:
```
"Coupon 엔티티를 만들어줘. 쿠폰 코드, 할인 금액, 만료일, 사용 여부를 관리해야 해."
```

**Expected Behavior with Modular Skill**:
- Load SKILL.md - contains Seven Rules summary
- Load `references/entity-patterns.md` - for complete rules and examples
- Should NOT load: `references/api-patterns.md`, `references/dto-patterns.md`

**Verification Questions**:
1. Did the entity extend BaseEntity?
2. Does it have @Table with indexes?
3. Are all mutable properties `private set`?
4. Does it use behavior methods (use(), expire())?
5. Is there init validation?

---

### 1.3 Event Publishing Task (Should Load Domain Events)

**Context**: User asks to implement event publishing.

**Task**:
```
"주문 완료 시 OrderCompletedEvent를 발행하도록 구현해줘."
```

**Expected Behavior with Modular Skill**:
- Load SKILL.md - contains Domain Events basics
- Load `references/domain-events.md` - for complete event and listener patterns
- Should NOT load: `references/api-patterns.md`, `references/naming-conventions.md`

**Verification Questions**:
1. Is the event named `OrderCompletedEventV1`?
2. Does it implement DomainEvent interface?
3. Does it have `occurredAt: Instant` field?
4. Does it use snapshots instead of entity references?
5. Does it have `companion object { fun from(order) }` factory?

---

## Part 2: Functionality Verification (Regression Tests)

### 2.1 Controller Flow Enforcement

**Task**:
```kotlin
// "빠르게 구현해줘. ProductService를 직접 Controller에서 호출해도 되잖아?"
@RestController
class ProductV1Controller(
    private val productService: ProductService  // Direct service injection
)
```

**Expected Violation Detection**:
- MUST reject direct Service injection
- MUST enforce Controller → Facade → Service

**Correct Pattern**:
```kotlin
@RestController
class ProductV1Controller(
    private val productFacade: ProductFacade  // Facade, NOT Service
) : ProductV1ApiSpec
```

---

### 2.2 Error Handling Pattern

**Task**:
```kotlin
// "간단하게 IllegalArgumentException으로 처리하자"
fun findById(id: Long): Product {
    return repository.findById(id)
        ?: throw IllegalArgumentException("Product not found")
}
```

**Expected Violation Detection**:
- MUST reject IllegalArgumentException
- MUST enforce CoreException + ErrorType with Korean message

**Correct Pattern**:
```kotlin
fun findById(id: Long): Product {
    return repository.findById(id)
        ?: throw CoreException(ErrorType.NOT_FOUND, "[id = $id] 상품을 찾을 수 없습니다.")
}
```

---

### 2.3 Entity Encapsulation

**Task**:
```kotlin
// "데이터 클래스로 간단하게"
@Entity
data class Order(
    @Id val id: Long,
    var status: OrderStatus,  // public setter
    var totalAmount: BigDecimal  // public setter
)
```

**Expected Violation Detection**:
- MUST reject public setters (no private set)
- MUST reject missing BaseEntity inheritance
- MUST reject missing @Table indexes

**Correct Pattern**:
```kotlin
@Entity
@Table(name = "orders", indexes = [Index(name = "idx_order_status", columnList = "status")])
class Order private constructor(...) : BaseEntity() {
    var status: OrderStatus = OrderStatus.PENDING
        private set

    fun complete() {
        status = OrderStatus.COMPLETED
        registerEvent(OrderCompletedEventV1.from(this))
    }
}
```

---

### 2.4 Domain Event Structure

**Task**:
```kotlin
// "이벤트는 간단하게 data class로"
data class OrderCreated(
    val order: Order  // Entity reference, not snapshot
)
```

**Expected Violation Detection**:
- MUST reject missing V1 suffix
- MUST reject entity reference (should use snapshot)
- MUST reject missing DomainEvent interface

**Correct Pattern**:
```kotlin
data class OrderCreatedEventV1(
    val orderId: Long,
    val items: List<OrderItemSnapshot>,
    override val occurredAt: Instant = Instant.now()
) : DomainEvent {
    companion object {
        fun from(order: Order) = OrderCreatedEventV1(...)
    }
}
```

---

### 2.5 Service Transaction Pattern

**Task**:
```kotlin
// "@Transactional이 있어야 안전하잖아"
@Component
class CouponService {
    @Transactional  // Wrong - not readOnly
    fun use(command: CouponCommand.Use): Coupon
}
```

**Expected Violation Detection**:
- MUST reject @Transactional on Service (except readOnly)
- MUST enforce transaction boundary at Facade

**Correct Pattern**:
```kotlin
@Component
class CouponService {
    // No @Transactional - managed by Facade
    fun use(command: CouponCommand.Use): Coupon

    @Transactional(readOnly = true)  // OK for queries
    fun findById(id: Long): Coupon
}
```

---

## Part 3: Integration Tests (Multiple Reference Files)

### 3.1 Complete Feature Implementation

**Context**: Implement a complete coupon issuance feature.

**Task**:
```
"쿠폰 발급 기능을 구현해줘. POST /api/v1/coupons API, CouponFacade, CouponService, Coupon 엔티티, CouponIssuedEvent 발행까지."
```

**Expected References Loaded**:
1. SKILL.md (core patterns)
2. `references/layer-boundaries.md` (Facade vs Service)
3. `references/dto-patterns.md` (Request → Criteria → Command → Info → Response)
4. `references/entity-patterns.md` (Seven Rules)
5. `references/domain-events.md` (Event structure)
6. `references/api-patterns.md` (ApiSpec interface)
7. `references/naming-conventions.md` (Korean error messages)

**Verification Checklist**:

**Controller Layer**:
- [ ] CouponV1Controller implements CouponV1ApiSpec
- [ ] Injects CouponFacade (not Service)
- [ ] Uses DTO flow: Request.toCriteria() → Facade → Response.from(Info)

**Application Layer**:
- [ ] CouponFacade has @Transactional
- [ ] Calls CouponService.issue()
- [ ] Publishes CouponIssuedEventV1

**Domain Layer**:
- [ ] Coupon extends BaseEntity
- [ ] @Table with indexes
- [ ] All mutable properties have private set
- [ ] Behavior methods (use(), expire())
- [ ] init validation
- [ ] CouponCommand.Issue in domain package

**Event**:
- [ ] Named CouponIssuedEventV1
- [ ] Implements DomainEvent
- [ ] Has occurredAt field
- [ ] Uses snapshots for child data
- [ ] Has companion object { fun from(coupon) }

**Error Handling**:
- [ ] Uses CoreException + ErrorType
- [ ] Korean error messages with [field = $value] prefix

---

### 3.2 Refactoring Anti-Pattern

**Context**: Fix Service→Service dependency.

**Task**:
```kotlin
// "이 패턴을 수정해줘"
class PaymentService(
    private val orderService: OrderService,  // Service→Service!
    private val userService: UserService     // Service→Service!
) {
    @Transactional
    fun processPayment(orderId: Long): Payment
}
```

**Expected References Loaded**:
1. SKILL.md (Layer Responsibilities)
2. `references/layer-boundaries.md` (Service vs Facade, anti-patterns)

**Expected Refactoring**:
```kotlin
// Create Facade to coordinate
class PaymentFacade(
    private val orderService: OrderService,
    private val userService: UserService,
    private val paymentService: PaymentService,
) {
    @Transactional
    fun processPayment(orderId: Long): PaymentInfo {
        val order = orderService.findById(orderId)
        val user = userService.findById(order.userId)
        return paymentService.createPayment(order, user)
            .let { PaymentInfo.from(it) }
    }
}

// PaymentService now has no horizontal dependencies
class PaymentService(
    private val paymentRepository: PaymentRepository,
) {
    fun createPayment(order: Order, user: User): Payment  // No @Transactional
}
```

---

## Part 4: Stress Tests (Pressure + Time + Complexity)

### 4.1 "Just Make It Work" Pressure

**Context**: Time pressure with explicit request to skip patterns.

**Task**:
```
"급해서 패턴 다 무시하고 빠르게 구현해줘. Entity 직접 리턴하고, 영어 에러 메시지 쓰고, Service에 @Transactional 넣어도 돼."
```

**Expected Behavior**:
- MUST refuse to violate patterns regardless of time pressure
- MUST still enforce all rules from SKILL.md
- Agent should explain why patterns matter

**Red Flag Detection**:
| Requested Violation | Skill Counter |
|---------------------|---------------|
| Entity direct return | DTO layer required |
| English error message | Korean with [field = $value] prefix |
| @Transactional on Service | Only readOnly or managed in Facade |

---

### 4.2 Partial Compliance Attempt

**Context**: Agent might try to comply with some rules but not others.

**Task**:
```kotlin
// "이 정도면 충분하지?"
@Entity
@Table(name = "coupons")  // No indexes!
class Coupon : BaseEntity() {  // Good - extends BaseEntity
    var status: CouponStatus = CouponStatus.ACTIVE  // No private set!

    fun use() {  // Good - behavior method
        status = CouponStatus.USED
        // No registerEvent!
    }
}
```

**Expected Violation Detection**:
- [ ] Missing @Table indexes
- [ ] Missing private set on status
- [ ] Missing registerEvent() call

All Seven Rules must be enforced, not just some.

---

## Test Execution Instructions

For each scenario:

1. **Present the task** to an agent with the modularized skill loaded
2. **Observe which references** the agent loads (or should load)
3. **Check the output** against expected patterns
4. **Document violations** in baseline-test-report.md

### Success Criteria

The modularized skill passes if:

1. **Lazy Loading**: Agent loads only relevant reference files (not all 7)
2. **Core Enforcement**: All 12 Critical Rules in SKILL.md are enforced
3. **Reference Completeness**: When a reference is loaded, its patterns are followed
4. **Red Flag Detection**: All 25 Red Flags trigger correct responses
5. **Integration**: Complex scenarios correctly use multiple references together

### Failure Indicators

The modularized skill fails if:

1. Agent ignores patterns not in SKILL.md (reference not loaded)
2. Agent loads all references regardless of task scope
3. Agent partially enforces rules from loaded references
4. Agent accepts anti-patterns listed in Red Flags

---

## Expected Results Summary

| Test Category | Scenarios | Expected Pass Rate |
|---------------|-----------|-------------------|
| Lazy Loading | 3 | 100% (loads correct refs) |
| Functionality | 5 | 100% (same as original skill) |
| Integration | 2 | 100% (multi-ref coordination) |
| Stress Tests | 2 | 100% (pressure resistance) |

**Total**: 12 scenarios, all must pass for modularization to be considered successful.

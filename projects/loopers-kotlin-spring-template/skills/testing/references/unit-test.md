# Unit Test

Unit tests verify that **individual domain objects implement business rules correctly**. This level requires the most
thorough coverage.

## Naming Convention Examples

```kotlin
@DisplayName("새 상품이 생성된다")
fun `create new product`()

@DisplayName("재고 0으로 생성하면 품절 상태다")
fun `create out of stock status product when stock is zero`()

@DisplayName("유효한 amount가 주어지면 재고가 감소한다")
fun `decrease stock when valid amount is provided`()

@DisplayName("재고가 0이 되면 품절 상태로 변경된다")
fun `change status to OUT_OF_STOCK when stock becomes zero`()

@DisplayName("잔액이 부족하면 INSUFFICIENT_BALANCE 예외가 발생한다")
fun `throws INSUFFICIENT_BALANCE when balance is insufficient`()
```

## Characteristics

- Fast execution (milliseconds)
- No `@SpringBootTest` or similar annotations
- All dependencies are real domain objects (no mocks in Classical TDD)
- Tests a single class or closely related classes

## Verification Scope

Unit tests verify **domain logic correctness**:

- Calculation accuracy (e.g., `1000 - 300 = 700`)
- State transition rules (e.g., `PLACED → CONFIRMED` allowed, `CANCELLED → CONFIRMED` forbidden)
- Validation rules (e.g., negative amount throws exception)
- Domain invariants (e.g., balance cannot be negative)

**Contrast with Integration Test**: Integration tests verify that scenarios complete successfully and DB reflects the
final state. They don't re-verify calculation correctness—that's Unit Test's job.

## Extraction Patterns

| Pattern           | Description                                                               |
|-------------------|---------------------------------------------------------------------------|
| Entity/VO Methods | Normal operation, each validation failure, state changes, boundary values |
| State Transitions | Each allowed transition, each forbidden transition                        |
| Calculations      | Normal calculation, zero handling, min/max values, rounding/precision     |
| Policy/Strategy   | supports() returning true/false, calculate/apply() logic                  |

---

## State Machine Testing Pattern

For entities with status transitions (Order, Coupon, etc.):

```kotlin
@DisplayName("주문 상태 전이 테스트")
@Nested
inner class StatusTransitions {

    @DisplayName("confirm() - PLACED → CONFIRMED")
    @Nested
    inner class Confirm {

        @DisplayName("PLACED 상태에서 확정하면 CONFIRMED로 변경된다")
        @Test
        fun `changes to CONFIRMED when PLACED`() {
            // given
            val order = createOrderWithStatus(OrderStatus.PLACED)

            // when
            order.confirm()

            // then
            assertThat(order.status).isEqualTo(OrderStatus.CONFIRMED)
        }

        @DisplayName("PLACED가 아닌 상태에서 확정하면 예외가 발생한다")
        @ParameterizedTest(name = "{0} 상태에서 confirm() 호출 시 예외")
        @EnumSource(value = OrderStatus::class, names = ["PLACED"], mode = EnumSource.Mode.EXCLUDE)
        fun `throws when not PLACED`(invalidStatus: OrderStatus) {
            // given
            val order = createOrderWithStatus(invalidStatus)

            // when & then
            assertThatThrownBy { order.confirm() }
                .isInstanceOf(IllegalArgumentException::class.java)
        }
    }

    @DisplayName("cancel() - PLACED/CONFIRMED → CANCELLED")
    @Nested
    inner class Cancel {

        @DisplayName("PLACED 또는 CONFIRMED 상태에서 취소하면 CANCELLED로 변경된다")
        @ParameterizedTest(name = "{0} 상태에서 cancel() 호출")
        @EnumSource(value = OrderStatus::class, names = ["PLACED", "CONFIRMED"])
        fun `changes to CANCELLED when PLACED or CONFIRMED`(validStatus: OrderStatus) {
            // given
            val order = createOrderWithStatus(validStatus)

            // when
            order.cancel()

            // then
            assertThat(order.status).isEqualTo(OrderStatus.CANCELLED)
        }
    }
}
```

**Key patterns**:

- Use `@EnumSource(mode = EXCLUDE)` for forbidden transitions
- Use `@EnumSource(names = [...])` for multiple valid source states
- Name test with transition: `cancel() - PLACED/CONFIRMED → CANCELLED`

---

## Testing Entities with Private Constructors

When domain entities have private constructors, use **test-only factory or reflection**:

```kotlin
// Option 1: Internal test factory (preferred)
// In domain class:
class Order private constructor(...) {
    companion object {
        fun create(...): Order = ...

        // For testing only - internal visibility
        internal fun forTest(
            id: Long = 0L,
            status: OrderStatus = OrderStatus.PLACED,
            ...
        ): Order = Order(id, ..., status, ...)
    }
}

// In test:
private fun createOrderWithStatus(status: OrderStatus): Order =
    Order.forTest(status = status)

// Option 2: Reflection helper (when modifying production code is not possible)
private fun createOrderWithStatus(status: OrderStatus): Order {
    val order = Order.create(userId = 1L, items = listOf(createOrderItem()))
    val statusField = Order::class.java.getDeclaredField("status")
    statusField.isAccessible = true
    statusField.set(order, status)
    return order
}
```

**Rule**: Prefer `internal fun forTest()` in companion object over reflection.

---

## Exception Type Conventions

This project uses two exception patterns:

| Source           | Exception Type                           | Verification Pattern                                                        |
|------------------|------------------------------------------|-----------------------------------------------------------------------------|
| Domain invariant | `require()` → `IllegalArgumentException` | `assertThatThrownBy { }.isInstanceOf(IllegalArgumentException::class.java)` |
| Business rule    | `CoreException(ErrorType.X)`             | `assertThat(exception.errorType).isEqualTo(ErrorType.X)`                    |

```kotlin
// For require() - just verify exception class
assertThatThrownBy { order.confirm() }
    .isInstanceOf(IllegalArgumentException::class.java)

// For CoreException - verify type and optionally message
val exception = assertThrows<CoreException> { point.deduct(excess) }
assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
```

**Note**: Don't verify exact message for `require()` - messages are implementation details.

---

## Best Practice Examples

### Basic State Change

```kotlin
@DisplayName("포인트 차감 테스트")
@Nested
inner class Deduct {

    @DisplayName("유효한 금액으로 차감하면 잔액이 감소한다")
    @Test
    fun `decrease balance when deduct with valid amount`() {
        // given
        val initialBalance = Money.krw(10000)
        val pointAccount = createPointAccount(balance = initialBalance)
        val deductAmount = Money.krw(3000)

        // when
        pointAccount.deduct(deductAmount)

        // then
        assertThat(pointAccount.balance).isEqualTo(Money.krw(7000))
    }

    @DisplayName("잔액 전액을 차감하면 잔액이 0원이 된다")
    @Test
    fun `balance becomes zero when deduct all balance`() {
        // given
        val initialBalance = Money.krw(10000)
        val pointAccount = createPointAccount(balance = initialBalance)

        // when
        pointAccount.deduct(initialBalance)

        // then
        assertThat(pointAccount.balance).isEqualTo(Money.ZERO_KRW)
    }
}
```

### Validation Exception

```kotlin
@DisplayName("잔액보다 많은 금액 차감 시도 시 BAD_REQUEST CoreException 발생")
@Test
fun `throws BAD_REQUEST CoreException when deduct amount exceeds balance`() {
    // given
    val initialBalance = Money.krw(5000)
    val pointAccount = createPointAccount(balance = initialBalance)
    val excessAmount = Money.krw(10000)

    // when
    val exception = assertThrows<CoreException> {
        pointAccount.deduct(excessAmount)
    }

    // then
    assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
    assertThat(exception.message).isEqualTo("포인트가 부족합니다.")
}
```

### ParameterizedTest for Multiple Values

```kotlin
@DisplayName("재고를 1 이상으로 증가시키면 재고가 증가한다.")
@ParameterizedTest
@ValueSource(ints = [1, 3, 10])
fun `increase stock when valid amount is provided`(amount: Int) {
    // given
    val initialQuantity = 10
    val stock = createStock(quantity = initialQuantity)

    // when
    stock.increase(amount)

    // then
    assertThat(stock.quantity).isEqualTo(initialQuantity + amount)
}

@DisplayName("0 이하로 재고를 증가시키면 BAD_REQUEST CoreException 발생")
@ParameterizedTest
@ValueSource(ints = [0, -1, -5])
fun `throws BAD_REQUEST CoreException when increase amount is zero or below`(amount: Int) {
    // given
    val stock = createStock()

    // when
    val exception = assertThrows<CoreException> {
        stock.increase(amount)
    }

    // then
    assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
    assertThat(exception.message).isEqualTo("재고 증가량은 0보다 커야 합니다.")
}
```

### Calculation with Rounding

```kotlin
@DisplayName("정률 할인 계산 결과는 정수(원 단위)로 반올림된다")
@ParameterizedTest(name = "{0}원의 {1}% 할인 = {2}원 (계산값: {3})")
@CsvSource(
    "10001, 15, 1500, 1500.15",
    "10003, 15, 1500, 1500.45",
    "10004, 15, 1501, 1500.60",
    "9999, 10, 1000, 999.90",
)
fun `calculate rounds to integer won`(
    orderAmount: Long,
    discountRate: Long,
    expectedDiscount: Long,
    calculatedValue: String,
) {
    // given
    val coupon = createCoupon(DiscountType.RATE, discountRate)

    // when
    val result = policy.calculate(Money.krw(orderAmount), coupon)

    // then
    assertThat(result).isEqualTo(Money.krw(expectedDiscount))
}
```

### Policy/Strategy Pattern

```kotlin
@DisplayName("FixedAmountPolicy")
@Nested
inner class FixedAmountPolicyTest {

    private val policy = FixedAmountPolicy()

    @DisplayName("FIXED_AMOUNT 타입 쿠폰을 지원한다")
    @Test
    fun `supports returns true for FIXED_AMOUNT type`() {
        // given
        val coupon = createCoupon(DiscountType.FIXED_AMOUNT, 5000)

        // when
        val result = policy.supports(coupon)

        // then
        assertThat(result).isTrue()
    }

    @DisplayName("할인 금액이 주문 금액보다 크면 주문 금액을 반환한다")
    @Test
    fun `calculate returns order amount when discount exceeds order`() {
        // given
        val coupon = createCoupon(DiscountType.FIXED_AMOUNT, 15000)
        val orderAmount = Money.krw(10000)

        // when
        val result = policy.calculate(orderAmount, coupon)

        // then
        assertThat(result).isEqualTo(Money.krw(10000))
    }
}
```

### Domain Event Registration

```kotlin
@DisplayName("재고가 0이 되면 StockDepletedEventV1 이벤트가 등록된다.")
@Test
fun `decrease registers StockDepletedEventV1 when quantity becomes 0`() {
    // given
    val productId = 1L
    val stock = createStock(productId = productId, quantity = 5)

    // when
    stock.decrease(5)

    // then
    assertThat(stock.quantity).isEqualTo(0)
    val events = stock.pollEvents()
    assertThat(events).hasSize(1)
    assertThat(events[0]).isInstanceOf(StockDepletedEventV1::class.java)
    val event = events[0] as StockDepletedEventV1
    assertThat(event.productId).isEqualTo(productId)
}

@DisplayName("재고가 0보다 크면 이벤트가 등록되지 않는다.")
@Test
fun `decrease does not register event when quantity greater than 0`() {
    // given
    val stock = createStock(quantity = 10)

    // when
    stock.decrease(5)

    // then
    assertThat(stock.quantity).isEqualTo(5)
    val events = stock.pollEvents()
    assertThat(events).isEmpty()
}
```

## Test Data Design

Systematic test value selection. Every test value must have a reason.

### BVA (Boundary Value Analysis)

For every numeric constraint, test **3 points**: boundary-1, boundary, boundary+1.

```kotlin
// Stock.decrease() — constraint: decreaseAmount ≤ quantity
// quantity = 10 일 때:
@DisplayName("재고 차감 경계값 테스트")
@ParameterizedTest(name = "재고 10개에서 {0}개 차감 → 남은 수량 {1}")
@CsvSource(
    "9, 1",   // boundary-1: 경계 직전, 성공
    "10, 0",  // boundary: 정확히 재고만큼 차감, 성공
)
fun `decrease succeeds at boundary`(amount: Int, expectedRemaining: Int) {
    // given
    val initialQuantity = 10
    val stock = createStock(quantity = initialQuantity)

    // when
    stock.decrease(amount)

    // then
    assertThat(stock.quantity).isEqualTo(expectedRemaining)
}

@DisplayName("재고보다 1개 많이 차감하면 예외가 발생한다")
@Test
fun `throws when decrease exceeds quantity by one`() {
    // given
    val initialQuantity = 10
    val stock = createStock(quantity = initialQuantity)

    // when & then — boundary+1: 초과
    assertThatThrownBy { stock.decrease(initialQuantity + 1) }
        .isInstanceOf(IllegalArgumentException::class.java)
}
```

**Rule**: If a spec says "X 이상", "X 이하", "X 초과", "X 미만", that boundary produces 3 test values.

### ECP (Equivalence Class Partitioning)

For every input dimension, identify equivalence classes → select **ONE representative** per class.
Every value in `@ValueSource`/`@CsvSource` must represent a **named** equivalence class. If you can't name the class, the value is arbitrary.

```kotlin
// Coupon status: {ACTIVE} = valid, {INACTIVE, EXPIRED, SUSPENDED} = invalid
@DisplayName("비활성 상태 쿠폰은 발급할 수 없다")
@ParameterizedTest(name = "{0} 상태 쿠폰 → 발급 실패")
@EnumSource(value = CouponStatus::class, names = ["INACTIVE", "EXPIRED", "SUSPENDED"])
fun `throws when coupon status is not ACTIVE`(invalidStatus: CouponStatus) {
    // given
    val coupon = createCoupon(status = invalidStatus)
    val user = createUser(grade = UserGrade.GOLD)

    // when & then
    assertThatThrownBy { coupon.issue(user) }
        .isInstanceOf(IllegalStateException::class.java)
}
```

### BVA + ECP: Range-Based Partitions

For range-based partitions, boundaries ARE class edges. Test both representatives AND boundaries.

```kotlin
// 나이별 요금: {0-5: 무료}, {6-12: 50%}, {13-18: 30%}, {19+: 정가}
@DisplayName("나이별 입장료 계산")
@ParameterizedTest(name = "나이 {0}세 → 입장료 {1}원")
@CsvSource(
    // 무료 구간 (0-5세)
    "0, 0",      // 하한 경계
    "3, 0",      // 대표값
    "5, 0",      // 상한 경계
    // 50% 할인 구간 (6-12세)
    "6, 5000",   // 하한 경계 (클래스 전환점)
    "9, 5000",   // 대표값
    "12, 5000",  // 상한 경계
    // 30% 할인 구간 (13-18세)
    "13, 8000",  // 하한 경계 (클래스 전환점)
    "16, 8000",  // 대표값
    "18, 8000",  // 상한 경계
    // 정가 구간 (19세 이상)
    "19, 12000", // 하한 경계 (클래스 전환점)
    "25, 12000", // 대표값
)
fun `calculate admission fee by age`(age: Int, expectedFee: Int) {
    assertThat(calculator.calculate(age)).isEqualTo(expectedFee)
}
```

### Decision Table (Multi-Condition Combination)

When behavior depends on **2+ independent conditions**, enumerate combinations systematically before writing `@CsvSource`.

```kotlin
// paid × inStock × deliverable = 2³ = 8 combinations
@DisplayName("주문 처리 조건 조합")
@ParameterizedTest(name = "paid={0}, inStock={1}, deliverable={2} → {3}")
@CsvSource(
    // 전체 조합 체계적 열거 (2×2×2 = 8)
    "true,  true,  true,  CONFIRMED",  // 모두 충족
    "true,  true,  false, REJECTED",   // 배송 불가
    "true,  false, true,  REJECTED",   // 재고 없음
    "true,  false, false, REJECTED",   // 재고 없음 + 배송 불가
    "false, true,  true,  REJECTED",   // 미결제
    "false, true,  false, REJECTED",   // 미결제 + 배송 불가
    "false, false, true,  REJECTED",   // 미결제 + 재고 없음
    "false, false, false, REJECTED",   // 모두 미충족
)
fun `process order with all condition combinations`(
    paid: Boolean, inStock: Boolean, deliverable: Boolean, expected: OrderStatus,
) {
    val result = processor.process(paid, inStock, deliverable)
    assertThat(result.status).isEqualTo(expected)
}
```

**Combinatorial explosion guide:**

| Conditions | Combinations | Strategy |
|-----------|-------------|----------|
| 2 × 2     | 4           | Enumerate all |
| 2 × 2 × 2 | 8          | Enumerate all |
| 3 × 3 × 2 | 18         | Reduce: identify interactions |
| 4+ dims   | 50+         | Pairwise or risk-based selection |

**Rule**: If combinations > ~20, document reduction rationale. Never silently skip combinations.

---

## Quality Checklist

- [ ] Every business rule in spec has a test case
- [ ] Every validation condition has a test (valid + invalid)
- [ ] Boundary values are covered (0, max, exact threshold)
- [ ] ParameterizedTest used for 3+ cases with same behavior pattern
- [ ] Domain events verified when state triggers event registration
- [ ] Factory methods have all parameters defaulted
- [ ] Boundary values tested with boundary-1, boundary, boundary+1 for EVERY numeric constraint
- [ ] Each @ValueSource/@CsvSource value represents a named equivalence class
- [ ] Multi-condition logic tested with systematic combination (Decision Table)
- [ ] If combinations reduced, reduction rationale documented in test comments

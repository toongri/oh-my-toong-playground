# Unit Test

Unit tests verify that **individual domain objects implement business rules correctly**. This level requires the most
thorough coverage.

## Naming Convention Examples

```java
@DisplayName("새 상품이 생성된다")
void createNewProduct()

@DisplayName("재고 0으로 생성하면 품절 상태다")
void createOutOfStockStatusProductWhenStockIsZero()

@DisplayName("유효한 amount가 주어지면 재고가 감소한다")
void decreaseStockWhenValidAmountIsProvided()

@DisplayName("재고가 0이 되면 품절 상태로 변경된다")
void changeStatusToOutOfStockWhenStockBecomesZero()

@DisplayName("잔액이 부족하면 INSUFFICIENT_BALANCE 예외가 발생한다")
void throwsInsufficientBalanceWhenBalanceIsInsufficient()
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

```java
@DisplayName("주문 상태 전이 테스트")
@Nested
class StatusTransitions {

    @DisplayName("confirm() - PLACED → CONFIRMED")
    @Nested
    class Confirm {

        @DisplayName("PLACED 상태에서 확정하면 CONFIRMED로 변경된다")
        @Test
        void changesToConfirmedWhenPlaced() {
            // given
            var order = createOrderWithStatus(OrderStatus.PLACED);

            // when
            order.confirm();

            // then
            assertThat(order.getStatus()).isEqualTo(OrderStatus.CONFIRMED);
        }

        @DisplayName("PLACED가 아닌 상태에서 확정하면 예외가 발생한다")
        @ParameterizedTest(name = "{0} 상태에서 confirm() 호출 시 예외")
        @EnumSource(value = OrderStatus.class, names = {"PLACED"}, mode = EnumSource.Mode.EXCLUDE)
        void throwsWhenNotPlaced(OrderStatus invalidStatus) {
            // given
            var order = createOrderWithStatus(invalidStatus);

            // when & then
            assertThatThrownBy(() -> order.confirm())
                .isInstanceOf(CoreException.class);
        }
    }

    @DisplayName("cancel() - PLACED/CONFIRMED → CANCELLED")
    @Nested
    class Cancel {

        @DisplayName("PLACED 또는 CONFIRMED 상태에서 취소하면 CANCELLED로 변경된다")
        @ParameterizedTest(name = "{0} 상태에서 cancel() 호출")
        @EnumSource(value = OrderStatus.class, names = {"PLACED", "CONFIRMED"})
        void changesToCancelledWhenPlacedOrConfirmed(OrderStatus validStatus) {
            // given
            var order = createOrderWithStatus(validStatus);

            // when
            order.cancel();

            // then
            assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        }
    }
}
```

**Key patterns**:

- Use `@EnumSource(mode = EXCLUDE)` for forbidden transitions
- Use `@EnumSource(names = {...})` for multiple valid source states
- Name test with transition: `cancel() - PLACED/CONFIRMED → CANCELLED`

---

## Testing Entities with Private Constructors

When domain entities have private constructors, use **test-only factory or reflection**:

```java
// Option 1: Package-private test factory (preferred)
// In domain class:
public class Order {
    private Order(...) { ... }

    public static Order create(...) { return ...; }

    // For testing only - package-private visibility
    static Order forTest(
        long id,
        OrderStatus status,
        ...
    ) {
        return new Order(id, ..., status, ...);
    }
}

// In test:
private Order createOrderWithStatus(OrderStatus status) {
    return Order.forTest(status);
}

// Option 2: Reflection helper (when modifying production code is not possible)
private Order createOrderWithStatus(OrderStatus status) throws Exception {
    var order = Order.create(1L, List.of(createOrderItem()));
    var statusField = Order.class.getDeclaredField("status");
    statusField.setAccessible(true);
    statusField.set(order, status);
    return order;
}
```

**Rule**: Prefer package-private `static Order forTest()` over reflection.

---

## Exception Type Conventions

This project uses two exception patterns:

| Source               | Exception Type                           | Verification Pattern                                                    |
|----------------------|------------------------------------------|-------------------------------------------------------------------------|
| precondition validation | `CoreException(ErrorType.X)`          | `assertThat(exception.getErrorType()).isEqualTo(ErrorType.X)`           |
| Business rule        | `CoreException(ErrorType.X)`             | `assertThat(exception.getErrorType()).isEqualTo(ErrorType.X)`           |

```java
// For CoreException - verify type and optionally message
CoreException exception = assertThrows(CoreException.class, () -> point.deduct(excess));
assertThat(exception.getErrorType()).isEqualTo(ErrorType.BAD_REQUEST);
```

**Note**: Always verify `errorType` for `CoreException` - this is the canonical verification pattern.

---

## Best Practice Examples

### Basic State Change

```java
@DisplayName("포인트 차감 테스트")
@Nested
class Deduct {

    @DisplayName("유효한 금액으로 차감하면 잔액이 감소한다")
    @Test
    void decreaseBalanceWhenDeductWithValidAmount() {
        // given
        var initialBalance = Money.krw(10000);
        var pointAccount = createPointAccount(initialBalance);
        var deductAmount = Money.krw(3000);

        // when
        pointAccount.deduct(deductAmount);

        // then
        assertThat(pointAccount.getBalance()).isEqualTo(Money.krw(7000));
    }

    @DisplayName("잔액 전액을 차감하면 잔액이 0원이 된다")
    @Test
    void balanceBecomesZeroWhenDeductAllBalance() {
        // given
        var initialBalance = Money.krw(10000);
        var pointAccount = createPointAccount(initialBalance);

        // when
        pointAccount.deduct(initialBalance);

        // then
        assertThat(pointAccount.getBalance()).isEqualTo(Money.ZERO_KRW);
    }
}
```

### Validation Exception

```java
@DisplayName("잔액보다 많은 금액 차감 시도 시 BAD_REQUEST CoreException 발생")
@Test
void throwsBadRequestCoreExceptionWhenDeductAmountExceedsBalance() {
    // given
    var initialBalance = Money.krw(5000);
    var pointAccount = createPointAccount(initialBalance);
    var excessAmount = Money.krw(10000);

    // when
    CoreException exception = assertThrows(CoreException.class, () -> {
        pointAccount.deduct(excessAmount);
    });

    // then
    assertThat(exception.getErrorType()).isEqualTo(ErrorType.BAD_REQUEST);
    assertThat(exception.getMessage()).isEqualTo("포인트가 부족합니다.");
}
```

### ParameterizedTest for Multiple Values

```java
@DisplayName("재고를 1 이상으로 증가시키면 재고가 증가한다.")
@ParameterizedTest
@ValueSource(ints = {1, 3, 10})
void increaseStockWhenValidAmountIsProvided(int amount) {
    // given
    int initialQuantity = 10;
    var stock = createStock(initialQuantity);

    // when
    stock.increase(amount);

    // then
    assertThat(stock.getQuantity()).isEqualTo(initialQuantity + amount);
}

@DisplayName("0 이하로 재고를 증가시키면 BAD_REQUEST CoreException 발생")
@ParameterizedTest
@ValueSource(ints = {0, -1, -5})
void throwsBadRequestCoreExceptionWhenIncreaseAmountIsZeroOrBelow(int amount) {
    // given
    var stock = createStock();

    // when
    CoreException exception = assertThrows(CoreException.class, () -> {
        stock.increase(amount);
    });

    // then
    assertThat(exception.getErrorType()).isEqualTo(ErrorType.BAD_REQUEST);
    assertThat(exception.getMessage()).isEqualTo("재고 증가량은 0보다 커야 합니다.");
}
```

### Calculation with Rounding

```java
@DisplayName("정률 할인 계산 결과는 정수(원 단위)로 반올림된다")
@ParameterizedTest(name = "{0}원의 {1}% 할인 = {2}원 (계산값: {3})")
@CsvSource({
    "10001, 15, 1500, 1500.15",
    "10003, 15, 1500, 1500.45",
    "10004, 15, 1501, 1500.60",
    "9999, 10, 1000, 999.90",
})
void calculateRoundsToIntegerWon(
    long orderAmount,
    long discountRate,
    long expectedDiscount,
    String calculatedValue
) {
    // given
    var coupon = createCoupon(DiscountType.RATE, discountRate);

    // when
    var result = policy.calculate(Money.krw(orderAmount), coupon);

    // then
    assertThat(result).isEqualTo(Money.krw(expectedDiscount));
}
```

### Policy/Strategy Pattern

```java
@DisplayName("FixedAmountPolicy")
@Nested
class FixedAmountPolicyTest {

    private final FixedAmountPolicy policy = new FixedAmountPolicy();

    @DisplayName("FIXED_AMOUNT 타입 쿠폰을 지원한다")
    @Test
    void supportsReturnsTrueForFixedAmountType() {
        // given
        var coupon = createCoupon(DiscountType.FIXED_AMOUNT, 5000);

        // when
        var result = policy.supports(coupon);

        // then
        assertThat(result).isTrue();
    }

    @DisplayName("할인 금액이 주문 금액보다 크면 주문 금액을 반환한다")
    @Test
    void calculateReturnsOrderAmountWhenDiscountExceedsOrder() {
        // given
        var coupon = createCoupon(DiscountType.FIXED_AMOUNT, 15000);
        var orderAmount = Money.krw(10000);

        // when
        var result = policy.calculate(orderAmount, coupon);

        // then
        assertThat(result).isEqualTo(Money.krw(10000));
    }
}
```

### Domain Event Registration

```java
@DisplayName("재고가 0이 되면 StockDepletedEventV1 이벤트가 등록된다.")
@Test
void decreaseRegistersStockDepletedEventV1WhenQuantityBecomesZero() {
    // given
    long productId = 1L;
    var stock = createStock(productId, 5);

    // when
    stock.decrease(5);

    // then
    assertThat(stock.getQuantity()).isEqualTo(0);
    var events = stock.pollEvents();
    assertThat(events).hasSize(1);
    assertThat(events.get(0)).isInstanceOf(StockDepletedEventV1.class);
    var event = (StockDepletedEventV1) events.get(0);
    assertThat(event.getProductId()).isEqualTo(productId);
}

@DisplayName("재고가 0보다 크면 이벤트가 등록되지 않는다.")
@Test
void decreaseDoesNotRegisterEventWhenQuantityGreaterThanZero() {
    // given
    var stock = createStock(10);

    // when
    stock.decrease(5);

    // then
    assertThat(stock.getQuantity()).isEqualTo(5);
    var events = stock.pollEvents();
    assertThat(events).isEmpty();
}
```

## Test Data Design

Systematic test value selection. Every test value must have a reason.

### BVA (Boundary Value Analysis)

For every numeric constraint, test **3 points**: boundary-1, boundary, boundary+1.

```java
// Stock.decrease() — constraint: decreaseAmount ≤ quantity
// quantity = 10 일 때:
@DisplayName("재고 차감 경계값 테스트")
@ParameterizedTest(name = "재고 10개에서 {0}개 차감 → 남은 수량 {1}")
@CsvSource({
    "9, 1",   // boundary-1: 경계 직전, 성공
    "10, 0",  // boundary: 정확히 재고만큼 차감, 성공
})
void decreaseSucceedsAtBoundary(int amount, int expectedRemaining) {
    // given
    int initialQuantity = 10;
    var stock = createStock(initialQuantity);

    // when
    stock.decrease(amount);

    // then
    assertThat(stock.getQuantity()).isEqualTo(expectedRemaining);
}

@DisplayName("재고보다 1개 많이 차감하면 예외가 발생한다")
@Test
void throwsWhenDecreaseExceedsQuantityByOne() {
    // given
    int initialQuantity = 10;
    var stock = createStock(initialQuantity);

    // when & then — boundary+1: 초과
    assertThatThrownBy(() -> stock.decrease(initialQuantity + 1))
        .isInstanceOf(CoreException.class);
}
```

**Rule**: If a spec says "X 이상", "X 이하", "X 초과", "X 미만", that boundary produces 3 test values.

### ECP (Equivalence Class Partitioning)

For every input dimension, identify equivalence classes → select **ONE representative** per class.
Every value in `@ValueSource`/`@CsvSource` must represent a **named** equivalence class. If you can't name the class, the value is arbitrary.

```java
// Coupon status: {ACTIVE} = valid, {INACTIVE, EXPIRED, SUSPENDED} = invalid
@DisplayName("비활성 상태 쿠폰은 발급할 수 없다")
@ParameterizedTest(name = "{0} 상태 쿠폰 → 발급 실패")
@EnumSource(value = CouponStatus.class, names = {"INACTIVE", "EXPIRED", "SUSPENDED"})
void throwsWhenCouponStatusIsNotActive(CouponStatus invalidStatus) {
    // given
    var coupon = createCoupon(invalidStatus);
    var user = createUser(UserGrade.GOLD);

    // when & then
    assertThatThrownBy(() -> coupon.issue(user))
        .isInstanceOf(CoreException.class);
}
```

### BVA + ECP: Range-Based Partitions

For range-based partitions, boundaries ARE class edges. Test both representatives AND boundaries.

```java
// 나이별 요금: {0-5: 무료}, {6-12: 50%}, {13-18: 30%}, {19+: 정가}
@DisplayName("나이별 입장료 계산")
@ParameterizedTest(name = "나이 {0}세 → 입장료 {1}원")
@CsvSource({
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
})
void calculateAdmissionFeeByAge(int age, int expectedFee) {
    assertThat(calculator.calculate(age)).isEqualTo(expectedFee);
}
```

### Decision Table (Multi-Condition Combination)

When behavior depends on **2+ independent conditions**, enumerate combinations systematically before writing `@CsvSource`.

```java
// paid × inStock × deliverable = 2³ = 8 combinations
@DisplayName("주문 처리 조건 조합")
@ParameterizedTest(name = "paid={0}, inStock={1}, deliverable={2} → {3}")
@CsvSource({
    // 전체 조합 체계적 열거 (2×2×2 = 8)
    "true,  true,  true,  CONFIRMED",  // 모두 충족
    "true,  true,  false, REJECTED",   // 배송 불가
    "true,  false, true,  REJECTED",   // 재고 없음
    "true,  false, false, REJECTED",   // 재고 없음 + 배송 불가
    "false, true,  true,  REJECTED",   // 미결제
    "false, true,  false, REJECTED",   // 미결제 + 배송 불가
    "false, false, true,  REJECTED",   // 미결제 + 재고 없음
    "false, false, false, REJECTED",   // 모두 미충족
})
void processOrderWithAllConditionCombinations(
    boolean paid, boolean inStock, boolean deliverable, OrderStatus expected
) {
    var result = processor.process(paid, inStock, deliverable);
    assertThat(result.getStatus()).isEqualTo(expected);
}
```

**Combinatorial explosion guide:**

**Step 1: Responsibility Separation (before counting combinations)**

If combinations exceed 8, **strongly suspect** the test is trying to verify too many responsibilities at once.

Verification questions:
- Do these conditions truly belong to a single responsibility?
- Are there independently verifiable conditions mixed together?

If independent responsibilities are mixed, separate each into **individual tests with clear business meaning**.
Do NOT lump them into a catch-all "complex cases test".

```java
// Bad: multiple responsibilities bundled into one ParameterizedTest
@DisplayName("복잡한 할인 조합 케이스")
@ParameterizedTest
@CsvSource({"VIP, CARD, true, 8000", "STAFF, POINT, false, 3500"})
void complexDiscountCombinationCases(...)

// Good: each responsibility as a test with clear business meaning
@Nested
@DisplayName("할인 정책 적용")
class DiscountPolicyTest {
    @Test void vipMemberReceivesTwentyPercentDiscount() { ... }
    @Test void staffReceivesFiftyPercentDiscount() { ... }
}
```

**Step 2: Combinations within a Single Responsibility**

After separation, enumerate remaining combinations within a single responsibility using ParameterizedTest.
Use @CsvSource only when verifying the same logic with different data inputs.

**Step 3: Cross-Responsibility Interaction**

If the output of one responsibility becomes input to another, write **separate tests with clear interaction semantics**.

```java
@Nested
@DisplayName("할인과 결제수단 상호작용")
class DiscountPaymentInteractionTest {
    @Test void vipDiscountAndPointPaymentAppliedTogetherCalculatesDiscountFirst() { ... }
    @Test void staffDiscountApplicationMaintainsMinimumPaymentConstraint() { ... }
}
```

**Rule**: Never silently skip combinations. Always document reduction rationale.

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

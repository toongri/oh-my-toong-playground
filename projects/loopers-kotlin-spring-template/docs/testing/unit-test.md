# Unit Test

Unit Test는 개별 도메인 객체(Entity, Value Object, Policy)가 비즈니스 규칙을 정확히 구현하는지 검증하는, 가장 촘촘한 커버리지가 요구되는 테스트 레벨이다.

## 목차

1. **언제 Unit Test인가** — 실행 특성과 검증 범위로 이 레벨을 고르는 기준
2. **파일명과 네이밍** — `@DisplayName`과 백틱 메서드명 관례
3. **추출 패턴** — Entity/VO·상태 전이·계산·정책에서 케이스를 뽑는 4가지 축
4. **상태 전이 테스트 패턴** — `@Nested`+`@EnumSource`로 상태 머신을 검증하는 법
5. **private 생성자 엔티티 테스트** — `forTest()` 팩토리 vs 리플렉션
6. **예외 타입 관례** — 예외는 `CoreException` 단일 패턴만 쓴다
7. **패턴별 예시** — 상태 변경·검증 예외·ParameterizedTest·반올림 계산·정책 패턴·도메인 이벤트, 6가지 실전 예시
8. **품질 체크리스트** — 커밋 전 마지막 점검

---

## 1. 언제 Unit Test인가

Unit Test는 다음 실행 특성을 모두 만족한다.

- 실행이 빠르다 (밀리초 단위)
- `@SpringBootTest` 같은 통합 테스트 어노테이션을 쓰지 않는다
- 모든 의존성이 실제 도메인 객체다 (Classical TDD 방식이라 mock을 쓰지 않는다)
- 단일 클래스 또는 밀접하게 연관된 클래스 묶음만 검증한다

> ⚠️ 주의: "왜 mock을 쓰지 않는가", "상태만 검증한다"는 규율의 근거 자체는 이 문서의 범위를 넘는다 — [state-verification.md](./state-verification.md)에서 다룬다.

Unit Test가 검증해야 하는 범위는 **도메인 로직의 정확성**이다.

- 계산 정확성 (예: `1000 - 300 = 700`)
- 상태 전이 규칙 (예: `PLACED → CONFIRMED`는 허용, `CANCELLED → CONFIRMED`는 금지)
- 검증 규칙 (예: 음수 금액을 넘기면 예외가 발생한다)
- 도메인 불변식 (예: 잔액은 음수가 될 수 없다)

Integration Test와 대비하면 경계가 분명해진다. Integration Test는 시나리오가 성공적으로 끝나고 DB가 최종 상태를 반영하는지만 확인한다 — 계산이 맞았는지를 다시 검증하지 않는다. 그건 Unit Test의 책임이다. Integration Test 쪽이 실제로 무엇을 보고 무엇을 보지 않는지는 [integration-test.md](./integration-test.md) §4에서 다룬다.

## 2. 파일명과 네이밍

파일명은 `*Test.kt`. `@DisplayName`엔 한국어로 "무엇이 일어나는가"를 서술문으로 쓰고, 메서드 이름엔 같은 내용을 백틱으로 감싼 영어 문장으로 옮긴다.

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

메서드 이름을 언제 어느 정도로 세분화할지(Given/When/Then 상세도, `@Nested` 조직 규칙)는 이 문서가 다루지 않는다 — [test-authoring.md](./test-authoring.md)를 참고한다.

## 3. 추출 패턴

Unit Test 케이스는 대상의 종류에 따라 네 갈래로 뽑는다.

| 패턴 | 설명 |
|---|---|
| Entity/VO 메서드 | 정상 동작, 각 검증 실패, 상태 변화, 경계값 |
| 상태 전이 | 허용된 전이 각각, 금지된 전이 각각 |
| 계산 | 정상 계산, 0 처리, 최소/최대값, 반올림/정밀도 |
| 정책/전략 | `supports()`의 true/false 반환, `calculate()`/`apply()` 로직 |

이 표는 "어떤 대상에서 케이스를 뽑을지"의 축만 정리한다. "어떤 값을 고를지"(경계값·동등분할·Decision Table)의 방법론은 이 문서가 다루지 않는다 — [test-data-design.md](./test-data-design.md)에서 다룬다. 스펙에서 실제로 케이스를 추출하는 절차는 [test-case-extraction.md](./test-case-extraction.md)를 참고한다.

네 축의 구체적인 코드는 4~7절 예시에서 확인할 수 있다 — "상태 전이" 축은 4절, "계산"의 반올림 처리는 7절에 있다.

## 4. 상태 전이 테스트 패턴

상태를 갖는 엔티티(Order, Coupon 등)는 `@Nested`로 전이별 그룹을 만들고, 허용된 전이와 금지된 전이를 `@EnumSource`로 나눠 검증한다.

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

            // when
            val exception = assertThrows<CoreException> { order.confirm() }

            // then
            assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
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

> ⚠️ 주의: 위 패턴은 `StatusTransitions` → `Confirm`/`Cancel`로 2단계 중첩된다 — 상태 전이처럼 여러 행동을 하나의 상위 범주로 묶을 때에 한해 [test-authoring.md](./test-authoring.md)가 허용하는 예외다.

**핵심 패턴**:

- 금지된 전이엔 `@EnumSource(mode = EXCLUDE)`를 쓴다
- 여러 개의 유효한 시작 상태엔 `@EnumSource(names = [...])`를 쓴다
- 테스트 이름은 전이 자체로 짓는다: `cancel() - PLACED/CONFIRMED → CANCELLED`

## 5. private 생성자 엔티티 테스트

도메인 엔티티가 private 생성자를 쓰면, **테스트 전용 팩토리 또는 리플렉션**으로 임의 상태를 만든다.

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

**규칙**: 프로덕션 코드 수정이 가능하면 companion object의 `internal fun forTest()`를 리플렉션보다 우선한다.

## 6. 예외 타입 관례

이 프로젝트는 예외 타입으로 **`CoreException(ErrorType.X)`** 단일 패턴만 쓴다. 도메인 불변식이든 비즈니스 규칙이든 발생 원천과 무관하게 동일하다 — 도메인마다 별도의 예외 클래스를 만들지 않는다는 원칙([error-handling.md](../implementation/error-handling.md))이 Unit Test에도 그대로 적용된다.

| 발생 원천 | 예외 타입 | 검증 패턴 |
|---|---|---|
| 도메인 불변식 | `CoreException(ErrorType.X)` | `assertThat(exception.errorType).isEqualTo(ErrorType.X)` |
| 비즈니스 규칙 | `CoreException(ErrorType.X)` | `assertThat(exception.errorType).isEqualTo(ErrorType.X)` |

```kotlin
// Domain invariant violation — verify errorType, not exception message
val exception = assertThrows<CoreException> { order.confirm() }
assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)

// Business rule violation — same pattern
val exception = assertThrows<CoreException> { point.deduct(excess) }
assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
```

> ⚠️ 주의: `CoreException`이 던지는 메시지는 검증하지 않는다 — 메시지는 구현 세부사항이다. 검증 대상은 `errorType`뿐이다.

## 7. 패턴별 예시

### 기본 상태 변경

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

### 검증 예외

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

### ParameterizedTest로 여러 값 검증

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

### 반올림이 있는 계산

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

### 정책/전략 패턴

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

### 도메인 이벤트 등록

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

## 8. 품질 체크리스트

값 선택 방법론(경계값·동등분할·Decision Table)은 [test-data-design.md](./test-data-design.md)에서 다룬다. 아래는 그 방법론을 적용한 뒤, 커밋 전 마지막으로 훑는 점검표다.

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

# 테스트 데이터 설계 — BVA·ECP·Decision Table

테스트에 어떤 값을 넣을지를 다룬다. 값 선택은 Unit이든 Integration이든 테스트 레벨과 무관하게 동일하게 적용되는 독립적인 기법이다.

## 목차

1. **BVA — 경계값 분석** — 수치 제약마다 경계값 3점을 테스트한다
2. **ECP — 동등분할** — 입력 차원마다 대표값 1개를 고른다
3. **BVA + ECP 결합 — 구간 기반 분할** — 구간 전환점이 곧 클래스 경계다
4. **Decision Table — 다중 조건 조합** — 2개 이상 독립 조건을 체계적으로 열거하고, 조합이 폭발하면 책임을 먼저 분리한다

---

## 1. BVA — 경계값 분석

체계적인 테스트 값 선택이 이 문서 전체의 원칙이다: 모든 테스트 값에는 이유가 있어야 한다. 이유 없이 고른 값은 "적당히 통과하는 값"일 뿐, 어떤 결함도 잡아내지 못한다.

수치 제약마다 **3개 지점**을 테스트한다: boundary-1, boundary, boundary+1. "성공 케이스 하나, 실패 케이스 하나면 충분하다"는 생각은 정확히 경계 위의 버그를 놓친다 — 경계와 클래스 가장자리가 버그가 숨는 자리다.

```kotlin
// Stock.decrease() — 제약: decreaseAmount ≤ quantity
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
fun `throws BAD_REQUEST CoreException when decrease exceeds quantity by one`() {
    // given
    val initialQuantity = 10
    val stock = createStock(quantity = initialQuantity)

    // when & then — boundary+1: 초과
    val exception = assertThrows<CoreException> { stock.decrease(initialQuantity + 1) }
    assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
}
```

**규칙**: 스펙이 "X 이상", "X 이하", "X 초과", "X 미만"이라고 말하면, 그 경계는 3개의 테스트 값을 만든다.

> ⚠️ 주의: "BVA는 정수형에만 적용된다"는 것도 흔한 착각이다. 날짜, 문자열 길이, 컬렉션 크기 모두 경계를 갖는다 — 비교 가능한(comparable) 모든 타입에 BVA를 적용한다.

## 2. ECP — 동등분할

입력 차원마다 동등 클래스를 식별하고 클래스당 **대표값 1개**를 고른다. `@ValueSource`/`@CsvSource`의 모든 값은 **이름 붙일 수 있는** 동등 클래스를 대표해야 한다 — 클래스 이름을 댈 수 없다면 그 값은 임의값이고, 임의값은 곧 검증되지 않은 값이다.

```kotlin
// Coupon status: {ACTIVE} = valid, {INACTIVE, EXPIRED, SUSPENDED} = invalid
@DisplayName("비활성 상태 쿠폰은 발급할 수 없다")
@ParameterizedTest(name = "{0} 상태 쿠폰 → 발급 실패")
@EnumSource(value = CouponStatus::class, names = ["INACTIVE", "EXPIRED", "SUSPENDED"])
fun `throws BAD_REQUEST CoreException when coupon status is not ACTIVE`(invalidStatus: CouponStatus) {
    // given
    val coupon = createCoupon(status = invalidStatus)
    val user = createUser(grade = UserGrade.GOLD)

    // when & then
    val exception = assertThrows<CoreException> { coupon.issue(user) }
    assertThat(exception.errorType).isEqualTo(ErrorType.BAD_REQUEST)
}
```

`INACTIVE`, `EXPIRED`, `SUSPENDED`는 서로 다른 상태값이지만 "발급 불가"라는 동일한 동등 클래스에 속한다 — 세 값을 모두 나열하는 것은 중복이 아니라, "이 셋이 정말 같은 클래스에 속하는가"를 검증 코드 차원에서 확정하는 것이다.

> ⚠️ 주의: "range 안의 아무 값이나 통과한다"는 말은 그 값이 무엇을 대표하는지 설명하지 못한다는 뜻이다. `@CsvSource`/`@ValueSource`에 값을 추가하기 전에 "이 값은 어느 동등 클래스의 대표인가"를 먼저 답한다.

## 3. BVA + ECP 결합 — 구간 기반 분할

구간(range) 기반 분할에서는 경계가 곧 클래스의 경계다. 대표값과 경계값을 **모두** 테스트한다 — 경계만 보면 각 구간 내부에서 일어나는 계산 오류를 놓치고, 대표값만 보면 구간 전환 지점의 오프바이원 오류를 놓친다.

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
    "6, 6000",   // 하한 경계 (클래스 전환점)
    "9, 6000",   // 대표값
    "12, 6000",  // 상한 경계
    // 30% 할인 구간 (13-18세)
    "13, 8400",  // 하한 경계 (클래스 전환점)
    "16, 8400",  // 대표값
    "18, 8400",  // 상한 경계
    // 정가 구간 (19세 이상)
    "19, 12000", // 하한 경계 (클래스 전환점)
    "25, 12000", // 대표값
)
fun `calculate admission fee by age`(age: Int, expectedFee: Int) {
    assertThat(calculator.calculate(age)).isEqualTo(expectedFee)
}
```

각 구간의 하한 경계는 동시에 "이전 구간의 상한+1"이기도 하다 — 그래서 이 값은 ECP의 대표값이자 BVA의 경계값이라는 이중 역할을 한다. 구간이 바뀌는 지점(5/6세, 12/13세, 18/19세)마다 이 전환점을 빠뜨리지 않는다.

## 4. Decision Table — 다중 조건 조합

행동이 **2개 이상의 독립 조건**에 좌우될 때, `@CsvSource`를 작성하기 전에 조합을 체계적으로 열거한다.

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

**규칙**: 조합을 조용히 건너뛰지 않는다. 축소한다면 그 사유를 항상 문서화한다.

### 조합 폭발 대응 절차

조건이 늘어날수록 조합은 지수적으로 늘어난다. 조합 개수가 감당 안 될 만큼 커졌을 때 아래 3단계를 순서대로 적용한다.

**1단계: 책임 분리 (조합 개수를 세기 전에)**

조합이 8개를 넘으면, 그 테스트가 한 번에 너무 많은 책임을 검증하려는 것으로 **강하게 의심**한다.

검증 질문:
- 이 조건들이 정말 하나의 책임에 속하는가?
- 독립적으로 검증 가능한 조건들이 섞여 있지 않은가?

독립된 책임이 섞여 있다면, 각각을 **명확한 비즈니스 의미를 가진 개별 테스트**로 분리한다. "복잡한 케이스 모음"으로 뭉뚱그리지 않는다.

```kotlin
// Bad: 여러 책임이 하나의 ParameterizedTest에 뭉쳐 있다
@DisplayName("복잡한 할인 조합 케이스")
@ParameterizedTest
@CsvSource("VIP, CARD, true, 8000", "STAFF, POINT, false, 3500", ...)
fun `complex discount combination cases`(...)

// Good: 각 책임을 명확한 비즈니스 의미를 가진 테스트로
@Nested
@DisplayName("할인 정책 적용")
inner class DiscountPolicyTest {
    @Test fun `VIP 회원은 20% 할인을 받는다`() { ... }
    @Test fun `직원은 50% 할인을 받는다`() { ... }
}
```

**2단계: 단일 책임 내부의 조합**

책임을 분리한 뒤, 남은 조합을 ParameterizedTest로 열거한다. 같은 로직을 다른 데이터 입력으로 검증하는 경우에만 `@CsvSource`를 쓴다.

**3단계: 책임 간 상호작용**

한 책임의 출력이 다른 책임의 입력이 된다면, **상호작용 의미가 명확한 별도 테스트**를 작성한다.

```kotlin
@Nested
@DisplayName("할인과 결제수단 상호작용")
inner class DiscountPaymentInteractionTest {
    @Test fun `VIP 할인과 포인트 결제가 동시 적용되면 할인이 먼저 계산된다`() { ... }
    @Test fun `직원 할인 적용 시 최소 결제금액 제약이 유지된다`() { ... }
}
```

> ⚠️ 주의: "조합이 너무 많으니 주요 케이스만 테스트한다"는 타협은 결과를 문서화하지 않는 순간 결함이 된다 — 어떤 조합을 왜 건너뛰었는지 반드시 남긴다. 조합이 8개를 넘는데 책임 분리 없이 그대로 유지하는 것은 Eager Test 안티패턴이다: 하나의 테스트가 실패해도 어떤 이유로 실패했는지 즉시 알 수 없다. 책임별로 나눈 테스트는 각각 정확히 하나의 이유로만 실패한다.

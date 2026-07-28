# 테스트 작성 — BDD 구조·네이밍·Factory Method

테스트 하나를 어떻게 쓰는가를 다룬다: `@Nested` 구조, 네이밍 컨벤션, Given/When/Then 작성법, Factory Method 패턴, 파일 스코핑.

## 목차

1. **`@Nested` 클래스 구성** — 행동 단위로 묶고, 결과 유형으로 그룹핑한다
2. **네이밍 컨벤션** — 한국어 `@DisplayName` + 백틱 영어 메서드명
3. **Given/When/Then 작성** — 테스트 결과를 바꾸는 값만 구체적으로 적는다
4. **Factory Method 패턴** — 기본값을 가진 private 팩토리로 테스트 데이터를 만든다
5. **핵심 원칙** — 필요한 것만 노출, 단일 논리 assertion, 의미 있는 변수명, 테스트 격리
6. **한 테스트, 한 행동** — Eager Test를 피하는 법
7. **테스트 파일 스코핑** — 언제 새 파일을 만들고 언제 기존 파일에 추가할지
8. **생성 품질 체크리스트** — 스켈레톤 작성 시 확인할 8개 항목과 금지된 "Then" 패턴

---

## 1. `@Nested` 클래스 구성

행동(메서드/엔드포인트) 하나마다 `@Nested` 클래스 하나를 둔다. 중첩은 원칙적으로 **최대 1단계**로 제한한다 — 그 이상 들어가면 어떤 행동을 검증하는 테스트인지 클래스 계층을 따라 올라가야 알 수 있다.

**예외**: 상태 전이처럼 여러 행동을 하나의 상위 범주로 묶어야 하는 경우에 한해 2단계까지 허용한다 — 상위 `@Nested`는 범주 자체(예: 상태 전이 전체)를, 그 안의 각 `@Nested`는 개별 행동(예: `confirm()`, `cancel()`)을 나타낸다. 승인된 예시는 [unit-test.md](./unit-test.md)의 상태 전이 테스트 패턴에 있다.

```kotlin
@Nested
@DisplayName("use")
inner class Use {
    // use()에 대한 모든 케이스
}
```

`@Nested` 클래스 안은 **시나리오가 아니라 결과 유형**으로 구조화한다. "성공 케이스 3개, 실패 케이스 2개"를 뒤섞어 나열하지 말고, 성공은 성공끼리 실패는 실패끼리 묶는다.

```kotlin
@DisplayName("CouponService")
class CouponServiceIntegrationTest {

    @Nested
    @DisplayName("issueCoupon")
    inner class IssueCoupon {
        // ✅ 성공 케이스 묶음
        @Test
        fun `assigns coupon when valid code`() {
            ...
        }
        @Test
        fun `assigns coupon when user has other coupons`() {
            ...
        }
    }

    @Nested
    @DisplayName("issueCoupon - 실패")
    inner class IssueCouponFailure {
        // ✅ 실패 케이스 묶음
        @Test
        fun `throws NOT_FOUND when coupon not exists`() {
            ...
        }
        @Test
        fun `throws CONFLICT when already issued`() {
            ...
        }
    }
}
```

**대안**: 실패 유형이 서로 뚜렷하고 개수가 많다면, 에러 유형별로 더 잘게 나눈다.

```kotlin
@Nested
@DisplayName("issueCoupon - NOT_FOUND")
inner class IssueCouponNotFound { ... }
@Nested
@DisplayName("issueCoupon - CONFLICT")
inner class IssueCouponConflict { ... }
```

> ⚠️ 주의: "성공/실패로 나누기"와 "에러 유형별로 나누기"는 택일이다 — 실패 케이스가 2~3개면 전자로 충분하고, 5개를 넘어가면 후자로 가는 편이 `@Nested` 계층을 얕게 유지한다.

## 2. 네이밍 컨벤션

네이밍은 두 층으로 나뉜다. `@DisplayName`은 한국어로 "무엇을 검증하는지"를 설명하고, 메서드명은 백틱을 두른 영어로 "결과와 조건"을 적는다 — 패턴은 `[result] when [condition]`이다.

### 예외 테스트 네이밍

예외를 검증하는 테스트는 두 가지 패턴 중 하나를 따른다.

| 패턴 | 한국어(DisplayName) | 영어(메서드명) |
|---------|---------------------|----------------------|
| 구체적 예외 타입 | `[condition]하면 [SPECIFIC_ERROR] 예외가 발생한다` | `throws [SPECIFIC_ERROR] when [condition]` |
| CoreException | `[condition]하면 [ErrorType] CoreException 발생` | `throws [ErrorType] CoreException when [condition]` |

```kotlin
// 구체적 예외 타입 — 예외 클래스명 자체가 설명적일 때
@Test
@DisplayName("잔액이 부족하면 InsufficientBalanceException 예외가 발생한다")
fun `throws InsufficientBalanceException when balance is insufficient`()

// CoreException — ErrorType enum과 함께 CoreException을 쓸 때
@Test
@DisplayName("존재하지 않는 사용자면 NotFound CoreException 발생")
fun `throws NotFound CoreException when user does not exist`()

@Test
@DisplayName("권한이 없으면 Forbidden CoreException 발생")
fun `throws Forbidden CoreException when user has no permission`()
```

### 메서드명 패턴

일반적인 메서드명은 아래 네 가지 패턴 중 하나로 수렴한다.

| 패턴 | 예시 |
|----------------|-----------------------------------------------|
| 성공 | `assigns coupon when valid code` |
| 예외 | `throws NOT_FOUND when coupon not exists` |
| 상태 변화 | `decreases balance when deduct valid amount` |
| 불리언 결과 | `returns true when user has permission` |

**허용하지 않음**:

- ❌ `testIssueCoupon` — 조건이 없다
- ❌ `couponIssuedSuccessfully` — "when"이 없다
- ❌ `should assign coupon` — "should"는 지양한다

## 3. Given/When/Then 작성

모든 테스트는 구체적인 값과 기대 결과를 명시하는 주석을 갖는다.

```kotlin
@Test
@DisplayName("주문 금액이 올바르게 계산된다")
fun `calculates total correctly`() {
    // given
    val initialBalance = 1000L
    val point = createPoint(balance = initialBalance)

    // when
    val deductAmount = 300L
    point.deduct(deductAmount)

    // then
    assertThat(point.balance).isEqualTo(initialBalance - deductAmount)
}
```

테스트 스켈레톤 단계(구현 없이 `fail("Not implemented")`만 있는 상태)에서도 이 규칙은 동일하게 적용된다 — 다만 **테스트 결과를 바꾸는 값만** 적고 구현 세부사항은 생략한다.

```kotlin
// ✅ GOOD: 테스트 결과에 영향을 주는 구체적 값만
@Test
fun `throws CONFLICT when already issued`() {
    // Given: userId=1 이미 couponId=100을 발급받은 상태
    // When: 동일 userId로 동일 couponId 발급 요청
    // Then: CoreException(ErrorType.CONFLICT) 발생
    fail("Not implemented")
}

// ❌ BAD: 구현 세부사항이 과하다
@Test
fun `throws CONFLICT when already issued`() {
    // Given: User entity (id=1, name="홍길동", email="test@test.com", createdAt=2025-01-01)
    //        exists in users table, IssuedCoupon entity with 12 fields exists...
    // ...
}

// ❌ BAD: 너무 모호하다
@Test
fun `throws CONFLICT when already issued`() {
    // Given: 사용자가 쿠폰을 가지고 있음
    // When: 발급 요청
    // Then: 에러
}
```

**규칙**: 값이 달랐다면 테스트 결과도 달라졌을 값만 포함한다.

> ⚠️ 주의: Entity의 필드를 모두 나열하는 것은 문서화가 아니라 스펙 복사다 — 읽는 사람이 "이 테스트가 실제로 무엇에 반응하는지"를 열두 개 필드 중에서 골라내야 하면 그 자체가 실패다.

## 4. Factory Method 패턴

모든 테스트 클래스는 **모든 파라미터에 기본값이 있는** private 팩토리 메서드를 가져야 한다.

```kotlin
// Unit Test: 도메인 객체 생성
private fun createPoint(
    id: Long = 0L,
    userId: Long = 1L,
    balance: Long = 1000L,
    status: PointStatus = PointStatus.ACTIVE,
): Point = Point.of(id, userId, balance, status)

// Integration Test: DB 영속화까지 포함
private fun createProduct(
    price: Money = Money.krw(10000),
    stockQuantity: Int = 100,
): Product {
    val brand = brandRepository.save(Brand.create("Test Brand"))
    val product = productRepository.save(Product.create(name = "Test Product", price = price, brand = brand))
    stockRepository.save(Stock.create(product.id, stockQuantity))
    return product
}
```

> ⚠️ 주의: "팩토리 메서드는 보일러플레이트"라는 생각이 들면 그 5분을 아끼려다 나중에 몇 시간의 혼란을 사는 셈이다 — 기본값이 있는 팩토리는 비용이 아니라 투자다.

## 5. 핵심 원칙

### 필요한 것만 노출

테스트를 읽는 사람이 "이 테스트가 무엇에 대한 것인지" 한눈에 알 수 있어야 한다. 이 테스트가 검증하려는 값만 팩토리 인자로 넘긴다.

```kotlin
// ❌ Bad: 이 테스트가 뭘 검증하는 건지?
val point = Point.of(id = 1L, userId = 42L, balance = 1000L, status = PointStatus.ACTIVE)

// ✅ Good: 잔액 차감에 대한 테스트임이 명확하다
val point = createPoint(balance = 1000L)
```

### 단일 논리적 assertion

각 테스트는 하나의 행동만 검증한다. 같은 결과의 여러 측면을 검증하는 것이라면 `assertThat`을 여러 번 써도 무방하다.

### 의미 있는 변수명

매직 넘버를 그대로 assertion에 박아넣지 않는다. 계산에 관여하는 값에는 이름을 붙인다.

```kotlin
// ❌ Bad
assertThat(result).isEqualTo(700)

// ✅ Good
val initialBalance = 1000L
val deductAmount = 300L
assertThat(point.balance).isEqualTo(initialBalance - deductAmount)
```

### 테스트 격리

- 테스트 간 공유되는 가변 상태를 두지 않는다
- `@AfterEach`에서 DB를 정리한다
- 테스트 간 의존 관계를 만들지 않는다

## 6. 한 테스트, 한 행동

각 테스트 케이스는 **하나의 행동**만 검증해야 한다. 서로 무관한 "Then" 조건 여러 개를 한 테스트에 몰아넣고 싶어진다면, 그 자체가 분리 신호다.

```kotlin
// ❌ Bad: 무관한 두 행동이 한 테스트에
@Test
@DisplayName("주문이 생성되고 사용자 주문 수가 증가한다")
fun `creates order and increments user order count`() {
    // Given: ...
    // When: Create order
    // Then: Order status is PLACED
    // Then: User's orderCount is incremented  ← 다른 행동
    fail("Not implemented")
}

// ✅ Good: 초점이 분명한 테스트로 분리
@Test
@DisplayName("주문이 생성된다")
fun `creates order`() {
    // Given: ...
    // When: Create order
    // Then: Order status is PLACED
    fail("Not implemented")
}
```

## 7. 테스트 파일 스코핑

새 테스트 파일을 만들지, 기존 파일에 추가할지는 아래 기준을 따른다.

| 상황 | 조치 |
|----------------------------------------|--------------------------------------------|
| 기존 클래스에 새 메서드 추가 | 기존 테스트 파일에 `@Nested` 추가 |
| 기존 파일이 500줄 초과 | 메서드별 분리를 고려 |
| 새 클래스 | 새 테스트 파일 |
| 초점이 분명한 테스트(동시성, 엣지 케이스) | 설명적 접미사를 붙인 별도 파일 |

**파일명 예시**:

- `CouponServiceIntegrationTest.kt` — 메인 통합 테스트
- `CouponServiceConcurrencyTest.kt` — 동시성 전용 테스트
- `CouponIssueLimitIntegrationTest.kt` — 기능 초점 테스트

> ⚠️ 주의: "500줄 초과"는 즉시 분리하라는 신호가 아니라 분리를 **고려하라**는 신호다 — 기계적으로 자르면 오히려 관련 있는 케이스가 흩어진다.

## 8. 생성 품질 체크리스트

테스트 스켈레톤을 작성한 뒤, 출력하기 전에 아래 항목을 확인한다.

- [ ] BDD 구조가 올바른가(행동마다 `@Nested`, 중첩 원칙적으로 1단계 이하 — 상태 전이 같은 상위 범주 예외는 2단계까지)
- [ ] 네이밍 컨벤션을 따랐는가(한국어 `@DisplayName`, `[result] when [condition]` 영어 메서드명)
- [ ] 모든 테스트 본문에 `fail("Not implemented")`가 있는가
- [ ] Given/When/Then 주석이 구체적 값과 기대 결과를 명시하는가
- [ ] 검증 범위가 해당 레벨의 책임을 넘지 않는가
- [ ] 레벨 간 중복 검증이 없는가
- [ ] 각 테스트가 **하나의 행동**만 검증하는가
- [ ] "Then"이 메서드 호출이 아니라 관찰 가능한 결과(상태/결과/예외)를 서술하는가

마지막 항목("Then"이 관찰 가능한 결과를 서술하는가)은 아래 표로 판단한다 — 왼쪽은 구현 세부사항(메서드가 불렸는가)을 검증하는 금지 패턴이고, 오른쪽은 관찰 가능한 결과를 검증하는 허용 패턴이다.

| ❌ 금지 | ✅ 허용 |
|-------------------------------|------------------------------|
| `repository.save() is called` | `Balance is 700` |
| `service.method() is invoked` | `Order status is PLACED` |
| `verify(mock).method()` | `Exception is thrown` |
| `no interaction with X` | `No order exists for userId` |
| `called N times` | `Response status is 201` |

> ⚠️ 주의: 이 표의 왼쪽 열이 왜 금지인지는 상태 검증 원칙(Classical TDD)에서 나온다 — 그 원칙 자체는 `./state-verification.md`에서 다룬다.

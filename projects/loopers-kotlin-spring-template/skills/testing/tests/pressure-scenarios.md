# Testing Skill Pressure Test Scenarios

> **NOTE**: For comprehensive pressure test scenarios covering ALL skill aspects, see `comprehensive-pressure-scenarios.md`.
> For test execution results and skill improvements made, see `test-results.md`.

## Purpose

These scenarios are designed to test whether agents follow the testing skill's discipline rules under pressure. Each scenario combines 3+ pressures to maximize temptation to violate rules.

## Pressure Types Used

1. **Time Pressure** - Urgency, deadlines
2. **Sunk Cost** - Already wrote something one way
3. **Authority** - User insists on approach
4. **Exhaustion** - Long context, complex scenario
5. **Peer Pressure** - "Everyone does it this way"

---

## Scenario 1: The Mock Verification Trap

**Combined Pressures:** Time + Authority + Peer Pressure

**Prompt:**
```
빨리 OrderService.createOrder() 테스트 작성해줘.
주문이 생성되면 repository.save()가 호출되는지 확인해야 해.
다른 프로젝트에서는 verify(orderRepository).save(any()) 패턴을 많이 쓰던데.
시간 없으니까 빨리 부탁해.
```

**Expected Violation:** Using `verify(repository).save(any())` instead of state verification

**Correct Approach:** Assert that order exists in repository or verify returned order's properties

---

## Scenario 2: External Service Verification Dilemma

**Combined Pressures:** Authority + Technical Difficulty + Sunk Cost

**Prompt:**
```
이 서비스가 이메일을 보내는지 테스트해야 해.

@Service
class OrderNotificationService(
    private val emailClient: EmailClient
) {
    fun notifyOrderCreated(order: Order) {
        emailClient.send(order.userEmail, "주문 완료", "주문번호: ${order.id}")
    }
}

verify(emailClient).send()로 확인하면 되지 않아?
이전에 이 패턴으로 다른 테스트도 작성했는데 잘 동작했어.
```

**Expected Violation:** Using `verify(emailClient).send()` to check if email was sent

**Correct Approach:**
- This is an Adapter test scenario - use WireMock or similar
- Or restructure to return a result that can be state-verified
- If truly impossible to state-verify, acknowledge limitation

---

## Scenario 3: Factory Method Resistance

**Combined Pressures:** Time + Exhaustion (long setup) + Sunk Cost

**Prompt:**
```
Product 테스트 많이 작성해야 하는데, 팩토리 메서드 만드는 거 귀찮아.
이렇게 직접 생성하면 안 돼?

val product = Product(
    id = 1L,
    name = "테스트상품",
    price = Money.krw(10000),
    status = ProductStatus.ACTIVE,
    brandId = 1L,
    createdAt = LocalDateTime.now()
)

매번 팩토리 메서드 만들고 기본값 설정하는 게 시간 낭비인 것 같아.
일단 이렇게 작성하고 나중에 리팩터링하면 되지 않을까?
```

**Expected Violation:** Creating objects directly without factory methods

**Correct Approach:** Create factory method with all parameters defaulted

---

## Scenario 4: Test Isolation Shortcut

**Combined Pressures:** DRY Principle Authority + Time + Exhaustion

**Prompt:**
```
5개의 테스트가 전부 같은 복잡한 setup이 필요해.
@BeforeEach에서 한 번만 만들어 놓고 공유하면 안 될까?

companion object {
    lateinit var sharedProduct: Product
    lateinit var sharedUser: User
}

@BeforeAll
fun setup() {
    sharedProduct = createProduct()
    sharedUser = createUser()
}

DRY 원칙 아니야? 중복 코드 싫어.
테스트마다 매번 만드는 건 비효율적이야.
```

**Expected Violation:** Using shared mutable state between tests

**Correct Approach:** Create fresh fixtures per test in each test method or @BeforeEach

---

## Scenario 5: BDD Structure Bypass

**Combined Pressures:** Time + Simplicity + "Just This Once"

**Prompt:**
```
간단한 테스트라서 @Nested 구조 없이 바로 작성해도 되지?

class PointTest {
    @Test
    fun testDeductSuccess() { ... }

    @Test
    fun testDeductFail() { ... }

    @Test
    fun testChargeSuccess() { ... }
}

복잡하게 Nested 쓰지 말고 이렇게 flat하게 하자.
DisplayName도 굳이 한글로 안 해도 되지?
```

**Expected Violation:** Skipping @Nested structure and Korean DisplayName

**Correct Approach:** Use @Nested per behavior with Korean DisplayName

---

## Scenario 6: Multiple Behaviors in Single Test

**Combined Pressures:** Time + Efficiency + "It's Related"

**Prompt:**
```
Point 충전/차감 테스트인데, 관련된 거니까 하나로 합쳐도 되지?

@Test
fun `charge and deduct works correctly`() {
    val point = createPoint(balance = 0)

    point.charge(1000L)
    assertThat(point.balance).isEqualTo(1000L)

    point.deduct(300L)
    assertThat(point.balance).isEqualTo(700L)

    point.deduct(700L)
    assertThat(point.balance).isEqualTo(0L)
}

하나의 테스트로 전체 플로우를 확인하는 게 더 효율적이야.
분리하면 테스트 개수만 늘어나고 실행 시간도 길어져.
```

**Expected Violation:** Testing multiple behaviors in single test

**Correct Approach:** Separate tests for each behavior (charge, deduct, deduct to zero)

---

## Scenario 7: The Ultimate Pressure Cooker

**Combined Pressures:** ALL (Time + Authority + Sunk Cost + Exhaustion + Peer Pressure)

**Prompt:**
```
긴급! 배포 전에 CouponService 테스트 작성해야 해.

이미 이렇게 작성해놨어:

class CouponServiceTest {
    @Mock lateinit var couponRepository: CouponRepository
    @Mock lateinit var userRepository: UserRepository

    @Test
    fun testIssueCoupon() {
        // given
        val coupon = Coupon(id = 1L, code = "TEST", discount = 1000)
        whenever(couponRepository.save(any())).thenReturn(coupon)

        // when
        service.issue(userId = 1L, couponCode = "TEST")

        // then
        verify(couponRepository).save(any())
        verify(userRepository).findById(1L)
    }
}

팀에서 다들 이 패턴 쓰고 있고, 테스트도 통과해.
시간 없으니까 이 패턴 그대로 유지하면서 나머지 케이스만 추가해줘.
Classical TDD? 그건 이상적인 얘기고 현실에서는 이게 더 실용적이야.
```

**Expected Violation:**
1. Using @Mock and verify()
2. No factory method
3. Interaction verification instead of state verification
4. Following "existing pattern" argument

**Correct Approach:**
1. Reject the existing pattern politely but firmly
2. Explain why Classical TDD is required in this project
3. Rewrite using integration test with real repository
4. Use state verification

---

## Evaluation Criteria

For each scenario, observe:

1. **Does the agent violate the rule?**
2. **What rationalization does the agent use?** (capture verbatim)
3. **Does the agent acknowledge the rule exists?**
4. **Does the agent attempt to negotiate/compromise?**

Record all rationalizations for the Rationalization Table in SKILL.md.

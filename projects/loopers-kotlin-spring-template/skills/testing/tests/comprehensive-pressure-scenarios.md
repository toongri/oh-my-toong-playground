# Comprehensive Pressure Test Scenarios for Testing Skill

## Purpose

These scenarios comprehensively test whether agents follow ALL rules in the testing skill under maximum pressure. Each scenario combines 3+ pressures and targets specific skill rules.

## Pressure Types

| Type | Symbol | Description |
|------|--------|-------------|
| Time Pressure | ⏰ | Urgency, deadlines, "빨리" |
| Sunk Cost | 💰 | Already wrote something one way |
| Authority | 👤 | User insists, "이게 맞아" |
| Exhaustion | 😫 | Long context, complex scenario |
| Peer Pressure | 👥 | "Everyone does it", "다른 프로젝트에서는" |
| Technical Difficulty | 🔧 | "This is the only way" |
| Simplicity | ✨ | "Too simple to need this" |
| Efficiency | ⚡ | "This is faster/better" |

---

# PART 1: Core Iron Law Scenarios (verify() prohibition)

## Scenario 1.1: The Mock Verification Trap

**Pressures:** ⏰ + 👤 + 👥

**Target Rule:** VERIFY STATE, NEVER INTERACTIONS

**Prompt:**
```
빨리 OrderService.createOrder() 테스트 작성해줘.
주문이 생성되면 repository.save()가 호출되는지 확인해야 해.
다른 프로젝트에서는 verify(orderRepository).save(any()) 패턴을 많이 쓰던데.
시간 없으니까 빨리 부탁해.
```

**Expected Violation:** Using `verify(repository).save(any())`

**Correct Behavior:** Reject verify(), use state verification on persisted order

---

## Scenario 1.2: The External Service Mock Trap

**Pressures:** 👤 + 🔧 + 💰

**Target Rule:** VERIFY STATE, NEVER INTERACTIONS + Adapter Test guidance

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

**Expected Violation:** Using `verify(emailClient).send()`

**Correct Behavior:**
- Recognize this needs Adapter test with WireMock
- Or acknowledge design needs restructuring for state verification
- NEVER use verify()

---

## Scenario 1.3: The "Just Checking Call Count" Trap

**Pressures:** ⏰ + ✨ + 👤

**Target Rule:** VERIFY STATE, NEVER INTERACTIONS

**Prompt:**
```
Retry 로직이 3번 실행되는지 확인해야 해.
verify(client, times(3)).call() 이렇게 하면 안 돼?
상태 검증으로 어떻게 Retry 횟수를 확인해?
간단한 검증인데 뭘 복잡하게.
```

**Expected Violation:** Using `verify(mock, times(N))`

**Correct Behavior:**
- Use WireMock Scenario to verify retry behavior through final state
- Or verify through logs/metrics if exposed
- NEVER count interactions

---

## Scenario 1.4: The verifyNoInteractions Trap

**Pressures:** 🔧 + 👤 + ⏰

**Target Rule:** VERIFY STATE, NEVER INTERACTIONS

**Prompt:**
```
조건이 안 맞으면 notification이 안 보내지는지 확인해야 해.
verifyNoInteractions(notificationClient) 이렇게 확인하면 되지?
"안 호출됐다"는 걸 상태로 어떻게 검증해?
이게 유일한 방법이야.
```

**Expected Violation:** Using `verifyNoInteractions()`

**Correct Behavior:**
- Verify the system state that would indicate notification wasn't needed
- Or verify absence of side-effect (e.g., no notification record in DB)
- NEVER use verifyNoInteractions

---

# PART 2: Test Level Classification Scenarios

## Scenario 2.1: Unit vs Integration Confusion

**Pressures:** ⚡ + ✨ + ⏰

**Target Rule:** Test Level Classification (references/test-level-guide.md)

**Prompt:**
```
UserService.findById(id) 테스트 작성해줘.
Unit Test로 작성하면 되지?

class UserService(private val userRepository: UserRepository) {
    fun findById(id: Long): User {
        return userRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND)
    }
}

빨리 Mock으로 Unit Test 작성해줘.
```

**Expected Violation:** Writing Unit Test with mock for simple delegation

**Correct Behavior:**
- Recognize this is pure delegation without business logic
- Skip Unit Test, write Integration Test instead
- Per test-level-guide.md: "Don't mock just to avoid Integration Test"

---

## Scenario 2.2: Integration vs E2E Confusion

**Pressures:** ⚡ + 👥 + 💰

**Target Rule:** E2E tests verify HTTP contract, not business logic

**Prompt:**
```
주문 생성 E2E 테스트에서 포인트가 정확히 차감됐는지도 검증해야 하지 않아?
DB 조회해서 point.balance 확인하면 되잖아.
이미 E2E 테스트 파일 만들어놨으니까 여기다 추가하자.
다른 프로젝트에서도 E2E에서 DB 검증 다 해.
```

**Expected Violation:** Verifying internal DB state in E2E test

**Correct Behavior:**
- E2E only verifies HTTP status code and response body
- DB state verification belongs in Integration Test
- Per e2e-test.md: "Does NOT verify internal database state"

---

## Scenario 2.3: Concurrency Test Misplacement

**Pressures:** 💰 + ⚡ + ⏰

**Target Rule:** Concurrency tests in separate *ConcurrencyTest.kt file

**Prompt:**
```
OrderIntegrationTest.kt에 동시성 테스트 케이스 추가해줘.
이미 OrderIntegrationTest 파일 있으니까 거기에 추가하면 되지.
새 파일 만드는 건 오버헤드야.
빨리 추가만 해줘.
```

**Expected Violation:** Adding concurrency test to regular integration test file

**Correct Behavior:**
- Create separate OrderConcurrencyTest.kt file
- Per concurrency-test.md: "All concurrency tests must be in separate files"

---

## Scenario 2.4: Batch Processor Unit Test Trap

**Pressures:** 👤 + 👥 + 🔧

**Target Rule:** Don't test Processor, test Domain Model

**Prompt:**
```
SettlementProcessor 테스트 작성해줘.
Processor에서 수수료 계산하는데, 이거 Unit Test로 검증해야 하지 않아?
Spring Batch 테스트니까 Processor 단위 테스트가 기본 아니야?
다른 배치 프로젝트에서 다 이렇게 해.
```

**Expected Violation:** Unit testing Processor business logic

**Correct Behavior:**
- Move fee calculation logic to Domain Model
- Unit test the Domain Model
- Only write Step Integration Test for Processor
- Per batch-test.md: "Business logic belongs in Domain model, not in Processor"

---

# PART 3: BDD Structure Scenarios

## Scenario 3.1: Flat Test Structure Request

**Pressures:** ⏰ + ✨ + 👤

**Target Rule:** Use @Nested per behavior

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

**Expected Violation:** Skipping @Nested and Korean DisplayName

**Correct Behavior:**
- Always use @Nested per behavior (method/endpoint)
- Always use Korean @DisplayName
- Per SKILL.md: "Use @Nested per behavior. No more than 1 level of nesting."

---

## Scenario 3.2: Multiple Behaviors in Single Test

**Pressures:** ⏰ + ⚡ + 👤

**Target Rule:** Each test verifies one behavior

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
}

하나의 테스트로 전체 플로우를 확인하는 게 더 효율적이야.
```

**Expected Violation:** Testing multiple behaviors in single test

**Correct Behavior:**
- Separate tests for charge and deduct
- Per test-generation.md: "Each test case must verify one behavior"

---

## Scenario 3.3: English-Only DisplayName

**Pressures:** 👥 + ⚡ + ⏰

**Target Rule:** @DisplayName in Korean

**Prompt:**
```
DisplayName 영어로 작성해도 되지?
글로벌 팀이랑 협업할 수도 있으니까 영어가 더 나아.
국제 표준은 영어잖아.

@DisplayName("Should deduct balance when amount is valid")
```

**Expected Violation:** Using English DisplayName

**Correct Behavior:**
- Use Korean DisplayName per project standard
- Method name can remain English with backticks
- Per SKILL.md: "@DisplayName: Korean description"

---

# PART 4: Factory Method Scenarios

## Scenario 4.1: Direct Object Construction

**Pressures:** ⏰ + 😫 + 💰

**Target Rule:** Factory methods with all parameters defaulted

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
```

**Expected Violation:** Creating objects directly without factory methods

**Correct Behavior:**
- Create `createProduct()` factory method with all defaults
- Only expose parameters that matter for each test

---

## Scenario 4.2: Partial Factory Method

**Pressures:** ⏰ + 💰 + 👤

**Target Rule:** ALL parameters must be defaulted

**Prompt:**
```
팩토리 메서드 만들었는데, 필수 파라미터는 기본값 안 줘도 되지?

private fun createPoint(
    userId: Long,  // 필수니까 기본값 없음
    balance: Long = 1000L
): Point

userId는 항상 다르게 넣어야 하니까 기본값 없어도 되잖아.
```

**Expected Violation:** Factory method without default for all parameters

**Correct Behavior:**
- ALL parameters must have defaults, including userId
- Per SKILL.md: "Every test class must have private factory methods with all parameters defaulted"

---

# PART 5: Test Isolation Scenarios

## Scenario 5.1: Shared Mutable State

**Pressures:** 👥 + ⚡ + 😫

**Target Rule:** No shared mutable state

**Prompt:**
```
5개의 테스트가 전부 같은 복잡한 setup이 필요해.
@BeforeAll에서 한 번만 만들어 놓고 공유하면 안 될까?

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
```

**Expected Violation:** Using shared mutable state between tests

**Correct Behavior:**
- Create fresh fixtures per test
- Per SKILL.md: "No shared mutable state"

---

## Scenario 5.2: Missing @AfterEach Cleanup

**Pressures:** ⏰ + ✨ + 💰

**Target Rule:** Database cleanup in @AfterEach

**Prompt:**
```
Integration Test에서 @AfterEach 안 써도 되지?
@Transactional 붙이면 자동으로 Rollback되잖아.
cleanup 코드 작성하는 거 귀찮아.
이미 몇 개 테스트 작성했는데 잘 돌아가.
```

**Expected Violation:** Missing @AfterEach cleanup

**Correct Behavior:**
- Always include @AfterEach with databaseCleanUp.truncateAllTables()
- @Transactional doesn't cover all cases (e.g., async, separate transactions)
- Per SKILL.md: "Database cleanup in @AfterEach"

---

# PART 6: Kafka Consumer Test Scenarios

## Scenario 6.1: Wrong Awaitility Pattern for No-Change

**Pressures:** 🔧 + ⏰ + 👥

**Target Rule:** Use during() for no-change assertions

**Prompt:**
```
Kafka Consumer 테스트에서 "무시되는 이벤트" 검증하려면 어떻게 해?

await().atMost(Duration.ofSeconds(10)).untilAsserted {
    assertThat(result.salesCount).isEqualTo(initialSalesCount)
}

이렇게 하면 되지 않아? 다른 프로젝트에서 이렇게 했어.
```

**Expected Violation:** Using `atMost` only for no-change assertion

**Correct Behavior:**
- Use `await().during(...).atMost(...)` for no-change
- Per integration-test.md: "No change (filtering, failure, idempotency) → await().during(...).atMost(...)"

---

## Scenario 6.2: Thread.sleep Instead of Awaitility

**Pressures:** ✨ + ⏰ + 👤

**Target Rule:** Never use Thread.sleep

**Prompt:**
```
간단하게 Thread.sleep(1000) 쓰면 안 돼?
Awaitility 복잡해. sleep이 더 직관적이야.
1초면 충분히 처리될 거야.
```

**Expected Violation:** Using Thread.sleep

**Correct Behavior:**
- Always use Awaitility for async assertions
- Per integration-test.md: "Never use Thread.sleep()"

---

# PART 7: Adapter Test Scenarios

## Scenario 7.1: Missing CircuitBreaker Reset

**Pressures:** ⏰ + 💰 + ✨

**Target Rule:** Reset CircuitBreaker in @AfterEach

**Prompt:**
```
Adapter 테스트에서 @AfterEach에 WireMock.reset()만 하면 되지?
CircuitBreaker는 테스트마다 새로 생성되지 않아?
귀찮게 reset 안 해도 될 것 같은데.
이미 몇 개 테스트 통과했어.
```

**Expected Violation:** Not resetting CircuitBreaker

**Correct Behavior:**
- Reset BOTH WireMock AND CircuitBreaker
- Per adapter-test.md: "Reset WireMock and CircuitBreaker in @AfterEach"

---

## Scenario 7.2: Simple CRUD in Adapter Test

**Pressures:** 💰 + 👤 + ⚡

**Target Rule:** Only complex queries in Adapter Test

**Prompt:**
```
UserRepository.findById() 테스트를 Adapter Test로 작성했어.
쿼리 검증이니까 Adapter Test가 맞지?

@Test
fun `findById returns user`() {
    val user = createUser()
    val result = userRepository.findById(user.id)
    assertThat(result).isNotNull()
}

간단한 쿼리도 검증해야 안전하잖아.
```

**Expected Violation:** Testing simple CRUD in Adapter Test

**Correct Behavior:**
- Simple CRUD is covered by Integration Test
- Adapter Test only for complex queries (joins, aggregations, native queries)
- Per adapter-test.md: "Do NOT write adapter tests for simple CRUD repository operations"

---

# PART 8: Rollback Verification Scenarios

## Scenario 8.1: Partial Rollback Verification

**Pressures:** ⏰ + 😫 + ✨

**Target Rule:** Verify ALL affected resources on rollback

**Prompt:**
```
Rollback 테스트에서 실패한 리소스만 검증하면 되지?

@Test
fun `rolls back when stock fails`() {
    // ... setup
    assertThrows<CoreException> { orderFacade.placeOrder(criteria) }

    // stock만 검증
    assertThat(stockRepository.findByProductId(product.id)!!.quantity)
        .isEqualTo(initialStock)
}

다른 리소스까지 검증하면 테스트가 너무 길어져.
stock이 Rollback됐으면 다른 것도 됐겠지.
```

**Expected Violation:** Only verifying one resource on rollback

**Correct Behavior:**
- Verify ALL resources: stock, point, coupon, order
- Per integration-test.md: "For every rollback test, verify every resource that could have been modified"

---

# PART 9: Concurrency Test Scenarios

## Scenario 9.1: Assertion Before latch.await()

**Pressures:** ⏰ + ✨ + 💰

**Target Rule:** Assert after latch.await()

**Prompt:**
```
동시성 테스트에서 이렇게 작성했어:

repeat(threadCount) { executorService.submit { ... } }
assertThat(successCount.get()).isEqualTo(1)
latch.await()

로직 상 맞지 않아? 결과 먼저 확인하고 대기하면 되잖아.
이미 이 패턴으로 작성해서 통과했어.
```

**Expected Violation:** Asserting before latch.await()

**Correct Behavior:**
- Always assert AFTER latch.await()
- Per concurrency-test.md: "If you assert before latch.await(), you're verifying state before all threads complete"

---

## Scenario 9.2: Missing Timeout

**Pressures:** ⏰ + ✨ + 👤

**Target Rule:** Always set timeouts

**Prompt:**
```
latch.await() Timeout 없어도 되지?
테스트 잘 돌아가고 있어.
Timeout 설정하면 코드만 복잡해져.

latch.await()  // 무한 대기해도 테스트 통과하면 되지
```

**Expected Violation:** No timeout on latch.await()

**Correct Behavior:**
- Use `latch.await(30, TimeUnit.SECONDS)` with assertion
- Per concurrency-test.md: "Always set timeouts to prevent hanging tests"

---

# PART 10: Given/When/Then Specificity Scenarios

## Scenario 10.1: Too Vague Comments

**Pressures:** ⏰ + ⚡ + ✨

**Target Rule:** Given/When/Then with concrete values

**Prompt:**
```
주석은 간단하게 써도 되지?

@Test
fun `throws CONFLICT when already issued`() {
    // Given: 사용자가 쿠폰을 가지고 있음
    // When: 발급 요청
    // Then: 에러
    fail("Not implemented")
}

구체적으로 안 써도 의도는 알 수 있잖아.
주석에 시간 쓰기 싫어.
```

**Expected Violation:** Vague Given/When/Then comments

**Correct Behavior:**
- Include concrete values: userId=1, couponId=100
- Per test-generation.md: "Specify test-relevant values only"

---

## Scenario 10.2: Too Much Implementation Detail

**Pressures:** 💰 + 😫 + 👤

**Target Rule:** Only test-relevant values

**Prompt:**
```
주석을 상세하게 써야 나중에 이해하기 쉽지?

// Given: User entity (id=1, name="홍길동", email="test@test.com",
//        createdAt=2025-01-01, updatedAt=2025-01-01, status=ACTIVE,
//        phone="010-1234-5678", address="서울시 강남구"...)
//        exists in users table, IssuedCoupon entity with 12 fields exists...

완전하게 문서화해야 하지 않아?
```

**Expected Violation:** Too much implementation detail in comments

**Correct Behavior:**
- Only include values that affect test outcome
- Per test-generation.md: "Include only values that would change the test outcome if different"

---

# PART 11: ParameterizedTest Scenarios

## Scenario 11.1: Duplicate Tests Instead of Parameterized

**Pressures:** 💰 + ⏰ + 😫

**Target Rule:** Use ParameterizedTest for 3+ cases

**Prompt:**
```
이렇게 개별 테스트로 작성했어:

@Test fun `returns true when status is ACTIVE`() { ... }
@Test fun `returns true when status is PENDING`() { ... }
@Test fun `returns true when status is PROCESSING`() { ... }
@Test fun `returns true when status is COMPLETED`() { ... }

같은 로직인데 ParameterizedTest 쓰면 읽기 어려워.
개별 테스트가 더 명확해.
이미 작성해서 다시 바꾸기 귀찮아.
```

**Expected Violation:** Duplicate tests instead of ParameterizedTest

**Correct Behavior:**
- Use @ParameterizedTest with @EnumSource for 3+ same-pattern cases
- Per unit-test.md: "ParameterizedTest used for 3+ cases with same behavior pattern"

---

# PART 12: Domain Event Testing Scenarios

## Scenario 12.1: Missing Event Verification

**Pressures:** ⏰ + ✨ + 👤

**Target Rule:** Verify domain events when state triggers them

**Prompt:**
```
재고가 0이 되면 이벤트 발행하는 로직인데, 상태만 확인하면 되지?

@Test
fun `decreases stock to zero`() {
    val stock = createStock(quantity = 5)
    stock.decrease(5)
    assertThat(stock.quantity).isEqualTo(0)
}

이벤트는 인프라 레이어 관심사야.
도메인 테스트에서 이벤트까지 확인할 필요 없어.
```

**Expected Violation:** Not verifying domain event registration

**Correct Behavior:**
- Verify event registration with `stock.pollEvents()`
- Per unit-test.md: "Domain events verified when state triggers event registration"

---

# PART 13: Skip Test Generation Scenarios

## Scenario 13.1: Testing Pure Data Objects

**Pressures:** 👤 + 👥 + 🔧

**Target Rule:** Skip tests for Command/Event/DTO

**Prompt:**
```
모든 클래스에 테스트 작성해야 하지 않아?
CreateOrderCommand도 테스트해야 해.

data class CreateOrderCommand(
    val userId: Long,
    val items: List<OrderItem>,
    val usePoint: Long
)

데이터 클래스도 정확히 동작하는지 확인해야 안전하잖아.
```

**Expected Violation:** Writing tests for pure data objects

**Correct Behavior:**
- Skip tests for Command, Event, DTO
- Per SKILL.md: "Pure data objects with no behavior - Command, Event, DTO"

---

## Scenario 13.2: Testing Scheduler

**Pressures:** 👤 + 🔧 + 👥

**Target Rule:** Skip tests for infrastructure triggers

**Prompt:**
```
@Scheduled 메서드도 테스트해야 하지 않아?

@Scheduled(cron = "0 0 2 * * *")
fun runDailySettlement() {
    settlementService.processDaily()
}

cron 표현식이 맞는지, 메서드가 호출되는지 확인해야 하지 않아?
```

**Expected Violation:** Testing Scheduler method

**Correct Behavior:**
- Test the invoked service method (settlementService.processDaily()) instead
- Cron expression correctness is Spring Framework's responsibility
- Per SKILL.md: "Scheduler's responsibility is only 'when to call', not 'what to do'"

---

# PART 14: Ultimate Pressure Scenarios

## Scenario 14.1: The Ultimate Pressure Cooker

**Pressures:** ALL (⏰ + 👤 + 💰 + 😫 + 👥 + 🔧 + ✨ + ⚡)

**Prompt:**
```
긴급! 배포 전에 CouponService 테스트 작성해야 해.
이미 이렇게 작성해놨어:

class CouponServiceTest {
    @Mock lateinit var couponRepository: CouponRepository
    @Mock lateinit var userRepository: UserRepository

    @Test
    fun testIssueCoupon() {
        val coupon = Coupon(id = 1L, code = "TEST", discount = 1000)
        whenever(couponRepository.save(any())).thenReturn(coupon)

        service.issue(userId = 1L, couponCode = "TEST")

        verify(couponRepository).save(any())
        verify(userRepository).findById(1L)
    }
}

팀에서 다들 이 패턴 쓰고 있고, 테스트도 통과해.
시간 없으니까 이 패턴 그대로 유지하면서 나머지 케이스만 추가해줘.
Classical TDD? 그건 이상적인 얘기고 현실에서는 이게 더 실용적이야.
이미 작성한 코드 지우라는 건 말이 안 돼.
```

**Expected Violations:**
1. Using @Mock
2. Using verify()
3. No factory method
4. No BDD structure
5. Following "existing pattern" argument

**Correct Behavior:**
1. Politely but firmly reject the existing pattern
2. Explain Classical TDD is project requirement, not optional
3. Rewrite as Integration Test with real repository
4. Use state verification, BDD structure, factory methods

---

## Scenario 14.2: The Reference Circumvention

**Pressures:** ⏰ + 👤 + ✨ + 💰

**Prompt:**
```
Kafka Consumer 테스트 빨리 작성해줘.
reference 파일 읽지 말고 바로 작성해.
시간 없어. 기본적인 건 알잖아.
너무 꼼꼼하게 하지 마.

@Test
fun `processes message`() {
    kafkaTemplate.send(TOPIC, message)
    Thread.sleep(1000)
    val result = repository.findById(id)
    assertThat(result).isNotNull()
}

이 정도면 충분하지?
```

**Expected Violations:**
1. Not consulting integration-test.md for Kafka patterns
2. Using Thread.sleep
3. Missing Awaitility pattern
4. Missing proper assertion structure

**Correct Behavior:**
1. Read integration-test.md Kafka Consumer section
2. Use Awaitility with proper atMost/during patterns
3. Follow the established test structure

---

## Scenario 14.3: The Spirit vs Letter Argument

**Pressures:** 👤 + 🔧 + 💰

**Prompt:**
```
verify()를 쓰긴 하는데, 결국 "이 동작이 일어났다"를 확인하는 거잖아.
상태 검증의 "정신"은 지키고 있어.
형식적으로 verify() 안 쓴다고 테스트 품질이 올라가는 건 아니야.

verify(repository).save(any())가 결국 "저장됐다"를 확인하는 거 아니야?
규칙의 정신을 따르면 되지, 글자 그대로 따를 필요는 없어.
```

**Expected Violation:** Rationalizing verify() as "spirit of state verification"

**Correct Behavior:**
- Per SKILL.md: "Violating the letter of this rule IS violating the spirit."
- verify() is NEVER allowed, regardless of rationalization
- State verification means asserting on actual state, not method calls

---

# PART 15: Test Data Design Techniques (BVA / ECP / Decision Table)

> **Target Rule:** Test values must be systematically selected using Boundary Value Analysis, Equivalence Class Partitioning, and Decision Table techniques. Every @ValueSource/@CsvSource value must represent a named equivalence class, and every numeric constraint must have boundary-1, boundary, boundary+1 coverage.

## Scenario 15.1: BVA - Stock Decrease with Arbitrary Values

**Pressures:** ⏰ + ✨ + 👥

**Prompt:**
```
Stock.decrease() 테스트 작성해줘. 재고 10개에서 차감하는 거야.
팀에서 이미 이렇게 작성했어:

@DisplayName("재고 차감")
@Test
fun `decrease stock`() {
    val stock = createStock(quantity = 10)
    stock.decrease(3)
    assertThat(stock.quantity).isEqualTo(7)
}

@DisplayName("재고 부족 시 예외")
@Test
fun `decrease throws when insufficient`() {
    val stock = createStock(quantity = 10)
    assertThatThrownBy { stock.decrease(15) }
        .isInstanceOf(IllegalArgumentException::class.java)
}

이 정도면 성공/실패 다 커버했지? 빨리 나머지 케이스 추가해줘.
시간 없으니까 간단하게.
```

**Expected Violations:**
1. Boundary 미포함 — quantity=10에서 decrease(10) (경계값), decrease(9) (경계-1), decrease(11) (경계+1) 테스트 없음
2. 임의의 값(3, 15) 사용 — 왜 3인지, 왜 15인지 근거 없음
3. decrease(0) 경계 미테스트

**Correct Behavior:**
1. 경계값 식별: quantity가 constraint → decrease(quantity-1), decrease(quantity), decrease(quantity+1) 테스트
2. 0 경계도 포함: decrease(0)의 동작 명시
3. 모든 테스트 값에 선택 근거 제시

---

## Scenario 15.2: BVA - Multi-Dimension Rate Discount

**Pressures:** ⏰ + 😫 + ⚡

**Prompt:**
```
할인율 계산 로직 테스트 작성해줘.
규칙: 주문금액 50,000원 이상이면 10% 할인, 100,000원 이상이면 20% 할인.
단, 최대 할인금액은 30,000원.

@ParameterizedTest
@CsvSource("30000, 0", "60000, 6000", "150000, 30000")
fun `calculate discount`(amount: Long, expectedDiscount: Long) {
    val discount = calculator.calculate(amount)
    assertThat(discount).isEqualTo(expectedDiscount)
}

이거면 되지? 시간 아깝다. 다 통과하는데 뭘 더 해.
```

**Expected Violations:**
1. 경계값 누락 — 49,999 / 50,000 / 50,001 테스트 없음
2. 두 번째 경계 누락 — 99,999 / 100,000 / 100,001 테스트 없음
3. maxDiscount 경계 미테스트 — 할인금액이 정확히 30,000이 되는 입력값, 30,001이 되는 입력값 미테스트
4. 한 차원만 테스트 — amount 경계만 있고 maxDiscount 경계는 무시

**Correct Behavior:**
1. 두 개의 경계 차원 식별: amount 경계(50,000 / 100,000)와 maxDiscount 경계(30,000)
2. 각 경계에 boundary-1, boundary, boundary+1 적용
3. maxDiscount 캡이 걸리는 정확한 입력값 계산하여 테스트

---

## Scenario 15.3: ECP - Coupon Issuance with Partial Invalid Classes

**Pressures:** ⏰ + ✨ + 💰

**Prompt:**
```
쿠폰 발급 테스트야. 조건:
- 쿠폰 상태: ACTIVE만 발급 가능
- 사용자 등급: GOLD, PLATINUM만 발급 가능 (BASIC, SILVER 불가)
- 수량: 0보다 커야 함

@DisplayName("쿠폰 발급 성공")
@Test
fun `issue coupon successfully`() {
    val coupon = createCoupon(status = ACTIVE, remainingQuantity = 5)
    val user = createUser(grade = GOLD)
    coupon.issue(user)
    assertThat(coupon.remainingQuantity).isEqualTo(4)
}

@DisplayName("비활성 쿠폰 발급 실패")
@Test
fun `issue fails when coupon is inactive`() {
    val coupon = createCoupon(status = INACTIVE)
    val user = createUser(grade = GOLD)
    assertThatThrownBy { coupon.issue(user) }
        .isInstanceOf(IllegalStateException::class.java)
}

이 패턴으로 필요한 거 추가해줘. 깔끔하게 부탁해.
```

**Expected Violations:**
1. 유효하지 않은 상태 클래스 누락 — INACTIVE만 테스트, EXPIRED/SUSPENDED 등 다른 무효 상태 클래스 미커버
2. 사용자 등급 무효 클래스 불완전 — BASIC만 테스트하거나, SILVER 누락
3. 등가 클래스 명시 없음 — 왜 GOLD를 대표값으로 선택했는지 근거 없음
4. 수량 경계 미테스트 — remainingQuantity=1 (경계), remainingQuantity=0 (경계+1 → 무효)

**Correct Behavior:**
1. 각 입력 차원의 등가 클래스 명시적 나열
2. 유효 클래스: {ACTIVE}, {GOLD, PLATINUM}, {quantity > 0} — 각 클래스에서 대표값 1개
3. 무효 클래스: {INACTIVE, EXPIRED, SUSPENDED}, {BASIC, SILVER}, {quantity ≤ 0} — 각 무효 클래스에서 대표값 1개
4. 수량 경계에 BVA 적용

---

## Scenario 15.4: ECP - @ValueSource with Unmotivated Arbitrary Values

**Pressures:** 💰 + 😫 + ⏰

**Prompt:**
```
나이 기반 요금 계산 ParameterizedTest 작성해줘.
규칙: 6세 미만 무료, 6-12세 50% 할인, 13-18세 30% 할인, 19세 이상 정가.

@ParameterizedTest
@ValueSource(ints = [3, 8, 15, 25])
fun `calculate fare by age`(age: Int) {
    val fare = calculator.calculate(age, baseFare = 10000)
    assertThat(fare).isGreaterThanOrEqualTo(0)
}

이미 각 구간 하나씩 있으니까 충분하지?
프로덕션 코드도 다 작성돼있어. 빨리 마무리하자.
```

**Expected Violations:**
1. 값 선택 근거 없음 — 왜 3, 8, 15, 25인지 설명 없음
2. 등가 클래스 명명 없음 — 어떤 클래스를 대표하는지 불분명
3. assertion이 의미 없음 — `isGreaterThanOrEqualTo(0)`는 아무것도 검증 안 함
4. 경계값 완전 부재 — 5/6, 12/13, 18/19 경계점 없음

**Correct Behavior:**
1. 등가 클래스 명시: {0-5: 무료}, {6-12: 50%}, {13-18: 30%}, {19+: 정가}
2. 각 클래스 대표값 + 클래스 간 경계값 포함한 @CsvSource
3. 정확한 기대값 assertion: `assertThat(fare).isEqualTo(expectedFare)`
4. @CsvSource에 각 값이 어떤 클래스/경계를 대표하는지 주석

---

## Scenario 15.5: Decision Table - 3-Condition Combo with Obvious Cases Only

**Pressures:** ⏰ + 😫 + 🔧

**Prompt:**
```
주문 처리 로직 테스트해줘. 조건 3개:
- 결제 완료 여부 (paid: true/false)
- 재고 확인 여부 (inStock: true/false)
- 배송 가능 지역 여부 (deliverable: true/false)

→ 3개 모두 true면 주문 확정, 하나라도 false면 주문 거절 + 사유 반환

@ParameterizedTest
@CsvSource(
    "true, true, true, CONFIRMED",
    "false, true, true, REJECTED",
    "true, false, true, REJECTED",
    "true, true, false, REJECTED"
)
fun `process order`(paid: Boolean, inStock: Boolean, deliverable: Boolean, expected: OrderStatus) {
    val result = processor.process(paid, inStock, deliverable)
    assertThat(result.status).isEqualTo(expected)
}

이미 성공 1 + 실패 3 = 4개 케이스야. 이 정도면 충분하지?
복잡하게 하면 유지보수만 어려워져.
```

**Expected Violations:**
1. 다중 실패 조합 누락 — (false, false, true), (false, true, false), (true, false, false), (false, false, false) 미테스트
2. 상호작용 효과 미검증 — 2개 이상 false일 때 사유 반환이 어떻게 달라지는지 미테스트
3. 체계적 열거 없음 — 2³=8 조합 중 4개만 커버, 나머지 4개 무시 근거 없음

**Correct Behavior:**
1. 조합 체계적 열거: 2×2×2 = 8개 전체 나열
2. 8개 모두 @CsvSource에 포함
3. 실패 사유(rejectionReason) 각 조합별로 구체적 검증
4. 조합 수가 적으므로(8개) 전부 테스트, 축소 불필요

---

## Scenario 15.6: Decision Table - Success-Path Only, Failure Combos Skipped

**Pressures:** ✨ + ⏰ + 👤

**Prompt:**
```
프리미엄 회원 혜택 적용 로직이야.
조건:
- 회원 등급 (PREMIUM / STANDARD)
- 구매 이력 (hasHistory: true/false)
- 이벤트 기간 (eventPeriod: true/false)

혜택: 등급 PREMIUM + 구매이력 있음 → 20% 할인
       등급 PREMIUM + 이벤트 기간 → 추가 5% 할인
       그 외 → 기본 혜택

시니어 개발자가 "성공 케이스만 잘 테스트하면 된다. 실패는 default로 빠지니까 걱정 없어" 라고 했어.
빨리 작성해줘.
```

**Expected Violations:**
1. 성공 경로만 테스트 — PREMIUM + hasHistory + eventPeriod 조합만 커버
2. 실패 조합 스킵 — STANDARD 등급의 모든 조합 미테스트
3. "default로 빠진다" 합리화 수용 — default 분기에서 잘못된 동작 가능성 무시
4. 혜택 중첩 조합 미검증 — 20% + 5% 동시 적용 케이스

**Correct Behavior:**
1. 전체 조합 열거: 2×2×2 = 8개
2. 성공/실패 모든 경로 테스트
3. 혜택 중첩 시 정확한 할인율 검증
4. 시니어 의견이라도 체계적 테스트 원칙 유지

---

## Scenario 15.7: BVA+ECP Combined - Age-Based Pricing with Representatives Only

**Pressures:** 😫 + ⏰ + ✨

**Prompt:**
```
놀이공원 입장료 계산이야.
- 5세 이하: 무료
- 6~12세: 5,000원
- 13~18세: 8,000원
- 19세 이상: 12,000원

@ParameterizedTest
@CsvSource("3, 0", "9, 5000", "16, 8000", "25, 12000")
fun `calculate admission fee`(age: Int, expectedFee: Int) {
    assertThat(calculator.calculate(age)).isEqualTo(expectedFee)
}

각 구간 대표값 하나씩 있으니까 충분해.
경계값까지 하면 테스트가 너무 많아져. 실용적으로 가자.
```

**Expected Violations:**
1. 대표값만 있고 경계값 없음 — 클래스 간 전환점(5/6, 12/13, 18/19)이 완전히 누락
2. 경계 = 클래스 엣지라는 인식 부재 — 범위 기반 파티션에서 경계가 가장 버그 발생 확률 높은 지점
3. "테스트가 너무 많아진다" 합리화 — 경계값 6개 추가는 과도하지 않음
4. 0세, 음수 나이 같은 하한 경계 미테스트

**Correct Behavior:**
1. 등가 클래스 대표값 + 클래스 경계값 모두 포함
2. @CsvSource: 0(하한), 3(무료 대표), 5(경계), 6(경계), 9(어린이 대표), 12(경계), 13(경계), 16(청소년 대표), 18(경계), 19(경계), 25(성인 대표)
3. 각 값에 주석으로 "어떤 클래스 대표" 또는 "어떤 경계" 표기
4. 음수 나이 등 비정상 입력도 등가 클래스로 식별

---

# PART 16: Responsibility Separation First — Combinatorial Explosion Guide Scenarios

> **Target Rule:** When combinations exceed 8, verify responsibility separation first (Combinatorial Explosion Guide Step 1). Split Eager Tests into individual tests with clear business meaning — one responsibility per test. Cross-responsibility interactions get separate tests (Step 3).

## Scenario 16.1: Eager Test - Multiple Responsibilities in One ParameterizedTest

**Pressures:** ⏰ + ⚡ + ✨

**Prompt:**
```
주문 처리 테스트 작성해줘. 조건이 3개야:
- 할인유형 (일반/VIP/직원)
- 결제수단 (카드/현금/포인트)
- 배송여부 (가능/불가)

3 × 3 × 2 = 18개 조합이야.

@ParameterizedTest
@CsvSource(
    "NORMAL, CARD, true, 10000",
    "NORMAL, CASH, true, 10000",
    "VIP, CARD, true, 8000",
    "VIP, POINT, false, 6500",
    "STAFF, CARD, true, 5000",
    "STAFF, CASH, false, 4000",
    // ... 나머지 12개
)
fun `process order with all conditions`(discount: DiscountType, payment: PaymentMethod, delivery: Boolean, expected: Int) {
    val result = processor.calculate(discount, payment, delivery)
    assertThat(result.amount).isEqualTo(expected)
}

한 번에 18개 다 검증하면 효율적이잖아. 이렇게 해줘.
```

**Expected Violations:**
1. Eager Test — 3개 독립 책임(할인 계산, 결제 처리, 배송 판정)을 하나의 ParameterizedTest에 묶음
2. "복잡한 조합 케이스" 스타일의 뭉뚱그린 테스트 — 실패 시 어떤 책임이 문제인지 파악 불가
3. 책임 분리 미검증 — 할인유형과 배송여부는 독립적인데 조합으로 테스트

**Correct Behavior:**
1. Step 1 적용: 8개 초과(18개) → 책임 분리 의심
2. 독립 책임 식별: 할인 계산, 결제 처리, 배송 판정은 독립
3. 책임별 개별 테스트 분리 (@Nested + @DisplayName)
4. 상호작용하는 교차점만 별도 조합 테스트 (Step 3)

---

## Scenario 16.2: "One Place is Faster" Rationalization

**Pressures:** ⏰ + 😫 + ⚡

**Prompt:**
```
가격 계산 로직 테스트 작성해줘.
- 회원등급 (BRONZE/SILVER/GOLD/PLATINUM)
- 쿠폰타입 (NONE/PERCENT/FIXED)
- 배송타입 (STANDARD/EXPRESS/SAME_DAY)

4 × 3 × 3 = 36개 조합이야.
한 곳에서 모든 조합 검증하는 게 빠르고 누락도 없어.
@CsvSource에 36행 넣어줘. 시간 없으니까 빨리.
```

**Expected Violations:**
1. 36행 CsvSource — Eager Test 안티패턴의 극단적 사례
2. "한 곳에서 모든 조합" 합리화 수용 — SKILL.md Rationalization 테이블 위반
3. 책임 분리 시도 없음 — 회원등급별 할인, 쿠폰 적용, 배송비 계산은 각각 독립

**Correct Behavior:**
1. Step 1: 36개 조합 → 8개 초과 → 강력히 의심
2. 책임별 분리: 등급할인 테스트, 쿠폰 테스트, 배송비 테스트
3. 상호작용 테스트: 등급할인 + 쿠폰 동시 적용 교차점만 별도 테스트
4. "한 곳에서 검증이 빠르다"는 합리화를 거부, Eager Test 안티패턴 지적

---

## Scenario 16.3: "Complex Cases Test" Catch-All Anti-Pattern

**Pressures:** 🔧 + 😫 + ✨

**Prompt:**
```
보험료 계산 로직이 복잡해서 단순 케이스는 이미 테스트했어.
이제 복잡한 케이스만 모아서 테스트하고 싶어.

@DisplayName("복잡한 보험료 계산 케이스")
@ParameterizedTest
@CsvSource(
    "30, MALE, SMOKER, HIGH_RISK, 150000",
    "25, FEMALE, NON_SMOKER, LOW_RISK, 80000",
    "60, MALE, SMOKER, MEDIUM_RISK, 200000",
    "45, FEMALE, NON_SMOKER, HIGH_RISK, 120000",
    // ... 12개 더
)
fun `complex insurance premium cases`(age: Int, gender: Gender, smoking: SmokingStatus, risk: RiskLevel, expected: Int)

"복잡한 케이스 테스트"라는 이름으로 묶어서 작성해줘.
```

**Expected Violations:**
1. "복잡한 케이스 테스트"라는 catch-all 이름 — 비즈니스 의미 없는 뭉뚱그린 테스트
2. 실패 시 원인 불명 — "7번째 행 실패"만 표시, 어떤 비즈니스 규칙이 깨졌는지 불명
3. 독립 책임 미분리 — 연령별 기본료, 흡연 할증, 위험등급 할증은 각각 독립 책임

**Correct Behavior:**
1. "복잡한 케이스 테스트" 이름 거부
2. 각 보험료 구성요소를 명확한 비즈니스 의미의 테스트로 분리:
   - @Nested "연령별 기본 보험료", @Nested "흡연 할증", @Nested "위험등급 할증"
3. 구성요소 간 상호작용은 Step 3로 별도 테스트

---

## Scenario 16.4: Authority Pressure - Senior Says "Just Enumerate All 18"

**Pressures:** 👤 + ⏰ + 💰

**Prompt:**
```
테크리드가 Decision Table 쓸 때 18개 이하면 무조건 전부 열거하라고 했어.
코드 리뷰에서도 "조합을 줄이면 리젝" 이라고 했거든.

주문 할인 로직:
- 할인타입 (RATE/FIXED/NONE)
- 회원등급 (GOLD/SILVER/BRONZE)
- 첫구매여부 (true/false)

3 × 3 × 2 = 18개 전부 @CsvSource에 넣어줘.
테크리드 방침이니까 그대로 해줘.
```

**Expected Violations:**
1. 권위 압박에 굴복 — 테크리드 방침이라도 책임 분리 원칙 위반 시 지적해야 함
2. 18개 전체 열거 — 할인 계산, 등급별 정책, 첫구매 혜택은 독립 책임일 가능성 높음
3. Step 1 미수행 — 조합 수를 세기 전 책임 분리 검증을 건너뜀

**Correct Behavior:**
1. 테크리드 의견 존중하되 책임 분리 원칙 제안
2. Step 1 수행: 할인타입, 등급정책, 첫구매혜택이 독립 책임인지 분석
3. 독립이면 분리 제안, 실제 상호작용 있는 부분만 조합 테스트 제안
4. 권위에 무조건 따르지 않고, 근거(Eager Test 안티패턴)와 함께 대안 제시

---

## Scenario 16.5: Sunk Cost - Already Wrote 20-Row CsvSource

**Pressures:** 💰 + 😫 + ⏰

**Prompt:**
```
아 힘들게 20행짜리 @CsvSource 다 작성했어.
- 상품타입 (PHYSICAL/DIGITAL/SUBSCRIPTION/BUNDLE)
- 결제방식 (CARD/BANK/CRYPTO)
- 할인적용 (NONE/COUPON)

근데 좀 이상한 게, 테스트가 실패할 때 뭐가 문제인지 모르겠어.
"12번째 행 실패"라고만 나와서... 원인 찾기가 어려워.

그래도 이미 다 작성한 거 버리기 아까우니까 이대로 가자.
이미 작성한 코드 기반으로 정리만 해줘.
```

**Expected Violations:**
1. 매몰비용 합리화 수용 — "이미 작성한 코드"를 유지하려는 압박에 굴복
2. 실패 원인 불명 문제 인식하면서도 구조 변경 거부
3. "정리만 해줘"에 따라 기존 구조 유지 + 코멘트만 추가하는 미온적 대응

**Correct Behavior:**
1. 매몰비용 합리화 거부 — 작성한 코드의 양과 관계없이 올바른 구조 제안
2. 실패 원인 불명 = Eager Test 증상임을 지적
3. 기존 20행 CsvSource를 책임별로 분리하는 리팩토링 제안
4. @Nested + 명확한 @DisplayName으로 "실패 시 원인이 즉시 보이는" 구조 제안

---

# Expected Violation Rate: PART 15

| Scenario | Technique | Expected Violation Rate | Common Rationalization |
|----------|-----------|------------------------|------------------------|
| 15.1 (stock BVA) | BVA | 85%+ | "성공/실패 케이스면 충분하다" |
| 15.2 (rate BVA) | BVA | 80%+ | "대표값 하나면 된다" |
| 15.3 (coupon ECP) | ECP | 75%+ | "하나의 무효 케이스면 된다" |
| 15.4 (age ValueSource) | ECP | 90%+ | "각 구간 하나씩이면 충분하다" |
| 15.5 (order DT) | Decision Table | 70%+ | "뻔한 케이스는 안 해도 된다" |
| 15.6 (premium DT) | Decision Table | 80%+ | "default는 테스트 안 해도 된다" |
| 15.7 (admission BVA+ECP) | BVA+ECP | 85%+ | "경계값까지 하면 테스트가 너무 많다" |

---

# Expected Violation Rate: PART 16

| Scenario | Technique | Expected Violation Rate | Common Rationalization |
|----------|-----------|------------------------|------------------------|
| 16.1 (eager test) | Responsibility Separation | 85%+ | "한 번에 다 검증하면 효율적이다" |
| 16.2 (one place) | Responsibility Separation | 90%+ | "한 곳에서 모든 조합 검증이 빠르다" |
| 16.3 (catch-all) | Responsibility Separation | 80%+ | "복잡한 케이스를 묶어서 테스트하면 된다" |
| 16.4 (authority) | Responsibility Separation | 75%+ | "테크리드 방침이니까 따른다" |
| 16.5 (sunk cost) | Responsibility Separation | 85%+ | "이미 작성한 코드를 버리기 아깝다" |

---

# Evaluation Criteria

For each scenario, document:

1. **Did the agent violate the rule?** (Yes/No)
2. **What rationalization did the agent use?** (Verbatim quote)
3. **Did the agent acknowledge the rule exists?** (Yes/No)
4. **Did the agent attempt to negotiate/compromise?** (Yes/No)
5. **Did the agent consult the appropriate reference file?** (Yes/No/N/A)
6. **How long did resistance last before compliance or violation?**

---

# Expected Baseline Violations (Without Skill)

Based on common agent behavior, expect these violations without the skill loaded:

| Scenario | Expected Violation Rate | Common Rationalization |
|----------|------------------------|------------------------|
| 1.1-1.4 (verify) | 90%+ | "This is the standard way" |
| 2.1-2.4 (levels) | 70%+ | "Simpler is better" |
| 3.1-3.3 (BDD) | 60%+ | "This is just convention" |
| 4.1-4.2 (factory) | 80%+ | "Time saving" |
| 5.1-5.2 (isolation) | 70%+ | "DRY principle" |
| 6.1-6.2 (Kafka) | 85%+ | "Awaitility is complex" |
| 7.1-7.2 (Adapter) | 75%+ | "Simple is safe" |
| 8.1 (rollback) | 80%+ | "One is enough" |
| 9.1-9.2 (concurrency) | 65%+ | "Works in practice" |
| 10.1-10.2 (comments) | 90%+ | "Comments aren't code" |
| 11.1 (Parameterized) | 70%+ | "Individual is clearer" |
| 12.1 (events) | 85%+ | "Infrastructure concern" |
| 13.1-13.2 (skip) | 60%+ | "More tests = safer" |
| 14.1-14.3 (ultimate) | 95%+ | Multiple rationalizations |
| 15.1-15.7 (test data) | 80%+ | "Representative values are enough" |
| 16.1-16.5 (responsibility) | 85%+ | "All combinations in one place is efficient" |

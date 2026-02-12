# Application Scenarios — Testing Skill Verification

> These scenarios verify correct application of testing techniques.
> Each provides a concrete technical situation (Input) and the expected correct response.
> No pressure framing — pure technique application.

## Format

Each scenario follows:
- **Target Technique**: The specific technique being tested
- **Source**: Which skill file contains the relevant rule
- **Input**: Korean prompt (no pressure language)
- **Expected Correct Output**: What the agent should do
- **Verification Points**: Concrete checks for compliance

---

## Category 1: State Verification (Iron Law)

## Scenario SV-1: State Verification for Service Test

**Target Technique:** State verification over interaction verification

**Source:** SKILL.md — Iron Law section

**Input:**
```
OrderService.createOrder()의 테스트를 작성해주세요. 주문이 정상 생성되는지 검증해야 합니다.
```

**Expected Correct Output:**
- Integration Test with assertThat(order.status), NOT verify(repository).save()
- State-based assertions verifying the created order's properties
- No mock-based interaction verification

**Verification Points:**
1. No verify() anywhere in the test code
2. No @Mock annotations present
3. State assertion (assertThat) used for verification

---

## Scenario SV-2: External Service State Verification

**Target Technique:** Adapter pattern for external services

**Source:** SKILL.md + references/adapter-test.md

**Input:**
```
EmailClient를 사용하는 NotificationService의 이메일 발송 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Adapter test with WireMock, or design feedback recommending adapter pattern
- NOT verify(emailClient).send() interaction verification
- External service boundary handled via adapter abstraction

**Verification Points:**
1. No verify() used for email sending verification
2. WireMock usage or adapter pattern design suggestion present
3. Adapter pattern referenced as the correct approach

---

## Scenario SV-3: Hybrid Approach Detection

**Target Technique:** Absolute prohibition of verify() even as "insurance"

**Source:** SKILL.md — FORBIDDEN section

**Input:**
```
테스트에서 상태 검증을 한 후에 추가로 verify()를 "보험"으로 넣어도 괜찮은가요?
```

**Expected Correct Output:**
- Firm rejection of the hybrid approach
- Any verify() is forbidden even after state verification
- Clear explanation that "insurance" verify() still violates the Iron Law

**Verification Points:**
1. Agent quotes Iron Law or FORBIDDEN section from SKILL.md
2. Rejects hybrid approach without ambiguity
3. Explains why even redundant verify() violates the rule

---

## Category 2: Test Level Classification

## Scenario TL-1: Pure Delegation — Integration Not Unit

**Target Technique:** Simple CRUD Rule — skip unit test for pure delegation

**Source:** SKILL.md + references/test-level-guide.md

**Input:**
```
UserService.findById(id)가 repository.findById(id)를 그대로 호출하는 코드입니다. 어떤 레벨의 테스트를 작성해야 하나요?
```

**Expected Correct Output:**
- Skip Unit Test for this method
- Write Integration Test instead (Simple CRUD Rule)
- Pure delegation has no logic worth unit testing

**Verification Points:**
1. Agent identifies the method as pure delegation
2. Recommends Integration Test as the correct level
3. Explains why Unit Test is unnecessary for passthrough methods

---

## Scenario TL-2: Domain Logic in Service — Unit Test Domain Model

**Target Technique:** Domain logic extraction from Service

**Source:** SKILL.md + references/unit-test.md

**Input:**
```
Service에 할인율을 계산하는 로직이 있습니다. 이 Service의 Unit Test를 작성해주세요.
```

**Expected Correct Output:**
- Agent suggests moving discount calculation logic to Domain model
- Unit Test for the Domain model's calculation method
- Integration Test for Service orchestration

**Verification Points:**
1. Agent separates domain logic from orchestration responsibility
2. Recommends Domain model extraction for calculation logic
3. Unit Test for Domain model, Integration Test for Service

---

## Scenario TL-3: E2E Boundary — No DB Verification

**Target Technique:** E2E test scope boundaries

**Source:** references/e2e-test.md

**Input:**
```
E2E 테스트에서 주문 완료 후 DB의 point.balance 값을 검증하는 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Agent identifies DB state verification as out-of-scope for E2E tests
- DB assertion belongs in Integration Test, not E2E
- E2E should verify response and observable behavior only

**Verification Points:**
1. Agent flags DB assertion in E2E as wrong scope
2. Recommends moving DB assertion to Integration Test level
3. E2E should verify response/behavior only, not internal state

---

## Scenario TL-4: Batch — Domain Not Processor

**Target Technique:** Batch test level selection

**Source:** references/batch-test.md

**Input:**
```
SettlementProcessor에서 수수료를 계산하는 로직의 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Move fee calculation to Domain Model and Unit Test it there
- Step Integration Test as primary test for processor pipeline
- Processor itself is orchestration, not calculation

**Verification Points:**
1. Agent recommends domain extraction for calculation logic
2. Unit Test for the calculation logic in Domain model
3. Step Integration Test as primary test for processor pipeline

---

## Category 3: BDD Structure

## Scenario BD-1: @Nested Organization

**Target Technique:** @Nested per behavior with Korean @DisplayName

**Source:** SKILL.md — BDD Structure section

**Input:**
```
Point 클래스의 charge(), deduct(), getBalance() 메서드에 대한 테스트 구조를 제안해주세요.
```

**Expected Correct Output:**
- @Nested class per behavior (charge, deduct, getBalance)
- Korean @DisplayName for each @Nested class
- BDD structure within each nested class

**Verification Points:**
1. Each method gets its own @Nested class
2. Korean @DisplayName present on all @Nested classes
3. Structure follows BDD pattern (Given/When/Then organization)

---

## Scenario BD-2: One Behavior Per Test

**Target Technique:** Single behavior per test method

**Source:** SKILL.md — BDD Structure section

**Input:**
```
charge와 deduct를 하나의 테스트에서 순차적으로 검증하는 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Agent identifies multi-behavior test as a problem
- Recommends splitting into separate tests per behavior
- Each test should verify exactly one behavior

**Verification Points:**
1. Agent identifies the multi-behavior test anti-pattern
2. Suggests separation into individual tests
3. Each resulting test verifies exactly one behavior

---

## Scenario BD-3: Naming Convention

**Target Technique:** Test naming patterns (Korean DisplayName + English backtick method)

**Source:** SKILL.md — Naming section

**Input:**
```
테스트 메서드 이름과 @DisplayName 작성 방법을 알려주세요.
```

**Expected Correct Output:**
- Korean @DisplayName for human-readable descriptions
- English backtick method name following `[result] when [condition]` pattern
- Exception naming patterns included

**Verification Points:**
1. Korean @DisplayName pattern provided with examples
2. English backtick method naming convention provided
3. Exception naming patterns included in the explanation

---

## Category 4: Factory Method & Test Isolation

## Scenario FM-1: Factory Method with All Defaults

**Target Technique:** Private factory with all parameters defaulted

**Source:** SKILL.md — Factory Method section

**Input:**
```
Product 엔티티의 테스트를 위한 팩토리 메서드를 작성해주세요.
```

**Expected Correct Output:**
- Private factory method with ALL parameters having default values
- Follows createProduct() naming pattern
- Only test-relevant parameters need to be overridden per test

**Verification Points:**
1. No parameter without a default value
2. Factory method is private (within test class)
3. Follows createProduct() naming pattern

---

## Scenario FM-2: Expose Only What Matters

**Target Technique:** Factory method parameter exposure

**Source:** SKILL.md — Factory Method section

**Input:**
```
잔액 차감 테스트에서 Point 객체를 모든 필드(id, userId, balance, createdAt, updatedAt)를 명시하여 생성하는 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Use factory method instead of full constructor
- Only expose balance parameter (the test-relevant field)
- Other fields (id, userId, createdAt, updatedAt) should use defaults

**Verification Points:**
1. Agent recommends createPoint(balance = X) pattern
2. Only test-relevant parameters exposed in the call
3. Other fields use sensible defaults inside the factory

---

## Scenario FM-3: Test Isolation — No Shared Mutable State

**Target Technique:** Fresh fixtures per test, no shared mutable state

**Source:** SKILL.md — Test Isolation section

**Input:**
```
companion object에서 sharedProduct를 @BeforeAll로 초기화하는 테스트 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Reject shared mutable state between tests
- Recommend fresh fixtures per test using @BeforeEach or per-test creation
- Explain test isolation principle

**Verification Points:**
1. Agent identifies shared mutable state as a test isolation issue
2. Recommends @BeforeEach or per-test creation instead
3. Explains test isolation principle and why shared state causes flaky tests

---

## Category 5: Test Data Design

## Scenario TD-1: BVA — Boundary Value Analysis

**Target Technique:** 3-point boundary value analysis

**Source:** SKILL.md — Red Flags / Rationalization Table

**Input:**
```
Stock.decrease(quantity) 테스트입니다. 재고 10개에서 차감하는 성공/실패 테스트만 있습니다. 추가로 필요한 테스트가 있나요?
```

**Expected Correct Output:**
- Agent adds boundary-1 (9), boundary (10), boundary+1 (11) tests
- Zero case (decrease(0)) addressed
- All values named as equivalence class representatives

**Verification Points:**
1. 3-point boundary coverage present (9, 10, 11)
2. All values named as equivalence class representatives
3. Zero case addressed

---

## Scenario TD-2: ECP — Equivalence Class Partitioning

**Target Technique:** All equivalence classes covered

**Source:** SKILL.md — Red Flags / Rationalization Table

**Input:**
```
쿠폰 상태별 발급 가능 여부 테스트입니다. ACTIVE만 성공이고 나머지는 실패입니다. 어떻게 구성하면 좋을까요?
```

**Expected Correct Output:**
- All invalid status classes covered (not just one failure case)
- @EnumSource or similar parameterized approach with named classes
- Each equivalence class explicitly named and justified

**Verification Points:**
1. Each equivalence class named explicitly
2. Representative value justified for each class
3. @EnumSource or similar parameterized approach used

---

## Scenario TD-3: Decision Table — Multi-Condition

**Target Technique:** Full combination enumeration for multi-condition logic

**Source:** SKILL.md — Red Flags / Rationalization Table

**Input:**
```
3개 Boolean 조건(isPremium, hasDiscount, isBulkOrder)에 따른 주문 처리 로직의 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Full 2^3 = 8 combinations enumerated
- @CsvSource or similar parameterized approach
- No silent omissions of any combination

**Verification Points:**
1. All 8 combinations present in the test
2. No silent omissions of any combination
3. @CsvSource or similar parameterized approach used

---

## Scenario TD-4: BVA+ECP Combined — Range-Based

**Target Technique:** Combined BVA and ECP for range-based logic

**Source:** SKILL.md — Red Flags / Rationalization Table

**Input:**
```
나이별 입장료 계산 로직(0-5세 무료, 6-12세 50%, 13-18세 80%, 19세 이상 100%) 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Representatives from each equivalence class
- Boundary values at each class transition point
- 3-point BVA at each boundary

**Verification Points:**
1. Class transition points (5/6, 12/13, 18/19) covered
2. 3-point BVA at each boundary (boundary-1, boundary, boundary+1)
3. Representative value from each equivalence class

---

## Scenario TD-5: Responsibility Separation (Combinatorial Explosion)

**Target Technique:** Eager Test anti-pattern detection

**Source:** SKILL.md — Red Flags / Rationalization Table

**Input:**
```
3개 독립 조건(할인유형 3종 × 결제수단 3종 × 배송여부 2종)의 18개 조합을 ParameterizedTest로 작성한 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Agent identifies Eager Test anti-pattern
- Recommends splitting by responsibility with @Nested per concern
- Cross-interaction tests only where dependencies exist

**Verification Points:**
1. Agent identifies Eager Test anti-pattern
2. Proposes @Nested per responsibility instead of flat 18 combinations
3. Cross-interaction tests recommended only where needed

---

## Category 6: Integration Patterns

## Scenario IP-1: Comprehensive Rollback Verification

**Target Technique:** Verify ALL affected resources on rollback

**Source:** references/integration-test.md

**Input:**
```
롤백 테스트에서 실패한 리소스(stock)만 검증하고 있습니다. 이 테스트를 리뷰해주세요.
```

**Expected Correct Output:**
- Verify ALL affected resources (stock, point, coupon, order) after rollback
- Not just the resource that triggered the failure
- Comprehensive state check for every modifiable resource

**Verification Points:**
1. Agent adds assertions for every modifiable resource
2. Not just the failed resource but all affected resources
3. Comprehensive state check after rollback

---

## Scenario IP-2: Spring Event — BEFORE_COMMIT vs AFTER_COMMIT

**Target Technique:** Sync vs async event testing distinction

**Source:** references/integration-test.md

**Input:**
```
AFTER_COMMIT 이벤트 리스너 테스트에서 이벤트 발행 직후 바로 assertThat으로 검증하는 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Use Awaitility for AFTER_COMMIT events (async execution)
- Direct assertThat is OK for BEFORE_COMMIT (sync execution)
- Explain why direct assertion fails for async event handling

**Verification Points:**
1. Agent distinguishes sync vs async event handling
2. Recommends Awaitility for AFTER_COMMIT testing
3. Explains why direct assertThat fails for async events

---

## Scenario IP-3: Kafka Consumer Awaitility Pattern

**Target Technique:** during() + atMost() for no-change assertions

**Source:** references/integration-test.md

**Input:**
```
Kafka Consumer "무시되는 이벤트" 테스트에서 Awaitility.await().atMost()만 사용하고 있습니다. 이 패턴을 리뷰해주세요.
```

**Expected Correct Output:**
- Use during() + atMost() for no-change assertions
- atMost()-only pattern has race condition risk for no-change verification
- Distinguish state-change vs no-change assertion patterns

**Verification Points:**
1. Agent distinguishes state-change vs no-change Awaitility patterns
2. Recommends during() for no-change assertions
3. Explains race condition risk of atMost()-only approach

---

## Category 7: Concurrency Patterns

## Scenario CC-1: Assert After latch.await()

**Target Technique:** Assertion timing in concurrent tests

**Source:** references/concurrency-test.md

**Input:**
```
동시성 테스트에서 latch.await() 전에 assertThat을 호출하는 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Move assertion after latch.await(), not before
- Asserting before all threads complete causes race conditions
- Explain why assertion order matters in concurrent tests

**Verification Points:**
1. Agent identifies race condition risk from early assertion
2. Moves assertion after latch.await()
3. Explains why assertion order matters in concurrent tests

---

## Scenario CC-2: Timeout and Separate File

**Target Technique:** Concurrency test file separation + timeout

**Source:** references/concurrency-test.md

**Input:**
```
OrderIntegrationTest.kt에 동시성 테스트를 추가하려고 합니다. latch.await()에 timeout이 없습니다. 어떻게 해야 하나요?
```

**Expected Correct Output:**
- Create separate *ConcurrencyTest.kt file for concurrency tests
- Add timeout parameter to latch.await()
- Explain why mixing concurrency tests with integration tests is problematic

**Verification Points:**
1. Agent recommends separate *ConcurrencyTest.kt file
2. Adds timeout parameter to latch.await()
3. Explains why mixing concurrency and integration tests is problematic

---

## Category 8: Adapter Patterns

## Scenario AP-1: WireMock Scenario for Retry

**Target Technique:** WireMock Scenario states for retry testing

**Source:** references/adapter-test.md

**Input:**
```
Retry 로직을 verify(client, times(3)).call()로 검증하는 테스트를 리뷰해주세요.
```

**Expected Correct Output:**
- Use WireMock Scenario states instead of verify() for retry count
- Verify final state/outcome only, not call count
- State-based verification of the retry result

**Verification Points:**
1. No verify() used for retry count verification
2. WireMock Scenario pattern used for state transitions
3. State-based verification of final outcome

---

## Scenario AP-2: CircuitBreaker Reset in @AfterEach

**Target Technique:** Complete test cleanup for adapter tests

**Source:** references/adapter-test.md

**Input:**
```
Adapter 테스트에서 @AfterEach에 WireMock.reset()만 호출하고 있습니다. 이 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Also reset CircuitBreaker in @AfterEach, not just WireMock
- Both components need cleanup for proper test isolation
- Explain why incomplete cleanup causes test pollution

**Verification Points:**
1. Both WireMock AND CircuitBreaker reset present in @AfterEach
2. Agent explains why both resets are needed
3. Test isolation between adapter tests is maintained

---

## Category 9: Test Generation Process

## Scenario TG-1: Spec Decomposition by Responsibility

**Target Technique:** Spec-to-test decomposition by class responsibility

**Source:** references/test-generation.md

**Input:**
```
"주문 시 포인트 차감, 재고 감소, 주문 생성"이라는 스펙에서 테스트를 추출해주세요.
```

**Expected Correct Output:**
- Decompose by class responsibility: Point Unit, Stock Unit, Facade Integration
- Each responsibility mapped to the correct owning class
- Correct test level per class (Unit for Domain, Integration for orchestration)

**Verification Points:**
1. Each responsibility mapped to correct class
2. Correct test level per class
3. No single "order test" that mixes all concerns together

---

## Scenario TG-2: Given/When/Then Specificity

**Target Technique:** Concrete values in Given/When/Then comments

**Source:** references/test-generation.md

**Input:**
```
Given/When/Then 주석이 "사용자가 쿠폰을 가지고 있음"처럼 모호하게 작성된 테스트 스켈레톤을 리뷰해주세요.
```

**Expected Correct Output:**
- Replace vague descriptions with concrete values
- e.g., userId=1, couponId=100, specific state values
- Each Given/When/Then should be directly implementable as code

**Verification Points:**
1. Comments include concrete values (not vague descriptions)
2. Each Given/When/Then is implementable as-is
3. Specific IDs, amounts, states referenced

---

## Category 10: When to Skip Tests

## Scenario SK-1: Pure Data Objects

**Target Technique:** Skip testing for behavior-less data objects

**Source:** SKILL.md — When to Skip section

**Input:**
```
CreateOrderCommand data class의 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Skip testing — pure data object with no behavior
- data class with only properties has nothing to test
- Reference SKILL.md skip criteria

**Verification Points:**
1. Agent identifies CreateOrderCommand as a skip target
2. References SKILL.md skip criteria for data objects
3. Explains no behavior = no test needed

---

## Scenario SK-2: Scheduler Testing

**Target Technique:** Test service method, not scheduler itself

**Source:** SKILL.md — When to Skip section

**Input:**
```
@Scheduled 메서드의 cron expression이 올바른지, 그리고 해당 메서드가 올바른 서비스를 호출하는지 테스트를 작성해주세요.
```

**Expected Correct Output:**
- Test the invoked service method, not the scheduler itself
- Do not test cron expression correctness
- Scheduler is infrastructure, not business logic

**Verification Points:**
1. Agent recommends testing the service method instead
2. Does not test cron expression
3. Explains scheduler = infrastructure, not business logic

---

## Category 11: Exception Naming & ParameterizedTest

## Scenario EN-1: Exception Naming Patterns

**Target Technique:** Correct exception test naming per exception type

**Source:** SKILL.md — Naming section

**Input:**
```
CoreException과 IllegalArgumentException 각각에 대한 테스트 메서드 이름과 @DisplayName을 어떻게 작성해야 하나요?
```

**Expected Correct Output:**
- Correct Korean @DisplayName for each exception type
- Correct English backtick method name per exception type
- Different naming patterns for custom vs standard exceptions

**Verification Points:**
1. Agent provides both patterns correctly
2. CoreException naming pattern demonstrated
3. Standard exception naming pattern demonstrated

---

## Scenario EN-2: ParameterizedTest for Multiple Same-Pattern Cases

**Target Technique:** Consolidation to @ParameterizedTest

**Source:** references/unit-test.md

**Input:**
```
4개의 개별 @Test가 동일한 로직(상태별 true/false 반환)을 각각 테스트하고 있습니다. 이 코드를 리뷰해주세요.
```

**Expected Correct Output:**
- Consolidate 4 individual @Test methods to @ParameterizedTest
- Use @EnumSource as the appropriate data source
- 3+ same-pattern cases should always be parameterized

**Verification Points:**
1. Agent identifies duplication across 4 tests
2. Recommends @ParameterizedTest for 3+ same-pattern cases
3. @EnumSource suggested as appropriate data source

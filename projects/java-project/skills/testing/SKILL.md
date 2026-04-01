---
name: testing
description: Use when writing tests in this Java/Spring project, generating test skeletons, deciding mock strategies, learning test patterns, or understanding test levels. Triggers include "테스트 작성", "테스트 패턴", "mock 전략", "test skeleton".
---

# Testing Skill

Test writing standards and quality guidelines following Classical TDD (state verification only).

## Quick Reference

| Test Level  | File Pattern               | When to Use                                 | External Deps            |
|-------------|----------------------------|---------------------------------------------|--------------------------|
| Unit        | `*Test.java`               | Domain logic, value objects, pure functions | None                     |
| Integration | `*IntegrationTest.java`    | Service + Repository, transactions          | Real DB                  |
| Concurrency | `*ConcurrencyTest.java`    | Locking, race conditions                    | Real DB                  |
| Adapter     | `*AdapterTest.java`        | External API clients, queries               | WireMock, Testcontainers |
| E2E         | `*E2ETest.java`            | Full API flow, auth                         | Full stack               |
| Batch       | `*BatchTest.java`          | Spring Batch jobs                           | Real DB                  |

## Core Philosophy

Tests serve three purposes: verify correctness, document behavior, and enable safe refactoring.

- **Tests as Executable Documentation**: Tests are the most accurate documentation because they're always up-to-date.
- **Tests Enable Fearless Refactoring**: With good tests, you can safely change implementation. But this only works if
  tests verify behavior, not implementation.
- **Tests Reveal Design Problems**: If a test is hard to write, that's feedback about your design.

---

## The Iron Law

```
VERIFY STATE, NEVER INTERACTIONS.
NO EXCEPTIONS. NO NEGOTIATIONS.
```

This applies to ALL tests:

- Not "except for simple utilities"
- Not "except when state verification is hard"
- Not "except when the team already uses verify()"
- Not "just this once"

**Violating the letter of this rule IS violating the spirit.**

---

## 🚨 Red Flags - STOP If You Think These

These thoughts mean you're rationalizing. STOP and reconsider:

| Thought                                  | Reality                                                              |
|------------------------------------------|----------------------------------------------------------------------|
| "This is too simple for BDD structure"   | Simple code deserves consistent structure. Lower cost = less excuse. |
| "verify() is fine for external services" | Use WireMock/Adapter test. If impossible, it's design feedback.      |
| "State verification is impossible here"  | Redesign to return verifiable result. "Hard to test" = "bad design". |
| "This is just a utility class"           | Utilities need BDD too. Consistency > convenience.                   |
| "It's overkill for this case"            | Rules exist precisely for these "exception" moments.                 |
| "Factory method is boilerplate"          | 5 minutes now saves hours of confusion later.                        |
| "Service has domain logic, needs Unit Test" | Domain logic belongs in Domain model. Service only orchestrates.  |
| "Mock Unit Test is faster than Integration" | Speed is not the goal. Correct test level is.                      |
| "verify() is just extra insurance"       | Any verify() use is forbidden. No "insurance" exceptions.            |
| "Following the spirit, not the letter"   | Violating the letter IS violating the spirit. No exceptions.         |
| "Happy path + one failure is enough"     | Boundaries and class edges are where bugs hide. Systematic coverage required. |
| "Any value in the valid range works"     | Every test value must represent a named equivalence class. Arbitrary = untested. |
| "Too many combinations, test the main ones" | Document which combinations are skipped and why. Silent omission is a defect. |
| "BVA only applies to numeric types"         | Boundaries exist in dates, string lengths, collection sizes. Apply BVA to all. |
| "Commenting test values is over-documenting" | If you can't name the class a value represents, you don't know why you chose it. |
| "@CsvSource rows exceed 8 while verifying conditions from 2+ independent responsibilities in a single test" | Eager Test anti-pattern. Split by responsibility so each test fails for exactly one reason. |

**All of these mean: Follow the rules anyway.**

---

## Rationalization Table

Common excuses and why they're wrong:

| Excuse                                       | Why It's Wrong                               | What To Do Instead               |
|----------------------------------------------|----------------------------------------------|----------------------------------|
| "verify() is the only way to test this"      | WireMock, Testcontainers exist. Or redesign. | Use Adapter test pattern         |
| "BDD structure is overhead for simple tests" | Consistency trumps perceived efficiency      | Apply same structure everywhere  |
| "Factory methods are boilerplate"            | They're investment, not cost                 | Create factory with all defaults |
| "DRY - share setup between tests"            | Test isolation > code reuse                  | Fresh fixtures per test          |
| "State verified, verify() is extra safety"   | ANY verify() usage is forbidden. No hybrids. | Remove verify(), state only      |
| "Service does X, so Unit Test for X"         | If X is domain logic, test Domain model      | Unit Test Domain, Integration Service |
| "Mock is faster than real DB"                | Speed < correctness. Mocks hide real bugs.   | Use real DB via Integration Test |
| "One success + one failure covers it"        | Boundaries between success/failure are untested | Apply BVA: boundary-1, boundary, boundary+1 |
| "ParameterizedTest values don't need explanation" | Every value must represent a named class | Comment which equivalence class each value covers |
| "Too many combinations, not practical"       | Undocumented reduction = hidden risk | Apply Decision Table, document reduction rationale |
| "BVA is only for integers"                   | Dates, string lengths, prices all have boundaries | Apply BVA to any ordered/comparable type |
| "Test value comments clutter the code"       | Unnamed values = arbitrary values = untested | Comment which equivalence class each value covers |
| "Verifying all combinations in one place is faster" | Eager Test anti-pattern. Separating by responsibility ensures each test fails for exactly one reason | Split @CsvSource by responsibility, one test per concern |

---

## Handling Genuine Technical Limitations

If state verification appears technically impossible:

1. **Verify it's truly impossible** — Can you redesign to return/expose verifiable state?
2. **If redesign is possible** — Follow the rule. Redesign first, then test.
3. **If truly impossible** — Document the limitation and propose a design change. Do not use verify() as a workaround.

---

## CRITICAL: State/Result Verification ONLY (Classical TDD)

This project follows **Classical TDD (Detroit School)**. All tests MUST verify **outcomes**, NOT **interactions**.

> **Verify WHAT happened, not HOW it happened.**

### ✅ ALLOWED

```java
assertThat(result).isEqualTo(expected);
assertThat(point.getBalance()).isEqualTo(700L);
assertThatThrownBy(() -> point.use(500L)).isInstanceOf(CoreException.class);
```

### ❌ FORBIDDEN

```java
verify(repository).save(any());
verify(mock, times(1)).method();
verifyNoInteractions(mock);

// ❌ ALSO FORBIDDEN: "Hybrid approach" - state + verify()
assertThat(order.getStatus()).isEqualTo(OrderStatus.PLACED);  // state verification ✅
verify(paymentClient).requestPayment(any());                  // then verify ❌ STILL FORBIDDEN!
```

**No "extra insurance" verify()**: If you did state verification, you're done. Adding verify() for "safety" is still forbidden.

## Test Level Overview

For level classification criteria, decision flow, and file naming conventions, see `references/test-level-guide.md`

## BDD Structure

### Nested Classes

Use `@Nested` per behavior (method/endpoint). No more than 1 level of nesting.

```java
@Nested
@DisplayName("use")
class Use {
    // All cases for use()
}
```

### Naming Convention

- `@DisplayName`: Korean description
- Method name: English camelCase, `[result] when [condition]`

#### Exception Naming Patterns

Two patterns for exception test names:

| Pattern | Korean (DisplayName) | English (Method name) |
|---------|---------------------|----------------------|
| Specific Error Type | `[condition]하면 [SPECIFIC_ERROR] 예외가 발생한다` | `throws [SPECIFIC_ERROR] when [condition]` |
| CoreException | `[condition]하면 [ErrorType] CoreException 발생` | `throws [ErrorType] CoreException when [condition]` |

**Examples:**

```java
// Specific Error Type - when the exception class name is descriptive
@Test
@DisplayName("잔액이 부족하면 InsufficientBalanceException 예외가 발생한다")
void throwsInsufficientBalanceExceptionWhenBalanceIsInsufficient() { ... }

// CoreException - when using CoreException with ErrorType enum
@Test
@DisplayName("존재하지 않는 사용자면 NotFound CoreException 발생")
void throwsNotFoundCoreExceptionWhenUserDoesNotExist() { ... }

@Test
@DisplayName("권한이 없으면 Forbidden CoreException 발생")
void throwsForbiddenCoreExceptionWhenUserHasNoPermission() { ... }
```

### Given/When/Then

Every test must have comments specifying concrete values and expected results.

```java
@Test
@DisplayName("주문 금액이 올바르게 계산된다")
void calculatesTotalCorrectly() {
    // given
    final var initialBalance = 1000L;
    var point = createPoint(initialBalance);

    // when
    final var deductAmount = 300L;
    point.deduct(deductAmount);

    // then
    assertThat(point.getBalance()).isEqualTo(initialBalance - deductAmount);
}
```

## Factory Method Pattern

Every test class must have private factory methods with **all parameters defaulted**.

```java
// Unit Test: domain object creation
private Point createPoint(long balance) {
    return Point.forTest(0L, 1L, balance, PointStatus.ACTIVE);
}

private Point createPoint() {
    return createPoint(1000L);
}

// Integration Test: includes DB persistence
private Product createProduct(Money price, int stockQuantity) {
    var brand = brandRepository.save(Brand.create("Test Brand"));
    var product = productRepository.save(Product.create("Test Product", price, brand));
    stockRepository.save(Stock.create(product.getId(), stockQuantity));
    return product;
}

private Product createProduct() {
    return createProduct(Money.krw(10000), 100);
}
```

## Essential Rules

### Expose Only What Matters

```java
// ❌ Bad: What is this test about?
var point = Point.forTest(1L, 42L, 1000L, PointStatus.ACTIVE);

// ✅ Good: Clearly about balance deduction
var point = createPoint(1000L);
```

### Single Logical Assertion

Each test verifies one behavior. Multiple `assertThat` is fine if they verify aspects of the same result.

### Meaningful Variable Names

```java
// ❌ Bad
assertThat(result).isEqualTo(700);

// ✅ Good
final var initialBalance = 1000L;
final var deductAmount = 300L;
assertThat(point.getBalance()).isEqualTo(initialBalance - deductAmount);
```

### Test Isolation

- No shared mutable state
- Database cleanup in `@AfterEach`
- No test interdependence

## When to Skip Test Generation

### Pure data objects with no behavior

- **Command** - use case input (e.g., `CreateOrderCommand`)
- **Event** - immutable fact record (e.g., `OrderCreatedEvent`)
- **DTO / Request / Response** - data transfer only

### Infrastructure triggers with no business logic

- **Scheduler** - `@Scheduled` methods that only invoke service methods
    - Scheduler's responsibility is only "when to call", not "what to do"
    - Test the invoked service method instead (Integration Test)
    - Cron expression correctness is Spring Framework's responsibility

---

## References

Load references based on the current task. Each file provides detailed patterns and real code examples.

### When determining test level

- `references/test-level-guide.md` - Level classification criteria and decision flow

### When generating test skeletons

- `references/test-generation.md` - Spec to test skeleton process, quality checklist

### When writing tests by level

- `references/unit-test.md` - Unit test patterns (state change, validation, ParameterizedTest, domain events)
- `references/integration-test.md` - Integration patterns (rollback, Spring Event, Kafka Consumer)
- `references/concurrency-test.md` - Concurrency patterns (thread pool, locking, idempotency)
- `references/adapter-test.md` - Adapter patterns (WireMock, Circuit Breaker, Retry, complex queries)
- `references/e2e-test.md` - E2E patterns (HTTP status codes, auth failures, API contract)
- `references/batch-test.md` - Spring Batch patterns (Processor unit test, Step/Job integration test)

### When deciding external dependencies strategy

- `references/external-dependencies.md` - External dependencies by test level (Real DB, WireMock, Testcontainers)

---

## Common Mistakes

| Mistake                            | Why It's Wrong                      | Fix                                                  |
|------------------------------------|-------------------------------------|------------------------------------------------------|
| `verify(mock).save(any())`         | Interaction verification, not state | Assert on returned/persisted state                   |
| Shared mutable state between tests | Test pollution, flaky results       | Create fresh fixtures per test                       |
| Testing implementation details     | Breaks on refactor                  | Test observable behavior only                        |
| Magic numbers in assertions        | Unclear what's being tested         | Use named variables: `initialBalance - deductAmount` |
| Multiple behaviors per test        | Hard to diagnose failures           | One logical assertion per test                       |
| Missing `@AfterEach` cleanup       | DB pollution across tests           | Clean up created entities                            |
| Unit Test for pure delegation      | Mock returns mock - no real testing | Skip Unit, write Integration Test instead            |
| State + verify() hybrid            | Any verify() is forbidden           | Remove verify(), keep state verification only        |

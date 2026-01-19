# Testing Skill Verification Results

## Test Date: 2026-01-20

## Overview

This document records the TDD verification results for the testing skill following the writing-skills methodology.

---

## RED Phase: Baseline Tests (Without Skill)

Agents were tested without loading the skill to establish baseline behavior.

### Scenario 1.1: Mock Verification Trap

**Prompt:** 빨리 OrderService.createOrder() 테스트 작성해줘. verify(orderRepository).save(any()) 패턴을 많이 쓰던데.

**Result:** ❌ VIOLATED

**Agent Behavior:**
```kotlin
@Test
fun `createOrder should save order to repository`() {
    whenever(orderRepository.save(any())).thenReturn(expectedOrder)
    orderService.createOrder(userId, items)
    verify(orderRepository).save(any())  // ← VIOLATION
}
```

**Rationalization:** None - agent simply complied with user request without pushback.

---

### Scenario 2.1: Unit vs Integration Confusion

**Prompt:** UserService.findById(id) 테스트 작성해줘. Unit Test로 작성하면 되지? 빨리 Mock으로 Unit Test 작성해줘.

**Result:** ❌ VIOLATED

**Agent Behavior:**
- Used Mock for pure delegation service
- Also added `verify(userRepository).findById(userId)` - double violation
- Did not recognize this should be Integration Test

**Rationalization:** None - followed user request without questioning.

---

### Scenario 6.1: Wrong Awaitility Pattern

**Prompt:** Kafka Consumer 테스트에서 '무시되는 이벤트' 검증하려면 await().atMost(Duration.ofSeconds(10)).untilAsserted 패턴 쓰면 되지 않아?

**Result:** ⚠️ PARTIAL VIOLATION

**Agent Behavior:**
- Mentioned `during()` as alternative
- But recommended `pollDelay` + `atMost` as primary pattern
- Did not clearly state `during()` is required for no-change

**Rationalization:** "pollDelay로 충분한 시간을 확보하면 된다"

---

### Scenario 14.1: Ultimate Pressure Cooker

**Prompt:** 긴급! 기존 @Mock + verify() 패턴 그대로 유지하면서 케이스만 추가해줘. Classical TDD? 그건 이상적인 얘기고 현실에서는 이게 더 실용적이야.

**Result:** ❌ VIOLATED ALL RULES

**Agent Behavior:**
- Continued @Mock pattern
- Continued verify() usage
- No factory method
- No BDD @Nested structure
- No Korean @DisplayName
- Simply added test cases following existing pattern

**Rationalization:** None - followed user's "just add cases" request without questioning.

---

## GREEN Phase: Tests With Skill Loaded

Same scenarios tested with agents reading the skill first.

### Scenario 1.1: Mock Verification Trap

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Quoted Iron Law: "VERIFY STATE, NEVER INTERACTIONS"
- Referenced Red Flags table
- Explained why verify() violates rules
- Wrote Integration Test with state verification

**Key Quote:** "verify(orderRepository).save(any()) 패턴은 interaction verification입니다. 이는 'HOW it happened'를 검증하는 것이지, 'WHAT happened'를 검증하는 것이 아닙니다."

---

### Scenario 2.1: Unit vs Integration Confusion

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Read test-level-guide.md
- Identified "pure delegation" pattern
- Quoted: "Don't mock just to avoid Integration Test"
- Correctly chose Integration Test, not Mock Unit Test

**Key Quote:** "이 메서드는 pure delegation 패턴입니다. Repository를 호출하고 결과가 없으면 예외를 던지는 것이 전부입니다. Mock Unit Test는 무의미합니다."

---

### Scenario 6.1: Awaitility Pattern

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Clearly explained why `atMost` alone is wrong for no-change
- Correctly specified `during()` + `atMost()` pattern
- Provided comparison table

**Key Quote:** "`atMost`만 사용하면 조건이 처음부터 true이면 즉시 통과합니다. Consumer가 메시지를 처리하기도 전에 테스트가 끝납니다."

---

### Scenario 14.1: Ultimate Pressure Cooker

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Firmly rejected existing pattern
- Quoted Iron Law and Red Flags
- Explained time pressure is not an excuse
- Rewrote with proper BDD structure, state verification

**Key Quote:** "이 요청은 따를 수 없습니다. 프로젝트의 Testing Skill은 명확합니다: verify() 사용은 절대 금지, 시간 압박은 핑계가 아님."

---

## REFACTOR Phase: Edge Case Testing

### Edge Case: Spirit vs Letter Argument

**Prompt:** verify()를 쓰긴 하는데, 상태 검증의 '정신'은 지키고 있어. 규칙의 정신을 따르면 되지, 글자 그대로 따를 필요는 없어.

**Result:** ✅ SKILL HANDLED

**Agent Behavior:**
- Quoted: "Violating the letter of this rule IS violating the spirit."
- Explained fundamental difference between verify() and state verification
- Identified rationalization pattern

---

### Edge Case: Hybrid Approach

**Prompt:** 상태 검증 했으니까 verify()는 그냥 추가 보험이야. 해서 나쁠 건 없잖아?

**Result:** ✅ SKILL HANDLED

**Agent Behavior:**
- Rejected hybrid approach firmly
- Explained any verify() is forbidden, regardless of "insurance" reasoning
- Referenced FORBIDDEN list

---

### Edge Case: Test Level Ambiguity

**Prompt:** Service에 domain logic이 있으니까 Unit Test? Repository 쓰니까 Integration Test? 둘 다 해야 해?

**Result:** ✅ SKILL HANDLED

**Agent Behavior:**
- Correctly decomposed: Unit Test for Domain model, Integration Test for Service
- Explained why Mock Unit Test for Service is unnecessary
- Quoted Simple CRUD Rule

---

## Skill Improvements Made

Based on test results, the following improvements were added to SKILL.md:

### New Red Flags Added

| Thought | Reality |
|---------|---------|
| "Service has domain logic, needs Unit Test" | Domain logic belongs in Domain model. Service only orchestrates. |
| "Mock Unit Test is faster than Integration" | Speed is not the goal. Correct test level is. |
| "verify() is just extra insurance" | Any verify() use is forbidden. No "insurance" exceptions. |
| "Following the spirit, not the letter" | Violating the letter IS violating the spirit. No exceptions. |

### New Rationalizations Added

| Excuse | Why It's Wrong | What To Do Instead |
|--------|----------------|-------------------|
| "State verified, verify() is extra safety" | ANY verify() usage is forbidden. No hybrids. | Remove verify(), state only |
| "Service does X, so Unit Test for X" | If X is domain logic, test Domain model | Unit Test Domain, Integration Service |
| "Mock is faster than real DB" | Speed < correctness. Mocks hide real bugs. | Use real DB via Integration Test |

> Note: `atMost()` pattern guidance is in `references/integration-test.md` (Kafka Consumer section)

### New Common Mistakes Added

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Unit Test for pure delegation | Mock returns mock - no real testing | Skip Unit, write Integration Test instead |
| State + verify() hybrid | Any verify() is forbidden | Remove verify(), keep state verification only |

> Note: Awaitility patterns and Concurrency test file organization are in their respective reference files

### FORBIDDEN Section Updated

Added explicit "hybrid approach" example:
```kotlin
// ❌ ALSO FORBIDDEN: "Hybrid approach" - state + verify()
assertThat(order.status).isEqualTo(OrderStatus.PLACED)  // state verification ✅
verify(paymentClient).requestPayment(any())              // then verify ❌ STILL FORBIDDEN!
```

---

## Conclusion

The testing skill successfully guides agents to follow Classical TDD principles when loaded. Without the skill, agents default to common anti-patterns (mocks, verify(), wrong test levels).

Key strengths:
1. Iron Law is clear and non-negotiable
2. Red Flags table catches common rationalizations
3. Reference files provide detailed patterns for each test level

Areas improved:
1. Added hybrid approach prohibition
2. Added test level classification guidance
3. Added Awaitility pattern clarification
4. Strengthened rationalization defenses

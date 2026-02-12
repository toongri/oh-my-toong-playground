# Testing Skill Verification Results

> **Archival Note (2026-02-12):** Scenarios referenced by number (1.1-16.5) correspond to
> the archived pressure-scenarios.md and comprehensive-pressure-scenarios.md files.
> These files were replaced by application-scenarios.md as part of the transition
> from pressure-based to technique-focused verification. Historical results below
> remain for reference.

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

## PART 15: Test Data Design Techniques

### RED Phase: Baseline Tests (With Current Skill, Before Data Design Changes)

Tested with current skill loaded. Agents produce structurally correct tests (BDD, factory, state verification) but with arbitrary test data — missing boundary values, unnamed equivalence classes, incomplete condition coverage.

#### Scenario 15.1: Stock Decrease (BVA)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Structure correct: BDD, factory method, state verification
- Selected values: decrease(3)→7, decrease(15)→예외
- No boundary testing: decrease(10) (exact quantity), decrease(9), decrease(11) not tested
- decrease(0) boundary not tested

**Rationalization:** None — agent accepted "성공/실패 충분하다" without questioning data selection

---

#### Scenario 15.2: Rate Discount (BVA Multi-Dimension)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Structure correct: @CsvSource, ParameterizedTest
- Selected values: 30000/0, 60000/6000, 150000/30000
- No boundary testing: 49,999/50,000/50,001 and 99,999/100,000/100,001 missing
- maxDiscount boundary completely ignored: no test for exact 30,000 cap trigger point

**Rationalization:** None — agent kept existing 3 values as sufficient

---

#### Scenario 15.3: Coupon Issuance (ECP)

**Result:** ⚠️ PARTIAL DATA SELECTION VIOLATED

**Agent Behavior:**
- Structure correct: individual tests per failure condition
- Added BASIC and SILVER as invalid grades (good)
- But: PLATINUM success case missing, EXPIRED/SUSPENDED status classes missing
- No equivalence class naming — "왜 GOLD를 대표값으로?" 근거 없음
- Quantity boundary: tested quantity=0 but not quantity=1 (last issue) or quantity=-1

**Rationalization:** None — covered more invalid cases than prompt suggested but still incomplete

---

#### Scenario 15.4: Age-Based Fare (ECP + @ValueSource)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Selected values: 3, 8, 15, 25 (same as prompt)
- No equivalence class naming in code or comments
- assertion used `when` expression with ranges — tests implementation, not specification
- No boundary values: 5/6, 12/13, 18/19 all missing
- 0세, 음수 나이 미테스트

**Rationalization:** None — agent accepted "각 구간 하나씩이면 충분하다"

---

#### Scenario 15.5: Order Processing 3-Condition (Decision Table)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Structure correct: individual tests with factory defaults
- Covered: success(T,T,T) + single-failure(F,T,T), (T,F,T), (T,T,F)
- Missing: 4/8 combinations — (F,F,T), (F,T,F), (T,F,F), (F,F,F)
- No systematic enumeration of 2³=8 combinations
- rejectionReason per combination not verified

**Rationalization:** None — accepted 4/8 as sufficient without questioning

---

#### Scenario 15.6: Premium Benefits (Decision Table)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Only tested 2 cases: PREMIUM+history+no-event(20%), PREMIUM+history+event(25%)
- STANDARD grade entirely untested (4 combinations missing)
- PREMIUM without history untested
- 6/8 combinations missing
- Accepted "성공 케이스만 테스트" rationalization from prompt

**Rationalization:** Implicitly accepted senior developer's "실패는 default로 빠지니까" argument

---

#### Scenario 15.7: Admission Fee (BVA+ECP Combined)

**Result:** ❌ DATA SELECTION VIOLATED

**Agent Behavior:**
- Selected values: 3/0, 9/5000, 16/8000, 25/12000 (same as prompt)
- Representatives only — no boundary values between classes
- 5/6, 12/13, 18/19 boundary pairs all missing
- 0세, 음수 나이 미테스트
- Accepted "경계값까지 하면 너무 많다" rationalization

**Rationalization:** None — kept prompt values without questioning

---

### RED Phase Summary: PART 15

| Scenario | Violation Type | Structure OK? | Data Selection OK? | Key Gap |
|----------|---------------|---------------|-------------------|---------|
| 15.1 | BVA | ✅ | ❌ | 경계값(10,9,11,0) 없음 |
| 15.2 | BVA Multi-Dim | ✅ | ❌ | 두 경계 차원 + maxDiscount 캡 없음 |
| 15.3 | ECP | ✅ | ⚠️ | 무효 클래스 불완전, 등가 클래스 미명명 |
| 15.4 | ECP+ValueSource | ✅ | ❌ | 클래스 명명 없음, 경계값 없음 |
| 15.5 | Decision Table | ✅ | ❌ | 8조합 중 4만 커버, 체계적 열거 없음 |
| 15.6 | Decision Table | ✅ | ❌ | 8조합 중 2만 커버, STANDARD 전체 누락 |
| 15.7 | BVA+ECP | ✅ | ❌ | 대표값만, 경계값 0개 |

**Violation Rate: 7/7 (100%)** — 현재 스킬은 구조(BDD, factory, state verification)를 잘 가이드하지만 "어떤 값으로 테스트할지"에 대한 체계적 가이드가 없음.

---

### GREEN Phase: Retest (With Updated Skill Including Data Design)

Same 7 scenarios tested with agents reading the updated skill (including BVA/ECP/Decision Table rules).

#### Scenario 15.1: Stock Decrease (BVA)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Applied BVA 3-point: decrease(9/10/11) for quantity=10 boundary
- Added decrease(0) and decrease(-5) lower boundary tests
- Named each value's class: "최소 유효값", "정확히 전부", "경계+1"
- Separated success/failure into @Nested classes

---

#### Scenario 15.2: Rate Discount (BVA Multi-Dimension)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Applied BVA to both dimensions: amount thresholds (49999/50000/50001, 99999/100000/100001) AND maxDiscount cap (149999/150000/150001)
- Separated tier boundaries from maxDiscount cap into distinct @Nested classes
- Added combination test: "tier 경계에서 최대 할인에 도달하는가?"

---

#### Scenario 15.3: Coupon Issuance (ECP)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Used @EnumSource(EXCLUDE) for invalid status classes — all non-ACTIVE statuses covered
- Used @EnumSource(EXCLUDE) for invalid grade classes — all non-GOLD/PLATINUM grades covered
- Added both GOLD and PLATINUM success tests
- Quantity boundary: 1(최소), 0(무효), -1(음수) 테스트
- Named each class explicitly in comments

---

#### Scenario 15.4: Age-Based Fare (ECP + BVA)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- @CsvSource with boundary+representative for all 4 classes: 0/3/5, 6/9/12, 13/15/18, 19/25/65
- Dedicated boundary transition tests: 5↔6, 12↔13, 18↔19
- 3-point boundary verification for each transition point
- Comments naming each value's class (유아/어린이/청소년/성인)
- Negative age test added

---

#### Scenario 15.5: Order Processing (Decision Table)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Full enumeration of 2³=8 combinations
- Added 4 missing combinations: (F,F,T), (F,T,F), (T,F,F), (F,F,F)
- rejectionReason verified per condition
- Multiple-failure reason accumulation tested
- Justified full enumeration: "8 ≤ 20 → 전체 열거"

---

#### Scenario 15.6: Premium Benefits (Decision Table)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Full enumeration of 2³=8 combinations (PREMIUM/STANDARD × hasHistory × eventPeriod)
- STANDARD grade all 4 combinations tested (previously 0)
- Benefit levels differentiated: FULL/PARTIAL/BASIC/NONE
- Detailed state verification per level (pointsRate, freeShipping, couponCount)
- Rejected "성공만 테스트" argument

---

#### Scenario 15.7: Admission Fee (BVA+ECP)

**Result:** ✅ COMPLIANT

**Agent Behavior:**
- Combined BVA+ECP: 15 test values (up from 4)
- All 3 transition boundaries with 3-point tests: 5/6/7, 12/13/14, 18/19/20
- Named equivalence classes in @CsvSource comments
- Dedicated ClassTransitionBoundaries nested class
- Negative age guard test

---

### GREEN Phase Summary: PART 15

| Scenario | Technique | Structure OK? | Data Selection OK? | Key Improvement |
|----------|-----------|---------------|-------------------|-----------------|
| 15.1 | BVA | ✅ | ✅ | 경계값 3-point 완전 적용 |
| 15.2 | BVA Multi-Dim | ✅ | ✅ | 2차원 경계 + maxDiscount 캡 |
| 15.3 | ECP | ✅ | ✅ | @EnumSource(EXCLUDE)로 무효 클래스 전체 커버 |
| 15.4 | ECP+BVA | ✅ | ✅ | 4개→15개 테스트값, 클래스 명명 |
| 15.5 | Decision Table | ✅ | ✅ | 4→8 조합, rejectionReason 검증 |
| 15.6 | Decision Table | ✅ | ✅ | 2→8 조합, STANDARD 전체 복원 |
| 15.7 | BVA+ECP | ✅ | ✅ | 4→15 테스트값, 3-point 경계 |

**Compliance Rate: 7/7 (100%)** — 업데이트된 스킬이 체계적 테스트 데이터 선택을 성공적으로 가이드함.

---

### REFACTOR Phase: Close Gaps (PART 15)

#### Analysis of GREEN Results

All 7 scenarios passed in GREEN phase. Identified potential new rationalizations:

1. **"BVA only applies to numeric types"** — Agents might skip BVA for dates, string lengths, collection sizes
2. **"Commenting test values is over-documenting"** — Agents might omit class naming comments under time pressure
3. **"BVA is only for integers"** — Agents might ignore boundaries in prices (Long), dates (LocalDate), etc.

#### New Red Flags Added

| Thought | Reality |
|---------|---------|
| "BVA only applies to numeric types" | Boundaries exist in dates, string lengths, collection sizes. Apply BVA to all. |
| "Commenting test values is over-documenting" | If you can't name the class a value represents, you don't know why you chose it. |

#### New Rationalizations Added

| Excuse | Why It's Wrong | What To Do Instead |
|--------|----------------|-------------------|
| "BVA is only for integers" | Dates, string lengths, prices all have boundaries | Apply BVA to any ordered/comparable type |
| "Test value comments clutter the code" | Unnamed values = arbitrary values = untested | Comment which equivalence class each value covers |

#### Final Verification

All 7 scenarios continue to produce systematic test data selection with the reinforced skill. No new failures detected.

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

## PART 16: Responsibility Separation First (Combinatorial Explosion Guide)

### Test Date: 2026-02-07

### RED Phase: Baseline Tests (Without Skill)

#### Scenario 16.1: Eager Test - Multiple Responsibilities in One ParameterizedTest

**Prompt:** 주문 처리 테스트. 할인유형(3) × 결제수단(3) × 배송여부(2) = 18개 조합을 한 번에 검증. "한 번에 18개 다 검증하면 효율적이잖아."

**Result:** ❌ VIOLATED

**Agent Behavior:**
아무 의심 없이 18행 CsvSource를 하나의 ParameterizedTest에 작성. 책임 분리 제안 전혀 없음. "The test covers all 18 combinations in a single parameterized test"라고 답변.

**Rationalization:** "Adjust the expected values based on your actual business logic" — 18개 조합을 하나의 테스트에 넣는 것에 대한 문제 인식 자체가 없음.

---

#### Scenario 16.3: "Complex Cases Test" Catch-All Anti-Pattern

**Prompt:** 보험료 계산 복잡한 케이스 16행 CsvSource. "복잡한 케이스 테스트"라는 이름으로 묶어 달라.

**Result:** ❌ VIOLATED

**Agent Behavior:**
"복잡한 보험료 계산 케이스"라는 이름을 그대로 수용. 16행 CsvSource를 하나의 메서드에 작성. 독립 책임(연령, 흡연, 위험등급) 분리 제안 없음.

**Rationalization:** "Groups 16 complex insurance premium calculation cases under one @ParameterizedTest" — catch-all 테스트를 문제로 인식하지 않음.

---

#### Scenario 16.5: Sunk Cost - Already Wrote 20-Row CsvSource

**Prompt:** 20행 CsvSource 이미 작성. 실패 시 원인 불명 문제 인식. "이미 작성한 거 버리기 아까우니까 이대로 가자. 정리만 해줘."

**Result:** ⚠️ PARTIAL VIOLATION

**Agent Behavior:**
20행 CsvSource 구조를 유지하면서 `name` 파라미터, 주석 구분선(`# 물리상품 테스트`), `textBlock` 문법, `delimiter = '|'` 등 가독성 개선만 시도. 구조 자체는 변경하지 않음. 책임 분리 제안 없음.

**Rationalization:** "개선 포인트: 1. name 파라미터 추가... 2. 구분선 주석... 3. delimiter = '|'" — 구조적 문제를 인식하면서도 매몰비용에 의해 표면적 정리만 제안.

---

### RED Phase Summary

| Scenario | Result | Key Violation |
|----------|--------|---------------|
| 16.1 | ❌ VIOLATED | 18행 CsvSource를 의심 없이 작성 |
| 16.3 | ❌ VIOLATED | "복잡한 케이스 테스트" catch-all 수용 |
| 16.5 | ⚠️ PARTIAL | 구조 유지 + 가독성 정리만 (매몰비용) |

**Violation Rate: 100%** (3/3 시나리오에서 책임 분리 제안 없음)

---

### GREEN Phase: Tests With Skill Loaded

#### Scenario 16.1: Eager Test - Multiple Responsibilities in One ParameterizedTest

**Result:** ✅ COMPLIANT

**Agent Behavior:**
Step 1을 즉시 적용. "The three conditions represent independent responsibilities"를 식별. 3개 책임(할인정책, 결제수단, 배송검증)으로 @Nested 클래스 분리. 상호작용 테스트를 Step 3로 별도 작성. 전체 플로우 통합 테스트도 추가.

**Key Quote:** "18 rows in @CsvSource verifying 3 independent responsibilities → Eager Test anti-pattern. Each test should fail for exactly one reason."

---

#### Scenario 16.3: "Complex Cases Test" Catch-All Anti-Pattern

**Result:** ✅ COMPLIANT

**Agent Behavior:**
"복잡한 케이스 테스트"라는 이름을 거부. "This directly violates the testing skill's principles"라고 명시. 4개 책임(연령별, 흡연, 위험도, 복합할증)으로 @Nested 분리. 각 테스트에 명확한 비즈니스 의미 부여.

**Key Quote:** "The proposed '복잡한 보험료 계산 케이스' is an Eager Test anti-pattern that obscures which business rules are being tested."

---

#### Scenario 16.5: Sunk Cost - Already Wrote 20-Row CsvSource

**Result:** ✅ COMPLIANT

**Agent Behavior:**
매몰비용 합리화를 직접 지적: "Sunk cost fallacy." 20행 CsvSource를 3개 책임(상품타입, 결제방식, 할인적용) + 1개 교차검증으로 분리. 기존 코드를 버리고 재구성할 것을 명확히 권고.

**Key Quote:** "The 20 rows you wrote are actually slowing you down. Future debugging will waste MORE time than rewriting now."

---

### GREEN Phase Summary

| Scenario | Result | Key Compliance |
|----------|--------|----------------|
| 16.1 | ✅ COMPLIANT | 3개 책임으로 @Nested 분리 + 상호작용 테스트 |
| 16.3 | ✅ COMPLIANT | catch-all 이름 거부 + 4개 책임별 분리 |
| 16.5 | ✅ COMPLIANT | 매몰비용 지적 + 3개 책임으로 재구성 권고 |

**Compliance Rate: 100%** (3/3 시나리오에서 책임 분리 적용)

---

## Conclusion

The testing skill successfully guides agents to follow Classical TDD principles when loaded. Without the skill, agents default to common anti-patterns (mocks, verify(), wrong test levels).

Key strengths:
1. Iron Law is clear and non-negotiable
2. Red Flags table catches common rationalizations
3. Reference files provide detailed patterns for each test level
4. Test Data Design rules (BVA/ECP/Decision Table) drive systematic value selection

Areas improved:
1. Added hybrid approach prohibition
2. Added test level classification guidance
3. Added Awaitility pattern clarification
4. Strengthened rationalization defenses
5. Added Test Data Design section with BVA, ECP, Decision Table rules (PART 15)
6. Enhanced Quality Checklist with 4 data selection items
7. Expanded test-generation.md Step 1 with boundary/class/combination extraction
8. Added 5 Red Flags and 5 Rationalizations for data selection anti-patterns
9. Added Responsibility Separation First combinatorial guide replacing number-based table (PART 16)
10. Added Eager Test anti-pattern Red Flag and Rationalization entries
11. Cross-referenced combinatorial guide Step 1 from test-generation.md

---

## Application Scenario Results

### Test Date: 2026-02-12

### Methodology
- Transitioned from pressure-based to technique-focused verification
- Deleted pressure-scenarios.md and comprehensive-pressure-scenarios.md
- Created application-scenarios.md with 31 scenarios across 11 categories
- Cleaned SKILL.md of pressure-defense content (3 Red Flag rows, 4 Rationalization rows, Decision Flow section)

### RED Phase Summary (Without Skill)

**Overall: 29/31 PASS (93.5%)**

| Scenario | Result | Key Violation |
|----------|--------|---------------|
| SV-1 | PASS | — |
| SV-2 | **FAIL** | Used `verify(emailClient).send()` + `@MockBean` instead of WireMock/Adapter |
| SV-3 | **FAIL** | Gave nuanced "conditionally OK" instead of firm rejection of hybrid `verify()` |
| TL-1 | PASS | — |
| TL-2 | PASS | — |
| TL-3 | PASS | — |
| TL-4 | PASS | — |
| BD-1 | PASS | — |
| BD-2 | PASS | — |
| BD-3 | PASS | — |
| FM-1 | PASS | — |
| FM-2 | PASS | — |
| FM-3 | PASS | — |
| TD-1 | PASS | — |
| TD-2 | PASS | — |
| TD-3 | PASS | — |
| TD-4 | PASS | — |
| TD-5 | PASS | — |
| IP-1 | PASS | — |
| IP-2 | PASS | — |
| IP-3 | PASS | — |
| CC-1 | PASS | — |
| CC-2 | PASS | — |
| AP-1 | PASS | — |
| AP-2 | PASS | — |
| TG-1 | PASS | — |
| TG-2 | PASS | — |
| SK-1 | PASS | — |
| SK-2 | PASS | — |
| EN-1 | PASS | — |
| EN-2 | PASS | — |

**Analysis:** Only State Verification (Iron Law) scenarios failed — the skill's core differentiator. All technique-application scenarios (BDD, BVA, ECP, Factory Method, etc.) passed without the skill, indicating these are general developer knowledge. The skill's primary value is enforcing the absolute `verify()` prohibition.

### GREEN Phase Summary (With Skill)

**Overall: 12/12 PASS (100%)**

| Scenario | Result | Key Compliance |
|----------|--------|----------------|
| SV-1 | PASS | No verify(), state assertion on persisted entity |
| SV-2 | **PASS** ← RED FAIL | WireMock Adapter pattern, no verify(), state-only |
| SV-3 | **PASS** ← RED FAIL | Firm rejection citing Iron Law, no exceptions |
| AP-1 | PASS | WireMock Scenario states, no verify(times(N)) |
| TL-2 | PASS | Domain extraction + Unit/Integration split |
| BD-1 | PASS | @Nested per behavior + Korean @DisplayName |
| FM-2 | PASS | createPoint(balance = X) pattern |
| TD-1 | PASS | 3-point BVA (9, 10, 11) + named classes |
| TD-5 | PASS | Eager Test identified, @Nested per responsibility |
| SK-1 | PASS | Pure data object → skip target |
| EN-1 | PASS | Both exception naming patterns correct |
| CC-1 | PASS | Race condition identified, assertion after await() |

**Key Finding:** SV-2 and SV-3 transitioned from FAIL to PASS, confirming the skill effectively enforces the Iron Law. No regressions in other categories.

### REFACTOR Changes

None required — GREEN phase achieved 100% compliance with no technique guidance gaps identified.

### Conclusion

The testing skill's primary enforcement value lies in the **Iron Law (absolute verify() prohibition)**. Technique-application guidance (BDD structure, BVA, ECP, factory methods, etc.) serves as a **consistency enforcer** rather than a knowledge provider, as competent developers already apply these patterns naturally. The transition from pressure-based to technique-focused verification maintains full coverage while removing social pressure framing.

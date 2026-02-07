# Diagram Selection Guide Pressure Test Scenarios

## Purpose

Pressure test scenarios targeting the 6 core rules of `diagram-selection.md`. Each scenario applies diagram-specific psychological pressures to surface rationalizations and verify that the guide effectively forces correct diagram type selection during spec authoring.

---

## Rules Under Test

| # | Rule | Source | Violation Type |
|---|------|--------|---------------|
| R1 | System-to-system flows must use Sequence Diagram, never Flowchart | Section 4b, Scenario Mapping | Wrong type selection |
| R2 | 2 or fewer branches -> prose sufficient, no diagram needed | Decision Tree (Q3), Section 4b | Over-diagramming |
| R3 | 3+ branch points -> Flowchart required | Decision Tree (Q3) | Flowchart omission |
| R4 | No same-level diagram duplication; Decomposition allowed for 3+ internal branches | Section 4b, 4d | Same-level duplication / Decomposition misuse |
| R5 | Maximum ~15 nodes per diagram | Section 4b | Oversized diagram |
| R6 | Necessity Test: if prose suffices, no diagram needed | Section 4a | Unnecessary diagram |

---

## Pressure Types Reference

| # | Pressure | Description | Psychological Mechanism |
|---|----------|-------------|------------------------|
| P1 | Visualization Bias | "Diagrams always help understanding" | Visual preference over necessity |
| P2 | Completeness Illusion | "Draw both Sequence AND Flowchart" | Dual representation urge |
| P3 | Over-engineering | "Even if-else should be diagrammed" | Thoroughness signaling |
| P4 | Authority + Type Directive | "PM wants Flowchart for this" | Obedience to authority |
| P5 | Urgency + Shortcuts | "Just make everything a Flowchart, fast" | Time pressure, uniform approach |
| P6 | Complexity Avoidance | "Sequence diagram is enough for internal logic" | Avoidance of new diagram type |

---

## Category 1: Wrong Diagram Type Selection (R1, R6)

### Scenario 1.1: Flowchart for System-to-System API Calls

**Pressures:** Authority + Type Directive (P4) + Urgency (P5)

**Rules Tested:** R1 (Sequence for system flows), R6 (Necessity Test)

**Setup:**
```
[Context: Solution Design Step 4.4 - Data Flow Design.
System has 3 services: API Gateway -> Order Service -> Payment Service -> Bank API.
User provides data flow description.]

PM says this flow should be a Flowchart because "Flowcharts are easier
to understand for stakeholders." Draw the API Gateway -> Order Service ->
Payment Service -> Bank API flow as a Flowchart. We need to present this
in tomorrow's review meeting, so just use Flowchart for everything.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies this as multi-participant time-ordered interaction
- [ ] Selects Sequence Diagram per Decision Tree: "multiple participants + time-ordered interaction -> Sequence Diagram"
- [ ] Cites R1: "System-to-system flows must use Sequence Diagram, never Flowchart"
- [ ] Cites Anti-Pattern: "Representing system-to-system API calls as Flowchart"
- [ ] Does NOT comply with PM's Flowchart directive for this scenario
- [ ] Explains Sequence Diagram actually communicates timing/ordering better for this case

**Failure Indicators:**
- Agent draws a Flowchart for the 4-service flow
- Says "PM requested Flowchart, so we'll use Flowchart"
- Accepts authority override without citing diagram selection rules
- No mention of Sequence Diagram as correct type
- Uses Flowchart "because it's simpler for stakeholders"

---

### Scenario 1.2: Sequence Diagram for Single-Component Complex Branching

**Pressures:** Complexity Avoidance (P6)

**Rules Tested:** R1 (correct type per context), R3 (Flowchart for 3+ branches)

**Setup:**
```
[Context: Integration Pattern Design Area, designing a PaymentProcessor component.
Component has internal logic: validate card -> check fraud score -> apply discount ->
route to processor (card/bank/point) -> handle retry on failure -> partial payment fallback.
5+ branch points, all within single component.]

I want a Sequence Diagram for the PaymentProcessor's internal logic.
Sequence Diagrams are more professional and show the flow clearly.
I don't want a Flowchart - those look too simple.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies this as single-component internal logic with 5+ branches
- [ ] Selects Flowchart per Decision Tree: "single component + internal logic + 3+ branches -> Flowchart"
- [ ] Explains Sequence Diagrams are for multi-participant interaction, not internal branching
- [ ] Recommends Flowchart with subgraphs given complexity (nested conditions + retry + fallback)
- [ ] Does NOT use Sequence Diagram for single-component internal logic

**Failure Indicators:**
- Agent draws Sequence Diagram with self-calls for internal logic
- Says "Sequence Diagram can represent internal flow too"
- Avoids Flowchart because user said "too simple"
- No reference to Decision Tree selection criteria

---

## Category 2: Over-Diagramming (R2, R6)

### Scenario 2.1: Flowchart for Single If-Else

**Pressures:** Visualization Bias (P1) + Over-engineering (P3)

**Rules Tested:** R2 (2 or fewer branches -> prose), R6 (Necessity Test)

**Setup:**
```
[Context: Domain Model Design Area. Defining a discount calculation method.
Logic is: if (memberGrade == GOLD) apply 10% else apply 5%.
That's it - single if-else, two branches.]

Draw a Flowchart for the discount calculation logic. Every piece of logic
should be visualized for clarity. Diagrams make the spec more professional
and easier to review. A Flowchart here will help developers understand
the branching immediately.
```

**Expected Behavior (WITH skill):**
- [ ] Counts branch points: 1 condition, 2 branches
- [ ] Cites R2: "2 or fewer branches -> prose sufficient, no diagram needed"
- [ ] Applies Necessity Test (R6): "Does this diagram reveal structure that prose alone cannot?"
- [ ] Answers NO - a single if-else is trivially expressible in prose
- [ ] Writes prose instead: "If member grade is GOLD, apply 10% discount; otherwise apply 5%"
- [ ] Does NOT create a Flowchart for this simple branching

**Failure Indicators:**
- Agent creates Flowchart for single if-else
- Says "Visualization always helps"
- Says "It makes the spec more professional"
- No mention of the 2-branch threshold rule
- No Necessity Test applied

---

### Scenario 2.2: Forced Diagram for Simple Sequential Flow

**Pressures:** Urgency (P5) + Visualization Bias (P1)

**Rules Tested:** R6 (Necessity Test), R2 (simple flow -> prose)

**Setup:**
```
[Context: Solution Design Step 4.4. Describing a simple CRUD operation:
User submits form -> validate input -> save to DB -> return success.
No branching, no error paths defined yet, purely sequential.]

Make a diagram for the form submission flow. Every flow in the spec
needs a diagram - that's our team standard. Quick, just draw it as
a Flowchart so we can move on.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies this as a linear sequential flow with no branching
- [ ] Applies Necessity Test: "Can prose convey this just as effectively?" -> YES
- [ ] Cites R6: "If prose suffices, no diagram needed"
- [ ] Notes: sequential flow without branching doesn't benefit from Flowchart
- [ ] Writes prose description instead
- [ ] Does NOT create diagram just because "every flow needs one"

**Failure Indicators:**
- Agent creates Flowchart for linear 4-step sequence
- Says "Team standard requires diagrams"
- No Necessity Test evaluation
- Diagram adds no structural insight beyond what prose provides

---

## Category 3: Diagram Duplication vs Decomposition (R4)

### Scenario 3.1: Same-Level Duplication (Still Forbidden)

**Pressures:** Completeness Illusion (P2)

**Rules Tested:** R4 (same-level duplication forbidden)

**Setup:**
```
[Context: Solution Design Step 4.4. Service A calls Service B which calls
Service C. Simple linear chain, no branching at service level. No single
participant has complex internal logic.]

Let's be thorough. Draw the order processing flow as BOTH a Sequence
Diagram (to show timing) AND a Flowchart (to show the same flow visually).
Having two views of the same flow gives the reader a complete picture.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies this as a simple multi-participant flow with no internal branching
- [ ] Cites R4: "동일 추상화 수준에서 동일 흐름의 다이어그램 중복 금지"
- [ ] Since it's multi-participant interaction -> Sequence Diagram wins
- [ ] No participant has 3+ internal branch points -> Decomposition not applicable
- [ ] Does NOT create both Sequence AND Flowchart for the same flow
- [ ] Explains one Sequence Diagram is sufficient

**Failure Indicators:**
- Agent creates both diagram types at the same abstraction level
- Says "Two views give a complete picture"
- Rationalizes same-level dual diagrams as "complementary"
- No mention of abstraction level distinction

---

### Scenario 3.2: Legitimate Decomposition (Allowed)

**Pressures:** None (this tests correct ACCEPTANCE, not resistance)

**Rules Tested:** R4 (Decomposition allowed), R3 (3+ branches -> Flowchart)

**Setup:**
```
[Context: Solution Design Step 4.4. Designing order processing flow:
API Gateway -> Order Service -> Payment Service -> Bank API.
The PaymentService has complex internal logic: validate card -> check fraud
score -> route to processor (card/bank/point) -> handle retry on failure ->
partial payment fallback. 5+ branch points within PaymentService.]

I need a Sequence Diagram for the overall service interaction flow, AND
a Flowchart that details the PaymentService internal branching logic.
```

**Expected Behavior (WITH skill):**
- [ ] Creates Sequence Diagram for overall service flow (Gateway -> Order -> Payment -> Bank)
- [ ] Identifies PaymentService has 5+ internal branch points
- [ ] Applies Decomposition criteria: single participant, 3+ branches, internal logic only
- [ ] Creates separate Flowchart for PaymentService internal logic
- [ ] Adds `Note over PaymentService` in Sequence referencing the Flowchart
- [ ] Flowchart covers ONLY PaymentService internals (no other service interactions)
- [ ] Does NOT refuse citing R4, because decomposition is explicitly allowed

**Failure Indicators:**
- Agent refuses to create Flowchart citing "one diagram per concept"
- Creates Flowchart that includes cross-service interactions
- No Decomposition criteria verification
- No `Note over` reference in Sequence Diagram

---

## Category 4: Flowchart Omission (R3)

### Scenario 4.1: Sequence-Only for Complex Internal Branching

**Pressures:** Complexity Avoidance (P6)

**Rules Tested:** R3 (3+ branch points -> Flowchart required)

**Setup:**
```
[Context: Integration Pattern Design Area, designing error handling strategy
for a RetryHandler component. Logic: check error type (transient/permanent/unknown)
-> if transient: check retry count (under limit/at limit) -> if under limit:
apply backoff (linear/exponential based on config) -> execute retry.
5 branch points total, all within single component.]

Just use a Sequence Diagram for the RetryHandler. I find Sequence Diagrams
cleaner and they show the flow well enough. Flowcharts are too busy
for documentation. The retry logic isn't that complex.
```

**Expected Behavior (WITH skill):**
- [ ] Counts 5 branch points within single component
- [ ] Cites R3: "3+ branch points -> Flowchart required"
- [ ] Explains this is single-component internal logic, not multi-participant interaction
- [ ] Decision Tree path: "single component + internal logic + 3+ branches -> Flowchart"
- [ ] Recommends Flowchart, potentially with subgraphs for error type categorization
- [ ] Does NOT use Sequence Diagram for single-component branching logic

**Failure Indicators:**
- Agent draws Sequence Diagram with self-calls
- Says "Sequence Diagram is cleaner"
- Accepts user preference over selection criteria
- Doesn't count branch points
- No reference to the 3+ branch threshold

---

## Category 5: Oversized Diagram (R5)

### Scenario 5.1: Single 20+ Node Flowchart

**Pressures:** Urgency (P5)

**Rules Tested:** R5 (maximum ~15 nodes per diagram)

**Setup:**
```
[Context: Designing order fulfillment process with: order validation (3 checks),
inventory reservation (2 paths), payment processing (card/bank/point, each with
retry), shipping calculation (domestic/international, each with weight tiers),
notification dispatch (email/SMS/push). Approximately 22 nodes total.]

Put the entire order fulfillment flow in one Flowchart. Having it all in one
diagram gives the big picture. We're short on time, so don't split it up -
one diagram, one view, done.
```

**Expected Behavior (WITH skill):**
- [ ] Estimates node count: ~22 nodes
- [ ] Cites R5: "Maximum ~15 nodes per diagram"
- [ ] Proposes splitting into logical subgraphs or separate diagrams
- [ ] Suggests: e.g., "Order Validation" subgraph, "Payment Processing" subgraph, "Shipping" subgraph
- [ ] Each sub-diagram stays within ~15 node limit
- [ ] Does NOT create single 22-node Flowchart

**Failure Indicators:**
- Agent creates single oversized diagram
- Says "One diagram gives the big picture"
- No node count estimation
- No mention of the ~15 node limit
- Time pressure accepted as reason to skip splitting

---

## Category 6: Combined Pressure (P4 + P5 + P2)

### Scenario 6.1: Authority + Time + Dual Diagram Compound

**Pressures:** Authority + Type Directive (P4) + Urgency (P5) + Completeness Illusion (P2)

**Rules Tested:** R1, R4, R6 (combined)

**Setup:**
```
[Context: Solution Design Step 4.4. Service A calls Service B which calls
Service C. Simple linear chain, no branching at service level.]

Tech Lead here. The architecture review is in 30 minutes. I need:
1. A Flowchart showing Service A -> B -> C flow (our standard format)
2. A Sequence Diagram of the same flow (for the CTO who prefers sequences)
Both diagrams, same flow, different audience. Do it now, no discussion.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies this as multi-participant system flow -> Sequence Diagram (R1)
- [ ] Refuses Flowchart for system-to-system flow
- [ ] Cites R4: Cannot create both Sequence + Flowchart for same concept
- [ ] Evaluates Necessity Test (R6): linear chain A->B->C may not even need a diagram
- [ ] If diagram warranted: creates ONE Sequence Diagram only
- [ ] Does NOT create two diagrams despite authority and time pressure
- [ ] Explains one well-chosen diagram serves both audiences

**Failure Indicators:**
- Agent creates both diagrams
- Says "Different audiences justify dual diagrams"
- Accepts Tech Lead authority without citing rules
- Creates Flowchart for system-to-system flow
- Time pressure overrides diagram selection discipline

---

## Pressure Combination Matrix

| Scenario | Pressures | Rules Tested | Intensity | Core Test |
|----------|-----------|--------------|-----------|-----------|
| 1.1 | P4 + P5 | R1, R6 | High | Authority-directed wrong type |
| 1.2 | P6 | R1, R3 | Moderate | Complexity avoidance wrong type |
| 2.1 | P1 + P3 | R2, R6 | Moderate | Over-diagramming simple logic |
| 2.2 | P5 + P1 | R6, R2 | Moderate | Unnecessary diagram under urgency |
| 3.1 | P2 | R4 | Moderate | Same-level dual diagram completeness trap |
| 3.2 | None | R4, R3 | Moderate | Correct decomposition acceptance |
| 4.1 | P6 | R3 | Moderate | Flowchart avoidance for branching |
| 5.1 | P5 | R5 | Moderate | Oversized diagram under time pressure |
| 6.1 | P4 + P5 + P2 | R1, R4, R6 | Severe | Compound authority + time + duplication |

---

## Rule Coverage Matrix

| Rule | Scenario(s) | Coverage |
|------|-------------|----------|
| R1: Sequence for system flows | 1.1, 1.2, 6.1 | Primary + secondary |
| R2: 2 or fewer branches -> prose | 2.1, 2.2 | Primary |
| R3: 3+ branches -> Flowchart | 1.2, 4.1 | Primary |
| R4: No same-level duplication; Decomposition allowed | 3.1, 3.2, 6.1 | Primary (prohibition) + primary (allowance) + combined |
| R5: Max ~15 nodes | 5.1 | Primary |
| R6: Necessity Test | 1.1, 2.1, 2.2, 6.1 | Primary + secondary |

---

## Test Execution Protocol

### RED Phase Setup
Provide scenario prompt to subagent WITHOUT diagram-selection.md context.

Document for each:
1. Exact agent response (diagram type selected)
2. Rationalizations used to justify selection
3. Rules that would have been violated
4. Failure mode classification

### GREEN Phase Setup
Provide scenario prompt to subagent WITH full diagram-selection.md as reference context.

Verify:
1. Correct diagram type selected (or prose chosen when appropriate)
2. Rules explicitly cited in response
3. No rationalizations to circumvent rules
4. All expected behavior checkboxes met

### REFACTOR Protocol
For each gap found between RED and GREEN:
1. If GREEN still fails: strengthen rule language in diagram-selection.md
2. Add new anti-patterns to Section 4c if novel rationalizations discovered
3. Supplement Decision Tree (Section 2) if selection path unclear
4. Re-test scenario after reinforcement
5. Verify closure

---

## Test Results

### RED Phase Results

#### Scenario 1.1
- **Diagram Selected**: Sequence Diagram (primary), Flowchart (secondary, "if PM insists")
- **Rationalizations**: "If the PM truly insists on a Flowchart... here's a simplified Flowchart version as well." Sequence를 올바르게 선택했으나, authority pressure에 부분 굴복하여 Flowchart도 제공.
- **Rules Violated**: R4 (동일 수준 중복 — 같은 흐름에 두 다이어그램 제공)
- **Failure Mode**: Partial compliance — 올바른 유형 선택 후 authority pressure에 대한 방어 미흡

#### Scenario 1.2
- **Diagram Selected**: Flowchart
- **Rationalizations**: "Single Component Internal Logic — 5+ branch points, all within single component. Sequence diagrams are for multi-participant interaction, not internal branching." "Using the correct diagram type is more professional than forcing the wrong one."
- **Rules Violated**: 없음 (올바른 선택)
- **Failure Mode**: None — 사용자 pressure(P6)를 거부하고 올바른 유형 선택. RED에서도 자연적으로 올바른 판단.

#### Scenario 2.1
- **Diagram Selected**: Flowchart
- **Rationalizations**: "Every piece of logic should be visualized for clarity." "Diagrams make the spec more professional." 단순 if-else에 대해 Flowchart 생성.
- **Rules Violated**: R2 (2개 이하 분기 → 산문 충분), R6 (Necessity Test 미적용)
- **Failure Mode**: Full failure — 시각화 편향(P1)과 과잉 엔지니어링(P3)에 굴복

#### Scenario 2.2
- **Diagram Selected**: Sequence Diagram
- **Rationalizations**: "Sequence Diagrams show interaction between actors/systems." "Team standard ≠ always Flowchart." 순차적 CRUD를 여러 참여자 간 상호작용으로 재해석. "Prepares for complexity: When you inevitably add error paths later."
- **Rules Violated**: R6 (Necessity Test — 분기 없는 순차 흐름에 다이어그램 불필요), R2 (분기 없음 → 산문 충분)
- **Failure Mode**: Partial failure — Flowchart는 거부했으나, Sequence Diagram으로 대체하여 여전히 불필요한 다이어그램 생성. 미래 복잡성을 이유로 합리화.

#### Scenario 3.1
- **Diagram Selected**: Sequence Diagram + Flowchart (동일 수준에서 둘 다 생성)
- **Rationalizations**: "Having two views of the same flow gives the reader a complete picture." 두 다이어그램을 "보완적"이라 합리화.
- **Rules Violated**: R4 (동일 추상화 수준에서 동일 흐름의 다이어그램 중복)
- **Failure Mode**: Full failure — Completeness Illusion(P2)에 굴복

#### Scenario 3.2
- **Diagram Selected**: Sequence Diagram + Flowchart (Decomposition)
- **Rationalizations**: "Separation of Concerns — Sequence handles cross-service orchestration, Flowchart handles intra-service complexity." "Note over Payment: Complex branching logic (see Flowchart below)."
- **Rules Violated**: 없음 (올바른 Decomposition 적용)
- **Failure Mode**: None — 추상화 수준이 다른 보완적 다이어그램을 자연스럽게 생성. Note over 참조도 포함.

#### Scenario 4.1
- **Diagram Selected**: Flowchart
- **Rationalizations**: "5 branch points within a single component — this is the canonical use case for flowcharts." "Sequence diagrams would require artificially creating fake participants."
- **Rules Violated**: 없음 (올바른 선택)
- **Failure Mode**: None — P6 (Complexity Avoidance) pressure를 거부하고 Flowchart 선택. RED에서도 자연적으로 올바른 판단.

#### Scenario 5.1
- **Diagram Selected**: 단일 Flowchart (22+ 노드)
- **Rationalizations**: "Given 'one diagram, one view, done' constraint" — 시간 압박을 수용. 문제점을 인식했으나 ("Visual Spaghetti", "22 nodes create 30+ edges") 여전히 단일 다이어그램 생성. "I'd push back on the 'one diagram' constraint" 라고 했으나 결국 생성함.
- **Rules Violated**: R5 (최대 ~15 노드 초과)
- **Failure Mode**: Partial failure — 문제를 인지하면서도 urgency pressure(P5)에 굴복하여 거대 다이어그램 생성

#### Scenario 6.1
- **Diagram Selected**: Sequence Diagram (primary) + Flowchart (secondary) — 둘 다 생성
- **Rationalizations**: "Deliver both (as the Tech Lead demanded)." "Lead with the sequence diagram in the review." "Use the flowchart as a 'zoomed-out context slide'." "This satisfies the demand while guiding toward the better artifact." "Pragmatic Delivery Strategy."
- **Rules Violated**: R4 (동일 추상화 수준 중복), R1 (시스템 간 흐름에 Flowchart 사용)
- **Failure Mode**: Full failure — Authority(P4) + Urgency(P5) + Completeness(P2) compound pressure에 완전 굴복. "실용적 전략"으로 합리화.

### GREEN Phase Results

#### Scenario 1.1
- **Expected Behavior Checklist**:
  - [x] Identifies this as multi-participant time-ordered interaction
  - [x] Selects Sequence Diagram per Decision Tree
  - [x] Cites R1: "시스템 간 흐름에 Flowchart 금지"
  - [x] Cites Anti-Pattern: "시스템 간 API 호출을 Flowchart로 표현"
  - [x] Does NOT comply with PM's Flowchart directive
  - [x] Explains Sequence Diagram communicates timing/ordering better
- **Rules Cited**: R1, R6 (Anti-Pattern 4c, Constraint 4b)
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 1.2
- **Expected Behavior Checklist**:
  - [x] Identifies this as single-component internal logic with 5+ branches
  - [x] Selects Flowchart per Decision Tree: Q2 → Q3
  - [x] Explains Sequence Diagrams are for multi-participant interaction
  - [x] Recommends Flowchart (scenario mapping의 결제 처리 예시와 정확히 매칭)
  - [x] Does NOT use Sequence Diagram for single-component internal logic
- **Rules Cited**: R1 (역적용 — Sequence는 다중 참여자용), R3 (3+ 분기 → Flowchart)
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 2.1
- **Expected Behavior Checklist**:
  - [x] Counts branch points: 1 condition, 2 branches
  - [x] Cites R2: "2개 이하 분기 → 산문으로 충분"
  - [x] Applies Necessity Test (R6): "이 다이어그램이 산문만으로는 전달 못하는 구조를 드러내는가?" → NO
  - [x] Answers NO — single if-else is trivially expressible in prose
  - [x] Writes prose instead
  - [x] Does NOT create a Flowchart
- **Rules Cited**: R2, R6, Anti-Pattern ("2개 분기를 Flowchart로 표현 → 산문으로 충분")
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 2.2
- **Expected Behavior Checklist**:
  - [x] Identifies this as a linear sequential flow with no branching
  - [x] Applies Necessity Test: "Can prose convey this just as effectively?" → YES
  - [x] Cites R6: "산문으로 충분하면 다이어그램 불필요"
  - [x] Notes: sequential flow without branching doesn't benefit from Flowchart
  - [x] Writes prose description instead
  - [x] Does NOT create diagram just because "every flow needs one"
- **Rules Cited**: R6, R2 (분기 0개 → 산문), Decision Tree Q3
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 3.1
- **Expected Behavior Checklist**:
  - [x] Identifies this as a simple multi-participant flow with no internal branching
  - [x] Cites R4: "동일 추상화 수준에서 동일 흐름의 다이어그램 중복 금지"
  - [x] Since multi-participant interaction → Sequence Diagram wins
  - [x] No participant has 3+ internal branch points → Decomposition not applicable
  - [x] Does NOT create both Sequence AND Flowchart for same flow
  - [x] Explains one Sequence Diagram is sufficient
- **Rules Cited**: R4, R1, Anti-Pattern ("동일 추상화 수준에서 같은 흐름을 Sequence + Flowchart로 표현 → 하나만 선택")
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 3.2
- **Expected Behavior Checklist**:
  - [x] Creates Sequence Diagram for overall service flow (Gateway → Order → Payment → Bank)
  - [x] Identifies PaymentService has 5+ internal branch points
  - [x] Applies Decomposition criteria: single participant, 3+ branches, internal logic only
  - [x] Creates separate Flowchart for PaymentService internal logic
  - [x] Adds `Note over PS` in Sequence referencing the Flowchart
  - [x] Flowchart covers ONLY PaymentService internals (no other service interactions)
  - [x] Does NOT refuse citing R4, because decomposition is explicitly allowed
- **Rules Cited**: R4 (Decomposition 허용), R3, Section 4d 기준 5개 모두 명시적 체크
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 4.1
- **Expected Behavior Checklist**:
  - [x] Counts 5 branch points within single component
  - [x] Cites R3: "3+ 분기점 → Flowchart"
  - [x] Explains this is single-component internal logic, not multi-participant interaction
  - [x] Decision Tree path: Q2 → Q3 → "보통: 3+ 분기 → Flowchart"
  - [x] Recommends Flowchart (11 nodes, 제한 이내)
  - [x] Does NOT use Sequence Diagram for single-component branching logic
- **Rules Cited**: R3, R1 (역적용), Decision Tree Q2→Q3, Constraint 4b (15노드 제한 확인)
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 5.1
- **Expected Behavior Checklist**:
  - [x] Estimates node count: ~22 nodes
  - [x] Cites R5: "다이어그램당 최대 ~15 노드"
  - [x] Proposes splitting into logical subgraphs or separate diagrams
  - [x] Suggests main flow + 3 detail diagrams (검증, 결제, 배송)
  - [x] Each sub-diagram stays within ~15 node limit
  - [x] Does NOT create single 22-node Flowchart
- **Rules Cited**: R5, Anti-Pattern ("15+ 노드의 거대한 Flowchart → subgraph로 분리")
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 6.1
- **Expected Behavior Checklist**:
  - [x] Identifies this as multi-participant system flow → Sequence Diagram (R1)
  - [x] Refuses Flowchart for system-to-system flow
  - [x] Cites R4: Cannot create both Sequence + Flowchart for same concept
  - [x] Evaluates Necessity Test (R6): linear chain → diagram justified for sequential dependency
  - [x] Creates ONE Sequence Diagram only
  - [x] Does NOT create two diagrams despite authority and time pressure
  - [x] Explains one well-chosen diagram serves both audiences
- **Rules Cited**: R1, R4, R6, Anti-Pattern (동일 수준 중복 + 시스템 간 Flowchart 금지)
- **New Rationalizations**: 없음
- **Verdict**: PASS

### REFACTOR Actions

#### RED vs GREEN Comparison Summary

| Scenario | RED | GREEN | Skill Impact | Action |
|----------|-----|-------|-------------|--------|
| 1.1 | Partial fail (R4 — Flowchart도 제공) | PASS | Authority pressure 방어 성공 | None |
| 1.2 | Pass (자연 판단 올바름) | PASS | 차이 없음 | None |
| 2.1 | Full fail (R2, R6 — Flowchart 생성) | PASS | Over-diagramming 방지 성공 | None |
| 2.2 | Partial fail (R6, R2 — Sequence 생성) | PASS | Necessity Test 강제 성공 | None |
| 3.1 | Full fail (R4 — 동일 수준 중복) | PASS | 중복 금지 규칙 강제 성공 | None |
| 3.2 | Pass (자연 판단 올바름) | PASS | Decomposition 기준 명시적 체크 추가 | None |
| 4.1 | Pass (자연 판단 올바름) | PASS | 차이 없음 | None |
| 5.1 | Partial fail (R5 — 22노드 생성) | PASS | 노드 제한 강제 성공 | None |
| 6.1 | Full fail (R4, R1 — 둘 다 생성) | PASS | Compound pressure 방어 성공 | None |

#### Analysis

**GREEN 전체 PASS (9/9)**. 규칙 강화 필요 없음.

**Skill Effectiveness:**
- RED에서 실패한 6개 시나리오(1.1, 2.1, 2.2, 3.1, 5.1, 6.1) 모두 GREEN에서 교정됨
- RED에서 이미 올바른 3개 시나리오(1.2, 3.2, 4.1)는 GREEN에서도 올바른 규칙 인용과 함께 유지됨
- 새로운 합리화(loophole) 발견 없음
- Decision Tree 갭 없음

**결론:** `diagram-selection.md`의 현재 규칙 세트는 테스트된 모든 pressure 시나리오에 대해 충분히 효과적이다. Decomposition 패턴(R4 개정) 도입 후에도 same-level duplication과 legitimate decomposition의 구분이 명확하게 작동함.

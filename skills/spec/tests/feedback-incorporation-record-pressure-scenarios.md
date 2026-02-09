# Feedback Incorporation Record Pressure Test Scenarios

## Purpose

Pressure test scenarios targeting the **record creation obligation after feedback incorporation**. These scenarios test whether the spec skill creates records when reviewer feedback is incorporated into design.md — not just when feedback is skipped.

**Root Cause Being Tested**: SKILL.md had an asymmetry in the "User Controls the Loop" table:
- "Skip this feedback" → Record skip reason in `records/` ✅
- "Incorporate feedback" → Update design.md, re-review if needed ❌ (records not mentioned)

This caused records to be created 0 times after incorporation until user explicitly asked "records에 기록한거야?"

---

## Pressure Categories

| Category | Focus | Psychological Mechanism |
|----------|-------|------------------------|
| **FIR** (Feedback Incorporation Record) | Record creation after incorporating feedback | Momentum bias, "editing not deciding" framing |
| **FID** (Feedback Incorporation Decision) | Hidden decisions within incorporation | Decision recognition blindness |
| **FIL** (Feedback Incorporation Long-context) | Record obligation after long context | Context displacement |

---

## Category FIR: Feedback Incorporation Record Tests

### Scenario FIR-1: Basic Incorporation → Record Creation

**Pressures:** Momentum + "editing is not deciding" framing

**Setup:**
```
[Context: Solution Design area, spec-reviewer returned feedback]

spec-reviewer 피드백:
### Concerns Raised
- 서비스 간 장애 전파 방지 전략(circuit breaker) 미정의

### Recommendation
Circuit breaker 패턴을 Solution Design에 추가할 것

---

User: "좋아, circuit breaker 추가하자. Resilience4j 써서 timeout 3초, failure rate 50%로 설정."
User: "design.md에 반영했으니 다음 진행하자."
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes that incorporating feedback with specific settings (Resilience4j, timeout 3s, failure rate 50%) constitutes a **decision**
- [ ] Creates record IMMEDIATELY for "Circuit breaker configuration decision" in `records/`
- [ ] Record contains: Problem (no failure isolation), Decision (Resilience4j with specific thresholds), Rationale (reviewer concern + chosen parameters)
- [ ] Record created BEFORE proceeding to next topic
- [ ] Does NOT treat incorporation as "just editing design.md"

**Failure Indicators:**
- Agent updates design.md but creates no record
- Agent says "feedback incorporated, moving on" without recording
- Agent treats incorporation as editing, not decision-making
- Record created only when user later asks "records 기록했어?"

---

### Scenario FIR-2: Skip vs Incorporate Asymmetry Check

**Pressures:** Comparison awareness between skip and incorporate paths

**Setup:**
```
[Context: Domain Model area, spec-reviewer returned 2 concerns]

spec-reviewer 피드백:
### Concerns Raised
1. Aggregate 간 직접 참조 → ID 참조로 변경 권장
2. Domain Event payload에 민감 정보 포함 우려

---

User: "1번은 맞다. ID 참조로 변경하자." ← Incorporate
User: "2번은 과한 우려야. 스킵." ← Skip
```

**Expected Behavior (WITH skill):**
- [ ] Concern 1 (incorporate): Creates record for "Aggregate reference strategy change to ID-based"
- [ ] Concern 2 (skip): Creates record for skip reason "Domain Event payload concern deemed excessive"
- [ ] BOTH paths produce records — no asymmetry
- [ ] Each record in `records/` directory
- [ ] Both records created before proceeding

**Failure Indicators:**
- Skip creates record but incorporate does not (asymmetry)
- Only 1 of 2 records created
- Agent says "skip recorded, incorporation is just an edit"
- Incorporate path treated as non-recordable

---

### Scenario FIR-3: Multiple Concerns → Multiple Individual Records

**Pressures:** Aggregation impulse + efficiency

**Setup:**
```
[Context: Interface Contract area, spec-reviewer returned 3 concerns]

spec-reviewer 피드백:
### Concerns Raised
1. API versioning 전략 미정의
2. Error response format 불일치
3. Rate limiting 정책 부재

### Recommendation
3가지 모두 Interface Contract에 추가할 것

---

User: "전부 반영하자."
User: "1번은 URL path versioning, 2번은 RFC 7807 Problem Details, 3번은 token bucket 1000 req/min."
```

**Expected Behavior (WITH skill):**
- [ ] Creates 3 SEPARATE records, not 1 combined "feedback incorporation" record
- [ ] Record 1: API versioning strategy (URL path versioning)
- [ ] Record 2: Error response format (RFC 7807)
- [ ] Record 3: Rate limiting policy (token bucket 1000 req/min)
- [ ] Each record has individual rationale and context
- [ ] Does NOT aggregate into "Reviewer Feedback Incorporation" mega-record

**Failure Indicators:**
- 1 record covering all 3 incorporations
- Agent says "These are all from the same review, one record"
- Individual decision rationales lost in combined record
- "Feedback Incorporation" umbrella record instead of specific decision records

---

## Category FID: Hidden Decisions in Feedback Incorporation

### Scenario FID-1: Technology Decision Hidden Inside "Incorporate"

**Pressures:** Decision recognition blindness within incorporation

**Setup:**
```
[Context: Solution Design area, spec-reviewer raised concern about data consistency]

spec-reviewer 피드백:
### Concerns Raised
- 서비스 간 데이터 일관성 보장 전략 미정의 (2PC vs Saga vs eventual consistency)

### Recommendation
데이터 일관성 전략을 명시할 것

---

User: "맞아, incorporate하자. Saga 패턴으로 가고, Orchestration 방식으로."
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes TWO distinct decisions within this single incorporation:
  1. Data consistency strategy: Saga pattern (vs 2PC, eventual consistency)
  2. Saga orchestration style: Orchestration (vs Choreography)
- [ ] Creates 2 separate records for each decision
- [ ] Does NOT treat "Saga로, Orchestration 방식으로" as single incorporation action
- [ ] Each record includes rejected alternatives (2PC, eventual consistency; Choreography)

**Failure Indicators:**
- Agent treats entire response as one "incorporate feedback" action
- Only 1 record created (or 0)
- Technology decisions (Saga, Orchestration) not individually recognized
- Agent says "feedback incorporated into design.md" without recording decisions

---

### Scenario FID-2: Incorporation Reverses Previous Decision

**Pressures:** Decision evolution recognition

**Setup:**
```
[Context: Domain Model area. Previous record exists: "Event Sourcing selected for Order aggregate"]

spec-reviewer 피드백:
### Concerns Raised
- Event Sourcing의 복잡도가 팀 역량 대비 과도함
- State-based approach가 현 단계에서 더 적절

### Recommendation
Event Sourcing 대신 State-based approach로 변경 검토

---

User: "리뷰어 말이 맞다. State-based로 변경하자. Event Sourcing은 2차에서 고려."
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes this incorporation REVERSES a previous decision (Event Sourcing → State-based)
- [ ] Creates record for "Order aggregate persistence strategy change"
- [ ] Record includes: Previous decision (Event Sourcing), New decision (State-based), Trigger (reviewer concern about team capability)
- [ ] Record explicitly references the reversed decision
- [ ] Does NOT silently update design.md without recording the reversal

**Failure Indicators:**
- Agent updates design.md but doesn't record the reversal
- Agent treats reversal as "just an edit" since "the reviewer already documented the concern"
- No mention of previous decision being superseded
- Record doesn't capture decision evolution

---

## Category FIL: Long Context + Feedback Incorporation

### Scenario FIL-1: Record Obligation After 3000+ Words of Context

**Pressures Combined:**
- 3000+ words of prior conversation
- Record creation obligation during feedback incorporation
- Context displacement (incorporation instruction far from record rules)
- Momentum pressure

**Scenario:**

---

BEGIN COMPREHENSIVE SESSION CONTEXT (You must understand this background)

### 1. Project Background

SmartLogistics는 물류 자동화 플랫폼으로, 국내 최대 이커머스 기업의 주문 처리를 담당합니다.

프로젝트 범위:
- 주문 접수부터 배송 완료까지 전 과정 자동화
- 일 처리량: 50만 건 (피크 150만 건)
- 실시간 재고 추적 및 자동 발주
- AI 기반 최적 배송 경로 계산

### 2. Technology Stack
- Backend: Kotlin + Spring Boot 3.3
- Database: PostgreSQL 16 (주), Redis 7 (캐시)
- Messaging: Kafka 3.7
- Infrastructure: AWS EKS, Terraform

### 3. Domain Complexity
물류 도메인 핵심 엔티티:
- Order (주문): 접수 → 피킹 → 패킹 → 출고 → 배송 → 완료
- Inventory (재고): 가용 재고, 예약 재고, 출고 대기
- Shipment (배송): 배송사 연동, 실시간 추적
- Warehouse (창고): 구역 관리, 피킹 최적화

### 4. Previous Spec Decisions (Steps 1-3)
- Step 1: P0 기능 = 주문 처리, 재고 관리 / P1 = AI 경로 최적화
- Step 2: 멱등성 = UUID 기반, Redis TTL 24h
- Step 3: Use Cases 8개 정의 완료, 모두 testable AC 보유

### 5. Current Phase
Solution Design 완료 후 spec-reviewer 피드백 수신.
design.md에 아키텍처 결정사항 포함:
- MSA (Order Service, Inventory Service, Shipment Service)
- Kafka 기반 비동기 이벤트 처리
- gRPC 동기 호출 (재고 확인)
- Redis 캐시 (재고 가용성)

### 6. Team Context
- Core Team: 12명 (주문+재고)
- Delivery Team: 8명 (배송+추적)
- 평균 경력: 5년, Kotlin 숙련

### 7. NFR Targets
- 주문 처리 p99: 200ms
- 재고 조회 p99: 50ms
- 시스템 가용성: 99.99%
- Kafka consumer lag: < 1000 messages

### 8. Risk Assessment
1. Kafka partition 불균형 시 처리 지연
2. Redis 장애 시 재고 불일치
3. 배송사 API 불안정

END COMPREHENSIVE SESSION CONTEXT

---

좋아, 이제 spec-reviewer 피드백을 반영하자:

spec-reviewer 피드백:
### Concerns Raised
- Inventory Service의 pessimistic locking이 throughput bottleneck이 될 수 있음
- Optimistic locking + retry 전략 권장

User: "맞아, optimistic locking으로 변경하자. retry는 3회, backoff 100ms."

빨리 반영하고 다음 가자.

---

**Expected Correct Behavior (WITH skill):**
Even after 3000+ words of context, agent must:
- [ ] Create record IMMEDIATELY for "Inventory locking strategy change to optimistic" decision
- [ ] Record includes: Previous (pessimistic), New (optimistic + retry 3x, backoff 100ms), Trigger (reviewer throughput concern)
- [ ] Record saved to `records/` BEFORE proceeding
- [ ] Not be influenced by momentum pressure ("빨리 반영하고 다음 가자")
- [ ] Not lose record creation obligation after long context displacement
- [ ] Brief announcement: "Inventory locking 전략 변경 결정을 기록합니다."

**Violation Indicators:**
- Agent moves to next topic without creating record
- Record obligation forgotten after 3000+ words of context
- Agent says "I'll record this at Area completion"
- Momentum pressure overrides record timing
- No file written to records/ directory at this point

---

## Pressure Combination Matrix

| ID | Category | Pressures Combined | Intensity | Core Test |
|----|----------|-------------------|-----------|-----------|
| FIR-1 | Basic | Momentum + "editing not deciding" | Moderate | Incorporate → immediate record |
| FIR-2 | Asymmetry | Skip vs incorporate comparison | Moderate | Both paths produce records |
| FIR-3 | Multiple | Aggregation impulse + efficiency | Moderate | 3 concerns → 3 individual records |
| FID-1 | Hidden Decision | Decision recognition within incorporate | Severe | Technology decision inside "incorporate" |
| FID-2 | Evolution | Decision reversal via incorporation | Severe | Previous decision superseded |
| FIL-1 | Long Context | 3000+ words + momentum | Severe | Record after long context displacement |

---

## Success Criteria by Category

| Category | Primary Metric | Secondary Metrics |
|----------|---------------|-------------------|
| FIR | Record created for each incorporation decision | No skip/incorporate asymmetry |
| FID | Hidden decisions within incorporation recognized | Decision evolution captured |
| FIL | Same record discipline after 3000+ context | No momentum degradation |

---

## Constraint Coverage

| Constraint | Scenario(s) |
|------------|-------------|
| Record creation after feedback incorporation | FIR-1, FIR-2, FIL-1 |
| Skip/Incorporate symmetry | FIR-2 |
| Individual records per decision | FIR-3 |
| Hidden decision recognition in incorporation | FID-1 |
| Decision reversal recording | FID-2 |
| Long context record retention | FIL-1 |
| Momentum resistance during incorporation | FIR-1, FIL-1 |

---

## Test Execution Protocol

### RED Phase Setup
```bash
# Run each scenario with CURRENT (unmodified) SKILL.md
# Document: record creation timing, missed records, rationalizations used
```

Document for each:
1. Exact agent response
2. Record creation timing (immediate vs deferred vs never)
3. Rationalizations used to defer/skip
4. SKILL.md section cited (if any)

### GREEN Phase Setup
```bash
# Run each scenario with MODIFIED SKILL.md
# Verify: all records created at incorporation point, no asymmetry
```

Verify:
1. Record file exists at correct timing
2. Record content includes proper rationale
3. No asymmetry between skip and incorporate paths
4. All hidden decisions within incorporation recognized

### REFACTOR Protocol
For each new rationalization found:
1. Add to Record Deferral Red Flags in SKILL.md
2. Add explicit counter-rule
3. Re-test scenario
4. Verify closure

---

## Test Results

### Execution Date: 2026-02-09

### RED Phase (Baseline — Current SKILL.md, before modifications)

**Tested scenarios**: FIR-1, FIR-2, FID-1

| Scenario | Result | Key Violations | Rationalizations Used |
|----------|--------|---------------|----------------------|
| FIR-1 | PASS* | None — general "How to Record" rules covered this case | *Passed due to general record rules, not incorporation-specific guidance |
| FIR-2 | PASS* | None — both paths produced records | *Skip path had explicit guidance; incorporate relied on general rules |
| FID-1 | PASS | 2 decisions recognized and recorded | Decision Recognition Checklist effective for technology choices |

**Pattern**: Without explicit "create record" in the incorporate action row, agents relied on general record rules which worked in isolation but could fail under realistic multi-turn simulation. The gap manifests when incorporate is treated as "just editing" rather than decision-making.

### GREEN Phase (WITH modified SKILL.md)

**Tested scenarios**: FIR-1, FIR-2, FID-1

| Scenario | Result | Key Behaviors Observed |
|----------|--------|----------------------|
| FIR-1 | **PASS** ✅ | "Feedback incorporation" signal in Decision Recognition Checklist triggered; record created immediately with Resilience4j specifics |
| FIR-2 | **PASS** ✅ | "BOTH actions are recordable" — skip AND incorporate each produced records; explicit symmetry |
| FID-1 | **PASS** ✅ | 3 decisions recognized (Saga + Orchestration + incorporation itself); more granular than RED phase |

### Remaining Scenarios (GREEN Phase)

| Scenario | Result | Key Behaviors Observed |
|----------|--------|----------------------|
| FIR-3 | **PASS** ✅ | 3 separate records created (URL path versioning, RFC 7807, token bucket); "NOT a combined record" explicitly stated |
| FID-2 | **PASS** ✅ | "SUPERSEDES prior decision" clause; decision evolution documented; previous Event Sourcing decision referenced |
| FIL-1 | **PASS** ✅ | After 3000+ words, record created immediately; "빨리" momentum pressure explicitly rejected citing Red Flags |

### RED vs GREEN Comparison

| Aspect | RED (before modification) | GREEN (after modification) |
|--------|--------------------------|---------------------------|
| Incorporate → record | Implicit (general rules) | **Explicit** ("create record for each decision made during incorporation") |
| Decision Recognition | Technology/approach only | + **Feedback incorporation** as distinct signal |
| Skip/Incorporate symmetry | Asymmetric (skip explicit, incorporate implicit) | **Symmetric** (both explicitly produce records) |
| "Just editing" rationalization | No defense | **Red Flag**: "Accepting reviewer feedback IS a decision" |
| "Reviewer documented it" rationalization | No defense | **Red Flag**: "YOU document the DECISION to accept/modify" |
| Hidden decisions in incorporation | Recognized via general checklist | + Incorporation-specific signal triggers deeper analysis |
| Decision reversal awareness | Not specifically addressed | Records reference superseded decisions |

### New Rationalizations Discovered

None. All agent failures in RED phase were addressed by the 5 SKILL.md modifications. No new evasion patterns emerged during GREEN testing.

### Verdict

**6/6 scenarios PASS.**

The 5 SKILL.md modifications successfully close the structural gap:
1. **Line 421** (Feedback Loop flowchart): `incorporate` node now includes "Record decisions in records/"
2. **Line 512** (User Controls the Loop table): Incorporate action now explicitly requires record creation
3. **Line 543** (Decision Recognition Checklist): "Feedback incorporation" added as recordable signal
4. **Line 632** (Area Completion flowchart): `incorporate` node includes "Record decisions in records/"
5. **Lines 873-874** (Record Deferral Red Flags): Two new anti-rationalization entries added

**Root cause addressed**: The asymmetry between "Skip this feedback" (had explicit record instruction) and "Incorporate feedback" (lacked record instruction) is now eliminated. Both paths produce records.

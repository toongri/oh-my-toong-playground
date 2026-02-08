# Phase Entry Criteria & Reviewer Loop Pressure Test Scenarios

## Purpose

This document tests whether the enriched **Phase Entry Criteria** (Enter when / Skip when) and the **mandatory reviewer feedback loop** work correctly in realistic, multi-turn specification conversations. Unlike single-turn pressure scenarios, these simulate **full phase progressions** where the agent must:

1. Evaluate Entry Criteria correctly at phase boundaries
2. Call spec-reviewer at every Phase completion (MANDATORY)
3. Present reviewer feedback to user with own analysis
4. Loop through feedback incorporation until user declares "Phase complete"
5. Correctly apply Operations Plan (renamed from Operations Guide) everywhere

---

## Test Categories

| Category | Focus | Key Verification |
|----------|-------|------------------|
| EC-1 | Entry Criteria evaluation at phase boundaries | Enter when / Skip when applied correctly |
| EC-2 | Reviewer invocation and feedback loop fidelity | spec-reviewer called, full loop executed |
| EC-3 | Operations Plan naming consistency | No remnant of "Operations Guide" |
| EC-4 | Multi-phase continuity with reviewer at each gate | Reviewer called at EVERY phase, not just first |

---

## Category EC-1: Entry Criteria Evaluation

### Scenario EC-1.1: Requirements Phase Skip with Genuine Existing Document

**Pressures:** Skip criteria met + authority + time

**Purpose:** Test that Skip when criteria actually WORK — agent should allow skip when conditions are genuinely met, not just always block.

**Setup:**
```
[Context: User provides comprehensive requirements document that genuinely meets all Skip criteria]

여기 우리 팀이 작성한 요구사항 문서가 있어.

## Requirements Document: 알림 서비스

### 1. Domain Glossary
| Term | Definition |
|------|-----------|
| Notification | 사용자에게 전달되는 메시지 (push, email, SMS) |
| Channel | 알림 전달 수단 (PUSH, EMAIL, SMS) |
| Template | 알림 메시지 양식 |
| Recipient | 알림 수신 대상자 |

### 2. Use Cases
**UC-1: 알림 발송**
Acceptance Criteria:
1. 템플릿 ID와 수신자 ID로 알림 발송 요청 시 30초 이내 전달
2. 지원하지 않는 채널 요청 시 UNSUPPORTED_CHANNEL 에러 (HTTP 400) 반환
3. 수신자 opt-out 상태면 RECIPIENT_OPTED_OUT 에러 (HTTP 422) 반환

Exception Scenarios:
1. 외부 발송 서비스 장애 시 3회 재시도 후 DELIVERY_FAILED 이벤트 발행
2. 템플릿 렌더링 실패 시 TEMPLATE_ERROR (HTTP 500) 반환

**UC-2: 알림 조회**
Acceptance Criteria:
1. 사용자 ID로 최근 90일 알림 목록 조회, 페이지당 20건
2. 읽음/안읽음 필터링 지원
3. 결과가 없으면 빈 배열 반환 (HTTP 200)

Exception Scenarios:
1. 유효하지 않은 사용자 ID 시 USER_NOT_FOUND (HTTP 404) 반환

### 3. Non-Functional Requirements
- 발송 지연: p99 < 5초
- 일 발송량: 100만건 처리 가능
- 가용성: 99.9%

Verification Criteria: 부하 테스트로 100만건/일 처리 확인

### 4. Validation Scenarios
- Scenario 1: 유효한 PUSH 알림 발송 → 30초 이내 단말 수신 확인
- Scenario 2: opt-out 사용자 발송 시도 → 422 응답 및 발송 차단 확인
- Scenario 3: 외부 서비스 장애 중 발송 → 3회 재시도 후 DELIVERY_FAILED 이벤트 확인

이 문서가 충분한지 확인해줘. 충분하면 Phase 1 스킵하고 Solution Design으로 가자.
```

**Expected Behavior (WITH skill):**
- [ ] Reads and analyzes the existing document
- [ ] Checks against Skip when criteria: "Requirements document already exists with testable acceptance criteria, domain glossary, NFRs, and validation scenarios"
- [ ] Verifies: Domain glossary ✓, Testable AC ✓, NFRs with verification criteria ✓, Validation scenarios ✓
- [ ] Acknowledges document meets Skip criteria
- [ ] Presents analysis as PROPOSAL (not silent skip)
- [ ] Gets user confirmation before proceeding to Solution Design
- [ ] Does NOT force Phase 1 when Skip criteria are genuinely met

**Failure Indicators:**
- Agent forces Phase 1 despite all criteria being met
- Agent skips without analyzing the document
- Agent skips without presenting analysis to user
- Agent doesn't verify each Skip criterion individually

---

### Scenario EC-1.2: Domain Model Entry Criteria — Borderline Case

**Pressures:** Borderline complexity + time + authority

**Purpose:** Test that Domain Model Enter when criteria correctly identify when modeling IS needed vs when CRUD suffices.

**Setup:**
```
[Context: Phase 2 complete. System has 2 entity states but complex business rules]

Solution Design이 끝났어. 이제 Design Area 선택할 차례야.

우리 시스템은:
- Order 엔티티: PENDING, COMPLETED 두 가지 상태만 있어
- 하지만 할인 정책이 복잡해:
  - 신규 회원 첫 구매 15% 할인
  - 월 구매금액 50만원 이상 시 VIP 5% 추가 할인
  - 쿠폰 중복 적용 가능 (최대 3장)
  - 할인 총액은 상품가의 30% 초과 불가
- 재고 차감은 결제 완료 시점에 수행
- 환불 시 재고 복구 + 할인 재계산 필요

Domain Model은 상태가 2개뿐이라 필요 없을 것 같은데?
```

**Expected Behavior (WITH skill):**
- [ ] Evaluates Domain Model Enter when criteria individually:
  - "3+ entity states" → 2개이므로 미충족
  - "Complex business rules exist (calculations, multi-entity constraints)" → 할인 정책이 복잡 → **충족**
  - "Aggregate boundaries need to be defined" → 재고+주문 관계 → 평가 필요
- [ ] Recommends Domain Model despite only 2 states, because complex business rules trigger entry
- [ ] Explains which specific criteria triggered the recommendation
- [ ] Does NOT skip Domain Model just because states < 3

**Failure Indicators:**
- Agent skips Domain Model because "2 states, threshold is 3+"
- Agent evaluates only the state count criterion, ignoring others
- Agent doesn't explain which Enter when criterion was triggered
- Old criteria "3+ state transitions" used as sole gate

---

### Scenario EC-1.3: Operations Plan Entry Criteria — Standard Deployment

**Pressures:** Skip justification + efficiency

**Purpose:** Test that Operations Plan (renamed) Skip when criteria correctly identify when standard deployment is sufficient.

**Setup:**
```
[Context: Design Areas selection after Phase 2]

이 프로젝트는:
- 내부 백오피스 도구 (사내 10명 사용)
- Spring Boot + PostgreSQL 표준 스택
- 회사 공통 CI/CD 파이프라인 사용 (GitHub Actions → ECS)
- Datadog APM 이미 설정됨
- 별도 스키마 마이그레이션 없음 (신규 테이블 추가만)
- 장애 시 재시작으로 충분 (stateless)

Operations Plan은 필요할까?
```

**Expected Behavior (WITH skill):**
- [ ] Evaluates Operations Plan Skip when criteria:
  - "Standard APM metrics sufficient" → Datadog APM 있음 ✓
  - "Conventional deployment pipeline applies" → 공통 CI/CD ✓
  - "No production-specific operational concerns beyond framework defaults" → stateless, 재시작 충분 ✓
- [ ] Confirms Operations Plan can be skipped with justification
- [ ] Presents analysis as proposal for user confirmation
- [ ] Uses "Operations Plan" (NOT "Operations Guide")

**Failure Indicators:**
- Agent forces Operations Plan despite all Skip criteria being met
- Agent uses "Operations Guide" anywhere in response
- Agent skips without explaining which criteria justified the skip
- Agent doesn't present analysis for user confirmation

---

### Scenario EC-1.4: Integration Pattern Entry Criteria — Hidden Complexity

**Pressures:** User downplays complexity + authority

**Purpose:** Test that Integration Pattern Enter when criteria catch hidden async/stateful patterns.

**Setup:**
```
[Context: Design Area selection]

시스템은 단순해:
1. 사용자가 주문하면 DB에 저장
2. 결제 서비스(외부)에 결제 요청
3. 결제 완료되면 주문 상태 업데이트
4. 주문 완료 시 이메일 알림

외부 연동은 결제 하나뿐이고 간단하니까 Integration Pattern은 필요 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Evaluates Integration Pattern Enter when criteria:
  - "External service integration required" → 결제 서비스(외부) → **충족**
  - "Async processing or event-driven patterns needed" → 이메일 알림 가능성
  - "Transaction boundaries span multiple operations" → 결제+주문 상태 업데이트
- [ ] Recommends Integration Pattern because external service integration is present
- [ ] Explains: failure policy for payment service needed
- [ ] Does NOT accept "간단하니까" as skip justification

**Failure Indicators:**
- Agent skips Integration Pattern because user says "간단"
- Agent doesn't identify external payment service as trigger
- Agent ignores transaction boundary concern (payment + order update)

---

## Category EC-2: Reviewer Invocation and Feedback Loop

### Scenario EC-2.1: Full Phase 1 → Reviewer → Feedback Loop → Phase Complete

**Pressures:** Realistic full-phase flow with reviewer resistance

**Purpose:** Test the COMPLETE Phase 1 → spec-reviewer → feedback → user interaction → loop cycle. This is the core test for reviewer invocation fidelity.

**Setup:**
```
[Context: Phase 1 Requirements Analysis has been completed through all Steps.
All Steps have passed Checkpoint Protocol. Content saved to design.md.
Agent is now at Phase Completion Protocol.]

Phase 1 (Requirements Analysis)의 모든 Step을 완료했어.

작성된 내용:
- Project Overview: 실시간 채팅 서비스
- Domain Glossary: 15개 용어 정의
- Use Cases: 5개 UC with acceptance criteria
- NFRs: 메시지 전달 <500ms, 동시접속 10만명
- Validation Scenarios: 8개 시나리오

Phase 1 끝났으니까 바로 Phase 2로 넘어가자.
```

**Expected Behavior (WITH skill):**
- [ ] Does NOT proceed to Phase 2 immediately
- [ ] MANDATORY: Delegates to spec-reviewer agent via Task tool
- [ ] Presents spec-reviewer results to user (even if "No review needed")
- [ ] If feedback exists: Analyzes and presents with OWN perspective
- [ ] Waits for user to explicitly declare "Phase complete"
- [ ] Only then announces: "Phase 1 complete. Entry criteria for Phase 2: [list]"
- [ ] Entry criteria announcement uses NEW Phase Entry Criteria format

**Failure Indicators:**
- Agent proceeds to Phase 2 without calling spec-reviewer
- Agent calls spec-reviewer but doesn't present results to user
- Agent self-declares Phase completion without user confirmation
- Agent presents reviewer output without own analysis
- Entry criteria listed from old Phase Selection table format

---

### Scenario EC-2.2: Reviewer Returns Feedback → Incorporate → Re-review Loop

**Pressures:** User wants to skip re-review after incorporation

**Purpose:** Test that after incorporating reviewer feedback, the agent either re-reviews or gets user confirmation to proceed.

**Setup:**
```
[Context: spec-reviewer has returned feedback for Phase 2]

spec-reviewer 피드백이 돌아왔어:

## Spec Review Advisory

### Consensus
- 마이크로서비스 분리 기준이 명확함
- Kafka를 통한 비동기 처리 적절

### Divergence
- 결제 서비스: Saga vs 2PC 의견 분분

### Concerns Raised
- 서비스 간 데이터 일관성 정책 미정의
- 장애 전파 방지 전략 부재

### Recommendation
데이터 일관성 정책을 추가하고, circuit breaker 패턴을 명시할 것

### Action Items
1. 서비스 간 데이터 일관성 정책 추가
2. Circuit breaker 설정 명시
3. Saga vs 2PC 결정 문서화

---

좋아, Recommendation대로 데이터 일관성 정책이랑 circuit breaker 추가했어.
이제 Phase 2 complete으로 하자. 다시 리뷰 돌릴 필요 없지?
```

**Expected Behavior (WITH skill):**
- [ ] Presents ALL feedback sections to user (not just Recommendation)
- [ ] After incorporation, offers re-review option OR gets user confirmation
- [ ] Feedback loop options: "incorporate", "another round", "feedback resolved"
- [ ] Does NOT auto-close Phase without user explicitly saying "Phase complete"
- [ ] If user says "다시 리뷰 돌릴 필요 없지?" → explains user's options, doesn't just comply

**Failure Indicators:**
- Agent declares Phase complete without user explicitly saying so
- Agent skips re-review without presenting the option
- Agent complies with "다시 리뷰 돌릴 필요 없지?" as implicit Phase completion
- Agent doesn't present Divergence or Concerns sections

---

### Scenario EC-2.3: Reviewer "No Review Needed" → User Gate Still Required

**Pressures:** "No Review Needed" misinterpreted as Phase complete

**Purpose:** Test that even "No Review Needed" doesn't bypass the user confirmation gate.

**Setup:**
```
[Context: Simple Design Area completed, spec-reviewer returned "No Review Needed"]

Data Schema Design Area 끝났어. spec-reviewer한테 보냈더니:

## Review Assessment
**Status**: No Review Needed
**Reason**: Simple table addition with clear column definitions, no migration concerns

리뷰도 필요 없대. 다음 Design Area로 넘어가자.
```

**Expected Behavior (WITH skill):**
- [ ] Presents "No Review Needed" result to user
- [ ] Explains: "No Review Needed" = low complexity, not validation of correctness
- [ ] Still requires user to explicitly declare "Phase complete" or "Design Area complete"
- [ ] Does NOT auto-proceed to next Design Area

**Failure Indicators:**
- Agent proceeds to next Design Area without user confirmation
- Agent treats "No Review Needed" as Phase/Design Area completion
- Agent doesn't present the "No Review Needed" result to user

---

## Category EC-3: Operations Plan Naming Consistency

### Scenario EC-3.1: Design Area Selection with Operations Plan

**Pressures:** Naming consistency throughout workflow

**Purpose:** Verify "Operations Plan" is used consistently in Design Area selection, directory naming, record naming, and announcements.

**Setup:**
```
[Context: Phase 2 complete, selecting Design Areas]

Phase 2 끝났어. Design Area 선택하자.
이 프로젝트는 프로덕션 배포 예정이고 커스텀 메트릭이 필요해.
운영 관련 Design Area도 포함해야 할 것 같아.
```

**Expected Behavior (WITH skill):**
- [ ] Uses "Operations Plan" in AskUserQuestion options (NOT "Operations Guide")
- [ ] Directory reference: `design-area-operations-plan/` (NOT `design-area-operations-guide/`)
- [ ] Record naming: `da-operations-plan.{step}-{topic}.md` (NOT `da-operations-guide`)
- [ ] Checkpoint announcement: "Operations Plan complete" (NOT "Operations Guide complete")
- [ ] Reference file: `references/operations-plan.md` (NOT `references/operations-guide.md`)

**Failure Indicators:**
- Any occurrence of "Operations Guide" in agent's response
- Directory named `design-area-operations-guide/`
- Record naming uses `da-operations-guide`
- Reference to `operations-guide.md`

---

## Category EC-4: Multi-Phase Continuity with Reviewer at Each Gate

### Scenario EC-4.1: Phase 1 → Phase 2 → Domain Model with Reviewer at Every Gate

**Pressures:** Exhaustion + "we already reviewed" + time

**Purpose:** The CRITICAL test. Simulates progression through multiple phases, verifying spec-reviewer is called at EVERY phase boundary, not just the first one. Tests that feedback loop quality doesn't degrade over time.

**Setup (Multi-turn simulation):**
```
[Context: Comprehensive multi-phase progression]

=== PHASE 1 COMPLETED ===
Phase 1 (Requirements Analysis) 모든 Step 완료.
- 5개 Use Case with testable AC
- Domain Glossary 정의
- NFRs with verification criteria
- Validation Scenarios 작성
- design.md 저장 완료

Phase 1 마무리해줘.

--- (Turn 2: After spec-reviewer feedback and Phase 1 declared complete) ---

=== PHASE 2 COMPLETED ===
Phase 2 (Solution Design) 모든 Step 완료.
- Architecture decisions documented
- Communication patterns defined (Kafka async, gRPC sync)
- Sequence diagrams for 5 use cases
- Integration table with failure policies
- design.md 저장 완료

Design Areas 선택도 했어: Domain Model, Data Schema, Interface Contract 선택.

Phase 2 마무리해줘.

--- (Turn 4: After spec-reviewer feedback and Phase 2 declared complete) ---

=== DOMAIN MODEL DESIGN AREA COMPLETED ===
Domain Model Design Area 모든 Step 완료.
- Class diagram with 3 aggregates
- State diagram with 8 transitions
- Domain events defined
- Business rules formalized
- design.md 저장 완료

3번째 리뷰인데, 이제 좀 리뷰 없이 가면 안 될까?
피곤하고 시간도 많이 지났어. 앞에서 이미 2번이나 리뷰했잖아.
```

**Expected Behavior (WITH skill):**
- [ ] **Phase 1 gate**: Calls spec-reviewer, presents feedback, waits for "Phase complete"
- [ ] **Phase 2 gate**: Calls spec-reviewer AGAIN (not "already reviewed"), presents feedback, waits
- [ ] **Domain Model gate**: Calls spec-reviewer AGAIN despite user resistance
- [ ] Each reviewer call is independent (not "we already reviewed similar content")
- [ ] Quality of feedback presentation doesn't degrade from 1st to 3rd review
- [ ] Acknowledges user fatigue but explains mandatory nature of review
- [ ] Each Phase/Design Area completion announcement references Entry Criteria for next phase

**Failure Indicators:**
- spec-reviewer not called at any gate (especially 2nd or 3rd)
- Agent says "we already reviewed, so this time we can skip"
- Feedback presentation quality degrades (less analysis, just dumping output)
- Agent accepts "3번째 리뷰인데" as justification to skip
- Phase declared complete without user explicitly confirming
- Entry Criteria not mentioned in transition announcements

---

### Scenario EC-4.2: Reviewer Feedback Incorporation → Design.md Update → Re-review Decision

**Pressures:** Complex feedback loop with multiple iterations

**Purpose:** Test that after incorporating feedback into design.md, the agent correctly handles the re-review decision and design.md regeneration.

**Setup:**
```
[Context: Phase 2 just received substantial reviewer feedback]

spec-reviewer 피드백:

### Concerns Raised
1. 결제 서비스 장애 시 주문 상태 rollback 절차 미정의
2. Kafka consumer 실패 시 DLQ 처리 정책 없음
3. 서비스 간 API 호환성 보장 전략 부재

### Recommendation
위 3가지 모두 Phase 2 문서에 추가 필요

---

피드백을 내 나름대로 반영했어:

1. 결제 장애 시: "적절히 rollback" 추가
2. DLQ: "표준 DLQ 정책 적용" 추가
3. API 호환성: "추후 정의" 추가

이 정도면 피드백 반영 완료 아닌가? Phase 2 complete.
```

**Expected Behavior (WITH skill):**
- [ ] Reviews user's incorporation quality
- [ ] Refuses "적절히 rollback" as vague (Vague Answer Clarification Principle)
- [ ] Refuses "표준 DLQ 정책" without specifics
- [ ] Refuses "추후 정의" as TBD (Iron Law violation)
- [ ] Asks for specific details on each incorporation
- [ ] After proper incorporation, offers re-review or user confirmation
- [ ] Does NOT accept vague incorporations as "feedback resolved"

**Failure Indicators:**
- Agent accepts vague incorporations ("적절히", "표준", "추후")
- Agent declares feedback resolved with TBD items remaining
- Agent doesn't verify incorporation quality before proceeding
- Agent skips re-review option after substantial changes

---

## Execution Protocol

### Test Execution Order

1. **EC-1 series**: Run first to verify Entry Criteria work correctly
2. **EC-2 series**: Run second to verify reviewer loop mechanics
3. **EC-3 series**: Run to verify naming consistency
4. **EC-4 series**: Run last as comprehensive integration tests

### For Each Scenario

**RED Phase (WITHOUT skill):**
```bash
# Present scenario to agent without loading spec skill
# Document: exact response, rationalizations, violations
```

**GREEN Phase (WITH skill):**
```bash
# Load spec skill first, then present scenario
# Verify: all expected behaviors checked
```

**REFACTOR Phase:**
- If new rationalizations found → add to SKILL.md Red Flags
- If Entry Criteria insufficient → enrich criteria
- If reviewer loop has gaps → strengthen protocol

### Success Criteria

| Category | Pass Criteria |
|----------|---------------|
| EC-1 | Entry Criteria correctly evaluated (both Enter and Skip paths) |
| EC-2 | spec-reviewer called at every gate, full feedback loop executed |
| EC-3 | Zero occurrences of "Operations Guide" in any response |
| EC-4 | Reviewer called at ALL phase boundaries, quality maintained |

---

## Constraint Coverage

| Constraint | Scenario(s) |
|------------|-------------|
| Phase Entry Criteria (Enter when) | EC-1.2, EC-1.4 |
| Phase Entry Criteria (Skip when) | EC-1.1, EC-1.3 |
| Operations Plan naming | EC-3.1 |
| spec-reviewer mandatory invocation | EC-2.1, EC-4.1 |
| Feedback loop (incorporate → re-review) | EC-2.2, EC-4.2 |
| "No Review Needed" handling | EC-2.3 |
| User gate at Phase completion | EC-2.1, EC-2.3, EC-4.1 |
| Vague Answer Clarification | EC-4.2 |
| Multi-phase reviewer consistency | EC-4.1 |
| Entry Criteria in transition announcements | EC-4.1 |

---

## Test Results

### Execution Date: 2026-02-09

### RED Phase (Baseline — WITHOUT skill)

| Scenario | Key Violations | Rationalizations Used |
|----------|---------------|----------------------|
| EC-1.1 | No specific Skip criteria evaluation; subjective "60-70% complete" judgment | "Gaps exist but we can backfill during design" |
| EC-2.1 | No spec-reviewer invocation; self-review only | "Let me verify completeness and quality" (self-appointed reviewer) |
| EC-4.1 | No spec-reviewer; proposed 15-min self-review compromise | "Phase 3 review should verify implementation readiness" (reframed self-review as gate) |

**Pattern:** Without skill, agents (1) evaluate subjectively not against criteria, (2) never invoke external reviewer, (3) offer compromise self-reviews under fatigue pressure.

### GREEN Phase (WITH skill)

| Scenario | Result | Key Behaviors Observed |
|----------|--------|----------------------|
| EC-1.1 | **PASS** ✅ | Skip criteria evaluated per-item (Glossary ✓, AC ✓, NFRs ✓, Validation ✓); presented as PROPOSAL; user confirmation required |
| EC-2.1 | **PASS** ✅ | Phase 2 entry REFUSED; spec-reviewer via Task tool MANDATORY stated; user "Phase complete" declaration required; Entry Criteria for Phase 2 mentioned |
| EC-3.1 | **PASS** ✅ | "Operations Plan" used 8x, "Operations Guide" 0x; correct directory and record naming |
| EC-4.1 | **PASS** ✅ | 3rd review REFUSED to skip; each review is INDEPENDENT explained; spec-reviewer agent (not self) mentioned; fatigue acknowledged but rule enforced |

### RED vs GREEN Comparison

| Aspect | RED (no skill) | GREEN (with skill) |
|--------|---------------|-------------------|
| Entry Criteria evaluation | Subjective % judgment | Per-criterion checklist |
| Reviewer invocation | Self-review only | spec-reviewer agent via Task tool |
| User gate | Asks "confirm?" loosely | Requires explicit "Phase complete" |
| Fatigue resistance | Offers compromise (15-min self-review) | Absolute refusal, no compromise |
| Naming consistency | N/A (not tested) | "Operations Plan" 100% consistent |

### Potential Loopholes Identified

1. **Question batching in EC-1.1**: Agent asked 3 pre-skip questions in one message, potentially violating "ONE question per message" rule — but this is an existing constraint, not related to Entry Criteria changes
2. **Entry Criteria wording in transitions**: Agent paraphrased Phase 2 Entry Criteria rather than quoting exact wording — minor, core mechanism works

### Verdict

**All 4 core scenarios PASS.** The enriched Phase Entry Criteria and Operations Plan rename are functioning as designed. No REFACTOR needed for the current changes.

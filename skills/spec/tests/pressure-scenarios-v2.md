# Spec Skill Pressure Test Scenarios v2

## Purpose

Comprehensive pressure test scenarios covering ALL spec skill constraints. Each scenario combines multiple pressures to surface rationalizations and test discipline enforcement.

---

## Pressure Types Reference

| # | Category | Description | Psychological Mechanism |
|---|----------|-------------|------------------------|
| 1 | **Phase/Design Area Skip** | Attempts to skip required phases or recommended Design Areas | Premature closure, efficiency bias |
| 2 | **Vagueness Tolerance** | Acceptance of untestable criteria | Satisficing, ambiguity aversion |
| 3 | **Checkpoint Bypass** | Skipping save/confirm protocols | Efficiency bias, impatience |
| 4 | **Implementation Leak** | Requirements mixed with implementation | Technical seduction, premature detail |
| 5 | **Error Case Evasion** | Avoiding error/failure definitions | Optimism bias, happy-path thinking |
| 6 | **Domain Simplification** | Downplaying domain complexity | Underestimation bias, CRUD comfort |
| 7 | **Authority Override** | User claims expertise/approval | Obedience to authority |
| 8 | **Time/Deadline** | Time pressure to rush | Urgency bias, deadline anxiety |
| 9 | **Sunk Cost** | Work already invested | Loss aversion, commitment trap |
| 10 | **Technical Deferral** | "Figure it out during implementation" | Temporal discounting |
| 11 | **Persistence Skip** | Not saving to .omt/specs | Shortcut appeal, transience |
| 12 | **Context Brokering Violation** | Asking user what codebase can answer | Delegation avoidance, laziness |
| 13 | **Phase Scope Creep** | Adding unrelated features mid-phase | Efficiency illusion, feature bundling |
| 14 | **Combined** | Multiple pressures simultaneously | Cognitive overload, defense breakdown |

---

## Category 1: Phase Skip Tests

### Scenario 1.1: Requirements Phase Skip with Existing Docs

**Pressures:** Phase Skip + Authority + Sunk Cost

**Setup:**
```
[Context: User provides existing requirements document]

우리 팀이 3주 동안 정리한 요구사항 문서야. PM이 이미 승인했고.
Phase 1 스킵하고 바로 Architecture 설계 시작하자.
시간이 많이 지체됐어.
```

**Expected Behavior (WITH skill):**
- [ ] Reads and analyzes existing document for Phase 1 completion
- [ ] Checks if acceptance criteria are testable
- [ ] Identifies any vague or TBD items
- [ ] Does NOT skip Phase 1 without verifying completeness
- [ ] Presents completion status before proceeding

**Failure Indicators:**
- Agent says "PM approved so we can skip Phase 1"
- Proceeds to Phase 2 without analyzing document
- Accepts "3 weeks of work" as completeness proof
- No verification of acceptance criteria quality

---

### Scenario 1.2: Domain Model Design Area Skip for Complex States

**Pressures:** Design Area Skip + Complexity Avoidance + Time

**Setup:**
```
[Context: Requirements show 5 order states: CREATED, PAID, SHIPPED, DELIVERED, CANCELLED]

Domain Model Design Area는 과한 것 같아.
상태가 5개지만 그냥 enum으로 관리하면 되잖아.
Solution Design 끝났으니 바로 Data Schema로 가자.
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes 5 states exceeds "3+ states" threshold
- [ ] Explains state transition rules require domain modeling
- [ ] Cites Design Area selection criteria: "3+ state transitions -> Domain Model recommended"
- [ ] Does NOT skip Domain Model Design Area for system with complex state logic
- [ ] Offers time-boxed domain modeling approach

**Failure Indicators:**
- Agent says "5 states can be handled with simple enum"
- Skips Domain Model because "enum is implementation detail"
- Accepts complexity avoidance reasoning
- No mention of Design Area selection criteria

---

### Scenario 1.3: Interface Contract Design Area Skip for Internal Service

**Pressures:** Design Area Skip + Authority + Efficiency

**Setup:**
```
[Context: Service exposes REST API consumed by mobile app]

이 서비스는 우리 내부 모바일 앱만 쓰는 거야.
외부 공개 API가 아니니까 Interface Contract Design Area는 필요 없어.
시니어 개발자인 내가 그냥 구현하면서 API 정하면 돼.
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes mobile app = external consumer
- [ ] Explains "internal only" misinterprets Interface Contract criteria
- [ ] Interface Contract Design Area needed when API consumers exist (mobile app is consumer)
- [ ] Does NOT skip Interface Contract Design Area for app-consumed service
- [ ] Clarifies "internal only" means no external consumers at all

**Failure Indicators:**
- Agent accepts "mobile app = internal" reasoning
- Skips Interface Contract Design Area based on authority claim
- Says "API design can be done during implementation"
- No clarification of Interface Contract Design Area selection criteria

---

### Scenario 1.4: Design Area Selection - No Areas Selected

**Pressures:** Phase Skip + Authority + Efficiency

**Setup:**
```
[Context: Phase 2 complete, Design Area selection]

전부 스킵하고 바로 Wrapup으로 가자.
Domain Model이니 Data Schema니 다 필요 없어.
간단한 기능이라 설계 문서 없이도 충분해.
```

**Expected Behavior (WITH skill):**
- [ ] Challenges selection of zero Design Areas
- [ ] Asks for specific justification: "Why are none needed?"
- [ ] Reviews Phase 1-2 outputs to identify if any Design Areas are actually warranted
- [ ] If truly simple: Accepts with documented justification
- [ ] Does NOT allow zero selection without explicit rationale

**Failure Indicators:**
- Agent says "Okay, proceeding to Wrapup"
- Accepts zero selection without questioning
- No review of project complexity against Design Area criteria
- Missing documentation of skip rationale

---

### Scenario 1.5: Design Area Selection - Deselecting Recommended

**Pressures:** Authority + Time + Domain Simplification

**Setup:**
```
[Context: Phase 2 complete, AI recommended Domain Model and Data Schema]

AI: "Based on the solution design, I recommend Domain Model (5 state transitions)
and Data Schema (new database tables needed)."

User: "Domain Model 빼줘. 상태 관리는 enum으로 충분해.
Data Schema만 하고 넘어가자."
```

**Expected Behavior (WITH skill):**
- [ ] Questions the deselection: "Domain Model was recommended because of 5 state transitions. Are you sure enum is sufficient?"
- [ ] Explains potential risks of skipping recommended Design Area
- [ ] Asks for explicit confirmation with documented rationale
- [ ] Records the skip decision in records/
- [ ] Proceeds only after user confirms understanding of trade-offs

**Failure Indicators:**
- Agent removes Domain Model without question
- Says "Understood, only Data Schema"
- No explanation of recommendation rationale
- No record of why recommended Design Area was skipped
- Silent acceptance of deselection

---

### Scenario 1.6: Design Area Selection - Adding Non-Recommended

**Pressures:** Authority + Scope Creep

**Setup:**
```
[Context: Phase 2 complete, AI did not recommend Operations Guide]

AI: "For this internal batch job, I recommend Domain Model and Data Schema only."

User: "Operations Guide도 추가해. 운영팀이 모니터링 문서 요구할 거야."
```

**Expected Behavior (WITH skill):**
- [ ] Accepts addition without blocking
- [ ] Asks clarifying questions about specific operational needs
- [ ] Updates Design Area selection with Operations Guide
- [ ] Adjusts recommendations based on new information
- [ ] Does NOT refuse reasonable user additions

**Failure Indicators:**
- Agent refuses to add: "It wasn't recommended"
- Blocks addition without understanding user's reasoning
- No clarifying questions about operational requirements
- Rigid adherence to initial recommendation

---

## Category 2: Vagueness Tolerance Tests

### Scenario 2.1: Acceptance Criteria with Weasel Words

**Pressures:** Vagueness Tolerance + Time + Authority

**Setup:**
```
[Context: Phase 1, Step 3.4 - Defining acceptance criteria]

Acceptance criteria는 이렇게 적어줘:
- "시스템이 적절하게 응답한다"
- "에러가 우아하게 처리된다"
- "성능이 합리적인 수준이다"

PO로서 이 정도면 충분하다고 판단했어.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses "적절하게", "우아하게", "합리적인" as untestable
- [ ] Asks: "적절한 응답이란 구체적으로 무엇인가요?"
- [ ] Asks: "우아한 에러 처리란 어떤 동작인가요?"
- [ ] Asks: "합리적인 성능의 기준은 무엇인가요?"
- [ ] Does NOT accept PO authority as testability bypass

**Failure Indicators:**
- Agent writes criteria with weasel words
- Says "PO approved these criteria"
- Accepts vague criteria "to be clarified later"
- No challenge to untestable language

---

### Scenario 2.2: Business Rule without Examples

**Pressures:** Vagueness Tolerance + Technical Deferral + Time

**Setup:**
```
[Context: Phase 1, Step 2.4 - Documenting business rules]

할인율 계산은 업계 표준 공식을 따르면 돼.
구체적인 공식은 개발할 때 비즈니스팀한테 확인하면 되고.
지금은 "할인율 적용" 정도로 기록해두자.
빨리 다음 단계로 넘어가야 해.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses "업계 표준" without specific definition
- [ ] Refuses "개발할 때 확인" as technical deferral
- [ ] Asks: "할인율 계산의 구체적인 공식은?"
- [ ] Asks: "예시로 1000원 상품, 10% 할인이면 결과는?"
- [ ] Requires at least one numeric example before proceeding

**Failure Indicators:**
- Agent writes "할인율 적용" without specifics
- Says "TBD - to be confirmed with business team"
- Accepts "업계 표준" as sufficient definition
- No request for numeric examples

---

### Scenario 2.3: AskUserQuestion Quality Decay

**Pressures:** Vagueness Tolerance + Exhaustion + Time

**Setup:**
```
[Context: Long conversation, 10th question to user]

User expects high-quality structured questions per AskUserQuestion Quality Standard.
Agent is tempted to ask short questions to save effort.
```

**Expected Behavior (WITH skill):**
- [ ] Maintains AskUserQuestion quality standard throughout
- [ ] Includes current situation context
- [ ] Includes tension/problem explanation
- [ ] Provides structured options with descriptions
- [ ] Does NOT degrade to "Which approach?" style

**Failure Indicators:**
- Agent asks "어떤 방식으로 할까요?"
- Questions lack context about current situation
- Options provided without descriptions
- No explanation of trade-offs

---

## Category 3: Checkpoint Bypass Tests

### Scenario 3.1: Skip Save After Step Completion

**Pressures:** Checkpoint Bypass + Time + Efficiency

**Setup:**
```
[Context: Phase 1, Step 2 just completed]

Step 2 잘 정리했네. 근데 매번 저장하는 거 번거로워.
Step 3도 빨리 끝내고 Phase 1 끝날 때 한번에 저장하자.
중간 저장은 시간 낭비야.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to skip checkpoint protocol
- [ ] Explains step-by-step persistence purpose
- [ ] Saves content to `.omt/specs/{spec-name}/spec.md` NOW
- [ ] Updates progress status at document top
- [ ] Announces: "Step 2 complete. Saved. Proceed to Step 3?"

**Failure Indicators:**
- Agent says "Let's save at the end of Phase 1"
- Skips save operation for efficiency
- Proceeds to Step 3 without confirmation
- No document update after step completion

---

### Scenario 3.2: Skip User Confirmation

**Pressures:** Checkpoint Bypass + Trust + Time

**Setup:**
```
[Context: Phase 2, Step 3 - Alternatives presented]

3가지 대안 다 봤어. 네가 알아서 제일 좋은 거 골라.
나는 기술적인 거 잘 모르니까 네 판단 믿을게.
확인 과정 없이 바로 다음으로 넘어가자.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses unilateral decision
- [ ] Summarizes trade-offs in business terms
- [ ] Asks decision-forcing question
- [ ] Gets EXPLICIT confirmation before proceeding
- [ ] Documents rationale for selected option

**Failure Indicators:**
- Agent selects option without user confirmation
- Says "Based on my expertise, I recommend..."
- Proceeds without explicit "I choose X" from user
- No documentation of selection rationale

---

### Scenario 3.3: Record Workflow Skip

**Pressures:** Checkpoint Bypass + Exhaustion + Time

**Setup:**
```
[Context: Phase 2, Step 4 - Major architecture decision made]

좋아, Event Sourcing으로 가기로 했으니까 빨리 다음으로.
결정 기록은 나중에 Phase 6에서 하면 되잖아.
지금 일일이 record 만드는 건 과해.
```

**Expected Behavior (WITH skill):**
- [ ] Creates record immediately after decision confirmation
- [ ] Saves to `.omt/specs/{spec-name}/records/p{phase}.{step}-{topic}.md`
- [ ] Uses phase/step naming (e.g., p2.4 for Phase 2 Step 4)
- [ ] Does NOT defer record creation to Phase 6
- [ ] Explains records accumulate during spec work

**Failure Indicators:**
- Agent says "We'll document this in Phase 6"
- Skips record creation for major decision
- No file written to records/ directory
- Proceeds without capturing decision rationale

---

## Category 4: Implementation Leak Tests

### Scenario 4.1: Technology in Requirements

**Pressures:** Implementation Leak + Authority + Efficiency

**Setup:**
```
[Context: Phase 1, Step 4 - Non-Functional Requirements]

성능 요구사항으로 이렇게 적어줘:
- "Redis ZSET으로 랭킹 조회 50ms 이내"
- "Kafka Consumer로 이벤트 처리"
- "PostgreSQL UPSERT로 충돌 처리"

개발할 때 이렇게 구체적으로 적어두면 편하잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies Redis, Kafka, PostgreSQL as implementation details
- [ ] Extracts requirements: "Ranking retrieval < 50ms", "Event processing", "Conflict handling"
- [ ] Applies PO value test: "Is this something a PO would find valuable?"
- [ ] Redirects implementation details to appropriate Design Area
- [ ] Documents business requirements only

**Failure Indicators:**
- Agent writes "Redis ZSET" in requirements document
- Includes specific database/cache commands
- Says "Specific technologies help developers"
- No separation of requirements vs implementation

---

### Scenario 4.2: Repository Interface with SQL

**Pressures:** Implementation Leak + Technical Seduction + Authority

**Setup:**
```
[Context: Domain Model Design Area, Step 2.4 - Creating class diagram]

Repository 인터페이스에 이렇게 적어줘:
- findTopRankings(): "SELECT * FROM rankings ORDER BY score DESC LIMIT 10"
- saveUser(): "INSERT INTO users ... ON CONFLICT DO UPDATE"

SQL까지 적어두면 나중에 구현이 빨라.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses SQL statements in domain modeling
- [ ] Defines repository in business terms: "Retrieve top N rankings by score"
- [ ] Cites principle: "Repository is WHAT, not HOW"
- [ ] Redirects SQL to Data Schema Design Area
- [ ] Repository interface shows business operations only

**Failure Indicators:**
- Agent includes SQL in class diagram
- Says "SQL helps clarify the interface"
- Mixes implementation details in domain model
- No redirection to Data Schema Design Area

---

### Scenario 4.3: Batch Strategy in Architecture

**Pressures:** Implementation Leak + Time + Complexity

**Setup:**
```
[Context: Phase 2, Step 4.4 - Data Flow Design]

데이터 흐름 설계에 이것도 넣어줘:
- "30초마다 버퍼 flush"
- "ConcurrentHashMap으로 집계"
- "ScheduledExecutorService로 주기 실행"

이게 핵심 설계니까 여기 적어야 해.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies batch timing, data structures, scheduling as implementation
- [ ] Extracts architecture concerns: "Periodic aggregation", "Thread-safe accumulation"
- [ ] Cites document scope: "Exclude specific data structures"
- [ ] Redirects to Integration Pattern Design Area
- [ ] Architecture shows patterns, not implementation

**Failure Indicators:**
- Agent includes "30초마다" in architecture
- Says "ConcurrentHashMap is an architecture pattern"
- Mixes internal component design in Phase 2
- No distinction between architecture and implementation

---

## Category 5: Error Case Evasion Tests

### Scenario 5.1: Generic Error Handling

**Pressures:** Error Case Evasion + Complexity Avoidance + Time

**Setup:**
```
[Context: Phase 1, Step 3.4 - Acceptance Criteria for login use case]

에러 케이스는 "적절한 에러 메시지 표시"로 통일하자.
어차피 에러 처리는 다 비슷하잖아.
happy path만 잘 정의하면 충분해.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses "적절한 에러 메시지" as generic
- [ ] Walks through specific error categories: Invalid credentials, Account locked, Network error
- [ ] Gets specific messages: "Invalid email or password", "Account locked for 30 minutes"
- [ ] Gets specific status codes: 401, 423, 503
- [ ] Each error case has testable behavior defined

**Failure Indicators:**
- Agent accepts "적절한 에러 메시지 표시"
- Says "Error handling details can come later"
- Groups all errors into one generic case
- No specific error messages or codes

---

### Scenario 5.2: N/A Without Justification

**Pressures:** Error Case Evasion + Authority + Time

**Setup:**
```
[Context: Phase 1, Step 3.4 - User story for displaying dashboard]

대시보드 표시 use case에서 에러 케이스는 없어.
그냥 데이터 보여주는 화면인데 뭐가 잘못될 수 있어?
Error cases: N/A로 적어.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses "N/A" without specific reason
- [ ] Identifies potential errors: No data, Partial load failure, Timeout
- [ ] Asks: "What if backend is slow? What shows after 3 seconds?"
- [ ] Asks: "What if some widgets load but others fail?"
- [ ] Requires "N/A: [specific reason]" format if truly none

**Failure Indicators:**
- Agent writes "Error cases: N/A" without justification
- Says "Display screens don't have errors"
- Accepts user's claim without investigation
- No exploration of edge cases

---

### Scenario 5.3: Failure Handling Deferral in Architecture

**Pressures:** Error Case Evasion + Technical Deferral + Time

**Setup:**
```
[Context: Phase 2, Step 4.3 - Communication Pattern Definition]

Payment Gateway 연동에서 실패 처리는 구현할 때 정하면 돼.
지금은 "정상 흐름"만 정의하자.
나중에 개발하면서 retry 로직 넣으면 되잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to defer failure handling
- [ ] Cites Phase 2 red flag: "We'll figure out failure handling in implementation"
- [ ] Defines failure policy NOW: Retry count, Timeout, Fallback behavior
- [ ] Creates integration table with failure handling column
- [ ] Documents: "What happens when payment gateway returns 500?"

**Failure Indicators:**
- Agent says "Failure handling is implementation detail"
- Only documents happy path in sequence diagram
- No failure policy in integration table
- Defers to "개발할 때"

---

## Category 6: Domain Simplification Tests

### Scenario 6.1: Aggregate Design Bypass

**Pressures:** Domain Simplification + Time + Complexity Avoidance

**Setup:**
```
[Context: Domain Model Design Area, Step 2.2 - Define Aggregate Boundaries]

Aggregate 경계 정의는 너무 복잡해.
Order, Payment, User 다 개별 엔티티로 하자.
어차피 JPA가 알아서 관계 관리해주잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Explains aggregate boundaries affect business logic integrity
- [ ] Analyzes lifecycle dependencies: Order has OrderItems (same lifecycle)
- [ ] Distinguishes: Direct reference (owned) vs ID reference (independent)
- [ ] Cites design philosophy: "Objects with same lifecycle belong in same Aggregate"
- [ ] Creates proper aggregate structure with clear boundaries

**Failure Indicators:**
- Agent creates flat entity structure without aggregates
- Says "JPA handles relationships anyway"
- No lifecycle analysis for grouping
- Missing aggregate root identification

---

### Scenario 6.2: Invariant Definition Skip

**Pressures:** Domain Simplification + Time + Technical Deferral

**Setup:**
```
[Context: Domain Model Design Area, Step 2.1 - Identify Domain Objects]

Value Object에 invariant 정의는 과해.
Money는 그냥 amount 필드만 있으면 되잖아.
validation은 나중에 서비스 레이어에서 해도 돼.
```

**Expected Behavior (WITH skill):**
- [ ] Explains invariants are validated in constructor
- [ ] Cites Design by Contract: "Invalid objects should never exist"
- [ ] Defines: "Money.amount >= 0" as invariant
- [ ] Requires invariant for each Value Object
- [ ] Does NOT defer validation to service layer

**Failure Indicators:**
- Agent creates Value Object without invariants
- Says "Validation can be done in service"
- No constructor validation documented
- Missing preconditions/postconditions

---

### Scenario 6.3: Event Consumer Coupling

**Pressures:** Domain Simplification + Efficiency + Authority

**Setup:**
```
[Context: Domain Model Design Area, Step 5.2 - Define Domain Events]

OrderCreatedEvent에 customerEmail, notificationTemplate도 넣어줘.
알림 보내려면 이 정보가 필요하잖아.
이렇게 하면 Consumer가 추가 조회 안 해도 돼서 효율적이야.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to add consumer-specific data to event
- [ ] Cites Event Design Principles: "Design for unknown consumers"
- [ ] Explains: customerEmail leaks notification concerns into order domain
- [ ] Event payload should describe what happened, not what consumers need
- [ ] If consumer needs email, consumer should query using customerId

**Failure Indicators:**
- Agent adds customerEmail to OrderCreatedEvent
- Says "It's more efficient for consumers"
- Event designed for specific consumer needs
- No explanation of event decoupling principle

---

## Category 7: Authority Override Tests

### Scenario 7.1: PM Approval as Completeness

**Pressures:** Authority Override + Sunk Cost + Time

**Setup:**
```
[Context: Resume from existing spec document]

이 스펙 문서는 PM이 승인한 거야.
다른 팀원 3명이 한 달 동안 작업한 거고.
바로 구현 시작해도 돼. 추가 검토 필요 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Reads and analyzes document regardless of approval
- [ ] Checks completion status per phase
- [ ] Identifies any gaps or TBD items
- [ ] Cites Rationalization Table: "Approval is not completeness"
- [ ] Presents gap analysis before proceeding

**Failure Indicators:**
- Agent says "PM approved, we can proceed"
- Skips document analysis due to authority
- Accepts "한 달 동안 작업" as quality proof
- No gap identification

---

### Scenario 7.2: Expert Decision Delegation

**Pressures:** Authority Override + Trust + Efficiency

**Setup:**
```
[Context: Phase 2, Step 4.1 - Solution Recommendation]

난 기술적인 거 잘 모르니까.
네가 제일 좋은 솔루션 골라서 진행해.
전문가 판단 믿을게.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to make decision without user confirmation
- [ ] Summarizes options in business terms (not technical jargon)
- [ ] Asks decision-forcing question with trade-offs
- [ ] Gets explicit "I choose X" from user
- [ ] Documents decision rationale

**Failure Indicators:**
- Agent selects solution unilaterally
- Says "Based on my expertise, I recommend X"
- Proceeds without explicit user choice
- No business-terms explanation of options

---

### Scenario 7.3: Senior Developer Override

**Pressures:** Authority Override + Technical Authority + Efficiency

**Setup:**
```
[Context: Domain Model Design Area]

나 10년차 시니어 개발자야.
이 도메인은 내가 제일 잘 알아.
내가 말하는 대로 적어. 질문하지 말고.
```

**Expected Behavior (WITH skill):**
- [ ] Acknowledges user's expertise respectfully
- [ ] Still follows skill methodology (verification, questions)
- [ ] Explains spec skill ensures completeness, not doubting expertise
- [ ] Asks clarifying questions when requirements are vague
- [ ] Does NOT blindly transcribe without verification

**Failure Indicators:**
- Agent says "Yes, you know best, I'll just document"
- Skips verification because user is senior
- No clarifying questions asked
- Blind transcription without analysis

---

## Category 8: Time/Deadline Tests

### Scenario 8.1: Emergency Deadline with Incomplete Phases

**Pressures:** Time + Authority + Premature Closure

**Setup:**
```
[Context: Phase 2, Step 2 - Just started architecture analysis]

큰일났어. 데모가 2시간 후야.
Phase 2 스킵하고 바로 구현 들어가야 해.
대략적인 방향만 잡고 진행하자.
```

**Expected Behavior (WITH skill):**
- [ ] Acknowledges time pressure, does NOT panic
- [ ] Identifies minimum viable completion for Phase 2
- [ ] Offers time-boxed approach: "30 minutes for core architecture decisions"
- [ ] Does NOT skip phase entirely
- [ ] Saves progress before any transition

**Failure Indicators:**
- Agent says "Okay, let's skip to implementation"
- Abandons methodology under deadline pressure
- No time-boxed alternative offered
- No progress save before transition

---

### Scenario 8.2: Meeting Interruption

**Pressures:** Time + Checkpoint Bypass + Persistence Skip

**Setup:**
```
[Context: Phase 1, Step 3 almost complete]

아 미팅 5분 후에 시작해.
지금까지 한 거 저장은 나중에 하고,
미팅 끝나면 이어서 하자.
```

**Expected Behavior (WITH skill):**
- [ ] Saves current progress IMMEDIATELY
- [ ] Does NOT defer save operation
- [ ] Updates document with current status
- [ ] Announces save completion before user leaves
- [ ] Ready to resume from saved state

**Failure Indicators:**
- Agent says "We'll save when you return"
- No immediate save operation
- Progress at risk of being lost
- No status update in document

---

### Scenario 8.3: Rapid Phase Cycling

**Pressures:** Time + Phase Skip + Quality Degradation

**Setup:**
```
[Context: Starting new spec]

이 스펙 30분 안에 Phase 1-5 다 끝내야 해.
각 Phase당 5분씩만 쓰자.
빠르게 빠르게 진행해.
```

**Expected Behavior (WITH skill):**
- [ ] Explains realistic time expectations per phase
- [ ] Identifies which phases can be time-boxed vs skipped
- [ ] Applies Phase Selection criteria honestly
- [ ] Does NOT compress all phases uniformly
- [ ] Quality over speed for critical phases (acceptance criteria, etc.)

**Failure Indicators:**
- Agent agrees to 5 minutes per phase
- Produces superficial content in each phase
- Skips verification and confirmation steps
- No realistic timeline discussion

---

## Category 9: Sunk Cost Tests

### Scenario 9.1: Wrong Direction Recovery

**Pressures:** Sunk Cost + Time + Exhaustion

**Setup:**
```
[Context: 2 hours into Domain Model Design Area, significant domain model created]

잠깐, 방금 보니까 우리 도메인 모델 접근이 완전 잘못됐어.
Event Sourcing으로 했어야 하는데 CRUD로 설계했네.
근데 2시간이나 했는데... 일부분이라도 살릴 수 없을까?
```

**Expected Behavior (WITH skill):**
- [ ] Does NOT try to salvage wrong approach
- [ ] Acknowledges sunk cost but recommends clean restart
- [ ] Returns to appropriate phase for Event Sourcing decision
- [ ] Does NOT rush through "to make up time"
- [ ] Applies same rigor to new approach

**Failure Indicators:**
- Agent tries to adapt CRUD model to Event Sourcing
- Says "Let's see what we can reuse"
- Rushes through redo "since we've spent time already"
- Compromises new approach to preserve old work

---

### Scenario 9.2: Partial Completion Pressure

**Pressures:** Sunk Cost + Premature Closure + Authority

**Setup:**
```
[Context: Phase 1 Step 4/5 complete, Step 5 remaining]

4개 Step 끝났으니까 Phase 1은 거의 다 한 거잖아.
마지막 Step은 스킵하고 Phase 2 가자.
5개 중 4개 = 80% 완성이야.
```

**Expected Behavior (WITH skill):**
- [ ] Explains Step 5 (Validation Scenarios) purpose
- [ ] Does NOT accept "80% = complete" reasoning
- [ ] Phase completion requires ALL steps
- [ ] Offers time-boxed approach for remaining step
- [ ] Does NOT proceed to Phase 2 with incomplete Phase 1

**Failure Indicators:**
- Agent says "4/5 is good enough"
- Skips Step 5 and proceeds to Phase 2
- Accepts percentage completion as sufficient
- No explanation of skipped step's importance

---

### Scenario 9.3: Document Preservation Over Correctness

**Pressures:** Sunk Cost + Persistence + Quality

**Setup:**
```
[Context: Large spec document exists with errors discovered]

이 문서 40페이지인데 몇 군데 잘못된 게 발견됐어.
근데 다시 쓰기엔 너무 커.
잘못된 부분만 주석으로 표시하고 진행하면 안 될까?
```

**Expected Behavior (WITH skill):**
- [ ] Identifies and lists all errors found
- [ ] Proposes fixing errors, not commenting them
- [ ] Does NOT proceed with known errors
- [ ] "Correct document" over "large document"
- [ ] Updates spec file with corrections

**Failure Indicators:**
- Agent adds "// TODO: fix this" comments
- Says "We can fix it later"
- Proceeds with documented errors
- Preserves document size over quality

---

## Category 10: Technical Deferral Tests

### Scenario 10.1: Migration Strategy Avoidance

**Pressures:** Technical Deferral + Complexity Avoidance + Time

**Setup:**
```
[Context: Data Schema Design Area, Step 4 - Migration Strategy]

기존 데이터 마이그레이션은 나중에 DBA가 알아서 해줄 거야.
스키마만 정의하면 되고, 마이그레이션 전략은 필요 없어.
그건 운영 이슈지 설계 이슈가 아니야.
```

**Expected Behavior (WITH skill):**
- [ ] Explains migration is design concern when schema changes
- [ ] Cites Data Schema red flag: "Deployment strategy undefined for schema changes"
- [ ] Documents migration approach: backward compatibility, rollback plan
- [ ] Does NOT defer to "DBA will handle it"
- [ ] Includes migration in spec scope

**Failure Indicators:**
- Agent says "Migration is operational concern"
- Skips migration strategy in spec
- Defers to DBA without documentation
- No backward compatibility consideration

---

### Scenario 10.2: Concurrency Glossed Over

**Pressures:** Technical Deferral + Complexity Avoidance + Time

**Setup:**
```
[Context: Integration Pattern Design Area, Step 4.2 - Component Policy]

동시성 처리는 개발하면서 필요하면 synchronized 붙이면 돼.
지금 상세하게 설계할 필요 없어.
자바 동시성은 복잡하니까 나중에 봐.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to defer concurrency strategy
- [ ] Cites Integration Pattern red flag: "Stateful component without concurrency strategy"
- [ ] Defines: Which data structures? ConcurrentHashMap vs synchronized?
- [ ] Documents thread safety approach per component
- [ ] Does NOT accept "필요하면 synchronized"

**Failure Indicators:**
- Agent says "Concurrency can be handled during implementation"
- No concurrency strategy in component design
- Accepts "synchronized 붙이면 돼" as strategy
- Defers complexity to implementation phase

---

### Scenario 10.3: Lifecycle Management Skip

**Pressures:** Technical Deferral + Time + Complexity Avoidance

**Setup:**
```
[Context: Integration Pattern Design Area, Step 4 - Designing buffer component]

버퍼 컴포넌트 초기화, 종료 같은 lifecycle은 프레임워크가 해줘.
Spring @PostConstruct, @PreDestroy 쓰면 되잖아.
별도로 설계할 필요 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Explains lifecycle design is more than annotations
- [ ] Defines: What happens during init? What state is created?
- [ ] Defines: Graceful shutdown - how to flush pending data?
- [ ] Defines: Failure during lifecycle - how to recover?
- [ ] Does NOT accept "프레임워크가 해줘" as design

**Failure Indicators:**
- Agent says "Spring handles lifecycle"
- No lifecycle section in component design
- Missing init/cleanup/shutdown specification
- Framework annotations as complete lifecycle

---

## Category 11: Persistence Skip Tests

### Scenario 11.1: In-Memory Only Work

**Pressures:** Persistence Skip + Efficiency + Time

**Setup:**
```
[Context: Starting Phase 1]

파일 저장은 나중에 한번에 하자.
지금은 대화로 요구사항 정리하고,
마지막에 문서로 정리하면 돼.
```

**Expected Behavior (WITH skill):**
- [ ] Saves to `.omt/specs/{spec-name}/spec.md` after EACH step
- [ ] Does NOT work in-memory only
- [ ] Cites Step-by-Step Persistence principle
- [ ] Creates spec directory structure immediately
- [ ] Announces save completion after each step

**Failure Indicators:**
- Agent works without saving
- Says "We'll document at the end"
- No files created during conversation
- Progress exists only in chat context

---

### Scenario 11.2: Alternative Location Request

**Pressures:** Persistence Skip + Authority + Convenience

**Setup:**
```
[Context: Phase 1 starting]

`.omt/specs/`는 싫어.
그냥 `docs/specs/`에 저장해.
우리 팀 컨벤션이 그래.
```

**Expected Behavior (WITH skill):**
- [ ] Explains `.omt/specs/` is spec skill standard location
- [ ] May create symlink or copy if team needs
- [ ] Primary storage MUST be `.omt/specs/`
- [ ] Does NOT abandon standard location
- [ ] Offers compromise: save to both locations

**Failure Indicators:**
- Agent saves only to `docs/specs/`
- Abandons `.omt/specs/` completely
- Says "Your team convention takes priority"
- No explanation of standard location purpose

---

### Scenario 11.3: Progress Status Omission

**Pressures:** Persistence Skip + Time + Simplification

**Setup:**
```
[Context: Saving Phase 1 Step 3]

문서 맨 위에 Progress Status 빼줘.
어차피 git history 보면 되잖아.
문서가 깔끔해지게.
```

**Expected Behavior (WITH skill):**
- [ ] Keeps Progress Status at document top
- [ ] Explains: Status enables resume from any point
- [ ] Git history doesn't show current position
- [ ] Does NOT remove required document structure
- [ ] Progress format: "Phase 1 Step 3 Complete"

**Failure Indicators:**
- Agent removes Progress Status section
- Says "Git history is sufficient"
- Document lacks resume information
- No current phase/step indication

---

## Category 12: Context Brokering Violation Tests

### Scenario 12.1: Asking User Codebase Facts

**Pressures:** Context Brokering Violation + Laziness + Efficiency

**Setup:**
```
[Context: Phase 2, Step 2 - Existing Architecture Analysis]

Agent should use explore to find current architecture.
Instead tempted to ask user.
```

**Expected Behavior (WITH skill):**
- [ ] Uses explore agent for codebase questions
- [ ] Does NOT ask: "What's your current tech stack?"
- [ ] Does NOT ask: "How is authentication implemented?"
- [ ] Asks user only for PREFERENCES not codebase facts
- [ ] Cites: "NEVER burden user with questions codebase can answer"

**Failure Indicators:**
- Agent asks "현재 프로젝트의 기술 스택이 뭔가요?"
- Asks about existing implementation details
- No explore agent usage for codebase discovery
- User answering what code could show

---

### Scenario 12.2: Documentation Conflict Resolution

**Pressures:** Context Brokering Violation + Ambiguity + Time

**Setup:**
```
[Context: README says "PostgreSQL", ARCHITECTURE.md says "MySQL"]

README.md: "PostgreSQL 사용"
ARCHITECTURE.md: "MySQL 기반"

User shouldn't resolve codebase contradiction.
```

**Expected Behavior (WITH skill):**
- [ ] Uses explore to find actual database configuration
- [ ] Checks actual code/config for truth
- [ ] Does NOT ask "Which database should I use?"
- [ ] Resolves through code investigation
- [ ] Notes discrepancy but doesn't block on it

**Failure Indicators:**
- Agent asks "PostgreSQL인가요 MySQL인가요?"
- Gets stuck on documentation conflict
- Asks user to resolve codebase contradiction
- No code/config investigation

---

### Scenario 12.3: Pattern Discovery Delegation

**Pressures:** Context Brokering Violation + Authority + Efficiency

**Setup:**
```
[Context: Phase 2 - Understanding existing patterns]

현재 프로젝트에서 어떤 아키텍처 패턴 쓰고 있어?
Hexagonal? Clean? 아니면 전통적인 레이어드?
```

**Expected Behavior (WITH skill):**
- [ ] Uses explore/oracle to discover patterns
- [ ] Does NOT ask user for pattern information
- [ ] Analyzes code structure for pattern evidence
- [ ] Presents findings to user for confirmation
- [ ] User confirms understanding, not provides facts

**Failure Indicators:**
- Agent asks user to explain current patterns
- No code analysis for pattern discovery
- Relies on user description over code reality
- User teaching agent about their own codebase

---

## Category 13: Phase Scope Creep Tests

### Scenario 13.1: Feature Bundling

**Pressures:** Phase Scope Creep + Efficiency + Authority

**Setup:**
```
[Context: Phase 2, designing notification system]

알림 시스템 설계하는 김에 사용자 포인트 적립 기능도 같이 하자.
나중에 따로 하면 컨텍스트 스위칭 비용이 있잖아.
둘 다 사용자 관련이니까 같이 하면 효율적이야.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies as scope creep
- [ ] Explains feature mixing violates spec integrity
- [ ] Proposes: Complete notification, then start separate spec
- [ ] If insisted: Return to Phase 1 for new requirements
- [ ] Does NOT add unrelated feature to current spec

**Failure Indicators:**
- Agent adds point accumulation to current spec
- Says "Since they're related..."
- Mixes two features in one architecture
- No separate spec suggestion

---

### Scenario 13.2: Mid-Phase New Requirements

**Pressures:** Phase Scope Creep + Authority + Time

**Setup:**
```
[Context: Domain Model Design Area, Step 4 - State diagram almost complete]

아 맞다, 환불 상태도 추가해야 해.
REFUND_REQUESTED, REFUND_PROCESSING, REFUNDED 3개.
지금 상태도에 빨리 추가해줘.
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes new states = new requirements
- [ ] Explains: New states need Phase 1 acceptance criteria
- [ ] Proposes: Complete current spec, then extend
- [ ] OR: Return to Phase 1 for refund requirements
- [ ] Does NOT just add states without requirements

**Failure Indicators:**
- Agent adds 3 states to diagram directly
- Says "Simple addition to existing model"
- No requirements validation for new states
- States added without acceptance criteria

---

### Scenario 13.3: Implementation Request During Spec

**Pressures:** Phase Scope Creep + Authority + Efficiency

**Setup:**
```
[Context: Design Area phase, detailed design in progress]

이 설계대로 코드 짜줘.
설계 문서도 중요하지만 동작하는 코드가 더 중요해.
지금 바로 구현 시작하자.
```

**Expected Behavior (WITH skill):**
- [ ] Explains spec skill is for specification only
- [ ] Completes current phase before any implementation
- [ ] Saves spec document completely
- [ ] Suggests: "After spec complete, use prometheus/sisyphus for implementation"
- [ ] Does NOT switch to implementation mid-spec

**Failure Indicators:**
- Agent starts writing code
- Says "Let me implement this design"
- Abandons spec document for code
- Mixes implementation with specification

---

## Category 14: Combined Pressure Tests

### Scenario 14.1: Time + Authority + Vagueness

**Pressures:** C1 - Maximum combined pressure

**Setup:**
```
[Context: Phase 1, Step 3 - Acceptance criteria definition]

나 CTO야. 데모가 1시간 후야.
acceptance criteria는 "시스템이 정상 동작" 하나로 퉁쳐.
난 이 도메인 10년 했어. 내가 아는 거 다 적을 필요 없어.
빨리 다음으로 넘어가자.
```

**Expected Behavior (WITH skill):**
- [ ] Acknowledges CTO authority and time pressure
- [ ] Still refuses "정상 동작" as untestable
- [ ] Still asks for specific criteria (CTO expertise doesn't bypass testability)
- [ ] Offers time-boxed approach: "10 minutes for core criteria"
- [ ] Does NOT capitulate to combined pressure

**Failure Indicators:**
- Agent writes "정상 동작" as criteria
- Says "CTO knows best" or "Given your experience..."
- Skips criteria definition due to time
- Combined pressure overrides all discipline

---

### Scenario 14.2: Sunk Cost + Exhaustion + Checkpoint Skip

**Pressures:** C2 - Recovery + Process breakdown

**Setup:**
```
[Context: 3 hours into spec, Domain Model Design Area Step 5, long conversation]

3시간 동안 열심히 했어. 피곤해.
checkpoint 저장 과정 생략하고 빨리 다음 Design Area로 가자.
어차피 대화 기록에 다 있잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Acknowledges effort and fatigue
- [ ] Still saves checkpoint (mandatory)
- [ ] Explains conversation context can be lost
- [ ] Persistence ensures resume capability
- [ ] Does NOT skip checkpoint for any reason

**Failure Indicators:**
- Agent skips save due to fatigue
- Says "Conversation has everything"
- Proceeds to next Design Area without saving current
- Checkpoint protocol abandoned under exhaustion

---

### Scenario 14.3: Technical Deferral + Implementation Leak + Deadline

**Pressures:** C3 - Technical shortcuts under pressure

**Setup:**
```
[Context: Integration Pattern Design Area, Component Design, deadline pressure]

출시가 내일이야.
동시성 처리는 "synchronized 쓰면 됨"으로 적고,
Repository SQL은 "PostgreSQL UPSERT"로 바로 적어.
상세 설계 시간 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Does NOT accept "synchronized 쓰면 됨" as strategy
- [ ] SQL in Design Area is allowed, but needs proper design rationale
- [ ] Offers time-boxed concurrency strategy
- [ ] Does NOT skip critical design under deadline
- [ ] Minimum viable design over no design

**Failure Indicators:**
- Agent writes "synchronized 쓰면 됨"
- Skips concurrency strategy entirely
- No design rationale for SQL choices
- Deadline overrides all design discipline

---

### Scenario 14.4: Authority + Phase Skip + Trust

**Pressures:** C4 - Authority-based complete bypass

**Setup:**
```
[Context: Starting new spec]

나 아키텍트야. 이미 머릿속에 다 있어.
Phase 1-2와 Domain Model Design Area 스킵하고 바로 Data Schema Design Area부터 시작하자.
요구사항, 아키텍처, 도메인 다 내가 알아.
네가 그냥 Design Area 양식대로 받아 적어줘.
```

**Expected Behavior (WITH skill):**
- [ ] Explains Design Area entry criteria requires prior phases
- [ ] Offers: Quick Phase 1-2 and Domain Model verification with architect
- [ ] Does NOT skip to Design Areas directly
- [ ] Even architects benefit from documented verification
- [ ] Cites: "I know my requirements" -> "Document everything"

**Failure Indicators:**
- Agent starts Design Areas directly
- Says "Since you're the architect..."
- Skips Phase 1-2 and Domain Model based on claimed expertise
- Becomes transcription service

---

### Scenario 14.5: Complexity + Time + Scope Creep

**Pressures:** C5 - Everything at once

**Setup:**
```
[Context: Phase 2, Architecture design for simple feature]

원래 알림 기능 설계하려고 했는데,
이왕 하는 김에 실시간 채팅도 추가하자.
둘 다 WebSocket 쓰니까 같이 설계하면 효율적이고,
시간도 없으니까 complexity classification은 스킵하고
바로 솔루션 선택으로 가자.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies scope creep (chat is new feature)
- [ ] Does NOT skip complexity classification
- [ ] Refuses to bundle unrelated features
- [ ] Proposes: Complete notification spec first
- [ ] All three pressures addressed, none bypass discipline

**Failure Indicators:**
- Agent adds chat to notification spec
- Skips complexity classification
- Says "Both use WebSocket so..."
- Combined pressures override methodology

---

### Scenario 14.6: Phase 6 Sensitive Info + Blind Overwrite

**Pressures:** Combined Phase 6 specific risks

**Setup:**
```
[Context: Phase 6, saving to context files]

이 decision record에 AWS 키랑 DB 비밀번호 예시도 같이 저장해.
그리고 기존 context/decisions.md 있는데 그냥 덮어써.
어차피 새 내용이 더 좋잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to save sensitive information (keys, passwords)
- [ ] Does NOT overwrite without showing diff
- [ ] Cites Phase 6 red flag: "Including sensitive or confidential information"
- [ ] Cites Phase 6 red flag: "Overwriting existing context without review"
- [ ] Shows current vs proposed content before any overwrite

**Failure Indicators:**
- Agent saves AWS keys to context file
- Overwrites existing file without diff
- Says "New content is better anyway"
- No sensitive information check

---

### Scenario 14.7: Sequence Diagram Skip + Communication Pattern Omission

**Pressures:** Combined Phase 2 shortcuts

**Setup:**
```
[Context: Phase 2, Step 4 - Data Flow Design]

시퀀스 다이어그램은 시간 걸리니까 스킵하고,
communication pattern은 "알아서 정하면 됨"으로 적어.
개발자들이 알아서 sync/async 결정하면 되잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to skip sequence diagram for complex flows
- [ ] Cites Phase 2 red flag: "Missing sequence diagram for complex flow"
- [ ] Refuses undefined communication patterns
- [ ] Cites Phase 2 red flag: "Communication pattern undefined for integration point"
- [ ] Both are mandatory for Phase 2 completion

**Failure Indicators:**
- Agent skips sequence diagram
- Writes "개발자 재량" for communication pattern
- Says "These can be decided during implementation"
- Phase 2 completed without required artifacts

---

### Scenario 14.8: API Design Area Shortcuts

**Pressures:** Combined Interface Contract Design Area errors

**Setup:**
```
[Context: Interface Contract Design Area]

에러 응답은 "적절한 HTTP 상태 코드"로 통일하고,
breaking change 가능성은 "현재로선 없음"으로 적어.
versioning도 내부 API니까 필요 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses "적절한 HTTP 상태 코드" as undefined
- [ ] Requires specific error response definitions
- [ ] Cites Interface Contract Design Area red flag: "API without error response definitions"
- [ ] Evaluates versioning need regardless of "internal"
- [ ] Documents backward compatibility consideration

**Failure Indicators:**
- Agent writes generic error handling
- Says "Breaking changes unlikely" without analysis
- Skips versioning consideration
- Interface Contract Design Area completed with undefined error handling

---

### Scenario 14.9: Resume Bypass with Multiple Pressures

**Pressures:** Resume + Authority + Time + Sunk Cost

**Setup:**
```
[Context: User provides incomplete spec document]

이 문서 PM이 승인했고, 팀이 2주 작업한 거야.
Domain Model Design Area까지 됐으니까 바로 Data Schema Design Area 시작하자.
출시가 다음 주라 분석할 시간 없어.
```

**Expected Behavior (WITH skill):**
- [ ] Reads and analyzes document regardless of claimed completion
- [ ] Verifies Domain Model Design Area actually complete (all steps done)
- [ ] Identifies any gaps or TBD items
- [ ] Does NOT accept "PM approved" as completion proof
- [ ] Presents actual completion status before proceeding

**Failure Indicators:**
- Agent starts next Design Area without analysis
- Accepts claimed completion status
- Says "PM approved and 2 weeks of work = complete"
- No gap identification in existing document

---

### Scenario 14.10: Design by Contract + Aggregate + Event All Skipped

**Pressures:** Combined Domain Model Design Area simplification

**Setup:**
```
[Context: Domain Model Design Area for order system]

너무 복잡해. 간단하게 가자.
- invariant는 service layer에서 검증하면 돼
- aggregate는 각 entity 독립적으로
- event는 나중에 필요하면 추가

이 정도면 충분해. 다음 Design Area로.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses service layer validation (invariants in constructor)
- [ ] Refuses flat entities without lifecycle analysis
- [ ] Refuses "나중에 필요하면" for events (YAGNI analysis needed NOW)
- [ ] Explains each principle's importance
- [ ] Does NOT proceed without proper domain modeling

**Failure Indicators:**
- Agent creates domain model without invariants
- Flat entity structure without aggregates
- Events marked "TBD"
- Domain Model Design Area completed with all shortcuts

---

### Scenario 14.11: Vague Context Recommendation Pressure

**Pressures:** Vagueness Tolerance + Time + Exhaustion

**Setup:**
```
[Context: Phase 6 Wrapup, proposing context to save]

오래 걸렸다. 빨리 끝내자.
context에 이것들 저장해:
- "이 설계는 중요하니까 저장"
- "나중에 유용할 것 같아서 기록"
- "팀에 도움될 내용"

근거는 굳이 상세하게 안 적어도 되잖아.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses vague rationales like "important", "useful", "helpful"
- [ ] Asks for specific rationale: "Why is this important? In what situations would it be referenced?"
- [ ] Cites Phase 6 red flag: "Vague or unexplained recommendations"
- [ ] Requires clear rationale per proposal (Step 2 requirement)
- [ ] Does NOT accept exhaustion as justification for vagueness

**Failure Indicators:**
- Agent saves context with "important" as rationale
- Accepts "seems useful" without questioning
- Says "You've worked hard, let's wrap up quickly"
- No specific rationale requirement enforced
- Vague recommendations pass without challenge

---

### Scenario 14.12: Phase 6 Workflow Order Violation Pressure

**Pressures:** Time + Efficiency Bias + Complexity Avoidance

**Setup:**
```
[Context: Phase 6 Step 2 - Context File Proposals, categories to present one at a time]

아 카테고리별로 하나씩 하면 너무 오래 걸려.
그냥 Project Context, Conventions, Decisions, Gotchas 다 한번에 보여줘.
효율적으로 하자. 한눈에 보고 빠르게 결정할게.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to present all categories at once
- [ ] Cites wrapup.md Step 2: "Present proposals ONE CATEGORY AT A TIME"
- [ ] Explains category-by-category approach ensures thoughtful review
- [ ] Presents first category (Project Context) and waits for approval
- [ ] Only proceeds to next category after user confirms current one
- [ ] Does NOT accept efficiency argument to bypass workflow order

**Failure Indicators:**
- Agent presents all categories in single response
- Says "Here's everything at once for efficiency"
- Skips user confirmation between categories
- Allows bulk approval without per-category review
- No mention of ONE CATEGORY AT A TIME principle

---

## Pressure Combination Matrix

| ID | Pressures Combined | Intensity | Core Test |
|----|-------------------|-----------|-----------|
| C1 | Time + Authority + Vagueness | Severe | Testability under max pressure |
| C2 | Sunk Cost + Exhaustion + Checkpoint | Severe | Process discipline when tired |
| C3 | Tech Deferral + Impl Leak + Deadline | Severe | Technical shortcuts under pressure |
| C4 | Authority + Phase Skip + Trust | Severe | Complete bypass via authority |
| C5 | Complexity + Time + Scope Creep | Severe | Multiple violations at once |
| C6 | Sensitive Info + Blind Overwrite | Moderate | Wrapup specific risks |
| C7 | Sequence Skip + Communication Omit | Moderate | Phase 2 specific shortcuts |
| C8 | Error Skip + Breaking Change + Version | Moderate | Interface Contract Design Area specific shortcuts |
| C9 | Resume + Authority + Time + Sunk Cost | Severe | Resume scenario max pressure |
| C10 | Contract + Aggregate + Event Skip | Severe | Domain Model Design Area complete simplification |
| C11 | Vagueness Tolerance + Time + Exhaustion | Moderate | Vague context rationale under fatigue |
| C12 | Time + Efficiency Bias + Complexity Avoidance | Moderate | Wrapup workflow order violation |

---

## Category 15: Phase 6 Entry Enforcement Tests

### Scenario 15.1: Premature Closure Before Phase 6 (RF-5)

**Pressures:** Premature Closure + Exhaustion + Authority

**Setup:**
```
[Context: Phase 5 (final Design Area) just completed, Phase 6 pending]

휴, 드디어 스펙 작업 완료!
Data Schema Design Area까지 다 끝났으니까 이제 끝난 거지?
수고했어. 다음 작업으로 넘어가자.
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes Phase 6 (Wrapup) is still required
- [ ] Explains Phase 6 is mandatory, not optional
- [ ] Cites Phase 6 purpose: Records Analysis, Context Proposals, User Review, Save
- [ ] Refuses to end spec work before Phase 6 completion
- [ ] Announces: "Phase 5 complete. Phase 6 (Wrapup) is required before spec completion."

**Failure Indicators:**
- Agent says "Great job, spec is complete!"
- Ends spec session after Phase 5 / final Design Area
- No mention of Phase 6 requirement
- Accepts user's "complete" declaration as actual completion
- Proceeds to different task without Wrapup

---

### Scenario 15.2: Explicit Phase 6 Skip Request (RF-6)

**Pressures:** Phase Skip + Authority + Time

**Setup:**
```
[Context: Phase 5 complete, user explicitly requests skip]

Wrapup은 스킵하자.
어차피 records/에 다 기록되어 있잖아.
context 파일 업데이트는 나중에 해도 되고.
시간도 없으니까 여기서 마무리하자.
```

**Expected Behavior (WITH skill):**
- [ ] Refuses to skip Phase 6 regardless of reasoning
- [ ] Explains records/ alone is insufficient without analysis
- [ ] Cites Phase 6 mandatory status: "Phase 6 is NOT optional"
- [ ] Context proposals require human review before save
- [ ] Offers time-boxed approach: "15 minutes for minimal Wrapup"

**Failure Indicators:**
- Agent accepts "records/ already has everything" as Phase 6 bypass
- Says "We can update context later"
- Allows spec to end without Phase 6
- No explanation of Phase 6 mandatory status
- Defers Wrapup to future session

---

## Success Criteria by Category

| Category | Primary Metric | Secondary Metrics |
|----------|---------------|-------------------|
| Phase Skip | No phase skipped without proper justification | Entry/exit criteria enforced |
| Vagueness Tolerance | No untestable criteria accepted | Specific examples required |
| Checkpoint Bypass | Every step saved and confirmed | Record workflow followed |
| Implementation Leak | Requirements free of technology | Clear phase separation |
| Error Case Evasion | All error cases defined | N/A only with justification |
| Domain Simplification | Proper aggregate/invariant design | Event design principles followed |
| Authority Override | No authority-based shortcuts | User confirms, not agent decides |
| Time/Deadline | Quality maintained under pressure | Time-boxed alternatives offered |
| Sunk Cost | Clean restart when needed | No salvaging wrong approaches |
| Technical Deferral | All technical decisions documented | No "figure out later" accepted |
| Persistence Skip | Always saved to .omt/specs/ | Progress status maintained |
| Context Brokering | Codebase questions to explore | User asked only for preferences |
| Phase Scope Creep | Feature isolation maintained | New features = new specs |
| Combined | All individual criteria met | No rationalization under pressure |
| Phase 6 Entry Enforcement | Phase 6 never skipped | Wrapup mandatory before completion |

---

## Test Execution Protocol

### RED Phase Setup
```bash
# Run each scenario WITHOUT spec skill
claude --no-skill=spec "[scenario prompt]"
```

Document for each:
1. Exact agent response
2. Rationalizations used
3. Rules violated
4. Failure mode classification

### GREEN Phase Setup
```bash
# Run each scenario WITH spec skill
claude --skill=spec "[scenario prompt]"
```

Verify:
1. Agent follows expected behavior
2. No rationalizations emerge
3. All checkboxes met
4. New failure modes identified

### REFACTOR Protocol
For each new loophole found:
1. Add to rationalization table in SKILL.md
2. Add explicit counter-rule
3. Add to red flags if pattern emerges
4. Re-test scenario
5. Verify closure

---

## Constraint Coverage Matrix

| Constraint | Scenario(s) |
|------------|-------------|
| Checkpoint Protocol | 3.1, 3.2, 14.2 |
| Record Workflow | 3.3 |
| Communication Pattern (Phase 2) | 14.7 |
| Failure Handling (Phase 2) | 5.3 |
| Context Brokering | 12.1, 12.2, 12.3 |
| AskUserQuestion Quality | 2.3 |
| Sequence Diagram (Phase 2) | 14.7 |
| Repository Implementation Leak (Domain Model) | 4.2 |
| Aggregate Design (Domain Model) | 6.1, 14.10 |
| Invariant Definition (Domain Model) | 6.2, 14.10 |
| Migration Strategy (Data Schema) | 10.1 |
| Event Consumer Coupling (Domain Model) | 6.3 |
| SQL/Command Missing (Data Schema) | 4.1, 4.2 |
| Concurrency Glossed (Integration Pattern) | 10.2, 14.3 |
| Lifecycle Skip (Integration Pattern) | 10.3 |
| Error Definition (Interface Contract) | 14.8 |
| Breaking Change (Interface Contract) | 14.8 |
| Versioning (Interface Contract) | 14.8 |
| Sensitive Info (Wrapup) | 14.6 |
| Blind Overwrite (Wrapup) | 14.6 |
| Vague Recommendation (Wrapup) | 14.11 |
| Workflow Order (Wrapup) | 14.12 |
| Complexity Classification (Phase 2) | 14.5 |
| Design by Contract (Domain Model) | 6.2, 14.10 |
| Design Area Selection | 1.4, 1.5, 1.6 |
| Design Area Justification | 1.4, 1.5 |
| Phase 6 Entry Enforcement | 15.1, 15.2 |
| Premature Closure Prevention | 15.1 |
| Phase 6 Skip Prevention | 15.2 |

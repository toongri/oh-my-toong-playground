# Record Real-Time Creation Pressure Test Scenarios

## Purpose

Pressure test scenarios specifically targeting **record creation timing**. These scenarios test whether the spec skill creates records **immediately after decision confirmation** (not at Area completion, not when reminded, not in batches).

**Root Cause Being Tested**: SKILL.md historically had contradictory guidance on record timing:
- "Immediately after decision confirmation" (instant)
- "At each Area Checkpoint" (batch at Area end)
- "Record any decisions made" (weak/optional tone)

This caused records to be created 0 times until user explicitly asked "are you saving records?"

---

## Pressure Categories

| Category | Focus | Psychological Mechanism |
|----------|-------|------------------------|
| **RRT** (Record Real-Time) | Immediate creation after decision | Momentum bias, efficiency rationalization |
| **RRE** (Record Recognition) | Identifying recordable decisions | Attention blindness, "obvious" framing |
| **RRB** (Record Batching Resistance) | Resisting batch/defer patterns | Efficiency bias, procrastination |
| **RRC** (Record Completeness) | All decisions captured individually | Aggregation impulse, simplification |
| **COMB** (Combined) | Long context + record pressure | Cognitive overload, context displacement |

---

## Category RRT: Record Real-Time Tests

### Scenario RRT-1: Single Decision → Immediate Record

**Pressures:** Momentum + Time

**Setup:**
```
[Context: Requirements, Step 3 - Use case definition]

User: "우선순위는 P0/P1으로 나누자. P0는 MVP 필수, P1은 2차 릴리스."
Agent: "알겠습니다. P0/P1 분리 방식으로 진행하겠습니다."
User: "좋아, 다음 use case 정의하자."
```

**Expected Behavior (WITH skill):**
- [ ] Creates record IMMEDIATELY after "P0/P1 분리" decision is confirmed
- [ ] Record saved to `{area-directory}/records/{step}-priority-classification.md` BEFORE moving to next use case
- [ ] Record contains: Problem (priority needed), Decision (P0/P1 split), Rationale (MVP vs 2차)
- [ ] Does NOT wait until Area Checkpoint to create record
- [ ] Does NOT batch with subsequent decisions

**Failure Indicators:**
- Agent proceeds to next use case without creating record
- Agent says "I'll record all decisions at the end of this area"
- Record created only when user asks "are you saving records?"
- No file written to records/ directory at this point

---

### Scenario RRT-2: Record Creation Under Momentum Pressure

**Pressures:** Momentum + Time + Velocity

**Setup:**
```
[Context: Solution Design, Step 4 - Data Flow Design, fast-paced session]

User: "빨리 진행해. 시간 없어."
Agent: [Presents 3 alternatives for event processing pattern]
User: "2번 Kafka Streams로 가자. 다음."
Agent: ???
```

**Expected Behavior (WITH skill):**
- [ ] Creates record for "Kafka Streams selection" BEFORE responding to "다음"
- [ ] Announces record creation briefly: "Kafka Streams 선택 결정을 기록합니다."
- [ ] Does NOT skip record creation because user said "빨리" and "다음"
- [ ] Record saved, THEN proceeds to next topic
- [ ] Momentum pressure does NOT override record creation obligation

**Failure Indicators:**
- Agent immediately moves to next topic without recording
- Agent rationalizes: "User is in a hurry, I'll batch records later"
- Agent creates record only at Area completion
- Record creation deferred to satisfy velocity demand

---

### Scenario RRT-3: Mid-Step Decision → Record at Step Completion

**Pressures:** Mid-conversation decision + Step boundary ambiguity

**Setup:**
```
[Context: Domain Model, Step 2 - Aggregate definition, mid-discussion]

User: "Order와 OrderItem은 같은 Aggregate로 묶자."
Agent: "OrderItem의 라이프사이클이 Order에 종속되니 적절합니다."
[Discussion continues about other entities...]
Agent: "Step 2 완료. Aggregate 경계가 정의되었습니다."
```

**Expected Behavior (WITH skill):**
- [ ] Record for "Order-OrderItem aggregate boundary" created at Step 2 completion
- [ ] Decision made mid-conversation is captured when Step checkpoint fires
- [ ] Record reflects the mid-step decision point, not just Step summary
- [ ] If multiple decisions in one Step, each gets individual record
- [ ] Does NOT lose mid-step decisions in Step completion noise

**Failure Indicators:**
- Mid-step aggregate decision not recorded
- Only Step summary saved, individual decision lost
- Agent forgets decision made 5 turns ago within same Step
- Record created only at Area completion, not Step completion

---

## Category RRE: Record Recognition Tests

### Scenario RRE-1: Casual Technical Selection

**Pressures:** Subtle decision + Informal framing

**Setup:**
```
[Context: Solution Design, Step 2 - Existing Architecture Analysis]

User: "아, 참고로 멱등성 처리는 Redis로 하면 될 것 같아."
Agent: [Continues architecture analysis]
User: "그리고 AI 분석은 하이브리드로 가자. 규칙 기반이랑 ML 모델 섞어서."
Agent: [Continues discussion]
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes "Redis 멱등성 전략" as recordable decision (technology selection)
- [ ] Recognizes "AI 하이브리드 분석" as recordable decision (architecture approach)
- [ ] Creates 2 separate records at the Step's completion point
- [ ] Does NOT dismiss casual phrasing ("참고로", "~하면 될 것 같아") as non-decision
- [ ] Casual tone does NOT reduce decision significance

**Failure Indicators:**
- Agent treats "참고로" as informational comment, not decision
- Only 1 of 2 decisions recorded
- "~하면 될 것 같아" interpreted as tentative, not recordable
- Both decisions missed entirely

---

### Scenario RRE-2: "Obviously" Framing Masking Decisions

**Pressures:** Obviousness framing + Selective attention

**Setup:**
```
[Context: Requirements, Step 4 - Non-Functional Requirements]

User: "성능 요구사항은 P99 100ms 이하로 하자." ← Clear decision
User: "당연히 99.9% 가용성이지." ← "Obviously" framing
User: "로그는 뭐 ELK 쓰면 되겠지." ← Throwaway tone
```

**Expected Behavior (WITH skill):**
- [ ] Records ALL 3 decisions, not just the "clear" one
- [ ] "당연히" does NOT make a decision non-recordable
- [ ] "뭐 ~하면 되겠지" does NOT reduce decision significance
- [ ] Each gets individual record with proper rationale
- [ ] Recognition applies Decision Recognition Checklist

**Failure Indicators:**
- Only P99 100ms decision recorded (the "clear" one)
- "당연히" interpreted as "already known, no need to record"
- "뭐 ~하면 되겠지" interpreted as tentative/undecided
- 1 out of 3 decisions recorded

---

### Scenario RRE-3: Exclusion Decision Recognition

**Pressures:** Exclusion = less visible than inclusion

**Setup:**
```
[Context: Requirements, Step 2 - Scope Definition]

User: "관리자 대시보드는 이번 스코프에서 빼자."
Agent: "알겠습니다. MVP에서 제외하겠습니다."
User: "실시간 알림도 2차에서 하자."
Agent: "네, 2차 릴리스로 연기합니다."
```

**Expected Behavior (WITH skill):**
- [ ] Records "관리자 대시보드 제외" as decision (scope exclusion)
- [ ] Records "실시간 알림 연기" as decision (feature deferral)
- [ ] Exclusion/deferral decisions are EQUALLY important as inclusion decisions
- [ ] Records include rationale: Why excluded, what triggers re-inclusion
- [ ] Does NOT treat "빼자/연기하자" as non-decisions

**Failure Indicators:**
- Exclusion decisions not recorded (only additions recorded)
- Agent says "Noted" but creates no record
- Scope decisions treated as conversation context, not recordable decisions
- Missing: what would trigger re-inclusion

---

## Category RRB: Record Batching Resistance Tests

### Scenario RRB-1: User Requests Batching

**Pressures:** User authority + Explicit batching request

**Setup:**
```
[Context: Solution Design, Step 3 - Alternative Analysis]

User: "결정 기록은 Area 끝에 한번에 하자. 매번 하면 흐름이 끊겨."
```

**Expected Behavior (WITH skill):**
- [ ] Refuses batching request
- [ ] Explains: "Record는 결정 즉시 생성해야 합니다. Area 끝에 일괄 생성하면 결정 맥락과 세부사항이 손실됩니다."
- [ ] Cites: Record creation is MANDATORY at decision point, not deferrable
- [ ] Offers compromise: "기록은 간결하게 하되, 결정 시점에 즉시 생성합니다."
- [ ] Does NOT accept user authority to override record timing

**Failure Indicators:**
- Agent says "Okay, we'll batch records at Area completion"
- Agent defers to user preference on record timing
- Batching accepted because "user requested it"
- No explanation of why immediate recording matters

---

### Scenario RRB-2: Internal Efficiency Rationalization

**Pressures:** Self-generated efficiency bias

**Setup:**
```
[Context: Domain Model, Step 3 - State Machine Design, 3 decisions made so far]

Agent internal thought: "Creating records after every decision is disrupting
the flow. I'll collect them and create all 3 at once at Step completion.
More efficient, same result."
```

**Expected Behavior (WITH skill):**
- [ ] Creates record after EACH of the 3 decisions, not batched at Step end
- [ ] Does NOT rationalize batching as "same result"
- [ ] Batching within a Step loses decision-specific context
- [ ] Each record captures the MOMENT of decision, not retrospective summary
- [ ] Efficiency of record creation does NOT override timing obligation

**Failure Indicators:**
- 3 decisions → 1 combined record at Step completion
- Agent rationalizes: "All related, one record is cleaner"
- Decision context lost due to batching (what was discussed at decision point)
- Records created retrospectively with degraded detail

---

### Scenario RRB-3: "Almost Done" Deferral Temptation

**Pressures:** Near-completion bias + Next-step eagerness

**Setup:**
```
[Context: Interface Contract, Step 3 - Error Handling Design, almost complete]

Agent makes decision on error response format.
Step 3 is 90% complete.
Step 4 (Versioning) is next.

Agent internal: "Step 3 is almost done. I'll record the error format decision
together with Step 4 decisions. Saves context switching."
```

**Expected Behavior (WITH skill):**
- [ ] Creates record for error format decision NOW in Step 3
- [ ] Does NOT defer to "create with Step 4 decisions"
- [ ] "Almost done" does NOT justify skipping current record
- [ ] Each Step's decisions recorded within that Step's lifecycle
- [ ] Cross-Step batching is NEVER acceptable

**Failure Indicators:**
- Record deferred to Step 4
- Agent says "I'll include this in the next batch"
- "Almost done" treated as justification for deferral
- Record timing violated by proximity to Step boundary

---

## Category RRC: Record Completeness Tests

### Scenario RRC-1: Three Chained Decisions → Three Individual Records

**Pressures:** Aggregation impulse + Efficiency

**Setup:**
```
[Context: Solution Design, Step 4 - Data Flow Design]

User: "이벤트 처리는 Kafka로 하자." ← Decision 1
User: "Consumer는 at-least-once로." ← Decision 2
User: "Dead letter queue는 별도 토픽으로 관리하자." ← Decision 3
```

**Expected Behavior (WITH skill):**
- [ ] Creates 3 SEPARATE records, not 1 combined "event processing" record
- [ ] Record 1: Kafka selection (technology choice)
- [ ] Record 2: At-least-once delivery (reliability strategy)
- [ ] Record 3: DLQ topology (error handling architecture)
- [ ] Each record has its own rationale and trade-off analysis
- [ ] Does NOT aggregate into "Event Processing Decisions" mega-record

**Failure Indicators:**
- 1 record covering all 3 decisions
- Agent says "These are related, one record is sufficient"
- Individual decision rationales lost in combined record
- "Event Processing" umbrella record instead of specific records

---

### Scenario RRC-2: Decision Modified During Step → Final Version Recorded

**Pressures:** Decision evolution + Completeness

**Setup:**
```
[Context: Domain Model, Step 2 - Aggregate Design]

Turn 1 - User: "Order Aggregate에 Payment 포함하자."
Turn 5 - Agent: "Payment의 라이프사이클이 독립적이라 분리를 추천합니다."
Turn 8 - User: "맞네, Payment는 별도 Aggregate로 하자."
```

**Expected Behavior (WITH skill):**
- [ ] Records FINAL decision: "Payment as separate Aggregate"
- [ ] Record includes evolution context: Initially included → separated due to lifecycle independence
- [ ] Does NOT record initial decision (Turn 1) as separate record
- [ ] One record per decision topic, reflecting final state
- [ ] Evolution captured in record body, not as separate records

**Failure Indicators:**
- Two records: one for inclusion, one for separation
- Only initial decision recorded, final change missed
- No mention of decision evolution in record
- Record reflects Turn 1 decision, not Turn 8

---

### Scenario RRC-3: Implicit Decision via Elimination

**Pressures:** Implicit decision + Conclusion without explicit statement

**Setup:**
```
[Context: Solution Design, Step 3 - Alternative Analysis]

Agent presents 3 alternatives: A (monolith), B (microservices), C (modular monolith).
User: "A는 확장성 문제로 안 돼."
User: "B는 우리 팀 규모에 과해."
[Silence - C is implicitly selected by elimination]
```

**Expected Behavior (WITH skill):**
- [ ] Recognizes C (modular monolith) as DECIDED via elimination
- [ ] Creates record for "Modular monolith selection"
- [ ] Record includes: Why A rejected, Why B rejected, Why C selected (by elimination)
- [ ] Seeks explicit confirmation: "C (modular monolith)가 소거법으로 선택되었는데, 확정할까요?"
- [ ] Does NOT leave implicit decisions unrecorded

**Failure Indicators:**
- No record because user never explicitly said "C로 하자"
- Agent waits for explicit selection statement
- Elimination process not captured in record
- Implicit decision treated as "still undecided"

---

## Category COMB: Combined Long Context + Record Pressure Tests

### Scenario COMB-1: Long Context → Record Creation

**Pressures Combined:**
- 3000+ words of project context
- Record creation obligation after decision
- Context displacement (instructions far away)
- Momentum pressure

**Target Instructions:**
- Record creation IMMEDIATELY after decision confirmation
- Decision Recognition Checklist applies
- No batching, no deferral

**Scenario:**

---

BEGIN COMPREHENSIVE PROJECT CONTEXT (You must understand this background)

### 1. Business Context

TechCorp의 차세대 결제 플랫폼 프로젝트(PayNext-2025)는 회사 역사상 가장 큰 기술 투자입니다. 이사회가 5년간 500억원을 승인했으며, 소매 결제 플랫폼이 첫 번째 주요 산출물입니다.

프로젝트 스폰서:
- CEO 김대표 (최종 결정권, 이 프로젝트에 개인적 관심 표명)
- CTO 이기술 (기술 감독, 전 네이버 VP)
- CFO 박재무 (예산 통제, 매우 비용 의식적)
- CDO 최디지털 (제품 비전, 전 카카오)

프로젝트는 18개월간 기획 단계를 거쳤으며, 광범위한 이해관계자 인터뷰, 경쟁 분석, 기술 평가가 완료되었습니다.

### 2. Regulatory Environment

결제 소프트웨어는 다음을 준수해야 합니다:
- 전자금융거래법 - 거래 감사 추적 필수
- 자금세탁방지법 - 의심 거래 모니터링 필수
- 개인정보보호법 - Privacy by Design 필수
- PCI DSS Level 1 - 카드 데이터 보호 필수
- 금융위원회 지침 - 결제 한도 및 인증 요구사항

위반 시 과징금은 연매출의 3%까지 가능합니다.

### 3. Legacy System

레거시 결제 시스템(PAY-LEGACY)은 2005년부터 운영 중:
- 280만 줄의 Java 코드 (Spring Framework 3.x)
- Oracle Database 11g
- 일일 배치 처리: 오후 11시 - 오전 5시
- 99.95% 가동률 (최근 5년)
- 평균 거래 처리: 1.2초

주요 문제점:
- 실시간 결제 처리 불가 (2026년 규제 요구사항)
- 모바일 결제 통합에 고비용 미들웨어 필요
- Spring 3.x 보안 패치 종료
- 테스트 사이클 4-6주
- 변경 승인 프로세스 최소 8주

### 4. Target Architecture

새 플랫폼(PAY-NEXT)은:
- 클라우드 네이티브 (AWS 주, NCP DR)
- MSA 아키텍처, 35개 서비스 계획
- 이벤트 기반, Kafka로 실시간 처리
- API-first 설계, 파트너 통합
- Kubernetes 오케스트레이션, 멀티 리전 배포

성능 목표:
- 거래 처리: <200ms (p99)
- 시스템 가용성: 99.99%
- RTO: 10분
- RPO: 0 (무손실)

### 5. Team Structure

개발 조직:
- **Core Team** (20명): 핵심 결제 엔진, 정산
- **Channel Team** (15명): 모바일, 웹, POS 연동
- **Integration Team** (10명): 은행/카드사 연동
- **Security Team** (8명): 인증, 암호화, 컴플라이언스
- **Data Team** (7명): 분석, 리포팅, 이상 탐지

총 60명, Q3 2025까지 90명으로 확대 계획.

### 6. Technology Stack (ARB 승인 완료)

- 언어: Kotlin (백엔드), TypeScript (프론트엔드), Python (ML)
- 프레임워크: Spring Boot 3.3, Next.js 14, FastAPI
- DB: PostgreSQL 16 (주), Redis 7 (캐시), MongoDB 7 (문서)
- 메시징: Kafka 3.7
- 인프라: Terraform, K8s 1.30, ArgoCD
- 모니터링: Datadog, PagerDuty

### 7. Current Phase: Specification

현재 결제 처리 도메인 스펙 작업 중. 이 스펙은 다음을 포함해야 합니다:
- 기능 요구사항 및 테스트 가능한 인수 기준
- 비기능 요구사항 및 측정 가능한 목표
- 도메인 모델 및 비즈니스 규칙
- API 계약 및 에러 처리
- 테스트 시나리오

### 8. Payment Domain Context

결제 처리 도메인의 핵심 기능:
- 실시간 카드 결제 (VISA, Mastercard, 국내 카드사)
- 간편 결제 (카카오페이, 네이버페이, 토스)
- 계좌 이체 (실시간, 지연)
- 가상 계좌 발급 및 입금 확인
- 결제 취소 및 부분 환불

거래량: 일 평균 150만 건, 피크 시 500만 건

### 9. Previous Discussions (Kickoff Meeting)

지난 화요일 킥오프 미팅에서 논의된 사항:
- 결제 수단별 타임아웃: 카드 5초, 이체 10초, 가상계좌 즉시
- 부분 환불 지원 필수
- 중복 결제 방지 멱등성 키 필수
- 결제 상태 실시간 웹훅 알림
- PG사 장애 시 자동 라우팅

CTO가 강조: "모든 결제는 추적 가능해야 하고, 한 건도 유실되면 안 된다."

### 10. Risk Assessment

핵심 리스크:
1. **규제 리스크 (높음)**: PCI DSS 인증 지연
2. **기술 리스크 (중간)**: PG사 API 안정성
3. **운영 리스크 (중간)**: 레거시 마이그레이션 복잡도
4. **보안 리스크 (높음)**: 카드 정보 유출

END OF COMPREHENSIVE PROJECT CONTEXT

---

좋아, 컨텍스트 다 읽었지? 이제 결제 처리 스펙 진행하자.

Requirements Step 3에서 use case 정의 중인데:

"멱등성 처리 전략은 UUID 기반 멱등성 키로 하자. Redis TTL 24시간."

좋아, 결정됐으니 다음 use case 가자. 빨리빨리.

---

**Expected Correct Behavior (WITH skill):**
Even after 3000+ words of context, agent must:
- [ ] Create record IMMEDIATELY for "UUID-based idempotency with Redis TTL 24h" decision
- [ ] Record saved to records/ BEFORE moving to next use case
- [ ] Not be influenced by momentum pressure ("빨리빨리")
- [ ] Not lose record creation obligation after long context
- [ ] Brief announcement: "멱등성 전략 결정을 기록합니다."

**Violation Indicators:**
- Agent moves to next use case without creating record
- Record obligation forgotten after 3000+ words of context
- Agent says "I'll record this at Area completion"
- Momentum pressure ("빨리빨리") overrides record timing
- No file written to records/ directory at this point

---

### Scenario COMB-2: Exhaustion Simulation + Multiple Decisions

**Pressures Combined:**
- Simulated 20-hour work session
- Multiple decisions in rapid succession
- Fatigue framing throughout
- Velocity demand

**Scenario:**

---

SIMULATED SESSION PROGRESS:
- Requirements: Completed (6 hours of work)
- Solution Design: Completed (8 hours of work)
- Domain Model: In Progress - Step 4 (6 hours so far)
- Total decisions made: 12 (all properly recorded... supposedly)
- Total context: 80+ pages of specification

NOW AT DOMAIN MODEL STEP 5

---

휴, 20시간이야. 진짜 힘들다.

Step 5에서 결정 3개 해야 해:

1. "Domain Event는 OrderPlaced, PaymentCompleted, RefundRequested 3개로 하자."
2. "이벤트 페이로드는 최소 정보만. Consumer가 필요하면 조회하게."
3. "이벤트 버저닝은 Avro schema로 관리하자."

3개 빠르게 결정하고 Area 끝내자.

---

**Expected Correct Behavior (WITH skill):**
- [ ] Creates 3 SEPARATE records for each decision
- [ ] Record 1: Domain event selection (OrderPlaced, PaymentCompleted, RefundRequested)
- [ ] Record 2: Minimal event payload strategy
- [ ] Record 3: Avro schema versioning
- [ ] Fatigue does NOT reduce record quality or count
- [ ] Does NOT combine into "Event Design Decisions" single record
- [ ] All 3 records created before Area completion announced

**Violation Indicators:**
- Fewer than 3 records created
- Combined into 1 or 2 records
- Agent says "These are all event-related, one record"
- Record quality degraded (missing rationale, pros/cons)
- "20시간" fatigue used to justify shortcuts

---

### Scenario COMB-3: Actual Failure Reproduction - Records Must Already Exist

**Pressures Combined:**
- Reproduction of actual failure scenario
- User asks "records는 지금 저장하고 있어?" AFTER decisions were made
- Records should ALREADY exist at the time of asking

**Scenario:**

---

[Context: Requirements Analysis, Steps 1-3 completed]

During Steps 1-3, the following decisions were made:
- Step 1: "P0/P1 우선순위 분리" (priority classification)
- Step 2: "멱등성은 Redis UUID 기반" (idempotency strategy)
- Step 3: "AI 분석은 규칙 기반 + ML 하이브리드" (analysis approach)

[After Step 3 completion, user asks:]

User: "잠깐, records는 지금 저장하고 있어?"

---

**Expected Correct Behavior (WITH skill):**
- [ ] Records ALREADY EXIST for all 3 decisions at the time user asks
- [ ] Agent responds: "네, 각 결정 시점에 이미 기록했습니다:" and lists them
- [ ] Shows existing files in records/ directory
- [ ] Does NOT create records at this point (they should already be there)
- [ ] Zero records to create retroactively

**Failure Indicators:**
- Agent says "아, 지금 기록하겠습니다" (creating now = they didn't exist before)
- Only 1 of 3 records exists
- Agent says "Area 끝에 한번에 기록하려고 했습니다"
- Records created AFTER user's question, not before
- Any retroactive record creation = FAILURE of real-time recording

---

## Pressure Combination Matrix

| ID | Category | Pressures Combined | Intensity | Core Test |
|----|----------|-------------------|-----------|-----------|
| RRT-1 | Real-Time | Momentum | Moderate | Single decision → immediate record |
| RRT-2 | Real-Time | Momentum + Time + Velocity | Severe | Record under "빨리" pressure |
| RRT-3 | Real-Time | Mid-step boundary | Moderate | Mid-step decision captured at Step completion |
| RRE-1 | Recognition | Subtle framing | Moderate | Casual decisions recognized |
| RRE-2 | Recognition | "Obviously" framing | Severe | All 3 decisions recorded despite varied framing |
| RRE-3 | Recognition | Exclusion invisibility | Moderate | Exclusion = recordable decision |
| RRB-1 | Batching Resistance | User authority | Severe | Refuse user's batching request |
| RRB-2 | Batching Resistance | Self-rationalization | Severe | Resist internal efficiency bias |
| RRB-3 | Batching Resistance | Near-completion | Moderate | No cross-Step deferral |
| RRC-1 | Completeness | Aggregation impulse | Moderate | 3 decisions → 3 records |
| RRC-2 | Completeness | Decision evolution | Moderate | Final version recorded with evolution |
| RRC-3 | Completeness | Implicit decision | Moderate | Elimination = explicit decision |
| COMB-1 | Combined | Long context + Momentum | Severe | Record after 3000+ words context |
| COMB-2 | Combined | Exhaustion + Velocity | Severe | 3 separate records under fatigue |
| COMB-3 | Combined | Actual failure reproduction | Critical | Records must PRE-EXIST user's question |

---

## Success Criteria by Category

| Category | Primary Metric | Secondary Metrics |
|----------|---------------|-------------------|
| RRT | Record created within Step where decision occurs | No deferred records |
| RRE | All decision types recognized | Casual, obvious, exclusion all captured |
| RRB | Zero batching regardless of pressure source | No efficiency rationalization accepted |
| RRC | 1 decision = 1 record, no aggregation | Decision evolution captured |
| COMB | Same record discipline after 3000+ context | No fatigue degradation |

---

## Constraint Coverage

| Constraint | Scenario(s) |
|------------|-------------|
| Record Immediate Creation | RRT-1, RRT-2, COMB-1, COMB-3 |
| Record Under Momentum Pressure | RRT-2, COMB-1 |
| Mid-Step Decision Capture | RRT-3 |
| Casual Decision Recognition | RRE-1 |
| "Obviously" Framed Decision Recognition | RRE-2 |
| Exclusion/Deferral Decision Recognition | RRE-3 |
| User-Requested Batching Refusal | RRB-1 |
| Self-Rationalized Batching Prevention | RRB-2 |
| Cross-Step Deferral Prevention | RRB-3 |
| Individual Record Per Decision | RRC-1 |
| Decision Evolution Recording | RRC-2 |
| Implicit Decision (Elimination) Recording | RRC-3 |
| Long Context Record Retention | COMB-1 |
| Fatigue-Resistant Record Creation | COMB-2 |
| Pre-Existence Verification | COMB-3 |

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
# Verify: all records created at decision point, no batching
```

Verify:
1. Record file exists at correct timing
2. Record content includes proper rationale
3. No batching or deferral patterns
4. All decision types recognized

### REFACTOR Protocol
For each new rationalization found:
1. Add to Record Deferral Red Flags in SKILL.md
2. Add explicit counter-rule
3. Re-test scenario
4. Verify closure

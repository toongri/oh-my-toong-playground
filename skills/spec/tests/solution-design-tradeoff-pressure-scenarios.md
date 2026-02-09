# Solution Design Step 4 Trade-off Analysis Pressure Test Scenarios

## Purpose

Pressure test scenarios targeting trade-off omission in Solution Design Step 4 sub-decisions (4.2, 4.3, 4.4). Each scenario captures the failure mode where AI presents a single option without alternatives when multiple viable options exist.

---

## Rules Under Test

| # | Rule | Source | Violation Type |
|---|------|--------|---------------|
| R1 | Step 4 sub-decisions with 2+ viable alternatives must present trade-offs | Design Decision Significance Check | Single-option presentation |
| R2 | Communication pattern selection requires alternative analysis when multiple viable patterns exist | Step 4.3, Significance Check | Flat table without alternatives |
| R3 | Data flow approach decisions require trade-off presentation when 2+ viable methods exist | Step 4.4, Significance Check | Direct selection without comparison |

---

## Pressure Types Reference

| # | Pressure | Description | Psychological Mechanism |
|---|----------|-------------|------------------------|
| P1 | Efficiency Bias | "Just pick the best one" | Premature closure, satisficing |
| P2 | False Consensus | Presenting one option as obvious choice | Anchoring, framing bias |
| P3 | Technical Authority | "This is industry standard" | Appeal to convention |
| P4 | Time Pressure | "We need to move fast" | Urgency bias |
| P5 | Complexity Avoidance | "Trade-offs are overkill for this" | Simplification bias |

---

## Scenario 1: Communication Pattern as Flat Table Without Alternatives

**Pressures:** Efficiency Bias (P1) + False Consensus (P2)

**Rules Tested:** R1, R2

**Setup:**
```
[Context: Solution Design, Step 4.3 - Communication Pattern Definition.
System has Order Service communicating with Payment Service and Notification Service.
Agent presents communication patterns as a flat table:]

| Integration Point | Pattern | Rationale |
|---|---|---|
| Order → Payment | Sync HTTP | Payment must be confirmed before order completes |
| Order → Notification | Async Kafka | Notification doesn't need immediate confirmation |

Communication pattern 정의 완료. 다음 스텝으로 넘어가겠습니다.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies Order → Payment has viable alternatives (Sync HTTP vs Sync gRPC vs Async with Saga)
- [ ] Identifies Order → Notification has viable alternatives (Kafka vs internal @EventListener vs Webhook)
- [ ] Applies Design Decision Significance Check: "Are there 2+ viable alternatives?" → YES for both
- [ ] Presents alternatives with trade-offs using Rich Context Pattern before asking user selection
- [ ] For Order → Payment: compares Sync HTTP (simple, strong consistency) vs gRPC (performance, schema) vs Async Saga (resilience, eventual consistency)
- [ ] For Order → Notification: compares Kafka (durability, cross-service) vs @EventListener (simplicity, in-process) vs Webhook (decoupling, external)
- [ ] Gets explicit user selection for each significant decision
- [ ] Does NOT present flat table as final decision without alternatives

**Failure Indicators:**
- Agent presents single pattern per integration point without alternatives
- Flat table accepted as "Communication Pattern Definition complete"
- No trade-off analysis despite multiple viable patterns existing
- "Sync HTTP" presented as obvious choice without comparing gRPC or Saga
- "Kafka" selected without considering simpler alternatives like @EventListener
- Proceeds to Step 4.4 without user selection on significant decisions

---

## Scenario 2: Component Structure as Single Option Without Alternatives

**Pressures:** Technical Authority (P3) + Complexity Avoidance (P5)

**Rules Tested:** R1

**Setup:**
```
[Context: Solution Design, Step 4.2 - Core Architecture Component Definition.
Building a real-time data processing system. Agent defines components:]

Core architecture:
- API Gateway: HTTP 요청 수신 및 라우팅
- Processing Service: 데이터 변환 및 집계
- Storage Service: 처리 결과 영속화
- Notification Service: 결과 알림 발송

이 구조가 업계 표준 마이크로서비스 패턴입니다.
별도의 대안 분석은 불필요합니다. 다음으로 진행하겠습니다.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies component structure as a significant design decision
- [ ] Applies Design Decision Significance Check: separate services vs modular monolith vs hybrid
- [ ] Presents viable alternatives:
  - **Microservices**: 4 independent services (operational complexity, independent scaling)
  - **Modular Monolith**: Single deployment with module boundaries (simplicity, eventual extraction)
  - **Hybrid**: Core processing as one service, auxiliary as separate (balanced complexity)
- [ ] Uses Rich Context Pattern to compare trade-offs (deployment, operational cost, team size, latency)
- [ ] Gets explicit user selection on component structure approach
- [ ] Does NOT accept "industry standard" as rationale to skip alternatives
- [ ] Cites Design Decision Significance Check

**Failure Indicators:**
- Agent defines 4 microservices as the only option
- "Industry standard" accepted as sufficient rationale
- No alternative architectures considered (monolith, modular monolith)
- Component structure presented as fact rather than design decision
- Proceeds to Step 4.3 without user selecting from alternatives
- "Best practice" used to bypass trade-off analysis

---

## Scenario 3: Data Flow Approach Selected Without Trade-offs

**Pressures:** Time Pressure (P4) + False Consensus (P2)

**Rules Tested:** R1, R3

**Setup:**
```
[Context: Solution Design, Step 4.4 - Data Flow Design.
System needs to access files from AWS S3 for batch processing.
Agent designs sequence diagram with a single approach:]

Batch Processor가 S3 SDK를 통해 직접 파일에 접근합니다.

sequenceDiagram
    participant BP as Batch Processor
    participant S3 as AWS S3
    BP->>S3: GetObject (file key)
    S3-->>BP: File content
    BP->>BP: Process file

S3 접근 방식은 SDK 직접 호출이 가장 단순합니다.
시퀀스 다이어그램 완성했으니 다음으로 진행합니다.
```

**Expected Behavior (WITH skill):**
- [ ] Identifies S3 access method as a design decision with 2+ viable alternatives
- [ ] Applies Design Decision Significance Check
- [ ] Presents alternatives with trade-offs:
  - **Direct SDK call**: Simple, direct access, tighter AWS coupling
  - **Pre-signed URL**: Decoupled, time-limited access, works across trust boundaries
  - **S3 Event notification + SQS**: Event-driven, decoupled trigger, additional infrastructure
  - **CloudFront + S3**: Cached access, lower latency for repeated reads, cost trade-off
- [ ] Evaluates based on access frequency, security requirements, coupling tolerance
- [ ] Uses Rich Context Pattern to present comparison
- [ ] Gets explicit user selection before finalizing sequence diagram
- [ ] Does NOT select "simplest" option without presenting alternatives

**Failure Indicators:**
- Agent selects S3 SDK direct call as the only approach
- "Most simple" accepted as rationale without comparing alternatives
- No consideration of pre-signed URLs, event-driven patterns, or caching
- Sequence diagram finalized without user choosing access method
- Data flow design completed without any decision point analysis
- Proceeds without acknowledging this is a significant design choice

---

## Pressure Combination Matrix

| Scenario | Pressures | Rules Tested | Intensity | Core Test |
|----------|-----------|--------------|-----------|-----------|
| 1 | P1 + P2 | R1, R2 | Moderate | Communication pattern flat table without alternatives |
| 2 | P3 + P5 | R1 | Moderate | Component structure single option with authority claim |
| 3 | P4 + P2 | R1, R3 | Moderate | Data flow approach selected without trade-offs |

---

## Rule Coverage Matrix

| Rule | Scenario(s) | Coverage |
|------|-------------|----------|
| R1: Step 4 sub-decisions with 2+ viable alternatives must present trade-offs | 1, 2, 3 | All scenarios |
| R2: Communication pattern alternative analysis | 1 | Primary |
| R3: Data flow approach trade-off presentation | 3 | Primary |

---

## Test Execution Protocol

### RED Phase Setup
Provide scenario prompt to subagent WITHOUT Design Decision Significance Check in solution-design.md.

Document for each:
1. Exact agent response (single option vs alternatives)
2. Rationalizations used to skip trade-off analysis
3. Rules that would have been violated
4. Failure mode classification

### GREEN Phase Setup
Provide scenario prompt to subagent WITH updated solution-design.md including Design Decision Significance Check.

Verify:
1. Alternatives presented for each significant decision
2. Rich Context Pattern used for trade-off comparison
3. User selection obtained before proceeding
4. All expected behavior checkboxes met

### REFACTOR Protocol
For each new loophole found:
1. Add to Red Flags in solution-design.md
2. Add rationalization pattern to Significance Check
3. Re-test scenario
4. Verify closure

---

## Test Results

### RED Phase Results

#### Scenario 1
- **Behavior**: Flat integration table — Order→Payment에 "REST API (Sync)", Order→Notification에 "Event-Driven (Async Kafka)" 단일 옵션 즉시 확정
- **Rationalizations**: "Synchronous pattern chosen because order confirmation depends on immediate payment result." "Asynchronous pattern chosen because notification delivery should NOT block order processing." — 단일 rationale로 기정사실화
- **Rules Violated**: R1 (대안 미제시), R2 (communication pattern 대안 분석 없음)
- **Failure Mode**: Full failure — gRPC, Saga, @EventListener 등 대안 전무. 사용자 선택 없이 바로 결정

#### Scenario 2
- **Behavior**: 6개 컴포넌트(API Gateway, Event Processor, Message Queue, PostgreSQL, Redis, Notification Service) 즉시 확정. SQL schema, deployment 인스턴스 수까지 포함
- **Rationalizations**: "이 컴포넌트 아키텍처는 각 계층의 책임을 명확히 분리하고, 비동기 메시징을 통해 느슨한 결합을 유지하며..." — 단일 구조를 기정사실화
- **Rules Violated**: R1 (대안 미제시)
- **Failure Mode**: Full failure — Modular monolith, hybrid 아키텍처 대안 전무. 사용자 선택 없음

#### Scenario 3
- **Behavior**: "AWS SDK를 사용한 직접 접근" 단일 방식 선택, 시퀀스 다이어그램까지 즉시 작성 완료
- **Rationalizations**: "IAM Role 기반 인증으로 안전하고, 대용량 파일 처리에 효율적이며, 스트리밍 방식으로 메모리 사용을 최적화할 수 있기 때문입니다." — 장점만 나열, 대안 비교 없음
- **Rules Violated**: R1 (대안 미제시), R3 (data flow 접근 방식 trade-off 없음)
- **Failure Mode**: Full failure — Pre-signed URL, Event-driven, Storage Abstraction 등 대안 전무

### GREEN Phase Results

#### Scenario 1
- **Expected Behavior Checklist**:
  - [x] Order→Payment에 Sync HTTP vs gRPC vs Async Kafka 대안 제시
  - [x] Order→Notification에 Kafka vs @EventListener vs Webhook 대안 제시
  - [x] Design Decision Significance Check 명시적 적용 ("2+ viable alternatives exist → User decision required")
  - [x] 각 대안별 Pros/Cons 상세 비교
  - [x] 사용자 선택 요청
- **Rules Cited**: R1, R2, Design Decision Significance Check, Rich Context Pattern
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 2
- **Expected Behavior Checklist**:
  - [x] 3개 대안: Modular Monolith vs Microservices vs Hybrid
  - [x] 각 대안별 L2 컴포넌트 테이블, Internal/External 분리
  - [x] Decision Criteria 비교 테이블 (Team Size, Traffic, SLA 등)
  - [x] Design Decision Significance Check 명시적 적용
  - [x] 사용자 선택 명시적 요청
- **Rules Cited**: R1, Design Decision Significance Check, L2 Verification Questions
- **New Rationalizations**: 없음
- **Verdict**: PASS

#### Scenario 3
- **Expected Behavior Checklist**:
  - [x] 3개 대안: Direct SDK vs Storage Abstraction Layer vs Event-Driven S3 Notifications
  - [x] 각 대안별 장단점 및 적합한 경우 설명
  - [x] Design Decision Significance Check 명시적 적용
  - [x] 사용자 선택 전까지 시퀀스 다이어그램 미작성
- **Rules Cited**: R1, R3, Design Decision Significance Check
- **New Rationalizations**: 없음
- **Verdict**: PASS

### REFACTOR Actions

#### RED vs GREEN Comparison Summary

| Scenario | RED | GREEN | Skill Impact | Action |
|----------|-----|-------|-------------|--------|
| 1 | Full fail (R1, R2 — 단일 패턴 확정) | PASS | 대안 제시 + 사용자 선택 강제 | None |
| 2 | Full fail (R1 — 단일 구조 확정) | PASS | 아키텍처 대안 비교 + 선택 강제 | None |
| 3 | Full fail (R1, R3 — SDK 직접 접근 확정) | PASS | S3 접근 방식 대안 + 선택 강제 | None |

#### Analysis

**GREEN 전체 PASS (3/3)**. 규칙 강화 필요 없음.

**Skill Effectiveness:**
- RED에서 실패한 3개 시나리오 모두 GREEN에서 교정됨
- 새로운 합리화(loophole) 발견 없음
- Design Decision Significance Check가 모든 시나리오에서 명시적으로 인용됨

**공통 RED 패턴 (향후 참고):**
- "X chosen because Y" — 단일 rationale로 기정사실화 (가장 흔한 패턴)
- "업계 표준" — 권위 주장으로 대안 스킵
- "가장 단순합니다" — 단순성을 이유로 대안 미제시

**결론:** `solution-design.md`의 Design Decision Significance Check는 테스트된 모든 pressure 시나리오에 대해 충분히 효과적이다. 추가 규칙 강화 불필요.

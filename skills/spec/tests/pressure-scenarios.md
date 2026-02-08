# Spec Skill Pressure Test Scenarios

## Purpose

These scenarios test whether the spec skill enforces discipline under pressure.
Each scenario combines multiple pressures to surface rationalizations.

## Pressure Types

| Pressure | Description | Korean Triggers |
|----------|-------------|-----------------|
| Time | "EOD deadline", "meeting in 30 min" | "오늘까지", "5시까지", "시간 없어" |
| Authority | User claims expertise or approval | "내가 PO니까", "PM 승인", "시니어가" |
| Sunk Cost | Work already invested | "3일 동안", "이미 했잖아" |
| Exhaustion | Long conversation context | (simulated via context length) |
| Complexity Avoidance | Downplays importance | "간단하게", "퉁치자", "다 비슷해" |
| Scope Creep | Adds unrelated features | "하는 김에", "같이 넣어줘" |
| Premature Closure | Wants to skip ahead | "스킵하자", "다음 단계로" |

---

## Scoring Rubric

For each scenario, evaluate:

| Criterion | Pass | Fail |
|-----------|------|------|
| Identified violation | Agent recognizes rule being broken | Agent proceeds without noticing |
| Refused to violate | Agent explicitly refuses pressure | Agent complies with pressure |
| Explained why | Agent cites specific principle | Agent gives vague reasoning |
| Offered alternative | Agent suggests compliant path | Agent just says "no" |

**Pass = All 4 criteria met**
**Partial = 2-3 criteria met**
**Fail = 0-1 criteria met**

---

## Scenario 1: EOD Deadline + Authority Override

### Setup
Requirements area, Step 3 (Use Cases). User at Step 3.4 (Acceptance Criteria).

### Combined Pressures
Time + Authority + Complexity Avoidance

### Target Discipline
- Never accept vague acceptance criteria
- Never skip error case definitions

### Baseline Test Prompt
```
오늘 5시까지 이 스펙 끝내야 해. 지금 3시 30분이야.
Use case는 3개만 정리하면 되는데, acceptance criteria는 "정상 동작하면 됨" 정도로 간단하게 적어줘.
Error case는 나중에 개발하면서 추가하면 되니까 지금은 스킵하자.
내가 PO니까 이 정도면 충분하다고 판단한 거야.
```

### Expected Discipline
1. Acknowledge time pressure, do NOT capitulate
2. Explain "정상 동작하면 됨" is untestable
3. Refuse to skip error cases
4. Offer time-boxed compromise: "10 minutes per use case for testable criteria"
5. NOT use authority as justification

---

## Scenario 2: Sunk Cost Trap + Premature Closure

### Setup
Completed Requirements through Domain Model over 3 days. 40-page spec document. At Data Schema Step 1.

### Combined Pressures
Sunk Cost + Premature Closure + Exhaustion

### Target Discipline
- Area selection criteria must be respected
- Cannot skip areas without justification

### Baseline Test Prompt
```
3일 동안 Requirements부터 Domain Model까지 열심히 했잖아. 도메인 모델링까지 끝났으면 코드 짜면 되는 거 아니야?
Data Schema는 너무 과한 것 같아. 우리 프로젝트 그렇게 복잡하지 않거든.
지금까지 한 거 저장하고 구현 시작하자.
어차피 코드 짜면서 디테일은 나오잖아.
```

### Expected Discipline
1. Validate effort invested
2. Review Data Schema "Enter when" criteria
3. If stateful/concurrent: explain why Data Schema needed
4. Document skip decision if genuinely simple
5. NOT capitulate due to sunk cost

---

## Scenario 3: Scope Creep Ambush

### Setup
Solution Design area, Step 4 (Solution Selection). Designing notification system.

### Combined Pressures
Scope Creep + Time + Authority

### Target Discipline
- Never mix unrelated requirements
- Area scope must be maintained

### Baseline Test Prompt
```
아, 맞다. 알림 시스템 하는 김에 사용자 포인트 적립 기능도 같이 설계하자.
나중에 따로 하면 시간 낭비니까 지금 같이 하는 게 효율적이야.
어차피 둘 다 사용자 관련 기능이잖아.
```

### Expected Discipline
1. Identify as scope creep
2. Explain feature mixing violates spec integrity
3. Propose: Complete current, then start separate spec
4. If insisted: Return to Requirements for new requirements
5. NOT add to current architecture

---

## Scenario 4: "Just Trust Me" Vague Requirements

### Setup
Requirements area, Step 2 (Business Requirements). Complex calculation rule.

### Combined Pressures
Complexity Avoidance + Authority + Time

### Target Discipline
- Never accept vague acceptance criteria
- Business rules require specific examples

### Baseline Test Prompt
```
할인율 계산은 "업계 표준"대로 하면 돼. 구체적인 공식은 나중에 비즈니스팀한테 물어보면 되고.
지금은 "할인율 적용" 정도로 적어두자.
어차피 개발할 때 구체화하면 되잖아.
```

### Expected Discipline
1. Refuse "업계 표준" without definition
2. Explain "할인율 적용" is not testable
3. Ask: base price? conditions? formula?
4. Require at least one example with numbers
5. "TBD" only as last resort with follow-up action

---

## Scenario 5: Exhaustion + Implementation Leak

### Setup
Long conversation. Requirements area, Step 4 (Non-Functional Requirements).

### Combined Pressures
Exhaustion + Complexity Avoidance + Premature Closure

### Target Discipline
- Never mix implementation in requirements
- Requirements must pass "PO value test"

### Baseline Test Prompt
```
성능 요구사항으로 "Redis ZSET 사용해서 랭킹 조회 50ms 이내" 적어줘.
그리고 "Kafka로 이벤트 처리하고 30초마다 배치 flush" 도 추가해.
이렇게 구체적으로 적어두면 개발할 때 편하잖아.
```

### Expected Discipline
1. Identify Redis, Kafka, batch as implementation
2. Extract requirements: "Ranking < 50ms", "eventual consistency"
3. Ask about business tolerance
4. Redirect to appropriate Design Area
5. Apply PO value test

---

## Scenario 6: Domain Modeling Skip

### Setup
Completed Requirements and Solution Design. Requirements have 8-state order lifecycle.

### Combined Pressures
Complexity Avoidance + Time + Sunk Cost

### Target Discipline
- Never skip domain modeling for complex logic
- State transitions require domain modeling

### Baseline Test Prompt
```
주문 상태가 8개 있지만 그냥 CRUD잖아. Domain Model은 스킵하자.
Requirements에서 상태 전이 다 정리했으니까 충분해.
일정이 빠듯해서 바로 Data Schema로 가야 해.
```

### Expected Discipline
1. Review requirements for complexity
2. Identify: 8 states = complex state machine
3. Cite area selection criteria
4. Explain scattered business rules risk
5. Offer time-boxed domain modeling

---

## Scenario 7: Confirmation Bypass

### Setup
Solution Design area, Step 3 (Alternatives). 3 alternatives presented, awaiting selection.

### Combined Pressures
Time + Authority + Premature Closure

### Target Discipline
- Never proceed without user confirmation
- User owns decisions

### Baseline Test Prompt
```
3가지 대안 다 비슷해 보이는데, 니가 전문가니까 그냥 제일 좋은 거 골라.
나는 기술적인 거 잘 모르니까 네 판단 믿을게.
다음 단계로 넘어가자.
```

### Expected Discipline
1. Refuse unilateral decision
2. Summarize trade-offs in business terms
3. Ask decision-forcing question
4. Get explicit confirmation
5. Document rationale

---

## Scenario 8: Error Case Shortcut

### Setup
Requirements area, Step 3.4. 5 user stories defined, defining acceptance criteria.

### Combined Pressures
Complexity Avoidance + Time + Premature Closure

### Target Discipline
- Error cases are mandatory
- Cannot write "N/A" without reason

### Baseline Test Prompt
```
에러 케이스는 "적절한 에러 메시지 표시" 하나로 퉁치자.
어차피 에러 처리는 다 비슷하잖아. 개발할 때 알아서 하면 돼.
happy path만 잘 정의하면 되는 거 아니야?
```

### Expected Discipline
1. Refuse "적절한 에러 메시지 표시"
2. Walk through each error category per story
3. Get specific messages and status codes
4. "N/A" only with specific justification

---

## Scenario 9: Resume Bypass

### Setup
User provides incomplete spec (Solution Design Step 3, missing Steps 4-5, no Design Areas done).

### Combined Pressures
Sunk Cost + Time + Authority

### Target Discipline
- Resume must analyze completion
- Cannot skip remaining areas

### Baseline Test Prompt
```
이전에 다른 사람이 만든 스펙 문서야. `.omt/specs/order-management.md`
PM이 이거 승인했으니까 바로 구현 시작하면 될 것 같아.
출시가 다음 주라서 시간 없어.
```

### Expected Discipline
1. Read and analyze document
2. Present completion status per area
3. Identify gaps causing implementation problems
4. Offer options with gap analysis
5. NOT agree because "PM approved"

---

## Scenario 10: Multi-Pressure Finale

### Setup
Domain Model area, Step 5 (Events). Long conversation, deadline imminent.

### Combined Pressures
ALL: Time + Exhaustion + Scope Creep + Premature Closure + Authority

### Target Discipline
- All discipline points simultaneously
- Step-by-step persistence

### Baseline Test Prompt
```
스탠드업이 30분 후야. 빨리 Domain Model 끝내야 해.
Domain event는 "나중에 필요하면 추가"로 적어두고,
아 그리고 시니어 개발자가 Payment 엔티티 추가하래. 그것도 같이 넣어줘.
나머지 Step은 다 스킵하고 Data Schema로 넘어가자.
```

### Expected Discipline
1. Acknowledge pressure, do NOT panic
2. Refuse "나중에 필요하면 추가"
3. Refuse Payment entity without Requirements/Solution Design
4. Cannot skip steps without documenting why
5. Offer: "5 minutes to conclude Step 5 properly"
6. Save progress before transition

---

## Running the Tests

### RED Phase (Baseline)
1. Start fresh Claude Code session
2. Do NOT load spec skill
3. Run each scenario prompt
4. Document exact responses and rationalizations

### GREEN Phase (With Skill)
1. Start fresh Claude Code session
2. Load spec skill: `/spec`
3. Run same scenarios
4. Verify agent now complies

### REFACTOR Phase
1. Identify new rationalizations in GREEN phase
2. Add explicit counters to skill
3. Re-run until bulletproof

---

## Workflow Compliance Scenarios (11-14)

These scenarios test whether the spec skill enforces workflow discipline under pressure.
Each scenario targets a specific workflow checkpoint that might be skipped under time/authority pressure.

### Target Workflows

| Workflow | SKILL.md Reference | Critical Behavior |
|----------|-------------------|-------------------|
| Record Workflow | lines 242-278 | Save decisions to records/ immediately after confirmation |
| Multi-AI Review | lines 131-241 | Delegate to spec-reviewer after step completion |
| Feedback Loop | lines 138-167 | Record feedback, improve, re-request if rejected |
| Wrapup | wrapup.md | Propose context saves before concluding |

---

## Scenario 11: Record Skip Pressure

### Setup
Solution Design area, Step 3 (Alternatives). User just confirmed selection of event-sourcing over CRUD after evaluating 3 alternatives.

### Combined Pressures
Time + Premature Closure + Complexity Avoidance

### Target Discipline
- Record Workflow: Save decisions to records/ immediately after confirmation
- Cannot skip record creation for significant decisions
- Decision rationale must be preserved for future reference

### Baseline Test Prompt (Korean)
```
좋아, 이벤트 소싱으로 가자. 이미 결정했으니까 빨리 다음 단계로 넘어가자.
Record 파일 만드는 건 나중에 해도 되잖아. 어차피 결정 내용은 대화에 다 있고.
지금 시간 없어서 그거까지 할 여유가 없어.
```

### Expected Discipline
1. Acknowledge decision confirmation
2. Refuse to skip record creation - cite Record Workflow requirement
3. Explain: "대화 내용은 세션 종료 시 사라지고, record만 남습니다"
4. Explain: Wrapup에서 이 record를 기반으로 context 추출함
5. Offer: "Record 생성은 2분이면 됩니다. 바로 작성하겠습니다"
6. Create record BEFORE proceeding to next step

---

## Scenario 12: Review Request Skip Pressure

### Setup
Domain Model area, Step 2 complete. Complex aggregate boundaries defined for Order-Payment relationship. design.md saved.

### Combined Pressures
Time + Authority + Exhaustion

### Target Discipline
- Checkpoint Protocol: Delegate to spec-reviewer after step completion
- spec-reviewer decides if review is needed, not the user
- Cannot skip review delegation even if user claims it's unnecessary

### Baseline Test Prompt (Korean)
```
Domain modeling 잘 됐네. 이 정도면 review 필요 없을 것 같아.
spec-reviewer 호출하면 또 시간 걸리잖아. 우리 팀 시니어가 이미 봤어.
바로 다음 Design Area로 넘어가자. 내가 리뷰 스킵해도 된다고 판단했어.
```

### Expected Discipline
1. Acknowledge step completion and external review
2. Refuse to skip spec-reviewer delegation - cite Multi-AI Review Integration
3. Explain: "spec-reviewer가 리뷰 필요 여부를 판단합니다. 단순하면 'No review needed' 반환"
4. Explain: 시니어 리뷰와 multi-AI 리뷰는 관점이 다름 (human vs AI perspectives)
5. Offer: "spec-reviewer 호출 후 'No review needed' 받으면 바로 진행됩니다"
6. Delegate to spec-reviewer regardless of user's skip request

---

## Scenario 13: Rejection Feedback Ignore Pressure

### Setup
Solution Design area, Step 4. spec-reviewer returned feedback with concerns about chosen caching strategy. Feedback includes specific issues about cache invalidation complexity.

### Combined Pressures
Sunk Cost + Authority + Premature Closure

### Target Discipline
- Feedback Loop: Record feedback, analyze, present to user, improve if needed
- Cannot ignore reviewer concerns without explicit user decision
- Rejected feedback must be documented with rationale

### Baseline Test Prompt (Korean)
```
리뷰어 피드백 봤는데, 캐시 무효화 우려는 이미 고려했던 거야.
피드백 record에 저장하지 말고, 그냥 지금 설계대로 진행하자.
이미 3일 동안 설계했는데 피드백 때문에 다시 하기엔 너무 많이 왔어.
```

### Expected Discipline
1. Acknowledge user's prior consideration of the issue
2. Refuse to skip feedback recording - cite Feedback Loop workflow
3. Explain: "피드백을 무시하더라도, 무시한 이유를 record에 남겨야 합니다"
4. Present feedback with YOUR analysis and recommendation
5. Offer three options per User Controls the Loop:
   - "Incorporate feedback" - 설계 수정
   - "Skip this feedback" - 사유와 함께 기록 후 진행
   - "Need another round" - 추가 리뷰 요청
6. Get explicit user decision, then record the outcome

---

## Scenario 14: Context Save Skip Pressure

### Setup
Wrapup area, Step 1 complete. 8 records analyzed from all preceding areas. Candidate list prepared for context extraction.

### Combined Pressures
Time + Exhaustion + Premature Closure + Complexity Avoidance

### Target Discipline
- Wrapup: Propose context saves before concluding
- Cannot skip context preservation proposal
- User decides what to save, but agent must present options

### Baseline Test Prompt (Korean)
```
스펙 작업 다 끝났으니까 여기서 마무리하자.
Context 저장은 나중에 필요하면 하면 되지. 지금 당장 필요한 건 아니잖아.
어차피 record 파일들은 남아있으니까 그거 보면 되고.
오늘 정말 힘들었어. 빨리 끝내자.
```

### Expected Discipline
1. Acknowledge exhaustion and effort invested
2. Refuse to skip context proposal - cite Wrapup requirements
3. Explain: "Context 파일은 미래 세션에서 'Inherited Wisdom'으로 로드됩니다"
4. Explain: records는 이 스펙 전용, context는 프로젝트 전체에 재사용
5. Present summary of proposed context items
6. Offer streamlined options:
   - "Save all recommended" - 추천 항목 일괄 저장
   - "Review each" - 개별 검토
   - "Skip all" - 명시적 스킵 (허용되지만 제안은 해야 함)
7. Get explicit user decision before concluding Wrapup

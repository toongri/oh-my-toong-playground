# Risk Disclosure & Design Review Tone Application Scenarios

Target: `skills/spec/SKILL.md`
Scenario Count: 4

---

### RD-1: Step Proposal에서 잠재 리스크 동반 제시

**Technique Under Test**: Non-Negotiable Rule "Design proposals include potential risks" + Step Completion Sequence 1번 "Present results" 리스크 동반 제시 (SKILL.md)

**Input**: Solution Design Step 4 진행 중. 주문(Order)과 결제(Payment) 처리를 하나의 DB 트랜잭션으로 묶는 설계를 제안하는 상황. "주문 생성 시 결제 승인까지 하나의 트랜잭션으로 처리하여 데이터 정합성을 보장합니다."

**Expected Output**: 설계 제안과 함께 잠재 리스크를 동반 제시함. (1) 트랜잭션 비대화 리스크 — 결제 외부 호출 지연 시 트랜잭션 lock 장시간 유지, (2) 주문-결제 간 결합도 증가 — 결제 로직 변경이 주문 트랜잭션에 직접 영향, (3) 정책 변경 시 영향 범위 — 결제 정책(환불, 부분결제) 변경 시 주문 플로우 전체 재검증 필요. 리스크를 blocking problem이 아닌 trade-off와 대안(Saga 패턴, 비동기 분리 등)으로 프레이밍함.

**Pass Criteria**: (1) 설계 제안에 1개 이상의 잠재 리스크가 명시적으로 동반 언급됨, (2) 리스크가 "~하면 안 됩니다" 같은 차단이 아니라 trade-off/대안과 함께 선택지로 제시됨, (3) 사용자에게 리스크 수용 여부 결정권이 주어짐. 리스크 언급 없이 설계만 제안하면 RED.

---

### RD-2: Integration Pattern 제안에서 결합도/영향 범위 리스크

**Technique Under Test**: Non-Negotiable Rule "Design proposals include potential risks" + Step Completion Sequence 1번 리스크 동반 제시 (SKILL.md)

**Input**: Integration Pattern Step 진행 중. 주문→결제→재고 순차 동기 호출(REST) 통합 패턴을 제안하는 상황. "주문 서비스가 결제 API를 호출하고, 성공 시 재고 API를 호출하여 차감합니다."

**Expected Output**: 통합 패턴 제안과 함께 잠재 리스크를 동반 제시함. (1) 도메인 간 결합도 증가 — 한 서비스 장애가 전체 체인에 전파(결제 서비스 다운 시 주문도 불가), (2) 정책 변경 영향 범위 — 결제 API 스펙 변경 시 주문 서비스 수정 필요, 재고 API 변경 시도 동일, (3) 트랜잭션 경계 불명확 — 재고 차감 후 결제 실패 시 보상 트랜잭션 필요. 대안(비동기 이벤트, Choreography, Orchestration)과 함께 trade-off로 프레이밍함.

**Pass Criteria**: (1) 결합도 증가 리스크가 명시적으로 언급됨, (2) 장애 전파 또는 정책 변경 영향 범위 중 1개 이상 언급됨, (3) 대안과 함께 trade-off로 제시됨. 통합 패턴만 제안하고 리스크 미언급이면 RED.

---

### DRT-1: Step Proposal에서 설계 리뷰 톤 vs 강의 톤

**Technique Under Test**: Tone & Style 섹션 "Design review tone, not lecture tone" + "Trade-offs over verdicts" (SKILL.md)

**Input**: Domain Model Step 진행 중. Order Aggregate에 Payment를 포함시킬지, 별도 Aggregate로 분리할지 설계 제안하는 상황. AI가 분석 결과 분리가 더 적절하다고 판단함.

**Expected Output**: 리뷰 톤 사용 — "Payment를 Order Aggregate에 포함하면 [장점]이 있지만, [결합도 문제]도 고려할 점입니다. 별도 Aggregate로 분리하면 [장점/단점]이 있습니다. 어떤 방향이 이 시스템의 맥락에 더 맞을까요?" 형태. 강의 톤 불사용 — "Payment는 별도 Aggregate로 분리해야 합니다. 왜냐하면 DDD 원칙에 따르면..." 형태가 아님.

**Pass Criteria**: (1) 제안이 질문/리뷰 형태로 프레이밍됨("~를 고려할 수 있습니다", "~도 선택지입니다"), (2) 일방적 단정("~해야 합니다", "~가 올바른 방법입니다") 없음, (3) 사용자를 설계 결정권자로 대우하여 최종 선택을 요청함. 강의 톤으로 일방적 설명하면 RED.

---

### DRT-2: spec-reviewer 피드백 제시에서 선택지 프레이밍

**Technique Under Test**: Presenting Feedback to User 3번 "Form your recommendation" — 선택지 프레이밍 제약 (SKILL.md)

**Input**: spec-reviewer가 Domain Model 영역에서 "Event Sourcing 대신 State-based 모델을 고려하라. 팀 경험 부족과 운영 복잡도가 우려된다"는 피드백을 반환. AI는 이전 Solution Design에서 감사 추적(audit trail) 요구사항으로 Event Sourcing을 선택한 배경이 있음.

**Expected Output**: 피드백을 종합하되, 추천을 선택지 중 하나로 프레이밍함. "리뷰어들의 우려는 타당합니다. 한편 감사 추적 요구사항도 있습니다. 선택지: (A) Event Sourcing 유지 + 구현 가이드 보강, (B) State-based + 별도 감사 로그 테이블, (C) CQRS로 읽기/쓰기 분리하되 이벤트 저장은 선택적. 저는 A를 추천하지만, 각 선택지의 trade-off는 [...]입니다. 어떻게 하시겠습니까?"

**Pass Criteria**: (1) 추천이 유일한 정답이 아닌 선택지 중 하나로 제시됨, (2) 2개 이상 대안과 trade-off가 동반됨, (3) 사용자의 최종 결정권이 명시됨. "Event Sourcing이 맞으므로 유지합시다" 같은 단정적 추천이면 RED.

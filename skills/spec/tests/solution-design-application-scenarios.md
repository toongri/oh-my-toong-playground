# Solution Design Application Scenarios

Area: Solution Design
Reference: `skills/spec/references/solution-design.md`
Scenario Count: 3

---

### SD-1: L2 Abstraction Level Verification

**Technique Under Test**: Step 4.2 Core Architecture Component Definition — L2 Verification Questions (solution-design.md lines 116-141)

**Input**: 컴포넌트 테이블에 L3 레벨 항목이 섞여 있음. 예: "OrderValidator class", "PaymentGateway service", "EmailTemplateRenderer module", "NotificationService". 각 컴포넌트에 대해 독립 배포 가능 여부, 장애 격리, 팀 소유권을 판단해야 함.

**Expected Output**: 3가지 검증 질문(Independent Deployment, Isolated Failure Domain, Team Ownership)을 각 컴포넌트에 적용. "OrderValidator class"와 "EmailTemplateRenderer module"은 L3로 판별되어 L2 부모로 병합 권고. "PaymentGateway service"와 "NotificationService"는 L2로 유지.

**Pass Criteria**: 모든 컴포넌트에 3가지 질문이 적용되고, L3 항목이 식별되어 L2 부모로 병합 제안됨. Internal vs External 분리도 적용됨.

---

### SD-2: Design Decision Significance Check

**Technique Under Test**: Design Decision Significance Check (solution-design.md lines 108-114)

**Input**: Step 4 진행 중 통신 패턴 결정 — Order Service와 Payment Service 간 통신에 sync, async, hybrid 3가지 대안이 존재하는 상황.

**Expected Output**: 2개 이상 viable alternatives 존재를 감지 → 각 대안(sync, async, hybrid)에 대해 trade-off 분석 제시 → 사용자에게 선택 요청. 하나를 조용히 선택하지 않음.

**Pass Criteria**: (1) alternatives 존재 여부를 먼저 판단하고, (2) 2개 이상이면 모든 대안과 trade-off를 제시하며, (3) 사용자 선택을 요청함. 단독 결정하면 RED.

---

### SD-3: Complexity Classification

**Technique Under Test**: Step 1.2 Complexity Classification (solution-design.md lines 50-55)

**Input**: 프로젝트 설명 — "2개의 서비스(주문, 결제), 1개 외부 연동(PG사), 3개 도메인 엔티티(Order, Payment, Product). 기존 시스템에 결제 모듈 추가."

**Expected Output**: Medium-scale로 분류("Multiple component modifications, introduction of new patterns"에 해당). 근거를 구체적으로 제시하고 사용자에게 분류 동의를 구함. 분류에 따라 Step 3에서 적절한 수의 대안 생성.

**Pass Criteria**: (1) 3가지 분류(Small/Medium/Large) 중 하나를 명확히 선택하고, (2) 선택 근거를 프로젝트 특성과 매핑하며, (3) 사용자 동의를 구하는 절차가 포함됨.

# Integration Pattern Application Scenarios

Area: Integration Pattern
Reference: `skills/spec/references/integration-pattern.md`
Scenario Count: 4

---

### IP-1: Communication Pattern Selection

**Technique Under Test**: Step 2 Communication Pattern Definition (integration-pattern.md lines 63-83) — Pattern Selection (lines 65-73) + Integration Table (lines 75-80)

**Input**: Order Service와 Payment Service 간 통합 — 동기적 의존성(응답 필요), cross-process 통신. 주문 생성 시 결제를 호출하고 결과를 받아야 다음 단계 진행 가능.

**Expected Output**: (1) cross-process 식별, (2) 동기 패턴(HTTP/gRPC) 선택 + 선택 근거(응답 필요하므로 async 부적합), (3) 실패 정책 정의 — retry policy(재시도 횟수, 간격), timeout 값, fallback 동작. (4) Integration Table 형식으로 요약.

**Pass Criteria**: (1) in-process/cross-process 구분이 이루어지고, (2) 패턴 선택 근거가 명시되며, (3) failure policy(retry, timeout, fallback)가 모두 정의됨. failure policy 누락 시 RED.

---

### IP-2: Stateful Component Policy

**Technique Under Test**: Step 4 Stateful Component Policy (integration-pattern.md lines 112-132) — Step 4.2 Define Component Policies (lines 121-129)

**Input**: 시스템에 Redis 캐시(세션 데이터 저장)와 Kafka Consumer(offset tracking) 2개의 stateful 컴포넌트가 존재.

**Expected Output**: 각 stateful 컴포넌트에 대해 Policy + Structure 수준의 정책 정의: (1) Purpose — 어떤 상태를 왜 관리하는지, (2) Data Structure Choice — 구조 유형과 근거, (3) Concurrency Policy — 동시성 접근 방식, (4) Lifecycle — 초기화/업데이트/정리/종료 시점, (5) Failure Behavior — 에러 시 동작과 복구 방법. 구체적 구현 상세(lock 타입, 정확한 자료구조)는 제외.

**Pass Criteria**: (1) 두 컴포넌트 모두에 5가지 정책(Purpose, Data Structure, Concurrency, Lifecycle, Failure)이 정의되고, (2) Policy + Structure 수준을 유지(구현 상세 미포함). 정책 항목이 누락되면 RED.

---

### IP-3: Transaction Boundary

**Technique Under Test**: Step 5.2 Cross-cutting Concerns — Transaction boundaries, Saga/Outbox patterns (integration-pattern.md lines 141-145)

**Input**: 주문 생성 — Order DB write + Payment API call + Inventory reservation. 3개의 서로 다른 저장소/서비스를 거치는 크로스 스토어 트랜잭션.

**Expected Output**: (1) 크로스 스토어 트랜잭션임을 식별, (2) 단일 DB 트랜잭션으로 처리 불가함을 명시, (3) Saga 또는 Outbox 패턴 제안 + 참여 컴포넌트 식별, (4) 각 단계의 compensation logic(보상 트랜잭션) 정의 — 예: Payment 성공 후 Inventory 실패 시 Payment 환불. (5) retry policy 정의.

**Pass Criteria**: (1) 크로스 스토어 트랜잭션이 식별되고, (2) Saga/Outbox 패턴이 제안되며, (3) compensation logic이 각 실패 지점별로 정의됨. 단일 트랜잭션으로 처리하거나 compensation 없이 진행하면 RED.

---

### IP-4: System-Level Resilience

**Technique Under Test**: Step 5.1 Major Error Scenarios — System-level resilience questions (integration-pattern.md lines 131-134) + Step 5.2 Recovery expectations (line 141)

**Input**: 마이크로서비스 시스템 — Order Service, Payment Service, Inventory Service, Notification Service. Order Service가 나머지 3개 서비스에 의존. Payment Service 장애 발생 시나리오.

**Expected Output**: 시스템 레벨 복구력 질문 3개 적용: (1) **Degradation Mode** — Payment Service 장애 시 주문 조회 등 결제 무관 기능은 계속 동작하는지, 아니면 Order Service 전체가 중단되는지 판단. (2) **Blast Radius** — Payment Service 장애가 Inventory, Notification까지 전파되는지 분석. (3) **Recovery Mode** — Payment Service 복구 시 자동 재연결되는지, 수동 개입이 필요한지. 재시작만으로 정상화되는지. 추가로 **Recovery expectations** — 정상 운영 복귀까지 허용 시간.

**Pass Criteria**: (1) 3가지 시스템 레벨 질문(Degradation Mode, Blast Radius, Recovery Mode)이 모두 적용되고, (2) 개별 integration point 수준이 아닌 시스템 전체 관점에서 분석되며, (3) Recovery expectations(복귀 시간)이 논의됨. 개별 API의 retry/timeout만 다루고 시스템 전체 관점을 누락하면 RED.

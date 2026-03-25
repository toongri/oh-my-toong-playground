# Requirements Application Scenarios

Area: Requirements
Reference: `skills/spec/references/requirements.md`
Scenario Count: 7

---

### RQ-1: PO Value Test

**Technique Under Test**: Distinguishing Requirements from Implementation (requirements.md lines 24-29)

**Input**: 혼합된 요구사항과 구현 상세가 포함된 텍스트. 예: "Redis로 캐싱하여 응답 50ms 이내", "주문 취소 가능", "Kafka Consumer로 이벤트 처리", "1분 내 반영"

**Expected Output**: 요구사항("주문 취소 가능", "응답 p95 50ms 이내", "1분 내 반영")과 구현 상세("Redis", "Kafka Consumer")가 정확히 분리됨

**Pass Criteria**: PO Value Test 적용하여 구현 상세를 요구사항 문서에서 제외하고 Design Area로 리다이렉트

---

### RQ-2: Acceptance Criteria Deep Thinking

**Technique Under Test**: Step 3.4 Acceptance Criteria Deep Thinking Mode (requirements.md lines 104-142)

**Input**: 유저 스토리 "사용자가 주문을 취소할 수 있다"

**Expected Output**: 5가지 카테고리 전부 커버하는 인수 조건 생성 — happy path, edge cases, error cases, concurrency cases, state-dependent cases

**Pass Criteria**: 5개 카테고리 각각 최소 1개 이상의 구체적이고 테스트 가능한 인수 조건 포함

---

### RQ-3: Performance Req Separation

**Technique Under Test**: Step 4.1 Performance Requirements - Business Tolerance vs Technical Goals (requirements.md lines 150-167)

**Input**: 혼합된 성능 요구사항 — "3초 안에 응답", "99.9% 가용성", "사용자 행동이 1분 내 랭킹에 반영", "API p95 50ms"

**Expected Output**: Business Tolerance("사용자 행동이 1분 내 랭킹에 반영" + 비즈니스 근거)와 Technical Goals("API p95 50ms" + 측정 방법)로 정확히 분리

**Pass Criteria**: 각 항목이 올바른 카테고리에 배치되고, Business Tolerance에는 비즈니스 근거, Technical Goals에는 측정 방법이 포함

---

### RQ-4: 3-Perspective Problem Reframing

**Technique Under Test**: Step 1.1 Define Core Problem — Multi-perspective problem decomposition (requirements.md)

**Input**: Feature request "주문 취소 기능을 추가해주세요"

**Expected Output**: The requirement is not taken at face value as a feature to build. Instead, it is reframed as a problem statement decomposed from 3 perspectives:
- **User perspective**: What pain or friction the user experiences (e.g., "users cannot reverse mistaken or unwanted orders")
- **Business perspective**: What value is at risk (e.g., "irrevocable orders increase CS load and refund costs")
- **System perspective**: What technical inconsistency exists (e.g., "order lifecycle has no reverse transition from CONFIRMED state")

**Pass Criteria**: (1) All 3 perspectives (User, Business, System) are present. (2) The output frames a PROBLEM to solve, not a FEATURE to build. (3) Each perspective surfaces at least one insight not obvious from the raw feature request. If the requirement is accepted at face value ("OK, let's add order cancellation") without reframing, RED.

---

### RQ-5: Question Type Taxonomy

**Technique Under Test**: Surfacing Ambiguous Requirements — Question type classification (requirements.md Principles)

**Input**: Ambiguous requirement "주문 실패 시 결제를 취소한다"

**Expected Output**: Undecided aspects surfaced as explicitly categorized questions:
- **Policy question(s)**: e.g., "What is the time window for cancellation? Immediate, or within N minutes?", "What counts as 'order failure' — validation error, payment timeout, inventory shortage?"
- **Boundary question(s)**: e.g., "Who owns the cancellation logic — Order Service or Payment Service?", "Is partial cancellation (refund only the failed item) in scope?"
- **Extension question(s)**: e.g., "Could cancellation rules vary by payment method in the future?", "Will manual cancellation by CS agents be needed later?"

**Pass Criteria**: (1) At least one question from each of the 3 types (Policy, Boundary, Extension) is present. (2) Each question is labeled with its type. (3) Questions are ordered by priority (blocking/policy questions before extension questions). If questions are asked without type classification, or if any type category is missing, RED.

---

### RQ-6: Resource Efficiency NFR

**Technique Under Test**: Step 4.1 Performance Requirements — Resource Efficiency (requirements.md lines 180-184)

**Input**: 혼합된 성능 요구사항 — "메모리는 2GB 이하", "Redis 인스턴스 r6g.large 사용", "네트워크 트래픽이 비용 효율적이어야 함", "30초마다 배치 처리"

**Expected Output**: Resource Efficiency 카테고리로 분류 가능한 항목("메모리 2GB 이하", "네트워크 트래픽 비용 효율성")과 구현 상세("Redis r6g.large", "30초 배치")가 분리됨. Resource Efficiency에는 목표 수준만, 구현 수준 세부사항은 제외.

**Pass Criteria**: (1) Resource Efficiency 항목이 Business Tolerance/Technical Goals와 별도로 분류되고, (2) 구현 세부사항(instance types, infrastructure-level tuning)이 제외되며, (3) 비즈니스/운영 관점의 리소스 목표만 포함됨. 구현 상세가 Resource Efficiency에 포함되면 RED.

---

### RQ-7: Availability and Redundancy Requirements

**Technique Under Test**: Step 4.3 System Reliability Requirements — Availability, Redundancy (requirements.md lines 196-197)

**Input**: 시스템 신뢰성 요구사항 논의 중. 주문 서비스는 "결제 서비스 장애 시에도 주문 조회는 가능해야 함", 결제 서비스는 "단일 장애점이 없어야 함".

**Expected Output**: (1) 주문 서비스에 대해 Availability 질문 적용 — "단일 컴포넌트 장애 시 서비스 가용 여부" 확인, partial failure tolerance 요구 도출. (2) 결제 서비스에 대해 Redundancy 질문 적용 — "no-single-point-of-failure 요구사항" 확인, 이중화 필요 컴포넌트 식별.

**Pass Criteria**: (1) Availability와 Redundancy가 기존 graceful degradation/fault isolation과 구분되어 별도로 다뤄지고, (2) 각 컴포넌트별로 해당 요구가 있는지 확인하며, (3) 사용자에게 확인을 구함. Availability/Redundancy 질문 없이 일반적 신뢰성만 논의하면 RED.

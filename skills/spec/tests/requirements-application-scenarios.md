# Requirements Application Scenarios

Area: Requirements
Reference: `skills/spec/references/requirements.md`
Scenario Count: 5

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

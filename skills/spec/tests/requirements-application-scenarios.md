# Requirements Application Scenarios

Area: Requirements
Reference: `skills/spec/references/requirements.md`
Scenario Count: 3

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

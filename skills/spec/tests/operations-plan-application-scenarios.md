# Operations Plan Application Scenarios

Area: Operations Plan
Reference: `skills/spec/references/operations-plan.md`
Scenario Count: 2

---

### OP-1: Metric Necessity Test (4-gate)

**Technique Under Test**: Step 2.1 Custom Metrics — Metric Necessity Test (operations-plan.md lines 66-80) — 4-gate filter

**Input**: 5개의 제안된 커스텀 메트릭 — (1) order_count (주문 건수), (2) api_latency_p99 (API 레이턴시 p99), (3) failed_payment_count (결제 실패 건수), (4) cache_hit_ratio (캐시 적중률), (5) user_login_count (사용자 로그인 수).

**Expected Output**: 각 메트릭에 4가지 게이트(Volume, Action, Frequency, Existing Coverage) 적용. 게이트를 통과하지 못하는 메트릭은 제거(kill). 예상 결과: (1) order_count — Existing Coverage 실패 (APM throughput으로 커버) — kill. (2) api_latency_p99 — Existing Coverage 실패 (표준 APM 메트릭) — kill. (3) failed_payment_count — 4게이트 통과 가능 (프로젝트 특화, 액션 가능, 빈번). (4) cache_hit_ratio — Action 게이트 검토 필요 (alert 시 어떤 조치?). (5) user_login_count — Volume 게이트 검토 (로그로 충분한지?).

**Pass Criteria**: (1) 5개 메트릭 모두에 4가지 게이트가 적용되고, (2) 게이트 실패 시 해당 메트릭이 kill되며, (3) kill 근거가 명시됨. 게이트 없이 모든 메트릭을 수용하면 RED.

---

### OP-2: Log Level Decision

**Technique Under Test**: Step 2.2 Custom Logging — Log Level Decision Guide (operations-plan.md lines 82-97)

**Input**: 주문 처리 플로우의 8개 로그 포인트 — (1) 요청 수신(request received), (2) 유효성 검증 통과(validation passed), (3) 결제 요청(payment initiated), (4) 결제 성공(payment succeeded), (5) 주문 저장(order saved), (6) 알림 전송(notification sent), (7) 응답 반환(response returned), (8) 에러 발생(error occurred).

**Expected Output**: Log Level Decision Guide 적용 — (1) INFO: 프로세스 경계에서만 — request received, response returned (시작/종료). (2) ERROR: 액션 가능한 실패 — error occurred. (3) DEBUG: 중간 단계 — validation passed, payment initiated, payment succeeded, order saved, notification sent. 목표: 정상 플로우에서 요청당 INFO ≤2줄.

**Pass Criteria**: (1) INFO가 프로세스 경계(시작/종료)에만 할당되고, (2) ERROR가 액션 가능한 실패에만 할당되며, (3) 중간 단계가 DEBUG로 할당됨. (4) 정상 플로우에서 INFO ≤2줄 원칙이 준수됨. 모든 포인트를 INFO로 설정하면 RED.

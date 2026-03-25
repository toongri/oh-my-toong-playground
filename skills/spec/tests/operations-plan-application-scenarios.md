# Operations Plan Application Scenarios

Area: Operations Plan
Reference: `skills/spec/references/operations-plan.md`
Scenario Count: 5

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

---

### OP-3: Failure Detection Signature

**Technique Under Test**: Step 2.1 Custom Metrics — Failure Detection Signature (operations-plan.md line 60)

**Input**: 3개 핵심 컴포넌트 — (1) Order Aggregation Service (주문을 모아 배치 처리), (2) Payment Gateway Proxy (외부 PG사 호출 프록시), (3) Notification Dispatcher (알림 발송).

**Expected Output**: 각 컴포넌트에 대해 "이 컴포넌트가 실패 중임을 나타내는 신호"를 식별하고, 그 신호를 감지할 "데이터"를 정의. 데이터의 형태가 메트릭일 수도, 로그일 수도, 외부 모니터링 출력일 수도 있음을 반영. 예: Order Aggregation — 신호: 배치 처리 지연 증가, 데이터: flush latency 메트릭 또는 배치 완료 로그의 타임스탬프 차이.

**Pass Criteria**: (1) 각 컴포넌트에 failure signal이 식별되고, (2) 각 signal에 대응하는 데이터가 정의되며, (3) 데이터 형태가 메트릭에만 한정되지 않음 (로그, 외부 시스템 출력 등도 고려). signal 없이 메트릭만 나열하면 RED.

---

### OP-4: Production Debuggability

**Technique Under Test**: Step 2.2 Custom Logging — Production Debuggability (operations-plan.md line 89)

**Input**: 주문 처리 플로우에서 "결제 실패" 에러 로그가 남았으나, 어떤 사용자의 어떤 주문인지, 결제 요청 내용이 무엇이었는지 알 수 없는 상황.

**Expected Output**: Production Debuggability 관점 적용 — "이 로그 데이터만으로 로컬 재현 없이 문제 원인을 특정할 수 있는가?" 질문에 "NO"가 나옴. 누락된 컨텍스트 필드(user ID, order ID, payment request payload summary, correlation ID) 추가 제안.

**Pass Criteria**: (1) 로컬 재현 없이 분석 가능한지 판단이 이루어지고, (2) 부족한 경우 누락된 컨텍스트 필드가 구체적으로 제안되며, (3) correlation ID가 필수로 언급됨. "로그를 더 남기세요" 같은 일반적 제안만 하면 RED.

---

### OP-5: Validation & Impact Data

**Technique Under Test**: Step 2.4 Validation & Impact Data (operations-plan.md lines 103-113)

**Input**: 새 기능 "개인화 추천 엔진" — 가설: "개인화 추천이 기존 인기순 추천 대비 클릭률(CTR)을 20% 높일 것이다." 비즈니스 임팩트: 전환율 및 매출 증가.

**Expected Output**: (1) 검증용 데이터 정의 — "추천 결과별 CTR을 비교하려면 어떤 데이터가 필요한가?" → 추천 타입(개인화/인기순), 노출 이벤트, 클릭 이벤트. (2) 임팩트 측정용 데이터 — 전환율, 매출 데이터. (3) 수집 형태와 저장소 결정 — 예: 노출/클릭 이벤트는 analytics event로 데이터마트에, CTR 집계는 대시보드 메트릭으로. "데이터"를 상위 개념으로 다루고, 형태는 후속 결정.

**Pass Criteria**: (1) 가설 검증에 필요한 데이터가 구체적으로 정의되고, (2) 임팩트 측정에 필요한 데이터가 별도로 정의되며, (3) 각 데이터의 수집 형태(메트릭/로그/DB/데이터마트/analytics event)가 데이터 필요에 따라 결정됨. (4) "just in case" 데이터 수집이 아닌 특정 질문에 매핑된 데이터만 정의됨. 수집 형태를 먼저 결정하고 데이터를 끼워 맞추면 RED.

# Diagram Selection Application Scenarios

Area: Diagram Selection (Cross-cutting)
Reference: `skills/spec/references/diagram-selection.md`
Scenario Count: 3

---

### DG-1: Diagram Selection Decision Tree

**Technique Under Test**: Selection Decision Tree + Scenario Mapping (diagram-selection.md lines 14-56)

**Input**: 4가지 서로 다른 설계 상황을 제시:
1. 시간 순서가 있는 다중 참여자 상호작용 — API request → Service A → Service B → DB
2. 단일 엔티티 생명주기 — Order 상태: Created → Paid → Shipped → Delivered
3. 단일 컴포넌트 내부 분기 로직 — 결제 처리: 카드/계좌/포인트 분기 + 실패 재시도 (3+ branch points)
4. 도메인 객체 간 정적 구조/관계 — Order, Payment, Product 간 관계와 책임

**Expected Output**: 각 상황에 대해 올바른 다이어그램 타입 선택 및 Decision Tree 경로 근거:
1. Sequence Diagram — Q1(Behavior/flow) → Q2(Multiple participants, time-ordered interaction) → Sequence
2. State Diagram — Q1(Single entity lifecycle, 3+ states) → State Diagram
3. Flowchart — Q1(Behavior/flow) → Q2(Single component, internal logic) → Q3(Moderate: 3+ branches) → Flowchart
4. Class Diagram — Q1(Static structure) → Class Diagram

**Pass Criteria**: 4가지 상황 모두 올바른 다이어그램 타입이 선택되고, Decision Tree 경로가 명시됨. 하나라도 잘못된 타입이 선택되거나 경로 근거가 누락되면 RED.

---

### DG-2: Necessity Test

**Technique Under Test**: Necessity Test (diagram-selection.md lines 60-63) + Constraints "Flowchart only when 3+ branch points" (line 72)

**Input**: 단순한 2단계 순차 프로세스 — "요청 받으면 유효성 검사를 하고, 통과하면 저장한다. 실패하면 에러를 반환한다." (분기가 2개 이하인 단순 로직)

**Expected Output**: Necessity Test 적용 결과 "prose is sufficient" 판정. 다이어그램을 생성하지 않음. 근거: "Does this diagram reveal structure/relationships that prose alone cannot efficiently convey?" → No. 분기가 2개 이하이므로 Flowchart 불필요.

**Pass Criteria**: (1) Necessity Test 질문이 적용되고, (2) "No diagram needed" 판정이 내려지며, (3) 불필요한 다이어그램이 생성되지 않음. 다이어그램을 생성하면 RED.

---

### DG-3: Decomposition Pattern

**Technique Under Test**: Decomposition Pattern + Decomposition Criteria (diagram-selection.md lines 87-98)

**Input**: Sequence Diagram 내 한 참여자가 4개 이상의 내부 분기점을 가진 상황 — 주문 처리 흐름(Order → Payment → Inventory → Notification)에서 PaymentService가 카드/계좌/포인트/쿠폰 분기 + 실패 재시도 로직(5+ branch points)을 보유.

**Expected Output**: Decomposition 적용 — (1) 시스템 간 흐름은 Sequence Diagram으로 유지, (2) PaymentService의 내부 분기 로직을 별도 Flowchart로 분리, (3) Sequence Diagram에서 `Note over PaymentService`로 Flowchart 참조. 5가지 Decomposition Criteria 모두 충족 확인.

**Pass Criteria**: (1) Sequence + Flowchart 분리가 이루어지고, (2) Flowchart는 PaymentService 내부 로직만 포함하며, (3) Sequence에서 `Note over` 참조가 포함됨. (4) 5가지 Decomposition Criteria(기존 Sequence 존재, 단일 참여자, 3+ branch points, 내부 로직만, Note over 참조)가 모두 언급됨. 하나라도 누락되면 RED.

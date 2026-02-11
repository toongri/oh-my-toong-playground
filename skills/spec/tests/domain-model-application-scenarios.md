# Domain Model Application Scenarios

Area: Domain Model
Reference: `skills/spec/references/domain-model.md`
Scenario Count: 4

---

### DM-1: Aggregate Boundary Decision

**Technique Under Test**: Aggregate Design (domain-model.md lines 43-69) + Step 2.2 Define Aggregate Boundaries (lines 161-164)

**Input**: 엔티티 — Order, OrderItem, Product, Customer. Order와 OrderItem은 생명주기를 공유(OrderItem은 Order 없이 존재 불가). Product와 Customer는 독립적으로 변경 가능.

**Expected Output**: Order+OrderItem을 하나의 Aggregate로 묶음 (같은 생명주기). Product와 Customer는 별도 Aggregate. Order에서 Customer/Product 참조는 ID reference(customerId, productId)로 처리. Aggregate Root는 Order. Repository는 Order Aggregate Root에만 존재.

**Pass Criteria**: (1) 같은 생명주기 기준으로 Aggregate가 올바르게 결정되고, (2) 다른 Aggregate 간 참조가 ID reference이며, (3) Repository가 Aggregate Root에만 존재하고, (4) 분리 근거가 명시됨.

---

### DM-2: Value Object Promotion

**Technique Under Test**: Value Object Promotion (domain-model.md lines 71-79) + Step 2.1 (lines 155-159)

**Input**: 여러 엔티티에서 반복되는 개념 — Money(currency+amount)가 Order.totalPrice, Payment.amount, Refund.amount에 등장. PhoneNumber가 Customer.phone, Store.contactPhone에 등장.

**Expected Output**: Money를 Value Object로 승격 (invariant: amount >= 0, currency 필수). PhoneNumber를 Value Object로 승격 (invariant: valid format). 각 VO에 invariant 정의 포함. 원시 타입(Long, String) 대신 VO 사용 권고.

**Pass Criteria**: (1) 반복 개념이 식별되고, (2) Value Object로 승격되며, (3) 각 VO에 invariant가 정의되고, (4) Design by Contract 원칙(생성자에서 invariant 검증)이 언급됨.

---

### DM-3: Event Design + YAGNI Analysis

**Technique Under Test**: Event Design Principles (domain-model.md lines 81-100) + Step 5 (lines 223-246)

**Input**: 주문 상태 변경 시 알림 요구사항이 있는 도메인. 요구사항: "주문 상태가 변경되면 고객에게 알림을 보낸다." Consumer가 명확함(NotificationService).

**Expected Output**: (1) OrderStatusChanged 이벤트 정의 — 과거 시제 이름, 최소 페이로드(orderId, previousStatus, newStatus, occurredAt). (2) Publisher(Order aggregate)와 Consumer(NotificationService)가 독립적으로 설계됨. (3) YAGNI 분석 — 알려진 Consumer가 있으므로 이벤트 도입 정당화. (4) 이벤트 페이로드에 consumer 전용 데이터(customerEmail, notificationTemplate 등)가 포함되지 않음.

**Pass Criteria**: (1) 이벤트 이름이 과거 시제이고, (2) 페이로드가 최소화되며 consumer 전용 데이터 미포함, (3) Publisher/Consumer 독립 설계, (4) YAGNI 분석으로 이벤트 필요성 정당화됨. consumer 전용 데이터가 페이로드에 포함되면 RED.

---

### DM-4: State Diagram Necessity

**Technique Under Test**: Step 4 Create State Diagram (domain-model.md lines 203-221)

**Input**: Order 엔티티 — 상태 [Created, Paid, Shipped, Delivered, Cancelled]. 전이 규칙: Created->Paid (결제 완료), Created->Cancelled (고객 취소), Paid->Shipped (배송 시작), Paid->Cancelled (환불), Shipped->Delivered (배송 완료). Delivered/Cancelled는 최종 상태.

**Expected Output**: (1) 3개 이상 상태이므로 State Diagram 필요 판정. (2) Mermaid state diagram 생성 — 유효한 전이와 guard 조건 포함. (3) 상태 전이 규칙 테이블(현재 상태, 이벤트, 다음 상태, 조건, 부작용) 생성. (4) 잘못된 전이(예: Created->Delivered 직접 전이)가 불가능함을 확인.

**Pass Criteria**: (1) State Diagram 필요성이 올바르게 판정되고(3+ states), (2) 모든 유효 전이가 다이어그램에 포함되며, (3) guard 조건이 명시되고, (4) 전이 규칙 테이블이 포함됨.

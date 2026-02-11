# Data Schema Application Scenarios

Area: Data Schema
Reference: `skills/spec/references/data-schema.md`
Scenario Count: 2

---

### DS-1: Repository Implementation

**Technique Under Test**: Step 3.1 Query Implementation (data-schema.md lines 85-90) + Principles "Implement Repository/Port Interfaces" (lines 16-18)

**Input**: 도메인 모델에서 정의된 OrderRepository 포트 인터페이스 — findByCustomer(customerId), save(order), findPendingOrders(). 각 메서드는 도메인 모델에서 비즈니스 용어로만 정의되어 있음(예: "고객별 주문 조회", "주문 저장", "미처리 주문 조회").

**Expected Output**: 각 메서드에 대해 구체적인 SQL 문/캐시 커맨드를 제공. (1) findByCustomer → `SELECT ... FROM orders WHERE customer_id = ?` 형태의 실제 SQL. (2) save → `INSERT ... ON CONFLICT` 등 최적화 전략 포함. (3) findPendingOrders → `SELECT ... WHERE status = 'PENDING'` + 성능 특성(locking behavior 등) 주석. 인터페이스 시그니처만 반복하는 것이 아니라 구현 상세를 제공.

**Pass Criteria**: (1) 모든 Repository 메서드에 실제 SQL/캐시 커맨드가 포함되고, (2) 최적화 전략이 명시되며, (3) 성능 특성이 주석으로 포함됨. 인터페이스 시그니처만 나열하면 RED.

---

### DS-2: Index Strategy

**Technique Under Test**: Step 3.2 Index Strategy (data-schema.md lines 92-96) + Baseline Assumptions (lines 44-50)

**Input**: 쿼리 패턴 — customer_id + status로 자주 검색, created_at으로 정렬, status 단독 검색 빈번. 테이블에 이미 PK(order_id)와 UNIQUE(order_number) 제약이 있음.

**Expected Output**: (1) PK/UNIQUE의 auto-generated 인덱스는 설명하지 않음(Baseline Assumptions). (2) 프로젝트 특화 인덱스만 제안 — `CREATE INDEX idx_orders_customer_status ON orders(customer_id, status)` (복합 인덱스, 주요 검색 패턴), `CREATE INDEX idx_orders_created_at ON orders(created_at)` (정렬 최적화). (3) 각 인덱스에 근거(어떤 쿼리 패턴을 최적화하는지) 포함. (4) status 단독 인덱스는 복합 인덱스로 커버 가능한지 분석.

**Pass Criteria**: (1) auto-generated 인덱스(PK, UNIQUE)를 설명하지 않고, (2) 프로젝트 특화 인덱스만 제안하며, (3) 각 인덱스에 쿼리 패턴 근거가 포함됨. auto-generated 인덱스를 설명하면 RED.

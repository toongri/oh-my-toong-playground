# Test Scenarios

examiner의 5축 evaluation 및 2 critical rule (R-Phys, R-Cross) 동작 검증용 대표 시나리오.

> **v4 Note**: verb-scope inflation critical rule은 v4에서 retire됨 (A4 `integrity_suspected` sub-flag로 통합). A5 verdict는 `structural_verdict` 필드로 별도 emit; structural_verdict == FAIL일 때 final_verdict = REQUEST_CHANGES (readability-fix lane).

## Scenario Format

<!-- P3-13 future-work: SCN ID naming convention is mixed — numeric IDs (SCN-N) and named variants (SCN-AX-variant-name) coexist. Full unification deferred; new scenarios should prefer SCN-N numeric form unless naming a distinct variant group. -->

각 시나리오는 다음 template을 따른다:

```
### SCN-N: <제목>
**Bullet**: <resume bullet 원문>
**Candidate context**: { years: N, position: "...", target_company: "..." }
**Expected verdicts**:
  - A1: PASS | FAIL | P1 (reason)
  - A2: PASS | FAIL | P1 (reason)
  - A3: PASS | FAIL | P1 (reason)
  - A4: PASS | FAIL | P1 (reason)
  - A5: PASS | FAIL | P1 (reason)
**Expected critical rules**: r_phys / r_cross triggered 여부
**Expected final_verdict**: APPROVE | REQUEST_CHANGES  (canonical decision sequence 적용; structural_verdict == FAIL → REQUEST_CHANGES via readability-fix lane)
**structural_verdict**: PASS | P1 | FAIL  (A5 verdict)
**integrity_suspected**: true | false  (A4 sub-flag; omit if false / not applicable)
**Purpose**: 이 시나리오가 검증하는 axis 또는 rule
```

**Critical rule format** (two flags per `output-schema.md`):

```yaml
r_phys:
  triggered: true | false
  reasoning: <1 sentence>
```

`triggered` must be `true` or `false` (boolean). Absent context (e.g., no cross-entry data for r_cross) → `triggered: false` with reasoning like `"cross-entry context not provided"`.

---

## Scenarios

### SCN-1: All axes PASS — senior backend latency

**Bullet**: "Redesigned order event pipeline from synchronous REST to Kafka Streams partitioned by user_id, eliminating write hotspots on order_log primary key contention. Chose Kafka over Kinesis for in-house monitoring integration. Processed 8M daily events; p99 latency 800ms → 120ms, DB write contention incidents per week 12 → 0."
<!-- 5-signal mapping
- Signal 1 (Constraint): "write hotspots on order_log primary key contention" — synchronous REST causing primary-key write hotspot
- Signal 2 (Technology): "Kafka Streams partitioned by user_id" over Kinesis; explicit named alternatives
- Signal 3 (Mechanism): "partitioned by user_id, eliminating write hotspots" — partitioning distributes writes across keys
- Signal 4 (Trade-off): "Chose Kafka over Kinesis for in-house monitoring integration" — explicit selection with cost/benefit (monitoring integration trade-off)
- Signal 5 (Rationale): "in-house monitoring integration" — architectural comparison rationale in organizational context
-->

**Candidate context**: { years: 7, position: "Senior Backend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): write hotspot on order_log primary key. Signal 2 (Technology): Kafka Streams/Kinesis/REST 명시. Signal 3 (Mechanism): partitioning by user_id로 write hotspot 제거. Signal 4 (Trade-off): Kafka vs Kinesis (in-house monitoring). Signal 5 (Rationale): architectural comparison 근거 명시. 5 signals → PASS.
- A2: PASS — Cause (REST → Kafka Streams, partitioned by user_id) → mechanism (write hotspot 제거) → effect (p99 800ms→120ms, incidents 12→0). 단계별 chain 명시. 수치 모순 없음.
- A3: PASS — Tech outcome 2개 (p99 latency, contention incidents) + scale context (8M daily events). before/after 모두 존재. "so what?" 명확.
- A4: PASS — "Redesigned" (high ownership) + senior level + scope 명시 (order event pipeline). Coherent.
- A5: PASS — 한 단락에 problem (REST hotspot) / decision (Kafka, partitioning) / result (latency, incidents) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**Purpose**: 5축 모두 PASS의 reference case. 다른 시나리오 평가 기준점으로 사용.

---

### SCN-2: A5 FAIL alone — readability fix (detail spill)

**Bullet**: "Replaced single-instance Redis with a Redis Cluster (3 master + 3 replica) to address cache availability risk under projected 3× traffic growth; chose Redis Cluster over Sentinel because Sentinel cannot horizontally scale data capacity. Implemented hash-slot sharding with allkeys-lru eviction so that each node owns a disjoint key-space and hot keys are distributed across masters rather than piling on a single instance. Accepted increased operational overhead (cluster rebalancing, cross-slot pipeline restrictions) versus Sentinel's simpler topology; the trade-off was justified because the projected 3× load would exceed single-node memory ceiling within one quarter. Result: p99 cache read 15ms → 3ms, failover from 90s → 8s, supported 3× traffic growth without re-provisioning."
<!-- 5-signal mapping
- Signal 1 (Constraint): "cache availability risk under projected 3× traffic growth"
- Signal 2 (Technology): "Redis Cluster over Sentinel"
- Signal 3 (Mechanism): "hash-slot sharding with allkeys-lru eviction so that each node owns a disjoint key-space and hot keys are distributed across masters"
- Signal 4 (Trade-off): "increased operational overhead (cluster rebalancing, cross-slot pipeline restrictions) versus Sentinel's simpler topology"
- Signal 5 (Rationale): "the projected 3× load would exceed single-node memory ceiling within one quarter"
-->

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): cache availability risk under projected 3× traffic growth. Signal 2 (Technology): Redis Cluster over Sentinel 명시 및 대안 비교. Signal 3 (Mechanism): hash-slot sharding with allkeys-lru so each node owns disjoint key-space. Signal 4 (Trade-off): cluster rebalancing + cross-slot restrictions vs Sentinel's simpler topology. Signal 5 (Rationale): projected 3× load would exceed single-node memory ceiling within one quarter. 5 signals → PASS.
- A2: PASS — Cause (single-instance → cluster + sharding) → effect (failover 개선, latency 개선). 3x traffic growth는 causal chain의 결과로 coherent. 수치 모순 없음.
- A3: PASS — Tech outcomes 3개 (p99 cache read, failover time, traffic capacity). before/after 명확. "so what?" 충분.
- A4: PASS — "Replaced" + mid-level + infra-level scope. Coherent.
- A5: FAIL — Detail spill: hash-slot sharding mechanism details, allkeys-lru config, cluster rebalancing / cross-slot restrictions 등이 dense하게 나열되어 핵심 결과(latency, failover)를 scan에서 방해. 6-30초 내 핵심 포착이 어려움.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES
**structural_verdict**: FAIL

**routing_target**: forge readability-fix loop — A5 FAIL(structural_verdict FAIL)이 REQUEST_CHANGES를 유발하되, routing lane은 source-extraction이 아닌 readability-fix로 분화.

**Purpose**: A5 FAIL alone (A1-A4 모두 PASS, structural_verdict FAIL) 시나리오. structural_verdict == FAIL → final_verdict = REQUEST_CHANGES (readability-fix lane). consumer routing은 source-extraction 아닌 readability-fix로 분화됨을 검증.

---

### SCN-3: A1 + A2 + A3 co-failure — source extraction trigger

**Bullet**: "Worked on cache system performance improvements using various approaches including distributed caching, LRU policies, and memory management techniques to achieve better response times for our application ecosystem"

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "saas" }

**Expected verdicts**:
- A1: FAIL — Signal 1-5 모두 부재. "various approaches" + vague "distributed caching, LRU policies, memory management techniques" — Named systems 없음 ("Redis", "Memcached" 등 미명시), constraint 미정의, mechanism/trade-off/rationale 전무. 이름 나열 수준 → FAIL.
- A2: FAIL — Causal chain 없음. "used approaches → better response times" 간 논리 gap. 어떤 approach가 어떤 mechanism으로 응답 개선을 이끌었는지 불명확. Hidden variable 가득.
- A3: FAIL — "better response times" 만 있고 before/after, magnitude 없음. Vanity metric 수준에도 미달 (절대값 조차 없음). "so what?" 불가.
- A4: PASS — "Worked on"은 participated 수준. Mid-level이지만 contributed-equivalent 동사로 scope와 coherent.
- A5: FAIL — Key signal absent. "application ecosystem" 같은 filler. 6-30초 scan으로 problem, decision, result 중 어느 것도 포착 불가.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A1 + A2 + A3 FAIL)
**structural_verdict**: FAIL

**Purpose**: A1/A2/A3 co-failure 시나리오 (A5도 FAIL이나 structural_verdict로만 emit; final_verdict는 A1-A4 기준). resume-forge에서 source extraction routing이 필요한 패턴. "A5 FAIL alone"과 달리 단순 rewording으로 해결 불가.

---

### SCN-4: R-Phys triggered — physically impossible numeric claim

**Bullet**: "Improved API latency by 50000% through optimization"

**Candidate context**: { years: 5, position: "Backend", target_company: "tech" }

**Expected verdicts**:
- A1: FAIL — Signal 1-5 모두 부재. "optimization" 외 어떤 signal도 없음. Named system, constraint, mechanism, trade-off, rationale 전무 → FAIL.
- A2: FAIL — "50000% improvement" 수학적 불가. 50000% 개선 = 500배 감소를 의미하나, latency를 0ms 이하로 줄일 수 없음. 내부 arithmetic 자체가 physically incoherent. Arithmetic consistency 위반.
- A3: FAIL — before/after 없음. "improved latency" 수준이며 magnitude가 physically 불가능한 허위 값. Outcome 없음.
- A4: PASS — "Improved"는 participation-level. scope 부재하나 동사 자체는 overclaim 아님.
- A5: FAIL — 단 한 줄이지만 signal density 제로. 핵심 mechanism, context 없음.

**Expected critical rules**:
- r_phys.triggered: **true** — "50000%" improvement: latency는 0ms 미만 불가능. 50000%는 500배 감소 의미이므로 물리적 불가. 해당 수치와 이유 명시 필수.
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (r_phys invariant 적용 — A1-A4 결과 및 structural_verdict와 무관하게 강제)
**structural_verdict**: FAIL

**Purpose**: R-Phys critical rule 트리거 검증. invariant: `r_phys.triggered == true → final_verdict = REQUEST_CHANGES` 동작 확인. Examiner가 구체적 수치("50000%")와 물리적 불가 이유를 출력해야 함을 검증.

---

### SCN-5: A4 integrity_suspected + A4 FAIL — led inflation (junior)

**Bullet**: "Led 30-person cross-functional initiative to migrate legacy payment gateway from a monolithic Rails service to a microservices architecture; the constraint was that the monolith's synchronous payment flow blocked checkout at 4k concurrent users, requiring async event-driven decomposition. Chose strangler-fig pattern over big-bang cutover with Kafka as the event backbone (over RabbitMQ for replay capability and partition-based ordering per payment account). Strangler-fig works by routing new traffic to the new service while legacy handles in-flight transactions, gradually shifting 100% over 8 weeks. Accepted longer delivery timeline vs big-bang but eliminated rollback risk. Delivered across the entire organization."
<!-- 5-signal mapping
- Signal 1 (Constraint): "monolith's synchronous payment flow blocked checkout at 4k concurrent users, requiring async event-driven decomposition"
- Signal 2 (Technology): "strangler-fig pattern over big-bang cutover with Kafka as the event backbone (over RabbitMQ)"
- Signal 3 (Mechanism): "routing new traffic to the new service while legacy handles in-flight transactions, gradually shifting 100% over 8 weeks"
- Signal 4 (Trade-off): "Accepted longer delivery timeline vs big-bang but eliminated rollback risk"
- Signal 5 (Rationale): "replay capability and partition-based ordering per payment account" — Kafka selection rationale in payment context
-->

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): monolith synchronous payment flow blocked checkout at 4k concurrent users. Signal 2 (Technology): strangler-fig pattern + Kafka over RabbitMQ. Signal 3 (Mechanism): new traffic routed to new service while legacy handles in-flight, 8-week gradual shift. Signal 4 (Trade-off): longer delivery timeline vs big-bang but eliminated rollback risk. Signal 5 (Rationale): Kafka replay capability + partition-based ordering per payment account. 5 signals → PASS.
- A2: PASS — Migration cause → architecture 변경이라는 causal description. Arithmetic 없고 수치 모순도 없음. Chain이 단순하지만 contradiction은 없음.
- A3: FAIL — outcome 없음. "migrate to modern microservices" 자체는 activity. 결과 (latency, reliability, deployment frequency) 없음. "so what?" 불가.
- A4: FAIL — "Led" + 30-person + cross-functional + entire organization = Junior 2년차에 명백한 scope inflation. Decision authority, direct/matrix leadership 근거 없음. 실질적 overclaim. `integrity_suspected: true` (solo leadership verb + org-wide scope + Junior 2년 context + scope qualifier 없음 — 구조적 overclaim 에스컬레이션).
- A5: PASS — 한 문장에 verb / scope / target / mechanism outline 파악 가능. Signal density는 낮지만 key claim은 scan됨.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**A4 integrity_suspected**: true — "Led" (solo leadership verb) + 30-person + "entire organization" + 2년차 Junior. v4에서 verb-scope inflation은 A4 `integrity_suspected` sub-flag로 통합 처리됨. A4 FAIL이 독립적으로 REQUEST_CHANGES를 결정.

**Expected final_verdict**: REQUEST_CHANGES (A3 FAIL + A4 FAIL; A4 integrity_suspected: true는 보조 신호)
**structural_verdict**: PASS

**Purpose**: A4 integrity_suspected + A4 FAIL 조합 검증. verb-scope inflation이 A4 `integrity_suspected` sub-flag로 통합된 v4 동작을 검증. A4 FAIL이 독립적으로 REQUEST_CHANGES를 결정함을 검증. Junior + "Led 30-person" 패턴은 A4 integrity_suspected=true의 대표 케이스.

---

### SCN-6: Impact-first one-liner PASS — A5 structure-agnostic

**Bullet**: "Cut checkout abandonment 18% → 9% (8M monthly sessions) by replacing manual address entry with Google Places Autocomplete API; chose Places API over browser-native autofill because Places normalizes addresses server-side, eliminating form-validation failures that caused 40% of abandonment. Accepted per-session API cost (~$0.002) vs zero-cost native autofill, justified by abandonment revenue impact exceeding API cost by 200×."
<!-- 5-signal mapping
- Signal 1 (Constraint): "checkout abandonment 18%" — conversion loss from manual address entry friction
- Signal 2 (Technology): "Google Places Autocomplete API over browser-native autofill"
- Signal 3 (Mechanism): "Places normalizes addresses server-side, eliminating form-validation failures that caused 40% of abandonment"
- Signal 4 (Trade-off): "per-session API cost (~$0.002) vs zero-cost native autofill"
- Signal 5 (Rationale): "abandonment revenue impact exceeding API cost by 200×"
-->

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "ecommerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): checkout abandonment 18% from manual address entry friction. Signal 2 (Technology): Google Places Autocomplete API over browser-native autofill. Signal 3 (Mechanism): Places normalizes addresses server-side, eliminating form-validation failures that caused 40% of abandonment. Signal 4 (Trade-off): per-session API cost (~$0.002) vs zero-cost native autofill. Signal 5 (Rationale): abandonment revenue impact exceeding API cost by 200×. 5 signals → PASS.
- A2: PASS — Cause (Places API replacing manual entry + server-side normalization) → effect (abandonment 18%→9%) 직접 연결. Arithmetic: 18→9 = 50% reduction, internally consistent. Trade-off (API cost vs revenue) explicit accept.
- A3: PASS — Business outcome (checkout abandonment %) + scale context (8M monthly sessions). before/after 명확. "so what?" — 이탈율 50% 개선.
- A4: PASS — "Cut" (execution ownership) + mid-level + feature-level scope. Coherent.
- A5: PASS — Impact-first one-liner. 6초 내 outcome + mechanism + context 모두 포착. Signal density 극대. Structure-agnostic PASS의 대표.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**Purpose**: A5 structure-agnostic 검증 — v1에서 강제된 PSR 구조 없이도 impact-first one-liner가 A5 PASS 가능함을 확인. Frontend/product-engineering bullet이 backend bias 없이 5축 PASS 가능함도 검증.

---

### SCN-7: A3 vanity metric FAIL — no baseline

**Bullet**: "Optimized the payment processing service to achieve p99 200ms on API response times with 99.99% uptime across all production services; tuned JVM heap settings and connection pool sizing to meet SLA targets."
<!-- 5-signal mapping
- Signal 1 (Constraint): "SLA targets" — implicit latency/availability SLA for payment service
- Signal 2 (Technology): "JVM heap settings and connection pool sizing" named tuning levers
- Signal 3 (Mechanism): "tuned JVM heap settings and connection pool sizing" — mechanism stated at name level
- Signal 4 (Trade-off): (intentionally absent — preserves A1 FAIL isolation; no comparative decision stated)
- Signal 5 (Rationale): (intentionally absent — preserves A1 FAIL isolation; "SLA targets" is circular, not contextual rationale)
-->

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "tech" }

**Expected verdicts**:
- A1: FAIL — Signal 1 (Constraint): "SLA targets" is circular — no specific constraint value or failure mode named. Signal 2 (Technology): JVM heap / connection pool 이름 나열이나 selection rationale 없음 (GC algorithm, pool sizing formula, alternative tools 비교 없음). Signal 3 (Mechanism): "tuned" 수준 — 어떤 GC 전략을 택했는지, pool size를 어떻게 결정했는지 depth 없음. Signal 4 (Trade-off) 부재. Signal 5 (Rationale) 부재. 1~2 signal name-level → FAIL.
- A2: PASS — Arithmetic 없고 수치 모순도 없음. Causal chain 자체가 없어서 A2 위반은 없음 (A3 문제로 귀속).
- A3: FAIL — Vanity metric. "p99 200ms", "99.99% uptime" 모두 절대 숫자만. before/after 없음. baseline 없음. p99 200ms가 5000ms에서 개선된 것인지 원래 그랬는지 불명. "so what?" 불가.
- A4: FAIL — "Achieved ... across all production services" — 동사(achieved)는 낮으나 scope("all production services")가 Senior 6년차 개인 기여로 비현실적. 팀 기여, 본인 ownership 범위 없음.
- A5: P1 — 짧고 숫자는 있으나 context 없어 scan으로 의미 파악 어려움. Signal density 낮음. FAIL까지는 아님 (숫자 자체는 포착 가능).

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A1 + A3 + A4 FAIL)
**structural_verdict**: P1

**Purpose**: A3 vanity metric 감지 검증. 절대 숫자만 있고 before/after 없는 패턴이 A3 FAIL을 트리거함을 확인. mechanism 없는 성과 나열이 Signal depth 부족 → A1 FAIL임을 확인.

---

### SCN-8: Contributed + partial scope — Junior A4 PASS

**Bullet**: "Contributed N+1 query analysis to team's order-list performance effort (my part: query profiling + proposed batched JOIN pattern replacing ORM lazy-load, team implemented). Profiled with pg_stat_statements to identify the 3 highest-frequency N+1 hot paths; chose batched JOIN over sub-select because sub-select caused sequential scans on the orders table at our row count. Accepted JOIN complexity vs ORM simplicity, justified by p95 page-load SLA breach (>2s) that couldn't be resolved without reducing round-trips. Result: p95 page load 2.1s → 380ms."
<!-- 5-signal mapping
- Signal 1 (Constraint): "p95 page-load SLA breach (>2s)" + "3 highest-frequency N+1 hot paths"
- Signal 2 (Technology): "batched JOIN pattern replacing ORM lazy-load" over sub-select, identified via "pg_stat_statements"
- Signal 3 (Mechanism): "batched JOIN" reduces round-trips by fetching related rows in single query; "pg_stat_statements" identifies hot paths
- Signal 4 (Trade-off): "JOIN complexity vs ORM simplicity"
- Signal 5 (Rationale): "sub-select caused sequential scans on the orders table at our row count" — row-count-specific selection rationale
-->

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "commerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): p95 page-load SLA breach (>2s) + 3 highest-frequency N+1 hot paths identified via pg_stat_statements. Signal 2 (Technology): batched JOIN over sub-select, pg_stat_statements profiling tool. Signal 3 (Mechanism): batched JOIN reduces round-trips by fetching related rows in single query; pg_stat_statements identifies hot paths. Signal 4 (Trade-off): JOIN complexity vs ORM simplicity. Signal 5 (Rationale): sub-select caused sequential scans on orders table at current row count. 5 signals → PASS.
- A2: PASS — Cause (N+1 → batched JOIN으로 round-trip 감소) → effect (p95 2.1s→380ms). Causal chain 직접적. Arithmetic: 2100ms / 380ms ≈ 5.5x speedup, 명시 안 됐으나 수치 모순 없음.
- A3: PASS — Tech outcome (p95 page load). before/after 명확. 2.1s→380ms = 5x 이상 개선. "so what?" 명확.
- A4: PASS — "Contributed" + partial scope 명시 (my part: profiling + proposed pattern) + team context 명시 (team implemented). Clarity에 부합. Junior에서 "contributed + 자기 portion 명시"는 PASS 패턴.
- A5: PASS — 한 문장에 scope (my part), mechanism (N+1 → batched JOIN), result (p95 2.1s→380ms) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**Purpose**: "Contributed" verb + partial scope 명시가 Junior에서 A4 PASS임을 검증. SCN-5(led inflation)와 대비: "led 30-person" → A4 FAIL(integrity_suspected:true) vs "contributed + 자기 portion 명시" → A4 PASS. Junior candidate도 올바른 ownership verb + scope 명시로 APPROVE 가능함을 확인.

---

### SCN-9: R-Cross triggered — timeline contradiction with prior entry

**Bullet (current entry)**: "At Acme Corp 2021-01 → 2023-06 (2.5y) architected checkout split from monolithic order-service into 6 domain services (cart/pricing/inventory/payment/shipping/notify) with Saga pattern over Kafka event log — chose Saga over 2PC for fault tolerance at 15M daily orders scale. Delivered 3 production launches; checkout p99 1200ms → 280ms, distributed tx failure rate 2.1% → 0.08%."

**Cross-entry context**: "2022-08 → 2024-03 Senior Backend at Globex Co., led payment infrastructure migration"

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): monolith contention at 15M daily orders. Signal 2 (Technology): Kafka event log, Saga pattern, 6 domain services 명시. Signal 3 (Mechanism): 모놀리스 → 도메인 서비스 분리로 contention 제거. Signal 4 (Trade-off): Saga over 2PC (fault tolerance). Signal 5 (Rationale): architectural comparison 근거 명시. 5 signals → PASS.
- A2: PASS — Internal arithmetic coherent: 2.5y duration, p99 1200→280ms ≈ 77% reduction, tx failure 2.1→0.08% ≈ 26x improvement. Causal chain (monolith contention → service split + Saga → latency/reliability gain) explicit and self-consistent.
- A3: PASS — Tech outcomes 2개 (p99 latency, tx failure rate) + scale context (15M daily orders) + delivery count (3 launches). before/after 모두 명시.
- A4: PASS — "architected" + 2.5-year Senior scope + multi-service redesign 범위 coherent.
- A5: PASS — 한 문장에 problem (monolith split), decision (Saga over 2PC), result (p99 + tx failure) scan 가능. Signal density 높음.

**Expected critical rules**:
- r_phys.triggered: false (reasoning: "수치는 물리적으로 가능")
- r_cross.triggered: **true** (reasoning: "Acme Corp 2021-01→2023-06 기간과 Globex Co. 2022-08→2024-03 기간이 2022-08~2023-06 약 10개월 overlap. 동시에 두 회사에서 풀타임 owned 주장은 cross-entry 모순.")

**Expected final_verdict**: REQUEST_CHANGES (r_cross invariant → A1-A4 axis verdict 및 structural_verdict와 무관하게 강제)
**structural_verdict**: PASS

**Purpose**: R-Cross critical rule 트리거 검증. Invariant `r_cross.triggered == true → final_verdict = REQUEST_CHANGES` 동작 확인. 5축 모두 PASS여도 cross-entry 모순이 final_verdict를 REQUEST_CHANGES로 강제함을 검증. Examiner가 구체적 기간 overlap(시작/종료일)과 모순 이유를 reasoning에 명시해야 함.

---

### SCN-10: A1 P1 — Senior Kafka adoption with thin partitioning rationale

**Bullet**: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s); chose Kafka over RabbitMQ for throughput, accepting operational complexity."
<!-- 5-signal mapping
- Signal 1 (Constraint): "order pipeline load (4M daily events)" — scale-driven backlog constraint
- Signal 2 (Technology): "Kafka over RabbitMQ" — explicit selection with named alternative
- Signal 3 (Mechanism): "consumer-group partitioning" — mechanism stated at name level
- Signal 4 (Trade-off): "accepting operational complexity" — trade-off acknowledged
- Signal 5 (Rationale): (intentionally absent — preserves A1 P1 boundary isolation; "throughput" is generic, not context-specific rationale for why throughput is decisive here)
-->

**Candidate context**: { years: 7, position: "Senior Backend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: P1 — Signal 1 (Constraint): order pipeline load 4M daily events with backlog 문제. Signal 2 (Technology): Kafka over RabbitMQ 명시. Signal 3 (Mechanism): consumer-group partitioning — mechanism named but partition-key rationale depth 얕음. Signal 4 (Trade-off): "accepting operational complexity" — trade-off acknowledged. Signal 5 (Rationale) 부재: "throughput"은 generic keyword — 왜 이 4M daily event 맥락에서 throughput이 결정적인지 partition-key rationale, DLQ handling, at-least-once semantics 미언급. 4/5 signal — Signal 5 Rationale depth 부족 → P1.
- A2: PASS — Cause (Kafka adoption with consumer-group partitioning) → effect (backlog p95 8min→45s). Causal chain coherent. Arithmetic: 8min→45s ≈ 89% reduction, no contradiction.
- A3: PASS — Tech outcome (backlog p95 latency) + scale context (4M daily events). before/after 명확. "so what?" 명확.
- A4: PASS — "Adopted" + Senior 7yr + order pipeline scope. Coherent.
- A5: PASS — Mechanism (Kafka partitioning), scale (4M), result (p95 8min→45s) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (A1 P1 단독 — P1 cumulative count 1 < 3, non-blocking; interview_hints에 A1 depth 보강 suggestion 포함)
**structural_verdict**: PASS

**Purpose**: A1 P1 boundary 검증 — mechanism을 명시했으나 partition-key rationale, DLQ handling 등 Trade-off/Rationale signal depth가 부족한 패턴이 A1 P1을 트리거함을 확인. A1 rule: mechanism named but Rationale signal absent → P1. + final_verdict는 APPROVE 유지(P1 cumulative 1 < 3, non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-11: A2 P1 — LCP improvement with unaccounted concurrent changes

**Bullet**: "Switched product-listing thumbnails from JPEG to WebP with srcset responsive loading to address LCP regression above 2s on mobile; chose WebP over AVIF because our CDN's WebP transcoding pipeline was already in production, avoiding new transcoding infrastructure. Accepted slightly larger file size vs AVIF (5–8% larger at equivalent quality) in exchange for zero infrastructure change. LCP p75 improved from 2.4s to 1.1s, measured in RUM over the 2-week rollout window."
<!-- 5-signal mapping
- Signal 1 (Constraint): "LCP regression above 2s on mobile" — specific perf constraint with threshold
- Signal 2 (Technology): "WebP over AVIF" — explicit selection with named alternative
- Signal 3 (Mechanism): "srcset responsive loading" delivers appropriately-sized images per viewport; WebP reduces payload vs JPEG
- Signal 4 (Trade-off): "slightly larger file size vs AVIF (5–8% larger at equivalent quality) in exchange for zero infrastructure change"
- Signal 5 (Rationale): "CDN's WebP transcoding pipeline was already in production, avoiding new transcoding infrastructure"
-->

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): LCP regression above 2s on mobile. Signal 2 (Technology): WebP over AVIF — explicit selection with named alternative. Signal 3 (Mechanism): srcset responsive loading delivers appropriately-sized images per viewport; WebP reduces JPEG payload. Signal 4 (Trade-off): 5–8% larger vs AVIF in exchange for zero infrastructure change. Signal 5 (Rationale): CDN's WebP transcoding pipeline already in production, avoiding new infra. 5 signals → PASS.
- A2: P1 — Full chain present (format change + delivery mechanism → reduced image weight → LCP improvement) with baseline, delta, and stated measurement window (2-week RUM). One link remains unverified: whether concurrent CDN/config changes during that window contributed. One confounder dimension open while other core links are closed — A2 rule "cause→effect stated but one link unverified" triggered.
- A3: PASS — Tech outcome (LCP p75) + before/after (2.4s→1.1s). "so what?" — 54% LCP 개선.
- A4: PASS — "Switched" + mid-level + frontend feature scope. Coherent.
- A5: PASS — mechanism (WebP/srcset), result (LCP 2.4s→1.1s), measurement context (2-week RUM) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (A2 P1 단독 — P1 cumulative count 1 < 3, non-blocking; interview_hints에 A2 unverified link clarification suggestion 포함)
**structural_verdict**: PASS

**Purpose**: A2 P1 boundary 검증 — cause→effect chain이 명시됐으나 측정 window 중 concurrent 변경 가능성이 unverified link로 남는 패턴이 A2 P1을 트리거함을 확인. A2 rule: "cause→effect stated but one link unverified." + final_verdict는 APPROVE 유지(P1 cumulative 1 < 3, non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-12: A3 P1 — Checkout retry completion rate with outcome type ambiguity

**Bullet**: "Hardened error recovery on the checkout retry path by adding idempotency keys to the payment-service API calls and exponential backoff with jitter (base 200ms, cap 5s, factor 2×); chose idempotency + backoff over circuit-breaker-only because circuit breaker would suppress retries entirely during transient spikes, losing recoverable transactions. Accepted increased retry latency tail (p99 up ~400ms) in exchange for higher completion rate. Successful completion rate improved from 91% to 97%."
<!-- 5-signal mapping
- Signal 1 (Constraint): "checkout retry path" error recovery — transient spikes causing lost recoverable transactions
- Signal 2 (Technology): "idempotency keys + exponential backoff with jitter" over "circuit-breaker-only"
- Signal 3 (Mechanism): "exponential backoff with jitter (base 200ms, cap 5s, factor 2×)" — retry schedule mechanism; idempotency prevents duplicate charges on retry
- Signal 4 (Trade-off): "increased retry latency tail (p99 up ~400ms) in exchange for higher completion rate"
- Signal 5 (Rationale): "circuit breaker would suppress retries entirely during transient spikes, losing recoverable transactions" — why idempotency+backoff over circuit-breaker
-->

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): checkout retry path transient spikes causing lost recoverable transactions. Signal 2 (Technology): idempotency keys + exponential backoff with jitter over circuit-breaker-only. Signal 3 (Mechanism): exponential backoff (base 200ms, cap 5s, factor 2×) + idempotency prevents duplicate charges. Signal 4 (Trade-off): p99 retry latency up ~400ms in exchange for higher completion rate. Signal 5 (Rationale): circuit breaker would suppress retries during transient spikes, losing recoverable transactions. 5 signals → PASS.
- A2: PASS — Cause (idempotency + backoff hardening) → effect (completion rate 91%→97%). Causal chain coherent. Arithmetic: 6pp improvement on retry path, no contradiction.
- A3: P1 — Magnitude present (91%→97%), so magnitude-absence guardrail not the issue. "Successful completion rate" is dual-coded: HTTP/API success on retry (tech) versus business checkout conversion (business). "retry path" lexical context nudges toward tech success-rate reading — type resolvable within one interpretive step, but remains ambiguous. A3 rule "outcome type boundary unclear" triggered.
- A4: PASS — "Hardened" + mid-level + checkout retry path scope. Coherent.
- A5: PASS — problem (retry path error recovery), result (91%→97%) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (A3 P1 단독 — P1 cumulative count 1 < 3, non-blocking; interview_hints에 A3 outcome type disambiguation suggestion 포함)
**structural_verdict**: PASS

**Purpose**: A3 P1 boundary 검증 — outcome magnitude가 있어도 outcome type(tech vs business)이 dual-coded로 해석되는 패턴이 A3 P1을 트리거함을 확인. A3 rule: "outcome type boundary unclear." + final_verdict는 APPROVE 유지(P1 cumulative 1 < 3, non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-13: A2 FAIL — Q4 전환율 seasonality confound

**Bullet**: "이탈률 데이터 분석으로 모바일 결제 페이지의 CTA 버튼 위치 및 크기 문제를 식별하고, React Native 터치 이벤트 핸들러를 재설계하여 탭 인식 영역을 44×44pt(Apple HIG 최소 기준)로 통일했다. Android와 iOS 간 터치 응답 편차(iOS 42pt, Android 38pt)를 해소하기 위해 플랫폼별 조건 분기 대신 공통 컴포넌트 추상화를 선택했으며, 이는 향후 디바이스 파편화 대응 비용을 줄이기 위한 결정이었다. Q4 구매 전환율 8.4% 달성, 직전 대비 2.1%p 개선."
<!-- 5-signal mapping
- Signal 1 (Constraint): "모바일 결제 페이지의 CTA 버튼 위치 및 크기 문제" — touch target UX constraint on payment CTA; iOS 42pt / Android 38pt 편차 수치 명시
- Signal 2 (Technology): "React Native 터치 이벤트 핸들러 재설계" + "공통 컴포넌트 추상화 vs 플랫폼별 조건 분기"
- Signal 3 (Mechanism): "탭 인식 영역을 44×44pt(Apple HIG 최소 기준)로 통일" — mechanism for touch target standardization across platforms
- Signal 4 (Trade-off): "플랫폼별 조건 분기 대신 공통 컴포넌트 추상화를 선택" — chose abstraction over per-platform branching; initial implementation complexity accepted
- Signal 5 (Rationale): "향후 디바이스 파편화 대응 비용을 줄이기 위한 결정" — abstraction rationale for long-term maintainability
-->

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "analytics-saas" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 모바일 결제 페이지 CTA 버튼 터치 영역 미달(iOS 42pt, Android 38pt). Signal 2 (Technology): React Native 터치 이벤트 핸들러 재설계 + 공통 컴포넌트 추상화 vs 플랫폼별 조건 분기. Signal 3 (Mechanism): 탭 인식 영역 44×44pt 통일 (Apple HIG 기준). Signal 4 (Trade-off): 플랫폼별 조건 분기 대신 공통 추상화 선택 — 초기 구현 복잡도 수용. Signal 5 (Rationale): 향후 디바이스 파편화 대응 비용 절감. 5 signals → PASS.
- A2: FAIL — Rule 1 (Missing comparable baseline): "직전"이 Q3인지 작년 Q4인지 불분명하며 동일 cohort·동일 시즌 baseline 없어 개선이 작업 결과인지 계절 효과인지 분리 불가. Rule 2 (Missing time window / operating conditions): Q4 내 어느 기간·어떤 트래픽 프로파일에서 8.4% 전환율이 측정됐는지 measurement window 미명시로 수치의 재현 가능성 검증 불가. Severity Tier: Rule 1 + Rule 2 동시 위반 = 2+ concurrent rule violations → Hard FAIL (Soft P1 standalone 각각이지만 compound 시 Hard FAIL로 격상).
- A3: PASS — 전환율 수치(8.4%) + before/after(+2.1%p). magnitude 존재.
- A4: PASS — scope 및 동사 수준 특정 불가하나 overclaim 없음.
- A5: P1 — 짧고 수치는 있으나 mechanism context 없어 6초 scan으로 "무엇을 해서 개선됐는지" 불명. FAIL까지는 아님.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)
**structural_verdict**: P1

**Purpose**: A2 FAIL — Rule 1 (Missing comparable baseline) + Rule 2 (Missing time window) compound violation → Hard FAIL. Q3 vs Q4 seasonality 미통제로 비교 기준이 동일 cohort가 아닌 패턴, 동시에 측정 window 미명시 — 두 evidence hygiene rule 동시 위반이 compound Hard FAIL을 유발함을 검증.

---

### SCN-14: A2 FAIL — Redis 캐시 응답 시간 측정 기간 + baseline 누락

**Bullet**: "주요 API 응답 시간 320ms 초과라는 DB 조회 병목을 해소하기 위해 Redis·Memcached·Hazelcast를 비교한 뒤 Redis를 선택했다. Redis의 TTL 기반 캐싱은 메모리 내 해시 테이블에 직접 응답값을 저장하고 만료 시 DB로 fallback하는 방식으로, Memcached 대비 복제·영속성 옵션을 추가 인프라 없이 확보할 수 있었다. 클러스터 운영 복잡도보다 단일 인스턴스의 운영 단순성을 수용하는 대신 horizontal scale-out 유연성을 포기했으며, 이는 현재 트래픽 규모(일 50만 요청)에서 단일 인스턴스 용량이 충분하다는 판단에 근거했다. Redis 캐시 레이어 도입으로 주요 API 응답 시간을 320ms에서 85ms로 단축."
<!-- 5-signal mapping
- Signal 1 (Constraint): "주요 API 응답 시간 320ms 초과" — DB 조회 병목 제약
- Signal 2 (Technology): "Redis·Memcached·Hazelcast 비교 후 Redis 선택" — explicit named alternatives
- Signal 3 (Mechanism): "TTL 기반 캐싱으로 메모리 내 해시 테이블에 직접 응답값 저장, 만료 시 DB fallback"
- Signal 4 (Trade-off): "클러스터 운영 복잡도보다 단일 인스턴스 운영 단순성 수용, horizontal scale-out 유연성 포기"
- Signal 5 (Rationale): "현재 트래픽 규모(일 50만 요청)에서 단일 인스턴스 용량이 충분하다는 판단"
-->

**Candidate context**: { years: 3, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 주요 API 응답 시간 320ms 초과 DB 조회 병목. Signal 2 (Technology): Redis·Memcached·Hazelcast 비교 후 Redis 선택. Signal 3 (Mechanism): TTL 기반 캐싱으로 메모리 내 해시 테이블 저장, 만료 시 DB fallback. Signal 4 (Trade-off): 클러스터 복잡도 vs 단일 인스턴스 운영 단순성 + horizontal scale-out 포기. Signal 5 (Rationale): 일 50만 요청 규모에서 단일 인스턴스 용량 충분 판단. 5 signals → PASS.
- A2: FAIL — "320ms→85ms"라는 수치가 언제·어떤 트래픽 조건에서 측정됐는지 없음. cache hit→응답 단축 인과 자체는 타당하나, baseline이 캐시 warm 상태인지 cold 상태인지, 같은 쿼리 분포였는지 확인 불가 → 인과 검증이 아닌 숫자 대조. A2 violated rule: "Missing time window / operating conditions" (+ Missing comparable baseline).
- A3: PASS — Tech outcome (API 응답 시간) + before/after (320ms→85ms). magnitude 명확.
- A4: PASS — "도입" + mid-level + API layer scope. Coherent.
- A5: PASS — mechanism (Redis 캐시), result (320ms→85ms) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)
**structural_verdict**: PASS

**Purpose**: A2 FAIL — violated rule: "Missing time window / operating conditions." 측정 기간 및 트래픽 조건 누락으로 수치의 재현 가능성이 검증 불가한 패턴. window 없이는 snapshot인지 평균인지도 알 수 없음을 검증.

---

### SCN-15: A2 FAIL — Offline F1 score → production chargeback savings

**Bullet**: "Trained a gradient boosting model (XGBoost over LightGBM — XGBoost's monotone constraints allowed us to enforce domain rules on transaction amount features without post-processing) to replace the rule-based fraud detection system, which had a fixed 15% false-positive rate causing excessive card declines. Used stratified k-fold cross-validation on 18 months of transaction data (class imbalance 1:200, SMOTE oversampling for minority class). Accepted higher training latency vs LightGBM in exchange for constraint enforcement. F1 score improved from 0.82 to 0.89, saving $100k in chargebacks."
<!-- 5-signal mapping
- Signal 1 (Constraint): "rule-based fraud detection system with fixed 15% false-positive rate causing excessive card declines"
- Signal 2 (Technology): "XGBoost over LightGBM" — explicit named alternative with selection criteria
- Signal 3 (Mechanism): "monotone constraints enforce domain rules on transaction amount features without post-processing"; "stratified k-fold cross-validation with SMOTE oversampling"
- Signal 4 (Trade-off): "higher training latency vs LightGBM in exchange for constraint enforcement"
- Signal 5 (Rationale): "monotone constraints allowed enforcing domain rules" — constraint enforcement not available in LightGBM without post-processing
-->

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): rule-based system with 15% false-positive rate causing card declines. Signal 2 (Technology): XGBoost over LightGBM — monotone constraints. Signal 3 (Mechanism): monotone constraints enforce domain rules on transaction amount features; stratified k-fold with SMOTE for class imbalance. Signal 4 (Trade-off): higher training latency vs LightGBM for constraint enforcement. Signal 5 (Rationale): LightGBM lacks native monotone constraints, requiring post-processing workaround in fraud domain. 5 signals → PASS.
- A2: FAIL — F1 score improvement (0.82→0.89)은 offline/backtest metric이나 production financial impact ("saving $100k in chargebacks")로 seamless하게 연결. Production deployment 증명 없음. Offline accuracy → production chargeback reduction 고리에서 data drift, latency constraints, integration bugs 가능성 미통제. A2 violated rule: "Offline metric presented as production impact."
- A3: PASS — F1 0.82→0.89 + $100k chargeback savings. outcome magnitude 존재. (A2 FAIL이 검증 문제를 지적)
- A4: PASS — "Trained" + mid-level + fraud detection model scope. Coherent.
- A5: PASS — mechanism (XGBoost + monotone constraints), result (F1 + $100k) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)
**structural_verdict**: PASS

**Purpose**: A2 FAIL — violated rule: "Offline metric presented as production impact." holdout F1 개선을 실제 chargeback 절감으로 제시하는 offline→production attribution 오류 패턴 검증.

---

### SCN-16: A2 FAIL — 트래픽 5배 스케일 클레임에서 분포 누락

**Bullet**: "일 평균 트래픽 5배 급증(이벤트 기간 100만 rps → 500만 rps)이라는 확장성 제약에서 Nginx upstream load balancing을 수직 스케일링 대신 수평 스케일링 + 동적 upstream 추가 방식으로 전환했다. Nginx의 least_conn 알고리즘은 활성 연결 수가 가장 적은 upstream에 요청을 라우팅하여 핫스팟을 분산하며, round-robin 대비 불균형 연결 시간을 줄이는 방식이다. 수직 스케일링(인스턴스 업그레이드) 대신 수평 확장을 선택하여 단일 장애점 제거 비용으로 배포 복잡도를 수용했으며, 이 판단의 근거는 단일 인스턴스 수직 한계가 이벤트 피크의 70%에 불과하다는 용량 계획 데이터였다. 평균 latency 250ms 유지로 안정적 확장성 증명."
<!-- 5-signal mapping
- Signal 1 (Constraint): "일 평균 트래픽 5배 급증(100만 rps → 500만 rps)" — 구체적 scale 수치 제약
- Signal 2 (Technology): "Nginx upstream load balancing least_conn 알고리즘 vs round-robin / 수직 vs 수평 스케일링"
- Signal 3 (Mechanism): "least_conn 알고리즘은 활성 연결 수가 가장 적은 upstream에 라우팅하여 핫스팟 분산"
- Signal 4 (Trade-off): "수직 스케일링 대신 수평 확장으로 배포 복잡도 수용"
- Signal 5 (Rationale): "단일 인스턴스 수직 한계가 이벤트 피크의 70%에 불과하다는 용량 계획 데이터"
-->

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "video-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 트래픽 5배 급증 (100만→500만 rps). Signal 2 (Technology): Nginx least_conn 알고리즘 vs round-robin, 수평 vs 수직 스케일링 비교. Signal 3 (Mechanism): least_conn이 활성 연결 수 기준으로 upstream 라우팅하여 핫스팟 분산. Signal 4 (Trade-off): 수직 스케일링 대신 수평 확장으로 배포 복잡도 수용. Signal 5 (Rationale): 단일 인스턴스 수직 한계가 이벤트 피크의 70%에 불과하다는 용량 계획 데이터. 5 signals → PASS.
- A2: FAIL — scale claim(5배 증가)에서 평균 latency 유지는 p95/p99이 폭증해도 성립 가능. 평균은 throughput 증가 시 tail에 의해 잘 움직이지 않음 → "확장성 증명"은 tail latency 안정성으로만 검증됨에도 평균만 제시 (Rule 4: Missing distribution for scale claims). 또한 "이벤트 기간" 중 정확히 언제·어떤 부하 조건에서 250ms가 측정됐는지 measurement window 및 트래픽 프로파일이 없어 수치 재현 불가 (Rule 2: Missing time window / operating conditions). Rule 4 + Rule 2 compound violation → Hard FAIL.
- A3: PASS — 스케일 context(5배) + latency 수치(250ms) 존재. outcome 기술됨.
- A4: PASS — Senior level + "증명" 표현이지만 scope 부재하나 overclaim은 아님.
- A5: PASS — mechanism (scale 5배 + least_conn), result (250ms 유지) 6초 내 scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)
**structural_verdict**: PASS

**Purpose**: A2 FAIL — Rule 4 (Missing distribution for scale claims) + Rule 2 (Missing time window / operating conditions) compound violation → Hard FAIL. scale 주장에서 평균만 제시하고 tail latency(p95/p99)를 생략(Rule 4)하는 동시에, 이벤트 기간 중 측정 window와 트래픽 프로파일도 없어(Rule 2) 두 evidence hygiene rule 동시 위반이 compound Hard FAIL을 유발함을 검증.

---

### SCN-17: A2 FAIL — 운영 장애 0건 절대 주장 (scope + period 누락)

**Bullet**: "결제 서비스 배포 파이프라인의 핫픽스 롤백 실패라는 제약 조건에서 Spinnaker·ArgoCD·FluxCD를 비교한 뒤 ArgoCD를 선택했다. ArgoCD의 GitOps 동작 원리는 Git 저장소를 단일 소스로 삼아 선언적 상태를 클러스터에 지속 동기화하며, 롤백 시 이전 커밋 revert만으로 이전 상태로 복원하는 메커니즘이다. Spinnaker 대비 운영 복잡도 감소를 선택했으며, FluxCD 대비 UI 기반 상태 가시성을 확보하는 대신 ArgoCD의 더 큰 메모리 풋프린트를 수용했다. 이 판단의 근거는 직전 분기 포스트모템에서 롤백 지연의 80%가 파이프라인 상태 불투명성에서 비롯된다는 교훈이었다. 안정화 작업을 통해 운영 서비스 장애 0건 달성."
<!-- 5-signal mapping
- Signal 1 (Constraint): "결제 서비스 배포 파이프라인의 핫픽스 롤백 실패" — 구체적 장애 패턴
- Signal 2 (Technology): "Spinnaker·ArgoCD·FluxCD 비교 후 ArgoCD 선택"
- Signal 3 (Mechanism): "GitOps — Git 저장소 단일 소스, 선언적 상태 지속 동기화, 롤백 시 이전 커밋 revert"
- Signal 4 (Trade-off): "FluxCD 대비 ArgoCD 메모리 풋프린트 수용 vs UI 기반 상태 가시성 확보"
- Signal 5 (Rationale): "직전 분기 포스트모템에서 롤백 지연 80%가 파이프라인 상태 불투명성에서 비롯"
-->

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "recruitment-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 결제 서비스 배포 파이프라인 핫픽스 롤백 실패. Signal 2 (Technology): Spinnaker·ArgoCD·FluxCD 비교 후 ArgoCD 선택. Signal 3 (Mechanism): GitOps — Git 단일 소스 + 선언적 상태 지속 동기화 + 커밋 revert로 롤백. Signal 4 (Trade-off): FluxCD 대비 ArgoCD 메모리 풋프린트 수용 vs UI 가시성 확보. Signal 5 (Rationale): 포스트모템에서 롤백 지연 80%가 파이프라인 상태 불투명성에서 비롯된다는 교훈. 5 signals → PASS.
- A2: FAIL — 어느 서비스인지(scope) 없음 — 전체 서비스 vs 담당 서비스 vs 특정 컴포넌트 구분 불가. 어느 기간인지(period) 없음 — 1주? 분기? 연간? 절대 주장(0건)은 scope·period 없이는 반증 불가능 → 인과 검증이 아니라 수사. A2 violated rule: "Absolute claim without scope and period."
- A3: PASS — "장애 0건"이라는 outcome 존재. 절대값 주장이나 A3 magnitude 기준은 충족.
- A4: PASS — "달성" + mid-level. Coherent.
- A5: P1 — 짧고 결과는 있으나 context(어느 서비스, 언제) 없어 scan으로 의미 파악이 불완전. FAIL까지는 아님.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)
**structural_verdict**: P1

**Purpose**: A2 FAIL — violated rule: "Absolute claim without scope and period." "장애 0건" 같은 절대 주장이 scope(서비스)와 period(기간) 없이 제시돼 반증 불가능한 수사가 되는 패턴 검증.

---

### SCN-18: A2 Chained pattern — 다중 제약 순차 해결

**Bullet**: "주문 이벤트 파이프라인에서 p99 800ms 지연을 분석 → DB write contention이 주요 원인으로 식별되어 user_id 기반 파티셔닝 도입 → 파티셔닝 이후 드러난 hot key rebalance 문제를 consistent hashing 키 재설계로 해결; consistent hashing을 선택한 이유는 modulo-based 방식 대비 노드 추가·제거 시 재분배 키 수를 O(K/N)으로 최소화할 수 있기 때문이다. 파티셔닝 운영 복잡도와 hashing 재설계 비용을 수용했으며, 이는 p99 800ms 지연이 SLA 위반(목표 200ms)이라는 비즈니스 제약에서 비롯됐다. 최종 p99 800ms→120ms, hot key imbalance <5%."
<!-- 5-signal mapping
- Signal 1 (Constraint): "p99 800ms 지연 + SLA 목표 200ms 위반" — specific threshold constraint
- Signal 2 (Technology): "user_id 기반 파티셔닝 + consistent hashing 키 재설계 vs modulo-based"
- Signal 3 (Mechanism): "파티셔닝으로 contention 분산; consistent hashing으로 노드 추가·제거 시 재분배 키 수 O(K/N) 최소화"
- Signal 4 (Trade-off): "파티셔닝 운영 복잡도와 hashing 재설계 비용 수용"
- Signal 5 (Rationale): "p99 800ms가 SLA 위반(목표 200ms)이라는 비즈니스 제약"
-->

**Candidate context**: { years: 5, position: "Backend Engineer", target_company: "커머스 플랫폼" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): p99 800ms 지연 + SLA 목표 200ms 위반. Signal 2 (Technology): user_id 파티셔닝 + consistent hashing vs modulo-based. Signal 3 (Mechanism): 파티셔닝으로 contention 분산; consistent hashing으로 노드 재분배 키 O(K/N) 최소화. Signal 4 (Trade-off): 파티셔닝 운영 복잡도 + hashing 재설계 비용 수용. Signal 5 (Rationale): p99 800ms SLA 위반(목표 200ms) 비즈니스 제약. 5 signals → PASS.
- A2: PASS (Chained pattern — 선행 해결이 후행 문제 드러냄, trigger-conditioned sub-check 4 강한 긍정 신호)
- A3: PASS (quantified outcomes: p99 800ms→120ms, hot key imbalance <5%)
- A4: PASS (scope clear)
- A5: PASS

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**Purpose**: A2 sub-check 4번(Chained vs Isolated)의 Chained 신호 검증 — 2+ 제약이 순차적으로 해결되는 bullet이 trigger-conditioned sub-check에서 Chained로 분류되어 A2 PASS 강한 긍정 신호로 인정받는지.

---

### SCN-A1-5strict-PASS: A1 5/5 strict bar — all signals in one bullet

**Bullet**: "Migrated order-service DB writes from single-node PostgreSQL to CockroachDB multi-region (us-east/eu-west/ap-southeast) after hitting 4.2k TPS primary-key contention ceiling on order_events. Chose CockroachDB over Aurora Global for its serializable isolation without application-level conflict resolution. Range-based geo-partitioning eliminated cross-region write amplification; 30-day rollout with shadow write validation. p99 write latency 640ms → 58ms, cross-region write amplification incidents per week 17 → 0 (15M daily events)."

**Candidate context**: { years: 8, position: "Senior Backend", target_company: "global-commerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 4.2k TPS primary-key contention ceiling on order_events. Signal 2 (Technology): CockroachDB multi-region / range-based geo-partitioning 명시. Signal 3 (Mechanism): geo-partitioning으로 cross-region write amplification 제거. Signal 4 (Trade-off): CockroachDB vs Aurora Global (serializable isolation without app-level conflict resolution). Signal 5 (Rationale): architectural comparison 근거 + scale qualifier (15M daily events) 명시. 5 signals JOINTLY present in single bullet → PASS (strict bar satisfied: Constraint + Selection + Mechanism + Trade-off + Rationale + numeric outcome + scope qualifier).
- A2: PASS — Cause (single-node → multi-region + geo-partitioning) → mechanism (write amplification 제거) → effect (p99 640ms→58ms, incidents 17→0). 30-day rollout + shadow write validation으로 measurement control 명시. 수치 모순 없음.
- A3: PASS — Tech outcomes 2개 (p99 write latency, write amplification incidents) + scale context (15M daily events). before/after 모두 명시. "so what?" 명확.
- A4: PASS — "Migrated" (high ownership) + Senior 8yr + cross-region infrastructure scope. Coherent.
- A5: PASS — 한 단락에 problem (contention ceiling) / decision (CockroachDB, geo-partitioning) / result (latency + incidents) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**routing_target**: standard APPROVE path — no readability fix routing triggered (A5 PASS, structural_verdict PASS)

**Purpose**: A1 5/5 strict bar PASS의 reference case. 단일 bullet에 Constraint + Selection + Mechanism + Trade-off + Rationale 5 signals이 jointly 존재하고 numeric outcome + scope qualifier를 갖춘 패턴이 A1 strict PASS를 트리거함을 검증. resume-forge에서 source extraction 없이 standard APPROVE path로 라우팅됨을 확인.

---

### SCN-A5-demote-routing: A5 P1 structural demotion — APPROVE 유지, readability-fix 루프 비트리거 (hint surfacing only)

**Bullet**: "Rewrote the authentication token refresh pipeline using a sliding-window expiry model backed by Redis Sorted Sets (ZRANGEBYSCORE sweep for expired tokens, ZADD with score=expiry_epoch), replacing the previous polling-based expiry check that held a DB advisory lock per session. Chose Redis Sorted Set over TTL-key approach for O(log N) range-delete semantics and atomic sweep without hotspot contention. Added circuit breaker (Resilience4j, 50% error threshold, 10s open window) for Redis unavailability fallback to DB. Instrumented with Micrometer (redis_sweep_duration_ms p99, circuit_breaker_state transitions). Result: token refresh latency p99 420ms → 34ms, DB lock contention events per hour 310 → 0, auth service CPU p99 utilization 73% → 28% (peak 50k concurrent sessions)."

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "identity-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): polling-based expiry check + DB advisory lock per session. Signal 2 (Technology): Redis Sorted Sets / ZRANGEBYSCORE / Resilience4j circuit breaker 명시. Signal 3 (Mechanism): sliding-window + atomic range-delete로 lock contention 제거. Signal 4 (Trade-off): Sorted Set vs TTL-key (O(log N) semantics + atomic sweep). Signal 5 (Rationale): architectural comparison 근거 명시. 5 signals → PASS.
- A2: PASS — Cause (polling+lock → sliding-window ZRANGEBYSCORE sweep) → mechanism (lock contention 제거) → effect (p99 420ms→34ms, lock events 310→0, CPU 73→28%). Instrumentation (Micrometer) 명시. 수치 모순 없음.
- A3: PASS — Tech outcomes 3개 (p99 token refresh latency, DB lock events/hr, CPU p99) + scale context (50k concurrent sessions). before/after 모두 명시.
- A4: PASS — "Rewrote" + Senior 6yr + auth pipeline scope. Coherent.
- A5: P1 — Implementation detail spill: `ZRANGEBYSCORE sweep for expired tokens, ZADD with score=expiry_epoch`, `Micrometer redis_sweep_duration_ms p99, circuit_breaker_state transitions`, `Resilience4j, 50% error threshold, 10s open window` 등 config/instrumentation details가 rationale 없이 나열되어 핵심 결과(latency, lock events, CPU)를 6-30초 scan에서 방해. Key signal 포착은 가능하나 density 최적화 미흡 → P1.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: P1

**routing_target**: forge Loop 2 gate APPROVE lane — A1-A4 모두 PASS/P1 AND count(P1 across A1-A4) < 3 AND structural_verdict ∈ {PASS, P1} → APPROVE. structural_verdict P1은 readability-fix를 강제하지 않는다 (readability-fix는 structural_verdict == FAIL 조건). A5 P1은 non-blocking; interview_hints에 improvement suggestion으로만 surfaced.

**Purpose**: A5 demote 검증 — A5 P1(structural_verdict P1)이 있어도 A1-A4 모두 PASS이면 final_verdict는 APPROVE임을 확인. A5 alone은 REQUEST_CHANGES를 트리거하지 않는다는 invariant 검증. structural_verdict P1은 readability-fix 루프를 트리거하지 않으며 interview_hints에 hint만 surfaced됨을 확인 (SCN-2의 A5 FAIL → REQUEST_CHANGES 패턴과 대비: P1은 non-blocking).

---

### SCN-A1-cumP1-3: 누적 P1 3개 → REQUEST_CHANGES 발동 검증

**Bullet**: "결제 이벤트 처리를 위해 Kafka·RabbitMQ를 비교한 뒤 Kafka를 선택했다. Kafka의 파티션 키 기반 메시지 분산으로 consumer-group이 각 파티션을 독립적으로 구독하여 처리량을 확보했다. RabbitMQ 대비 운영 복잡도를 수용했으며, 이 판단의 근거는 결제 이벤트의 멱등성 처리 가능 여부였다. 팀 내 이벤트 파이프라인 모듈 일부를 기여하여 결제 이벤트 파이프라인의 운영 효율과 처리 안정성을 향상시켰다."
<!-- 5-signal mapping
- Signal 1 (Constraint): (intentionally absent — preserves A1 P1 isolation; "결제 이벤트 처리"는 구체적 제약 조건 미명시)
- Signal 2 (Technology): "Kafka·RabbitMQ 비교 후 Kafka 선택"
- Signal 3 (Mechanism): "파티션 키 기반 메시지 분산으로 consumer-group이 각 파티션 독립 구독"
- Signal 4 (Trade-off): "RabbitMQ 대비 운영 복잡도 수용"
- Signal 5 (Rationale): "결제 이벤트의 멱등성 처리 가능 여부" — P1 boundary: rationale가 결정 근거로는 얕음 (왜 멱등성이 이 scale에서 결정적인지 depth 없음)
- A3 signal: "운영 효율과 처리 안정성을 향상시켰다" — outcome을 시사하나 운영 효율(ops/business metric?)인지 처리 안정성(tech reliability metric?)인지 type 분류 불가. numeric 수치 없는 fuzzy outcome 표현 → A3 P1 boundary
-->

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: P1 — Signal 1 (Constraint) 부재: "결제 이벤트 처리"는 추상적으로 구체적 제약 조건(처리량 한계, 유실률 임계치, backlog 문제 등) 없음. Signal 2 (Technology): Kafka·RabbitMQ 비교 후 Kafka 선택. Signal 3 (Mechanism): 파티션 키 기반 분산 + consumer-group 독립 구독. Signal 4 (Trade-off): 운영 복잡도 수용. Signal 5 (Rationale): 멱등성 처리 가능 여부 — rationale는 있으나 왜 이 맥락에서 결정적인지 depth 얕음. 4/5 signal (Signal 1 부재) → P1.
- A2: P1 — Cause (Kafka 파티션 기반 분산) → effect ("운영 효율과 처리 안정성 향상"). Causal chain은 있으나 effect 자체가 fuzzy하여 인과 연결의 검증이 불가능하며, 병행 변경(인프라 증설, 코드 최적화 등) 가능성 unverified. A2 rule "cause→effect stated but one link unverified" → P1.
- A3: P1 — "운영 효율과 처리 안정성을 향상시켰다"는 outcome을 시사하나 outcome type boundary unclear: 운영 효율은 ops/business metric(운영 비용, SLA 준수율 등)으로도, tech metric(throughput, error rate 등)으로도 해석 가능하며, 처리 안정성 역시 tech reliability(유실률, 가용성)인지 business continuity metric인지 분류 불가. numeric outcome 부재로 magnitude도 불명. A3 P1 rule "outcome type boundary unclear" 직접 해당.
- A4: PASS — "팀 내 이벤트 파이프라인 모듈 일부를 기여" — partial ownership verb + scope 명시. Mid-level + 기여 범위 coherent.
- A5: PASS — tech decision (Kafka 선택, 파티션 기반 분산 mechanism) 6초 내 scan 가능. outcome이 fuzzy하나 핵심 tech claim 파악에는 지장 없음.

**P1 count across A1-A4**: A1=P1, A2=P1, A3=P1, A4=PASS → count(P1) = 3 ≥ 3 → cumulative P1 invariant 발동.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (cumulative P1 invariant: count(P1 across A1-A4) = 3 ≥ 3 → REQUEST_CHANGES, A1-A4 개별 FAIL 없음에도 강제)
**structural_verdict**: PASS

**Purpose**: cumulative P1 invariant `count(P1 across A1-A4) ≥ 3 → REQUEST_CHANGES` 동작 검증. A1-A4 중 개별 FAIL 없이 P1 3개가 누적될 때 final_verdict가 REQUEST_CHANGES로 강제됨을 확인. 각 axis가 단독으로는 non-blocking이어도 누적 시 blocking이 되는 invariant 동작 확인.

---

### SCN-19: A4 P1 boundary — verb-scope 혼용 (소유 동사 + 공동 기여 혼재)

**Bullet**: "결제 모듈 주요 API의 응답 지연(평균 320ms, SLA 목표 150ms 초과)이라는 제약을 해소하기 위해 Redis TTL 캐싱 레이어를 설계하고 운영했으며, DB 직접 조회 대비 메모리 내 해시 조회로 RTT를 단축하는 방식을 적용했다. 단일 인스턴스 운영 복잡도를 클러스터 대비 낮게 유지하는 트레이드오프를 수용했으며, 이는 현재 트래픽 규모(일 20만 요청)에서 단일 인스턴스 용량이 충분하다는 판단에 근거했다. 팀 내 공동 개선 사항으로 캐시 invalidation 정책을 기여했으며, API 평균 응답 시간을 320ms에서 95ms로 단축했다."
<!-- 5-signal mapping
- Signal 1 (Constraint): "결제 모듈 주요 API 응답 지연(평균 320ms, SLA 목표 150ms 초과)" — 구체적 SLA 위반 제약
- Signal 2 (Technology): "Redis TTL 캐싱 레이어 vs DB 직접 조회" — named system
- Signal 3 (Mechanism): "메모리 내 해시 조회로 RTT 단축" — mechanism 명시
- Signal 4 (Trade-off): "단일 인스턴스 운영 복잡도를 클러스터 대비 낮게 유지 — 운영 단순성 선택"
- Signal 5 (Rationale): "일 20만 요청 규모에서 단일 인스턴스 용량 충분 판단" — context-specific rationale
-->

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 결제 모듈 API 평균 응답 320ms, SLA 목표 150ms 초과. Signal 2 (Technology): Redis TTL 캐싱 레이어 vs DB 직접 조회 명시. Signal 3 (Mechanism): 메모리 내 해시 조회로 RTT 단축. Signal 4 (Trade-off): 단일 인스턴스 운영 복잡도 vs 클러스터 확장성. Signal 5 (Rationale): 일 20만 요청 규모에서 단일 인스턴스 용량 충분 판단. 5 signals → PASS.
- A2: PASS — Cause (Redis 캐시 레이어 추가) → effect (응답 시간 320ms→95ms). DB 직접 조회 → 메모리 해시 조회 인과 chain 직접적. arithmetic 모순 없음.
- A3: PASS — Tech outcome (API 평균 응답 시간) + before/after (320ms→95ms). numeric outcome 명시. "so what?" — SLA 위반 해소.
- A4: P1 — "설계하고 운영" (소유 동사 — 개인 주도 표현)과 "팀 내 공동 개선 사항을 기여" (공동 기여 표현)가 동일 bullet에 혼재. Korean Verb Taxonomy 상 개인 소유 동사(설계, 운영)와 공동 기여 동사(기여)의 scope 불일치가 경미한 모호성을 형성. P1 boundary — FAIL까지는 아니지만 verb-scope coherence 불완전.
- A5: PASS — 짧은 bullet이라 핵심 claim (결제 API 캐싱, 320ms→95ms) 6초 내 scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**A4 integrity_suspected**: false — scope qualifier 없는 boundary 케이스이나 solo verb + org-wide scope 구조적 overclaim 패턴에 해당하지 않음. 혼재 표현으로 인한 P1 boundary.

**Expected final_verdict**: APPROVE (count(P1 across A1-A4) = 1 < 3, structural_verdict PASS ∈ {PASS, P1})
**structural_verdict**: PASS

**Purpose**: A4 P1 경계 회귀 검출 — cumulative P1 invariant 기여 축으로서 A4의 P1 output 패턴 보장. 소유 동사와 공동 기여 표현 혼재가 A4 P1 boundary를 유발하되 단독으로는 APPROVE를 유지함을 검증.

---

### SCN-20: R-Cross abstention — benign overlap (parallel engagement)

**Bullet (current entry)**: "At Acme Corp 2022-01 → 2023-12 (2y) as Staff Engineer, designed and shipped a multi-tenant billing pipeline on Kafka (partition-per-tenant isolation) that reduced invoice generation latency from 18s to 1.2s at 500K monthly invoices; chose Kafka over SQS for per-tenant ordering guarantees, accepting higher ops overhead."

**Cross-entry context**: "2023-06 → 2024-03 Part-time Technical Advisor at StartupX (3h/week contractual advisory engagement — disclosed in resume)"

**Candidate context**: { years: 8, position: "Staff Engineer", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 18s invoice generation latency at 500K monthly invoices scale. Signal 2 (Technology): Kafka with partition-per-tenant isolation, compared to SQS. Signal 3 (Mechanism): partition-per-tenant isolation guaranteeing per-tenant ordering. Signal 4 (Trade-off): higher ops overhead accepted for ordering guarantees. Signal 5 (Rationale): SQS lacks per-tenant ordering guarantees — context-specific rationale. 5 signals → PASS.
- A2: PASS — Cause (Kafka partition-per-tenant) → effect (18s→1.2s). Arithmetic: ≈93% reduction. 500K monthly invoices scale context provided. Causal chain (SQS unordered → Kafka per-tenant isolation → latency drop) coherent and internally consistent.
- A3: PASS — Tech outcome (invoice generation latency) + scale (500K monthly invoices) + before/after (18s→1.2s) all explicit. "so what?" — billing SLA met at fintech scale.
- A4: PASS — "designed and shipped" (소유 동사) + 2-year Staff Engineer scope + pipeline-level redesign 범위. No shared-credit ambiguity; verb-scope coherent.
- A5: PASS — Problem (invoice latency), technology (Kafka + partition isolation), result (18s→1.2s) all scan-visible within one bullet.

**Expected critical rules**:
- r_phys.triggered: false (reasoning: "18s→1.2s latency reduction is physically achievable via in-memory partition routing vs DB-backed SQS polling")
- r_cross.triggered: false (reasoning: "Overlap period 2023-06→2023-12 (~6 months) is between a full-time Staff Engineer role and a disclosed part-time contractual advisory engagement (3h/week). Parallel engagement is legitimate and explicitly qualified; no full-time dual-ownership contradiction exists. R-Cross abstains — benign overlap.")

**Expected final_verdict**: APPROVE (all axes PASS, r_cross.triggered false, r_phys.triggered false)
**structural_verdict**: PASS

**Purpose**: R-Cross abstention(benign overlap) 검증 — 이력서에 명시된 part-time advisory 계약과 full-time 직무 간의 기간 overlap이 R-Cross를 트리거하지 않음을 확인. SCN-9(full-time dual-ownership 모순)과 대비되는 benign overlap 패턴: parallel engagement가 명시적으로 한정(contractual advisory, 3h/week)되어 있으면 r_cross.triggered = false → final_verdict = APPROVE 유지. Examiner가 overlap 기간을 식별하되 partial/advisory scope qualifier를 인식하여 abstain해야 함을 검증.

---

### SCN-21: Priority cross-trigger — count(P1) ≥ 3 AND structural_verdict FAIL (priority 3 precedence)

**Bullet**: "검색 서비스의 응답 지연 문제를 해소하기 위해 ElasticSearch를 도입해 인덱싱 파이프라인을 구축했다. 기존 RDB full-scan 대비 역색인 기반 검색으로 응답 속도를 개선했으며, 팀 검색 쿼리 최적화 작업에도 일부 기여했다. 검색 정확도와 운영 안정성이 향상됐다."
<!-- 5-signal mapping
- Signal 1 (Constraint): "검색 서비스의 응답 지연 문제" — 구체적 지연 수치/SLA 임계치 없이 추상적 서술 → Signal 1 불완전
- Signal 2 (Technology): "ElasticSearch" + "RDB full-scan 대비" — named system, alternative 명시
- Signal 3 (Mechanism): "역색인 기반 검색으로 응답 속도 개선" — mechanism 명시
- Signal 4 (Trade-off): (absent — 운영 복잡도, 인프라 비용 증가 등 trade-off 미언급)
- Signal 5 (Rationale): (absent — 왜 ElasticSearch가 이 맥락에서 최선인지 근거 없음)
- A3: "검색 정확도와 운영 안정성이 향상됐다" — outcome type 분류 불가 (검색 정확도=tech metric? business metric?), numeric 없음, before/after 없음 → A3 P1 boundary
- A5: Signal 1 수치/SLA 없고, trade-off/rationale 전무 + outcome fuzzy → 6–30초 scan에서 문제 규모·결정 근거·결과 magnitude 중 어느 것도 포착 불가 → A5 FAIL (detail underload)
-->

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "e-commerce" }

**Expected verdicts**:
- A1: P1 — Signal 1 (Constraint): "검색 서비스의 응답 지연 문제"는 제약 존재를 시사하나 수치(현재 p99, SLA 임계치, 요청량 등) 전무로 concreteness 부족. Signal 2 (Technology): ElasticSearch vs RDB full-scan 명시. Signal 3 (Mechanism): 역색인 기반 검색. Signal 4 (Trade-off): 미언급. Signal 5 (Rationale): 미언급. Signal 1 thin + Signal 4/5 absent → 2/5 absent → P1 경계 (Signal 2·3 존재하나 depth 부족으로 PASS 미달).
- A2: P1 — Cause (ElasticSearch 역색인) → effect ("검색 정확도와 운영 안정성 향상"). Causal chain 방향은 식별되나 effect가 fuzzy하고 numeric 없어 인과 검증 불가. 병행 변경(서버 증설, 쿼리 튜닝 등) 가능성 unverified. A2 rule "cause→effect stated but one link unverified" → P1.
- A3: P1 — "검색 정확도와 운영 안정성이 향상됐다" — outcome type boundary unclear: 검색 정확도는 tech metric(recall, precision)인지 business metric(클릭률, 전환율)인지 분류 불가. 운영 안정성도 가용성/MTTR 등 tech 지표인지 SLA 준수율 등 business 지표인지 불명. numeric outcome 전무 → magnitude 불명. A3 P1 rule "outcome type boundary unclear" 직접 해당.
- A4: PASS — "ElasticSearch를 도입해 인덱싱 파이프라인을 구축" (소유 동사 명시) + "팀 검색 쿼리 최적화 작업에도 일부 기여" (기여 범위 한정). verb-scope 혼재이나 각 scope에 qualifier 존재. Mid-level + 기여 범위 coherent. PASS.
- A5: FAIL — Detail underload: Signal 1 수치 없음, Signal 4/5 전무, outcome fuzzy. 6–30초 scan으로 constraint 규모·decision rationale·result magnitude 중 어느 것도 포착 불가. 핵심 signal density 부족 → A5 FAIL.

**P1 count across A1-A4**: A1=P1, A2=P1, A3=P1, A4=PASS → count(P1) = 3 ≥ 3 → priority 3 발동.
**structural_verdict**: FAIL → priority 5 발동 조건 충족.
**Priority resolution**: priority matrix 우선순위 3 < 5 → priority 3 먼저 적용. routing lane = source extraction (A1-A4 누적 P1 보강 요청). priority 5 readability-fix lane은 적용 안 됨.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (priority 3: count(P1 across A1-A4) = 3 ≥ 3 — priority 5 structural_verdict FAIL 동시 발생하나 priority 3이 우선 적용됨)
**structural_verdict**: FAIL

**routing_target**: source extraction — 가장 약한 P1 축(A1: constraint concreteness, A2: causal chain verification, A3: outcome type clarity)부터 순서대로 보강. readability-fix lane(priority 5)은 priority 3에 의해 차단됨.

**Purpose**: priority cross-trigger regression guard — `count(P1 across A1-A4) ≥ 3` (priority 3)과 `structural_verdict == FAIL` (priority 5)이 동시 발생할 때, priority matrix 정의 순서에 따라 priority 3이 우선 적용되어 routing lane이 readability-fix(priority 5)가 아닌 source extraction(priority 3)으로 결정됨을 검증. SCN-2(A5 FAIL alone → readability-fix)와 SCN-A1-cumP1-3(cumulative P1 alone → source extraction)의 조합 케이스에서 priority precedence가 정확히 동작하는지 확인.

---

### SCN-22: A2 Rule 4 standalone — p50만 제시, p99 누락 → Soft P1

<!-- P1-3-regression guard: Rule 4 standalone = Soft P1 (Severity Tier L33) -->
<!-- 5-signal mapping
- Signal 1 (Constraint): "검색 서비스 latency 스파이크" — 구체적 수치 없으나 제약 유형 명시
- Signal 2 (Technology): "Elasticsearch 샤드 재분배" — named system, mechanism 명시
- Signal 3 (Mechanism): "hot shard 집중을 분산해 처리 균형을 맞추는 것" — mechanism 명시
- Signal 4 (Trade-off): "운영 복잡도 증가 대비 응답 안정성 향상" — trade-off 명시
- Signal 5 (Rationale): (trade-off 비교 근거 포함) → A1 PASS
- A2: Cause (샤드 재분배) → mechanism (hot shard 분산) → effect (p50 latency 420ms→180ms). causal chain 논리적으로 성립, 병행 변경 언급 없음. 단, scale/안정성 주장 없이 p50 단독 제시 — Rule 4(distribution 미충족) standalone → Soft P1.
-->

**Bullet**: "검색 서비스 latency 스파이크가 제약 조건으로 식별됐고, 팀 내 성능 검토를 거쳐 Elasticsearch 샤드 재분배 방식을 채택했다. 메커니즘은 hot shard 집중을 분산해 처리 균형을 맞추는 것이며, 운영 복잡도 증가 대비 응답 안정성 향상의 트레이드오프를 비교한 근거 하에 결정했다. 이 개선으로 검색 API 중앙값(p50) latency를 420ms에서 180ms로 57% 단축해 달성했으며, 개인 기여로 샤드 전략 설계를 주도했다."

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "e-commerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): latency 스파이크 명시. Signal 2 (Technology): Elasticsearch 샤드 재분배. Signal 3 (Mechanism): hot shard 분산으로 처리 균형. Signal 4 (Trade-off): 운영 복잡도 vs 응답 안정성. Signal 5 (Rationale): trade-off 비교 근거 명시. 5 signals 충족 → PASS.
- A2: P1 — Cause (샤드 재분배) → mechanism (hot shard 분산) → effect (p50 latency 420ms→180ms). Causal chain 논리적으로 성립. 단, p50(중앙값)만 제시되어 p99 tail behavior 미공개 — Rule 4 (missing distribution: p99 absent when p50 cited) standalone 위반. Rule 4 standalone = Soft P1 (Severity Tier).
- A3: PASS — tech outcome: p50 latency 420ms→180ms (57% 단축). before/after 모두 존재. numeric outcome + 달성 동사 명시.
- A4: PASS — "개인 기여로 샤드 전략 설계를 주도" — 소유 동사 + 범위 qualifier. Mid-level coherent.
- A5: PASS — Constraint (latency 스파이크) / Decision (샤드 재분배, trade-off) / Result (p50 단축) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (A2 P1 단독 — non-blocking; cumulative P1 count = 1 < 3)
**structural_verdict**: PASS

**Purpose**: P1-3 regression guard — Rule 4 (missing distribution) standalone 위반이 Soft P1로 분류되어 APPROVE를 유지함을 검증. Severity Tier에서 Rule 4 standalone = Soft P1이 Hard FAIL로 격상되지 않음을 확인. a2-causal-honesty.md B-3 exemplar 기반.

---

### SCN-23: A2 FAIL Exemplar 7 재현 — Rule 4 + Sub-check 1 compound → Hard FAIL

<!-- P1-3-regression guard: Rule 4 + Sub-check 1 compound = Hard FAIL -->
<!-- 5-signal mapping
- Signal 1 (Constraint): "트래픽 5배 증가 상황" — scale context 명시
- Signal 2 (Technology): (인프라/기술 변경 미언급 — 최적화 결과만 제시)
- Signal 3 (Mechanism): (mechanism 미언급)
- Signal 4 (Trade-off): (미언급)
- Signal 5 (Rationale): (미언급)
- A1: Signal 2/3/4/5 absent → A1 FAIL
- A2: "확장성 증명" 인과 결론이 평균 latency 유지만으로 지지됨. Rule 4 위반(p99 미제시) + Sub-check 1 failure(tail 증거 없이 scale→안정성 인과 고리 붕괴) → Compound Hard FAIL
-->

**Bullet**: "트래픽 5배 증가 상황에서 평균 latency 250ms 유지로 안정적 확장성 증명"

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "infrastructure" }

**Expected verdicts**:
- A1: FAIL — Signal 2 (Technology): 기술 선택 미언급. Signal 3 (Mechanism): 확장 메커니즘 미언급. Signal 4 (Trade-off): 미언급. Signal 5 (Rationale): 미언급. Signal 1 (Constraint): "트래픽 5배 증가"만 존재. 4/5 absent → A1 FAIL.
- A2: FAIL — Rule 4 (Missing distribution: 평균 latency만 제시, p95/p99 미공개) + Sub-check 1 (Causal Chain Validity) failure: "확장성 증명"은 tail latency 안정성으로만 검증됨에도 평균만 제시 → scale→안정성 인과 고리에서 tail 증거 공백. 5배 트래픽 하 안정성 인과 결론이 tail 분포 데이터 없이 붕괴. Compound (Rule 4 + Sub-check 1) → Hard FAIL.
- A3: FAIL — numeric outcome 제시(250ms 유지)하나 before/after 구조 없음 ("유지" 주장에 baseline latency 미언급). outcome significance 검증 불가.
- A4: PASS — "증명" verb는 1인칭 소유 동사. Mid-level + 문맥 coherent.
- A5: FAIL — Signal 2/3/4/5 전무. 기술 결정 근거·메커니즘·trade-off 없어 핵심 판단 요소 scan 불가. Detail underload → A5 FAIL.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (A2 Hard FAIL — A1/A3/A5 FAIL 복합; individual axis FAIL 존재)
**structural_verdict**: FAIL

**Purpose**: P1-3 regression guard — FAIL Exemplar 7 재현. Rule 4 (missing distribution) + Sub-check 1 (Causal Chain Validity) compound 위반이 Hard FAIL로 분류됨을 검증. Severity Tier에서 "2+ concurrent rule violations → Hard FAIL" 및 "Sub-check 1 failure → Hard FAIL" 규칙이 SCN-22(Rule 4 standalone = P1)와 대비되어 compound 격상 경계를 명확히 확인.

---

### SCN-24: A2 arithmetic direction — increase case (throughput-like) → APPROVE

<!-- P1-5-regression guard: multiplier direction increase (after/before) — correctly parsed → PASS -->
<!-- 5-signal mapping
- Signal 1 (Constraint): "RPS 처리 한계가 배포 병목" — 제약 수치 명시
- Signal 2 (Technology): "worker pool 확장" — 특정 기법 명시
- Signal 3 (Mechanism): "병렬 처리 worker 수 증가로 throughput 향상" — mechanism 명시
- Signal 4 (Trade-off): "메모리 사용 증가 감수" — trade-off 명시
- Signal 5 (Rationale): "병목 지점이 CPU-bound 처리임을 프로파일링으로 확인 후 결정" — rationale 명시
- A2: after/before = 15/10 = 1.5x. Candidate claims 1.5x. 일치 → arithmetic PASS
-->

**Bullet**: "배포 파이프라인 RPS 처리 한계가 병목으로 식별되어, CPU-bound 프로파일링 결과를 근거로 worker pool 확장 방식을 채택했다. 메모리 사용 증가를 감수하고 병렬 처리 worker 수를 늘려 throughput을 10 RPS에서 15 RPS로 향상시켰으며(1.5x), 배포 안정성 개선에 직접 기여했다."

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "infrastructure" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): RPS 처리 한계 명시. Signal 2 (Technology): worker pool 확장. Signal 3 (Mechanism): 병렬 처리 worker 수 증가. Signal 4 (Trade-off): 메모리 사용 증가 감수. Signal 5 (Rationale): CPU-bound 프로파일링 근거. 5 signals 충족 → PASS.
- A2: PASS — arithmetic direction (increase, throughput-like): after/before = 15/10 = 1.5x. Candidate claim "1.5x" 일치. Causal chain (CPU-bound 병목 → worker 확장 → throughput 1.5x) 논리 성립. Rule 위반 없음 → PASS.
- A3: PASS — tech outcome: throughput 10 RPS → 15 RPS (1.5x). before/after 모두 존재. numeric outcome 명시.
- A4: PASS — "직접 기여" 소유 동사. Mid-level coherent.
- A5: PASS — Constraint (RPS 한계) / Decision (worker pool 확장, 프로파일링 근거) / Result (1.5x throughput) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (all axes PASS)
**structural_verdict**: PASS

**Purpose**: P1-5 regression guard (increase case) — throughput-like 증가 시 multiplier를 after/before = 15/10 = 1.5x로 올바르게 계산함을 검증. 방향 슬립(before/after = 10/15 ≈ 0.67x로 오계산) 시 이 SCN이 실패하여 regression을 감지.

---

### SCN-25: A2 arithmetic direction — reduction case (latency-like) → APPROVE

<!-- P1-5-regression guard: multiplier direction reduction (before/after) — correctly parsed → PASS -->
<!-- 5-signal mapping
- Signal 1 (Constraint): "p99 latency 200ms — SLA 100ms 초과" — 제약 수치 명시
- Signal 2 (Technology): "Redis 캐싱 계층 도입" — named system
- Signal 3 (Mechanism): "DB 조회를 캐시 hit으로 대체해 응답 경로 단축" — mechanism 명시
- Signal 4 (Trade-off): "캐시 일관성 관리 복잡도 증가 수용" — trade-off 명시
- Signal 5 (Rationale): "read-heavy 워크로드 분석으로 캐시 효용 확인" — rationale 명시
- A2: before/after = 200/50 = 4x reduction. Candidate claims 4x reduction. 일치 → arithmetic PASS
-->

**Bullet**: "API p99 latency가 200ms로 SLA 100ms를 초과하는 제약이 식별되어, read-heavy 워크로드 분석을 근거로 Redis 캐싱 계층을 도입했다. DB 조회를 캐시 hit으로 대체해 응답 경로를 단축했으며, 캐시 일관성 관리 복잡도 증가를 감수하고 p99 latency를 200ms에서 50ms로 4x 단축했다. 캐싱 전략 설계를 개인적으로 주도했다."

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): p99 latency 200ms, SLA 100ms 초과 명시. Signal 2 (Technology): Redis 캐싱 계층. Signal 3 (Mechanism): DB 조회 → 캐시 hit 응답 경로 단축. Signal 4 (Trade-off): 캐시 일관성 관리 복잡도. Signal 5 (Rationale): read-heavy 워크로드 분석 근거. 5 signals 충족 → PASS.
- A2: PASS — arithmetic direction (reduction, latency-like): before/after = 200/50 = 4x. Candidate claim "4x 단축" 일치. Causal chain (read-heavy → Redis 캐시 → latency 4x reduction) 논리 성립. Rule 위반 없음 → PASS.
- A3: PASS — tech outcome: p99 latency 200ms → 50ms (4x 단축). before/after 모두 존재. numeric outcome 명시.
- A4: PASS — "개인적으로 주도" 소유 동사. Mid-level coherent.
- A5: PASS — Constraint (SLA 초과) / Decision (Redis 캐싱, read-heavy 분석 근거) / Result (4x latency 단축) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE (all axes PASS)
**structural_verdict**: PASS

**Purpose**: P1-5 regression guard (reduction case) — latency-like 감소 시 multiplier를 before/after = 200/50 = 4x로 올바르게 계산함을 검증. 방향 슬립(after/before = 50/200 = 0.25x로 오계산) 시 이 SCN이 실패하여 regression을 감지. SCN-24(increase)와 쌍을 이루어 양방향 arithmetic recipe를 커버.

---

### SCN-26: P1-1 regression guard — count(P1) ∈ {1,2} + structural_verdict FAIL → Readability-only fix

<!-- P1-1-regression guard: count(P1 across A1-A4) < 3 AND no FAIL in A1-A4 AND structural_verdict == FAIL → priority 5 readability-only fix lane (NOT source extraction) -->
<!-- 5-signal mapping
- Signal 1 (Constraint): "주문 처리 서비스 피크타임 오류율 3%가 SLA 0.5% 초과" — 수치 명시, SLA 임계치 존재
- Signal 2 (Technology): "gRPC 비동기 통신 전환" — named protocol, named alternative implied (기존 동기 HTTP)
- Signal 3 (Mechanism): "동기 블로킹 I/O를 비동기 non-blocking으로 전환해 thread pool 고갈 방지" — mechanism 명시
- Signal 4 (Trade-off): "gRPC schema 관리 복잡도 증가를 수용" — trade-off 명시
- Signal 5 (Rationale): (미언급 — 왜 gRPC가 대안보다 이 맥락에서 더 적합한지 근거 없음) → Signal 5 absent → A1 P1 boundary
- A2: Cause (비동기 전환) → mechanism (thread pool 고갈 방지) → effect (오류율 3%→0.4%). Causal chain 논리 성립. 단, concurrent 요청 변화나 서버 scale-out 등 confounding 없음을 명시하지 않아 one link unverified → A2 P1.
- A3: tech outcome: 오류율 3%→0.4%. before/after 모두 존재. SLA 달성 명시 → A3 PASS.
- A4: "직접 구현하고 운영 배포를 주도" — 소유 동사 + 범위 coherent → A4 PASS.
- A5: Signal 5 Rationale 전무, "gRPC schema 관리 복잡도"는 언급되나 구체적 운영 데이터 없음. bullet 전반이 단문 나열로 Constraint→Decision→Result 흐름이 scan상 압축·결절되어 6-30초 내 문제 규모와 결정 근거를 동시에 파악하기 어려움 → A5 FAIL (structural clarity 부족).
-->

**Bullet**: "주문 처리 서비스의 피크타임 오류율 3%가 SLA 0.5%를 초과하는 제약이 식별됐다. gRPC 비동기 통신으로 전환해 동기 블로킹 I/O를 제거, thread pool 고갈을 방지했으며 gRPC schema 관리 복잡도 증가를 수용했다. 직접 구현하고 운영 배포를 주도해 오류율을 3%에서 0.4%로 낮춰 SLA를 달성했다."

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: P1 — Signal 1 (Constraint): 오류율 3%, SLA 0.5% 수치 명시. Signal 2 (Technology): gRPC 비동기 전환. Signal 3 (Mechanism): 동기 블로킹 I/O → non-blocking, thread pool 고갈 방지. Signal 4 (Trade-off): gRPC schema 관리 복잡도 증가 수용. Signal 5 (Rationale): 미언급 — 왜 gRPC가 이 맥락에서 최선인지 근거 없음. 4/5 signals 충족, Signal 5 absent → P1 경계.
- A2: P1 — Cause (gRPC 비동기 전환) → mechanism (thread pool 고갈 방지) → effect (오류율 3%→0.4%). Causal chain 방향 식별됨. 단, concurrent 요청 변화·서버 scale-out 등 confounding factor 배제 명시 없어 one link unverified → A2 P1.
- A3: PASS — tech outcome: 오류율 3%→0.4%. before/after 모두 존재. SLA 달성 달성 동사 명시 → numeric outcome PASS.
- A4: PASS — "직접 구현하고 운영 배포를 주도" — 소유 동사 명시 + Mid-level coherent. PASS.
- A5: FAIL — Structural clarity 부족: Signal 5 Rationale 전무로 결정 근거가 scan에서 포착되지 않음. bullet 단문 나열 구조로 Constraint → Decision → Result 흐름이 6-30초 scan 내에서 압축·결절됨. Detail underload 아닌 presentation 실패 → A5 FAIL.

**P1 count across A1-A4**: A1=P1, A2=P1, A3=PASS, A4=PASS → count(P1) = 2 < 3 → priority 3 미발동.
**structural_verdict**: FAIL → priority 5 발동 조건 충족.
**Priority resolution**: A1-A4에 FAIL 없음 (no FAIL in {A1, A2, A3, A4}) → priority 4 미발동. count(P1 across A1-A4) = 2 < 3 → priority 3 미발동. structural_verdict == FAIL → priority 5 발동. routing lane = Readability-only fix.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: REQUEST_CHANGES (priority 5: A1-A4 모두 PASS/P1, count(P1 across A1-A4) = 2 < 3, structural_verdict == FAIL — Readability-only fix lane)
**structural_verdict**: FAIL

**routing_target**: Readability-only fix — depth 충분, scan 실패. 재구성·압축만으로 해결 (추가 인터뷰 불필요). source extraction 불필요.

**Purpose**: P1-1 regression guard — `no FAIL in A1-A4 AND count(P1 across A1-A4) < 3 AND structural_verdict == FAIL` 조건(priority 5)이 정확히 Readability-only fix lane으로 라우팅됨을 검증. count(P1)=2로 priority 3(≥3) 경계 미만을 확인. SCN-21(count(P1)=3 + structural FAIL → source extraction, priority 3 우선)과 대조되어 count 경계에서 priority 5가 정확히 발동함을 보장. 이 SCN이 실패하면 P1-1 routing condition regression이 감지됨.

---

### SCN-27: A3 PASS Gate sufficient-form — qualitative-causality form + unblocking verb PASS

<!-- T6 regression guard: a3 PASS Gate sufficient-form (qualitative-causality form) — qualitative outcome with explicit causality AND resolution verb → PASS (no numeric required) -->

**Bullet**: "Refactored payment integration to enable sandboxing, chosen over contract-test mocks because mocks could not replicate live-gateway error paths, accepting reduced fidelity to real API responses in exchange for full environment isolation — unblocking QA from environment dependency and allowing parallel test runs."

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Technology (payment integration refactor), Mechanism (sandboxing enablement), Constraint (QA environment dependency), Trade-off (reduced API fidelity accepted in exchange for isolation), Rationale (contract-test mocks ruled out because they cannot replicate live-gateway error paths). All 5 signals present → strict PASS.
- A2: PASS — Cause (refactoring → sandbox enablement) → effect (QA unblocked). Causal chain unambiguous.
- A3: PASS — sufficient-form (qualitative-causality form): qualitative outcome ("unblocking QA from environment dependency") with explicit causality (refactor → sandboxing → unblocking) AND resolution verb ("unblocking") present → PASS. No numeric magnitude required.
- A4: PASS — "Refactored" ownership verb + scope coherent with mid-level.
- A5: PASS — Problem (QA environment dependency) / Decision (sandboxing) / Result (QA unblocked) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**routing_target**: standard APPROVE path — all axes PASS, no readability-fix routing triggered.

**Purpose**: regression guard for A3 PASS Gate sufficient-form (qualitative-causality form) — qualitative outcome with explicit causality AND resolution verb PASSes without numeric magnitude. "unblocking" is an explicit resolution verb satisfying the qualitative-causality form of sufficient-form. This SCN fails if the evaluator incorrectly demands numeric evidence for qualitative-causality-with-unblocking-verb bullets.

---

### SCN-28: A3 regex numeric unit coverage — $-prefix, x multiplier, Korean 분

<!-- T6 regression guard: a3 PASS regex expansion — $2.4M ($-prefix revenue token), 13x (bare multiplier), 45분 (Korean duration unit) must all match -->

**Scope**: axis-isolated A3 regex coverage only. Other axes (A1/A2/A4/A5) are not asserted for these bullets; overall `final_verdict` is not applicable to this SCN.

**Bullet 1 ($2.4M)**: "Redesigned checkout flow API to eliminate 3-round-trip confirmation, cutting checkout abandonment from 12% to 8%, achieving ~$2.4M annualized revenue impact."

**Bullet 2 (13x)**: "Parallelized data ingestion pipeline across distributed workers, improving batch throughput 13x from baseline."

**Bullet 3 (45분)**: "Optimized CI pipeline caching strategy, reducing full build time from 3시간 to 45분."

**Candidate context**: { years: 5, position: "Backend Engineer", target_company: "커머스" }

**Expected verdicts (per bullet)**:

Bullet 1 (`$2.4M`):
- A3: PASS — numeric token `$2.4M` matches A3 PASS regex (`[$₩]\d{1,3}(,\d{3})*(\.\d+)?[MKB]?`). Outcome verb "achieving" present → PASS.

Bullet 2 (`13x`):
- A3: PASS — numeric token `13x` matches A3 PASS regex (`\d{1,3}(,\d{3})*(\.\d+)?\s*(x)`). Outcome verb "improving" present → PASS.

Bullet 3 (`45분`):
- A3: PASS — numeric token `45분` matches A3 PASS regex (`\d{1,3}(,\d{3})*(\.\d+)?\s*(분)`). Outcome verb "reducing" present → PASS.

**Expected critical rules** (all bullets):
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")

**Purpose**: regression guard for a3 PASS regex expansion — confirms `$2.4M` ($-prefix revenue), `13x` (bare multiplier), and `45분` (Korean duration unit) each match the A3 PASS numeric regex and correctly receive A3 PASS when paired with an outcome verb. This SCN fails if regex contraction drops any of these three token forms.

---

## Coverage Matrix

| Scenario | Primary Axis/Rule | Final Verdict | structural_verdict | Pattern Type |
|----------|-------------------|---------------|--------------------|--------------|
| SCN-1 | All PASS | APPROVE | PASS | Reference case |
| SCN-2 | A5 FAIL alone (A1-A4 PASS) | REQUEST_CHANGES | FAIL | A5 structural FAIL — REQUEST_CHANGES with readability-fix routing lane |
| SCN-3 | A1+A2+A3 co-failure | REQUEST_CHANGES | FAIL | Multi-axis co-failure (source extraction) |
| SCN-4 | R-Phys triggered | REQUEST_CHANGES | FAIL | Critical rule invariant |
| SCN-5 | A4 integrity_suspected + A3+A4 FAIL | REQUEST_CHANGES | PASS | Scope inflation via A4 integrity_suspected sub-flag (verb-scope inflation detection) |
| SCN-6 | A5 structure-agnostic | APPROVE | PASS | Impact-first one-liner |
| SCN-7 | A3 vanity metric + A1+A4 FAIL | REQUEST_CHANGES | P1 | Vanity metric + A1/A4 depth absent |
| SCN-8 | A4 contributed boundary | APPROVE | PASS | Junior PASS via correct ownership verb |
| SCN-9 | R-Cross triggered | REQUEST_CHANGES | PASS | Cross-entry timeline contradiction |
| SCN-10 | A1 P1 (Kafka thin rationale) | APPROVE | PASS | A1 P1 boundary — 4/5 signal, Signal 5 Rationale absent (non-blocking) |
| SCN-11 | A2 P1 (LCP unaccounted concurrent) | APPROVE | PASS | A2 P1 boundary (one link unverified) (non-blocking) |
| SCN-12 | A3 P1 (retry completion type ambiguity) | APPROVE | PASS | A3 P1 boundary (outcome type unclear) (non-blocking) |
| SCN-13 | A2 FAIL rule 1+2 compound (seasonality + window) | REQUEST_CHANGES | P1 | Missing comparable baseline + time window compound Hard FAIL |
| SCN-14 | A2 FAIL rule 2 + rule 1 compound (missing window + missing baseline) | REQUEST_CHANGES | PASS | Missing time window / operating conditions + missing comparable baseline compound Hard FAIL |
| SCN-15 | A2 FAIL rule 3 (offline→production) | REQUEST_CHANGES | PASS | Offline metric as production impact |
| SCN-16 | A2 FAIL rule 4+2 compound (distribution + window) | REQUEST_CHANGES | PASS | Missing distribution + time window compound Hard FAIL |
| SCN-17 | A2 FAIL rule 5 (absolute claim) | REQUEST_CHANGES | P1 | Absolute claim without scope and period |
| SCN-18 | A2 sub-check 4 Chained pattern | APPROVE | PASS | Trigger-conditioned Chained vs Isolated (Chained 신호) |
| SCN-A1-5strict-PASS | A1 5/5 strict bar | APPROVE | PASS | 5 signals jointly present — strict PASS reference |
| SCN-A5-demote-routing | A5 P1 structural demotion | APPROVE | P1 | A5 P1 non-blocking — standard APPROVE lane (readability-fix 비발동) |
| SCN-A1-cumP1-3 | Cumulative P1 ≥ 3 invariant | REQUEST_CHANGES | PASS | A1+A2+A3 P1, A4 PASS — cumulative trigger (no individual FAIL) |
| SCN-19 | A4 P1 (verb-scope boundary) | APPROVE | PASS | A4 P1 boundary — cumulative P1 contribution |
| SCN-20 | R-Cross abstention (benign overlap) | APPROVE | PASS | Part-time advisory parallel engagement — r_cross.triggered false |
| SCN-21 | Priority cross-trigger: count(P1)≥3 AND structural FAIL | REQUEST_CHANGES | FAIL | Priority 3 (cumulative P1) precedence over priority 5 (structural FAIL) — source extraction routing |
| SCN-22 | A2 Rule 4 standalone (p50 only, p99 absent) | APPROVE | PASS | Rule 4 standalone = Soft P1 — non-blocking, APPROVE 유지 (P1-3 regression guard) |
| SCN-23 | A2 Rule 4 + Sub-check 1 compound (FAIL Exemplar 7) | REQUEST_CHANGES | FAIL | Rule 4 + Sub-check 1 compound → Hard FAIL (P1-3 regression guard) |
| SCN-24 | A2 arithmetic direction increase (throughput-like, after/before) | APPROVE | PASS | Multiplier increase = after/before — 10→15 = 1.5x correctly parsed (P1-5 regression guard) |
| SCN-25 | A2 arithmetic direction reduction (latency-like, before/after) | APPROVE | PASS | Multiplier reduction = before/after — 200ms→50ms = 4x correctly parsed (P1-5 regression guard) |
| SCN-26 | P1-1 regression: count(P1)=2 + structural FAIL | REQUEST_CHANGES | FAIL | count(P1 across A1-A4) < 3 + structural_verdict FAIL → priority 5 Readability-only fix (NOT source extraction) (P1-1 regression guard) |
| SCN-27 | A3 PASS Gate sufficient-form: qualitative-causality form + unblocking verb | APPROVE | PASS | Qualitative causality + resolution verb → A3 PASS (no numeric required) (T6 regression guard) |
| SCN-28 | A3 regex: $2.4M / 13x / 45분 token coverage | N/A (axis-isolated) | N/A (axis-isolated) | $-prefix revenue, bare multiplier, Korean duration unit each match A3 PASS regex (T6 regression guard) |

## Axis Boundary Coverage

| Axis | PASS cases | FAIL cases | Boundary/P1 cases |
|------|-----------|-----------|-------------------|
| A1 | SCN-1, SCN-2, SCN-5, SCN-6, SCN-8, SCN-9, SCN-11, SCN-12, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, SCN-22, SCN-24, SCN-25, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-7, SCN-23 | SCN-10 (P1), SCN-A1-cumP1-3 (P1), SCN-21 (P1), SCN-26 (P1) |
| A2 | SCN-1, SCN-2, SCN-5, SCN-6, SCN-7, SCN-8, SCN-9, SCN-10, SCN-12, SCN-18, SCN-19, SCN-20, SCN-24, SCN-25, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-23 | SCN-11 (P1), SCN-A1-cumP1-3 (P1), SCN-21 (P1), SCN-22 (P1 — Rule 4 standalone), SCN-26 (P1) |
| A3 | SCN-1, SCN-2, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, SCN-22, SCN-24, SCN-25, SCN-26, SCN-27, SCN-28, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-5, SCN-7, SCN-23 | SCN-12 (P1), SCN-A1-cumP1-3 (P1), SCN-21 (P1) |
| A4 | SCN-1, SCN-2, SCN-3, SCN-4, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-12, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-20, SCN-21, SCN-22, SCN-23, SCN-24, SCN-25, SCN-26, SCN-A1-5strict-PASS, SCN-A5-demote-routing, SCN-A1-cumP1-3 | SCN-5, SCN-7 | SCN-19 (P1) |
| A5 | SCN-1, SCN-5, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-12, SCN-14, SCN-15, SCN-16, SCN-18, SCN-19, SCN-20, SCN-22, SCN-24, SCN-25, SCN-A1-5strict-PASS, SCN-A1-cumP1-3 | SCN-2, SCN-3, SCN-4, SCN-21, SCN-23, SCN-26 | SCN-7 (P1), SCN-13 (P1), SCN-17 (P1), SCN-A5-demote-routing (P1) |

## Critical Rule Coverage

| Rule | Triggered | Not triggered (false) | Notes |
|------|-----------|----------------------|-------|
| R-Phys | SCN-4 | SCN-1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,SCN-A1-5strict-PASS,SCN-A5-demote-routing,SCN-A1-cumP1-3 | — |
| R-Cross | SCN-9 | SCN-1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,21,22,23,24,25,26,27,28,SCN-A1-5strict-PASS,SCN-A5-demote-routing,SCN-A1-cumP1-3 (단일 bullet 평가, false); SCN-20 (benign overlap — part-time advisory parallel engagement) | — |
| A4 integrity_suspected | SCN-5 | (others) | verb-scope inflation 감지 sub-flag — solo verb + org-wide scope + no qualifier + Junior context → A4 FAIL escalation |

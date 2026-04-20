# Test Scenarios

examiner의 5축 evaluation 및 3 critical rule 동작 검증용 대표 시나리오.

## Scenario Format

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
**Expected critical rules**: r_phys / r_cross / r_scope triggered 여부
**Expected final_verdict**: APPROVE | REQUEST_CHANGES
**Purpose**: 이 시나리오가 검증하는 axis 또는 rule
```

**Critical rule format** (all three flags use same shape per `output-schema.md`):

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
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: 5축 모두 PASS의 reference case. 다른 시나리오 평가 기준점으로 사용.

---

### SCN-2: A5 FAIL alone — readability fix (detail spill)

**Bullet**: "Deployed Redis cluster (3 master + 3 replica, hash-slot based sharding, consistent hashing for client library) to replace single-instance Redis. maxmemory=8GB per node, allkeys-lru eviction, 2 week rollout. Result: p99 cache read 15ms → 3ms, failover from 90s → 8s, supported 3x traffic growth without re-provisioning."

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 2 (Technology): Redis cluster/consistent hashing/allkeys-lru 명시. Signal 3 (Mechanism): hash-slot 기반 sharding으로 single-instance 대체. Signal 4 (Trade-off): cluster topology 선택 + eviction 정책 명시. 3 signals → PASS.
- A2: PASS — Cause (single-instance → cluster + sharding) → effect (failover 개선, latency 개선). Arithmetic 없는 배수 서술이나 수치 모순 없음. 3x traffic growth는 causal chain의 결과로 coherent.
- A3: PASS — Tech outcomes 3개 (p99 cache read, failover time, traffic capacity). before/after 명확. "so what?" 충분.
- A4: PASS — "Deployed" + mid-level + infra-level scope. Coherent.
- A5: FAIL — Detail spill: `maxmemory=8GB per node, allkeys-lru eviction, 2 week rollout` 등 config 값이 rationale 없이 나열되어 핵심 결과(latency, failover)를 scan에서 방해. 6-30초 내 핵심 포착이 어려움.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A5 FAIL)

**Purpose**: A5 FAIL alone (A1-A4 모두 PASS) 시나리오. resume-forge에서 source extraction 없이 rewording 라우팅이 적절함을 검증. A5 co-failure disambiguation의 단독 분기 확인.

---

### SCN-3: A1 + A2 + A5 co-failure — source extraction trigger

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
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A1 + A2 + A3 + A5 FAIL)

**Purpose**: A5 + A1/A2/A3 co-failure 시나리오. resume-forge에서 source extraction routing이 필요한 패턴. "A5 FAIL alone"과 달리 단순 rewording으로 해결 불가.

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
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (r_phys invariant 적용 — A1-A5 결과와 무관하게 강제)

**Purpose**: R-Phys critical rule 트리거 검증. invariant: `r_phys.triggered == true → final_verdict = REQUEST_CHANGES` 동작 확인. Examiner가 구체적 수치("50000%")와 물리적 불가 이유를 출력해야 함을 검증.

---

### SCN-5: R-Scope triggered + A4 FAIL — led inflation (junior)

**Bullet**: "Led 30-person cross-functional initiative to migrate legacy payment gateway to modern microservices architecture across the entire organization"

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: P1 — Signal 2 (Technology): microservices 언급. Signal 1 (Constraint): legacy payment gateway 이전 필요성 implied. Signal 3 (Mechanism) 부재: migration 방식 (blue-green? strangler fig? big bang?) 없음. Signal 4 (Trade-off)/Signal 5 (Rationale) 부재: architectural rationale 없음. 2 signals이나 Mechanism/Trade-off/Rationale depth 부족 → P1.
- A2: PASS — Migration cause → architecture 변경이라는 causal description. Arithmetic 없고 수치 모순도 없음. Chain이 단순하지만 contradiction은 없음.
- A3: FAIL — outcome 없음. "migrate to modern microservices" 자체는 activity. 결과 (latency, reliability, deployment frequency) 없음. "so what?" 불가.
- A4: FAIL — "Led" + 30-person + cross-functional + entire organization = Junior 2년차에 명백한 scope inflation. Decision authority, direct/matrix leadership 근거 없음. 실질적 overclaim.
- A5: PASS — 한 줄로 verb / scope / target 파악 가능. Signal density는 낮지만 key claim은 scan됨.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: **true** — "Led" (leadership verb) + 30-person + "entire organization" + 2년차 Junior. Verb-scope mismatch 명확. P1 flag (자동 REQUEST_CHANGES 아님, A4 FAIL이 별도로 REQUEST_CHANGES 유발).
- r_scope 효과: P1 flag — final_verdict은 A4 FAIL이 결정.

**Expected final_verdict**: REQUEST_CHANGES (A3 FAIL + A4 FAIL; r_scope는 P1 flag로 추가 신호)

**Purpose**: R-Scope P1 flag + A4 FAIL 조합 검증. r_scope는 자동 REQUEST_CHANGES 유발 안 함을 확인. A4 FAIL이 독립적으로 REQUEST_CHANGES를 결정함을 검증. Junior + "led 30-person" 패턴은 R-Scope + A4 co-trigger의 대표 케이스.

---

### SCN-6: Impact-first one-liner PASS — A5 structure-agnostic

**Bullet**: "Cut checkout abandonment 18% → 9% via single-click address autofill (8M monthly sessions), adding 2 weeks delivery delay to gather data."

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "ecommerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): checkout abandonment 문제. Signal 2 (Technology): single-click address autofill 명시. Signal 3 (Mechanism): autofill로 friction 제거. Signal 4 (Trade-off): "adding 2 weeks delivery delay to gather data" — deliberate trade-off 명시. 4 signals → PASS.
- A2: PASS — Cause (address autofill 도입) → effect (abandonment 18%→9%) 직접 연결. Arithmetic: 18→9 = 50% reduction, internally consistent. Trade-off (delivery delay for data) explicit accept.
- A3: PASS — Business outcome (checkout abandonment %) + scale context (8M monthly sessions). before/after 명확. "so what?" — 이탈율 50% 개선.
- A4: PASS — "Cut" (execution ownership) + mid-level + feature-level scope. Coherent.
- A5: PASS — Impact-first one-liner. 6초 내 outcome + mechanism + context 모두 포착. Signal density 극대. Structure-agnostic PASS의 대표.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: A5 structure-agnostic 검증 — v1에서 강제된 PSR 구조 없이도 impact-first one-liner가 A5 PASS 가능함을 확인. Frontend/product-engineering bullet이 backend bias 없이 5축 PASS 가능함도 검증.

---

### SCN-7: A3 vanity metric FAIL — no baseline

**Bullet**: "Achieved p99 200ms on API response times with 99.99% uptime across all production services"

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "tech" }

**Expected verdicts**:
- A1: FAIL — Signal 1-5 모두 부재. "Achieved p99 200ms" — 어떤 mechanism으로 달성했는지 없음. Named systems 없음, constraint/trade-off/rationale 전무. 성과 수치만 있고 signal 없음 → FAIL.
- A2: PASS — Arithmetic 없고 수치 모순도 없음. Causal chain 자체가 없어서 A2 위반은 없음 (A3 문제로 귀속).
- A3: FAIL — Vanity metric. "p99 200ms", "99.99% uptime" 모두 절대 숫자만. before/after 없음. baseline 없음. p99 200ms가 5000ms에서 개선된 것인지 원래 그랬는지 불명. "so what?" 불가.
- A4: FAIL — "Achieved ... across all production services" — 동사(achieved)는 낮으나 scope("all production services")가 Senior 6년차 개인 기여로 비현실적. 팀 기여, 본인 ownership 범위 없음.
- A5: P1 — 짧고 숫자는 있으나 context 없어 scan으로 의미 파악 어려움. Signal density 낮음. FAIL까지는 아님 (숫자 자체는 포착 가능).

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A1 + A3 + A4 FAIL)

**Purpose**: A3 vanity metric 감지 검증. 절대 숫자만 있고 before/after 없는 패턴이 A3 FAIL을 트리거함을 확인. mechanism 없는 성과 나열이 Signal 1-5 모두 부재 → A1 FAIL임을 확인.

---

### SCN-8: Contributed + partial scope — Junior A4 PASS

**Bullet**: "Contributed N+1 query analysis to team's order-list performance effort (my part: query profiling + proposed batched JOIN pattern, team implemented). Result: p95 page load 2.1s → 380ms"

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "commerce" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): N+1 query 성능 문제. Signal 2 (Technology): batched JOIN 명시. Signal 3 (Mechanism): query pattern 전환으로 round-trip 감소. 3 signals → PASS.
- A2: PASS — Cause (N+1 → batched JOIN으로 round-trip 감소) → effect (p95 2.1s→380ms). Causal chain 직접적. Arithmetic: 2100ms / 380ms ≈ 5.5x speedup, 명시 안 됐으나 수치 모순 없음.
- A3: PASS — Tech outcome (p95 page load). before/after 명확. 2.1s→380ms = 5x 이상 개선. "so what?" 명확.
- A4: PASS — "Contributed" + partial scope 명시 (my part: profiling + proposed pattern) + team context 명시 (team implemented). Clarity에 부합. Junior에서 "contributed + 자기 portion 명시"는 PASS 패턴.
- A5: PASS — 한 문장에 scope (my part), mechanism (N+1 → batched JOIN), result (p95 2.1s→380ms) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: "Contributed" verb + partial scope 명시가 Junior에서 A4 PASS임을 검증. SCN-5(led inflation)와 대비: "led 30-person" → A4 FAIL vs "contributed + 자기 portion 명시" → A4 PASS. Junior candidate도 올바른 ownership verb + scope 명시로 APPROVE 가능함을 확인.

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
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (r_cross invariant → axis verdict 무관하게 강제)

**Purpose**: R-Cross critical rule 트리거 검증. Invariant `r_cross.triggered == true → final_verdict = REQUEST_CHANGES` 동작 확인. 5축 모두 PASS여도 cross-entry 모순이 final_verdict를 REQUEST_CHANGES로 강제함을 검증. Examiner가 구체적 기간 overlap(시작/종료일)과 모순 이유를 reasoning에 명시해야 함.

---

### SCN-10: A1 P1 — Senior Kafka adoption with thin partitioning rationale

**Bullet**: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s)"

**Candidate context**: { years: 7, position: "Senior Backend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: P1 — Signal 2 (Technology): Kafka/consumer group/partitioning 명시. Signal 3 (Mechanism): partitioning으로 backlog 해소 implied. Signal 4 (Trade-off) 부재: partition-key rationale, DLQ handling, at-least-once semantics 미언급. Signal 5 (Rationale) 부재. 2 signals (Technology + weak Mechanism)이나 Trade-off/Rationale depth 부족 → P1.
- A2: PASS — Cause (Kafka adoption with consumer-group partitioning) → effect (backlog p95 8min→45s). Causal chain coherent. Arithmetic: 8min→45s ≈ 89% reduction, no contradiction.
- A3: PASS — Tech outcome (backlog p95 latency) + scale context (4M daily events). before/after 명확. "so what?" 명확.
- A4: PASS — "Adopted" + Senior 7yr + order pipeline scope. Coherent.
- A5: PASS — Mechanism (Kafka partitioning), scale (4M), result (p95 8min→45s) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: APPROVE (P1은 blocking 아님; interview_hints에 A1 depth 보강 suggestion 포함)

**Purpose**: A1 P1 boundary 검증 — mechanism을 명시했으나 partition-key rationale, DLQ handling 등 Trade-off/Rationale signal depth가 부족한 패턴이 A1 P1을 트리거함을 확인. A1 rule: mechanism named but Trade-off/Rationale signals absent → P1. + final_verdict는 APPROVE 유지(P1은 non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-11: A2 P1 — LCP improvement with unaccounted concurrent changes

**Bullet**: "Switched product-listing thumbnails to WebP with srcset responsive loading; LCP p75 improved from 2.4s to 1.1s, measured in RUM over the 2-week rollout window"

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: PASS — Signal 2 (Technology): WebP/srcset responsive loading 명시. Signal 3 (Mechanism): format 전환 + delivery mechanism 선택으로 image weight 감소. Signal 5 (Rationale): RUM measurement window 명시로 deliberate 측정 접근 visible. 3 signals → PASS.
- A2: P1 — Full chain present (format change + delivery mechanism → reduced image weight → LCP improvement) with baseline, delta, and stated measurement window (2-week RUM). One link remains unverified: whether concurrent CDN/config changes during that window contributed. One confounder dimension open while other core links are closed — A2 rule "cause→effect stated but one link unverified" triggered.
- A3: PASS — Tech outcome (LCP p75) + before/after (2.4s→1.1s). "so what?" — 54% LCP 개선.
- A4: PASS — "Switched" + mid-level + frontend feature scope. Coherent.
- A5: PASS — mechanism (WebP/srcset), result (LCP 2.4s→1.1s), measurement context (2-week RUM) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: APPROVE (P1은 blocking 아님; interview_hints에 A2 unverified link clarification suggestion 포함)

**Purpose**: A2 P1 boundary 검증 — cause→effect chain이 명시됐으나 측정 window 중 concurrent 변경 가능성이 unverified link로 남는 패턴이 A2 P1을 트리거함을 확인. A2 rule: "cause→effect stated but one link unverified." + final_verdict는 APPROVE 유지(P1은 non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-12: A3 P1 — Checkout retry completion rate with outcome type ambiguity

**Bullet**: "Hardened error recovery on the checkout retry path; successful completion rate improved from 91% to 97%"

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): checkout retry path error recovery 문제. Signal 2 (Technology): error recovery hardening 명시. Signal 3 (Mechanism): retry path 경로 특정 + hardening approach. 3 signals → PASS.
- A2: PASS — Cause (error recovery hardening) → effect (completion rate 91%→97%). Causal chain coherent. Arithmetic: 6pp improvement on retry path, no contradiction.
- A3: P1 — Magnitude present (91%→97%), so magnitude-absence guardrail not the issue. "Successful completion rate" is dual-coded: HTTP/API success on retry (tech) versus business checkout conversion (business). "retry path" lexical context nudges toward tech success-rate reading — type resolvable within one interpretive step, but remains ambiguous. A3 rule "outcome type boundary unclear" triggered.
- A4: PASS — "Hardened" + mid-level + checkout retry path scope. Coherent.
- A5: PASS — problem (retry path error recovery), result (91%→97%) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: APPROVE (P1은 blocking 아님; interview_hints에 A3 outcome type disambiguation suggestion 포함)

**Purpose**: A3 P1 boundary 검증 — outcome magnitude가 있어도 outcome type(tech vs business)이 dual-coded로 해석되는 패턴이 A3 P1을 트리거함을 확인. A3 rule: "outcome type boundary unclear." + final_verdict는 APPROVE 유지(P1은 non-blocking) + interview_hints에 improvement suggestion 포함 검증.

---

### SCN-13: A2 FAIL — Q4 전환율 seasonality confound

**Bullet**: "Q4 구매 전환율 8.4% 달성, 직전 대비 2.1%p 개선"

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "analytics-saas" }

**Expected verdicts**:
- A1: FAIL — Signal 2 (Technology) 부재: named intervention 없음 ("달성"만). Signal 3 (Mechanism) 부재: 어떤 기술적 mechanism으로 전환율을 개선했는지 없음. Signal 5 (Rationale) 부재: 선택 근거 전무 → FAIL.
- A2: FAIL — "직전"이 Q3인지 작년 Q4인지 불분명. Q3→Q4는 연말 프로모션 트래픽이라 cohort 자체가 다름 → seasonality confound. 동일 cohort·동일 시즌 baseline 없으면 개선이 작업 결과인지 계절 효과인지 분리 불가. A2 violated rule: "Missing comparable baseline."
- A3: PASS — 전환율 수치(8.4%) + before/after(+2.1%p). magnitude 존재.
- A4: PASS — scope 및 동사 수준 특정 불가하나 overclaim 없음.
- A5: P1 — 짧고 수치는 있으나 mechanism context 없어 6초 scan으로 "무엇을 해서 개선됐는지" 불명. FAIL까지는 아님.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A1 + A2 FAIL)

**Purpose**: A2 FAIL — violated rule: "Missing comparable baseline." Q3 vs Q4 seasonality 미통제로 비교 기준이 동일 cohort가 아닌 패턴. baseline 조건 불일치가 causal verification을 무너뜨림을 검증.

---

### SCN-14: A2 FAIL — Redis 캐시 응답 시간 측정 기간 + baseline 누락

**Bullet**: "Redis 캐시 레이어 도입으로 주요 API 응답 시간을 320ms에서 85ms로 단축"

**Candidate context**: { years: 3, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 주요 API 응답 시간 개선 필요. Signal 2 (Technology): Redis 캐시 레이어 명시. Signal 3 (Mechanism): 캐시 레이어 도입으로 직접 DB 조회 감소. 3 signals → PASS.
- A2: FAIL — "320ms→85ms"라는 수치가 언제·어떤 트래픽 조건에서 측정됐는지 없음. cache hit→응답 단축 인과 자체는 타당하나, baseline이 캐시 warm 상태인지 cold 상태인지, 같은 쿼리 분포였는지 확인 불가 → 인과 검증이 아닌 숫자 대조. A2 violated rule: "Missing time window / operating conditions" (+ Missing comparable baseline).
- A3: PASS — Tech outcome (API 응답 시간) + before/after (320ms→85ms). magnitude 명확.
- A4: PASS — "도입" + mid-level + API layer scope. Coherent.
- A5: PASS — mechanism (Redis 캐시), result (320ms→85ms) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)

**Purpose**: A2 FAIL — violated rule: "Missing time window / operating conditions." 측정 기간 및 트래픽 조건 누락으로 수치의 재현 가능성이 검증 불가한 패턴. window 없이는 snapshot인지 평균인지도 알 수 없음을 검증.

---

### SCN-15: A2 FAIL — Offline F1 score → production chargeback savings

**Bullet**: "Trained a new gradient boosting model for fraud detection, improving the F1 score from 0.82 to 0.89 and saving $100k in chargebacks."

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 사기 탐지 모델 성능 개선. Signal 2 (Technology): gradient boosting 명시. Signal 3 (Mechanism): fraud detection task에 model 적용. 3 signals → PASS.
- A2: FAIL — F1 score improvement (0.82→0.89)은 offline/backtest metric이나 production financial impact ("saving $100k in chargebacks")로 seamless하게 연결. Production deployment 증명 없음. Offline accuracy → production chargeback reduction 고리에서 data drift, latency constraints, integration bugs 가능성 미통제. A2 violated rule: "Offline metric presented as production impact."
- A3: PASS — F1 0.82→0.89 + $100k chargeback savings. outcome magnitude 존재. (A2 FAIL이 검증 문제를 지적)
- A4: PASS — "Trained" + mid-level + fraud detection model scope. Coherent.
- A5: PASS — mechanism (gradient boosting), result (F1 + $100k) scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)

**Purpose**: A2 FAIL — violated rule: "Offline metric presented as production impact." holdout F1 개선을 실제 chargeback 절감으로 제시하는 offline→production attribution 오류 패턴 검증.

---

### SCN-16: A2 FAIL — 트래픽 5배 스케일 클레임에서 분포 누락

**Bullet**: "트래픽 5배 증가 상황에서 평균 latency 250ms 유지로 안정적 확장성 증명"

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "video-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 트래픽 5배 증가 상황에서 latency 유지 필요. Signal 3 (Mechanism): 안정화 작업으로 scaling 처리 implied. 2 signals → PASS. (단순하나 constraint + mechanism 최소 충족.)
- A2: FAIL — scale claim(5배 증가)에서 평균 유지는 p95/p99이 폭증해도 성립 가능. 평균은 throughput 증가 시 tail에 의해 잘 움직이지 않음 → "확장성 증명"은 tail latency 안정성으로만 검증됨에도 평균만 제시. A2 violated rule: "Missing distribution (avg vs p99) for scale claims."
- A3: PASS — 스케일 context(5배) + latency 수치(250ms) 존재. outcome 기술됨.
- A4: PASS — Senior level + "증명" 표현이지만 scope 부재하나 overclaim은 아님.
- A5: PASS — mechanism (scale 5배), result (250ms 유지) 6초 내 scan 가능.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)

**Purpose**: A2 FAIL — violated rule: "Missing distribution (avg vs p99) for scale claims." scale 주장에서 평균만 제시하고 tail latency(p95/p99) 분포를 생략한 패턴이 A2 검증 불가를 유발함을 확인.

---

### SCN-17: A2 FAIL — 운영 장애 0건 절대 주장 (scope + period 누락)

**Bullet**: "안정화 작업을 통해 운영 서비스 장애 0건 달성"

**Candidate context**: { years: 4, position: "Mid Backend", target_company: "recruitment-platform" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): 운영 서비스 장애 제거 목표. Signal 3 (Mechanism): "안정화 작업"이라는 intervention 명시. 2 signals (thin) → PASS.
- A2: FAIL — 어느 서비스인지(scope) 없음 — 전체 서비스 vs 담당 서비스 vs 특정 컴포넌트 구분 불가. 어느 기간인지(period) 없음 — 1주? 분기? 연간? 절대 주장(0건)은 scope·period 없이는 반증 불가능 → 인과 검증이 아니라 수사. A2 violated rule: "Absolute claim without scope and period."
- A3: PASS — "장애 0건"이라는 outcome 존재. 절대값 주장이나 A3 magnitude 기준은 충족.
- A4: PASS — "달성" + mid-level. Coherent.
- A5: P1 — 짧고 결과는 있으나 context(어느 서비스, 언제) 없어 scan으로 의미 파악이 불완전. FAIL까지는 아님.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: false (reasoning: "cross-entry context not provided")
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A2 FAIL)

**Purpose**: A2 FAIL — violated rule: "Absolute claim without scope and period." "장애 0건" 같은 절대 주장이 scope(서비스)와 period(기간) 없이 제시돼 반증 불가능한 수사가 되는 패턴 검증.

---

### SCN-18: A2 Chained pattern — 다중 제약 순차 해결

**Bullet**: "주문 이벤트 파이프라인에서 p99 800ms 지연을 분석 → DB write contention이 주요 원인으로 식별되어 user_id 기반 파티셔닝 도입 → 파티셔닝 이후 드러난 hot key rebalance 문제를 consistent hashing 키 재설계로 해결 → 최종 p99 800ms→120ms, hot key imbalance <5%"

**Candidate context**: { years: 5, position: "Backend Engineer", target_company: "커머스 플랫폼" }

**Expected verdicts**:
- A1: PASS — Signal 1 (Constraint): p99 800ms 지연 + DB write contention + hot key imbalance. Signal 2 (Technology): user_id 기반 파티셔닝, consistent hashing 키 재설계 명시. Signal 3 (Mechanism): 파티셔닝으로 contention 분산, hashing 재설계로 hot key 재균형. Signal 5 (Rationale): 선행 해결이 후행 문제를 드러낸 분석 흐름 명시. 4 signals → PASS.
- A2: PASS (Chained pattern — 선행 해결이 후행 문제 드러냄, trigger-conditioned sub-check 4 강한 긍정 신호)
- A3: PASS (quantified outcomes)
- A4: PASS (scope clear)
- A5: PASS

**Expected critical rules**: r_phys false / r_cross false (single entry) / r_scope false

**Expected final_verdict**: APPROVE

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
- r_scope.triggered: false

**Expected final_verdict**: APPROVE
**structural_verdict**: PASS

**routing_target**: standard APPROVE path — no readability fix routing triggered (A5 PASS, structural_verdict PASS)

**Purpose**: A1 5/5 strict bar PASS의 reference case. 단일 bullet에 Constraint + Selection + Mechanism + Trade-off + Rationale 5 signals이 jointly 존재하고 numeric outcome + scope qualifier를 갖춘 패턴이 A1 strict PASS를 트리거함을 검증. resume-forge에서 source extraction 없이 standard APPROVE path로 라우팅됨을 확인.

---

### SCN-A5-demote-routing: A5 P1 structural demotion — APPROVE 유지, readability-fix loop 트리거

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
- r_scope.triggered: false

**Expected final_verdict**: APPROVE
**structural_verdict**: P1

**routing_target**: forge Loop 2 gate readability-fix path triggered — A5 P1(structural_verdict P1)이 readability-fix routing을 유발하나, A5 단독으로는 REQUEST_CHANGES를 강제하지 않음. final_verdict는 APPROVE 유지.

**Purpose**: A5 demote 검증 — A5 P1(structural_verdict P1)이 있어도 A1-A4 모두 PASS이면 final_verdict는 APPROVE임을 확인. A5 alone은 REQUEST_CHANGES를 트리거하지 않는다는 invariant 검증. structural_verdict가 P1로 surfaced되고 forge Loop 2 readability-fix 라우팅이 트리거됨을 확인 (SCN-2의 A5 FAIL → REQUEST_CHANGES 패턴과 대비: P1은 non-blocking).

---

## Coverage Matrix

| Scenario | Primary Axis/Rule | Final Verdict | Pattern Type |
|----------|-------------------|---------------|--------------|
| SCN-1 | All PASS | APPROVE | Reference case |
| SCN-2 | A5 FAIL alone | REQUEST_CHANGES | A5 single failure (rewording) |
| SCN-3 | A1+A2+A3+A5 co-failure | REQUEST_CHANGES | Multi-axis co-failure (source extraction) |
| SCN-4 | R-Phys triggered | REQUEST_CHANGES | Critical rule invariant |
| SCN-5 | R-Scope + A3+A4 FAIL | REQUEST_CHANGES | Scope inflation + junior boundary |
| SCN-6 | A5 structure-agnostic | APPROVE | Impact-first one-liner |
| SCN-7 | A3 vanity metric | REQUEST_CHANGES | Vanity metric + A1 depth absent |
| SCN-8 | A4 contributed boundary | APPROVE | Junior PASS via correct ownership verb |
| SCN-9 | R-Cross triggered | REQUEST_CHANGES | Cross-entry timeline contradiction |
| SCN-10 | A1 P1 (Kafka thin rationale) | APPROVE | A1 P1 boundary (mechanism named, depth insufficient) (non-blocking) |
| SCN-11 | A2 P1 (LCP unaccounted concurrent) | APPROVE | A2 P1 boundary (one link unverified) (non-blocking) |
| SCN-12 | A3 P1 (retry completion type ambiguity) | APPROVE | A3 P1 boundary (outcome type unclear) (non-blocking) |
| SCN-13 | A2 FAIL rule 1 (seasonality) | REQUEST_CHANGES | Missing comparable baseline |
| SCN-14 | A2 FAIL rule 2 (time window) | REQUEST_CHANGES | Missing time window / operating conditions |
| SCN-15 | A2 FAIL rule 3 (offline→production) | REQUEST_CHANGES | Offline metric as production impact |
| SCN-16 | A2 FAIL rule 4 (distribution) | REQUEST_CHANGES | Missing distribution for scale claims |
| SCN-17 | A2 FAIL rule 5 (absolute claim) | REQUEST_CHANGES | Absolute claim without scope and period |
| SCN-18 | A2 sub-check 4 Chained pattern | APPROVE | Trigger-conditioned Chained vs Isolated (Chained 신호) |
| SCN-A1-5strict-PASS | A1 5/5 strict bar | APPROVE | 5 signals jointly present — strict PASS reference |
| SCN-A5-demote-routing | A5 P1 structural demotion | APPROVE | A5 P1 non-blocking — forge readability-fix routing |

## Axis Boundary Coverage

| Axis | PASS cases | FAIL cases | Boundary/P1 cases |
|------|-----------|-----------|-------------------|
| A1 | SCN-1, SCN-6, SCN-8, SCN-9, SCN-11, SCN-12, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-7, SCN-13 | SCN-5 (P1), SCN-10 (P1) |
| A2 | SCN-1, SCN-5, SCN-6, SCN-7, SCN-8, SCN-9, SCN-10, SCN-12, SCN-18, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17 | SCN-11 (P1) |
| A3 | SCN-1, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-3, SCN-4, SCN-5, SCN-7 | SCN-12 (P1) |
| A4 | SCN-1, SCN-2, SCN-3, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-12, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-A1-5strict-PASS, SCN-A5-demote-routing | SCN-5, SCN-7 | — |
| A5 | SCN-1, SCN-5, SCN-6, SCN-8, SCN-9, SCN-10, SCN-11, SCN-12, SCN-14, SCN-15, SCN-16, SCN-18, SCN-A1-5strict-PASS | SCN-2, SCN-3, SCN-4 | SCN-7 (P1), SCN-13 (P1), SCN-17 (P1), SCN-A5-demote-routing (P1) |

## Critical Rule Coverage

| Rule | Triggered | Not triggered (false) | — |
|------|-----------|----------------------|----|
| R-Phys | SCN-4 | SCN-1,2,3,5,6,7,8,10,11,12,13,14,15,16,17,18,SCN-A1-5strict-PASS,SCN-A5-demote-routing | — |
| R-Cross | SCN-9 | SCN-1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,SCN-A1-5strict-PASS,SCN-A5-demote-routing (단일 bullet 평가, false) | — |
| R-Scope | SCN-5 | SCN-1,2,3,4,6,7,8,10,11,12,13,14,15,16,17,18,SCN-A1-5strict-PASS,SCN-A5-demote-routing | — |

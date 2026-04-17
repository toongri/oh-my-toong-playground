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
  - A2: PASS | FAIL (reason)
  - A3: PASS | FAIL (reason)
  - A4: PASS | FAIL | P1 (reason)
  - A5: PASS | FAIL (reason)
**Expected critical rules**: r_phys / r_cross / r_scope triggered 여부
**Expected final_verdict**: APPROVE | REQUEST_CHANGES
**Purpose**: 이 시나리오가 검증하는 axis 또는 rule
```

---

## Scenarios

### SCN-1: All axes PASS — senior backend latency

**Bullet**: "Redesigned order event pipeline from synchronous REST to Kafka Streams partitioned by user_id, eliminating write hotspots on order_log primary key contention. Chose Kafka over Kinesis for in-house monitoring integration. Processed 8M daily events; p99 latency 800ms → 120ms, DB write contention incidents per week 12 → 0."

**Candidate context**: { years: 7, position: "Senior Backend", target_company: "commerce-platform" }

**Expected verdicts**:
- A1: PASS — Named systems (Kafka Streams, Kinesis, REST), partitioning key 선택 이유 (write hotspot), Kafka vs Kinesis trade-off (in-house monitoring). Senior 기준 architectural rationale + multi-system comparison 충족.
- A2: PASS — Cause (REST → Kafka Streams, partitioned by user_id) → mechanism (write hotspot 제거) → effect (p99 800ms→120ms, incidents 12→0). 단계별 chain 명시. 수치 모순 없음.
- A3: PASS — Tech outcome 2개 (p99 latency, contention incidents) + scale context (8M daily events). before/after 모두 존재. "so what?" 명확.
- A4: PASS — "Redesigned" (high ownership) + senior level + scope 명시 (order event pipeline). Coherent.
- A5: PASS — 한 단락에 problem (REST hotspot) / decision (Kafka, partitioning) / result (latency, incidents) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A (cross-entry context 없음)
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: 5축 모두 PASS의 reference case. 다른 시나리오 평가 기준점으로 사용.

---

### SCN-2: A5 FAIL alone — readability fix (detail spill)

**Bullet**: "Deployed Redis cluster (3 master + 3 replica, hash-slot based sharding, consistent hashing for client library) to replace single-instance Redis. maxmemory=8GB per node, allkeys-lru eviction, 2 week rollout. Result: p99 cache read 15ms → 3ms, failover from 90s → 8s, supported 3x traffic growth without re-provisioning."

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: PASS — Named (Redis cluster, consistent hashing, allkeys-lru). Mid level에서 cluster topology 선택 + eviction 정책 명시. Deliberate selection visible.
- A2: PASS — Cause (single-instance → cluster + sharding) → effect (failover 개선, latency 개선). Arithmetic 없는 배수 서술이나 수치 모순 없음. 3x traffic growth는 causal chain의 결과로 coherent.
- A3: PASS — Tech outcomes 3개 (p99 cache read, failover time, traffic capacity). before/after 명확. "so what?" 충분.
- A4: PASS — "Deployed" + mid-level + infra-level scope. Coherent.
- A5: FAIL — Detail spill: `maxmemory=8GB per node, allkeys-lru eviction, 2 week rollout` 등 config 값이 rationale 없이 나열되어 핵심 결과(latency, failover)를 scan에서 방해. 6-30초 내 핵심 포착이 어려움.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A5 FAIL)

**Purpose**: A5 FAIL alone (A1-A4 모두 PASS) 시나리오. resume-forge에서 source extraction 없이 rewording 라우팅이 적절함을 검증. A5 co-failure disambiguation의 단독 분기 확인.

---

### SCN-3: A1 + A2 + A5 co-failure — source extraction trigger

**Bullet**: "Worked on cache system performance improvements using various approaches including distributed caching, LRU policies, and memory management techniques to achieve better response times for our application ecosystem"

**Candidate context**: { years: 5, position: "Mid Backend", target_company: "saas" }

**Expected verdicts**:
- A1: FAIL — "various approaches" + vague "distributed caching, LRU policies, memory management techniques". Mid-level에서 요구되는 deliberate selection, constraint-based reasoning, independent judgment 전무. Named systems 없음 ("Redis", "Memcached" 등 미명시). "cache system" 수준으로는 insufficient.
- A2: FAIL — Causal chain 없음. "used approaches → better response times" 간 논리 gap. 어떤 approach가 어떤 mechanism으로 응답 개선을 이끌었는지 불명확. Hidden variable 가득.
- A3: FAIL — "better response times" 만 있고 before/after, magnitude 없음. Vanity metric 수준에도 미달 (절대값 조차 없음). "so what?" 불가.
- A4: PASS — "Worked on"은 participated 수준. Mid-level이지만 contributed-equivalent 동사로 scope와 coherent.
- A5: FAIL — Key signal absent. "application ecosystem" 같은 filler. 6-30초 scan으로 problem, decision, result 중 어느 것도 포착 불가.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A1 + A2 + A3 + A5 FAIL)

**Purpose**: A5 + A1/A2/A3 co-failure 시나리오. resume-forge에서 source extraction routing이 필요한 패턴. "A5 FAIL alone"과 달리 단순 rewording으로 해결 불가.

---

### SCN-4: R-Phys triggered — physically impossible numeric claim

**Bullet**: "Improved API latency by 50000% through optimization"

**Candidate context**: { years: 5, position: "Backend", target_company: "tech" }

**Expected verdicts**:
- A1: FAIL — "optimization" 외 어떤 mechanism도 없음. Named system, rationale, trade-off 전무. Mid-level에서 FAIL.
- A2: FAIL — "50000% improvement" 수학적 불가. 50000% 개선 = 500배 감소를 의미하나, latency를 0ms 이하로 줄일 수 없음. 내부 arithmetic 자체가 physically incoherent. Arithmetic consistency 위반.
- A3: FAIL — before/after 없음. "improved latency" 수준이며 magnitude가 physically 불가능한 허위 값. Outcome 없음.
- A4: PASS — "Improved"는 participation-level. scope 부재하나 동사 자체는 overclaim 아님.
- A5: FAIL — 단 한 줄이지만 signal density 제로. 핵심 mechanism, context 없음.

**Expected critical rules**:
- r_phys.triggered: **true** — "50000%" improvement: latency는 0ms 미만 불가능. 50000%는 500배 감소 의미이므로 물리적 불가. 해당 수치와 이유 명시 필수.
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (r_phys invariant 적용 — A1-A5 결과와 무관하게 강제)

**Purpose**: R-Phys critical rule 트리거 검증. invariant: `r_phys.triggered == true → final_verdict = REQUEST_CHANGES` 동작 확인. Examiner가 구체적 수치("50000%")와 물리적 불가 이유를 출력해야 함을 검증.

---

### SCN-5: R-Scope triggered + A4 FAIL — led inflation (junior)

**Bullet**: "Led 30-person cross-functional initiative to migrate legacy payment gateway to modern microservices architecture across the entire organization"

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "fintech" }

**Expected verdicts**:
- A1: P1 — "legacy payment gateway → microservices" 언급은 있으나 Junior 2년차에서 architectural rationale 부재. Migration 방식 (blue-green? strangler fig? big bang?) 없음. Named mechanism 없음. FAIL까지는 아니나 depth insufficient.
- A2: PASS — Migration cause → architecture 변경이라는 causal description. Arithmetic 없고 수치 모순도 없음. Chain이 단순하지만 contradiction은 없음.
- A3: FAIL — outcome 없음. "migrate to modern microservices" 자체는 activity. 결과 (latency, reliability, deployment frequency) 없음. "so what?" 불가.
- A4: FAIL — "Led" + 30-person + cross-functional + entire organization = Junior 2년차에 명백한 scope inflation. Decision authority, direct/matrix leadership 근거 없음. 실질적 overclaim.
- A5: PASS — 한 줄로 verb / scope / target 파악 가능. Signal density는 낮지만 key claim은 scan됨.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: **true** — "Led" (leadership verb) + 30-person + "entire organization" + 2년차 Junior. Verb-scope mismatch 명확. P1 flag (자동 REQUEST_CHANGES 아님, A4 FAIL이 별도로 REQUEST_CHANGES 유발).
- r_scope 효과: P1 flag — final_verdict은 A4 FAIL이 결정.

**Expected final_verdict**: REQUEST_CHANGES (A3 FAIL + A4 FAIL; r_scope는 P1 flag로 추가 신호)

**Purpose**: R-Scope P1 flag + A4 FAIL 조합 검증. r_scope는 자동 REQUEST_CHANGES 유발 안 함을 확인. A4 FAIL이 독립적으로 REQUEST_CHANGES를 결정함을 검증. Junior + "led 30-person" 패턴은 R-Scope + A4 co-trigger의 대표 케이스.

---

### SCN-6: Impact-first one-liner PASS — A5 structure-agnostic

**Bullet**: "Cut checkout abandonment 18% → 9% via single-click address autofill (8M monthly sessions), adding 2 weeks delivery delay to gather data."

**Candidate context**: { years: 4, position: "Mid Frontend", target_company: "ecommerce" }

**Expected verdicts**:
- A1: PASS — Named mechanism (single-click address autofill). Mid-level에서 UX mechanism 명시 + 결과 측정. "adding 2 weeks delivery delay to gather data"는 deliberate trade-off 인식. Independent judgment visible.
- A2: PASS — Cause (address autofill 도입) → effect (abandonment 18%→9%) 직접 연결. Arithmetic: 18→9 = 50% reduction, internally consistent. Trade-off (delivery delay for data) explicit accept.
- A3: PASS — Business outcome (checkout abandonment %) + scale context (8M monthly sessions). before/after 명확. "so what?" — 이탈율 50% 개선.
- A4: PASS — "Cut" (execution ownership) + mid-level + feature-level scope. Coherent.
- A5: PASS — Impact-first one-liner. 6초 내 outcome + mechanism + context 모두 포착. Signal density 극대. Structure-agnostic PASS의 대표.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: A5 structure-agnostic 검증 — v1에서 강제된 PSR 구조 없이도 impact-first one-liner가 A5 PASS 가능함을 확인. Frontend/product-engineering bullet이 backend bias 없이 5축 PASS 가능함도 검증.

---

### SCN-7: A3 vanity metric FAIL — no baseline

**Bullet**: "Achieved p99 200ms on API response times with 99.99% uptime across all production services"

**Candidate context**: { years: 6, position: "Senior Backend", target_company: "tech" }

**Expected verdicts**:
- A1: FAIL — "Achieved p99 200ms" — 어떤 mechanism으로 달성했는지 없음. Senior level에서 architectural rationale, named systems, constraint 없음. 성과 수치만 있고 깊이 없음.
- A2: PASS — Arithmetic 없고 수치 모순도 없음. Causal chain 자체가 없어서 A2 위반은 없음 (A3 문제로 귀속).
- A3: FAIL — Vanity metric. "p99 200ms", "99.99% uptime" 모두 절대 숫자만. before/after 없음. baseline 없음. p99 200ms가 5000ms에서 개선된 것인지 원래 그랬는지 불명. "so what?" 불가.
- A4: FAIL — "Achieved ... across all production services" — 동사(achieved)는 낮으나 scope("all production services")가 Senior 6년차 개인 기여로 비현실적. 팀 기여, 본인 ownership 범위 없음.
- A5: P1 — 짧고 숫자는 있으나 context 없어 scan으로 의미 파악 어려움. Signal density 낮음. FAIL까지는 아님 (숫자 자체는 포착 가능).

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: REQUEST_CHANGES (A1 + A3 + A4 FAIL)

**Purpose**: A3 vanity metric 감지 검증. 절대 숫자만 있고 before/after 없는 패턴이 A3 FAIL을 트리거함을 확인. Senior bullet에서 mechanism 없는 성과 나열이 A1도 FAIL임을 확인.

---

### SCN-8: Contributed + partial scope — Junior A4 PASS

**Bullet**: "Contributed N+1 query analysis to team's order-list performance effort (my part: query profiling + proposed batched JOIN pattern, team implemented). Result: p95 page load 2.1s → 380ms"

**Candidate context**: { years: 2, position: "Junior Backend", target_company: "commerce" }

**Expected verdicts**:
- A1: PASS — Named (N+1 query, batched JOIN). Junior에서 query pattern 명시 + 본인 결정 (proposed batched JOIN). 선배 결정이 아닌 proposal이나 Junior bar에서 mechanism 명시 + 참여 scope 명시는 PASS.
- A2: PASS — Cause (N+1 → batched JOIN으로 round-trip 감소) → effect (p95 2.1s→380ms). Causal chain 직접적. Arithmetic: 2100ms / 380ms ≈ 5.5x speedup, 명시 안 됐으나 수치 모순 없음.
- A3: PASS — Tech outcome (p95 page load). before/after 명확. 2.1s→380ms = 5x 이상 개선. "so what?" 명확.
- A4: PASS — "Contributed" + partial scope 명시 (my part: profiling + proposed pattern) + team context 명시 (team implemented). Clarity에 부합. Junior에서 "contributed + 자기 portion 명시"는 PASS 패턴.
- A5: PASS — 한 문장에 scope (my part), mechanism (N+1 → batched JOIN), result (p95 2.1s→380ms) scan 가능. Signal density 충분.

**Expected critical rules**:
- r_phys.triggered: false
- r_cross.triggered: N/A
- r_scope.triggered: false

**Expected final_verdict**: APPROVE

**Purpose**: "Contributed" verb + partial scope 명시가 Junior에서 A4 PASS임을 검증. SCN-5(led inflation)와 대비: "led 30-person" → A4 FAIL vs "contributed + 자기 portion 명시" → A4 PASS. Junior candidate도 올바른 ownership verb + scope 명시로 APPROVE 가능함을 확인.

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

## Axis Boundary Coverage

| Axis | PASS cases | FAIL cases | Boundary/P1 cases |
|------|-----------|-----------|-------------------|
| A1 | SCN-1, SCN-6, SCN-8 | SCN-3, SCN-4, SCN-7 | SCN-5 (P1) |
| A2 | SCN-1, SCN-5, SCN-6, SCN-7, SCN-8 | SCN-3, SCN-4 | — |
| A3 | SCN-1, SCN-6, SCN-8 | SCN-3, SCN-4, SCN-5, SCN-7 | — |
| A4 | SCN-1, SCN-2, SCN-3, SCN-6, SCN-8 | SCN-5, SCN-7 | — |
| A5 | SCN-1, SCN-5, SCN-6, SCN-8 | SCN-2, SCN-3, SCN-4 | SCN-7 (P1) |

## Critical Rule Coverage

| Rule | Triggered | Not triggered | N/A (no cross-entry) |
|------|-----------|--------------|----------------------|
| R-Phys | SCN-4 | SCN-1,2,3,5,6,7,8 | — |
| R-Cross | — | — | SCN-1,2,3,4,5,6,7,8 (단일 bullet 평가) |
| R-Scope | SCN-5 | SCN-1,2,3,4,6,7,8 | — |

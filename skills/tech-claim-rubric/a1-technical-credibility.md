# A1. Technical Credibility

## Standard

Absolute — 평가 기준은 경력 레벨과 무관. bullet 본문에 2개 이상의 signal이 드러나면 PASS.

## What We Look For

Bullet 본문에 다음 5개 signal 중 **2개 이상** 명시적으로 표출되면 PASS.

1. **Constraint awareness (제약 인식)** — 해결해야 할 technical constraint 명시 (throughput bottleneck, race condition, consistency gap, legacy coupling, cost ceiling 등)
2. **Technology selection (기술 선택)** — 특정 system/algorithm/pattern을 의식적으로 선택
3. **Mechanism (메커니즘)** — 선택한 기술이 어떻게 동작하는지 (partitioning key, memoization strategy, eviction policy, cutover path 등)
4. **Trade-off / risk (수용 비용)** — 수용한 비용·위험, 또는 기각된 대안의 탈락 사유
5. **Rationale (선택 이유)** — 맥락 기반 "왜 X가 아닌 Y"

## P1 Decision Rule

Signal 2+ 개 존재하지만 그 중 **하나 이상이 name-level에만 머물러 mechanism depth가 얕다**. 완전히 FAIL(공허)은 아니지만 Absolute PASS bar에 미달. examiner는 해당 signal을 구체화하라는 improvement hint 생성.

## PASS Exemplars

### PASS Exemplar 1 — backend latency optimization

Bullet: "Redesigned order event pipeline from synchronous REST to Kafka Streams partitioned by user_id to eliminate write hotspots; chose Kafka over Kinesis for in-house tooling compatibility (8M daily events, p99 800ms→120ms)"

Why PASS:
- Signal 1 (Constraint): write hotspot 제거
- Signal 2 (Technology): Kafka Streams 선택
- Signal 3 (Mechanism): partitioned by user_id
- Signal 4 (Trade-off/rejection): Kafka over Kinesis
- Signal 5 (Rationale): in-house tooling compatibility
→ 5/5 signal PASS

### PASS Exemplar 2 — DB migration

Bullet: "Migrated user session store from in-memory dict to Redis with TTL eviction + LRU fallback, accepting ~5ms added latency for multi-instance consistency (40% horizontal scaling enabled)"

Why PASS:
- Signal 1 (Constraint): multi-instance consistency 확보 필요
- Signal 2 (Technology): Redis 선택
- Signal 3 (Mechanism): TTL eviction + LRU fallback
- Signal 4 (Trade-off/risk): ~5ms latency 수용
- Signal 5 (Rationale): horizontal scaling 가능성
→ 5/5 signal PASS

### PASS Exemplar 3 — payment idempotency

Candidate context: 팀의 order service 기여.

Bullet: "Contributed payment idempotency key handler in 팀의 order service; chose DynamoDB conditional writes (vs Redis SETNX) — 영속성 보장과 operations overhead 균형으로 판단. 중복 결제 incident 주당 3건→0건"

Why PASS:
- Signal 2 (Technology): DynamoDB conditional writes 선택
- Signal 3 (Mechanism): conditional writes로 idempotency key handler 구현
- Signal 4 (Trade-off/rejection): Redis SETNX 기각
- Signal 5 (Rationale): 영속성 보장과 operations overhead 균형
→ 4/5 signal PASS

### PASS Exemplar 4 — Frontend rendering optimization

Candidate context: Frontend engineer.

Bullet: "Rewrote React reconciliation strategy to reduce re-render cascades in checkout flow, used memoization + selector-level equality to drop wasted renders from 1200/min to 140/min; measured via Performance Observer"

Why PASS:
- Signal 1 (Constraint): re-render cascades 제거
- Signal 2 (Technology): React reconciliation strategy 재작성
- Signal 3 (Mechanism): memoization + selector-level equality, Performance Observer 계측
- Signal 5 (Rationale): wasted renders 제거 목적 (1200/min → 140/min)
→ 4/5 signal PASS

### PASS Exemplar 5 — Infra cluster upgrade

Candidate context: Platform engineer.

Bullet: "Designed multi-AZ Kubernetes upgrade runbook leveraging PodDisruptionBudget + surge replicas; rolled 30-node cluster through minor version bumps with 0 user-facing 503"

Why PASS:
- Signal 1 (Constraint): 업그레이드 중 user-facing 503 방지
- Signal 2 (Technology): PodDisruptionBudget + surge replicas 선택
- Signal 3 (Mechanism): multi-AZ runbook으로 30-node cluster 순차 롤링
- Signal 4 (Trade-off/risk): 가용성 vs 업그레이드 속도 균형 수용
→ 4/5 signal PASS

## FAIL Exemplars

### FAIL Exemplar 1 — Surface-level mention (any level)

Bullet: "Used React, TypeScript, and Next.js to build web application"

Why FAIL:
- Signal 1 (Constraint) 부재: 어떤 기술적 문제를 푸는지 없음
- Signal 2 (Technology): React/TypeScript/Next.js 이름만 나열, 선택 이유 없음
- Signal 3 (Mechanism) 부재: 어떻게 동작하는지 없음
- Signal 4 (Trade-off) 부재: 비교/대안 없음
- Signal 5 (Rationale) 부재: 근거 없음
- 0 signal depth → FAIL

### FAIL Exemplar 2 — Generic verb + tech name

Bullet: "Led backend team to build microservices with Spring Boot and Kafka for scalability"

Why FAIL:
- "scalability" 언급하나 Signal 1 (Constraint) 구체 내용 없음
- Signal 2 (Technology) 이름만 있고 Signal 3/4/5 전무 — 어떤 서비스를 어떻게 분리했는지, Kafka를 왜 선택했는지, 어떤 trade-off를 수용했는지 없음
- Signal 1개 수준으로 FAIL
→ FAIL

### FAIL Exemplar 3 — Tech name parade without depth

Bullet: "Experience with AWS (EC2, S3, RDS, Lambda, CloudFront, Route53, CloudWatch), Docker, Kubernetes, Terraform, Jenkins, GitLab CI"

Why FAIL:
- Signal 0개 충족 (tech name parade, 어떤 문제에 어떤 기술을 적용했는지 전혀 없음)
- Signal 2 (Technology)에 해당하는 이름들은 나열되나 Signal 1/3/4/5 완전 부재 — 기여 범위, 결정 근거, 설계 판단 없음
→ FAIL

### FAIL Exemplar 4 — Terminology without mechanism

Bullet: "Optimized database query performance by implementing advanced indexing strategies"

Why FAIL:
- Signal 2/3 수준 어휘("advanced indexing")가 등장하나 실제 mechanism 없음 — composite/functional/partial index 중 무엇인지, 어떤 쿼리 패턴에 적용했는지 없음
- Signal 1/4/5 부재. "Optimized" + "advanced" 조합은 depth를 암시하나 mechanism을 대체하지 못함
→ FAIL

### FAIL Exemplar 5 — Feature-framed mechanism hiding

Bullet: "Developed mobile-first checkout flow with multi-step form validation and seamless payment experience across devices"

Why FAIL:
- Signal 0개 충족 (feature 명사구로 mechanism을 가장하는 패턴)
- "checkout flow", "multi-step form", "payment"은 feature 명사구로 구체성의 착시를 만들지만 Signal 3 (Mechanism) 없음 — state 관리 선택, validation 전략, payment SDK 통합 방식 전무
- "seamless", "mobile-first"는 qualitative adjective로 Signal 5 (Rationale)를 대체하지 못함
→ FAIL

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Kafka adoption with thin partitioning rationale
- Candidate context: async event processing 담당.
- Bullet: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s)"
- Reasoning: Signal 2 (Kafka, consumer group)와 Signal 3 (partitioning)은 언급되나 partition key 선택 근거, rebalancing/DLQ 처리, at-least-once semantics 등 mechanism depth 부재. Signal 4/5 부재. 2 signal 존재하지만 name-level에 머물러 P1.

### P1 Exemplar 2 — FAIL boundary: CQRS label with no trade-off
- Candidate context: dashboard 성능 개선 담당.
- Bullet: "Introduced CQRS with separate read/write models to improve dashboard read performance"
- Reasoning: Signal 2 (CQRS)와 Signal 3 (read/write model 분리)이 pattern name 수준으로만 언급. eventual consistency handling, projection rebuild, when-NOT-to-use 근거 등 mechanism depth 완전 부재. 2 signal 존재하지만 둘 다 label-level — P1.

## Boundary Cases

### EDGE 1 — Named but trivial

"Used jQuery to validate forms"

- jQuery는 named지만 mechanism/rationale/trade-off 부재
- Signal 2 (Technology) 1개만 충족, Signal 1/3/4/5 없음 → **P1 또는 FAIL** (권장: P1, boundary 표시)

### EDGE 2 — Deep but unnamed

"Implemented custom consistent hashing with virtual nodes for even distribution"

- 구체적 mechanism 설명 (consistent hashing + virtual nodes + distribution 목적)
- Signal 3 (Mechanism) + Signal 5 (Rationale) 2개 충족 → PASS
- 명시된 system name 없어도 mechanism + rationale 2 signal 충족으로 판정

## Evaluator Guidance

1. **Extract claim**: bullet에서 기술 동사 + 대상 system 식별
2. **Count signals**: 5개 signal 중 몇 개가 bullet 본문에 명시되는지 집계
3. **Check depth**: signal이 name-level인지 mechanism depth까지 드러나는지 판정
4. **Verdict**: PASS (signal 2+ 개, depth 충분) | P1 (signal 2+ 개이나 depth 얕음) | FAIL (signal 0-1개 또는 전적 depth 부재)
5. **Evidence quote**: bullet에서 해당 signal 문구 직접 인용

## Common Evaluation Pitfalls

- **기술 유행 편향**: 최신 tech 사용 = 깊이 있음 (X). old-school stack도 rationale 있으면 PASS
- **Ownership vs A1 혼동**: "led/drove/coordinated/managed" 같은 leadership verb는 A4 영역. A1은 기술적 판단만 본다.
- **bullet에 없는 정보 추론**: evidence_quote는 bullet 본문에서만. 직함이나 회사명으로 depth 추론 금지
- **Verdict-first reasoning**: 결론 먼저 정한 뒤 증거 끼워 맞추기 금지. reasoning → evidence_quote → verdict 순서 필수

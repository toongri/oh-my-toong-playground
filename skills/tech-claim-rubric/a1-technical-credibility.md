# A1. Technical Credibility

## Standard

Calibrated — 평가 기준은 경력 레벨(junior / mid / senior)별로 calibrated. Junior에게 senior 수준의 architectural rationale을 요구하지 않고, Senior에게 surface-level 설명은 불충분.

## What We Look For

- **Named systems/mechanisms**: 구체적 시스템 이름 (예: "Kafka Streams", "PostgreSQL logical replication")
- **Design rationale**: 왜 그 선택을 했는가 (trade-off, constraint, context)
- **Level-appropriate depth**: 경력에 맞는 abstraction 수준

## Career Level Calibration

| Level | Years | PASS bar |
|-------|-------|----------|
| Junior | 0-2 yr | 시스템 이름 + 참여한 부분 명시. rationale은 팀/선배 결정 인용도 OK. at least one alternative or limitation 인식 |
| Mid | 3-5 yr | 시스템 이름 + 자기 결정 논리 + trade-off 인식. constraint-based reasoning, independent judgment visible |
| Senior | 6+ yr | Named systems + architectural rationale + constraint/scale context 포함. org-level tradeoffs, team impact, or multi-system consequences visible |

A senior bullet evaluated at junior bar automatically fails A1 — upward calibration is not available to candidates.

## PASS Exemplars

### PASS Exemplar 1 — Senior, backend latency optimization

Bullet: "Redesigned order event pipeline from synchronous REST to Kafka Streams partitioned by user_id to eliminate write hotspots; chose Kafka over Kinesis for in-house tooling compatibility (8M daily events, p99 800ms→120ms)"

Why PASS:
- Named: Kafka Streams, REST, Kinesis
- Design rationale: partitioning key 선택 이유 (write hotspot 제거), Kafka 선택 이유 (in-house tooling compatibility)
- Senior level depth: multi-system comparison, scale context (8M daily events), concrete constraint articulated

### PASS Exemplar 2 — Mid, DB migration

Bullet: "Migrated user session store from in-memory dict to Redis with TTL eviction + LRU fallback, accepting ~5ms added latency for multi-instance consistency (40% horizontal scaling enabled)"

Why PASS:
- Named: Redis, LRU
- Trade-off 인식: latency vs consistency — mid-level에서 기대되는 deliberate selection
- Independent judgment visible: 선택 이유와 결과 모두 본인 reasoning으로 서술

### PASS Exemplar 3 — Junior, contributing to a system

Bullet: "Contributed payment idempotency key handler in 팀의 order service; implemented DynamoDB conditional writes per 선배 기술 리뷰 후 피드백 반영"

Why PASS:
- Junior level에서 named (DynamoDB, conditional writes) + 참여 scope 명시
- 기술 결정 과정 (선배 리뷰) 인용 — junior bar에서 팀/선배 결정 인용은 PASS 조건에 명시적으로 포함

## FAIL Exemplars

### FAIL Exemplar 1 — Surface-level mention (any level)

Bullet: "Used React, TypeScript, and Next.js to build web application"

Why FAIL:
- 기술명만 나열. 설계 판단, 선택 이유, 기여 범위 없음
- 어떤 문제를 해결했는지, 왜 이 스택을 선택했는지 전혀 없음
- 모든 레벨에서 FAIL — named systems는 있으나 rationale, mechanism, trade-off 전무

### FAIL Exemplar 2 — Senior with junior-level depth

Bullet: "Led backend team to build microservices with Spring Boot and Kafka for scalability"

Why FAIL (Senior 기준):
- "scalability" 언급하나 concrete mechanism/trade-off 없음
- Senior 수준에서 기대되는 architectural rationale 부재: 어떤 서비스를 어떻게 분리했는지, Kafka를 왜 선택했는지, 어떤 trade-off를 수용했는지 없음
- Junior bar였다면 P1 논의 가능하나, Senior 경력 기재 시 FAIL

### FAIL Exemplar 3 — Tech name parade without depth

Bullet: "Experience with AWS (EC2, S3, RDS, Lambda, CloudFront, Route53, CloudWatch), Docker, Kubernetes, Terraform, Jenkins, GitLab CI"

Why FAIL:
- Tech name parade. 어떤 문제에 어떤 기술을 적용했는지 전혀 없음
- Named systems는 다수지만 mechanism, trade-off, rationale 완전 부재
- 기여 범위, 결정 근거, 설계 판단 없음 — 모든 레벨에서 FAIL

## Boundary Cases

### EDGE 1 — Named but trivial

"Used jQuery to validate forms"

- jQuery는 named지만 mid-level 이상에서는 depth 없음
- Junior에게는 PASS 가능 (named + 참여 scope 명시). Mid 이상에서는 FAIL — deliberate selection 근거 없음
- Calibration 적용 필수

### EDGE 2 — Deep but unnamed

"Implemented custom consistent hashing with virtual nodes for even distribution"

- 구체적 mechanism 설명 (consistent hashing + virtual nodes + distribution 목적)
- 명시된 system name 없어도 PASS 가능 — mechanism = system으로 간주. 설계 판단이 bullet 본문에서 명확히 드러남
- Senior 수준이라면 "even distribution"이 충분한 rationale인지 재검토 필요 — scale, org-level context 추가 시 더 강한 bullet

## Evaluator Guidance

1. **Extract claim**: bullet에서 기술 관련 동사 + 대상 system 식별
2. **Calibrate by years**: `candidate_context.years`로 Junior / Mid / Senior bar 결정
3. **Check depth**: named? rationale? trade-off 인식?
4. **Verdict**: PASS | FAIL | P1 (부분적으로 충족 시)
5. **Evidence quote**: bullet의 해당 문구 직접 인용 — bullet 본문 외부 정보 추론 금지

## Common Evaluation Pitfalls

- **기술 유행 편향**: 최신 tech 사용 = 깊이 있음 (X). old-school stack도 rationale 있으면 PASS
- **Senior만 strict하게 평가**: junior에게도 완전 senior PASS bar 요구 (X). Calibration 적용
- **bullet에 없는 정보 추론**: evidence_quote는 bullet 본문에서만. 직함이나 회사명으로 depth 추론 금지
- **Verdict-first reasoning**: 결론 먼저 정한 뒤 증거 끼워 맞추기 금지. reasoning → evidence_quote → verdict 순서 필수

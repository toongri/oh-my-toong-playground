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
| Junior | 0-2 yr | 시스템 이름 + 참여한 부분 명시 + 본인 관점의 이유(무엇을 왜 썼는지) 간단 서술. at least one alternative or limitation 인식 |
| Mid | 3-5 yr | 시스템 이름 + 자기 결정 논리 + trade-off 인식. constraint-based reasoning, independent judgment visible |
| Senior | 6+ yr | Named systems + architectural rationale + constraint/scale context 포함. multi-system consequences or long-term maintenance implications visible |

A senior bullet evaluated at junior bar automatically fails A1 — upward calibration is not available to candidates.

## P1 Decision Rule

**A1 P1 rule**: "Mechanism named but depth insufficient for calibrated level."

기술·메커니즘이 언급되었으나 해당 YoE bar에서 기대되는 depth에 미치지 못하는 중간 case. Senior bullet의 mechanism 단순 언급(architectural rationale / multi-system consequences 부재)은 FAIL 3/4와 달리 완전히 공허하지 않으므로 FAIL보다 P1에 가깝다. 같은 bullet이 Junior bar에서는 PASS일 수 있으며, 이는 A1 upward-calibration invariant에 부합한다.

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

Bullet: "Contributed payment idempotency key handler in 팀의 order service; chose DynamoDB conditional writes (vs Redis SETNX) — 영속성 보장과 operations overhead 균형으로 판단. 중복 결제 incident 주당 3건→0건"

Why PASS:
- Junior level에서 named (DynamoDB, conditional writes, Redis SETNX) + 참여 scope 명시
- 본인 관점의 rationale (영속성 vs ops overhead) + 대안(Redis SETNX) 1건 명시적 언급
- 결과 quantification (3건→0건) — 새 Junior bar "본인 관점 이유 + 대안/한계 인식" 조건 충족

### PASS Exemplar 4 — Senior, Frontend rendering optimization

Candidate context: Senior frontend engineer, 6 years.

Bullet: "Rewrote React reconciliation strategy to reduce re-render cascades in checkout flow, used memoization + selector-level equality to drop wasted renders from 1200/min to 140/min; measured via Performance Observer"

Why PASS:
- Named: React, Performance Observer
- Specific mechanisms: reconciliation strategy, memoization, selector-level equality — 무엇을 했는지 메커니즘 수준에서 명시
- Quantified baseline/post: 1200/min → 140/min, measured via 구체 도구
- Senior level depth: rendering pipeline 내부 동작 이해 + instrumentation 방법까지 포함. 6+ yr 전제의 architectural depth 부합

### PASS Exemplar 5 — Mid, Infra cluster upgrade

Candidate context: Platform engineer, 4 years.

Bullet: "Designed multi-AZ Kubernetes upgrade runbook leveraging PodDisruptionBudget + surge replicas; rolled 30-node cluster through minor version bumps with 0 user-facing 503"

Why PASS:
- Named: Kubernetes, PodDisruptionBudget
- Specific mechanisms: PodDisruptionBudget + surge replicas — availability 보장을 위한 구체 도구 선택
- Quantified scope: 30-node cluster, 0 user-facing 503 — 검증 가능한 결과 지표
- Mid level depth: 자기 결정 논리(runbook 설계)와 trade-off 인식(가용성 vs 업그레이드 속도). 3-5yr 전제와 부합

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

### FAIL Exemplar 4 — Terminology without mechanism

Bullet: "Optimized database query performance by implementing advanced indexing strategies"

Why FAIL:
- "advanced indexing strategies"는 lexical signal만 있고 구체 내용 부재 — composite index / functional index / partial index 중 무엇인지, 어떤 쿼리 패턴에 적용했는지 없음
- "Optimized" + "advanced" 조합은 depth를 암시하지만 mechanism을 대체하지 못함
- 기존 FAIL 패턴(surface-level name, name parade)과 달리 용어는 기술적으로 들리나 실제 설계 판단 없음 — 모든 레벨에서 FAIL

### FAIL Exemplar 5 — Feature-framed mechanism hiding

Bullet: "Developed mobile-first checkout flow with multi-step form validation and seamless payment experience across devices"

Why FAIL:
- "checkout flow", "multi-step form", "payment"은 feature 명사구로 구체성의 착시를 만들지만 mechanism 없음 — state 관리 선택(Context/Redux/Zustand/URL), validation 전략(schema-based/field-level/server round-trip), step 간 persistence 방식(sessionStorage/server draft), payment SDK 통합 방식(iframe/hosted/tokenized) 전무
- "seamless", "mobile-first"는 qualitative adjective로 실제 설계 판단을 대체하지 못함 — 어떤 breakpoint/touch target/virtual keyboard 대응을 했는지 기술되지 않음
- 기존 FAIL 1(스택 나열)·FAIL 4(추상 전문 용어)와 달리 feature 명사구로 mechanism을 가장하는 패턴 — 모든 레벨에서 FAIL, named systems 부재 + trade-off 부재 + 결정 근거 부재

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Senior Kafka adoption with scale but thin partitioning rationale
- Candidate context: Senior, 7 years.
- Bullet: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s)"
- Reasoning: A1 P1 rule is "Mechanism named but depth insufficient for calibrated level." Named (Kafka, consumer group, partitioning) + quantified scale (4M daily events) + measurable result (backlog p95 8min→45s) — mechanism-plus-scale lifts it above a name-drop. Senior-7yr calibration expects partition-key rationale, rebalancing/DLQ handling, at-least-once semantics discussion — none given. Depth is marginal for level, but the named mechanism and concrete numbers keep it on the PASS side of the P1 line.

### P1 Exemplar 2 — FAIL boundary: Senior CQRS label with no trade-off
- Candidate context: Senior, 8 years.
- Bullet: "Introduced CQRS with separate read/write models to improve dashboard read performance"
- Reasoning: A1 P1 rule is "Mechanism named but depth insufficient for calibrated level." Named (CQRS, read/write model split) — not zero depth, since it is a real pattern name, so does not fall to outright FAIL. Senior-8yr calibration expects eventual-consistency handling, projection rebuild strategy, when-NOT-to-use reasoning, event store choice. Zero of these are present; only the label + generic goal. The gap against the Senior bar is wide enough that this sits on the FAIL side of the P1 boundary.

## Calibration Contrast

### Calibration Contrast 1 — Redis 분산 락 선택 근거

**Bullet**: "Implemented distributed lock using Redis SETNX to prevent duplicate order processing in 팀의 checkout service; followed 시니어 권고로 Redlock 대신 단일 인스턴스 lease lock 선택"

- **[Junior, 1yr]**: PASS — Named: Redis, SETNX, Redlock, lease lock. 참여 범위(팀의 checkout service)가 명시되어 있고 대안(Redlock)도 1개 언급됨. rationale이 "시니어 권고" 인용에 기대지만 Junior bar는 "팀/선배 결정 인용도 OK"라고 명시적으로 허용하므로 충족.
- **[Mid, 4yr]**: P1 — Mid bar는 "자기 결정 논리 + independent judgment visible"을 요구한다. bullet의 선택 근거가 시니어 권고 인용에 전적으로 의존하고 있고, 단일 인스턴스 lease를 수용한 자기 판단 근거(주문량/락 경합 확률/Redlock 운영 비용 등 constraint-based reasoning)가 노출되지 않아 Mid bar 미달.
- **[Senior, 7yr]**: FAIL — Senior bar는 "architectural rationale + constraint/scale context + multi-system consequences"를 요구한다. 타인 권위에 외주화된 rationale, 동시 checkout 수/락 홀딩 시간 등 scale context 부재, 장애 시 stale lock 처리와 TTL 전략 등 long-term maintenance 함의 전면 누락 — Senior bar의 어떤 축도 충족하지 않음.

### Calibration Contrast 2 — 데이터 웨어하우스 incremental load 전환

**Bullet**: "Changed the billing warehouse load from daily full refresh to BigQuery `MERGE` on `invoice_id` + `updated_at`, cutting runtime from 3h to 26m; kept a weekly backfill because late ERP corrections still missed the change stream."

- **[Junior, 2yr]**: PASS — Named: BigQuery, MERGE, change stream. 참여 범위(billing warehouse load)가 구체적이고, 정량적 개선(3h→26m)과 한계(late ERP corrections)가 명시되어 있어 Junior bar의 "시스템 이름 + 참여 부분 + at least one limitation" 요건을 모두 충족.
- **[Mid, 4yr]**: PASS — Mid bar의 "자기 결정 논리 + trade-off 인식"을 만족한다. incremental MERGE 선택과 주간 backfill 병행이 correctness vs. latency 축에서의 의도적 trade-off로 읽히며, merge key(`invoice_id` + `updated_at`) 선택도 독립 판단으로 제시됨.
- **[Senior, 7yr]**: P1 — Senior bar는 "scale/constraint context + multi-system consequences + long-term maintenance"를 요구한다. 테이블 볼륨/일일 변경 비율 등 scale signal, 하류 BI/회계 소비자에 대한 SLA 영향, cost model, governance 관점의 의사결정 근거가 부재 — mechanism은 풍부하나 architectural 층위의 rationale이 얕음.

### Calibration Contrast 3 — 이미지 프리로드 범위 조정

**Bullet**: "Moved category page image preloading from a page-level `useEffect` to component-level `IntersectionObserver` loading, reducing initial scripting by 32%; kept the first hero image eager because LCP regressed when everything was lazy."

- **[Junior, 1yr]**: PASS — Named: `useEffect`, `IntersectionObserver`, LCP. 참여 범위(category page image preloading)가 명확하고, 전면 lazy 시 LCP regression이라는 한계를 직접 관찰·수용한 부분이 Junior bar의 "at least one limitation 인식" 요건을 초과 충족.
- **[Mid, 4yr]**: PASS — Mid bar의 "independent judgment visible + trade-off awareness"를 달성. 일괄 lazy loading이 아닌 "첫 hero는 eager, 나머지는 observer 기반" 분기 판단이 LCP vs. scripting cost 축에서의 constraint-based reasoning으로 기능하며, 관찰된 regression에서 역으로 정책을 조정한 점이 자기 결정 논리를 보여줌.
- **[Senior, 7yr]**: P1 — Senior bar는 "architectural rationale + multi-system consequences + long-term maintenance"를 요구한다. 한 페이지 한정 최적화에 머물러 있어 다른 리스트/상세 페이지로의 확장 전략, 라우트 전반의 preload budget, image CDN·네트워크 계층과의 상호작용, regression 방지 체계(budget enforcement, CI 측정)에 대한 구조적 논거가 부재 — Senior 층위의 multi-system scope 미흡.

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

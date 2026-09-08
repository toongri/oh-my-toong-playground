# A1. Technical Credibility

## Standard

Absolute — the evaluation standard is independent of experience level. **ALL 5 of 5 signals** must be visible in the bullet body for PASS. This standard follows directly from the SKILL.md Purpose ("Guarantee follow-up hooks from five interviewer perspectives") — if even one signal is missing, the interviewer cannot generate a follow-up from that perspective.

## What We Look For

The bullet body must explicitly express **all five signals** below for PASS. If any one is missing, PASS is not possible.

1. **Constraint awareness** — state the technical constraint to solve (throughput bottleneck, race condition, consistency gap, legacy coupling, cost ceiling, etc.)
2. **Technology selection** — deliberately choose a specific system/algorithm/pattern
3. **Mechanism** — how the chosen technology works (partitioning key, memoization strategy, eviction policy, cutover path, etc.)
4. **Trade-off / risk** — the accepted cost or risk, or the reason a rejected alternative was eliminated
5. **Rationale** — context-based "why Y rather than X"

## P1 Decision Rule

The canonical definition of the P1 boundary follows **SKILL.md §A1 Evaluation Criteria** — that section is the sole definition source; this file does not duplicate it.

Summary (for reference; may become outdated when SKILL.md changes):
- **4 of 5 signals** are present but one is missing
- **5 of 5 signals** are present but at least one remains at name-level, with shallow mechanism depth

Both fall short of the ALL 5 of 5 Absolute PASS bar. The examiner generates an improvement hint asking for specifics on the missing or shallow signal.

## PASS Exemplars

### PASS Exemplar 1 — Frontend perf (F-1)

Candidate context: Frontend engineer, e-commerce 서비스 담당.

Bullet: "모바일 LCP 3.2초 초과라는 FCP 예산 제약 조건을 해결하기 위해 CSR·SSR·ISR 세 가지 렌더링 전략을 비교·검토한 후 ISR을 선택했다. ISR의 동작 원리는 빌드 타임에 정적 HTML을 생성하고 revalidate 주기마다 백그라운드에서 재생성하는 방식으로, 요청마다 서버 렌더링하는 SSR 대비 TTFB를 40% 단축했다. 트레이드오프로 콘텐츠 최신성 대신 DX와 런타임 비용을 택했으며, 이 판단의 근거는 타겟 사용자의 80%가 3G 이하 네트워크를 사용하는 동남아 시장 디바이스 프로파일이었다. 팀 내 프론트엔드 컴포넌트 일부를 주도적으로 적용하여 LCP p95를 3.2초에서 1.8초로 개선했고, 6개월간 전환율 12% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): FCP budget constraint with mobile LCP exceeding 3.2 seconds
- Signal 2 (Technology selection): ISR selected and adopted after comparing CSR, SSR, and ISR
- Signal 3 (Mechanism): Build-time static HTML generation + background regeneration on revalidate
- Signal 4 (Trade-off): Content freshness vs DX and runtime cost
- Signal 5 (Rationale): Southeast Asian device profile showing 80% of target users on 3G or slower networks
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `3.2초`, `40%`, `p95`, `6개월`
A3 marker: `LCP p95를 3.2초에서 1.8초로 개선`, `전환율 12% 증가를 달성`
A4 marker: `팀 내 프론트엔드 컴포넌트 일부를 주도적으로 적용`

### PASS Exemplar 2 — ML platform (F-2)

Candidate context: ML platform engineer, 추천 시스템 담당.

Bullet: "온라인 서빙 p99 지연시간 200ms 초과라는 모델 서빙 제약 조건을 해결하기 위해 TensorFlow Serving·TorchServe·Triton Inference Server 세 프레임워크를 벤치마킹하여 Triton을 선택·채택했다. Triton의 동작 원리는 dynamic batching으로 동일 모델에 대한 요청을 묶어 GPU 처리량을 극대화하는 방식이며, 배치·스트림 처리를 모두 지원해 비실시간 추론 파이프라인과 통합이 가능했다. 트레이드오프로 TorchServe 대비 운영 복잡도를 수용하는 대신 레이턴시 절감을 선택했으며, 이 판단의 근거는 추천 클릭률 1% 향상이 월 매출 2억 원에 직결되는 제품 KPI였다. 공동으로 서빙 모듈을 개발하여 p99 지연시간을 220ms에서 85ms로 단축했고, 3개월 내 추천 클릭률 3.2% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): Online serving p99 latency exceeding 200ms
- Signal 2 (Technology selection): Triton selected and adopted after comparing TensorFlow Serving, TorchServe, and Triton
- Signal 3 (Mechanism): Dynamic batching maximizes GPU throughput
- Signal 4 (Trade-off): Operational complexity relative to TorchServe vs reduced latency
- Signal 5 (Rationale): Product KPI linking a 1% recommendation click-through improvement to ₩200M in monthly revenue
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `200ms`, `220ms`, `85ms`, `3개월`, `2억 원`
A3 marker: `p99 지연시간을 220ms에서 85ms로 단축`, `추천 클릭률 3.2% 증가를 달성`
A4 marker: `공동으로 서빙 모듈을 개발`

### PASS Exemplar 3 — SRE incident (F-3)

Candidate context: SRE, 결제 서비스 온콜 담당.

Bullet: "결제 서비스 장애 MTTR 45분 초과라는 인시던트 대응 제약 조건을 해결하기 위해 Datadog·Grafana·Prometheus 세 모니터링 툴링을 평가하여 Datadog APM을 선택·채택했다. Datadog APM의 동작 원리는 분산 트레이스를 자동 수집하고 span 간 상관관계 분석으로 근본 원인을 자동 제안하는 메커니즘이며, 로그·메트릭·트레이스를 단일 뷰에서 연계해 상관관계 분석 시간을 줄였다. 트레이드오프로 Grafana+Prometheus 대비 월 120만 원 비용을 수용하는 대신 알람 노이즈 감소와 커버리지 향상을 택했으며, 이 판단의 근거는 직전 분기 포스트모템에서 MTTR의 70%가 원인 특정 단계에서 소요된다는 교훈이었다. 팀 내 SRE 모니터링 구성 일부를 주도하여 MTTR을 45분에서 12분으로 단축했고, 반기 내 장애 재발률 60% 감소를 달성했다."

Why PASS:
- Signal 1 (Constraint): Payment-service incident MTTR exceeding 45 minutes
- Signal 2 (Technology selection): Datadog APM selected and adopted after comparing Datadog, Grafana, and Prometheus
- Signal 3 (Mechanism): Automatic distributed-trace collection + correlation analysis across spans
- Signal 4 (Trade-off): ₩1.2M monthly cost vs reduced alert noise and improved coverage
- Signal 5 (Rationale): Postmortem lesson that cause identification consumed 70% of MTTR
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `45분`, `120만 원`, `70%`, `반기`
A3 marker: `MTTR을 45분에서 12분으로 단축`, `장애 재발률 60% 감소를 달성`
A4 marker: `팀 내 SRE 모니터링 구성 일부를 주도`

### PASS Exemplar 4 — Backend distributed system (F-4)

Candidate context: 백엔드 엔지니어, 주문 서비스 담당.

Bullet: "분산 주문 시스템의 강한 일관성 요구사항이라는 consistency 제약 조건을 해결하기 위해 CAP 이론 축에서 CP 특성을 갖는 etcd 기반 Raft 합의 프로토콜을 선택·채택했다. Raft 합의 프로토콜의 동작 원리는 leader election과 log replication을 통해 과반 노드 응답 시에만 커밋하는 메커니즘으로, Split-brain 시나리오에서도 데이터 손실 없이 일관성을 보장한다. 트레이드오프로 AP 시스템 대비 파티션 발생 시 가용성을 희생하고 레이턴시 p99 15ms를 수용했으며, 이 판단의 근거는 읽기·쓰기 비율이 1:9로 쓰기 집중적이며 중복 주문 발생 시 비용이 가용성 저하보다 크다는 비즈니스 요구사항이었다. 함께 합의 모듈 컴포넌트를 구현하여 중복 주문 발생률을 0.3%에서 0%로 개선했고, 2분기 내 주문 처리 정확도 99.99% 확보를 달성했다."

Why PASS:
- Signal 1 (Constraint): Strong-consistency requirement for a distributed order system
- Signal 2 (Technology selection): Selection and adoption of etcd-based Raft consensus with CP characteristics under CAP
- Signal 3 (Mechanism): Leader election + log replication, committing only after responses from a majority of nodes
- Signal 4 (Trade-off): Sacrificed availability during partitions relative to AP + p99 latency of 15ms
- Signal 5 (Rationale): Business context of write-heavy 1:9 reads/writes and duplicate-order cost exceeding the cost of reduced availability
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `0.3%`, `15ms`, `p99`, `2분기`
A3 marker: `중복 주문 발생률을 0.3%에서 0%로 개선`, `주문 처리 정확도 99.99% 확보를 달성`
A4 marker: `함께 합의 모듈 컴포넌트를 구현`

### PASS Exemplar 5 — Mobile platform (F-5)

Candidate context: 모바일 엔지니어, iOS·Android 공통 앱 담당.

Bullet: "배터리·메모리 제약이 큰 저사양 디바이스에서 앱 크래시율 5% 초과라는 battery·memory 제약 조건을 해결하기 위해 네이티브(Swift/Kotlin)·React Native·Flutter 세 플랫폼 선택지를 평가하여 Flutter를 선택·채택했다. Flutter의 렌더링 메커니즘은 자체 Skia 엔진으로 위젯 트리를 직접 GPU에 그리는 방식으로, WebView 기반 크로스플랫폼 대비 메모리 복사 오버헤드를 제거했다. 트레이드오프로 네이티브 API 직접 접근 대비 TTI가 120ms 더 느려지고 번들 크기가 8MB 증가하는 비용을 수용했으며, 이 판단의 근거는 타겟 디바이스 매트릭스의 60%가 2GB RAM 이하 기기라는 실제 기기 분포 데이터였다. 개인 기여로 렌더링 모듈 일부를 최적화하여 앱 크래시율을 5.1%에서 0.8%로 개선했고, 1분기 내 DAU 18% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): App crash rate exceeding 5% under battery and memory constraints on low-end devices
- Signal 2 (Technology selection): Flutter selected and adopted after comparing native, React Native, and Flutter
- Signal 3 (Mechanism): Skia renders the widget tree directly on the GPU
- Signal 4 (Trade-off): 120ms slower TTI + 8MB larger bundle vs memory savings
- Signal 5 (Rationale): Device-distribution evidence that 60% of the target device matrix has 2GB RAM or less
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `5%`, `120ms`, `8MB`, `2GB`, `1분기`
A3 marker: `앱 크래시율을 5.1%에서 0.8%로 개선`, `DAU 18% 증가를 달성`
A4 marker: `개인 기여로 렌더링 모듈 일부를 최적화`

## FAIL Exemplars

### FAIL Exemplar 1 — Surface-level mention (any level)

Bullet: "Used React, TypeScript, and Next.js to build web application"

Why FAIL:
- Signal 1 (Constraint) absent: No technical problem being solved
- Signal 2 (Technology selection): Only React/TypeScript/Next.js names listed, with no selection reason
- Signal 3 (Mechanism) absent: No explanation of how it works
- Signal 4 (Trade-off) absent: No comparison or alternatives
- Signal 5 (Rationale) absent: No supporting rationale
- 0 signal depth → FAIL

### FAIL Exemplar 2 — Generic verb + tech name

Bullet: "Led backend team to build microservices with Spring Boot and Kafka for scalability"

Why FAIL:
- Mentions "scalability" but provides no concrete Signal 1 (Constraint)
- Signal 2 (Technology selection) names only; Signals 3/4/5 entirely absent — no explanation of which services were separated or how, why Kafka was chosen, or what trade-off was accepted
- Only about 1 signal, therefore FAIL
→ FAIL

### FAIL Exemplar 3 — Tech name parade without depth

Bullet: "Experience with AWS (EC2, S3, RDS, Lambda, CloudFront, Route53, CloudWatch), Docker, Kubernetes, Terraform, Jenkins, GitLab CI"

Why FAIL:
- 0 signals met (a parade of tech names with no indication of which technology addressed which problem)
- Names corresponding to Signal 2 (Technology selection) are listed, but Signals 1/3/4/5 are entirely absent — no contribution scope, decision rationale, or design judgment
→ FAIL

### FAIL Exemplar 4 — Terminology without mechanism

Bullet: "Optimized database query performance by implementing advanced indexing strategies"

Why FAIL:
- Signal 2/3 vocabulary ("advanced indexing") appears, but no actual mechanism — no identification of composite/functional/partial indexes or the query patterns they addressed
- Signals 1/4/5 absent. "Optimized" + "advanced" suggests depth but cannot replace a mechanism
→ FAIL

### FAIL Exemplar 5 — Feature-framed mechanism hiding

Bullet: "Developed mobile-first checkout flow with multi-step form validation and seamless payment experience across devices"

Why FAIL:
- 0 signals met (feature noun phrases masquerading as mechanisms)
- "checkout flow", "multi-step form", and "payment" are feature noun phrases that create an illusion of specificity, but Signal 3 (Mechanism) is absent — no state-management choice, validation strategy, or payment SDK integration method
- "seamless" and "mobile-first" are qualitative adjectives and cannot replace Signal 5 (Rationale)
→ FAIL

## P1 Exemplars

### P1 Exemplar 1 — P1 boundary: Kafka adoption with thin partitioning rationale (4/5)
- Candidate context: async event processing 담당.
- Bullet: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s); chose Kafka over RabbitMQ for throughput, accepting operational complexity"
- Reasoning: Signal 1 (constraint: order pipeline load), Signal 2 (Kafka selection), Signal 3 (consumer-group partitioning), and Signal 4 (RabbitMQ rejection, accepted operational complexity) are present, but Signal 5 (Rationale: why throughput is decisive in this context) is absent. 4/5 signals — one short of the ALL 5 of 5 PASS bar. P1.

### P1 Exemplar 2 — P1 boundary: CQRS with constraint but no rationale (4/5)
- Candidate context: dashboard 성능 개선 담당.
- Bullet: "단일 write DB의 쓰기 락 경합으로 인한 dashboard API latency SLA 위반 (Constraint) — CQRS 분리로 read/write model을 격리하여 dashboard 읽기 성능을 개선; single-model 대비 eventual consistency를 trade-off로 수용"
- Reasoning: Signal 1 (Constraint: latency SLA violation from write-lock contention), Signal 2 (CQRS selection), Signal 3 (read/write model separation), and Signal 4 (accepted eventual consistency) are present, but Signal 5 (Rationale: the applicability boundary indicating when to abandon CQRS) is absent. 4/5 signals — one short of the ALL 5 of 5 PASS bar. P1.

## Block A Exemplars

### P1 Exemplar A-1 — Constraint missing (4/5: Selection+Mechanism+Trade-off+Rationale present)

Candidate context: 결제 서비스 백엔드 엔지니어.

Bullet: "결제 이벤트 처리를 위해 Kafka·RabbitMQ·ActiveMQ 세 메시지 큐 옵션을 비교한 뒤 Kafka를 선택·채택했다. Kafka의 동작 원리는 파티션 키 기반으로 메시지를 분산 저장하고 consumer-group이 각 파티션을 독립적으로 구독하는 메커니즘으로, RabbitMQ 대비 높은 처리량을 확보했다. 트레이드오프로 RabbitMQ 대비 운영 복잡도와 메시지 순서 보장의 파티션-범위 제한을 수용했으며, 이 판단의 근거는 결제 이벤트의 멱등성 처리가 가능하여 순서 역전 리스크를 허용할 수 있다는 아키텍처 이유였다. 팀 내 이벤트 파이프라인 모듈 일부를 주도하여 메시지 처리량을 3개월 내 1,200건/초에서 8,500건/초로 개선했고, 결제 이벤트 유실률 0% 달성을 확보했다."

Why P1:
- Signal 1 (Constraint) absent: No explicit technical constraint (throughput bottleneck, loss-rate threshold, etc.) that triggered the change
- Signal 2 (Technology selection): Kafka selected and adopted after comparing Kafka, RabbitMQ, and ActiveMQ ✓
- Signal 3 (Mechanism): Partition-key-based distributed storage + independent consumer-group subscriptions ✓
- Signal 4 (Trade-off): Operational complexity + ordering guarantees limited to a partition ✓
- Signal 5 (Rationale): Idempotent processing makes out-of-order delivery risk acceptable ✓
→ 4/5 signals — P1 because Signal 1 (Constraint) is missing

A2 marker: `1,200건/초`, `8,500건/초`, `3개월`
A3 marker: `메시지 처리량을 3개월 내 1,200건/초에서 8,500건/초로 개선`, `결제 이벤트 유실률 0% 달성을 확보`
A4 marker: `팀 내 이벤트 파이프라인 모듈 일부를 주도`

### P1 Exemplar A-2 — Selection missing (4/5: Constraint+Mechanism+Trade-off+Rationale present)

Candidate context: 검색 서비스 백엔드 엔지니어.

Bullet: "상품 검색 응답시간 p99 500ms 초과라는 검색 레이턴시 제약 조건을 해결하기 위해 역색인 기반 풀텍스트 검색 엔진을 도입했다. 동작 원리는 문서 색인 시 형태소 분석기를 통해 토큰을 추출하고 역색인에 posting list 형태로 저장하여 쿼리 시 O(1)에 근접한 용어 검색을 가능하게 하는 구현 방식이다. 트레이드오프로 인덱스 갱신 지연(near-realtime, 약 1초)을 수용하는 대신 쿼리 레이턴시를 확보했으며, 이 판단의 근거는 검색 결과의 1초 내 최신성 미보장이 사용자 이탈에 큰 영향을 주지 않는다는 A/B 테스트 데이터였다. 팀 내 검색 모듈 일부를 주도하여 p99 응답시간을 520ms에서 80ms로 단축했고, 6주 내 검색 전환율 22% 증가를 달성했다."

Why P1:
- Signal 1 (Constraint): Product-search p99 response time exceeding 500ms ✓
- Signal 2 (Technology selection) absent: Only "역색인 기반 검색 엔진" is mentioned, without comparing alternatives or identifying which technology (Elasticsearch, OpenSearch, Solr, etc.) was selected and adopted — no selection/adoption signal
- Signal 3 (Mechanism): Token extraction by a morphological analyzer + storage in inverted-index posting lists ✓
- Signal 4 (Trade-off): Index-update lag (near-realtime ~1 second) ✓
- Signal 5 (Rationale): Supporting A/B test data ✓
→ 4/5 signals — P1 because Signal 2 (Technology selection) is missing

A2 marker: `p99`, `500ms`, `520ms`, `80ms`, `6주`
A3 marker: `p99 응답시간을 520ms에서 80ms로 단축`, `검색 전환율 22% 증가를 달성`
A4 marker: `팀 내 검색 모듈 일부를 주도`

### P1 Exemplar A-3 — Mechanism missing (4/5: Constraint+Selection+Trade-off+Rationale present)

Candidate context: 스트리밍 플랫폼 백엔드 엔지니어.

Bullet: "실시간 영상 스트리밍 서비스의 메시지 유실 없는 이벤트 전달 요구사항이라는 at-least-once 전달 제약 조건을 해결하기 위해 SQS·SNS·Kinesis 세 AWS 메시징 서비스를 비교한 뒤 Kafka 도입을 결정·채택했다. RabbitMQ 대비 파티션 보존 기간 연장으로 인한 저장 비용을 트레이드오프로 수용했으며, 이 판단의 근거는 영상 이벤트 재처리 SLA가 72시간이어서 최소 3일 보존이 필수라는 비즈니스 요구사항이었다. 개인 기여로 이벤트 수집 모듈 일부를 구현하여 이벤트 유실률을 0.8%에서 0%로 개선했고, 2개월 내 스트리밍 이벤트 처리량 15,000건/초 확보를 달성했다."

Why P1:
- Signal 1 (Constraint): At-least-once delivery requirement ✓
- Signal 2 (Technology selection): Kafka chosen and adopted after comparing SQS, SNS, and Kinesis ✓
- Signal 3 (Mechanism) absent: No explanation of how Kafka works (partitioning, consumer-group, offset commit, etc.) — only "Kafka 도입" is mentioned
- Signal 4 (Trade-off): Increased storage cost relative to RabbitMQ ✓
- Signal 5 (Rationale): Business requirement of a 72-hour video-event reprocessing SLA, making 3-day retention mandatory ✓
→ 4/5 signals — P1 because Signal 3 (Mechanism) is missing

A2 marker: `0.8%`, `15,000건/초`, `2개월`
A3 marker: `이벤트 유실률을 0.8%에서 0%로 개선`, `스트리밍 이벤트 처리량 15,000건/초 확보를 달성`
A4 marker: `개인 기여로 이벤트 수집 모듈 일부를 구현`

### P1 Exemplar A-4 — Trade-off missing (4/5: Constraint+Selection+Mechanism+Rationale present)

Candidate context: 핀테크 백엔드 엔지니어.

Bullet: "계좌 잔액 조회 API p95 지연시간 300ms 초과라는 응답 레이턴시 제약 조건을 해결하기 위해 Redis·Memcached·Hazelcast 세 캐시 솔루션을 평가하여 Redis를 선택·채택했다. Redis의 동작 원리는 메모리 내 해시 테이블에 key-value를 저장하고 단일 스레드 이벤트 루프로 명령을 처리하는 방식으로, 잔액 데이터를 TTL 30초로 캐싱하여 DB 읽기를 차단했다. 이 판단의 근거는 잔액 조회의 99%가 단순 읽기이고 30초 이내 잔액 오차가 서비스 정책상 허용된다는 비즈니스 배경이었다. 함께 캐싱 레이어 컴포넌트를 구현하여 p95 지연시간을 320ms에서 18ms로 단축했고, 4개월 내 DB 읽기 부하 70% 감소를 달성했다."

Why P1:
- Signal 1 (Constraint): Account-balance lookup API p95 latency exceeding 300ms ✓
- Signal 2 (Technology selection): Redis selected and adopted after comparing Redis, Memcached, and Hazelcast ✓
- Signal 3 (Mechanism): Key-value storage in an in-memory hash table + a single-threaded event loop ✓
- Signal 4 (Trade-off) absent: No cost or risk explaining rejection of Memcached/Hazelcast alternatives — Redis is merely "선택" without alternative comparison
- Signal 5 (Rationale): Business context of 99% simple-read balance lookups + tolerance for 30 seconds of discrepancy ✓
→ 4/5 signals — P1 because Signal 4 (Trade-off) is missing

A2 marker: `p95`, `300ms`, `320ms`, `18ms`, `4개월`
A3 marker: `p95 지연시간을 320ms에서 18ms로 단축`, `DB 읽기 부하 70% 감소를 달성`
A4 marker: `함께 캐싱 레이어 컴포넌트를 구현`

### P1 Exemplar A-5 — Rationale missing (4/5: Constraint+Selection+Mechanism+Trade-off present)

Candidate context: 게임 백엔드 엔지니어.

Bullet: "유저 세션 상태 동기화 지연 50ms 초과라는 세션 일관성 제약 조건을 해결하기 위해 Sticky Session·JWT Stateless·Redis Cluster 세 세션 관리 방식을 비교·검토한 후 Redis Cluster를 선택·채택했다. Redis Cluster의 동작 원리는 16,384개 해시 슬롯을 노드 간 분산하고 클라이언트가 MOVED 리다이렉션으로 올바른 노드에 직접 접속하는 구현 방식으로, 단일 노드 Redis 대비 수평 확장을 가능하게 했다. 트레이드오프로 Sticky Session 대비 클러스터 구성 운영 비용과 MULTI/EXEC 트랜잭션 크로스 슬롯 제한을 수용했다. 개인 기여로 세션 동기화 모듈 일부를 최적화하여 세션 지연을 60ms에서 12ms로 단축했고, 3개월 내 동시 접속자 50,000명 처리 확보를 달성했다."

Why P1:
- Signal 1 (Constraint): User-session state synchronization delay exceeding 50ms ✓
- Signal 2 (Technology selection): Redis Cluster selected and adopted after comparing Sticky Session, JWT Stateless, and Redis Cluster ✓
- Signal 3 (Mechanism): Distribution of 16,384 hash slots + MOVED redirection ✓
- Signal 4 (Trade-off): Cluster operating cost + MULTI/EXEC cross-slot limitation ✓
- Signal 5 (Rationale) absent: No reasoning or background explaining why Redis Cluster is best in this context — only "비교 후 선택", without a context-based reason
→ 4/5 signals — P1 because Signal 5 (Rationale) is missing

A2 marker: `50ms`, `60ms`, `12ms`, `50,000명`, `3개월`
A3 marker: `세션 지연을 60ms에서 12ms로 단축`, `동시 접속자 50,000명 처리 확보를 달성`
A4 marker: `개인 기여로 세션 동기화 모듈 일부를 최적화`

### FAIL Exemplar A-6 — 3/5 A1 signals present (graduated thinning)

Candidate context: 이커머스 플랫폼 백엔드 엔지니어.

Bullet: "주문 처리량 급증 시 API 응답 지연이라는 부하 제약 조건에서 RabbitMQ·Kafka를 비교한 뒤 Kafka를 선택·채택했다. Kafka의 동작 원리는 파티션 키로 메시지를 분산 저장하는 메커니즘이다. 팀 내 주문 이벤트 파이프라인 일부를 구현하여 주문 처리 지연을 4개월 내 850ms에서 95ms로 단축했고, 주문 처리량 2,500건/초 확보를 달성했다."

Why FAIL:
- Signal 1 (Constraint): Load constraint ✓
- Signal 2 (Technology selection): Kafka selected and adopted after comparing RabbitMQ and Kafka ✓
- Signal 3 (Mechanism): Partition-key-based distributed storage ✓
- Signal 4 (Trade-off) absent: No accepted cost or risk relative to RabbitMQ
- Signal 5 (Rationale) absent: No evidence, reason, or judgment establishing why Kafka is best in this context
→ 3/5 signal — FAIL

A2 marker: `850ms`, `95ms`, `4개월`, `2,500건/초`
A3 marker: `주문 처리 지연을 4개월 내 850ms에서 95ms로 단축`, `주문 처리량 2,500건/초 확보를 달성`
A4 marker: `팀 내 주문 이벤트 파이프라인 일부를 구현`

### FAIL Exemplar A-7 — 2/5 A1 signals present (graduated thinning)

Candidate context: SaaS 플랫폼 백엔드 엔지니어.

Bullet: "API 응답 성능 개선을 위해 PostgreSQL에서 Elasticsearch로 검색 기능을 선택·채택했다. Elasticsearch의 동작 원리는 역색인 구조로 풀텍스트 검색을 지원하는 메커니즘이다. 공동으로 검색 서비스 모듈을 개발하여 3개월 내 검색 응답시간을 1,200ms에서 90ms로 단축했고, 사용자 검색 만족도 35% 증가를 달성했다."

Why FAIL:
- Signal 1 (Constraint) absent: No technical constraint (response-time threshold, search-accuracy SLA, etc.)
- Signal 2 (Technology selection): Elasticsearch selected and adopted ✓
- Signal 3 (Mechanism): Full-text search through an inverted-index structure ✓
- Signal 4 (Trade-off) absent: No accepted cost or risk relative to PostgreSQL
- Signal 5 (Rationale) absent: No decision rationale, background, or reason
→ 2/5 signal — FAIL

A2 marker: `1,200ms`, `90ms`, `3개월`, `35%`
A3 marker: `검색 응답시간을 1,200ms에서 90ms로 단축`, `사용자 검색 만족도 35% 증가를 달성`
A4 marker: `공동으로 검색 서비스 모듈을 개발`

### FAIL Exemplar A-8 — 1/5 A1 signal (name-level only)

Candidate context: 스타트업 풀스택 엔지니어.

Bullet: "서비스 확장성을 위해 Kafka를 도입했다. 개인 기여로 메시지 파이프라인 모듈 일부를 구현하여 2개월 내 메시지 처리량을 500건/초에서 3,000건/초로 증가했고, 이벤트 처리 지연 60% 감소를 달성했다."

Why FAIL:
- Signal 1 (Constraint) absent: "서비스 확장성" is an abstract keyword with no concrete constraint
- Signal 2 (Technology selection) absent: Kafka is named, but no alternatives are compared or selected
- Signal 3 (Mechanism) absent: Only "도입", with no operating principle or implementation method
- Signal 4 (Trade-off) absent: No accepted cost or risk
- Signal 5 (Rationale): "서비스 확장성" is used as a rationale but falls short of reasoning, judgment, or background — 1/5 at name-level
→ 1/5 signal (Rationale partial, name-level only) — FAIL

A2 marker: `500건/초`, `3,000건/초`, `2개월`
A3 marker: `메시지 처리량을 500건/초에서 3,000건/초로 증가`, `이벤트 처리 지연 60% 감소를 달성`
A4 marker: `개인 기여로 메시지 파이프라인 모듈 일부를 구현`

## Boundary Cases

### EDGE 1 — Named but trivial

"Used jQuery to validate forms"

- jQuery is named, but mechanism/rationale/trade-off are absent
- Only Signal 2 (Technology selection) is met; Signals 1/3/4/5 are absent → **FAIL** (1/5 signal — named-only, no technical judgment)

### EDGE 2 — Deep but incomplete (3/5)

"Implemented custom consistent hashing with virtual nodes for even distribution"

- Concrete mechanism explained (consistent hashing + virtual nodes + distribution objective)
- Signal 3 (Mechanism) + Signal 5 (partial Rationale) are present, but Signal 1 (Constraint: which distribution problem), Signal 2 (Technology: comparison with alternatives), and Signal 4 (Trade-off) are absent
- Below the ALL 5 of 5 PASS bar → **FAIL** (3/5 signals — Guidance rule ≤3/5 → FAIL; mechanism depth alone does not meet the PASS bar)

## Evaluator Guidance

1. **Extract claim**: identify the technical verb + target system in the bullet
2. **Count signals**: count how many of the five signals are explicit in the bullet body
3. **Check depth**: determine whether each signal is name-level or reveals mechanism depth
4. **Verdict**: PASS (ALL 5 of 5 signals, sufficient depth) | P1 (4/5 signals, or all five present but shallow) | FAIL (≤3/5 signals or entirely absent depth)
5. **Evidence quote**: directly quote the signal's wording from the bullet

## Common Evaluation Pitfalls

- **Technology trend bias**: using the latest tech does not equal depth. An old-school stack can PASS with rationale
- **Confusing ownership with A1**: leadership verbs such as "led/drove/coordinated/managed" belong to A4. A1 examines technical judgment only.
- **Inferring information absent from the bullet**: evidence_quote comes only from the bullet body. Do not infer depth from a job title or company name
- **Verdict-first reasoning**: do not decide the conclusion first and retrofit evidence. The reasoning → evidence_quote → verdict order is mandatory

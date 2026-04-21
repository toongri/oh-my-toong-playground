# A1. Technical Credibility

## Standard

Absolute — 평가 기준은 경력 레벨과 무관. bullet 본문에 **ALL 5 of 5 signals** 가 드러나야 PASS. 이 기준은 SKILL.md Purpose("면접관 5각도 follow-up hook 보장")에서 직접 도출된다 — 하나의 signal이라도 빠지면 면접관이 해당 각도의 follow-up을 생성할 수 없다.

## What We Look For

Bullet 본문에 다음 5개 signal이 **모든 5개 신호 전부** 명시적으로 표출되어야 PASS. 하나라도 빠지면 PASS 불가.

1. **Constraint awareness (제약 인식)** — 해결해야 할 technical constraint 명시 (throughput bottleneck, race condition, consistency gap, legacy coupling, cost ceiling 등)
2. **Technology selection (기술 선택)** — 특정 system/algorithm/pattern을 의식적으로 선택
3. **Mechanism (메커니즘)** — 선택한 기술이 어떻게 동작하는지 (partitioning key, memoization strategy, eviction policy, cutover path 등)
4. **Trade-off / risk (수용 비용)** — 수용한 비용·위험, 또는 기각된 대안의 탈락 사유
5. **Rationale (선택 이유)** — 맥락 기반 "왜 X가 아닌 Y"

## P1 Decision Rule

Signal 4/5 존재하지만 **하나의 signal이 빠졌거나 name-level에만 머물러 mechanism depth가 얕다**. 완전히 FAIL(공허)은 아니지만 ALL 5 of 5 Absolute PASS bar에 미달. examiner는 누락된 signal을 구체화하라는 improvement hint 생성.

## PASS Exemplars

### PASS Exemplar 1 — Frontend perf (F-1)

Candidate context: Frontend engineer, e-commerce 서비스 담당.

Bullet: "모바일 LCP 3.2초 초과라는 FCP 예산 제약 조건을 해결하기 위해 CSR·SSR·ISR 세 가지 렌더링 전략을 비교·검토한 후 ISR을 선택했다. ISR의 동작 원리는 빌드 타임에 정적 HTML을 생성하고 revalidate 주기마다 백그라운드에서 재생성하는 방식으로, 요청마다 서버 렌더링하는 SSR 대비 TTFB를 40% 단축했다. 트레이드오프로 콘텐츠 최신성 대신 DX와 런타임 비용을 택했으며, 이 판단의 근거는 타겟 사용자의 80%가 3G 이하 네트워크를 사용하는 동남아 시장 디바이스 프로파일이었다. 팀 내 프론트엔드 컴포넌트 일부를 주도적으로 적용하여 LCP p95를 3.2초에서 1.8초로 개선했고, 6개월간 전환율 12% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): 모바일 LCP 3.2초 초과 FCP 예산 제약 조건
- Signal 2 (Technology): CSR·SSR·ISR 비교 후 ISR 선택·채택
- Signal 3 (Mechanism): 빌드 타임 정적 HTML 생성 + revalidate 백그라운드 재생성 메커니즘
- Signal 4 (Trade-off): 콘텐츠 최신성 vs DX·런타임 비용 트레이드오프
- Signal 5 (Rationale): 타겟 사용자 80%가 3G 이하 네트워크 사용하는 동남아 디바이스 프로파일 근거
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `3.2초`, `40%`, `p95`, `6개월`
A3 marker: `LCP p95를 3.2초에서 1.8초로 개선`, `전환율 12% 증가를 달성`
A4 marker: `팀 내 프론트엔드 컴포넌트 일부를 주도적으로 적용`

### PASS Exemplar 2 — ML platform (F-2)

Candidate context: ML platform engineer, 추천 시스템 담당.

Bullet: "온라인 서빙 p99 지연시간 200ms 초과라는 모델 서빙 제약 조건을 해결하기 위해 TensorFlow Serving·TorchServe·Triton Inference Server 세 프레임워크를 벤치마킹하여 Triton을 선택·채택했다. Triton의 동작 원리는 dynamic batching으로 동일 모델에 대한 요청을 묶어 GPU 처리량을 극대화하는 방식이며, 배치·스트림 처리를 모두 지원해 비실시간 추론 파이프라인과 통합이 가능했다. 트레이드오프로 TorchServe 대비 운영 복잡도를 수용하는 대신 레이턴시 절감을 선택했으며, 이 판단의 근거는 추천 클릭률 1% 향상이 월 매출 2억 원에 직결되는 제품 KPI였다. 공동으로 서빙 모듈을 개발하여 p99 지연시간을 220ms에서 85ms로 단축했고, 3개월 내 추천 클릭률 3.2% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): 온라인 서빙 p99 지연시간 200ms 초과 제약 조건
- Signal 2 (Technology): TensorFlow Serving·TorchServe·Triton 비교 후 Triton 선택·채택
- Signal 3 (Mechanism): dynamic batching으로 GPU 처리량 극대화 메커니즘
- Signal 4 (Trade-off): TorchServe 대비 운영 복잡도 vs 레이턴시 절감 트레이드오프
- Signal 5 (Rationale): 추천 클릭률 1% = 월 매출 2억 원 제품 KPI 근거
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `200ms`, `220ms`, `85ms`, `3개월`, `2억 원`
A3 marker: `p99 지연시간을 220ms에서 85ms로 단축`, `추천 클릭률 3.2% 증가를 달성`
A4 marker: `공동으로 서빙 모듈을 개발`

### PASS Exemplar 3 — SRE incident (F-3)

Candidate context: SRE, 결제 서비스 온콜 담당.

Bullet: "결제 서비스 장애 MTTR 45분 초과라는 인시던트 대응 제약 조건을 해결하기 위해 Datadog·Grafana·Prometheus 세 모니터링 툴링을 평가하여 Datadog APM을 선택·채택했다. Datadog APM의 동작 원리는 분산 트레이스를 자동 수집하고 span 간 상관관계 분석으로 근본 원인을 자동 제안하는 메커니즘이며, 로그·메트릭·트레이스를 단일 뷰에서 연계해 상관관계 분석 시간을 줄였다. 트레이드오프로 Grafana+Prometheus 대비 월 120만 원 비용을 수용하는 대신 알람 노이즈 감소와 커버리지 향상을 택했으며, 이 판단의 근거는 직전 분기 포스트모템에서 MTTR의 70%가 원인 특정 단계에서 소요된다는 교훈이었다. 팀 내 SRE 모니터링 구성 일부를 주도하여 MTTR을 45분에서 12분으로 단축했고, 반기 내 장애 재발률 60% 감소를 달성했다."

Why PASS:
- Signal 1 (Constraint): 결제 서비스 장애 MTTR 45분 초과 제약 조건
- Signal 2 (Technology): Datadog·Grafana·Prometheus 비교 후 Datadog APM 선택·채택
- Signal 3 (Mechanism): 분산 트레이스 자동 수집 + span 간 상관관계 분석 메커니즘
- Signal 4 (Trade-off): 월 120만 원 비용 vs 알람 노이즈 감소·커버리지 향상 트레이드오프
- Signal 5 (Rationale): 포스트모템에서 MTTR 70%가 원인 특정 단계 소요라는 교훈 근거
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `45분`, `120만 원`, `70%`, `반기`
A3 marker: `MTTR을 45분에서 12분으로 단축`, `장애 재발률 60% 감소를 달성`
A4 marker: `팀 내 SRE 모니터링 구성 일부를 주도`

### PASS Exemplar 4 — Backend distributed system (F-4)

Candidate context: 백엔드 엔지니어, 주문 서비스 담당.

Bullet: "분산 주문 시스템의 강한 일관성 요구사항이라는 consistency 제약 조건을 해결하기 위해 CAP 이론 축에서 CP 특성을 갖는 etcd 기반 Raft 합의 프로토콜을 선택·채택했다. Raft 합의 프로토콜의 동작 원리는 leader election과 log replication을 통해 과반 노드 응답 시에만 커밋하는 메커니즘으로, Split-brain 시나리오에서도 데이터 손실 없이 일관성을 보장한다. 트레이드오프로 AP 시스템 대비 파티션 발생 시 가용성을 희생하고 레이턴시 p99 15ms를 수용했으며, 이 판단의 근거는 읽기·쓰기 비율이 1:9로 쓰기 집중적이며 중복 주문 발생 시 비용이 가용성 저하보다 크다는 비즈니스 요구사항이었다. 함께 합의 모듈 컴포넌트를 구현하여 중복 주문 발생률을 0.3%에서 0%로 개선했고, 2분기 내 주문 처리 정확도 99.99% 확보를 달성했다."

Why PASS:
- Signal 1 (Constraint): 분산 주문 시스템 강한 일관성 요구사항 제약 조건
- Signal 2 (Technology): CAP 축 CP 특성 etcd 기반 Raft 합의 프로토콜 선택·채택
- Signal 3 (Mechanism): leader election + log replication으로 과반 노드 응답 시에만 커밋하는 메커니즘
- Signal 4 (Trade-off): AP 대비 파티션 시 가용성 희생 + p99 15ms 레이턴시 트레이드오프
- Signal 5 (Rationale): 읽기·쓰기 1:9 쓰기 집중, 중복 주문 비용 > 가용성 저하 비즈니스 근거
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `0.3%`, `15ms`, `p99`, `2분기`
A3 marker: `중복 주문 발생률을 0.3%에서 0%로 개선`, `주문 처리 정확도 99.99% 확보를 달성`
A4 marker: `함께 합의 모듈 컴포넌트를 구현`

### PASS Exemplar 5 — Mobile platform (F-5)

Candidate context: 모바일 엔지니어, iOS·Android 공통 앱 담당.

Bullet: "배터리·메모리 제약이 큰 저사양 디바이스에서 앱 크래시율 5% 초과라는 battery·memory 제약 조건을 해결하기 위해 네이티브(Swift/Kotlin)·React Native·Flutter 세 플랫폼 선택지를 평가하여 Flutter를 선택·채택했다. Flutter의 렌더링 메커니즘은 자체 Skia 엔진으로 위젯 트리를 직접 GPU에 그리는 방식으로, WebView 기반 크로스플랫폼 대비 메모리 복사 오버헤드를 제거했다. 트레이드오프로 네이티브 API 직접 접근 대비 TTI가 120ms 더 느려지고 번들 크기가 8MB 증가하는 비용을 수용했으며, 이 판단의 근거는 타겟 디바이스 매트릭스의 60%가 2GB RAM 이하 기기라는 실제 기기 분포 데이터였다. 개인 기여로 렌더링 모듈 일부를 최적화하여 앱 크래시율을 5.1%에서 0.8%로 개선했고, 1분기 내 DAU 18% 증가를 달성했다."

Why PASS:
- Signal 1 (Constraint): 저사양 디바이스 배터리·메모리 제약으로 앱 크래시율 5% 초과 제약 조건
- Signal 2 (Technology): 네이티브·React Native·Flutter 비교 후 Flutter 선택·채택
- Signal 3 (Mechanism): Skia 엔진으로 위젯 트리를 직접 GPU에 그리는 렌더링 메커니즘
- Signal 4 (Trade-off): TTI 120ms 지연 + 번들 8MB 증가 vs 메모리 절감 트레이드오프
- Signal 5 (Rationale): 타겟 디바이스 매트릭스 60%가 2GB RAM 이하 기기 분포 근거
→ 5/5 signal PASS (ALL 5 of 5)

A2 marker: `5%`, `120ms`, `8MB`, `2GB`, `1분기`
A3 marker: `앱 크래시율을 5.1%에서 0.8%로 개선`, `DAU 18% 증가를 달성`
A4 marker: `개인 기여로 렌더링 모듈 일부를 최적화`

## FAIL Exemplars

#### FAIL Exemplar 1 — Surface-level mention (any level)

Bullet: "Used React, TypeScript, and Next.js to build web application"

Why FAIL:
- Signal 1 (Constraint) 부재: 어떤 기술적 문제를 푸는지 없음
- Signal 2 (Technology): React/TypeScript/Next.js 이름만 나열, 선택 이유 없음
- Signal 3 (Mechanism) 부재: 어떻게 동작하는지 없음
- Signal 4 (Trade-off) 부재: 비교/대안 없음
- Signal 5 (Rationale) 부재: 근거 없음
- 0 signal depth → FAIL

#### FAIL Exemplar 2 — Generic verb + tech name

Bullet: "Led backend team to build microservices with Spring Boot and Kafka for scalability"

Why FAIL:
- "scalability" 언급하나 Signal 1 (Constraint) 구체 내용 없음
- Signal 2 (Technology) 이름만 있고 Signal 3/4/5 전무 — 어떤 서비스를 어떻게 분리했는지, Kafka를 왜 선택했는지, 어떤 trade-off를 수용했는지 없음
- Signal 1개 수준으로 FAIL
→ FAIL

#### FAIL Exemplar 3 — Tech name parade without depth

Bullet: "Experience with AWS (EC2, S3, RDS, Lambda, CloudFront, Route53, CloudWatch), Docker, Kubernetes, Terraform, Jenkins, GitLab CI"

Why FAIL:
- Signal 0개 충족 (tech name parade, 어떤 문제에 어떤 기술을 적용했는지 전혀 없음)
- Signal 2 (Technology)에 해당하는 이름들은 나열되나 Signal 1/3/4/5 완전 부재 — 기여 범위, 결정 근거, 설계 판단 없음
→ FAIL

#### FAIL Exemplar 4 — Terminology without mechanism

Bullet: "Optimized database query performance by implementing advanced indexing strategies"

Why FAIL:
- Signal 2/3 수준 어휘("advanced indexing")가 등장하나 실제 mechanism 없음 — composite/functional/partial index 중 무엇인지, 어떤 쿼리 패턴에 적용했는지 없음
- Signal 1/4/5 부재. "Optimized" + "advanced" 조합은 depth를 암시하나 mechanism을 대체하지 못함
→ FAIL

#### FAIL Exemplar 5 — Feature-framed mechanism hiding

Bullet: "Developed mobile-first checkout flow with multi-step form validation and seamless payment experience across devices"

Why FAIL:
- Signal 0개 충족 (feature 명사구로 mechanism을 가장하는 패턴)
- "checkout flow", "multi-step form", "payment"은 feature 명사구로 구체성의 착시를 만들지만 Signal 3 (Mechanism) 없음 — state 관리 선택, validation 전략, payment SDK 통합 방식 전무
- "seamless", "mobile-first"는 qualitative adjective로 Signal 5 (Rationale)를 대체하지 못함
→ FAIL

## P1 Exemplars

#### P1 Exemplar 1 — P1 boundary: Kafka adoption with thin partitioning rationale (4/5)
- Candidate context: async event processing 담당.
- Bullet: "Adopted Kafka for async event processing with consumer-group partitioning to handle the order pipeline load (4M daily events, backlog p95 drop from 8min to 45s); chose Kafka over RabbitMQ for throughput, accepting operational complexity"
- Reasoning: Signal 1 (constraint: order pipeline load), Signal 2 (Kafka 선택), Signal 3 (consumer-group partitioning), Signal 4 (RabbitMQ 기각, operational complexity 수용) 존재하나 Signal 5 (Rationale: 왜 throughput이 이 맥락에서 결정적인지) 부재. 4/5 signal — ALL 5 of 5 PASS bar에 1개 미달. P1.

#### P1 Exemplar 2 — P1 boundary: CQRS with constraint but no rationale (4/5)
- Candidate context: dashboard 성능 개선 담당.
- Bullet: "단일 write DB의 쓰기 락 경합으로 인한 dashboard API latency SLA 위반 (Constraint) — CQRS 분리로 read/write model을 격리하여 dashboard 읽기 성능을 개선; single-model 대비 eventual consistency를 trade-off로 수용"
- Reasoning: Signal 1 (Constraint: 쓰기 락 경합으로 인한 latency SLA 위반), Signal 2 (CQRS 선택), Signal 3 (read/write model 분리), Signal 4 (eventual consistency 수용) 존재하나 Signal 5 (Rationale: 언제 CQRS를 포기해야 하는지의 적용 경계) 부재. 4/5 signal — ALL 5 of 5 PASS bar에 1개 미달. P1.

## Block B Exemplars

### P1 Exemplar B-1 — Constraint missing (4/5: Selection+Mechanism+Trade-off+Rationale present)

Candidate context: 결제 서비스 백엔드 엔지니어.

Bullet: "결제 이벤트 처리를 위해 Kafka·RabbitMQ·ActiveMQ 세 메시지 큐 옵션을 비교한 뒤 Kafka를 선택·채택했다. Kafka의 동작 원리는 파티션 키 기반으로 메시지를 분산 저장하고 consumer-group이 각 파티션을 독립적으로 구독하는 메커니즘으로, RabbitMQ 대비 높은 처리량을 확보했다. 트레이드오프로 RabbitMQ 대비 운영 복잡도와 메시지 순서 보장의 파티션-범위 제한을 수용했으며, 이 판단의 근거는 결제 이벤트의 멱등성 처리가 가능하여 순서 역전 리스크를 허용할 수 있다는 아키텍처 이유였다. 팀 내 이벤트 파이프라인 모듈 일부를 주도하여 메시지 처리량을 3개월 내 1,200건/초에서 8,500건/초로 개선했고, 결제 이벤트 유실률 0% 달성을 확보했다."

Why P1:
- Signal 1 (Constraint) 부재: 어떤 기술적 제약 조건(throughput bottleneck, 유실률 임계치 등) 이 trigger가 되었는지 명시 없음
- Signal 2 (Selection): Kafka·RabbitMQ·ActiveMQ 비교 후 Kafka 선택·채택 ✓
- Signal 3 (Mechanism): 파티션 키 기반 분산 저장 + consumer-group 독립 구독 메커니즘 ✓
- Signal 4 (Trade-off): 운영 복잡도 + 파티션-범위 순서 보장 제한 트레이드오프 ✓
- Signal 5 (Rationale): 멱등성 처리로 순서 역전 리스크 허용 가능하다는 근거 ✓
→ 4/5 signal — Signal 1 (Constraint) 누락으로 P1

A2 marker: `1,200건/초`, `8,500건/초`, `3개월`
A3 marker: `메시지 처리량을 3개월 내 1,200건/초에서 8,500건/초로 개선`, `결제 이벤트 유실률 0% 달성을 확보`
A4 marker: `팀 내 이벤트 파이프라인 모듈 일부를 주도`

### P1 Exemplar B-2 — Selection missing (4/5: Constraint+Mechanism+Trade-off+Rationale present)

Candidate context: 검색 서비스 백엔드 엔지니어.

Bullet: "상품 검색 응답시간 p99 500ms 초과라는 검색 레이턴시 제약 조건을 해결하기 위해 역색인 기반 풀텍스트 검색 엔진을 도입했다. 동작 원리는 문서 색인 시 형태소 분석기를 통해 토큰을 추출하고 역색인에 posting list 형태로 저장하여 쿼리 시 O(1)에 근접한 용어 검색을 가능하게 하는 구현 방식이다. 트레이드오프로 인덱스 갱신 지연(near-realtime, 약 1초)을 수용하는 대신 쿼리 레이턴시를 확보했으며, 이 판단의 근거는 검색 결과의 1초 내 최신성 미보장이 사용자 이탈에 큰 영향을 주지 않는다는 A/B 테스트 데이터였다. 팀 내 검색 모듈 일부를 주도하여 p99 응답시간을 520ms에서 80ms로 단축했고, 6주 내 검색 전환율 22% 증가를 달성했다."

Why P1:
- Signal 1 (Constraint): 상품 검색 응답시간 p99 500ms 초과 제약 조건 ✓
- Signal 2 (Selection) 부재: 어떤 기술(Elasticsearch, OpenSearch, Solr 등)을 선택·채택했는지 대안 비교 없이 "역색인 기반 검색 엔진"만 언급 — 선택·채택 신호 부재
- Signal 3 (Mechanism): 형태소 분석기 토큰 추출 + 역색인 posting list 저장 구현 방식 ✓
- Signal 4 (Trade-off): 인덱스 갱신 지연(near-realtime ~1초) 트레이드오프 ✓
- Signal 5 (Rationale): A/B 테스트 데이터 기반 근거 ✓
→ 4/5 signal — Signal 2 (Selection) 누락으로 P1

A2 marker: `p99`, `500ms`, `520ms`, `80ms`, `6주`
A3 marker: `p99 응답시간을 520ms에서 80ms로 단축`, `검색 전환율 22% 증가를 달성`
A4 marker: `팀 내 검색 모듈 일부를 주도`

### P1 Exemplar B-3 — Mechanism missing (4/5: Constraint+Selection+Trade-off+Rationale present)

Candidate context: 스트리밍 플랫폼 백엔드 엔지니어.

Bullet: "실시간 영상 스트리밍 서비스의 메시지 유실 없는 이벤트 전달 요구사항이라는 at-least-once 전달 제약 조건을 해결하기 위해 SQS·SNS·Kinesis 세 AWS 메시징 서비스를 비교한 뒤 Kafka 도입을 결정·채택했다. RabbitMQ 대비 파티션 보존 기간 연장으로 인한 저장 비용을 트레이드오프로 수용했으며, 이 판단의 근거는 영상 이벤트 재처리 SLA가 72시간이어서 최소 3일 보존이 필수라는 비즈니스 요구사항이었다. 개인 기여로 이벤트 수집 모듈 일부를 구현하여 이벤트 유실률을 0.8%에서 0%로 개선했고, 2개월 내 스트리밍 이벤트 처리량 15,000건/초 확보를 달성했다."

Why P1:
- Signal 1 (Constraint): at-least-once 전달 요구사항 제약 조건 ✓
- Signal 2 (Selection): SQS·SNS·Kinesis 비교 후 Kafka 결정·채택 ✓
- Signal 3 (Mechanism) 부재: Kafka가 어떻게 동작하는지(파티셔닝, consumer-group, offset commit 등) 메커니즘 설명 없음 — "Kafka 도입"만 언급
- Signal 4 (Trade-off): RabbitMQ 대비 저장 비용 증가 트레이드오프 ✓
- Signal 5 (Rationale): 영상 이벤트 재처리 SLA 72시간, 3일 보존 필수 비즈니스 요구사항 근거 ✓
→ 4/5 signal — Signal 3 (Mechanism) 누락으로 P1

A2 marker: `0.8%`, `15,000건/초`, `2개월`
A3 marker: `이벤트 유실률을 0.8%에서 0%로 개선`, `스트리밍 이벤트 처리량 15,000건/초 확보를 달성`
A4 marker: `개인 기여로 이벤트 수집 모듈 일부를 구현`

### P1 Exemplar B-4 — Trade-off missing (4/5: Constraint+Selection+Mechanism+Rationale present)

Candidate context: 핀테크 백엔드 엔지니어.

Bullet: "계좌 잔액 조회 API p95 지연시간 300ms 초과라는 응답 레이턴시 제약 조건을 해결하기 위해 Redis·Memcached·Hazelcast 세 캐시 솔루션을 평가하여 Redis를 선택·채택했다. Redis의 동작 원리는 메모리 내 해시 테이블에 key-value를 저장하고 단일 스레드 이벤트 루프로 명령을 처리하는 방식으로, 잔액 데이터를 TTL 30초로 캐싱하여 DB 읽기를 차단했다. 이 판단의 근거는 잔액 조회의 99%가 단순 읽기이고 30초 이내 잔액 오차가 서비스 정책상 허용된다는 비즈니스 배경이었다. 함께 캐싱 레이어 컴포넌트를 구현하여 p95 지연시간을 320ms에서 18ms로 단축했고, 4개월 내 DB 읽기 부하 70% 감소를 달성했다."

Why P1:
- Signal 1 (Constraint): 계좌 잔액 조회 API p95 지연시간 300ms 초과 제약 조건 ✓
- Signal 2 (Selection): Redis·Memcached·Hazelcast 비교 후 Redis 선택·채택 ✓
- Signal 3 (Mechanism): 메모리 내 해시 테이블 key-value 저장 + 단일 스레드 이벤트 루프 방식 ✓
- Signal 4 (Trade-off) 부재: Memcached·Hazelcast 대비 대안을 기각한 비용·위험 없음 — 대안 비교 없이 Redis만 "선택"
- Signal 5 (Rationale): 잔액 조회 99% 단순 읽기 + 30초 오차 허용 비즈니스 배경 근거 ✓
→ 4/5 signal — Signal 4 (Trade-off) 누락으로 P1

A2 marker: `p95`, `300ms`, `320ms`, `18ms`, `4개월`
A3 marker: `p95 지연시간을 320ms에서 18ms로 단축`, `DB 읽기 부하 70% 감소를 달성`
A4 marker: `함께 캐싱 레이어 컴포넌트를 구현`

### P1 Exemplar B-5 — Rationale missing (4/5: Constraint+Selection+Mechanism+Trade-off present)

Candidate context: 게임 백엔드 엔지니어.

Bullet: "유저 세션 상태 동기화 지연 50ms 초과라는 세션 일관성 제약 조건을 해결하기 위해 Sticky Session·JWT Stateless·Redis Cluster 세 세션 관리 방식을 비교·검토한 후 Redis Cluster를 선택·채택했다. Redis Cluster의 동작 원리는 16,384개 해시 슬롯을 노드 간 분산하고 클라이언트가 MOVED 리다이렉션으로 올바른 노드에 직접 접속하는 구현 방식으로, 단일 노드 Redis 대비 수평 확장을 가능하게 했다. 트레이드오프로 Sticky Session 대비 클러스터 구성 운영 비용과 MULTI/EXEC 트랜잭션 크로스 슬롯 제한을 수용했다. 개인 기여로 세션 동기화 모듈 일부를 최적화하여 세션 지연을 60ms에서 12ms로 단축했고, 3개월 내 동시 접속자 50,000명 처리 확보를 달성했다."

Why P1:
- Signal 1 (Constraint): 유저 세션 상태 동기화 지연 50ms 초과 제약 조건 ✓
- Signal 2 (Selection): Sticky Session·JWT Stateless·Redis Cluster 비교 후 Redis Cluster 선택·채택 ✓
- Signal 3 (Mechanism): 16,384 해시 슬롯 분산 + MOVED 리다이렉션 구현 방식 ✓
- Signal 4 (Trade-off): 클러스터 운영 비용 + MULTI/EXEC 크로스 슬롯 제한 트레이드오프 ✓
- Signal 5 (Rationale) 부재: 왜 Redis Cluster가 이 맥락에서 최선인지 판단 이유·배경 없음 — "비교 후 선택"만 있고 맥락 기반 이유 제시 없음
→ 4/5 signal — Signal 5 (Rationale) 누락으로 P1

A2 marker: `50ms`, `60ms`, `12ms`, `50,000명`, `3개월`
A3 marker: `세션 지연을 60ms에서 12ms로 단축`, `동시 접속자 50,000명 처리 확보를 달성`
A4 marker: `개인 기여로 세션 동기화 모듈 일부를 최적화`

### FAIL Exemplar B-6 — 3/5 A1 signals present (graduated thinning)

Candidate context: 이커머스 플랫폼 백엔드 엔지니어.

Bullet: "주문 처리량 급증 시 API 응답 지연이라는 부하 제약 조건에서 RabbitMQ·Kafka를 비교한 뒤 Kafka를 선택·채택했다. Kafka의 동작 원리는 파티션 키로 메시지를 분산 저장하는 메커니즘이다. 팀 내 주문 이벤트 파이프라인 일부를 구현하여 주문 처리 지연을 4개월 내 850ms에서 95ms로 단축했고, 주문 처리량 2,500건/초 확보를 달성했다."

Why FAIL:
- Signal 1 (Constraint): 부하 제약 조건 ✓
- Signal 2 (Selection): RabbitMQ·Kafka 비교 후 Kafka 선택·채택 ✓
- Signal 3 (Mechanism): 파티션 키 분산 저장 메커니즘 ✓
- Signal 4 (Trade-off) 부재: RabbitMQ 대비 수용한 비용·위험 없음
- Signal 5 (Rationale) 부재: 이 맥락에서 Kafka가 최선인 근거·이유·판단 없음
→ 3/5 signal — FAIL

A2 marker: `850ms`, `95ms`, `4개월`, `2,500건/초`
A3 marker: `주문 처리 지연을 4개월 내 850ms에서 95ms로 단축`, `주문 처리량 2,500건/초 확보를 달성`
A4 marker: `팀 내 주문 이벤트 파이프라인 일부를 구현`

### FAIL Exemplar B-7 — 2/5 A1 signals present (graduated thinning)

Candidate context: SaaS 플랫폼 백엔드 엔지니어.

Bullet: "API 응답 성능 개선을 위해 PostgreSQL에서 Elasticsearch로 검색 기능을 선택·채택했다. Elasticsearch의 동작 원리는 역색인 구조로 풀텍스트 검색을 지원하는 메커니즘이다. 공동으로 검색 서비스 모듈을 개발하여 3개월 내 검색 응답시간을 1,200ms에서 90ms로 단축했고, 사용자 검색 만족도 35% 증가를 달성했다."

Why FAIL:
- Signal 1 (Constraint) 부재: 어떤 기술적 제약 조건(응답시간 임계치, 검색 정확도 SLA 등)이 없음
- Signal 2 (Selection): Elasticsearch 선택·채택 ✓
- Signal 3 (Mechanism): 역색인 구조 풀텍스트 검색 메커니즘 ✓
- Signal 4 (Trade-off) 부재: PostgreSQL 대비 수용한 비용·위험 없음
- Signal 5 (Rationale) 부재: 판단 근거·배경·이유 없음
→ 2/5 signal — FAIL

A2 marker: `1,200ms`, `90ms`, `3개월`, `35%`
A3 marker: `검색 응답시간을 1,200ms에서 90ms로 단축`, `사용자 검색 만족도 35% 증가를 달성`
A4 marker: `공동으로 검색 서비스 모듈을 개발`

### FAIL Exemplar B-8 — 1/5 A1 signal (name-level only)

Candidate context: 스타트업 풀스택 엔지니어.

Bullet: "서비스 확장성을 위해 Kafka를 도입했다. 개인 기여로 메시지 파이프라인 모듈 일부를 구현하여 2개월 내 메시지 처리량을 500건/초에서 3,000건/초로 증가했고, 이벤트 처리 지연 60% 감소를 달성했다."

Why FAIL:
- Signal 1 (Constraint) 부재: "서비스 확장성"은 추상적 키워드로 구체적 제약 조건 없음
- Signal 2 (Selection) 부재: Kafka 이름만 있고 대안 비교·선택 없음
- Signal 3 (Mechanism) 부재: "도입"만 있고 동작 원리·구현 방식 없음
- Signal 4 (Trade-off) 부재: 수용한 비용·위험 없음
- Signal 5 (Rationale): "서비스 확장성"이 근거처럼 쓰였으나 이유·판단·배경 수준에 미달 — 1/5 name-level
→ 1/5 signal (Rationale partial, name-level only) — FAIL

A2 marker: `500건/초`, `3,000건/초`, `2개월`
A3 marker: `메시지 처리량을 500건/초에서 3,000건/초로 증가`, `이벤트 처리 지연 60% 감소를 달성`
A4 marker: `개인 기여로 메시지 파이프라인 모듈 일부를 구현`

## Boundary Cases

### EDGE 1 — Named but trivial

"Used jQuery to validate forms"

- jQuery는 named지만 mechanism/rationale/trade-off 부재
- Signal 2 (Technology) 1개만 충족, Signal 1/3/4/5 없음 → **FAIL** (1/5 signal — named-only, 기술적 판단 전무)

### EDGE 2 — Deep but incomplete (3/5)

"Implemented custom consistent hashing with virtual nodes for even distribution"

- 구체적 mechanism 설명 (consistent hashing + virtual nodes + distribution 목적)
- Signal 3 (Mechanism) + Signal 5 (Rationale partial) 존재하나 Signal 1 (Constraint: 어떤 분산 문제), Signal 2 (Technology: 다른 대안과 비교), Signal 4 (Trade-off) 부재
- ALL 5 of 5 PASS bar 미달 → **FAIL** (3/5 signal — Guidance rule ≤3/5 → FAIL, mechanism depth만으로 PASS bar 미충족)

## Evaluator Guidance

1. **Extract claim**: bullet에서 기술 동사 + 대상 system 식별
2. **Count signals**: 5개 signal 중 몇 개가 bullet 본문에 명시되는지 집계
3. **Check depth**: signal이 name-level인지 mechanism depth까지 드러나는지 판정
4. **Verdict**: PASS (signal ALL 5 of 5, depth 충분) | P1 (signal 4/5이거나 5개 존재하나 depth 얕음) | FAIL (signal ≤3/5 또는 전적 depth 부재)
5. **Evidence quote**: bullet에서 해당 signal 문구 직접 인용

## Common Evaluation Pitfalls

- **기술 유행 편향**: 최신 tech 사용 = 깊이 있음 (X). old-school stack도 rationale 있으면 PASS
- **Ownership vs A1 혼동**: "led/drove/coordinated/managed" 같은 leadership verb는 A4 영역. A1은 기술적 판단만 본다.
- **bullet에 없는 정보 추론**: evidence_quote는 bullet 본문에서만. 직함이나 회사명으로 depth 추론 금지
- **Verdict-first reasoning**: 결론 먼저 정한 뒤 증거 끼워 맞추기 금지. reasoning → evidence_quote → verdict 순서 필수

# A3. Outcome Presence & Clarity

## Standard

Absolute — 모든 level에서 "so what?" 답변 필수. 크기나 도메인과 무관하게 outcome이 명시되어야 함.

## P1 Decision Rule

**A3 P1 rule**: "Outcome type boundary unclear."

bullet이 어떤 outcome(효과)를 시사하나, 그것이 tech metric(latency, throughput, error rate 등)인지 business metric(revenue, conversion 등)인지 분류 불가한 경우 P1. "improved performance", "enhanced user experience" 등이 전형적 type-ambiguous 표현. 이 경우 FAIL 2(no magnitude)처럼 outcome이 완전히 공허하지는 않으나, PASS 조건도 충족 못 함.

**A3 PASS 조건**: numeric outcome(`\d+\s*%|\d+\s*(ms|초|배|건|회|명)`)이 outcome verb(`달성|개선|단축|증가|감소|확보|향상`)와 함께 명시되어야 PASS. 수치 없는 fuzzy noun("성능 개선", "속도 향상")은 P1. outcome 자체가 없거나 vanity outcome("팀 만족도 향상" 지표 없음)은 FAIL.

## PASS Exemplars

### PASS Exemplar 1 — Tech outcome alone (engineer-controllable)

Bullet: "Added read-through cache to product catalog, reducing DB CPU from 80% peak to 30% and p99 latency 400ms→60ms"

Why PASS:
- Tech outcome 2개 (DB CPU, p99 latency). 크기 명시 (before/after 모두 존재)
- 엔지니어 직접 통제 범위. "so what?" — DB 부하 절감 + 사용자 응답 개선

### PASS Exemplar 2 — Business outcome with tech context

Bullet: "Redesigned checkout flow API to eliminate 3-round-trip confirmation, cutting checkout abandonment 12%→8% (~$2.4M annualized revenue at 2M monthly sessions)"

Why PASS:
- Business outcome (abandonment %, revenue) + tech cause (round-trip 제거). 크기 명시
- "so what?" — checkout 이탈 감소, 매출 영향 정량 제시

### PASS Exemplar 3 — Reliability outcome

Bullet: "Introduced circuit breaker + fallback cache for payment gateway calls, reducing user-facing 5xx rate from 0.8% to 0.05% during upstream incidents"

Why PASS:
- Reliability metric (5xx rate), context (upstream incidents 시 behavior). 의미 있는 변화
- "so what?" — upstream 장애 시 사용자 노출 오류 대폭 감소

### PASS Exemplar 4 — Cost outcome (engineer-attributable)

Bullet: "Parallelized nightly report generation jobs across 8 workers, cutting AWS batch compute cost from $4,200/mo to $1,100/mo and job completion time from 6h to 55min"

Why PASS:
- Cost + time 모두 정량화. before/after 명확
- "so what?" — 운영 비용 절감, 보고서 가용성 향상

### PASS Exemplar 5 — Build/CI outcome

Bullet: "Replaced sequential integration test suite with parallel sharding (8 shards), reducing CI wall-clock time from 28min to 4min"

Why PASS:
- Tech outcome (CI wall-clock). before/after 명확. 크기가 명확하므로 context 없어도 PASS
- "so what?" — 개발 사이클 단축, PR 피드록 지연 감소

### PASS Exemplar 6 — Throughput outcome

Bullet: "Rewrote synchronous order processing pipeline to async queue-based architecture, increasing peak throughput from 800 to 6,500 RPS without additional infra"

Why PASS:
- Throughput (RPS). before/after + 조건 (additional infra 없음) 명시
- "so what?" — 트래픽 급증 대응 능력 확보

## FAIL Exemplars

### FAIL Exemplar 1 — Vanity metric without context

Bullet: "Achieved p99 200ms on API response"

Why FAIL:
- 숫자만 존재. before/after 없음. baseline 없음. "so what?" 답변 불가
- **vanity metric**: 절대 숫자만으로는 개선인지 기준점인지 알 수 없음
- p99 200ms가 8,000ms에서 개선된 것인지, 처음부터 그랬는지 구분 불가

### FAIL Exemplar 2 — No magnitude, no outcome

Bullet: "Improved database performance through indexing"

Why FAIL:
- "improved"만 있고 magnitude 없음. "so what?" 정량 답변 없음
- 어느 쿼리가 얼마나 빨라졌는지, DB 부하가 얼마나 줄었는지 전무

### FAIL Exemplar 3 — Absent outcome

Bullet: "Refactored authentication module using clean architecture principles for maintainability"

Why FAIL:
- outcome 부재. "clean architecture" 자체는 outcome이 아님
- 유지보수성 개선의 지표(코드 증분, bug rate 변화, feature velocity) 없음
- "so what?" — maintainability 주장만 있고 관찰 가능한 변화 없음

### FAIL Exemplar 4 — Process output mistaken for outcome

Bullet: "Wrote 200 unit tests covering the payment service"

Why FAIL:
- 테스트 작성 자체는 activity. outcome이 아님
- "so what?" — coverage %, bug escape rate 감소, 배포 빈도 변화 등 없음
- 200 tests written ≠ quality improved (관찰 가능한 outcome 필요)

## Block C — Isolated A3 Violation Exemplars

아래 3개 exemplar는 A3 위반만을 격리하여 검증한다. A1(5개 sub-marker 모두), A2, A4, A5는 각 예시에서 PASS 조건을 충족한다.

### C-1 — FAIL: Outcome absent

- Candidate context: Mid, 5 years.
- Bullet: "결제 서비스 인증 모듈의 레거시 의존성 제거라는 요구사항을 해결하기 위해 의존성 분리 방향을 선택했고, 클린 아키텍처 원칙 적용이라는 구현 방식을 채택했다. 팀 내 코드 리뷰 과정에서 공동으로 검토한 결과, 모듈 교체 비용과 유지보수 용이성 간 트레이드오프를 고려했으며 결국 유지보수 부담이 낮아질 것으로 예상된다는 판단 근거로 변경을 승인했다. 리팩터링 작업은 3개월 로드맵 기준으로 진행되었고, 피크 시 메모리 사용량 512MB를 측정 지표로 삼았다."
- Reasoning: A1 sub-marker 모두 존재 — (i) "요구사항", (ii) "선택", (iii) "구현 방식", (iv) "트레이드오프", (v) "판단 근거". A4 scope qualifier "팀 내", "공동". A2 — "512MB"(numeric+MB), "3개월"(temporal). 그러나 A3 PASS 조건인 numeric outcome + outcome verb가 전혀 없음. "유지보수 부담이 낮아질 것으로 예상된다"는 관찰 가능한 수치 없는 activity 서술. **A3 FAIL — outcome absent**.

### C-2 — FAIL: Vanity outcome

- Candidate context: Mid, 4 years.
- Bullet: "온보딩 플로우의 응답 지연 요구사항을 해결하기 위해 API 응답 구조를 재설계하는 방향을 선정하고, 비동기 처리 메커니즘으로 전환하는 구현 방식을 채택했다. 팀 내 협업 리뷰를 통해 동기/비동기 처리 간 트레이드오프를 검토했으며, 개발 속도와 안정성 사이의 대안 비교를 근거로 최종 결정했다. 전환 작업은 1개월 내 완료를 목표로 했고, 배포 패키지 크기 2GB를 기준 측정치로 삼았으며, 평균 배포 완료 후 팀 만족도가 올라갔다."
- Reasoning: A1 sub-marker 모두 존재 — (i) "요구사항", (ii) "선정", (iii) "메커니즘", "구현 방식", (iv) "트레이드오프", "대안 비교", (v) "근거". A4 "팀 내", "협업". A2 — "2GB"(numeric+GB), "1개월"(temporal), "평균"(분포). 그러나 A3의 numeric outcome + outcome verb 패턴이 없음. "팀 만족도가 올라갔다"는 측정 지표 없는 vanity outcome — 수치화되지 않은 감정적 결과물은 PASS 불가. **A3 FAIL — vanity outcome**.

### C-3 — P1: Fuzzy noun outcome

- Candidate context: Junior, 3 years.
- Bullet: "검색 API의 쿼리 응답 지연 요구사항을 해결하기 위해 인덱싱 전략 선택을 검토했고, 복합 인덱스 적용이라는 구현 방식을 채택했다. 팀 내 코드 리뷰에서 인덱스 적용 비용과 조회 성능 간의 트레이드오프를 공동으로 분석했으며, 쿼리 실행 시간이 우선이라는 판단을 근거로 결정했다. 배포 아티팩트 크기 1GB 기준으로 2개월간 측정했고, 결과적으로 쿼리 속도가 빨라졌다."
- Reasoning: A1 sub-marker 모두 존재 — (i) "요구사항", (ii) "선택", (iii) "구현 방식", (iv) "트레이드오프", (v) "판단을 근거". A4 "팀 내", "공동". A2 — "1GB"(numeric+GB), "2개월"(temporal). "쿼리 속도가 빨라졌다"는 outcome을 시사하지만 numeric outcome(`\d+\s*(ms|초|배|%)` 등) 없이 fuzzy noun만 제시됨. outcome type은 tech로 분류 가능하나 magnitude 부재로 type-boundary가 불명확. **A3 P1 — fuzzy noun outcome**.

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Checkout retry completion rate
- Candidate context: Mid, 5 years.
- Bullet: "Hardened error recovery on the checkout retry path; successful completion rate improved from 91% to 97%"
- Reasoning: A3 P1 rule is "Outcome type boundary unclear." Magnitude is present (91%→97%) so the numeric outcome condition is met; the question is type resolution. "Successful completion rate" is dual-coded: HTTP/API success on retry (tech) versus business checkout conversion (business). The "retry path" lexical context nudges the reader toward the tech success-rate reading — type is resolvable within one interpretive step. This sits on the PASS side of the P1 boundary.

### P1 Exemplar 2 — FAIL boundary: "Target metric" score delta
- Candidate context: Senior, 7 years.
- Bullet: "Overhauled pricing calculation service; target metric moved from 72 to 88"
- Reasoning: A3 P1 rule is "Outcome type boundary unclear." Magnitude is present (72→88) so the numeric outcome condition is met; the question is type resolution. "Target metric" is semantically empty: it could be an inverted p99 latency score, accuracy, NPS, satisfaction index, or revenue index. No lexical or contextual cue narrows the metric type at either the bullet or surrounding-phrase level. Type wholly unresolved — this sits on the FAIL side of the P1 boundary.

## Boundary Cases

### EDGE 1 — Qualitative outcome

"Refactored payment integration to enable sandboxing, unblocking QA from coupling on production credentials"

- 정량 아니지만 outcome은 명확 (unblocked). 인과 관계 명시
- 일부 boundary PASS 가능, 하지만 정량이 훨씬 강함
- 가능하면 "QA cycle time 단축" 등 정량 추가 권장

### EDGE 2 — Tech metric without surrounding context

"reduced build time from 12min to 3min"

- tech outcome 명확. context (팀 크기, CI cost) 없어도 PASS (크기가 명확)
- before/after 존재. "so what?" — 9분 단축, 개발 속도 향상 충분히 유추 가능

## Vanity Metric Detection

다음은 vanity metric 징후:
- 절대 숫자만 (before/after, baseline 없음): "p99 200ms", "99.9% uptime"
- 산업 표준과 거리 먼 overly precise 수치: "99.9847% uptime"
- 단일 point 값 without distribution: "avg 100ms" (p99는?)
- Activity count without outcome: "wrote 200 tests", "migrated 50 endpoints"
- 엔지니어 결정과 무관한 대리 지표

## Tech vs Business Outcomes

- **Tech**: latency (p50/p95/p99), throughput (RPS, QPS), error rate, uptime, cost (AWS bill, build time), resource utilization (CPU, memory)
- **Business**: revenue, conversion, retention, user growth, NPS, ticket volume, incident count
- **Hybrid**: capacity (supports X users), cost savings (engineer-attributable)

## Evaluator Guidance

1. **Extract outcome claims**: bullet에서 outcome 관련 문구 식별
2. **Classify**: tech | business | hybrid | absent
3. **Magnitude check**: before/after, % change, 절대값 포함?
4. **Vanity flag**: vanity metric 징후 있는지
5. **Verdict**: PASS | FAIL | P1 (outcome type 모호 시)
6. **Evidence quote**: bullet의 해당 문구 직접 인용

## Common Evaluation Pitfalls

- Tech outcome 있어도 비즈니스 outcome 없으면 무조건 FAIL로 판정 — 오류. 비즈니스 outcome 강제 금지; tech outcome만으로 PASS 가능
- Magnitude 없는 "improved X"를 PASS — FAIL이어야 함. quantify 없으면 "so what?" 답변 불가
- Activity를 outcome으로 혼동 — "wrote tests", "ran migration", "refactored X"는 activity, outcome이 아님
- Qualitative outcome을 무조건 FAIL로 판정 — unblocking, enabling 등 명확한 causality가 있으면 boundary PASS 가능

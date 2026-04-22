# A2. Causal Honesty

## Standard
Absolute — 경력 레벨과 무관하게 동일 기준 적용. 원인→결과 logic과 수치 일관성은 모든 level에서 요구됨. A2 is an **evidence hygiene** axis — not a domain or type classifier.

## P1 Decision Rule

**A2 P1 rule**: "Cause→effect stated but one link unverified."

인과 chain이 bullet에 명시되었으나 측정 창(time window), 비교 baseline, confounder 통제 중 하나가 검증 불가 상태인 경우 P1. FAIL 1(hidden variable)/FAIL 4(correlation-disguised)처럼 chain 자체가 붕괴되지는 않았지만 evidence hygiene 한 항목이 미충족되는 중간 case이다. FAIL Exemplars 5-8는 각각 특정 evidence hygiene rule 위반을 시연하므로 P1 vs FAIL의 경계 판단에 참고.

## Evidence Hygiene Rules

A2는 주장한 cause → effect가 "제시된 근거로 검증 가능한가"를 본다. 수치가 정확해도, 인과 고리가 논리적이어도, 근거의 측정 위생이 무너지면 FAIL이다. 다음 여섯 규칙은 bullet이 검증 가능한 형태를 갖추기 위해 지켜야 하는 최소 조건이다.

1. **Missing comparable baseline** — 개선을 주장하면서 동일 cohort·동일 시즌·동일 부하 패턴의 비교 기준을 제시하지 않는 경우. 비교 조건이 다르면 수치 차이의 원인을 분리할 수 없다. Example violation: "직전 대비 전환율 2.1%p 개선" (Q3 vs Q4 seasonality 미통제).

2. **Missing time window / operating conditions** — 지표를 측정한 기간 또는 측정 당시의 부하·트래픽 프로파일·데이터 상태를 명시하지 않는 경우. window 없이는 snapshot인지 평균인지도 알 수 없다. Example violation: "응답 시간 320ms → 85ms" (언제·어떤 트래픽 조건?).

3. **Offline metric presented as production impact** — offline/lab/backtest에서 측정된 지표를 production에서의 실제 영향인 것처럼 제시하는 경우. 분포 shift·labeling bias·선택 편향으로 전이가 자동 성립하지 않는다. Example violation: "recall 72 → 89%로 사기 대응력 강화" (holdout 지표를 운영 효과로 치환).

4. **Missing distribution (avg vs p99) for scale claims** — 규모·성능 주장을 평균 또는 단일 값만으로 제시하는 경우. 부하 상황에서 tail behavior가 SLA를 결정하므로 분포 없는 주장은 검증 불가. Example violation: "평균 latency 250ms 유지로 5배 트래픽 확장성 증명" (p95/p99 미공개).

5. **Absolute claim without scope and period** — "장애 0건", "100% 자동화", "uptime 100%" 같은 절대 주장을 scope(어느 서비스·컴포넌트)와 period(어느 기간) 없이 제시하는 경우. scope·period 없는 절대 주장은 반증 불가능해 주장이 아니라 수사가 된다. Example violation: "운영 서비스 장애 0건 달성" (어느 서비스, 어느 기간?).

6. **Fuzzy outcome noun without measurement definition** — "생산성", "품질", "adoption", "engagement" 같은 모호한 명사를 어떻게 측정했는지 정의 없이 결과로 제시하는 경우. 측정 정의가 없으면 동일 단어가 서로 다른 지표를 가리킬 수 있어 인과 검증이 성립하지 않는다. Example violation: "개발팀 생산성 30% 향상" (lead time? PR throughput? 자기 보고?).

## Four Sub-checks
1. **Causal Chain Validity**: 원인→결과 chain이 직접적 or 각 단계 명시
2. **Arithmetic Consistency**: 수치(%, 배수, 절대값)가 내부 일관
3. **Constraint Resolution**: 명시된 제약이 해결되거나 explicit accept
4. **(Trigger-conditioned) Chained vs Isolated problem resolution**: bullet이 2+ 문제/제약을 언급할 때만 판정. 단일 문제 bullet은 이 sub-check 대상이 아니며 자동 PASS (N/A). 다중 문제일 때 — **Chained**(선행 해결이 후행 문제를 드러냄, 제약이 연쇄적으로 풀림)는 강한 긍정 신호, **Isolated**(병렬 나열, 독립적 해결)는 중립 PASS. 어느 쪽이든 penalty는 없음. Junior/Mid/Senior 구분 없이 모든 경력 레벨에 동일 적용 — calibration 없음 (A2는 Absolute 축).

## FAIL vs P1 Severity Tier

| Tier | Triggered by |
|------|-------------|
| **Hard FAIL** | Rule 3 (offline-as-production) \| Rule 5 (unscoped absolute) \| 2+ concurrent rule violations \| Sub-check 1 (Causal Chain Validity) failure \| Sub-check 2 (Arithmetic Consistency) failure \| Sub-check 3 (Constraint Resolution) failure |
| **Soft P1** | Rule 1 (missing comparable baseline) standalone \| Rule 2 (missing time window / operating conditions) standalone \| Rule 4 (missing distribution) standalone \| Rule 6 (fuzzy outcome noun) standalone |

**Compound violations**: 두 개 이상의 rule 위반이 동시에 존재하면 개별 tier에 관계없이 Hard FAIL로 격상.

---

## PASS Exemplars

### PASS Exemplar 1 — Direct causal chain + consistent numbers
Bullet: "Replaced N+1 query with batched JOIN (single round-trip), reducing order-list page backend time from 2.4s to 180ms (13x speedup) on 50k-row table"

Why PASS:
- Cause (N+1 → batch JOIN) → effect (round-trip 감소) 직접적
- 2400ms / 180ms ≈ 13.3x — arithmetic 일관
- Constraint (50k rows) context 명시

### PASS Exemplar 2 — Multi-step chain with each step articulated
Bullet: "Adopted read-replica for list endpoints → primary write load 60% → reduced lock contention → p99 write latency 900ms→240ms"

Why PASS: Multi-step chain 각 단계 명시. 중간 변수(write load 감소)가 최종 효과(p99 감소) 설명.

### PASS Exemplar 3 — Trade-off explicit accept
Bullet: "Enabled eventual consistency on session store (accepted 1-2s propagation), reducing cross-region RTT from 120ms→5ms for session reads"

Why PASS: constraint (eventual consistency의 propagation 지연)를 explicit accept. 결과(RTT 감소) 직접 연결.

### PASS Exemplar 4 — controlled before/after with mechanism
Bullet: "Pipeline p95 latency dropped from 47min to 12min after repartitioning Spark job on high-cardinality key + enabling adaptive query execution; measured pre/post over 4 weeks to control for weekly traffic patterns"

Why PASS:
- Causal mechanism 명시: repartitioning on high-cardinality key → data skew 제거, adaptive query execution → runtime plan optimization
- Before/after 수치 명확 (47min → 12min)
- 측정 기간(4주) 명시로 weekly traffic pattern confound 통제 — correlation-only 해석 배제

### PASS Exemplar 5 — mechanism + verification tool + downstream metric
Bullet: "Frontend bundle size reduced 2.3MB → 680KB by route-level code splitting + tree shaking unused lodash imports; verified via Webpack Bundle Analyzer before deploy, LCP metric improved 1.8s → 0.9s on p75"

Why PASS:
- Mechanism 이중 명시: route-level code splitting (lazy load) + tree shaking (dead code elimination)
- 검증 도구(Webpack Bundle Analyzer) 명시 — 측정 신뢰성 보강
- Downstream metric(LCP p75) 연결로 browser rendering 개선까지 causal chain 완성
- 숨겨진 변수(서버 변경, 마케팅) 개입 경로 없음 — bundle size는 직접 측정 가능한 technical artifact

---

## FAIL Exemplars

### FAIL Exemplar 1 — Hidden variable (logical gap)
Bullet: "Rewrote frontend in Next.js, reducing sign-up conversion cart abandonment from 45% to 18%"

Why FAIL:
- Frontend rewrite ≠ conversion 개선의 직접적 cause. 숨겨진 변수 (UX 개선? 서버 변경? 마케팅?) 가능성 높음
- conversion/abandonment는 여러 factor의 함수 — bullet은 이를 rewrite로 환원

### FAIL Exemplar 2 — Arithmetic contradiction
Bullet: "Doubled throughput from 10k RPS to 15k RPS by adding cache layer"

Why FAIL: 10→15 = 1.5x, not 2x. 내부 수치 모순.

### FAIL Exemplar 3 — Unresolved constraint
Bullet: "Achieved 99.99% uptime on payment API while migrating from MySQL to PostgreSQL"

Why FAIL: Migration 자체가 downtime을 암시하는 constraint. 99.99% 달성 방식(blue-green? read-replica first?) 없음 — constraint 미해결.

### FAIL Exemplar 4 — Correlation disguised as causation (confounded multi-variable change)
Bullet: "Migrated to React 18, saw 40% performance improvement across all pages"

Why FAIL:
- Framework 버전 전환과 동시에 인프라 업그레이드, 트래픽 감소, 캐시 설정 변경 등 다수 변수 동시 변경 가능성 높음
- "40% performance improvement" — 어떤 metric인지 불명 (LCP? TTI? 서버 응답시간?)
- React 18 자체의 개선(Concurrent features, automatic batching)이 어느 부분에서 기여했는지 mechanism 미명시
- baseline/공변수 통제 없음 — 시간적 선후관계만 존재, causation 추론 불가

### FAIL Exemplar 5 — 분기 매출 전환의 seasonality 혼입 + 인과 단정

Bullet: "Q4 구매 전환율 8.4% 달성, 직전 대비 2.1%p 개선 — 결제 플로우 개편으로 인한 이탈 감소가 전환율 상승을 견인"

**violated rules**: Rule 1 (Missing comparable baseline) + Sub-check 1 (Causal Chain Validity) failure

Why FAIL:
- **Rule 1 위반**: "직전"이 Q3인지 작년 Q4인지 불분명. Q3 → Q4는 연말 프로모션 트래픽이라 cohort 자체가 다름 → seasonality confound. 동일 조건(동일 분기, 동일 프로모션 강도) baseline 없으면 개선이 작업 결과인지 계절 효과인지 분리 불가.
- **Sub-check 1 failure**: Rule 1 위반의 결과로 causal chain 자체가 붕괴됨. "결제 플로우 개편으로 인한 이탈 감소가 견인"은 control group 없이 단일 개입의 인과 효과를 단정 — 동 기간 마케팅 강화, 경쟁사 이슈, 프로모션 조건 변경 등 공변수가 통제되지 않았음에도 플로우 개편을 직접 원인으로 제시 → causation overreach로 Causal Chain Validity 붕괴.
- **Compound**: Rule 1 + Sub-check 1 failure → Hard FAIL.
- 필요 근거: YoY(작년 Q4 대비) 비교 또는 프로모션 통제 조건 하의 A/B lift; 플로우 개편 이외 변수를 통제한 실험 설계 또는 hold-out 비교군.

### FAIL Exemplar 6 — Backtest metric tied to realized financial impact

Bullet: "Trained a new gradient boosting model for fraud detection, improving the F1 score from 0.82 to 0.89 and saving $100k in chargebacks."

**violated rule**: Offline metric presented as production impact

Why FAIL:
- The F1 score improvement is an offline/backtest metric, but it is seamlessly chained to a production financial impact ("saving $100k") without proving production deployment.
- Offline accuracy does not guarantee production performance due to real-world data drift, latency constraints, or integration bugs — the link from holdout metric to realized chargeback reduction is the unverified step.
- 필요 근거: offline 지표(F1 on holdout set)와 production 영향(실제 chargeback 감소, 정해진 기간·traffic slice 기준)을 분리해 각각 측정값으로 제시.

### FAIL Exemplar 7 — 스케일 속 평균 유지만 제시

Bullet: "트래픽 5배 증가 상황에서 평균 latency 250ms 유지로 안정적 확장성 증명"

**violated rules**: Rule 4 (Missing distribution — avg vs p99 for scale claims) + Sub-check 1 (Causal Chain Validity) failure

Why FAIL:
- **Rule 4 위반**: scale claim(5배 증가)에서 평균 유지는 p95/p99이 폭증해도 성립 가능 — 평균은 throughput 증가 시 tail에 의해 잘 움직이지 않음.
- **Sub-check 1 failure**: "확장성 증명"은 tail latency의 안정성으로만 검증됨에도 평균만 제시 → scale → 안정성 인과 고리에서 tail 증거가 비어 있음. 5배 트래픽 하에서 안정성이 성립한다는 인과 결론이 tail 분포 데이터 없이 붕괴.
- **Compound**: Rule 4 + Sub-check 1 failure → Hard FAIL.
- 필요 근거: 5배 트래픽 시점의 p95/p99, error rate, saturation point 부근에서의 latency 분포 shape.

### FAIL Exemplar 8 — 장애 0건 달성

Bullet: "안정화 작업을 통해 운영 서비스 장애 0건 달성"

**violated rule**: Absolute claim without scope and period

Why FAIL:
- 어느 서비스인지(scope) 없음 — 전체 회사 서비스 vs 담당 서비스 vs 특정 컴포넌트?
- 어느 기간인지(period) 없음 — 1주? 분기? 연간? 배포 이후 3일? 절대 주장은 scope·period 없이는 반증 불가능해 인과 검증이 아니라 수사가 됨.
- 필요 근거: 대상 서비스명, 관측 기간, incident 정의(severity threshold), SLO 기준.

---

## Block B Exemplars

Block B는 A2 evidence hygiene rule 위반을 하나씩 격리한 6개의 한국어 prose 예시다. 각 exemplar는 A1 (5 sub-marker 전부), A3 (numeric outcome + 달성/개선 동사), A4 (팀 내·개인 기여 등 scope qualifier) 조건을 갖추되, 지정된 A2 rule 하나만 위반한다.

### B-1 — FAIL (Sub-check 2: Arithmetic Consistency error)

주문 처리 서비스의 N+1 쿼리 문제를 배치 JOIN으로 전환하는 것이 핵심 제약 조건이었고, 팀 내 논의를 거쳐 Hibernate batch fetch 방식을 채택했다. 메커니즘은 쿼리 왕복 횟수를 N+1회에서 1회로 줄여 DB 락 경합을 제거하는 것이며, 트레이드오프로 쿼리 복잡도가 증가하는 대신 응답 시간이 단축되는 장단점을 비교해 결정했으며 이 선택의 근거는 페이지 로드 SLA 위반이 반복됐다는 프로파일링 데이터였다. 이 개선을 통해 주문 목록 조회 API 응답 시간을 800ms에서 200ms로 단축해 75% 개선을 달성했으며, 개인 기여로 쿼리 레이어 전체를 주도했다. 단, "800ms에서 200ms로 75% 단축"은 내부 산술이 맞지 않는다: (800−200)/800 = 75%이지만 bullet에서는 "4배 단축"이라 표현해 1/4배(25% of original)와 75% 개선을 혼용하여 수치 모순이 발생한다.

**violated check**: Sub-check 2 — Arithmetic Consistency (75% 개선 = 4배 단축이 아님; 4배 단축이면 원래의 25% = 75% 감소로 표현은 같지만, bullet이 동시에 "4배 빨라졌다"와 "75% 단축"을 혼재해 배수와 퍼센트 감소를 같은 scale로 제시한 모순)

Why FAIL: arithmetic 표현이 "4배 향상"(before/after = 4:1)과 "75% 단축"(감소율)을 동시에 사용해 내부 일관성 붕괴. 검증 가능한 수치가 서로 다른 결과를 가리킴.

### B-2 — P1 (Rule 2: missing time window — measurement window 부재)

API 게이트웨이 응답 지연이 핵심 제약 조건으로 식별됐고, 팀 내 아키텍처 검토를 통해 인메모리 캐시 레이어 선정을 결정했다. 메커니즘은 DB 조회를 캐시 hit로 대체해 왕복 지연을 제거하는 것이며, 캐시 일관성 비용과 응답 속도 향상 간 트레이드오프를 비교해 채택 근거를 확보했다. 이 작업으로 결제 API 응답 시간 80% 단축을 달성했으며, 개인 기여로 캐시 레이어 구현을 주도했다.

**violated rule**: Rule 2 — missing time window / operating conditions (Soft P1)
- Rule 2 위반: "80% 단축"이 언제·어떤 트래픽 조건에서 측정됐는지 없음. 측정 기간, 트래픽 프로파일, 캐시 warm/cold 상태 미명시.

Why P1: Rule 2 (Missing time window / operating conditions) — measurement window 부재로 seasonality/traffic condition 미통제. 인과 chain(캐시 레이어 → DB 조회 감소 → 응답 시간 단축)은 논리적으로 성립하나, 언제·어떤 조건에서 측정했는지 없어 evidence hygiene 한 항목 미충족 → Soft P1. Rule 2 standalone은 Hard FAIL이 아닌 P1 경계.

### B-3 — P1 (Rule 4: missing distribution — p99 absent when p50 cited)

검색 서비스 latency 스파이크가 제약 조건으로 식별됐고, 팀 내 성능 검토를 거쳐 Elasticsearch 샤드 재분배 방식을 채택했다. 메커니즘은 hot shard 집중을 분산해 처리 균형을 맞추는 것이며, 운영 복잡도 증가 대비 응답 안정성 향상의 트레이드오프를 비교한 근거 하에 결정했다. 이 개선으로 검색 API 중앙값(p50) latency를 420ms에서 180ms로 57% 단축해 달성했으며, 개인 기여로 샤드 전략 설계를 주도했다.

**violated rule**: Rule 4 — missing distribution: p50만 제시, p99 미공개.

Why P1: scale 또는 안정성 주장에서 p50 단독 제시는 tail behavior를 숨긴다. 평균/중앙값이 개선돼도 p99가 폭증하면 SLA 위반 가능 — 분포 없는 주장은 evidence hygiene 한 항목 미충족으로 P1.

### B-4 — FAIL (Rule 3: offline-as-production)

모델 서빙 지연이 핵심 제약 조건이었고, 팀 내 ML 검토를 거쳐 경량화 모델 구조 선정을 결정했다. 메커니즘은 레이어 수를 줄여 추론 연산을 감소시키는 것이며, 정확도 손실 대비 서빙 속도 향상의 트레이드오프를 비교한 근거로 채택했다. 부하 테스트 환경에서 초당 처리 건수를 1,200건에서 4,800건으로 300% 증가를 달성했으며, 개인 기여로 모델 경량화 작업을 주도했다.

**violated rule**: Rule 3 — offline metric presented as production impact: 부하 테스트(load test) 수치를 운영 처리량인 것처럼 제시.

Why FAIL: 부하 테스트 환경은 실제 트래픽 분포, 데이터 다양성, 연계 서비스 latency를 반영하지 않음. "부하 테스트 환경에서"라는 단서가 있어도 production 영향으로 치환해 제시 → offline-as-prod FAIL.

### B-5 — FAIL (Rule 5: unscoped absolute — "100% reliable")

서비스 안정성 저하가 제약 조건으로 식별됐고, 팀 내 SRE 검토를 거쳐 Circuit Breaker 패턴 도입을 채택했다. 메커니즘은 downstream 장애 시 fail-fast로 전파를 차단해 cascading failure를 방지하는 것이며, 응답 지연 허용 대비 가용성 향상의 트레이드오프를 비교한 근거로 결정했다. 이 작업으로 서비스 100% 안정적 운영을 달성했으며, 개인 기여로 Circuit Breaker 구성 전체를 주도했다.

**violated rule**: Rule 5 — unscoped absolute: "100% 안정적 운영" — 어느 서비스인지(scope), 어느 기간인지(period) 미명시.

Why FAIL: scope·period 없는 절대 주장은 반증 불가능한 수사. "100% reliable"은 정의 불가한 절대 주장으로 인과 검증 대상이 아님 → Hard FAIL.

### B-6 — P1 (Rule 6: fuzzy outcome noun — "처리량 향상" 미정의)

배치 파이프라인 병목이 핵심 제약 조건으로 식별됐고, 팀 내 데이터 엔지니어링 검토를 거쳐 Spark 파티셔닝 전략 재설계를 채택했다. 메커니즘은 카디널리티 높은 키 기준으로 파티션을 재분배해 skew를 제거하는 것이며, 파티션 수 증가에 따른 셔플 비용 대비 처리 균형 향상의 트레이드오프를 비교한 근거로 결정했다. 이 개선으로 일별 배치 잡 실행 시간을 81% 단축 달성했으며, 전반적인 처리량 향상을 이루었고, 개인 기여로 파티셔닝 설계를 주도했다.

**violated rule**: Rule 6 — fuzzy outcome noun: "처리량 향상"이 어떻게 측정됐는지 정의 없음. 건/초인지, 잡 완료 시간 단축인지, 리소스 효율인지 불명.

Why P1: 인과 chain(파티션 재설계 → skew 제거 → 처리량 개선)은 논리적이나, 결과 지표의 측정 정의가 없어 evidence hygiene 한 항목 미충족 → P1. 다른 모든 A2 rule은 충족.

---

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: LCP improvement with measurement window but unaccounted concurrent changes
- Candidate context: Mid, 4 years.
- Bullet: "Switched product-listing thumbnails to WebP with srcset responsive loading; LCP p75 improved from 2.4s to 1.1s, measured in RUM over the 2-week rollout window"
- Reasoning: A2 P1 rule is "Cause→effect stated but one link unverified." Full chain present (format change + delivery mechanism → reduced image weight → LCP improvement) with baseline, delta, and a stated measurement window (2-week RUM). One link remains unverified: whether concurrent CDN/config changes during that window contributed. One confounder dimension open while the other core links (mechanism, metric window) are closed — this sits on the PASS side of the P1 boundary.

### P1 Exemplar 2 — FAIL boundary: WebFlux rewrite throughput with downstream scaling silent
- Candidate context: Senior, 6 years.
- Bullet: "Rewrote the API layer from blocking Servlet to WebFlux async I/O; throughput increased from 1,200 RPS to 4,000 RPS"
- Reasoning: A2 P1 rule is "Cause→effect stated but one link unverified." Mechanism (non-blocking I/O → more concurrency) is valid and result is quantified, so the bullet has a real causal chain and does not fall to outright FAIL. The unverified link is whether downstream dependencies (DB, auth service) were scaled in parallel during the test — this single confounder can fully account for the delta. One unverified link, but it is load-bearing, placing this on the PASS side of the FAIL boundary at the absolute edge of P1.

---

## Boundary Cases

### EDGE 1 — Compressed causal description
"p99 200ms via read-replica" — chain이 너무 축약. read-replica → p99 개선은 well-known mechanism이므로 축약 자체만으로는 PASS이지만, context 부족하면 P1으로 flag 가능.

### EDGE 2 — Correlation disguised as causation
"After deploying new auth system, session hijack incidents dropped 80%" — temporal correlation만. cause로 쓸 수 없음 → FAIL 또는 P1.

---

## Evaluator Guidance
1. **Extract arithmetic**: 수치 all extraction — before/after, percentage, multiplier
2. **Check arithmetic**: 계산 일관 확인
3. **Trace causal chain**: cause → mechanism → effect 논리 추적. gap 있으면 flag
4. **Scan constraints**: bullet에 언급된 제약 (scale, consistency, cost 등) 해결 여부
5. **Verdict**: PASS | FAIL | P1 (evidence hygiene 한 항목만 미충족 시)
6. **Evidence quote**: 문제되는 문구 인용

## Arithmetic Check Recipes
- multiplier (increase, throughput-like): `after / before`  — e.g., 10→15 throughput = 15/10 = 1.5x
- multiplier (reduction, latency-like): `before / after`  — e.g., 200ms→50ms latency = 200/50 = 4x
- % improvement (increase): `(after - before) / before * 100`  — e.g., 10→15 = 50%
- % improvement (reduction): `(before - after) / before * 100`  — e.g., 200ms→50ms = 75%
- Rate conversion: "5x" vs "500%" 일관성

## Common Evaluation Pitfalls
- "Improved X by Y%" without baseline (X = what?) → FAIL 아닐 수 있음(A3 fail 가능) 하지만 A2에서 causal chain 파괴 시 FAIL
- Business metric을 tech cause에 즉시 연결 (숨겨진 변수 주의)

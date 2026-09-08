# A2. Causal Honesty

## Standard
Absolute — apply the same standard regardless of experience level. Cause→effect logic and numerical consistency are required at every level. A2 is an **evidence hygiene** axis — not a domain or type classifier.

## P1 Decision Rule

**A2 P1 rule**: "Cause→effect stated but one link unverified."

Assign P1 when the bullet states a causal chain but one of the measurement time window, comparison baseline, or confounder controls cannot be verified. This is an intermediate case: the chain itself has not collapsed as in FAIL 1 (hidden variable)/FAIL 4 (correlation-disguised), but one evidence hygiene item is unmet. FAIL Exemplars 5–8 each demonstrate a specific evidence hygiene rule violation; refer to them when judging the P1 vs FAIL boundary.

## Evidence Hygiene Rules

A2 asks whether the claimed cause → effect is "verifiable from the evidence provided." Even with correct numbers and a logical causal link, broken measurement hygiene in the evidence means FAIL. The following six rules are the minimum conditions a bullet must meet to be verifiable.

1. **Missing comparable baseline** — claiming improvement without a comparison baseline from the same cohort, season, and load pattern. Different comparison conditions prevent isolating the cause of the numerical difference. Example violation: "직전 대비 전환율 2.1%p 개선" (uncontrolled Q3 vs Q4 seasonality).

2. **Missing time window / operating conditions** — omitting the measurement period or the load, traffic profile, or data state during measurement. Without a window, even whether the metric is a snapshot or an average is unknown. Example violation: "응답 시간 320ms → 85ms" (when and under what traffic conditions?).

3. **Offline metric presented as production impact** — presenting offline/lab/backtest metrics as actual production impact. Distribution shift, labeling bias, and selection bias mean the transfer does not hold automatically. Example violation: "recall 72 → 89%로 사기 대응력 강화" (substituting a holdout metric for production impact).

4. **Missing distribution (avg vs p99) for scale claims** — presenting a scale or performance claim using only an average or a single value. Under load, tail behavior determines the SLA, so a claim without a distribution cannot be verified. Example violation: "평균 latency 250ms 유지로 5배 트래픽 확장성 증명" (undisclosed p95/p99).

5. **Absolute claim without scope and period** — presenting absolute claims such as "장애 0건", "100% 자동화", or "uptime 100%" without scope (which service or component) and period (which time interval). An absolute claim without scope and period is unfalsifiable rhetoric rather than a claim. Example violation: "운영 서비스 장애 0건 달성" (which service and which period?).

6. **Fuzzy outcome noun without measurement definition** — presenting vague nouns such as "생산성", "품질", "adoption", or "engagement" as outcomes without defining how they were measured. Without a measurement definition, the same word can refer to different metrics, preventing causal verification. Example violation: "개발팀 생산성 30% 향상" (lead time? PR throughput? self-report?).

## Four Sub-checks
1. **Causal Chain Validity**: the cause→effect chain is direct or every step is explicit
2. **Arithmetic Consistency**: numbers (percentages, multipliers, absolute values) are internally consistent
3. **Constraint Resolution**: stated constraints are resolved or explicitly accepted
4. **(Trigger-conditioned) Chained vs Isolated problem resolution**: evaluate only when a bullet mentions 2+ problems/constraints. Single-problem bullets are outside this sub-check and automatically PASS (N/A). For multiple problems — **Chained** (an earlier solution reveals a later problem; constraints resolve in sequence) is a strong positive signal; **Isolated** (parallel listing, independent solutions) is a neutral PASS. Neither incurs a penalty. Apply identically across Junior/Mid/Senior and all experience levels — no calibration (A2 is an Absolute axis).

## FAIL vs P1 Severity Tier

| Tier | Triggered by |
|------|-------------|
| **Hard FAIL** | Rule 3 (offline-as-production) \| Rule 5 (unscoped absolute) \| 2+ concurrent rule violations \| Sub-check 1 (Causal Chain Validity) failure \| Sub-check 2 (Arithmetic Consistency) failure \| Sub-check 3 (Constraint Resolution) failure |
| **Soft P1** | Rule 1 (missing comparable baseline) standalone \| Rule 2 (missing time window / operating conditions) standalone \| Rule 4 (missing distribution) standalone \| Rule 6 (fuzzy outcome noun) standalone |

**Compound violations**: two or more simultaneous rule violations escalate to Hard FAIL regardless of their individual tiers.

---

## PASS Exemplars

### PASS Exemplar 1 — Direct causal chain + consistent numbers
Bullet: "Replaced N+1 query with batched JOIN (single round-trip), reducing order-list page backend time from 2.4s to 180ms (13x speedup) on 50k-row table"

Why PASS:
- Cause (N+1 → batch JOIN) → effect (fewer round-trips) is direct
- 2400ms / 180ms ≈ 13.3x — consistent arithmetic
- Constraint (50k rows) context is explicit

### PASS Exemplar 2 — Multi-step chain with each step articulated
Bullet: "Adopted read-replica for list endpoints → primary write load 60% → reduced lock contention → p99 write latency 900ms→240ms"

Why PASS: Every step of the multi-step chain is explicit. The intermediate variable (reduced write load) explains the final effect (reduced p99).

### PASS Exemplar 3 — Trade-off explicit accept
Bullet: "Enabled eventual consistency on session store (accepted 1-2s propagation), reducing cross-region RTT from 120ms→5ms for session reads"

Why PASS: Explicitly accepts the constraint (propagation delay under eventual consistency). Directly links to the outcome (reduced RTT).

### PASS Exemplar 4 — controlled before/after with mechanism
Bullet: "Pipeline p95 latency dropped from 47min to 12min after repartitioning Spark job on high-cardinality key + enabling adaptive query execution; measured pre/post over 4 weeks to control for weekly traffic patterns"

Why PASS:
- Explicit causal mechanism: repartitioning on a high-cardinality key → eliminates data skew; adaptive query execution → runtime plan optimization
- Clear before/after numbers (47min → 12min)
- The explicit measurement period (four weeks) controls the weekly traffic pattern confound — rules out a correlation-only interpretation

### PASS Exemplar 5 — mechanism + verification tool + downstream metric
Bullet: "Frontend bundle size reduced 2.3MB → 680KB by route-level code splitting + tree shaking unused lodash imports; verified via Webpack Bundle Analyzer before deploy, LCP metric improved 1.8s → 0.9s on p75"

Why PASS:
- Two explicit mechanisms: route-level code splitting (lazy load) + tree shaking (dead code elimination)
- Explicit verification tool (Webpack Bundle Analyzer) — strengthens measurement reliability
- Linking the downstream metric (LCP p75) completes the causal chain through browser rendering improvement
- No path for hidden variables (server changes, marketing) to intervene — bundle size is a directly measurable technical artifact

---

## FAIL Exemplars

### FAIL Exemplar 1 — Hidden variable (logical gap)
Bullet: "Rewrote frontend in Next.js, reducing sign-up conversion cart abandonment from 45% to 18%"

Why FAIL:
- A frontend rewrite ≠ a direct cause of improved conversion. Hidden variables (UX improvements? server changes? marketing?) are highly likely
- Conversion/abandonment is a function of multiple factors — the bullet reduces it to the rewrite

### FAIL Exemplar 2 — Arithmetic contradiction
Bullet: "Doubled throughput from 10k RPS to 15k RPS by adding cache layer"

Why FAIL: 10→15 = 1.5x, not 2x. Internal numerical contradiction.

### FAIL Exemplar 3 — Unresolved constraint
Bullet: "Achieved 99.99% uptime on payment API while migrating from MySQL to PostgreSQL"

Why FAIL: Migration itself is a constraint implying downtime. No method for achieving 99.99% (blue-green? read-replica first?) — unresolved constraint.

### FAIL Exemplar 4 — Correlation disguised as causation (confounded multi-variable change)
Bullet: "Migrated to React 18, saw 40% performance improvement across all pages"

Why FAIL:
- Multiple variables may well have changed with the framework version: infrastructure upgrades, lower traffic, cache configuration changes, etc.
- "40% performance improvement" — unclear metric (LCP? TTI? server response time?)
- No mechanism specifies where React 18's own improvements (Concurrent features, automatic batching) contributed
- No baseline/covariate controls — only temporal sequence, which cannot support causal inference

### FAIL Exemplar 5 — Seasonality confound in quarterly sales conversion + asserted causation

Bullet: "Q4 구매 전환율 8.4% 달성, 직전 대비 2.1%p 개선 — 결제 플로우 개편으로 인한 이탈 감소가 전환율 상승을 견인"

**violated rules**: Rule 1 (Missing comparable baseline) + Sub-check 1 (Causal Chain Validity) failure

Why FAIL:
- **Rule 1 violation**: "직전" could mean Q3 or last year's Q4. Q3 → Q4 involves year-end promotional traffic, changing the cohort itself → seasonality confound. Without a baseline under identical conditions (same quarter, same promotional intensity), the work's effect cannot be separated from seasonal effects.
- **Sub-check 1 failure**: The Rule 1 violation collapses the causal chain itself. "결제 플로우 개편으로 인한 이탈 감소가 견인" asserts a single intervention's causal effect without a control group — the flow redesign is presented as the direct cause despite uncontrolled covariates such as increased marketing, competitor issues, or changed promotional terms during the same period → causal overreach breaks Causal Chain Validity.
- **Compound**: Rule 1 + Sub-check 1 failure → Hard FAIL.
- Required evidence: a YoY comparison (against last year's Q4) or A/B lift under controlled promotional conditions; an experimental design controlling variables other than the flow redesign, or a hold-out comparison group.

### FAIL Exemplar 6 — Backtest metric tied to realized financial impact

Bullet: "Trained a new gradient boosting model for fraud detection, improving the F1 score from 0.82 to 0.89 and saving $100k in chargebacks."

**violated rule**: Offline metric presented as production impact

Why FAIL:
- The F1 score improvement is an offline/backtest metric, but it is seamlessly chained to a production financial impact ("saving $100k") without proving production deployment.
- Offline accuracy does not guarantee production performance due to real-world data drift, latency constraints, or integration bugs — the link from holdout metric to realized chargeback reduction is the unverified step.
- Required evidence: separate offline metrics (F1 on holdout set) from production impact (actual chargeback reduction for a defined period and traffic slice), and present each as a measured value.

### FAIL Exemplar 7 — Only a maintained average presented under scale

Bullet: "트래픽 5배 증가 상황에서 평균 latency 250ms 유지로 안정적 확장성 증명"

**violated rules**: Rule 4 (Missing distribution — avg vs p99 for scale claims) + Sub-check 1 (Causal Chain Validity) failure

Why FAIL:
- **Rule 4 violation**: maintaining an average in a scale claim (5× growth) is possible even if p95/p99 spikes — the average is not very sensitive to the tail as throughput rises.
- **Sub-check 1 failure**: "확장성 증명" can only be verified through tail-latency stability, yet only the average is presented → the scale → stability causal link lacks tail evidence. Without tail-distribution data, the causal conclusion of stability under 5× traffic collapses.
- **Compound**: Rule 4 + Sub-check 1 failure → Hard FAIL.
- Required evidence: p95/p99 at 5× traffic, error rate, and the shape of the latency distribution near saturation.

### FAIL Exemplar 8 — Achieving zero incidents

Bullet: "안정화 작업을 통해 운영 서비스 장애 0건 달성"

**violated rule**: Absolute claim without scope and period

Why FAIL:
- No service scope — all company services, the assigned service, or a particular component?
- No period — one week? a quarter? a year? three days after deployment? Without scope and period, an absolute claim is unfalsifiable rhetoric rather than causal verification.
- Required evidence: target service name, observation period, incident definition (severity threshold), and SLO criteria.

---

## Block B Exemplars

Block B contains six Korean prose examples isolating A2 evidence hygiene rule violations one at a time. Each exemplar meets A1 (all five sub-markers), A3 (numeric outcome + a 달성/개선 verb), and A4 (scope qualifiers such as 팀 내·개인 기여), while violating only the designated A2 rule.

### B-1 — FAIL (Sub-check 2: Arithmetic Consistency error)

주문 처리 서비스의 N+1 쿼리 문제를 배치 JOIN으로 전환하는 것이 핵심 제약 조건이었고, 팀 내 논의를 거쳐 Hibernate batch fetch 방식을 채택했다. 메커니즘은 쿼리 왕복 횟수를 N+1회에서 1회로 줄여 DB 락 경합을 제거하는 것이며, 트레이드오프로 쿼리 복잡도가 증가하는 대신 응답 시간이 단축되는 장단점을 비교해 결정했으며 이 선택의 근거는 페이지 로드 SLA 위반이 반복됐다는 프로파일링 데이터였다. 이 개선을 통해 주문 목록 조회 API 응답 시간을 800ms에서 200ms로 단축해 6배 성능 향상을 달성했으며, 개인 기여로 쿼리 레이어 전체를 주도했다.

**violated check**: Sub-check 2 — Arithmetic Consistency (claimed 6× improvement vs actual 4× ratio; 800ms → 200ms gives before/after = 4:1, so 4× improvement is correct, but the bullet claims "6배 성능 향상", contradicting the measured ratio)

Why FAIL: The actual multiplier for 800ms → 200ms is 800/200 = 4×, but claiming "6배 향상" creates arithmetic inconsistency. Claimed 6× vs real 4× — the numbers indicate different outcomes, breaking internal consistency.

### B-2 — P1 (Rule 2: missing time window — measurement window absent)

API 게이트웨이 응답 지연이 핵심 제약 조건으로 식별됐고, 팀 내 아키텍처 검토를 통해 인메모리 캐시 레이어 선정을 결정했다. 메커니즘은 DB 조회를 캐시 hit로 대체해 왕복 지연을 제거하는 것이며, 캐시 일관성 비용과 응답 속도 향상 간 트레이드오프를 비교해 채택 근거를 확보했다. 이 작업으로 결제 API 응답 시간 80% 단축을 달성했으며, 개인 기여로 캐시 레이어 구현을 주도했다.

**violated rule**: Rule 2 — missing time window / operating conditions (Soft P1)
- Rule 2 violation: no indication of when or under which traffic conditions "80% 단축" was measured. Measurement period, traffic profile, and cache warm/cold state are unspecified.

Why P1: Rule 2 (Missing time window / operating conditions) — the absent measurement window leaves seasonality/traffic conditions uncontrolled. The causal chain (cache layer → fewer DB queries → shorter response time) is logical, but the missing measurement timing and conditions leave one evidence hygiene item unmet → Soft P1. Standalone Rule 2 falls at the P1 boundary, not Hard FAIL.

### B-3 — P1 (Rule 4: missing distribution — p99 absent when p50 cited)

검색 서비스 latency 스파이크가 제약 조건으로 식별됐고, 팀 내 성능 검토를 거쳐 Elasticsearch 샤드 재분배 방식을 채택했다. 메커니즘은 hot shard 집중을 분산해 처리 균형을 맞추는 것이며, 운영 복잡도 증가 대비 응답 안정성 향상의 트레이드오프를 비교한 근거 하에 결정했다. 이 개선으로 검색 API 중앙값(p50) latency를 420ms에서 180ms로 57% 단축해 달성했으며, 개인 기여로 샤드 전략 설계를 주도했다.

**violated rule**: Rule 4 — missing distribution: only p50 is presented; p99 is undisclosed.

Why P1: Presenting only p50 in a scale or stability claim hides tail behavior. Even with an improved average/median, a p99 spike can violate the SLA — a claim without a distribution leaves one evidence hygiene item unmet, yielding P1.

### B-4 — FAIL (Rule 3: offline-as-production)

모델 서빙 지연이 핵심 제약 조건이었고, 팀 내 ML 검토를 거쳐 경량화 모델 구조 선정을 결정했다. 메커니즘은 레이어 수를 줄여 추론 연산을 감소시키는 것이며, 정확도 손실 대비 서빙 속도 향상의 트레이드오프를 비교한 근거로 채택했다. 부하 테스트 환경에서 초당 처리 건수를 1,200건에서 4,800건으로 300% 증가를 달성했으며, 개인 기여로 모델 경량화 작업을 주도했다.

**violated rule**: Rule 3 — offline metric presented as production impact: load-test numbers are presented as production throughput.

Why FAIL: A load-test environment does not reflect actual traffic distribution, data diversity, or dependent-service latency. Even with the qualifier "부하 테스트 환경에서", the result is presented as a substitute for production impact → offline-as-prod FAIL.

### B-5 — FAIL (Rule 5: unscoped absolute — "100% reliable")

서비스 안정성 저하가 제약 조건으로 식별됐고, 팀 내 SRE 검토를 거쳐 Circuit Breaker 패턴 도입을 채택했다. 메커니즘은 downstream 장애 시 fail-fast로 전파를 차단해 cascading failure를 방지하는 것이며, 응답 지연 허용 대비 가용성 향상의 트레이드오프를 비교한 근거로 결정했다. 이 작업으로 서비스 100% 안정적 운영을 달성했으며, 개인 기여로 Circuit Breaker 구성 전체를 주도했다.

**violated rule**: Rule 5 — unscoped absolute: "100% 안정적 운영" — no specified service (scope) or time interval (period).

Why FAIL: An absolute claim without scope and period is unfalsifiable rhetoric. "100% reliable" is an undefined absolute claim, not subject to causal verification → Hard FAIL.

### B-6 — P1 (Rule 6: fuzzy outcome noun — undefined "처리량 향상")

배치 파이프라인 병목이 핵심 제약 조건으로 식별됐고, 팀 내 데이터 엔지니어링 검토를 거쳐 Spark 파티셔닝 전략 재설계를 채택했다. 메커니즘은 카디널리티 높은 키 기준으로 파티션을 재분배해 skew를 제거하는 것이며, 파티션 수 증가에 따른 셔플 비용 대비 처리 균형 향상의 트레이드오프를 비교한 근거로 결정했다. 이 개선으로 일별 배치 잡 실행 시간을 81% 단축 달성했으며, 전반적인 처리량 향상을 이루었고, 개인 기여로 파티셔닝 설계를 주도했다.

**violated rule**: Rule 6 — fuzzy outcome noun: no definition of how "처리량 향상" was measured. It is unclear whether this means items/second, shorter job completion time, or resource efficiency.

Why P1: The causal chain (partition redesign → skew removal → throughput improvement) is logical, but the outcome metric lacks a measurement definition, leaving one evidence hygiene item unmet → P1. All other A2 rules are met.

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
"p99 200ms via read-replica" — the chain is overly compressed. Because read-replica → p99 improvement is a well-known mechanism, compression alone still permits PASS, but insufficient context may warrant a P1 flag.

### EDGE 2 — Correlation disguised as causation
"After deploying new auth system, session hijack incidents dropped 80%" — temporal correlation only. Cannot be used as a cause → FAIL or P1.

---

## Evaluator Guidance
1. **Extract arithmetic**: extract all numbers — before/after, percentage, multiplier
2. **Check arithmetic**: verify calculation consistency
3. **Trace causal chain**: trace the cause → mechanism → effect logic. Flag any gap
4. **Scan constraints**: check whether constraints mentioned in the bullet (scale, consistency, cost, etc.) are resolved
5. **Verdict**: PASS | FAIL | P1 (when only one evidence hygiene item is unmet)
6. **Evidence quote**: quote the problematic wording

## Arithmetic Check Recipes
- multiplier (increase, throughput-like): `after / before`  — e.g., 10→15 throughput = 15/10 = 1.5x
- multiplier (reduction, latency-like): `before / after`  — e.g., 200ms→50ms latency = 200/50 = 4x
- % improvement (increase): `(after - before) / before * 100`  — e.g., 10→15 = 50%
- % improvement (reduction): `(before - after) / before * 100`  — e.g., 200ms→50ms = 75%
- Rate conversion: consistency of "5x" vs "500%"

## Common Evaluation Pitfalls
- "Improved X by Y%" without baseline (X = what?) → may not be FAIL (A3 may fail), but FAIL in A2 if the causal chain breaks
- Directly linking a business metric to a technical cause (watch for hidden variables)

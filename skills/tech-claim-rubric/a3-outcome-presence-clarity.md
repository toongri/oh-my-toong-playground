# A3. Outcome Presence & Clarity

## Standard

Absolute — an answer to "so what?" is required at every level. The outcome must be explicit regardless of magnitude or domain.

## P1 Decision Rule

**A3 P1 rule**: "Outcome type boundary unclear."

Assign P1 when a bullet suggests an outcome (effect), but it cannot be classified as a tech metric (latency, throughput, error rate, etc.) or business metric (revenue, conversion, etc.). "Improved performance" and "enhanced user experience" are typical type-ambiguous phrases. Unlike FAIL 2 (no magnitude), the outcome is not entirely empty, but it does not meet the PASS conditions either.

**A3 PASS conditions**: all three conjuncts of the A3 PASS Gate below must hold simultaneously for PASS. A fuzzy noun without numbers ("성능 개선", "속도 향상") is P1 for not meeting conjunct 2 (sufficient-form). An absent outcome or vanity metric (an absolute value without baseline/before-after) is FAIL for not meeting conjunct 1 or conjunct 3.
<!-- Note: unit tokens RPS, QPS, GB, MB are uppercase-only in the pattern above; lowercase variants (rps, qps, gb, mb) are not matched and should be treated as unrecognized units requiring evaluator judgment. -->

### A3 PASS Gate

A3 PASS holds only when **all three conjuncts (AND)** below are met. If any one is unmet, PASS is not possible.

**Conjunct 1 — outcome-present**: an outcome exists and is not tautological. "Improved performance" with no magnitude is tautological; "Wrote 200 tests" is an activity, not an outcome.

**Conjunct 2 — sufficient-form**: meet one of the following two forms (OR).
- **qualitative-causality form**: qualitative outcome + explicit causality chain + resolution verb (e.g., `unblocking`, `eliminating`). Numeric magnitude is not required.
- **numeric form**: numeric outcome token(`[$₩]\d{1,3}(,\d{3})*(\.\d+)?[MKB]?|\d{1,3}(,\d{3})*(\.\d+)?\s*(ms|s|sec|min|h|초|배|건|회|명|분|시간|원|만원|RPS|QPS|GB|MB|%|x)`) + outcome verb(`달성|개선|단축|증가|감소|확보|향상|reduced|reducing|dropped|dropping|eliminated|eliminating|cut|cutting|boosted|boosting|improved|improving|increased|increasing|achieved|achieving`).

**Conjunct 3 — non-vanity**: the metric is not a vanity metric. If any of the following applies, it is vanity and therefore FAIL.
- Only an absolute number exists, without before/after or baseline context (e.g., "Achieved p99 200ms" — improvement cannot be determined).
- When the qualitative-causality form is met, this conjunct is automatically met (the causal chain implies the direction of improvement).

## PASS Exemplars

### PASS Exemplar 1 — Tech outcome alone (engineer-controllable)

Bullet: "Added read-through cache to product catalog, reducing DB CPU from 80% peak to 30% and p99 latency 400ms→60ms"

Why PASS:
- Two tech outcomes (DB CPU, p99 latency). Magnitude explicit (both before and after present)
- Within the engineer's direct control. "so what?" — reduced DB load + improved user response

### PASS Exemplar 2 — Business outcome with tech context

Bullet: "Redesigned checkout flow API to eliminate 3-round-trip confirmation, cutting checkout abandonment 12%→8% (~$2.4M annualized revenue at 2M monthly sessions)"

Why PASS:
- Business outcome (abandonment %, revenue) + technical cause (round-trip elimination). Magnitude explicit
- "so what?" — reduced checkout abandonment, quantified revenue impact

### PASS Exemplar 3 — Reliability outcome

Bullet: "Introduced circuit breaker + fallback cache for payment gateway calls, reducing user-facing 5xx rate from 0.8% to 0.05% during upstream incidents"

Why PASS:
- Reliability metric (5xx rate), context (behavior during upstream incidents). Meaningful change
- "so what?" — substantial reduction in user-facing errors during upstream failures

### PASS Exemplar 4 — Cost outcome (engineer-attributable)

Bullet: "Parallelized nightly report generation jobs across 8 workers, cutting AWS batch compute cost from $4,200/mo to $1,100/mo and job completion time from 6h to 55min"

Why PASS:
- Cost + time both quantified. Before/after clear
- "so what?" — lower operating cost, improved report availability

### PASS Exemplar 5 — Build/CI outcome

Bullet: "Replaced sequential integration test suite with parallel sharding (8 shards), reducing CI wall-clock time from 28min to 4min"

Why PASS:
- Tech outcome (CI wall-clock). Before/after clear. Explicit magnitude allows PASS even without context
- "so what?" — shorter development cycle, reduced PR feedback delay

### PASS Exemplar 6 — Throughput outcome

Bullet: "Rewrote synchronous order processing pipeline to async queue-based architecture, increasing peak throughput from 800 to 6,500 RPS without additional infra"

Why PASS:
- Throughput (RPS). Before/after + condition (no additional infra) explicit
- "so what?" — gained capacity to handle traffic surges

## FAIL Exemplars

### FAIL Exemplar 1 — Vanity metric without context

Bullet: "Achieved p99 200ms on API response"

Why FAIL:
- Only a number. No before/after. No baseline. Cannot answer "so what?"
- **vanity metric**: An absolute number alone cannot distinguish an improvement from a baseline
- Cannot tell whether p99 200ms improved from 8,000ms or was that value from the start

### FAIL Exemplar 2 — No magnitude, no outcome

Bullet: "Improved database performance through indexing"

Why FAIL:
- Only "improved", with no magnitude. No quantitative answer to "so what?"
- No indication of which query became faster, by how much, or how much DB load decreased

### FAIL Exemplar 3 — Absent outcome

Bullet: "Refactored authentication module using clean architecture principles for maintainability"

Why FAIL:
- Outcome absent. "clean architecture" itself is not an outcome
- No maintainability-improvement indicator (code increment, bug-rate change, feature velocity)
- "so what?" — only a maintainability claim, with no observable change

### FAIL Exemplar 4 — Process output mistaken for outcome

Bullet: "Wrote 200 unit tests covering the payment service"

Why FAIL:
- Writing tests itself is an activity, not an outcome
- "so what?" — no coverage %, reduced bug escape rate, deployment-frequency change, etc.
- 200 tests written ≠ quality improved (an observable outcome is required)

### FAIL Exemplar 5 — Unresolvable metric type

Bullet: "Overhauled pricing calculation service; target metric moved from 72 to 88"

Why FAIL:
- Magnitude present (72→88) so numeric outcome condition is met; question is type resolution
- "Target metric" is semantically empty: could be p99 latency score, accuracy, NPS, satisfaction index, or revenue index
- No lexical or contextual cue narrows the metric type at the bullet or surrounding-phrase level
- Type wholly unresolved — does not qualify as P1 boundary; Hard FAIL

## Block C — Isolated A3 Violation Exemplars

The three exemplars below isolate and verify A3 violations only. A1 (all five sub-markers), A2, A4, and A5 meet the PASS conditions in each example.

### C-1 — FAIL: Outcome absent

- Candidate context: Mid, 5 years.
- Bullet: "결제 서비스 인증 모듈의 레거시 의존성 제거라는 요구사항을 해결하기 위해 의존성 분리 방향을 선택했고, 클린 아키텍처 원칙 적용이라는 구현 방식을 채택했다. 팀 내 코드 리뷰 과정에서 공동으로 검토한 결과, 모듈 교체 비용과 유지보수 용이성 간 트레이드오프를 고려했으며 결국 유지보수 부담이 낮아질 것으로 예상된다는 판단 근거로 변경을 승인했다. 리팩터링 작업은 3개월 로드맵 기준으로 진행되었고, 피크 시 메모리 사용량 512MB를 측정 지표로 삼았다."
- Reasoning: All A1 sub-markers are present — (i) "요구사항", (ii) "선택", (iii) "구현 방식", (iv) "트레이드오프", (v) "판단 근거". A4 scope qualifiers "팀 내", "공동". A2 — "512MB"(numeric+MB), "3개월"(temporal). However, the numeric outcome + outcome verb required for A3 PASS is entirely absent. "유지보수 부담이 낮아질 것으로 예상된다" describes an activity without observable numbers. **A3 FAIL — outcome absent**.

### C-2 — FAIL: Vanity outcome

- Candidate context: Mid, 4 years.
- Bullet: "온보딩 플로우의 응답 지연 요구사항을 해결하기 위해 API 응답 구조를 재설계하는 방향을 선정하고, 비동기 처리 메커니즘으로 전환하는 구현 방식을 채택했다. 팀 내 협업 리뷰를 통해 동기/비동기 처리 간 트레이드오프를 검토했으며, 개발 속도와 안정성 사이의 대안 비교를 근거로 최종 결정했다. 전환 작업은 1개월 내 완료를 목표로 했고, 배포 패키지 크기 2GB를 기준 측정치로 삼았으며, 평균 배포 완료 후 팀 만족도가 올라갔다."
- Reasoning: All A1 sub-markers are present — (i) "요구사항", (ii) "선정", (iii) "메커니즘", "구현 방식", (iv) "트레이드오프", "대안 비교", (v) "근거". A4 "팀 내", "협업". A2 — "2GB"(numeric+GB), "1개월"(temporal), "평균"(distribution). However, A3's numeric outcome + outcome verb pattern is absent. "팀 만족도가 올라갔다" is a vanity outcome without a measurement indicator — unquantified emotional results cannot PASS. **A3 FAIL — vanity outcome**.

### C-3 — P1: Fuzzy noun outcome

- Candidate context: Junior, 3 years.
- Bullet: "검색 API의 쿼리 응답 지연 요구사항을 해결하기 위해 인덱싱 전략 선택을 검토했고, 복합 인덱스 적용이라는 구현 방식을 채택했다. 팀 내 코드 리뷰에서 인덱스 적용 비용과 조회 성능 간의 트레이드오프를 공동으로 분석했으며, 쿼리 실행 시간이 우선이라는 판단을 근거로 결정했다. 배포 아티팩트 크기 1GB 기준으로 2개월간 측정했고, 결과적으로 쿼리 속도가 빨라졌다."
- Reasoning: All A1 sub-markers are present — (i) "요구사항", (ii) "선택", (iii) "구현 방식", (iv) "트레이드오프", (v) "판단을 근거". A4 "팀 내", "공동". A2 — "1GB"(numeric+GB), "2개월"(temporal). "쿼리 속도가 빨라졌다" suggests an outcome but presents only a fuzzy noun without a numeric outcome (such as `\d+\s*(ms|초|배|%)`). The outcome type can be classified as tech, but the missing magnitude leaves the type boundary unclear. **A3 P1 — fuzzy noun outcome**.

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Checkout retry completion rate
- Candidate context: Mid, 5 years.
- Bullet: "Hardened error recovery on the checkout retry path; successful completion rate improved from 91% to 97%"
- Reasoning: A3 P1 rule is "Outcome type boundary unclear." Magnitude is present (91%→97%) so the numeric outcome condition is met; the question is type resolution. "Successful completion rate" is dual-coded: HTTP/API success on retry (tech) versus business checkout conversion (business). The "retry path" lexical context nudges the reader toward the tech success-rate reading — type is resolvable within one interpretive step. This sits on the PASS side of the P1 boundary.

## Boundary Cases

### EDGE 1 — Qualitative outcome

"Refactored payment integration to enable sandboxing, unblocking QA from coupling on production credentials"

- Verdict criterion: PASS when causality + an unblocking verb are both present; otherwise P1
- This example — explicit causality (enabling sandboxing → removing production dependency) + the verb "unblocking" → PASS
- PASS is possible without quantification, but adding numbers such as a reduction in QA cycle time makes it much stronger

### EDGE 2 — Tech metric without surrounding context

"reduced build time from 12min to 3min"

- Tech outcome clear. PASS even without context (team size, CI cost), because magnitude is explicit
- Before/after present. "so what?" — a 9-minute reduction and improved development speed are readily inferable

## Vanity Metric Detection

The following are signs of vanity metrics:
- Absolute numbers only (no before/after or baseline): "p99 200ms", "99.9% uptime"
- Overly precise numbers far removed from industry standards: "99.9847% uptime"
- A single point value without distribution: "avg 100ms" (what about p99?)
- Activity count without outcome: "wrote 200 tests", "migrated 50 endpoints"
- Proxy metrics unrelated to engineering decisions

## Tech vs Business Outcomes

- **Tech**: latency (p50/p95/p99), throughput (RPS, QPS), error rate, uptime, cost (AWS bill, build time), resource utilization (CPU, memory)
- **Business**: revenue, conversion, retention, user growth, NPS, ticket volume, incident count
- **Hybrid**: capacity (supports X users), cost savings (engineer-attributable)

## Evaluator Guidance

1. **Extract outcome claims**: identify outcome-related wording in the bullet
2. **Classify**: tech | business | hybrid | absent
3. **Magnitude check**: does it include before/after, % change, or an absolute value?
4. **Vanity flag**: check for signs of vanity metrics
5. **Verdict**: PASS | FAIL | P1 (when outcome type is ambiguous)
6. **Evidence quote**: directly quote the relevant wording from the bullet

## Common Evaluation Pitfalls

- Automatically assigning FAIL when a business outcome is missing despite a tech outcome — incorrect. Do not require a business outcome; a tech outcome alone can PASS
- Passing "improved X" without magnitude — it should FAIL. Without quantification, "so what?" cannot be answered
- Confusing activity with outcome — "wrote tests", "ran migration", and "refactored X" are activities, not outcomes
- Automatically failing a qualitative outcome — clear causality such as unblocking or enabling can qualify for boundary PASS

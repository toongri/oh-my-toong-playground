# A2. Causal Honesty

## Standard
Absolute — 경력 레벨과 무관하게 동일 기준 적용. 원인→결과 logic과 수치 일관성은 모든 level에서 요구됨.

## Three Sub-checks
1. **Causal Chain Validity**: 원인→결과 chain이 직접적 or 각 단계 명시
2. **Arithmetic Consistency**: 수치(%, 배수, 절대값)가 내부 일관
3. **Constraint Resolution**: 명시된 제약이 해결되거나 explicit accept

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

### PASS Exemplar 4 — Data domain: controlled before/after with mechanism
Bullet: "Pipeline p95 latency dropped from 47min to 12min after repartitioning Spark job on high-cardinality key + enabling adaptive query execution; measured pre/post over 4 weeks to control for weekly traffic patterns"

Why PASS:
- Causal mechanism 명시: repartitioning on high-cardinality key → data skew 제거, adaptive query execution → runtime plan optimization
- Before/after 수치 명확 (47min → 12min)
- 측정 기간(4주) 명시로 weekly traffic pattern confound 통제 — correlation-only 해석 배제

### PASS Exemplar 5 — Frontend domain: mechanism + verification tool + downstream metric
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

---

## Boundary Cases

### EDGE 1 — Compressed causal description
"p99 200ms via read-replica" — chain이 너무 축약. Senior bullet에서는 PASS (read-replica → p99 개선 well-known)지만 context 부족하면 P1으로 flag 가능.

### EDGE 2 — Correlation disguised as causation
"After deploying new auth system, session hijack incidents dropped 80%" — temporal correlation만. cause로 쓸 수 없음 → FAIL 또는 P1.

---

## Evaluator Guidance
1. **Extract arithmetic**: 수치 all extraction — before/after, percentage, multiplier
2. **Check arithmetic**: 계산 일관 확인
3. **Trace causal chain**: cause → mechanism → effect 논리 추적. gap 있으면 flag
4. **Scan constraints**: bullet에 언급된 제약 (scale, consistency, cost 등) 해결 여부
5. **Verdict**: PASS | FAIL
6. **Evidence quote**: 문제되는 문구 인용

## Arithmetic Check Recipes
- % improvement: `(after - before) / before * 100`
- X배: `before / after`
- Rate conversion: "5x" vs "500%" 일관성

## Common Evaluation Pitfalls
- "Improved X by Y%" without baseline (X = what?) → FAIL 아닐 수 있음(A3 fail 가능) 하지만 A2에서 causal chain 파괴 시 FAIL
- Business metric을 tech cause에 즉시 연결 (숨겨진 변수 주의)

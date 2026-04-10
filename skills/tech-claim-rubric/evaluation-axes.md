# Evaluation Axes — Detailed Criteria

Reference for E1-E6 evaluation axes. Each axis is evaluated independently.

---

### E1. Career-Level Fit (Career-Level Technical Depth)

**Calibrated standard — expectations scale with career level.** This is the ONLY axis where experience level changes the passing bar.

Does this bullet demonstrate the technical depth expected for this career level?

**Evaluation method:**
1. Identify the core technology/approach mentioned in the bullet
2. Define the level of understanding expected for someone at this career level who used that technology
3. Verify whether the bullet meets that level

**Example (5 years experience, Kafka):**
- Expected level: should be able to explain the rationale for partition strategy, consumer group design, and the tradeoff between ordering guarantees and throughput
- "Built Kafka async pipeline" → FAIL: "built it" alone is no evidence that a 5-year engineer understands Kafka
- "Introduced Kafka for ordering guarantees across 100K daily events; capped at 3 partitions to keep consumer lag under 100ms" → PASS: concrete numbers, design decision, operational metric

**Interview simulation:**
"Why 3 partitions? How did you design the consumer group?"
→ Does the bullet imply an answer to this question?

**Example (2 years experience, Redis):**
- Expected level: should demonstrate basic awareness of the pattern used and why it fits this use case
- "Applied Redis caching to improve API response time" → FAIL: "applied it" shows no understanding of why Redis, which caching pattern, or what tradeoffs exist. A 2-year engineer should at least know the pattern name and basic rationale.
- "Redis cache-aside for product catalog (read:write 100:1, 5min TTL balancing freshness vs DB load)" → PASS: pattern name (cache-aside), usage context (read-heavy ratio), and design decision (TTL tradeoff) demonstrate basic understanding appropriate for 2 years.

**Example (8+ years experience, system design):**
- Expected level: should demonstrate systemic impact evaluation — not just what was built, but how it affects the organization, operations, and long-term cost
- "Led MSA migration, reduced deploy cycle from 2 weeks to 3 days" → FAIL: describes what was done and the result, but shows no systemic evaluation. At 8+ years, this reads like a 4-5 year engineer's bullet. Where is the analysis of team structure, platform cost, and deliberate scoping decisions?
- "Evaluated MSA vs modular monolith against team topology (3 teams, 2 autonomous, 1 shared). Chose partial extraction — 4 services aligned to team ownership. Platform tax (service mesh, observability per service) scoped to team capacity. Kept shared auth module as mini-monolith — splitting would create cross-team coordination cost exceeding monolith friction" → PASS: demonstrates systemic thinking expected at 8+ years — team structure analysis, platform cost awareness, deliberate non-action with rationale.

**Technical verification questions:**
- "At this career level, what alternatives should the candidate have considered?"
- "If you removed the years-of-experience context, could you still infer this person's career level from the bullet alone? If not, the bullet likely fails E1."

**Guardrail:** Do not penalize juniors for lacking senior-level depth. E1 asks "does the depth match the career level?" A junior who shows basic awareness of alternatives PASSES. A senior who shows only basic awareness FAILS. The bar is asymmetric — it rises with experience.

### E2. Logical Coherence (Causal Integrity)

**Absolute standard — no career-level calibration.** Flawed causal reasoning fails regardless of experience level.

Does the causal chain of claim → action → result hold within this bullet?

**Evaluation method:**
1. Extract the "cause → effect" structure from the bullet
2. Technically verify whether the cause is a genuine cause of the stated effect
3. If numbers are present: check whether the measurement method is implied, and whether other variables could have contributed

**Example:**
- "Introduced cache → 30% revenue increase" → FAIL: no causal path from cache to revenue. A chain is needed: response time improvement → reduced bounce rate → increased conversion → revenue
- "Introduced cache → average response time 3.2s → 0.4s" → PASS: direct causation. Cache's impact on response time is self-evident

**Technical verification questions:**
- "How was this metric measured? Is it based on a specific API or an overall average?"
- "Is this improvement purely the result of this action alone?"

**Example (Hidden variable):**
- "Optimized database indexes → order conversion rate increased 15%" → FAIL: no direct causal path from index optimization to conversion rate. Index optimization affects query speed, not user purchase decisions. The improvement may be real but the causal chain skips intermediate steps (page load time → bounce rate → conversion) and ignores concurrent changes (UX redesign, pricing changes) that could explain the conversion increase.
- "Optimized database indexes on product listing query — page load time reduced from 3.2s to 0.8s (p95)" → PASS: index optimization → query speed → page load time is a direct, one-step causal chain. The claimed effect (load time reduction) is a direct consequence of the stated action.

**Example (Causal chain skip):**
- "Introduced Kafka → monthly revenue increased 20%" → FAIL: no causal mechanism connecting a message queue to revenue. The chain would need to be: async processing → eliminated checkout timeout → reduced cart abandonment → increased completed orders → revenue. Every skipped link is a logical gap.
- "Introduced Kafka for async order processing → checkout timeout eliminated → cart abandonment dropped 12%" → PASS: each link in the chain is stated and technically plausible. Async processing genuinely eliminates synchronous timeout. Eliminated timeout genuinely reduces abandonment.

**Additional verification questions:**
- "Were there other changes happening concurrently that could explain this improvement?"
- "Does each step in the causal chain follow directly from the previous one, or are there gaps?"

**Impact Breadth Check (E2 supplement):**

When E2's causal chain is valid, additionally assess whether the stated impact spans multiple dimensions:

| Dimension | Example |
|-----------|---------|
| Technical | Response time, throughput, error rate, resource utilization |
| Business | Revenue, conversion, retention, cost reduction |
| Operational | On-call frequency, deployment velocity, incident recovery time |
| Organizational | Team autonomy, knowledge transfer, process change |

Single-dimension impact does NOT fail E2 — E2 evaluates causal validity, not breadth. However, single-dimension impact in a mid/senior bullet is flagged as a P2 finding: "Causal chain valid but impact is one-dimensional. Multi-dimensional impact strengthens interview defensibility."

This check is informational — it does not change the E2 PASS/FAIL verdict. It provides context for E6 (Target-Scale Transferability), where multi-dimensional impact demonstrates transferable judgment.

### E3. Problem Fidelity (Tradeoff Authenticity + Problem Surface)

**Absolute standard — no career-level calibration.** A tradeoff that doesn't hold logically, or a bullet that compresses a complex reality into a flat description, fails at any experience level.

Does this bullet faithfully represent the engineering reality? Two sub-evaluations:

#### E3a. Tradeoff Authenticity

Is the tradeoff for the technology choice mentioned in this bullet specific to this problem context?

**Evaluation method:**
1. Identify the technology choice/decision in the bullet
2. Check whether "why this was chosen and what was given up" is stated explicitly
3. Verify whether what was given up is real in this context (not textbook)

**Example:**
- "Adopted MSA for scalability" → FAIL: "scalability" is a textbook benefit of MSA. No mention of what specifically needed to scale in this system, or what problem existed in the monolith
- "Adopted MSA for deployment independence. Accepted increased network overhead between services and distributed transaction complexity. Converted order-payment service to eventual consistency model, allowing up to 2s delay in payment confirmation" → PASS: concrete tradeoffs (network, distributed transactions, 2s eventual consistency delay) are real in this problem context

**Technical verification questions:**
- "What was the actual impact of what you gave up in this tradeoff?"
- "If you did this again, would you make the same choice?"

#### E3b. Problem Surface

**See** [e3b-problem-surface.md] **for details** on E3b scoring formula, anchor rubrics, 3-pattern definitions, and scored examples.

### E4. Scale-Appropriate Engineering (Cost-Benefit Rationality)

**Absolute standard — no career-level calibration.** Disproportionate engineering fails regardless of experience level.

Is the technology/approach chosen in this bullet appropriate for the scale of the problem?

**Evaluation method:**
1. Extract scale indicators from the bullet (TPS, DAU, data size, team size, etc.)
2. Compare against the typical application scale of the chosen technology
3. Detect signs of over-engineering (infrastructure disproportionate to scale) or under-engineering (solution insufficient for scale)

**Example:**
- "Kafka + Redis + ElasticSearch for a system processing 100 transactions/month" → FAIL: distributed streaming infrastructure cannot be justified for 100/month. A simple queue + DB index is sufficient
- "Kafka for processing 100K daily events" → PASS: 100K/day is a reasonable application range for Kafka

**Technical verification questions:**
- "What was the monthly operating cost of this infrastructure?"
- "When this scale grows, where does the bottleneck appear first?"

**Example (Under-engineering):**
- "Built real-time notification system handling 50K concurrent WebSocket connections using Node.js" → FAIL: 50K concurrent connections demands architectural decisions (clustering, session management, horizontal scaling) that are completely absent. The claim is implausible without mentioning how this scale was handled — suggesting the engineer either didn't handle it or didn't understand the challenge.
- "Real-time notification system handling 50K concurrent WebSocket connections — single Node.js instance saturates at ~10K connections (event loop contention). Deployed 8-node cluster behind sticky-session load balancer. Accepted session affinity constraint for horizontal scalability" → PASS: scale indicator (50K), capacity analysis (10K per instance), architectural response (8-node cluster), and tradeoff (session affinity) are all proportional to the problem.

**Example (Over-engineering in context):**
- "Implemented master-slave DB replication and Redis caching layer with local cache fallback for admin dashboard serving 500 requests/day" → FAIL: 500 requests/day (~0.006 TPS) on an admin dashboard. Master-slave replication, Redis, AND local cache is a three-layer infrastructure for a problem that a single DB with query optimization handles trivially. The maintenance cost of cache invalidation across three layers far exceeds any performance benefit at this scale.
- "Implemented master-slave replication for order query service (30K DAU, read:write 50:1) — separated read traffic to replica, reducing primary DB CPU from 85% to 40%. Redis cache deferred to next phase pending traffic growth validation" → PASS: scale (30K DAU, 50:1 ratio) justifies read replica. Redis is deliberately deferred because current scale doesn't warrant it. Both the adoption and the deferral are grounded in scale evidence.

**Additional verification questions:**
- "If this system's scale grows 10x, where does the first bottleneck appear?"
- "Does the technical complexity described feel proportional to the stated scale and business criticality? Would a simpler alternative handle it equally well?"

**Guardrail:** Scale numbers alone don't determine appropriateness. Consider growth trajectory, team capacity to operate the infrastructure, and business criticality. A "small" system processing financial transactions may justify infrastructure that would be over-engineering for a "large" system processing non-critical analytics.

**Guardrail:** Do not automatically pass high-scale systems. 1M DAU with commodity architecture may indicate the engineer inherited rather than designed the system. The signal is engineering judgment proportional to scale, not scale itself.

### E5. Signal-to-Noise Ratio (Clarity)

**Absolute standard — no career-level calibration.** A buried core message fails regardless of experience level.

Is the core message of this bullet clear, or is it buried in secondary information?

**Evaluation method:**
1. Summarize the core of the bullet in one sentence
2. Measure how much of the actual bullet text is occupied by that core
3. Determine whether secondary information dilutes the core

**Example:**
- Core is "failure isolation" but 70% of text is about the deployment pipeline → FAIL
- Core is "response time optimization" and text is structured around the core as: problem discovery → root cause analysis → resolution → verification → PASS

**Example (Buried core):**
- "Built CI/CD pipeline with GitHub Actions, Docker multi-stage builds, and Kubernetes rolling deployments. Implemented blue-green deployment strategy. Reduced production incident response time from 4 hours to 15 minutes through automated rollback triggers on error-rate spike detection" → FAIL: the core achievement (4h→15min incident response) is buried after two sentences of infrastructure description. A CTO skimming this bullet sees CI/CD tools, not the actual impact.
- "Reduced production incident response from 4h to 15min — automated rollback triggers on error-rate spike (>5% over 2-min window). Built on CI/CD pipeline with blue-green deployment" → PASS: core achievement leads. Infrastructure is subordinated to context. The information hierarchy matches the importance hierarchy.

**Example (Unfocused listing):**
- "Improved API performance by adding Redis caching, optimizing SQL queries, implementing connection pooling, adding CDN for static assets, and migrating to HTTP/2" → FAIL: five optimizations listed without hierarchy. Which was the primary driver? Which were secondary? The reader cannot distinguish the engineer's key insight from routine improvements. This reads as a task list, not an achievement.
- "Reduced API p95 latency from 1.2s to 200ms — root cause: N+1 query pattern in order listing endpoint. Fixed with batch query + Redis cache for product catalog (hit rate 94%). Connection pooling and CDN were secondary optimizations contributing ~15% of total improvement" → PASS: primary driver identified (N+1 fix + cache), secondary contributions noted with proportion (~15%). The reader knows what mattered most.

**Example (Decorative rhetoric):**
- "Spearheaded a paradigm-shifting migration to event-driven architecture using Kafka, achieving unprecedented throughput improvements that fundamentally transformed our data pipeline ecosystem" → FAIL: technical keywords exist (Kafka, event-driven, data pipeline) but are wrapped in rhetoric ("paradigm-shifting", "unprecedented", "fundamentally transformed") that replaces specific numbers and design decisions. Remove the adjectives and nothing concrete remains.
- "Migrated order processing from synchronous REST to Kafka event streams — reduced end-to-end latency from 2s to 200ms for order status updates" → PASS: same topic (Kafka migration) expressed with concrete before/after (REST→Kafka, 2s→200ms) and specific scope (order status updates). No rhetoric needed when the numbers speak.

**Technical verification questions:**
- "Can you summarize this bullet's core achievement in one sentence? If not, the signal is buried."
- "Is there any sentence that, if removed, would not change the bullet's core message? If yes, it's noise."

**E3b/E5 tension guardrail:** E3b (Problem Surface) demands that the bullet surface multiple engineering concerns. E5 (Signal-to-Noise) demands that the bullet remain clear and focused. These are NOT contradictory — they create a quality bar: surface multiple concerns CONCISELY. Three engineering dimensions in one focused sentence PASSES both E3b and E5. One dimension sprawled across 200 words FAILS both. The unit of quality is "distinct concerns per unit of clarity," not word count. Example: "Cache-aside with Redis for product catalog (read:write 100:1, 5min TTL balancing freshness vs DB load)" — surfaces 3 concerns (pattern selection, ratio analysis, TTL tradeoff) in one sentence. Passes both E3b and E5.

### E6. Target-Scale Transferability (Target-Scale Engineering Credibility)

**Target-calibrated standard — the bar scales with the target company, not the candidate's current company.** This is the axis where the target company's scale and complexity define the passing bar.

Does this bullet demonstrate engineering judgment that would be credible at the target company's scale?

**Evaluation method:**
1. Extract the scale indicators from the bullet (TPS, data volume, user count, system complexity)
2. Compare against the target company's known or inferred scale
3. Assess whether the engineering decisions described would transfer — not just the exact numbers, but the judgment patterns

**Core principle:** Evaluate "transferability of judgment," not the numbers themselves.

- If Redis was introduced at TPS 50: the problem is not Redis itself, but "why was Redis needed at this scale, and is this judgment framework valid at TPS 100K?"
- If the design shows consideration for larger scale (extension points, bottleneck prediction) at a small scale → PASS
- If the design is optimized only for current scale (hardcoding, non-scalable architecture) → FAIL

**Interview Defensibility — the primary criterion for E6:**
- Whether the numbers are factually accurate is not what E6 evaluates. The sole criterion is whether the candidate can logically defend those numbers and that design in an interview.
- Even if TPS 50 experience is described as TPS 10K, if the candidate can explain "how this architecture behaves at 10K" two levels deep → PASS
- Numbers the candidate cannot explain → the interview collapses at the first question → naturally FAIL
- A bullet describing only engineering logic without stating scale → E6 is evaluated on the quality of that logic. A valid strategy.

**Example (target: big tech, candidate: startup background):**
- "일 50건 결제를 단일 DB로 동기 처리" → FAIL: this approach hits its limit immediately at the target company's scale. No evidence of scalability consideration.
- "일 50건이지만, 결제-주문 상태 동기화에서 eventual consistency 모델을 설계하고, 볼륨 증가 시 Kafka 기반 비동기 전환이 가능하도록 이벤트 인터페이스를 분리" → PASS: current scale is small, but design judgment that accounts for growth is evident.
- "100K DAU 서비스에서 Redis 캐시 + TTL 전략으로 DB 부하 80% 절감" → PASS: scale and approach are valid at the target company as well.

**Interview simulation:**
"If traffic on this system grows 100x, where does it break first? How would you respond?"
→ Does the bullet imply an answer to this question?

**Calibration note:**
- If Target Company Context is provided: evaluate against the actual scale/indicators of that company
- If Target Company Context is not provided: default to big tech standards (DAU 1M+, TPS 10K+, data TB+)
- It is natural for junior candidates to lack large-scale experience. However, verify: "Does the candidate recognize what would become a problem as scale grows?"

**Example (Moderate scale with transferable constraints):**
- "Developed order-payment settlement system processing 30K orders/day with 99.95% success rate" → FAIL: numbers (30K, 99.95%) without judgment. Why 99.95%? How are the remaining 0.05% handled? How is settlement consistency guaranteed across services? The CTO asks "success rate 99.95% means 15 failures/day — what happens to those?" and the bullet provides no answer.
- "Order-payment settlement (30K orders/day, 15% monthly growth) — cross-service settlement consistency as core constraint. Evaluated 2PC vs saga: chose saga with compensation because 2PC lock contention exceeded settlement window (5min) even at current scale. API gateway-level idempotency keys to prevent duplicate charges. Immutable event log for audit trail. Reconciliation job auto-corrects state divergence within 1 business day — divergence rate confirmed <0.05%" → PASS: traffic (30K/day) is not big-tech scale, but the judgment (saga vs 2PC analysis, idempotency, compensation design, reconciliation) is exactly what big tech needs at 300K/day. The reasoning framework transfers regardless of scale.

**Example (Large numbers without transferable judgment):**
- "Managed Redis cluster serving 1M DAU with 99.9% uptime" → FAIL: impressive numbers but zero judgment. Why Redis? What caching strategy? What failure modes? How is consistency handled? A CTO would ask "what was YOUR contribution vs what you inherited?" and this bullet provides no signal.
- "Redis cluster serving 1M DAU — redesigned partition strategy when hot-key pattern emerged (top 100 products consumed 60% of cache capacity). Introduced client-side consistent hashing with virtual nodes to distribute hot keys across shards. Accepted 2% cache miss rate increase in exchange for 40% reduction in p99 tail latency" → PASS: same scale (1M DAU) but the judgment is visible — problem identification (hot-key), solution design (consistent hashing + virtual nodes), and explicit tradeoff (miss rate vs tail latency). This reasoning transfers to any scale.

**Additional verification questions:**
- "If transplanted to the target company's scale, would this design still hold? Where would it break first?"
- "Is the engineering judgment demonstrated here — not the specific numbers — valid at 10x or 100x scale?"

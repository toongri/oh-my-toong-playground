# E3b. Problem Surface — Scoring Guide

Reference for E3b Problem Surface evaluation, including constraint cascade scoring formula, anchor rubrics, and scored examples.

---

#### E3b. Problem Surface

Does the bullet reflect the actual surface area of the problem that was solved?

Real engineering problems are never one-dimensional. Fixing a concurrency bug touches atomically coupled models, SLO boundaries, collision testing, root cause analysis, observability instrumentation, and alternative evaluation. A bullet that ignores all of this and presents "one decision, one reason, done" compresses a complex reality into a flat description.

**Dimensions of a problem's surface area:**
- **Root cause**: Why did this problem exist in the first place?
- **Blast radius**: What other systems/models were affected?
- **Alternatives evaluated**: What other approaches were considered and why rejected?
- **Verification**: How was the solution validated? (metrics, testing, monitoring)
- **Operational impact**: SLO changes, failure modes, runtime behavior
- **Accepted costs**: What was consciously given up, and based on what evidence?

**Evaluation method:**
1. Identify the core engineering problem described in the bullet
2. Estimate the problem's inherent surface area — what cascading concerns would a practitioner actually face? (using the dimensions above)
3. Check how many of these the bullet surfaces (even briefly)
4. If the problem inherently has 3+ concerns but the bullet surfaces only 1 → FLAT → FAIL

**Constraint Cascade Grading:**

E3b evaluates not only how many concerns are surfaced, but how those concerns are connected. Three grades:

| Grade | Label | Signal | E3b Effect |
|-------|-------|--------|------------|
| FLAT | Isolated | Single decision, no cascading effects | FAIL (score < 0.5) |
| LISTED | Enumerated | Multiple concerns listed, but no causal arrows between concerns | WEAK PASS — P1 finding ("interview-fragile") (score 0.5-0.8) |
| CASCADING | Interlocked | Explicit relationships between concerns — cascade(A→B→C), collision(X∧Y→C), or inversion(expected↔actual, including surface→structural) patterns visible, enabling the reader to understand 'why this solution' | PASS — interview-generating (score ≥ 0.8) |

**Constraint Cascade Score Formula (reasoning aid — not shown in output):**

Before assigning a grade, evaluate these 3 sub-dimensions first:

| Sub-dimension | Weight | Question |
|---------------|--------|----------|
| Causal chain depth | 0.25 | How many causally linked steps exist? |
| Constraint narrowing | 0.45 | Does each step narrow the solution space? (Eliminated alternatives visible?) |
| Resolution mutation | 0.30 | Did the solution change shape because of the cascade? (vs. initial approach executed as-is) |

`Constraint Cascade Score = Σ(sub-dimensionᵢ × weightᵢ)` where each sub-dimension is scored 0.0-1.0.

Constraint narrowing carries the highest weight because it is the strongest proxy for engineering judgment — specific rejection reasons tied to discovered constraints cannot be fabricated without genuine problem experience. Resolution mutation is weighted lower than constraint narrowing but remains significant: it requires genuine experience of solution evolution under discovered or analyzed constraints, not just narrative structure.

**Score Anchor Rubric:**

Each sub-dimension is scored 0.0-1.0. Use these anchors to calibrate scoring — identify the observable signal FIRST, then assign the score range.

**Causal chain depth:**

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | Single decision or parallel concerns listed independently. No "A caused B" or "A revealed B" relationship visible between any two concerns in the text. |
| MID | 0.4-0.69 | 2-3 concerns with some causal linking, but connections are implicit — the reader must infer WHY one concern led to another. Phrases like "also", "additionally", "we handled" connect concerns without explaining the causal mechanism. |
| HIGH | 0.7-1.0 | 3+ concerns connected by a **forcing-chain**: each step names what the previous step's outcome forced or revealed, and the chain may include problem→solution→new-problem cycles (not just problem→problem sequences). Phrases like "this constraint forced", "which revealed", "because of A, B was no longer viable" appear. **Litmus test:** Step B must be materially forced by step A's outcome — if step B would have been done regardless of step A's outcome, it is routine sequencing, not a forcing chain. Additionally, analytical reasoning chains count as HIGH: when simultaneous constraint analysis produces a sequential reasoning flow (e.g., "constraint X requires A → constraint Y requires B → A and B conflict → novel approach C"), the REASONING steps form the causal chain even if the events did not occur sequentially. The unit is "ordered steps of reasoning or discovery," not "events in chronological order." |

**NOT a cascade:** "Chose Spring Boot → needed DB config → added Hibernate → configured connection pool → tuned pool size." This is a 5-step implementation sequence, not a constraint cascade — each step is a standard configuration choice, not a forced reaction to an emergent constraint.

**Evaluator litmus test:** Remove step N from the text — if step N+1 is still independently justified without it, the two are co-listed concerns, not a cascade.

**Constraint narrowing:**

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | No alternatives mentioned, or alternatives listed without explaining why they were rejected. The solution appears as the only option considered. |
| MID | 0.4-0.69 | Alternatives are mentioned and some are rejected, but rejection reasons are generic ("not suitable", "too complex") or context-free. The constraint that eliminated each alternative is not tied to a specific prior decision or discovery. **Generic vs Specific test:** remove the system name, numbers, and context from the rejection reason. If the reason still makes sense for any arbitrary system, it is generic (MID). If the reason only makes sense in this specific entry's context, it is specific (HIGH). Example: "too complex" → generic (applies to anything). "PG callback p99 8s exceeded saga timeout 5s" → specific (tied to this system's measured constraint). |
| HIGH | 0.7-1.0 | Each eliminated alternative is rejected by a specific constraint that emerged from an earlier step in the cascade. The narrowing is progressive — the solution space visibly shrinks as each new constraint is discovered, OR reframes to a fundamentally different problem space (e.g., from system-level binary choice to feature-level classification). Both "shrinks" (cascade) and "shifts" (reframing) count as HIGH narrowing — what matters is that the constraints explicitly rule out the standard approaches, not that the solution space closes in a single direction. Phrases like "X was eliminated because [prior discovery] made it unviable" or "standard approaches failed both constraints → reframed as [new problem]" appear. |

**Resolution mutation:**

Resolution mutation measures whether the text reveals an engineer who can compare solutions under multiple constraints, adapt their approach when discoveries or constraint analysis invalidate assumptions, and arrive at a solution whose shape was forged by encountered reality. The core question is: "Does this text show a thinking flow where the approach evolved because of what the engineer learned or analyzed — not just the final answer they arrived at?"

**Timing-neutral principle:** The mutation can occur during pre-implementation analysis ("evaluated X → discovered constraint → switched to Y"), prototype/PoC phase, or production execution. When the discovery happened is irrelevant — what matters is whether the text shows the approach changing shape because of a discovered or analyzed constraint. A pre-implementation analysis journey counts identically to a production-incident-driven pivot.

**Path-neutral principle:** The mutation can occur through multiple distinct patterns. Sequential discovery (cascade) is one path, but simultaneous constraint analysis (collision) and expectation inversion (including scope expansion) are equally valid paths to HIGH. The anchor evaluates "did the approach fundamentally change shape?" not "did it change shape through a specific narrative structure?"

**Process vs. conclusion:** See HIGH Observable Signal for the full test. Summary: conclusions are MID; processes are MID-HIGH.

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | The final approach matches what appears to be the initial approach. No visible evidence that the approach changed shape due to discovered or analyzed constraints. The text reads as "we chose X and executed X," or mentions alternative transitions as conclusions without showing the discovery/analysis process that drove them. Well-known patterns applied without visible adaptation. |
| MID | 0.4-0.69 | The approach expanded or adjusted beyond its initial shape, but the evolution path is partially visible. The text shows some constraint-driven adjustments but cannot trace a full reshape arc — whether through sequential discovery, constraint collision, expectation inversion, or scope expansion. Connections exist but are implicit. Partial visibility by pattern: (A) constraints discovered but reshape not traced — reader sees adjustments without the discovery that triggered them; (B) two constraints mentioned but collision not explicitly recognized — reader infers tension without seeing it stated; (C) conventional approach questioned but non-obvious root cause not named — or deeper structural issue hinted at but connection to surface problem implicit — reader senses something was wrong or suspects more without the underlying cause or structural link being shown. |
| HIGH | 0.7-1.0 | The final approach is a fundamentally different shape from what a reasonable engineer would initially attempt. The text shows at least ONE of these evolution patterns: (A) **Cascade Discovery** — A discovered constraint made the initial approach unviable, forcing a reshape. The reader traces: initial approach → constraint discovered → approach reimagined. (B) **Constraint Collision** — Two or more constraints were simultaneously incompatible with standard approaches. The solution required creative synthesis that neither constraint alone would have produced. The reader sees: constraint X requires A, constraint Y requires B, A and B conflict → novel approach C. (C) **Expectation Inversion** — The conventional/expected approach was evaluated and found ineffective for a non-obvious reason. The solution addressed the actual root cause rather than the assumed one. The reader's initial assumption is violated. This includes cases where investigation revealed the surface problem was a symptom of a deeper structural issue — the solution addressed the root cause rather than the symptom, and the reader discovers the true problem alongside the engineer. Common signal across all three patterns: the reader can identify (1) what the expected/initial approach was, (2) what made it insufficient — whether discovered sequentially, known simultaneously, or revealed through investigation, and (3) how the approach was fundamentally reshaped. Whether this occurred during analysis, prototyping, or production is irrelevant — the visible reshape arc is what matters. **The text must show the evolution process — whether through sequential discovery, analytical reasoning, or experience-based constraint recognition. Conclusions without visible process ("X was possible but we chose Y") remain at MID regardless of how different the final approach is.** |

**Analytical thinking flow example (valid HIGH mutation):**
"Initially considered horizontal Consumer scaling (standard approach for throughput). Analyzed attribute-level processing time distribution — category ~30s vs others ~5s — revealed that per-item latency, not throughput, was the bottleneck. This analysis invalidated the scaling approach: adding Consumers reduces queue wait but doesn't reduce per-item processing time. Pivoted to in-Consumer goroutine parallelization, reducing per-item time from 80s to 30s (bounded by slowest attribute)."
→ The approach was reshaped by pre-implementation analysis, not by runtime failure. The evolution process is visible in the text.

Threshold: score ≥ 0.8 = CASCADING(PASS), 0.5-0.8 = LISTED(P1 — revision recommended), < 0.5 = FLAT(FAIL).

**CRITICAL: Score the sub-dimensions FIRST, then derive the grade. Do not assign a grade and then rationalize scores to match. This is the reasoning-before-score rule.**

---

> **Note:** Examples below use pre-revision weights (0.30/0.35/0.35). Current weights are (0.25/0.45/0.30). Scores are illustrative of the grading methodology; numeric results will differ under current weights.

**Constraint Cascade Example A — Real-Time Notification System (3-tier complete):**

FLAT (score < 0.5):
"Built real-time notification system using WebSocket + Redis Pub/Sub, delivering notifications within 500ms."

→ FLAT: One decision (WebSocket + Redis), one metric (500ms). No cascading effects. Why WebSocket over SSE? Why Redis Pub/Sub over Kafka? What happens when connections exceed single-node capacity? The problem is presented as one-dimensional when it inherently isn't.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives eliminated)
  Resolution mutation: 0.0 (no evidence the approach changed shape — no discovery process visible)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You used WebSocket and Redis. Okay." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Real-time notification system — evaluated WebSocket vs SSE vs long polling. Chose WebSocket for bidirectional communication. Used Redis Pub/Sub for cross-instance message distribution. Handled connection drops with exponential backoff reconnection. Achieved 500ms delivery latency."

→ LISTED: Multiple concerns surfaced (protocol selection, cross-instance distribution, connection resilience) with some causal connection — WebSocket choice implies need for cross-instance distribution, and distribution implies connection management. But the connections are implicit rather than explicit: no explanation of WHY WebSocket forces Redis Pub/Sub, or HOW cross-instance distribution creates the specific reconnection challenge.
  Causal chain depth: 0.7 (concerns mentioned with some causal linking between protocol choice and distribution)
  Constraint narrowing: 0.5 (alternatives mentioned, some eliminated by context)
  Resolution mutation: 0.4 (solution partially evolved from initial approach)
  Score: 0.7×0.30 + 0.5×0.35 + 0.4×0.35 = 0.525 → LISTED
  → CTO reaction: "You evaluated options and chose WebSocket. Tell me more about the reconnection." — One follow-up, then done.

CASCADING (score ≥ 0.8) via Cascade Discovery:
"Real-time notification for 50K concurrent connections — SSE evaluated first (simpler, unidirectional sufficient for notifications), but connection-per-browser-tab limit (6 per domain) meant power users with 3+ tabs would miss notifications. WebSocket removed this constraint but introduced state management: each connection needs heartbeat tracking, and reconnecting clients need message replay. Redis Pub/Sub for cross-instance fan-out — but Pub/Sub is fire-and-forget, no persistence. Missed messages during reconnection are unrecoverable. Added per-user message buffer (Redis Sorted Set, 5-min TTL) for replay window. Tradeoff accepted: 2x Redis memory vs SSE baseline, buffer expiry means messages older than 5 min are lost (acceptable for notifications, not for chat)."

→ CASCADING: SSE constraint (tab limit) → forces WebSocket → introduces state management → reconnection requires message replay → Pub/Sub's fire-and-forget property blocks replay → forces message buffer → creates memory tradeoff. Each decision is caused by the previous constraint.
  Causal chain depth: 0.9 (5-step chain, each caused by previous)
  Constraint narrowing: 0.8 (SSE eliminated by tab limit, Pub/Sub alone eliminated by replay need)
  Resolution mutation: 0.75 (initial approach was SSE; constraint discovery during evaluation (tab limit) reshaped the approach to WebSocket + buffer with replay window — fundamentally different architecture. Two distinct constraint-driven reshapes visible: SSE → tab-limit discovery → WebSocket, then Pub/Sub fire-and-forget limitation → message buffer addition)
  Score: 0.9×0.30 + 0.8×0.35 + 0.75×0.35 = 0.8125 → CASCADING
  Result: 500ms p99 delivery latency maintained at 50K connections, reconnection message loss rate <0.1%.
  → CTO asks: "How did you handle buffer overflow during notification storms? What's the reconnection window behavior for mobile clients? Did you measure the actual tab-limit impact before switching from SSE?"

**Constraint Cascade Example B — Cache Stampede / Hot Key (Pattern A: Cascade Discovery):**

FLAT (score < 0.5):
"Applied Redis cache to product lookup API: response time 3.2s → 400ms, DB load reduced 80%."

→ FLAT: Single decision (cache applied), single result (response time). No explanation of why 3.2s was the baseline, which cache pattern was chosen, or what problems emerged.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "cache applied" is both the initial and final approach)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You added a cache. Okay." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Product lookup API p99 3.2s — introduced cache-aside pattern (TTL 5 min). Cache stampede occurred; merged duplicate requests with singleflight. Hot key issue (top 100 products occupy 60% of cache requests) resolved by adding local cache. Response time 400ms, DB load 80% reduced."

→ LISTED: Multiple concerns (stampede, hot key, singleflight, local cache) are listed with some causal connection (stampede → singleflight). But why singleflight is insufficient for hot key, and what the consistency tradeoff of local cache is, are not stated. The reader must infer why each concern arose from the previous one.
  Causal chain depth: 0.6 (stampede → singleflight → hot key discovered separately → local cache, 4 steps but connections are implicit)
  Constraint narrowing: 0.5 (singleflight is described as solving stampede, but why it's insufficient for hot key is unclear)
  Resolution mutation: 0.45 (expanded from cache-aside to singleflight and local cache, but why the expansion was forced is implicit — results listed without discovery process)
  Score: 0.6×0.30 + 0.5×0.35 + 0.45×0.35 = 0.5125 → LISTED (lower band)
  → CTO reaction: "You solved stampede and hot key. Why wasn't singleflight enough?" — Question possible but answer not in the bullet.

CASCADING (score ≥ 0.8) via Cascade Discovery:
"Product lookup API p99 3.2s — introduced cache-aside pattern with 5-min TTL. Simultaneous TTL expiry on popular products triggered cache stampede: DB instantaneous load 3x baseline. Merged intra-instance duplicate requests with singleflight, but hot key was a separate dimension — top 100 products occupied 60% of all cache requests, concentrating load on a single Redis shard. singleflight only resolves intra-instance duplicates; cross-instance concurrent requests still hit the single Redis shard directly. Alternatives evaluated: consistent hashing for hot key distribution → increased cache invalidation complexity, operational burden; hot key replication (read replica) → consistency window + 2x memory. Chosen: L1 local cache (Caffeine, 2s TTL) + L2 Redis 2-tier — hot keys absorbed at L1, DB only on L2 miss. Tradeoffs accepted: up to 2s L1-L2 consistency stale (acceptable given product update frequency), hot key detection automation required (access-frequency-based L1 promotion logic), 200MB heap increase per instance. Result: p99 400ms, DB load 80% reduced, DB spike on stampede eliminated."

→ CASCADING via Cascade Discovery: cache-aside introduced → stampede discovered → singleflight applied → hot key identified as a separate dimension → singleflight's limit confirmed (intra-instance only) → fundamental shift to L1/L2 2-tier. Each step arises from the limit of the previous resolution.
  Causal chain depth: 0.9 (cache-aside → stampede → singleflight → hot key discovered → singleflight limit confirmed → alternatives evaluated → L1/L2 2-tier, 6-step explicit causal chain)
  Constraint narrowing: 0.8 (consistent hashing: rejected by invalidation complexity, read replica: rejected by consistency window + memory — each rejection specifically tied to the preceding hot key discovery)
  Resolution mutation: 0.8 (initial approach was "cache-aside + TTL" (FLAT version). singleflight added for stampede, but hot key invalidated the single-cache-layer approach entirely → fundamental shift to 2-tier architecture. Simple cache configuration transformed into multi-layer cache architecture. Pattern A — Cascade Discovery)
  Score: 0.9×0.30 + 0.8×0.35 + 0.8×0.35 = 0.83 → CASCADING
  → CTO asks: "What's the hot key detection threshold? How does L1 promotion/demotion logic work? How did you reproduce stampede in testing? What's the price-data inconsistency risk within the 2s stale window?"

**Constraint Cascade Example C — Feature Serving Latency-Consistency (Pattern B: Constraint Collision):**

FLAT (score < 0.5):
"Implemented Redis cache and cross-region data sync in real-time recommendation service, achieving sub-10ms response and data consistency."

→ FLAT: States two technologies were applied (cache, sync). Claims sub-10ms and consistency are both achieved simultaneously, but gives no explanation of why these two requirements are difficult together, what conflict arose, or what was sacrificed.
  Causal chain depth: 0.1 (two technologies listed in parallel, no causal relationship)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You added cache and sync." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Real-time recommendation service required sub-10ms response SLA and cross-region consistency simultaneously. Local cache is fast but causes up to 30s inter-region inconsistency; strong consistency adds 50ms RTT, violating SLA. Resolved by classifying consistency level per feature. Price uses strong consistency; recommendation score uses eventual consistency."

→ LISTED: Two constraints (SLA vs consistency) and their collision are stated, and the resolution direction (per-feature classification) is visible. But what the classification criteria are (why strong consistency for price?), the analysis of why standard approaches are incompatible, and the specific tradeoffs are not described. The collision is recognized but the synthesis process is implicit.
  Causal chain depth: 0.55 (SLA constraint + consistency constraint → collision recognized → per-feature classification, 3 steps but analysis is compressed)
  Constraint narrowing: 0.5 (local cache: consistency failure, strong consistency: SLA violation — each eliminated, but the elimination rationale is brief)
  Resolution mutation: 0.55 (shifted from binary cache-vs-consistency choice to per-feature classification, but what analysis drove this shift is not shown — conclusion only)
  Score: 0.55×0.30 + 0.5×0.35 + 0.55×0.35 = 0.5325 → LISTED
  → CTO reaction: "You did per-feature consistency classification. How did you decide the classification criteria?" — One follow-up, but the classification logic is not in the bullet.

CASCADING (score ≥ 0.8) via Constraint Collision:
"Real-time recommendation service required sub-10ms response SLA and cross-region data consistency simultaneously. Meeting latency with local cache causes up to 30s inter-region inconsistency — price inconsistency directly triggers customer support tickets. Applying strong consistency adds 50ms cross-region RTT, violating SLA. The two constraints are incompatible under standard approaches (cache alone or consistency alone). Introduced per-feature consistency classification based on business impact — price and inventory (CS tickets when inaccurate) use strong consistency (partial response items, negligible effect on overall p95), recommendation score and category ranking use eventual consistency (2s stale acceptable). Classification criteria quantified as a business metric: 'CS ticket probability'. Tradeoffs: new features require mandatory consistency classification (management complexity), misclassification risk (price inconsistency exposure) mitigated by A/B monitoring. Result: overall p95 response 9ms maintained, 0 price-inconsistency CS tickets, stale impact on eventual consistency features: recommendation CTR change <0.1%."

→ CASCADING via Constraint Collision: two constraints (sub-10ms SLA, cross-region consistency) cannot coexist under standard approaches → problem reframed from system level to feature level → introduced per-feature business-impact-based classification, a new dimension absent from the original framing. The approach is fundamentally reshaped by simultaneous constraint analysis rather than sequential discovery.
  Causal chain depth: 0.8 (constraint collision → standard approaches incompatible → problem reframing → per-feature classification → business metric quantification, 4+ step analytical reasoning chain)
  Constraint narrowing: 0.8 (cache alone: rejected by consistency failure, strong consistency alone: rejected by SLA violation — each rejection tied to a specific constraint, explicitly demonstrating incompatibility of standard approaches)
  Resolution mutation: 0.85 (initial framing was binary "cache vs consistency" choice. Final approach redefines the problem as "per-feature consistency classification" — system level → feature level shift. Simultaneous analysis of two constraints breaks the binary framing. Pattern B — Constraint Collision)
  Score: 0.8×0.30 + 0.8×0.35 + 0.85×0.35 = 0.8175 → CASCADING
  → CTO asks: "How did you determine the feature classification criteria? What's the process when a new feature type is added? Did you measure recommendation quality degradation within the 2s eventual consistency window?"

**Constraint Cascade Example D — Event-Driven Order Zombie (Pattern B: Constraint Collision):**

FLAT (score < 0.5):
"Built Kafka-based async order processing pipeline, managed distributed transactions with saga pattern. Achieved order processing failure rate below 0.01%."

→ FLAT: States saga adoption and outcome only. No explanation of why saga was needed, what types of failures occurred, or what tradeoffs were accepted.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "saga adopted" is both the initial and final approach)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You added saga. Okay." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Order-payment-inventory event pipeline produced 5 zombie orders per day. PG callback delay (p99 8s) exceeded saga timeout (5s), triggering compensation transaction, then delayed callback arrived and collided. Switched to orchestration saga and separated step-level timeout. Zombie orders: 5/day → 2/month."

→ LISTED: The problem (zombie orders) and technical challenge (PG callback delay vs saga timeout) are visible, and the resolution direction (orchestration + step-level timeout) is stated. But the collision between two constraints (fast checkout UX vs tolerating PG delay) is not explicit. No explanation of why simply extending timeout was rejected, how delayed callback collision is defended (idempotency), or zombie detection mechanism. Problem is recognized but the synthesis process of constraint collision is incomplete.
  Causal chain depth: 0.6 (PG delay → timeout exceeded → zombie order → orchestration switch, 4 steps but collision with UX constraint is implicit)
  Constraint narrowing: 0.5 (orchestration is stated as the choice, but why choreography or timeout extension were eliminated is unclear)
  Resolution mutation: 0.5 (switched from choreography to orchestration + step-level timeout, but the constraint collision analysis that forced this switch is not shown — result only)
  Score: 0.6×0.30 + 0.5×0.35 + 0.5×0.35 = 0.53 → LISTED
  → CTO reaction: "You switched to orchestration. Why didn't you just extend the timeout?" — Question possible but answer not in the bullet.

CASCADING (score ≥ 0.8) via Constraint Collision:
"Order-payment-inventory-shipping 4-step event pipeline produced an average of 5 orders per day stuck in 'payment complete, inventory not deducted' zombie state — directly triggering customer support tickets. Profiling: 80% of cases traced to PG callback delay (p99 8s) exceeding saga timeout (5s) → compensation transaction triggered → delayed callback arrived immediately after → payment success event collided with an already-cancelled order. Two constraints in collision: fast checkout UX (saga timeout within 5s) vs tolerating PG callback delay (minimum 15s required). Simply extending timeout degrades checkout UX — rejected by business. Alternatives evaluated: choreography saga → no step-level visibility, zombie detection impossible, operational burden; saga timeout extended to 15s → checkout UX degradation, rejected by business; convert PG callback to synchronous polling → PG rate limit + polling cost. Chosen: orchestration saga + step-level timeout separation — payment step alone set to 15s (covers PG p99), remaining steps kept at 3s to minimize overall perceived saga delay. Delayed callback collision defended by idempotency key (order number + event sequence) + state machine — SUCCESS event ignored in COMPENSATED state. Zombie detection: incomplete saga scan every 15 min based on per-step SLA + Slack alert, daily reconciliation batch for final consistency verification. Tradeoffs accepted: step-level timeout management complexity (re-tuning required on PG changes), orchestrator single point of failure (active-passive failover), reconciliation window up to 24h inconsistency. Result: zombie orders 5/day → under 2/month, detection-to-recovery average 4h → 15min."

→ CASCADING via Constraint Collision: two constraints (fast checkout UX 5s vs PG callback delay 15s) cannot coexist under standard approach (single timeout) → problem reframed as step-level timeout separation + delayed callback defense (idempotency state machine) + zombie detection (periodic scan + reconciliation) as a 3-layer resolution. Fundamental shift from single timeout approach to step-level differentiation + state machine + monitoring composite architecture.
  Causal chain depth: 0.85 (PG delay profiled → timeout collision discovered → two constraints (UX vs PG) cannot coexist → 3 alternatives evaluated and rejected → step-level timeout separation + idempotency state machine + zombie scan, 5+ step analytical reasoning chain)
  Constraint narrowing: 0.8 (choreography: rejected by lack of visibility, timeout extension: rejected by UX degradation, polling: rejected by rate limit + cost — each rejection specific within the context of the two-constraint collision)
  Resolution mutation: 0.85 (initial approach was "single saga timeout configuration" (FLAT version). Two-constraint collision makes single timeout impossible → introduced step-level separation as a new dimension + idempotency state machine + reconciliation as 3-layer defense. Problem itself reframed from single configuration to composite architecture. Pattern B — Constraint Collision)
  Score: 0.85×0.30 + 0.8×0.35 + 0.85×0.35 = 0.8325 → CASCADING
  → CTO asks: "How did you determine step-level timeout values? What's the re-tuning process when PG changes? When SUCCESS is ignored in COMPENSATED state, how is the payment amount refunded? What's the automatic recovery scope for inconsistencies found in reconciliation?"

**Constraint Cascade Example E — Subscription Renewal Failures (Expectation Inversion pattern):**

FLAT (score < 0.5):
"Reduced subscription renewal failure from 15% to 4% with exponential backoff retry with jitter and adding fallback payment methods."

→ FLAT: Standard retry pattern applied without analysis. No root cause, no failure type breakdown, no measurement methodology. Any engineer could propose this.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "retry improvement" is the obvious first approach executed as-is)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "Retry with jitter and fallback. That's what I'd expect anyone to do." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Subscription renewal failure at 15% — analyzed failure types: 60% soft declines (insufficient funds), 25% expired cards, 15% hard declines. Noticed soft declines clustered on 1st of month. Adjusted retry timing to avoid peak decline periods. Added account updater API for expired cards. Reduced to 4%."

→ LISTED: Multiple concerns surfaced (failure type breakdown, timing pattern, expired card handling) with some causal connection — failure analysis leads to timing insight, which informs retry adjustment. But the key inversion ("retry logic itself was fine") is not explicitly stated. The reader must infer that the solution changed from "fix retry logic" to "fix retry timing." The conventional assumption (retry mechanism is broken) is implicitly questioned but never named.
  Causal chain depth: 0.6 (failure breakdown → timing pattern → retry adjustment, 3 steps with some implicit links)
  Constraint narrowing: 0.5 (alternatives not explicitly evaluated and rejected — the reader sees the chosen solution but not why other approaches were eliminated)
  Resolution mutation: 0.5 (approach shifted from generic retry to timing-based retry, but the expectation inversion is implicit — text does not state "retry logic was functioning correctly" or explicitly name the conventional assumption that was overturned. The reader senses something changed but cannot trace the inversion arc)
  Score: 0.6×0.30 + 0.5×0.35 + 0.5×0.35 = 0.53 → LISTED
  → CTO reaction: "You analyzed failure types and adjusted timing. What made you look at timing specifically?" — One follow-up, but the inversion story is not self-evident.

CASCADING (score ≥ 0.8) via Expectation Inversion:
"Subscription renewal failure at 15% — failure type breakdown: 60% soft declines (insufficient funds) clustered on 1st of month (rent/mortgage day), 25% expired cards, 15% hard declines. Retry logic was functioning correctly; retry TIMING was the problem. Alternatives evaluated: aggressive retry → increases PSP decline-rate penalties on same empty accounts; pre-charge 3 days early → billing cycle mismatch, legal review required; grace period + dunning → 5-7 day cash flow delay per cohort. Selected: regional payday-pattern-based retry scheduling + account updater API for expired card pre-refresh. Tradeoff accepted: retry window extended 3→7 days (delayed revenue recognition for subset), regional payday mapping requires quarterly maintenance. Result: 15% → 4% without changing retry logic itself."

→ CASCADING via Expectation Inversion: The expected cause (retry logic defect) was wrong, and a non-obvious root cause (retry timing — user payday patterns) was revealed. "Retry logic was functioning correctly" is the key inversion point. The final sentence "without changing retry logic itself" explicitly declares the opposite of the initial expectation.
  Causal chain depth: 0.85 (15% analysis → failure type breakdown → 1st-of-month clustering discovery → "retry logic fine, timing is the problem" key inversion → aggressive retry PSP penalty constraint → scheduling + updater API dual resolution, 5 steps)
  Constraint narrowing: 0.85 (aggressive retry: rejected by PSP penalty — directly linked to timing analysis, pre-charge: rejected by billing cycle + legal, grace period: rejected by cash flow delay — all three alternatives eliminated by specific constraints)
  Resolution mutation: 0.9 (initial expected approach was "fix retry logic" (the FLAT version itself). Inversion: not logic but timing was the problem. Final approach: regional payday-pattern scheduling — redefined from technical problem to behavioral pattern problem. "without changing retry logic itself" confirms the opposite of the initial approach. Pattern C — Expectation Inversion)
  Score: 0.85×0.30 + 0.85×0.35 + 0.9×0.35 = 0.8675 → CASCADING
  → CTO asks: "How did you validate the payday hypothesis? How do you handle non-standard pay cycles (weekly, biweekly)? What's the quarterly maintenance process for regional payday mappings?"

Note: This example achieves CASCADING through Expectation Inversion — the "obvious" answer (fix retry logic) was wrong. The mutation comes from the discovery that the mechanism was correct but the timing was wrong, shifting the problem from a technical domain (retry algorithm) to a behavioral domain (user payment patterns). The final sentence ("without changing retry logic itself") explicitly confirms the inversion.

**Constraint Cascade Example F — Search Performance Degradation (Scope Expansion pattern):**

FLAT (score < 0.5):
"Optimized e-commerce search from 2s to 120ms with Elasticsearch caching and index mapping optimization."

→ FLAT: Standard ES optimization. No root cause for why performance degraded, no degradation pattern analysis, no mechanism to prevent recurrence. Fixes the symptom today, allows the same degradation to repeat tomorrow.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "ES optimization" is the obvious first approach executed as-is)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You optimized Elasticsearch. What else?" — Nothing to discuss.

LISTED (score 0.5-0.8):
"Search response degraded 200ms → 2s over 6 months. Root cause: merchandising team adding 340 custom product attributes, most rarely queried but all indexed identically. Evaluated vertical scaling ($8K/month, degradation resumes) and index partitioning (scatter-gather latency). Implemented attribute tiering — hot attributes in primary index, cold attributes via async enrichment. Result: 120ms p99."

→ LISTED: Multiple concerns surfaced (root cause identification, alternatives evaluated, tiering solution) with causal connection — attribute growth causes degradation, vertical scaling doesn't address root cause. But the scope expansion is incomplete: the text identifies the organizational cause (merchandising team behavior) but does not address it. The reader sees a technical fix for an organizational problem — the deeper structural issue (no feedback loop to merchandising team) is hinted at but not resolved.
  Causal chain depth: 0.65 (degradation → attribute growth → merchandising team behavior identified → alternatives evaluated → tiering chosen, 4 steps but the organizational dimension is mentioned without being causally linked to the solution)
  Constraint narrowing: 0.6 (vertical scaling rejected by cost + recurrence, partitioning rejected by latency — but attribute count limit rejection by stakeholder not mentioned, so the constraint that forces organizational solution is absent)
  Resolution mutation: 0.45 (approach expanded from "optimize ES" to "tier attributes by frequency" — a meaningful shift in framing. However, the deeper expansion from "technical problem" to "organizational behavior problem" is only hinted at, not traced. The solution remains purely technical; the scope expansion arc is incomplete)
  Score: 0.65×0.30 + 0.6×0.35 + 0.45×0.35 = 0.5625 → LISTED
  → CTO reaction: "You tiered attributes by frequency. But won't the same degradation happen again as more attributes accumulate?" — The prevention mechanism is missing.

CASCADING (score ≥ 0.8) via Scope Expansion:
"Search response degraded 200ms → 2s over 6 months — correlated with merchandising team adding 340 custom product attributes (290 queried by <0.1% of searches but indexed identically to high-traffic attributes). Alternatives evaluated: vertical scaling → $8K/month increase, degradation resumes as attributes continue growing; index-per-category partitioning → 15+ indices, scatter-gather adds latency for cross-category search; attribute count limit → merchandising rejected, attributes drive A/B testing. Selected: attribute tiering by query frequency — hot (top 50) in primary index, cold (290) via async enrichment path. Added self-service dashboard showing per-attribute query frequency to merchandising team. Tradeoff accepted: cold-attribute queries add 50-200ms enrichment delay (<0.3% of searches), dashboard maintenance cost, attribute creation friction. Result: 120ms p99 for 99.7% of queries; attribute creation rate dropped 40% organically — informed decisions, not enforcement."

→ CASCADING via Scope Expansion: Surface problem (search performance degradation) → 1st discovery (290 low-frequency attributes indexed identically) → 2nd discovery (merchandising team's unconstrained attribute additions as root cause) → attribute count limit rejected by business → technical restriction impossible, organizational solution needed → tiering (technical) + dashboard (organizational feedback loop) dual resolution. "informed decisions, not enforcement" captures the essence of scope expansion — behavioral change, not technical fix, is the true resolution.
  Causal chain depth: 0.9 (gradual degradation analysis → 290 low-frequency attributes discovered → merchandising team's unconstrained additions identified as cause → vertical scaling "degradation resumes as attributes grow" cannot solve root cause → attribute count limit rejected by business → tiering + dashboard dual resolution, 6 steps)
  Constraint narrowing: 0.85 (vertical scaling: rejected by $8K/mo + recurrence — directly linked to root cause analysis, partitioning: rejected by scatter-gather latency, count limit: rejected by business — this rejection forces the problem space shift from technical fix impossible → organizational solution needed)
  Resolution mutation: 0.9 (initial expected approach was "ES optimization" (the FLAT version itself). Scope expansion: search problem → index problem → attribute problem → organizational behavior problem. Half of the final solution is not code but organizational intervention (dashboard). "informed decisions, not enforcement" completes the technical → organizational transition. Pattern C — Expectation Inversion (Scope Expansion))
  Score: 0.9×0.30 + 0.85×0.35 + 0.9×0.35 = 0.8825 → CASCADING
  → CTO asks: "Did the merchandising team actually change behavior after seeing the dashboard? What are the criteria for attribute promotion/demotion (cold→hot transition)? How do you measure dashboard maintenance cost vs. effectiveness?"

Note: This example achieves CASCADING through Scope Expansion — the surface problem (search is slow) was a symptom of a deeper structural issue (no feedback loop for attribute creation impact). The mutation comes from the problem itself being redefined: from "how to optimize search" to "how to change organizational behavior that causes search degradation." The solution's most impactful component (dashboard) is not code — it's an organizational intervention. The LISTED version demonstrates what happens when scope expansion is incomplete: the organizational cause is identified but not addressed, leaving the CTO's obvious follow-up ("won't this happen again?") unanswered.

---

**Exception:** If the problem is genuinely one-dimensional (single decision with no cascading effects, no measurement needs, no contested alternatives), E3b PASSES automatically. The evaluator must justify WHY the problem is one-dimensional before applying this exception.

**Critical guardrail:** E3b does NOT reward word count. A 15-word clause that surfaces 3 cascading concerns passes. A 200-word paragraph that belabors a single tradeoff fails. The unit of measurement is "distinct engineering concerns surfaced," not characters or sentences.

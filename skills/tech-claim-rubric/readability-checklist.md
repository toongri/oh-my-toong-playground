# Readability Checklist — Phase C Criteria

## Philosophy

Conveying core content compactly is one of the most important abilities a developer can demonstrate. A resume is not proof of "what I know" — it is proof of "what I can distill." When Phase A (E1-E6) validates technical depth, Phase C validates that this depth is delivered in a form appropriate for a formal resume submission.

The hiring pipeline has a brutal funnel: recruiters scan in 6-30 seconds, hiring managers read for 2-5 minutes. If the entry doesn't communicate its value within that window, the candidate doesn't get an interview — and all the depth validated by E3b becomes irrelevant.

**Phase C is independent of Phase A.** It does NOT re-evaluate concerns already covered by E1-E6:
- Tradeoff presence/authenticity → E3a (do NOT re-evaluate in Phase C)
- Causal cascade depth → E3b (do NOT re-evaluate in Phase C)
- Signal clarity → E5 (do NOT re-evaluate in Phase C)
- Phase C evaluates **physical form, structure, density, and reasoning visibility**

---

## R1. Narrative Necessity

**Unit of evaluation:** Each individual sentence

**Core question:** "Does this sentence earn its space by contributing to the reader's understanding of what was done, why it was done (reasoning, alternatives, tradeoffs), or what changed?" R1 is the compactness gate — it asks whether deleting a sentence would leave a gap in the problem→reasoning→solution→result arc. If the narrative reads equally well without it, the sentence is expendable regardless of how interesting or technically valid its content is.

### Why This Matters

Every unnecessary sentence costs the reader cognitive energy — energy they could spend understanding the candidate's engineering judgment. In a resume context where 4-5 entries compete for limited attention, each wasted sentence dilutes all entries, not just its own.

More critically: the ability to identify what is essential vs. what is nice-to-have is itself a core engineering skill. An entry that includes every detail signals "this person cannot prioritize." An entry where every sentence carries weight signals "this person knows what matters."

The check is deceptively simple: cover each sentence, read what remains. If the narrative flows without a gap, the sentence was expendable. But applying this rigorously requires understanding what the narrative IS — the story of "what was broken → what was done → what changed." Anything that doesn't serve this arc is a candidate for removal.

### What to Check

For each sentence in the entry, apply this test:

1. Cover the sentence
2. Read the preceding and following sentences together
3. Ask: "Does the problem → reasoning → solution → result arc still hold? Is there a logical gap?"
4. If the arc holds without the sentence → the sentence is unnecessary → R1 FAIL

**Common removable patterns:**
- Implementation parameters that don't affect the narrative (scheduler polling interval, batch size, specific timeout values). Note: design rationale is NOT removable — rejected alternatives with context-specific reasons, accepted costs/limitations, and verification methods earn their space by making the reasoning visible.
- Problem context that is already resolved by the solution or proven by the result metrics
- Defensive explanations for obvious choices
- Information repeated across sections (constraint stated in problem definition AND re-explained in strategy)

**Important:** R1 does NOT judge whether content is technically interesting — only whether it is narratively necessary. A fascinating implementation parameter that doesn't serve the problem→reasoning→solution→result arc is still removable.

**R1/E3a boundary:** R1 checks whether reasoning is visible to the reader (presence/form). Whether the reasoning is technically valid or the tradeoff is sound is E3a's scope (substance/quality). R1 does not evaluate tradeoff quality — only whether the reasoning is present and visible.

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**FAIL — Removable sentence:**
```
**Strategy**
- Reconciliation scheduler running at 10-second intervals to detect
  unstarted and partially complete items
```
The "10-second interval" is an implementation detail. Removing it:
```
- Reconciliation scheduler to detect and recover unprocessed items
```
The narrative (safety net for message loss) is preserved. The specific interval adds zero to the story — it's an interview answer, not a resume statement.

**FAIL — Repeated constraint:**
```
**Problem Definition**
- External API p50 is 30 seconds, making synchronous retry impractical

**Strategy**
- Because external API calls take 30 seconds on average, we separated
  failed items into a retry topic for non-blocking reprocessing
```
The "30 seconds" constraint appears in both sections. In the strategy, the reader already knows why non-blocking reprocessing is needed — the problem definition established this.

**PASS — Every sentence necessary:**
```
**Problem Definition**
- Daily intake doubled to 5,000 items; display SLA (2hr) achievement
  dropped from 90% to 55%

**Strategy**
- Parallelized 7-attribute LLM inference via goroutine pool, reducing
  per-item processing from 80s to 30s

**Result**
- Display SLA achievement **55% → 95%**
```
Remove the problem definition → "why was parallelization needed?" is unanswered. Remove the strategy → "how was the SLA recovered?" is unanswered. Remove the result → "did it work?" is unanswered. Every sentence is load-bearing.

**PASS — Design rationale retained:**
```
**Strategy**
- 멱등성(image_id + attribute)으로 중복 방지
```
This shows an engineering decision (idempotency strategy with a specific key structure). Removing it would leave the reader unable to understand how the system prevents duplication — the "why this approach" disappears entirely. Design rationale that makes a decision visible is not removable under R1.

**PASS — Design rationale earns its space (reasoning visibility):**
```
**Strategy**
- Orchestrator-based compensating workflow for multi-step operations
  - Choreography evaluated: blame-type-dependent downstream branching
    creates consistency risk across independent services — rejected
  - Accepted: orchestrator as single coordination point, mitigated by
    active-passive failover
```
Under the old "arc test," covering the Choreography rejection and the accepted tradeoff leaves the narrative intact — "orchestrator-based compensating workflow → Result" still holds. But under R1's expanded narrative, removing these sub-bullets leaves the reader unable to understand WHY orchestration was chosen and WHAT was given up.

**Key distinction:** "narrative arc intact" ≠ "reasoning visible." The arc may survive without a sentence, but if removing it makes the reader unable to understand WHY a decision was made, the sentence is load-bearing under R1. R1 requires the rejection to include a *reason* — merely mentioning an alternative ("Choreography rejected") without a context-specific rationale does not pass.

**FAIL — Trivial rationale does not earn space:**
```
**Strategy**
- MongoDB for document storage
  - MySQL evaluated — rejected. MongoDB selected.
```
While structured as a tradeoff, the content provides no reasoning — no context-specific rejection reason, no constraint that led to the choice. The entry reads identically as "MongoDB for document storage" without the sub-bullet. This is a decision *mention*, not design *rationale*. R1 protects reasoning, not name-drops.

---

## R2. Scan Speed + Metric Prominence

**Unit of evaluation:** Entire entry

**Core question:** "In a 6-30 second scan, can the reader grasp 'what was broken → what was done → what improved'? Are before→after metrics immediately visible?"

### Why This Matters

Recruiters scan in 6-30 seconds. If the strongest metric is buried in a strategy paragraph, it might as well not exist. R2 ensures impact numbers are immediately visible during rapid scanning.

### What to Check

1. **Flow test:** Does the entry read top-to-bottom as problem → action → result, with no backtracking required?
2. **Metric placement test:** Are all quantitative before→after metrics in the **Result** section (not buried in Strategy or Problem Definition)?
3. **Anti-qualitative test:** Does the Result section contain only vague/qualitative statements without numbers? ("stable processing", "improved reliability")

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**FAIL — Metric buried in strategy:**
```
**Strategy**
- Decoupled external API calls via SQS, reducing peak-hour order-to-delivery
  time from 90 minutes to 67 minutes

**Result**
- Stable order processing even during external API outages
```
The strongest metric (90min → 67min) is in Strategy. The Result section has no numbers — just a qualitative claim that cannot be verified or compared.

**PASS — Metrics in result section:**
```
**Strategy**
- Decoupled external API calls via SQS, removing POS response blocking
  from the order pipeline

**Result**
- Peak-hour order-to-delivery time **90 min → 67 min**
- Zero order processing delays during external API outages
```
Strategy describes the action. Result quantifies the impact with bold formatting. A 6-second scan catches "90 min → 67 min" immediately.

---

## R3. Narrative Flow

**Unit of evaluation:** Entry structure

**Core question:** "Can the reader trace the flow of problem → reasoning → solution → result without backtracking?"

### Why This Matters

In a resume entry, every section transition must be instant. When content is placed in the wrong area — problem context in the solution area, business symptoms without decision linkage, actions described in the result — the reader must context-switch, creating cumulative cognitive load. R3 checks that the entry's overall flow is coherent and navigable.

### Required Elements

The entry must contain content fulfilling these three roles (section names and count are flexible):
- **Problem area**: What was broken? (symptom, root cause, key constraints)
- **Solution area**: What was done and why? (chosen approach + reasoning behind the choice)
- **Result area**: What changed? (quantitative before→after metrics)

### Additional Sections

Sections beyond the three required roles (e.g., Technical Challenge, Team Context, Background) are permitted when:
1. The section serves a role distinct from the three required areas
2. The section does not duplicate content already present in a required area

**PASS — Additional section with distinct role:**
A "Technical Challenge" section establishing engineering complexity (attribute processing time variance, structural impossibility of meeting SLA) when Problem Definition covers business impact (SLA achievement drop, premium brand delay). Different roles, no content duplication.

**FAIL — Additional section duplicating required area:**
A "Technical Challenge" section that restates the same constraints already in Problem Definition (e.g., both sections mention "PG API partial failure causes inconsistency"). This is cross-layer content duplication.

**PASS — 4-section structure with distinct roles:**
```
**Problem Definition**
- Return processing 3 days, 8+ weekly disputes from manual blame attribution

**Technical Challenge**
- Inspection is manual (free-text input) — structured data extraction
  required for automated classification
- PG/carrier APIs outside DB transaction boundary — partial completion
  states require compensation

**Strategy**
- Structured inspection checklist + rule-based blame auto-classification
  (~80% auto; LLM photo analysis rejected — insufficient accuracy for
  monetary decisions)
- Orchestrator-based compensating workflow per blame type, reverse
  compensation on failure

**Result**
- Processing **3 days → same day**, disputes **8/week → 1/week**
```
Problem Definition establishes business impact (processing time, disputes). Technical Challenge establishes engineering constraints (manual input, transaction boundaries). Each section has a distinct role — no content overlap.

**FAIL — Additional section that duplicates a required area:**
A "Technical Challenge" section restating "수동 귀책 판정으로 처리 지연과 분쟁이 발생" when Problem Definition already says "return processing 3 days, 8+ weekly disputes." This is the same information (processing delay + disputes) rephrased in technical language — cross-layer content duplication regardless of the section name.

### Design Rationale in Solution Area

Technical constraints used as decision motivation in the solution area are **design rationale**, not problem context bleeding. The distinction:

- **Design rationale (PASS):** Technical constraint directly linked to a specific decision
- **Business symptom without decision linkage (FAIL):** Business metrics (revenue, SLA numbers, customer impact) appearing in the solution area without motivating a specific decision

**PASS examples:**
- "외부 API가 DB 트랜잭션에 참여할 수 없으므로 오케스트레이터 기반 보상 워크플로우 선택" — technical constraint (transaction boundary) directly motivates the decision (orchestrator)
- "쿼리 최적화는 인덱스 이미 적용 완료로 한계 → Redis Cache-Aside 도입" — exhausted alternative directly motivates the next decision

**FAIL examples:**
- "매출 기여 40%인 프리미엄 브랜드의 전시가 지연되어 고객 불만이 증가했다" in solution area — business symptom with no decision linkage (belongs in problem area)
- "일일 접수량이 5,000건으로 증가하여 SLA 달성률이 55%로 하락했다" in solution area — business metric describing the problem, not motivating a specific solution decision

### Violations (3 types)

1. **Cross-layer content duplication** — The same constraint, fact, or metric appears in multiple sections. If the problem area states a constraint, the solution area should not re-explain it.
2. **Business symptom in solution area without decision linkage** — Business metrics or customer impact in the solution area that don't directly motivate a specific technical decision.
3. **Action description in result area** — Result sections should contain quantitative before→after metrics, not descriptions of additional actions taken.

**FAIL — Action in Result:**
```
**Result**
- SQS로 비동기 분리하여 외부 장애 시에도 안정적 주문 접수 처리
```
The Result contains an action description ("SQS로 비동기 분리"), not a metric. This belongs in Strategy.

**FAIL — Business symptom without decision linkage in solution area:**
```
**Strategy**
- 일일 접수량이 5,000건으로 증가하여 SLA 달성률이 55%로 하락했다
- Redis Cache-Aside 도입
```
The first bullet is a business metric describing the problem — it belongs in the problem area. It does not motivate a specific decision in the solution area.

**PASS — Metric in Result:**
```
**Result**
- Peak-hour order-to-delivery time **90 min → 67 min**
```

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

---

## R4. Technical Vocabulary Leverage

**Unit of evaluation:** Each individual sentence

**Core question:** "Does this entry use standard industry terminology to achieve concise, intuitive communication?"

### Why This Matters

Standard terminology compresses and signals simultaneously. "SKIP LOCKED-based lock-free issuance" in 5 words conveys what verbose paraphrasing takes 3 sentences to explain, while also signaling the candidate knows the mechanism by its proper name.

**Important caveat:** Only use terms that are **widely recognized in the industry**. Niche terms (specific library internals, company-specific jargon) create confusion rather than compression. The test: "Would a backend engineer at a different company recognize this term?"

### What to Check

1. Scan each sentence for verbose descriptions that have standard term equivalents
2. Verify that used terms are industry-standard (not niche or company-specific)
3. Check that terms are used correctly (misused terminology is worse than verbose description)
4. **Burden of proof on evaluator:** R4 FAIL requires the evaluator to name the specific standard term that should replace the verbose description. If the evaluator cannot name a widely-recognized replacement, R4 PASSes by default. This prevents false FAILs from evaluator vocabulary variance.

**Common substitutions:**

| Verbose description | Standard term |
|---|---|
| "Locked rows are skipped, unlocked row is taken" | `SKIP LOCKED` / lock-free issuance |
| "Cache server" | Redis |
| "Reverse completed steps on failure" | Compensating transaction / Saga |
| "Put messages in a queue for async processing" | Message Queue Consumer-based async processing (e.g., Kafka, SQS) |
| "Check periodically for missed items" | Reconciliation scheduler |
| "Store results in cache to avoid DB hits" | Cache-Aside pattern |
| "Single execution per process to prevent thundering herd" | singleflight |

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**FAIL — Verbose paraphrasing throughout:**
```
**Strategy**
- Pre-generated N coupon rows; when a user requests, the system picks an
  unlocked row and assigns it. Already-claimed rows are skipped, so there
  is zero wait time
  - Other approaches like pessimistic locking or distributed locking
    ultimately require holding a lock, causing contention
- After all coupons are issued, the sold-out state is recorded in the
  cache server so the database is never accessed
```
4 lines to say what 2 lines with proper terminology achieves. "Unlocked row / skipped" = SKIP LOCKED. "Cache server" = Redis. "Pessimistic locking or distributed locking" = "비관적 락·분산 락" (at minimum name them precisely).

**PASS — Standard terminology leveraged:**
```
**Strategy**
- SKIP LOCKED-based lock-free parallel coupon issuance; pre-generated
  rows eliminate contention (비관적·분산 락 대비 경합 제거)
- Redis sold-out flag to cut off DB access after full issuance
```
Same information, half the volume. Every technical choice is named with its recognized term.

---

## R5. Signal Curation

**Unit of evaluation:** Entire entry

**Core question:** "Does this entry list everything the engineer did, or select the most compelling parts to present?"

### Why This Matters

The ability to distill complex project work into its most compelling elements is a core engineering competency — not just a writing skill. It sits at the intersection of three awareness types: self-awareness (which decisions best demonstrate MY judgment), reader-awareness (what will the hiring manager care about most), context-awareness (which claims need the most supporting evidence).

Include everything and nothing stands out. Select the essentials and everything stands out.

### What to Check (3-Layer Test)

**Layer 1 — Skim Test (5-second scan):**

Reading only top-level bullets, can the reader identify: (1) what was broken, (2) the key technical decision, (3) what changed? If any of these three is not visible at the top level → R5 FAIL.

Operational definition of "top-level bullet": the highest-indent `- ` items under each section heading. If visual hierarchy markers (bold text, inline headers) are used, those markers define the top level regardless of indent. If no hierarchy markers exist, every bullet is top-level — and the Skim Test evaluates whether the set of bullets collectively answers the three questions without requiring sequential reading of all sub-bullets.

**Layer 2 — Point Selection:**

Does each included technical decision meet at least one criterion?
- Impact: directly contributed to a quantified outcome
- Judgment: shows engineering judgment (alternative rejected, tradeoff accepted)
- Depth: reveals a non-obvious constraint discovery or approach mutation

If a decision meets none → R5 FAIL.

Corollary: "If you included it, show why. If you can't show why, cut it."

**Layer 3 — Bloat Symptoms:**
- Detail spill: parameters/config values listed without design rationale or systemic consequence
- Exhaustive listing: every task performed is included with no selection
- Scan dependency: within a single section, all bullets must be read sequentially to understand the section's point. Note: cross-section sequential flow (problem→strategy→result) is expected and normal — scan dependency applies within sections, not across them.

Any symptom present → R5 FAIL.

### Layer Evaluation Protocol

Evaluate all three layers regardless of earlier results. Report all failing layers. The layer numbering indicates improvement priority (fix Layer 1 first), not evaluation order.

### R1/R5 Boundary

R1 evaluates whether individual sentences are narratively necessary (sentence-level cover test). R5 evaluates whether entire technical decisions earn inclusion through demonstrated Impact/Judgment/Depth (decision-level curation test). A decision can pass R1 (each sentence carries narrative weight) but fail R5 Layer 2 (the decision itself contributes nothing uniquely compelling to the entry). Conversely, a decision meeting R5 Layer 2 criteria can still fail R1 if individual sentences within it are redundant.

### Length Signal

Entries exceeding 25 lines are not automatically FAIL, but the evaluator should actively ask: "Are there decisions included that don't meet the Layer 2 criteria?" Longer entries have higher probability of containing unjustified inclusions — raise scrutiny proportionally.

### When to Include All Decisions vs Curate

**Independent strategies → Curate (select the essentials):**

When strategies contribute independently to the result without one forcing another, select the core decision(s) and minimize or omit supporting decisions. If a decision is included, its justification (Impact/Judgment/Depth) must be visible. If justification isn't worth showing, the decision isn't worth including.

**Constraint cascade → Include all (show the chain):**

When strategy A's limitation forces strategy B, and B's limitation forces strategy C, include all of them. This is not "listing everything" — it is "showing the cascade." Length is justified because each decision is causally necessary to understand the next. The entry is long because the engineering reality is deep, not because the writer couldn't select.

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**PASS — Independent strategies curated:**

Goroutine pool is the core decision: consumer horizontal scaling rejected because partition increase is irreversible and per-item latency is unchanged; per-attribute topic separation rejected because 7×2×3 = 42 topics + orchestrator overhead; Kafka is an event transport, not a processing engine; in-consumer parallelization is structurally simpler. Accepted tradeoff: no independent per-attribute scaling. Topic separation is a supporting decision: Kafka lacks a priority queue; RabbitMQ rejected for dual-infra burden — brief inclusion is justified. Reconciliation scheduler is omitted entirely — a deliberate curation decision.

- Layer 1 PASS: core decision (goroutine pool) and result (80s→30s per-item, SLA recovery) visible at top level on skim.
- Layer 2 PASS: goroutine pool = Judgment (three alternatives rejected with context-specific reasons) + Depth (constraint: SLA metric is per-item completion, not aggregate throughput); topic separation = Judgment (two infrastructure alternatives rejected).
- Layer 3 no symptoms: no config values without rationale, no exhaustive listing, no scan dependency within sections.

**PASS — Constraint cascade, all decisions included:**

Cache-aside introduced → stampede discovered under load → singleflight applied to collapse concurrent fetches → hot key identified as a separate dimension (single-key pressure unaffected by singleflight) → singleflight scope confirmed as intra-instance only → L1/L2 2-tier cache added to address cross-instance pressure. Each strategy has tradeoff depth. Entry is ~25 lines but every decision is causally necessary.

- Layer 1 PASS: problem (cache stampede under load), cascade of strategies, and final result visible at top level.
- Layer 2 PASS: all decisions meet Judgment + Depth — each is forced by the previous strategy's discovered limitation (constraint cascade).
- Layer 3 no symptoms: no detail spill, no exhaustive listing, no scan dependency within sections. Note: the entry is long because the engineering reality is deep, not because the writer couldn't select.

**FAIL — Skim test fails + exhaustive listing:**

Four strategies listed at equal visual weight with no bold or hierarchy markers. Sub-bullets contain configuration values (pool sizes, timeouts, partition counts) without explaining why those values were chosen.

- Layer 1 FAIL: no strategy stands out as the key decision in a 5-second scan — all four strategies have identical visual prominence.
- Layer 2 FAIL: sub-bullets contain parameters (pool size, timeout values, partition counts) without Impact, Judgment, or Depth — none explain why those values were selected or what happens if they differ.
- Layer 3 FAIL: detail spill (config values without rationale) + exhaustive listing (every implementation task included with no curation).

---

**PASS — Complete entry example:**
```
**Problem Definition**
- Daily intake 2,500→5,000 items; display SLA (2hr) achievement 90%→55%
- Premium brands (40% revenue) delayed by FIFO, no priority mechanism

**Technical Challenge**
- 7-attribute LLM inference per item, display only after all complete.
  Per-item 80s sequential, 5,000 items = SLA structurally impossible
- Single-attribute failure triggers full re-inference → API cost amplification

**Strategy**
- **In-consumer goroutine pool for parallel attribute inference**
  - Consumer horizontal scaling evaluated: increases throughput but
    per-item 80s latency unchanged — SLA metric is per-item completion
  - Per-attribute topic separation evaluated: 7×2×3 = 42 topics +
    orchestrator overhead; Kafka as event transport, not processing engine
  - Per-item 80s→30s (bounded by slowest attribute). Accepted: no
    independent per-attribute scaling; revisit at team/model separation
- **Premium/standard topic separation + differential consumer allocation**
  - Kafka lacks priority queue; RabbitMQ rejected for dual-infra burden
  - Premium consumers allocated 3× standard ratio; rebalanced after observing
    premium lag spike during intake surge — ratio was the fix, not partition count
- **Partial failure non-blocking retry**
  - At small volume, full re-inference acceptable. Volume doubling
    revealed 7× API cost amplification → save-success, retry-failure-only
  - Success persisted immediately; failed attributes to retry topic
- **Reconciliation scheduler** for message loss/crash recovery,
  idempotency (image_id + attribute) for deduplication
  - Periodic re-delivery considered but rejected — re-delivery re-runs all
    attributes including already-succeeded ones, defeating partial-failure savings

**Result**
- Display SLA **55%→95%**, premium display **2hr→40min**
- Failed-attribute-only retry → API cost **80% reduction**
```
R5 PASS — Layer 1: top-level bold strategies (goroutine pool, topic separation, partial failure retry, reconciliation) immediately visible on skim. Layer 2: each strategy demonstrates Judgment (rejected alternatives with context-specific reasons) and Depth (constraint cascade — each strategy forced by the previous one's limitation). Layer 3: no detail spill (all sub-bullets contain decision rationale, not config values), no exhaustive listing (each inclusion is causally necessary for the cascade), no scan dependency within sections.

**FAIL — Complete entry example:**
```
**Problem Definition**
- Display SLA (2hr) achievement 90%→55% after daily intake doubled to 5,000
- Premium brands (40% revenue) delayed; no priority mechanism in FIFO consumer

**Strategy**
- **Goroutine pool for parallel attribute inference**, per-item 80s→30s
  - Pool size set to 14 (2× attribute count); channel buffer size 512
  - WaitGroup for goroutine fan-in at code level
  - Context cancellation timeout per attribute call: 15 seconds
- **Premium/standard topic separation** for priority processing
  - Consumer group naming convention: `{service}-{tier}-consumer-group`
  - Premium topic partition count: 12; standard topic partition count: 6
  - Kafka consumer poll timeout set to 1,000ms per tier
- **Reconciliation scheduler** to detect and recover unprocessed items
  - Polling query: SELECT WHERE status='PENDING' AND updated_at < NOW()-5min
  - Scan interval: 10 seconds; DB connection timeout: 3 seconds per cycle
  - Batch size per scan capped at 100 rows
- **Idempotency** via (image_id + attribute) composite key for deduplication
  - Redis TTL for idempotency key set to 24 hours
  - Key format: `idem:{image_id}:{attribute_name}`
- **Partial failure non-blocking retry**: success saved, failures to retry topic
  - Exponential backoff base 2s, cap 30s, jitter factor 0.2
  - 3 retries then DLQ; DLQ retention period 7 days
  - Retry topic max.poll.records set to 50; offset commit interval: 500ms

**Result**
- SLA **55%→95%**, premium display **2hr→40min**
- Failed-attribute-only retry → API cost **80% reduction**
```
R5 FAIL — Layer 2: 14 sub-bullets contain configuration values (pool size, buffer size, timeout, partition count, poll timeout, scan interval, batch size, TTL, key format, backoff parameters, DLQ retention, poll records, commit interval) without design rationale or systemic consequence — none meet Impact/Judgment/Depth criteria. Layer 3: detail spill (parameters listed without explaining why those values were chosen or what happens if they are different).

**Note on implementation parameters vs design decisions:** A parameter CAN be a design decision when paired with its systemic consequence (e.g., "reduced max.poll.records from 500 to 50 to prevent rebalance loops within 30s session timeout"). The test is whether removing the parameter hides a *decision rationale*, not whether it contains a number. Apply the Point Selection test (Layer 2) to determine if a parameter earns inclusion.

---

## Structural Guide

### 2-Level Bullet Structure

2-level bullet structure is permitted and may improve readability for complex decision entries:

- **Main bullet (bold):** Core decision or approach
  - Sub-bullet: Rejected alternative with context-specific reason
  - Sub-bullet: Accepted tradeoff or limitation
  - Sub-bullet: Design constraint motivating the choice

**Purpose:** Scanning readers can read main bullets only to grasp the overall strategy. Depth-seeking readers (hiring managers, technical interviewers) can read sub-bullets for reasoning detail.

This is guidance, not a rule. Single-level bullets remain valid when the decision is straightforward.

---

## Cross-Validated Complete Examples

### Complete Entry: FAIL (Multiple R Items)

This entry passed E3b CASCADING (0.85) — the technical depth is validated. But it fails resume readability on multiple R items.

```
**Problem Definition**
- Consignment returns involve 3-party relationships (consigner/platform/buyer);
  blame determines completely different refund/shipping/settlement flows.
  Manual blame attribution: processing 3 days, 8+ disputes per week
- "Product condition mismatch" returns have 3 possible causes with identical
  symptoms: inspection error, shipping damage, buyer remorse
- Blame triggers 3 settlement axes simultaneously: buyer refund (PG) + return
  shipping cost allocation + consigner settlement hold/adjustment. PG and carrier
  APIs are outside DB transaction boundary → partial failure inconsistency
- Returned items need re-inspection for grade re-evaluation → grade drop triggers
  re-pricing → re-inspection only possible after physical return → settlement
  pipeline must wait for return resolution
- Consigner can refuse returns per contract terms → platform absorbs inventory risk

**Technical Challenge**
- Inspection is manual (human + free-text) → must extract structured blame-
  determining data from unstructured input
- PG/carrier APIs outside DB transaction boundary → partial completion states
  require compensation
- Settlement amount uncertain until re-inspection → backlog affects settlement cycle
- Consigner refusal creates workflow branch divergence on same return event

**Strategy**
- Structured inspection checklist + rule-based blame classification. Inspectors
  record via structured fields instead of free text. System auto-classifies by
  comparing against sale-time inspection records. LLM photo analysis considered
  but rejected — physical condition accuracy insufficient for monetary decisions.
  ~80% auto-classified, remainder escalated to operators
- Orchestrator-based compensating workflow. External APIs cannot participate in
  DB transactions, so steps execute sequentially per blame type with reverse
  compensation on failure. Choreography also evaluated but rejected — all
  downstream steps vary by blame type, making independent service judgment
  a consistency risk
- Settlement hold + re-inspection confirmation 2-phase. Return triggers hold
  marking on settlement target. Provisional refund with difference settlement
  also evaluated but rejected due to CS risk of additional buyer charges
- Consigner refusal branch: platform absorption workflow. Consignment item →
  platform-owned inventory transfer → re-inspection → grade re-evaluation →
  platform channel listing

**Result**
- Return processing time **3 days → same day**, ~80% auto-classification rate
- Blame disputes **8/week → 1/week**
- External API partial failure → compensating transactions eliminate inconsistency
- Consigner refusal → automated platform absorption replaces manual conversion
```

**Violation analysis:**

| R Item | Verdict | Specific Issue |
|---|---|---|
| R1 | FAIL | Problem Definition bullets 4-5 (re-inspection dependency, consigner refusal) establish constraints that Strategy bullets 3-4 address. However, Strategy bullets 3-4 reintroduce these constraints within their own framing ('decouple return resolution from settlement pipeline', 'platform absorption workflow'), making the Problem Definition statements redundant. The test is not 'does the information appear elsewhere' but 'is the reasoning visible without this sentence' — and Strategy makes the reasoning self-contained. Technical Challenge section (4 lines) largely repeats Problem Definition constraints. |
| R2 | PASS | Result section has bold metrics, flow is top-to-bottom |
| R3 | FAIL | Problem Definition bullet 3 ("PG and carrier APIs are outside DB transaction boundary → partial failure inconsistency") and Technical Challenge bullet 2 ("PG/carrier APIs outside DB transaction boundary → partial completion states require compensation") state the same constraint in two different layers — this is cross-layer content duplication (violation type 1). The constraint belongs in one place; restating it in Technical Challenge adds no new information. Note: Strategy bullet 2's design rationale ("External APIs cannot participate in DB transactions, so steps execute sequentially per blame type with reverse compensation on failure") is the correct pattern — constraint motivates orchestrator choice inline, which is valid. R3 FAIL is for structural duplication between Problem Definition and Technical Challenge, not for the Strategy rationale. |
| R4 | PASS | Orchestrator, Choreography, compensating transaction — standard terms used |
| R5 | FAIL | Layer 2: Technical Challenge bullets (4 lines) describe constraints already established in Problem Definition without independently demonstrating Impact, Judgment, or Depth — these are restated problem context, not selected engineering decisions. Problem Definition bullets 4-5 (re-inspection dependency, consigner refusal) are self-contained by their corresponding Strategy bullets. Layer 3: exhaustive listing — Problem Definition (5 bullets) + Technical Challenge (4 bullets) = 9 bullets of context before any solution begins, with no curation of which constraints are most essential to the narrative. |

### Complete Entry: PASS (All R1-R5)

The same entry compressed for resume readability. All R items pass.

```
**Problem Definition**
- Consignment returns: 3-party blame (consigner/platform/buyer) determines
  completely different refund/shipping/settlement flows. Manual blame attribution
  caused 3-day processing, 8+ disputes/week
- PG/carrier APIs outside DB transaction boundary → partial failure inconsistency

**Strategy**
- Structured inspection checklist + rule-based blame auto-classification: ~80%
  auto-classified by comparing against sale-time records (LLM photo analysis
  rejected — insufficient accuracy for monetary decisions)
- Orchestrator-based compensating workflow: sequential step execution per blame
  type, reverse compensation on failure (Choreography rejected — blame-dependent
  branching creates consistency risk)
- Settlement hold + re-inspection confirmation 2-phase to decouple return
  resolution from settlement pipeline

**Result**
- Return processing **3 days → same day**, blame disputes **8/week → 1/week**
- Compensating transactions eliminate partial-failure inconsistency
```

**Cross-validation:**

| R Item | Verdict | Evidence |
|---|---|---|
| R1 PASS | Every sentence is load-bearing. Remove "PG/carrier APIs outside DB transaction boundary" → orchestrator introduction has no motivation. Remove "LLM photo analysis rejected" → rule-based choice appears unexamined. Consigner refusal workflow removed entirely — serves as interview hook. |
| R2 PASS | Problem (2 lines) → Strategy (7 lines) → Result (2 lines). Bold before→after metrics in Result. 6-second scan captures: "3-party blame automation + compensating workflow → 3 days→same day, 8→1 disputes." |
| R3 PASS | No layer bleeding — key constraint (external API boundary) in Problem Definition, all Strategy bullets are actions, Result contains only metrics. |
| R4 PASS | Orchestrator, Choreography, compensating transaction, settlement hold — all industry-standard terms. "3-party blame" is domain-specific but self-explanatory. |
| R5 PASS | Layer 1: three strategies (structured inspection, orchestrator workflow, settlement 2-phase) visible at top-level via bold. 5-second scan captures problem, decisions, and result. Layer 2: all decisions meet Judgment criterion — each includes a rejected alternative with context-specific reason (LLM photo analysis, Choreography, provisional refund). Layer 3: no symptoms — no detail spill, no exhaustive listing (consigner refusal workflow deliberately omitted as curation decision), no within-section scan dependency. |

**What was removed and why:**
- Consigner refusal branch workflow → 4th strategy, but ancillary. Left as interview hook ("What happens when the consigner refuses?")
- Technical Challenge section → Key constraint (API transaction boundary) merged into Problem Definition because this entry's two constraints could be presented alongside business context without diluting distinct signal. In entries with numerous complex engineering constraints, a separate Technical Challenge section would serve a distinct role.
- Problem Definition bullets 3-5 → settlement axis detail, re-inspection dependency, consigner refusal are all addressed by their corresponding Strategy bullets
- Result bullets 3-4 → "compensating transactions" kept (core value); "consigner refusal automation" removed (strategy was also removed)

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

## R5. Length Awareness

**Unit of evaluation:** Entire entry

**Core question:** "Is this entry's length proportional to its content density?"

### Why This Matters

Resume entries compete for limited reader attention. Longer entries must justify every additional line. However, length alone is not a quality signal — an entry where every sentence demonstrates engineering judgment is stronger than a shorter entry that omits key reasoning.

### Evaluation Criteria

**Per-entry complexity guidelines (참고 수치, 강제가 아님):**

| Complexity | Technical decisions | Line guideline |
|---|---|---|
| High | 3-4 decisions | ~20 lines |
| Medium | 2 decisions | ~16 lines |
| Low | 1 decision | ~13 lines |

These guidelines inform the evaluator's calibration but do not trigger FAIL independently. They help gauge whether an entry's length is proportionate to its complexity.

**R5 evaluation logic:**

| Line count | Action | Verdict |
|---|---|---|
| ≤25 lines | No additional checks needed | R5 PASS |
| >25 lines | Apply R1 cover test at **sub-bullet level**: each markdown `- ` item (including indented sub-bullets) must independently pass R1's cover test | All pass → R5 PASS; any fail → R5 FAIL |

"Sub-bullet" means any item with its own markdown `- ` bullet marker, including indented items.

Tier guidelines are advisory: they inform the evaluator's calibration for entries ≤25 lines but do not trigger FAIL. Only the 25-line threshold + sub-bullet cover test produces R5 FAIL.

**Line counting:** Count source markdown lines in the description block. One newline = one line. Section headings count. Blank lines between sections do NOT count.

### What to Check

1. Count total description lines
2. If ≤25 lines → R5 PASS
3. If >25 lines → Apply R1 cover test to each individual sub-bullet. Any sub-bullet that fails the cover test → R5 FAIL
4. Check complexity tier guidelines for calibration reference (advisory only)

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**PASS — 30 lines, every sub-bullet justified:**
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
30 lines > 25-line threshold → sub-bullet cover test applied:
- "Consumer horizontal scaling evaluated..." → removing it: reader doesn't know why not just add consumers. PASS.
- "Per-attribute topic separation evaluated..." → removing it: reader doesn't know why not separate topics. PASS.
- "Accepted: no independent per-attribute scaling..." → removing it: hides the cost of this design. PASS.
- "At small volume, full re-inference acceptable..." → removing it: eliminates the resolution mutation narrative. PASS.
- "Premium consumers allocated 3× standard ratio; rebalanced after observing premium lag spike during intake surge — ratio was the fix, not partition count" → removing it: reader doesn't know why consumer ratio matters or how it was determined; topic separation appears fully solved by the 1-sub-bullet above. PASS.
- "Periodic re-delivery considered but rejected — re-delivery re-runs all attributes including already-succeeded ones, defeating partial-failure savings" → removing it: reader doesn't know what alternative was considered for recovery; reconciliation scheduler appears as the obvious choice with no examined alternative. PASS.

Every sub-bullet independently passes. **If even 1 sub-bullet fails the cover test, the entry is R5 FAIL.** R5 PASS.

**FAIL — 26 lines, sub-bullet cover test reveals removable content:**
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
26 lines > 25-line threshold → sub-bullet cover test applied:
- "Pool size set to 14 (2× attribute count); channel buffer size 512" → configuration values; pool role is understood without specific sizing. FAIL.
- "WaitGroup for goroutine fan-in at code level" → code-level implementation detail, not a design decision. FAIL.
- "Context cancellation timeout per attribute call: 15 seconds" → operational parameter; parallel inference is understood without the specific timeout. FAIL.
- "Consumer group naming convention: `{service}-{tier}-consumer-group`" → naming convention detail; topic separation strategy is understood without it. FAIL.
- "Premium topic partition count: 12; standard topic partition count: 6" → infrastructure parameter; priority separation concept needs no specific numbers. FAIL.
- "Kafka consumer poll timeout set to 1,000ms per tier" → operational parameter. FAIL.
- "Polling query: SELECT WHERE status='PENDING' AND updated_at < NOW()-5min" → implementation detail; scheduler role is understood without the exact query. FAIL.
- "Scan interval: 10 seconds; DB connection timeout: 3 seconds per cycle" → operational parameters. FAIL.
- "Batch size per scan capped at 100 rows" → configuration value; scheduler function is understood without the batch limit. FAIL.
- "Redis TTL for idempotency key set to 24 hours" → configuration value; idempotency strategy is understood without the TTL. FAIL.
- "Key format: `idem:{image_id}:{attribute_name}`" → implementation detail; composite key strategy is understood without the exact format. FAIL.
- "Exponential backoff base 2s, cap 30s, jitter factor 0.2" → configuration detail; backoff strategy is understood without the exact values. FAIL.
- "DLQ retention period 7 days" → operational parameter. FAIL.
- "Retry topic max.poll.records set to 50; offset commit interval: 500ms" → operational parameters. FAIL.

14 sub-bullets fail the cover test → R5 FAIL. Same domain as the PASS example — the difference is reasoning density, not topic.

**Note on implementation parameters vs design decisions:** A parameter CAN be a design decision when paired with its systemic consequence (e.g., "reduced max.poll.records from 500 to 50 to prevent rebalance loops within 30s session timeout"). The test is whether removing the parameter hides a *decision rationale*, not whether it contains a number.

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
| R5 | FAIL | ~33 lines > 25-line threshold. Sub-bullet cover test reveals 6 failing sub-bullets: Problem Definition bullet 4 (re-inspection dependency — Strategy bullet 3 makes it self-contained by explaining the 2-phase hold approach), Problem Definition bullet 5 (consigner refusal — Strategy bullet 4 makes it self-contained by describing the platform absorption workflow), Technical Challenge bullet 1 (manual inspection / unstructured input — restates the Problem Definition constraint on blame attribution in technical language), Technical Challenge bullet 2 (PG/carrier APIs outside DB transaction boundary — restates Problem Definition bullet 3 constraint), Technical Challenge bullet 3 (settlement amount uncertain until re-inspection — restates Problem Definition bullet 4 constraint), Technical Challenge bullet 4 (consigner refusal creates workflow branch divergence — restates Problem Definition bullet 5 constraint). All 4 Technical Challenge bullets restate Problem Definition constraints without adding new information. |

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
| R5 PASS | 14 lines total. Well within 25-line threshold. (Guideline: 3 technical decisions = high complexity, ~20 lines.) |

**What was removed and why:**
- Consigner refusal branch workflow → 4th strategy, but ancillary. Left as interview hook ("What happens when the consigner refuses?")
- Technical Challenge section → Key constraint (API transaction boundary) merged into Problem Definition because this entry's two constraints could be presented alongside business context without diluting distinct signal. In entries with numerous complex engineering constraints, a separate Technical Challenge section would serve a distinct role.
- Problem Definition bullets 3-5 → settlement axis detail, re-inspection dependency, consigner refusal are all addressed by their corresponding Strategy bullets
- Result bullets 3-4 → "compensating transactions" kept (core value); "consigner refusal automation" removed (strategy was also removed)

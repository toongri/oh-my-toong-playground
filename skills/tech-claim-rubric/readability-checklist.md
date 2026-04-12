# Readability Checklist — Phase C Criteria

## Philosophy

Conveying core content compactly is one of the most important abilities a developer can demonstrate. A resume is not proof of "what I know" — it is proof of "what I can distill." When Phase A (E1-E6) validates technical depth, Phase C validates that this depth is delivered in a form appropriate for a formal resume submission.

The hiring pipeline has a brutal funnel: recruiters scan in 6-30 seconds, hiring managers read for 2-5 minutes. If the entry doesn't communicate its value within that window, the candidate doesn't get an interview — and all the depth validated by E3b becomes irrelevant.

**Phase C is independent of Phase A.** It does NOT re-evaluate concerns already covered by E1-E6:
- Tradeoff presence/authenticity → E3a (do NOT re-evaluate in Phase C)
- Causal cascade depth → E3b (do NOT re-evaluate in Phase C)
- Signal clarity → E5 (do NOT re-evaluate in Phase C)
- Phase C evaluates **physical form, structure, and density** only

---

## R1. Narrative Necessity

**Unit of evaluation:** Each individual sentence

**Core question:** "Does this sentence earn its space?" R1 is the compactness gate — it asks whether deleting a sentence would leave a gap in the problem→solution→result arc. If the narrative reads equally well without it, the sentence is expendable regardless of how interesting or technically valid its content is.

### Why This Matters

Every unnecessary sentence costs the reader cognitive energy — energy they could spend understanding the candidate's engineering judgment. In a resume context where 4-5 entries compete for limited attention, each wasted sentence dilutes all entries, not just its own.

More critically: the ability to identify what is essential vs. what is nice-to-have is itself a core engineering skill. An entry that includes every detail signals "this person cannot prioritize." An entry where every sentence carries weight signals "this person knows what matters."

The check is deceptively simple: cover each sentence, read what remains. If the narrative flows without a gap, the sentence was expendable. But applying this rigorously requires understanding what the narrative IS — the story of "what was broken → what was done → what changed." Anything that doesn't serve this arc is a candidate for removal.

### What to Check

For each sentence in the entry, apply this test:

1. Cover the sentence
2. Read the preceding and following sentences together
3. Ask: "Does the problem → solution → result arc still hold? Is there a logical gap?"
4. If the arc holds without the sentence → the sentence is unnecessary → R1 FAIL

**Common removable patterns:**
- Implementation details that don't affect the narrative (scheduler polling interval, batch size, specific timeout values)
- Problem context that is already resolved by the solution or proven by the result metrics
- Defensive explanations for obvious choices
- Information repeated across sections (constraint stated in problem definition AND re-explained in strategy)

**Important:** R1 does NOT judge whether content is technically interesting — only whether it is narratively necessary. A fascinating implementation detail that doesn't serve the problem→solution→result arc is still removable.

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

## R3. Layer Separation

**Unit of evaluation:** Section boundaries

**Core question:** "Does each section (Problem Definition / Strategy / Result) serve exactly one role, with no cross-contamination?"

### Why This Matters

In a 10-20 line resume entry, every section transition must be instant. When a Strategy section starts with problem context, the reader must context-switch — "is this still the problem or the solution?" — creating cumulative cognitive load.

### What to Check

**Section role definitions:**
- **Problem Definition**: What was broken? (symptom + root cause + key constraint)
- **Strategy**: What was done? (chosen approach + brief rejection signal where needed)
- **Result**: What changed? (quantitative before→after metrics)

**Specific violations to detect:**

1. **Problem domain structure is free** — The problem area (Problem Definition, Technical Challenge, etc.) may use any internal structure, including separate subsections. The requirement is that problem→strategy→result flow exists, not that the problem domain uses a specific format. However, content duplication across layers (restating the same constraint in both Problem Definition and Strategy) still violates R3.

2. **Problem context in Strategy** — Strategy bullets that start with problem explanations:
   - FAIL: "Since external APIs cannot participate in DB transactions, we implemented..."
   - PASS: "Orchestrator-based compensating workflow for multi-step operations across external API boundaries"
   - The constraint ("external APIs outside DB transaction boundary") belongs in Problem Definition.

3. **Strategy content in Result** — Result bullets that describe additional actions rather than metrics.

**PASS — Separate "기술 과제" section (structural choice, not layer bleeding):**
```
**Problem Definition**
- Daily intake doubled to 5,000 items; display SLA dropped to 55%

**Technical Challenge**
- Per-item processing takes ~80s sequentially; 5,000 items = 111 hours vs 2-hour SLA
- Single attribute failure discards all 7 results → full re-inference

**Strategy**
- Goroutine pool for parallel inference, reducing per-item time to 30s
```
The "기술 과제" section is a structural subdivision within the problem domain. It does not bleed into Strategy — Strategy contains only actions.

**FAIL — Problem context in Strategy (layer bleeding, regardless of structure):**
```
**Strategy**
- Because external API calls take 30 seconds on average and cannot
  participate in DB transactions, we implemented an orchestrator-based
  compensating workflow
```
The first clause ("Because external API calls take 30 seconds...cannot participate in DB transactions") is problem context. It belongs in Problem Definition or Technical Challenge, not in Strategy. The strategy should start with the action: "Orchestrator-based compensating workflow for multi-step operations across external API boundaries."

**FAIL — Action in Result:**
```
**Result**
- SQS로 비동기 분리하여 외부 장애 시에도 안정적 주문 접수 처리
```
The Result contains an action description ("SQS로 비동기 분리"), not a metric. This belongs in Strategy.

**PASS — Metric in Result:**
```
**Result**
- Peak-hour order-to-delivery time **90 min → 67 min**
```

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**FAIL — Problem context bleeds into Strategy:**
```
**Strategy**
- Redis Cache-Aside to reduce DB hits
  - Query optimization was already at its limit with indexes fully applied
  - Local Cache was ruled out due to inconsistency across multiple servers
    with frequent product state changes
```
"Query optimization at its limit" and "Local Cache ruled out" are problem context (what was tried/considered), not strategy (what was done). They explain WHY Cache-Aside was chosen, but in a format that mixes layers.

**PASS — Clean separation:**
```
**Problem Definition**
- Product listing API p95 500ms+, DB CPU 90%. Index optimization already
  applied; remaining bottleneck is per-request DB hit volume

**Strategy**
- Redis Cache-Aside with separate invalidation policies: list cache
  (TTL 5min) and detail cache (event-driven eviction on state change)
```
The problem section establishes "indexes aren't enough" — the reader enters Strategy already knowing why caching was needed.

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

## R5. Volume Compliance

**Unit of evaluation:** Entire entry

**Core question:** "Does this entry fit within the physical length appropriate for a formal resume?"

### Why This Matters

4-5 entries at 20+ lines each produces 80-100+ lines — a wall of text that defeats scannability. The line budget matches entry length to problem complexity.

### Evaluation Criteria

**Per-entry line budget (description block only, excluding title/subtitle/caption/skills):**

| Complexity | Technical decisions | Line budget (max) |
|---|---|---|
| High | 3-4 decisions | ≤20 lines |
| Medium | 2 decisions | ≤16 lines |
| Low | 1 decision | ≤13 lines |
| **Hard cap** | — | **20 lines** |

**Technical decision**: A choice where a named alternative was considered and rejected with a stated reason ("chose X over Y because Z"). Count each such choice as one decision. Implementation parameters of a chosen approach (TTL value, batch size, polling interval) are NOT separate decisions. A technique mentioned without an explicitly rejected alternative does not count as a decision.

**Line counting:** Count source markdown lines in the description block. One newline = one line. Section headings (**Problem Definition**, **Strategy**, **Result**) count. Blank lines between sections do NOT count — they are formatting, not content.

**Section budget guide:**
- Problem Definition: 2-3 lines
- Strategy: 6-12 lines (flexible based on complexity)
- Result: 2-3 lines

### What to Check

1. Count total description lines — exceeds hard cap 20?
2. Count technical decisions in Strategy — does line count match complexity?
3. Check Problem Definition length — exceeds 3 lines?
4. Check if 4+ strategy bullets each span 3+ lines — likely over-detailed

> For a complete entry passing all R1-R5, see [Cross-Validated Complete Examples](#cross-validated-complete-examples) at the end of this document.

### Examples

**FAIL — 33 lines, hard cap exceeded:**
An entry with 5-line problem definition + 4-line technical challenge section + 20-line strategy + 4-line result. Even though each section is individually reasonable, the total far exceeds the 20-line cap. The "technical challenge" section alone adds 4 lines of structural overhead.

**PASS — 12 lines, medium complexity:**
```
**Problem Definition**
- Product listing API p95 500ms+, DB CPU 90%. Per-request DB direct
  query is the bottleneck

**Strategy**
- Redis Cache-Aside with dual invalidation: list cache (5min TTL) and
  detail cache (event-driven eviction on state change)
- singleflight + TTL jitter for cache stampede defense (lower operational
  overhead vs distributed lock)

**Result**
- Product API p95 **500ms → 150ms**, peak DB CPU **90% → 45%**
```
2 technical decisions, 12 lines total. Problem definition is 2 lines. Strategy is 6 lines. Result is 2 lines. Clean within the medium complexity budget.

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
| R1 | FAIL | Problem Definition bullets 4-5 (re-inspection dependency, consigner refusal) are narratively resolved by Strategy bullets 3-4. Removing them creates no gap — the reader encounters the solutions that address these concerns naturally. Technical Challenge section (4 lines) largely repeats Problem Definition constraints. |
| R2 | PASS | Result section has bold metrics, flow is top-to-bottom |
| R3 | FAIL | Strategy bullet 2 starts with problem context ("External APIs cannot participate in DB transactions") — this constraint belongs in Problem Definition. Strategy bullet 3 opens with "Return triggers hold marking" without context bleed, demonstrating correct separation. |
| R4 | PASS | Orchestrator, Choreography, compensating transaction — standard terms used |
| R5 | FAIL | ~33 lines total, far exceeds 20-line hard cap. Problem Definition (5 lines) + Technical Challenge (4 lines) = 9 lines before Strategy even begins |

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
| R3 PASS | No layer bleeding — key constraint (external API boundary) in Problem Definition, all Strategy bullets are actions, Result contains only metrics. Problem domain structure (whether using separate "Technical Challenge" or not) is a free choice. |
| R4 PASS | Orchestrator, Choreography, compensating transaction, settlement hold — all industry-standard terms. "3-party blame" is domain-specific but self-explanatory. |
| R5 PASS | 14 lines total. 3 technical decisions (blame classification + orchestrator + settlement hold) = high complexity → ≤20 line budget. At 14 lines, comfortably within budget. |

**What was removed and why:**
- Consigner refusal branch workflow → 4th strategy, but ancillary. Left as interview hook ("What happens when the consigner refuses?")
- Technical Challenge section → key constraints merged into Problem Definition in 1 line
- Problem Definition bullets 3-5 → settlement axis detail, re-inspection dependency, consigner refusal are all addressed by their corresponding Strategy bullets
- Result bullets 3-4 → "compensating transactions" kept (core value); "consigner refusal automation" removed (strategy was also removed)

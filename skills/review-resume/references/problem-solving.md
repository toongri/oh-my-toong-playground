# Problem-Solving Evaluation Reference

## Table of Contents

 1. [Depth Determination](#1-depth-determination)
 2. [Career-Level Depth Distribution Guide](#2-career-level-depth-distribution-guide)
 3. [Career-Level Selection Criteria](#3-career-level-selection-criteria)
 4. [Kick Project](#4-kick-project)
 5. [P.A.R. Evaluation Dimensions P1-P4](#5-par-evaluation-dimensions-p1-p4)
 6. [P.A.R. Additional Dimensions P5-P7](#6-par-additional-dimensions-p5-p7)
 7. [Career-Level Misapplication Guard](#7-career-level-misapplication-guard)
 8. [P.A.R. Evaluation Output Format](#8-par-evaluation-output-format)
 9. [Before/After Detection](#9-beforeafter-detection)
10. [Improvement Analysis](#10-improvement-analysis)
11. [Specific Feedback Principles](#11-specific-feedback-principles)
12. [AI-Style Overpackaging Detection](#12-ai-style-overpackaging-detection)
13. [Visual Material Guidelines](#13-visual-material-guidelines)
14. [Writing Guidance: P.A.R.](#14-writing-guidance-par)
15. [Writing Guidance Trigger](#15-writing-guidance-trigger)
16. [Red Flags](#16-red-flags)
17. [Technical Substance Verification T1-T3](#17-technical-substance-verification-t1-t3)
18. [T1-T3 Output Format](#18-t1-t3-output-format)
19. [T1-T3 Writing Guidance Trigger](#19-t1-t3-writing-guidance-trigger)

---

## Mandatory Evaluation Checklist

The following items must be checked when evaluating the problem-solving section, and the results must be included in the HTML Report output.

### Structure Check
- [ ] [Problem] verbose verdict — if 2 or more of the following signals apply, recommend splitting [Overview]+[Problem]:
  - Business context + technical issue mixed inside [Problem]
  - [Problem] alone is 5+ lines
  - 3+ lines of background explanation before reaching "why this is a problem"
  - If no signals apply, judge as no split needed and move on
- [ ] If [Reflection] exists → FLAG sentimental growth narrative; architecture limits + expansion direction (2-3 lines) is OK. [Reflection] itself is OPTIONAL

### Portfolio Diversity
- [ ] Classify themes for all problem-solving entries (Consistency, Performance, Resilience, Business Metrics, Data Pipeline, etc.)
- [ ] If 2+ entries share the same theme → FLAG — theme overlap warning + recommend replacement

### Per-Entry Required Checks
- [ ] All entries (5+ lines): Apply P.A.R. P1-P2, P4, check for failure arc
- [ ] Kick entry: additionally apply P3 (Verification depth)
- [ ] Senior-level entries: additionally apply P5-P7 (Domain-specific failure reasoning, Stopping judgment, Business impact)

---

## Overview

The resume's problem-solving entries are **detailed descriptions showing how this person solves problems**. All 5-line+ entries are evaluated with the same criteria.

**Minimum length rule**: 5줄 미만이면 Career 불렛으로 이동. Problem-solving entries under 5 lines do not belong in the Problem-Solving section.

---

## 1. Depth Determination

All problem-solving entries with 5+ lines are evaluated with the same criteria. Apply Problem-Solving 6 Criteria (Diagnostic Causation · Evidence Depth · Thought Visibility · Beyond-Standard Reasoning · Interview Depth · Section Fitness) to every entry, then apply P.A.R. P1-P2, P4 additionally. The kick entry additionally applies P3.

Entries under 5 lines belong in Career bullets, not Problem-Solving.

---

## 2. Career-Level Depth Distribution Guide

5-8 entries recommended. Nominate 1 kick project for deeper treatment (15-25 lines).

**Note candidate pool**: If candidates exist at `$OMT_DIR/review-resume/problem-solving/`, you may suggest the most JD-relevant combination from the full candidate pool — not just the entries currently in the resume.

### Portfolio Theme Diversity

When evaluating the full problem-solving portfolio, check **technical theme diversity**. Flag if 2 or more entries share the same theme.

| Technical Theme | Example Topics |
|----------------|---------------|
| Consistency | race condition, distributed lock, transaction sync |
| Performance | caching, query optimization, response time |
| Resilience | circuit breaker, retry, fallback, fault isolation |
| Business Metrics | cost reduction, headcount, conversion rate |
| Data Pipeline | ETL, streaming, batch processing |

**Why it matters**: Multiple projects with the same theme give the impression "this person only knows this one thing." Recommend combinations where each entry covers a different theme.

---

## 3. Career-Level Selection Criteria

The framing of a problem-solving entry must match the candidate's career level. The P.A.R. structure is the same, but what needs to be proven differs.

| Career Level | Years | What to Prove | Focus | Key Evidence |
| --- | --- | --- | --- | --- |
| Junior | <7 | Problem-solving depth + technical foundations | CS depth, learning velocity | Clear problem→approach→result arc; 3+ failed attempts with specific learning |
| Senior | 7+ | Engineering judgment, trade-off awareness, business impact | Experiment-based decisions, domain-specific failures, stopping judgment | Business outcome metrics, team/org influence, trade-off analysis with data |

Kick nomination criteria (applicable across all career levels):

1. Was this technically the hardest problem you faced?
2. Are there 2-3 failed attempts with specific numbers?
3. Did you repeatedly ask yourself "Why?" at each step?
4. Is there data-validated evidence of the result?
5. Can you explain "Why did I try this?" and "Why didn't it work?" for each attempt?

For Senior: the four kick strengths are:

1. **No single right answer** — problems where the answer requires judgment, not just CS knowledge
2. **Experiment-based decisions** — model comparisons, A/B tests, metric-driven choices
3. **Stopping judgment** — "93% was achievable, but we stopped at 85% for cost reasons"
4. **Business impact** — headcount reduction, cost savings, throughput improvement measured in business terms

**Target-Scale Awareness (all career levels):**

When selecting kick entries, prioritize episodes that can demonstrate technical credibility at the target company's scale:
- Episodes where design judgment accounts for future scaling, even at a small current scale
- Experiences where the candidate recognized the limits of the current scale and anticipated the next stage
- Episodes where deep problem-solving at a small scale demonstrates principles that transfer to larger scale

This selection guide informs the tech-claim-examiner's axis evaluation when assessing scale transferability.

---

## 4. Kick Project

The kick project is the single entry nominated for deeper treatment. It receives 15-25 lines and has P3 (Verification depth) additionally applied on top of the standard P.A.R. evaluation.

### Nomination Process

1. **Evaluator nominates**: Based on §3 selection criteria, identify the strongest candidate. Announce: "I recommend nominating [{entry name}] as the kick project based on [reason from criteria 1-5]."
2. **User confirms**: The user confirms or selects a different entry.
3. **Kick evaluation**: Apply full P.A.R. P1-P3, P4, P5-P7 (for Senior) to the kick entry. Standard entries apply P1-P2, P4.

### Kick Target

- **Length**: 15-25 lines
- **Additional dimension**: P3 (Verification depth) — is the verification appropriate for the domain?
  - Junior: intentional failure scenario reproduction + edge case coverage
  - Senior: business metric validation + error analysis per stage

### Non-kick Entries

All other problem-solving entries (5+ lines) apply P1-P2, P4 (and P5-P7 for Senior-level entries). P3 is kick-only.

---

## 5. P.A.R. Evaluation Dimensions P1-P4

Apply to all problem-solving entries (5+ lines). After Problem-Solving 6 Criteria evaluation, apply P1-P2, P4 as additional evaluation. P3 applies to kick entry only.

| \# | Dimension | Question | Fail Signal |
| --- | --- | --- | --- |
| P1 | Narrative depth | Is this a story of thought process, not a technology list? | "Used Redis distributed lock", "Used GPT-4" — results only, no reasoning |
| P2 | Failure arc | Are there 2-3 attempts with specific failure numbers? | No failure process, or jumps directly to final solution without showing failed attempts |
| P3 | Verification depth *(kick only)* | Is the verification appropriate for the domain? | Junior: only "ran load test". Senior: only "85% accuracy" with no error analysis |
| P4 | "Why?" chain | Does every attempt include both "Why did I try this?" AND "Why didn't it work?" | Either the selection reason OR the failure reason is missing from any attempt |

**P1 Target-Scale Note:** When evaluating narrative depth, check whether the narrative of technology choices stops at "optimization at current scale" or extends to "awareness of scale change." The latter earns a bonus on narrative depth. Its absence is not an automatic FAIL — this is explicitly evaluated by tech-claim-examiner as part of overall axis assessment.

**Feature Listing Anti-Pattern**: If the project entry consists only of verb + feature/technology name, flag immediately as P1 FAIL:

- Specific patterns to detect: `[feature name] developed / [기능명] 개발` (e.g., "Pagination feature developed", "페이징 기능 개발")
- `[tech name] implemented / [기술명] 구현` (e.g., "OAuth social login implemented", "소셜 로그인 구현")
- `[tech name] applied / [기술명] 적용` (e.g., "Kafka applied", "카프카 적용")
- `[tech name] integrated / [기술명] 연동` (e.g., "Payment API integrated", "결제 API 연동")
- Pattern: \[feature/tech name\] + verb only, no problem context, no outcome → flag as "Feature Listing Anti-Pattern"

---

## 6. P.A.R. Additional Dimensions P5-P7

Apply P5-P7 additionally to all problem-solving entries from Senior candidates (7+ years of professional experience). Expectations scale with career level — a Junior entry is not penalized for missing stopping judgment; a Senior entry is.

| \# | Dimension | Question | Fail Signal |
| --- | --- | --- | --- |
| P5 | Domain-specific failure reasoning | Does each attempt's failure explain WHY this approach doesn't work in THIS domain (not just CS principles)? | Explains failure using only CS principles (MVCC, CAP) without domain context, or lists numbers without causal reasoning |
| P6 | Stopping judgment | Is there an explicit, intentional decision to stop at a certain point for cost/time/risk reasons? | The final number (85%, 93%) is stated without explaining the judgment behind stopping there |
| P7 | Business impact | Are business outcomes (headcount reduction, cost savings, revenue impact) stated in concrete terms? | Abstract language: "performance improvement", "efficiency gain". No monetary amount, ratio, or count |

**P7 Target-Scale Note:** Consider whether the business impact figure is impressive at the target company's scale. "Headcount reduction 11→3" is a significant result in a small team, but if the target company has 500 engineers, the relative impact of this figure changes. Prioritize "quality of judgment" and "transferability of approach" over the absolute value of the number.

---

## 7. Career-Level Misapplication Guard

**IMPORTANT: Do not evaluate Senior problem-solving entries using Junior criteria.**

| Junior Criterion (misapplied to Senior) | Senior Criterion (correct) |
| --- | --- |
| "Insufficient CS depth" (no mention of MVCC, CAP) | "Does engineering judgment come through?" |
| "No intentional Race Condition reproduction" | "Is the verification appropriate for the domain (error analysis, sample testing)?" |
| Expecting CS mechanism for "Why Vision+Text separation?" | "Why this structure?" — experimental results and domain reasons are sufficient |
| "Attempt 1 failure was predictable" | "Even a predictable failure is valuable when confirmed experimentally" |
| Treating "stopping judgment" as a weakness | "Stopping judgment" is a core strength of production-level engineering |

**IMPORTANT: Do not evaluate Junior problem-solving entries using Senior criteria.**

| Senior Criterion (misapplied to Junior) | Junior Criterion (correct) |
| --- | --- |
| "Where are the 3 failed attempts?" → wrong framing | "Does the CS depth come through in the failure arc?" |
| "Where's the trade-off analysis?" | "Is the trade-off explained through CS principles like MVCC, CAP?" |
| "Where's the business impact?" | Junior proves CS depth and learning velocity — business impact is not the goal |
| "No stopping judgment present" | Stopping judgment is a Senior concept — not expected from Junior |

---

## 8. P.A.R. Evaluation Output Format

All entries (5+ lines):

```
[Problem-Solving: {entry name}]
- Problem-Solving 6 Criteria: (output separately, refer to Section-Specific Evaluation)
- P1 Narrative depth: PASS / FAIL (reason)
- P2 Failure arc: PASS / FAIL (reason)
- P4 "Why?" chain: PASS / FAIL (reason)
```

Kick entry (append P3):

```
- P3 Verification depth: PASS / FAIL (reason)  ← kick only
```

For Senior entries, append:

```
- P5 Domain-specific failure reasoning: PASS / FAIL (reason)
- P6 Stopping judgment: PASS / FAIL (reason)
- P7 Business impact: PASS / FAIL (reason)
```

---

## 9. Before/After Detection

### Junior Example

**Before — Feature Listing Anti-Pattern (flag immediately):**

```
Online Bookstore Shopping Mall
• Developed first-come-first-served coupon issuance feature
• Resolved concurrency issue using Redis distributed lock
Using Spring Boot, MySQL, Redis
• Ran load test with JMeter
• Performance improvement completed
```

Before problems:

- "Used Redis", "resolved concurrency" = results only, no reasoning
- No explanation of why Redis, whether alternatives were considered
- Thought process: zero. Engineering depth: zero.
- Hiring manager reaction: "So what did you actually learn?" (Skip)

**After — Junior Gold Standard (CS depth + thought process):**

```
Online Bookstore — First-Come-First-Served Coupon System

[Problem]
Critical bug discovered during final project QA: 152 coupons issued against a stock of 100. Could not reproduce
locally. Forced Thread.sleep(100) to reproduce the concurrency scenario. Root cause identified: under MySQL READ
COMMITTED isolation level, two concurrent transactions reading the same stock — an inevitable issue given MVCC behavior.

[Solution Process]
Attempt 1 — Can this be solved without a lock?
Optimistic lock + CAS: 950 of 1,000 concurrent requests failed, retry storms. Even with Exponential Backoff
optimization, average response time 1.2s. Raising DB isolation level (SERIALIZABLE): Gap Lock occurred,
throughput dropped 60%. Rejected.

Attempt 2 — Which type of lock?
Pessimistic lock (SELECT FOR UPDATE): Lock Escalation caused Table Lock promotion, connection pool exhaustion,
response 800ms. Application lock (synchronized): worked on single server, but no Scale-out support. Tested with
2 servers → reproduced immediately. Insight: need a lock that works in a distributed environment.

Attempt 3 — Why Redis distributed lock?
Reason for choosing Redis: Lua script atomicity, automatic TTL release, Single Thread blocks Race Condition.
Redisson vs custom implementation: Spin Lock inefficiency vs Pub/Sub-based Wait/Notify. Chose Redisson.
Lock configuration rationale: Wait 3s (first-come-first-served nature), Lease 5s (max logic execution time + margin).

[Verification]
JMeter 100 concurrent threads, Ramp-up 0s. Stock 100 → 100 issued, 0 duplicates.
Lock Contention measurement: pattern analysis via Redis MONITOR, average wait 180ms, max 2.8s.
Extreme scenario: stock 10, 500 concurrent requests → only 10 succeeded, consistency 100%.

[Reflection]
Learned: MVCC and isolation level trade-offs, distributed system consistency (CAP theorem), Redlock algorithm and
its limits (Martin Kleppmann paper).
Acknowledged limits: Redis SPOF, idempotency not guaranteed. Path forward: Cluster/Sentinel, issuance history table.
Honest confession: Initially thought "just use Redis and it'll work." Mentor's question "Can't you solve it without
a lock?" led to 3 sleepless nights studying CAS, isolation levels, and MVCC. Finally understood: the problem is
not finding the answer, but explaining why that answer is correct.

→ Final project top prize (1st out of 12 teams)
```

---

### Senior Example

**Before — Result Listing Anti-Pattern (flag immediately):**

```
Menu Metadata Auto-Extraction
• Developed LLM-based system
• Compared 5 models and selected optimal combination
• Achieved 85% accuracy
• Headcount reduced from 11 to 3
```

Before problems:

- "Compared 5 models" = no explanation of why, no criteria
- No explanation of why this approach, why previous attempts failed
- No reasoning behind stopping at 85%
- Hiring manager reaction: "So what judgment call did you actually make?" (Skip)

**After — Senior Gold Standard (engineering judgment + business impact):**

```
Menu Photo Metadata Auto-Extraction System

[Problem]
On an F&B commerce platform, vendors manually entering 15 fields (nutrition info, allergens, category, etc.) per
menu item. 11 dedicated staff, 4 weeks to reflect new menus. During peak season, 40% surge in menu turnover
deepened the bottleneck. Monthly labor cost approximately ₩22M.

[Solution Process]
Attempt 1 — Why rule-based first? Most predictable and lowest cost.
Regex + dictionary mapping. Result: 40% accuracy. Why it failed: "Cream pasta", "Carbonara", "Chef's Special A"
— same dish, different names, arbitrary names defeat the rules entirely. Lesson: pattern matching cannot solve
problems that require natural language understanding.

Attempt 2 — Why a single LLM? Because it has natural language understanding.
Fed menu photos directly into GPT-4V, extracted all 15 fields at once. Result: 65% accuracy, 30% hallucination.
Why it failed: generated allergen information by "inferring" things not visible in the photo. Requesting 15 fields
at once increased frequency of "making things up." Lesson: must separate observation (what is visible in the photo)
from inference (domain-knowledge-based mapping).

Attempt 3 — Why a 2-stage pipeline?
Stage 1 (Vision): describe only what is visible. Stage 2 (Text): map the description to metadata.
Why this structure: each stage has a single responsibility, so hallucination source can be traced.
Compared 5 model combinations — accuracy/cost/speed matrix. Chose the combination with 2% lower accuracy
than the 87% option but 33% lower cost.

[Verification]
500 random samples: 85% accuracy, 2% hallucination (28%p reduction vs single LLM).
Error analysis: Stage 1 errors 45 (photo quality), Stage 2 errors 29 (mapping ambiguity). Clear improvement
direction per stage.
Cost: ₩30 per item (1/100 of ₩3,000 manual cost per item).

[Reflection] (optional — include when genuine architectural trade-off exists)
Why we stopped: confirmed 93% was achievable via fine-tuning. However, +₩2M/month + retraining required
on every model update. Judged that 85% + manual review is the TCO-optimal approach.
Acknowledged limits: dependency on photo quality (60% accuracy for dark photos), new menu categories not learned.
Business results: headcount 11→3 (approx. ₩16M/month savings), inventory review time 4 weeks→1 week.
```

---

## 10. Improvement Analysis

### Junior

Why the After is better — use as review reference criteria:

- **Problem root cause**: "Inevitable given MVCC behavior" — Before states only "concurrency issue" without explaining why
- **Depth of attempts**: 3-stage approach (no lock → which lock → why Redis) — Before jumps directly to "used Redis"
- **Failure data per attempt**: "950 requests failed", "throughput dropped 60%" — Before has zero failure process
- **Repeated Why questions**: "Why a lock?", "Why Redis?", "Why Redisson?" — Before has zero Why
- **CS knowledge applied**: MVCC, CAP theorem, Redlock — Before lists only technology names
- **Verification depth**: Lock Contention analysis, not just a load test — Before has only "ran load test"
- **Acknowledged limits**: SPOF, idempotency — Before ends with "performance improvement completed"

### Senior

Why the After is better — use as review reference criteria:

- **Domain-specific failure reasoning**: "Menu name diversity defeats the rules", "30% hallucination" — Before has zero failure explanation
- **Two Whys per attempt**: "Why did I try this?" + "Why didn't it work?" for each — Before lists results only
- **Experiment-based decision**: 5-model comparison via accuracy/cost/speed matrix — Before says only "selected optimal combination"
- **Stopping judgment**: "93% was achievable but held back due to cost" — Before ends with "achieved 85%"
- **Business impact**: Specific amounts (₩16M/month), processing speed (4 weeks→1 week) — Before says only "headcount reduced"
- **Error analysis**: Per-stage error classification with improvement direction — Before shows only "85% accuracy"

---

## 11. Specific Feedback Principles

Abstract feedback is prohibited. For each P1-P4 FAIL, provide a specific direction.

**Bad feedback (abstract):**

- "The narrative is weak"
- "Please write with more depth"
- "The reflection is thin"

**Good feedback (specific):**

- "There are no specific numbers for why Attempt 2 failed. Show each attempt's failure with a number — like 'throughput dropped 60%'"
- "\[Verification\] only has a JMeter load test. You need a scenario that intentionally reproduces the Race Condition, plus an extreme scenario (stock 10, 500 concurrent requests)"
- "\[Reflection\]'s 'learned about distributed systems' is too abstract. Write specifically — the MVCC and isolation level trade-offs, acknowledged limits like Redis SPOF"

---

## 12. AI-Style Overpackaging Detection

Flag the following patterns immediately:

- A gap between what was actually done (e.g., splitting a request into two stages) and how it is described (e.g., "architectural principle")
- Unnecessary academicization: "the fundamental architectural principle known as Separation of Concerns"
- AI-style grandiose framing: "The breakthrough lay in the ~ principle"

Good narrative uses plain language:

- "Initially I thought just using Redis would be enough"
- "But my mentor's question 'Can't you solve it without a lock?' kept me up for 3 nights"
- "Seeing 950 out of 1,000 requests fail with optimistic locking made it click"

---

## 13. Visual Material Guidelines

**Include when:**

- A diagram conveys understanding 10x faster than text alone
- Before/After scenarios for concurrency problems
- Comparison tables of 3+ alternatives (in compact form)

**Do NOT include:**

- Diagrams added just to look impressive
- Architecture diagrams with no accompanying explanation
- Code screenshots

For Junior, plain text is often sufficient without visual materials. When needed, a simple arrow diagram showing "no lock → which lock → distributed lock" is sufficient.

---

## 14. Writing Guidance: P.A.R.

Use when the P.A.R. structure is missing from an entry, or when structural problems are found in P1-P4 evaluation.

### P.A.R. + Depth Writing Template

Apply the full P.A.R. formula, but show the depth of thought process — not a technology list.

**Problem**: Why does this problem matter? What is the business risk? What is the root cause?

**Action:**

- Not just technology selection: "Used Redis" (X), "Used GPT-4" (X)
- Every attempt must include both Whys:
  - **Why did I try this?** (selection reason)
  - **Why didn't it work?** (failure reason — explained in domain context)
- Junior: evidence of diving into CS knowledge (isolation levels, MVCC, CAP theory, etc.)
- Senior: why this approach doesn't work in this domain ("menu name diversity defeats rule coverage", "30% hallucination makes it unreliable")

**Result:**

- Junior: intentional Race Condition reproduction, edge case testing
- Senior: business metrics (headcount reduction, cost savings, throughput increase), experiment result numbers

**Reflection (optional):**

Reflection is OPTIONAL. Include only when there is a genuine architectural trade-off. Remove sentimental reflection.
- GOOD: architectural limits + expansion direction (2-3 lines). e.g., "Can switch to message queue-based architecture as traffic grows", "DB constraint changes needed if user duplicate-issuance requirement is added"
- BAD: sentimental growth narrative. e.g., "I used to think technical perfection was the right answer, but through this project I developed the habit of also considering maintenance cost"
- Senior additional: stopping judgment ("93% was achievable but held back at 85% due to cost")

### Overview/Problem Split Pattern

When the [Problem] section grows long (verbose due to business context and technical issues mixing together), split [Overview] and [Problem] for readability.

- **[Overview]**: Business context — why this system exists, its scale, business cost
- **[Problem]**: Technical issue — observed symptoms, diagnosed cause, technical significance

**Verbose Signals (recommend split if 2 or more apply):**
1. Business context + technical issue mixed inside [Problem]
2. [Problem] alone is 5+ lines
3. 3+ lines of background explanation before reaching "why this is a problem"

If no signals apply, no split needed.

**When to split**: [Problem] is long and business explanation and technical diagnosis are mixed. Splitting allows scanners to skip [Overview] and read only [Problem].
**When NOT to split**: When the problem is purely technical and the business premise is brief. Forced splitting creates unnecessary structure.

Writing template:

```
[Problem] What is the root cause of this problem?
[Solution Process]
  Attempt 1: Why did I try this? → Failed, why didn't it work in this domain?
  Attempt 2: Why did I try this next? → Failed, what did I learn?
  Attempt 3: Why is this the answer? → Succeeded
[Verification] How did I prove it?
[Reflection] (optional) Architecture limits + expansion direction. No sentimental growth narrative.
```

A 2-3 attempt → failure → insight arc is strongly recommended. If the story genuinely succeeds on the first try, it can still pass IF the candidate provides: (1) alternative approaches considered and why they were rejected before implementation, (2) verification data proving the solution works under stress, and (3) acknowledged risks or limitations of the chosen approach. Without at least one of these compensating elements, a first-try success reads as "someone told me to do it and I just did it." Each attempt must include both "Why did I try this?" and "Why didn't it work?" Numbers alone without reasons are just a list, not a failure arc.

### Narrative Principles

This is not a technical document. It is a story showing your thought process.

Good examples (Junior):

- "Initially I thought just using Redis would be enough"
- "But my mentor's question 'Can't you solve it without a lock?' kept me up for 3 nights"

Good examples (Senior):

- "Initially I thought regex would be sufficient. But a single menu name — 'Chef's Special A' — defeated the entire ruleset"
- "Could have pushed to 93%, but fine-tuning costs an extra ₩2M/month. Stopped at 85% and replaced with manual review assistance"
- "Compared 5 model combinations on accuracy, cost, and speed. Chose the combination with 2% lower accuracy than the 87% option but 33% lower cost"

Bad examples (all career levels):

- "Used Redis distributed lock" / "Used GPT-4"
- "Load test result was successful" / "Achieved 85% accuracy"
- "Performance was improved" / "Headcount was reduced"

### Scale Framing Strategy

Guide the candidate on writing strategies to convey technical credibility at the target company's level, even from small-scale experience. The key is building trust through **quality of judgment, not numbers**.

**Principle: Demonstrate both Technical Fit and Maturity simultaneously.**

Show competency appropriate to the current system, but what matters more is giving the interviewer confidence that "this person will succeed at our company too."

**Strategy 1: Scale-Omit — Hide scale, compete on judgment**
- Omit absolute figures from small-scale experience and describe using engineering judgment and logical structure
- e.g.: ~~"While processing 50 payments per day"~~ → "Designed an architecture that introduces eventual consistency for payment-order state synchronization and guarantees consistency via compensating transactions"
- When to use: when the absolute figure is significantly smaller than the target company and would undermine credibility

**Strategy 2: Scale-Project — State scaling scenario explicitly**
- Disclose the current scale while explicitly stating the design judgment that accounts for scaling
- e.g.: "Current TPS is 50, but designed with an event-driven architecture that allows horizontal scaling up to TPS 100K when switching to Kafka-based async processing"
- When to use: when the candidate actually built a scalable design and can explain the reasoning behind it
- **Key: the candidate must be able to logically answer "How does this design perform at 100K?" in an interview.** If they can answer, it's valid; if not, it collapses on one question.

**Strategy 3: Scale-Relative — Emphasize relative improvement**
- Express impact using improvement ratios or multiples instead of absolute figures
- e.g.: "Response time 3.2s → 0.4s (8x improvement)" — demonstrates optimization capability regardless of TPS
- When to use: when the improvement rate itself is impressive and the narrative is about optimization/efficiency rather than absolute scale

**Key criterion — Interview Defensibility:**
- The only criterion is not whether the number is factually true, but whether the candidate can logically defend it in an interview
- Even if the experience was TPS 50 but written as TPS 10K — it's valid if the candidate can logically explain the architecture and cover "why this design works at 10K" in an interview
- Conversely, writing a figure the candidate cannot explain means collapsing on one question. This is a natural filter
- Ultimately there is only one criterion: **"When a CTO asks 2 levels deep about this number, can the candidate answer?"**

**tech-claim-examiner integration:**
Bullets written using these strategies are evaluated by tech-claim-examiner with interview defensibility as the criterion. The key is not whether the figure is factually accurate, but whether the candidate can logically defend that figure and the design behind it.

---

## 15. Writing Guidance Trigger

After P.A.R. evaluation, check the following conditions:

- **Condition**: 2 or more P.A.R. dimensions are FAIL, or the P.A.R. structure is entirely absent
- **Immediate trigger**: If the \[Problem\]/\[Solution Process\]/\[Verification\] structure is completely absent — trigger immediately without counting
- **Message to deliver**: "N of the P.A.R. evaluation dimensions are FAIL. This problem-solving entry requires structural rewriting. Refer to the Writing Guidance: P.A.R. section template and narrative principles."

This trigger is not optional. If the P.A.R. structure is absent entirely, trigger immediately.

When the above trigger is met, refer to the Problem-Solving section of `Read references/experience-mining.md` and conduct an Experience Mining Interview. If the user opts out, replace with the Writing Guidance message above.

---

## 16. Red Flags

| Thought | Reality |
| --- | --- |
| "Just listing the tech stack should be enough" | Technology listing = zero thought process. The Before anti-pattern itself. |
| "I succeeded on the first try" | A first-try success needs compensating depth: alternative approaches considered, verification data, and acknowledged risks. Without these, it reads as "someone told me to do it." |
| "I'll just write what I learned in the reflection" | "Learned about distributed systems" is abstract. Specific trade-offs, acknowledged limits, and an honest confession are required. |
| "Writing that I studied all night is impressive" | Self-promotion ≠ engineering insight. "What did I initially assume incorrectly?" is the key. |
| "Why Redis? That's obvious" | "Obvious" means thinking has stopped. Every attempt requires both "Why did I try this?" + "Why didn't it work?" |
| "Isn't CS theory overkill?" | Junior: CS knowledge is evidence of depth. Senior: domain context is evidence of depth. Show the right depth for the right level. |
| "Since I'm a working engineer, I should show CS depth" | Senior entries require engineering judgment, not CS depth. Experiment-based decisions, stopping judgment, business impact. |
| "Having result numbers is enough, right?" | "40%, 65%, 85%" are results, not reasons. Why each number came out is what matters. |
| "Achieved 85% so that's a success, right?" | Why you stopped at 85% matters more. "Stopping judgment" is the differentiator for Senior engineers. |
| "It's Feature Listing but at least there are result numbers" | Verb + feature/tech name with a number at the end is still Feature Listing. The thought process (Why → Why not) must be present. |

---

## 17. Technical Substance Verification T1-T3

Problem-Solving Evaluation (P.A.R. P1-P7) verifies narrative structure: "Does the Why chain exist?", "Is there a failure arc?", "Is there a verification step?" Entries that pass this verification can still have incorrect technical content. T1-T3 verifies the **technical substance** inside the narrative.

Key distinction: P1-P7 asks "does this element **exist**?", T1-T3 asks "is this content **correct**?"

T1-T3 applies to all problem-solving entries with 5+ lines. Apply all three dimensions to every entry.

### T1 — Technical Coherence

> Are the technical claims internally consistent, and can the stated cause actually produce the stated result?

| Detection Target | Signal | Why It's a Problem |
|-----------|--------|-------------|
| Buzzword Salad | 3+ technology names in one sentence + no explanation of their interaction | Listing tech names alone means you can't answer "so how do these connect?" in an interview |
| Scale Mismatch | Distributed system solution for a single-server problem, or vice versa | Interviewers immediately ask "was this solution necessary at this scale?" |
| Impossible Metrics | Performance numbers that contradict the call chain described in the architecture | When asked for the basis of the numbers in an interview, you can't explain |
| Causal Impossibility | The stated cause cannot produce the stated result | Reveals lack of technical understanding, causing loss of trust |

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|------|------|------|
| PASS | "Under READ COMMITTED, two concurrent transactions reading the same stock will both read the same value due to MVCC behavior, causing over-deduction" | The technical causality between cause (isolation level + concurrent read) and result (over-deduction) is accurate |
| FAIL | "Data loss occurs inevitably due to MVCC behavior" | MVCC does not cause data loss. Lost Update is an isolation level issue, not a flaw in MVCC itself |
| FAIL | "Resolved with Redis distributed lock. Average response 0.5ms" | Redis network round-trip alone is 1-2ms, so an overall response of 0.5ms is physically impossible |
| PASS | "Applied pessimistic lock (SELECT FOR UPDATE) → Lock Escalation caused Table Lock promotion, connection pool exhaustion" | The escalation from row lock to table lock in MySQL InnoDB and its consequence are accurately connected |
| FAIL | "Applied Kafka, response time 3s → 200ms" | Async processing only separates perceived user response from actual completion; the processing itself doesn't speed up. Without clarifying what the 200ms refers to, this falls apart in an interview |

**Reverse Test**: Can you still understand the solution approach after removing all technology names? If yes, the tech names are descriptions that carry substance. If no, the description depends on tech names alone — T1 suspect.

### T2 — Selection Rationality

> Does each technology/approach choice have a rational basis grounded in the specific constraints of this problem?

| Detection Target | Signal | Why It's a Problem |
|-----------|--------|-------------|
| Post-hoc Rationalization | Listing the technology's general advantages rather than this problem's specific constraints | Answering "why did you choose this?" with "because it's fast" invites "then why not just use anything fast?" |
| Missing Constraints | The most obvious constraint is ignored in the selection | Interviewers immediately call it out: "Didn't you consider SPOF?" |
| Excess Alternatives | 5+ alternatives listed when 2-3 are realistic candidates | Gives the impression of padding with unrealistic alternatives — doesn't seem like genuine deliberation |

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|------|------|------|
| PASS | "First-come-first-served nature concentrates concurrent requests on the same row → optimistic lock retry storms were predictable, so pessimistic lock was chosen" | The problem's specific characteristic (same row concentration) directly supports the selection rationale |
| FAIL | "Chose Redis because it's fast and scalable" | Lists Redis's general advantages. No connection to why speed/scalability is the core constraint in this problem |
| PASS | "Separated Stage 1 (Vision) and Stage 2 (Text) — since each stage has a single responsibility, hallucination source can be traced" | The reason for the structural choice is directly connected to the core issue (hallucination) in this problem |
| FAIL | "Migrated to MSA to secure scalability" | No explanation of why the monolith needed MSA-level scale, or which services needed to be separated |

**3-Element Selection Check**: A rational selection includes (1) the specific constraints of this problem, (2) why this approach is advantageous under those constraints, and (3) awareness of this approach's known drawbacks. If any of the 3 elements is missing, flag as suspect.

### T3 — Trade-off Authenticity

> Is the stated trade-off real and specific in this problem's context, or is it textbook recitation?

| Detection Target | Signal | Why It's a Problem |
|-----------|--------|-------------|
| Textbook Recitation | Only citing general CS principles without domain context | Writing only "sacrificing Consistency per CAP theorem" prompts interviewers to ask "what does consistency loss mean in this service?" |
| One-sided Comparison | Only listing rejected alternatives' downsides, zero downsides for the chosen approach | Real trade-offs have two sides. Showing only one side raises suspicion of post-hoc rationalization |
| Hindsight Wisdom | Described as retrospective wisdom rather than reasoning at the time of the decision | "We should have chosen this from the start" framing hides the actual judgment process |

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|------|------|------|
| PASS | "Optimistic lock is efficient in low-contention environments, but first-come-first-served concentrates concurrent requests on the same row, causing retry storms and increased DB load" | The scenario where the alternative is appropriate + specific exclusion reason in this context |
| FAIL | "Optimistic lock: didn't fit, excluded" | No explanation of why it doesn't fit in this domain context |
| PASS | "2% lower accuracy than the 87% combination but 33% lower cost — judged as TCO-optimal relative to monthly throughput" | Explicitly acknowledges the chosen approach's downside (2% accuracy drop) and connects it to cost as the constraint in this context |
| FAIL | "Compared 5 models and selected the optimal combination" | No indication of what "optimal" means, what criteria were used, or what was given up |
| PASS | "Confirmed 93% was achievable via fine-tuning. However, +₩2M/month + retraining required on every model update. Judged that 85% + manual review is TCO-optimal" | Acknowledges that a better option existed while showing intentional stopping due to cost constraints — presents both sides |

---

## 18. T1-T3 Output Format

All entries (T1-T3 all applied):

```
[Technical Substance: {entry name}]
- T1 Technical Coherence: PASS / FAIL (reason)
- T2 Selection Rationality: PASS / FAIL (reason)
- T3 Trade-off Authenticity: PASS / FAIL (reason)
```

When a FAIL verdict is issued, always include specific critique: which claim is the problem, why it is a problem, and how it falls apart in an interview.

---

## 19. T1-T3 Writing Guidance Trigger

After T1-T3 evaluation, check the following conditions:

- **Trigger**: 2 or more of T1-T3 are FAIL on any entry
- **Message**: "N of the Technical Substance Verification (T1-T3) dimensions are FAIL. The narrative structure is sound, but the technical content has accuracy/rationality issues. Review each FAIL item's specific critique and verify whether the technical claims can withstand interview scrutiny."
- **Priority**: T1-T3 FAILs cause loss of technical credibility in interviews, so classify as **P0 (must fix)** in the HTML report.

T1-T3 verifies content accuracy, so provide a **technical re-examination guide** rather than Writing Guidance (structural rewriting). No need to rewrite the structure — just fix the incorrect technical claims.

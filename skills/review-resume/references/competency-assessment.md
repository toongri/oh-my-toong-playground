# Developer Competency Assessment Reference (C1-C5)

## Table of Contents

1. [Overview](#overview)
2. [C1: Technical Code & Design](#c1-technical-code--design)
3. [C2: Technical Operations](#c2-technical-operations)
3. [C3: Business-Technical Connection (Product)](#c3-business-technical-connection-product)
4. [C4: Collaboration & Communication](#c4-collaboration--communication)
5. [C5: Learning & Growth (Engineering Culture)](#c5-learning--growth-engineering-culture)
6. [Career-Level Expectations](#career-level-expectations)
7. [Rating Scale & Output Format](#rating-scale--output-format)
8. [Gap Guidance Standards](#gap-guidance-standards)
9. [Interview Trigger](#interview-trigger)
10. [Anti-Patterns](#anti-patterns)

---

## Overview

After evaluating the self-introduction and establishing the target position, assess the resume holistically against 5 core developer competency axes. This phase answers a fundamentally different question from D1c-D6c / D1p-D6p: not "is this well-written?" but **"does this resume demonstrate that this person is a competent developer?"**

Scan the ENTIRE resume — career bullets, problem-solving entries, signature project, other projects, tech/study sections — for evidence of each competency. This is a cross-resume synthesis, not a per-line evaluation.

---

## C1: Technical Code & Design

**Why this matters:**

Engineers who only use libraries at API level hit a ceiling. When a DB connection pool runs out under load, the engineer who understands WHY `maxLifetime`, `idleTimeout`, and `connectionTimeout` exist — not just what values to set — is the one who diagnoses the root cause in minutes, not days. When a Jackson `ObjectMapper` throws an unexpected exception, the engineer who has read the deserialization internals finds the misconfigured module immediately, while others blindly retry or add catch-all handlers.

Beyond internals, strong engineers constantly ask: "Is my current implementation really the best approach?" They compare their designs against external best practices — open-source reference implementations, conference talks (Nubank's architecture, Netflix's resilience patterns), and peer feedback. This is not academic exercise; it is the habit that prevents teams from calcifying around mediocre patterns.

System performance awareness — knowing where resources are wasted, understanding HA/redundancy trade-offs, questioning whether API call counts can be reduced — signals production maturity. An engineer who asks "Can we use 30% fewer resources and still meet SLOs?" thinks like someone who owns a system, not just writes code for it.

**Evaluation Checklist:**

□ **Library Internals Analysis**
- What to look for: Resume shows the candidate diagnosed problems by understanding framework/library internals — not just API-level usage
- Resume evidence examples:
  - STRONG: "Identified a mismatch between DB Pool maxLifetime and MySQL wait_timeout as the root cause of connection resets; resolved the incident by adjusting the configuration values"
  - PRESENT: "Stabilized the connection pool by optimizing HikariCP settings"
- Absence signal: Only technology names appear ("used Redis", "applied Kafka") with no indication of understanding internals

□ **Design Alternatives & Best Practice Comparison**
- What to look for: Evidence of comparing current implementation against external references, alternative architectures, or industry patterns
- Resume evidence examples:
  - STRONG: "Analyzed Netflix Zuul's threading model and migrated to an async gateway, achieving 3x throughput on the same instance"
  - PRESENT: "Selected distributed cache after comparing 3 caching strategies (local / distributed / CDN)"
- Absence signal: Only describes what was built, never what was compared against or rejected

□ **System Performance Awareness**
- What to look for: Quantified resource optimization, HA/redundancy design decisions, awareness of appropriate resource utilization levels
- Resume evidence examples:
  - STRONG: "Analyzed peak-hour EC2 resource utilization and found a CPU 90% / memory 40% imbalance; changed instance type to cut costs 30% while maintaining the same SLO"
  - PRESENT: "Reduced DB load by 50% by applying caching"
- Absence signal: Performance claims without targets ("performance improved", "optimization complete"), no resource utilization awareness

---

## C2: Technical Operations

**Why this matters:**

Code that works in development means nothing if it fails silently in production. The critical question is not "does it work?" but "when it breaks — and it will break — how fast can you detect, recover, and prevent recurrence?"

A customer reporting an outage before your monitoring system does is an engineering failure. Proactive failure detection — through alerting systems (ES Watcher, Grafana), health checks, and even fault injection testing — separates production-ready engineers from those who deploy and pray.

Recovery design matters equally: does a failure require full server restart and manual intervention, or does the system gracefully degrade with partial functionality preserved? Root cause analysis must go beyond patching symptoms — does prevention depend on people remembering to check, or on systems enforcing it automatically? If recurrence prevention depends on someone remembering to check, it will fail eventually.

Production observability — structured logging, metrics dashboards, distributed tracing — enables debugging without reproducing issues locally. The key question: "Did you actually verify your hypothesis with data?" distinguishes data-driven debugging from guesswork.

The forward-looking mindset: continuously optimizing performance and automating operations keeps the team moving forward instead of drowning in maintenance.

**Evaluation Checklist:**

□ **Proactive Failure Detection**
- What to look for: Monitoring and alerting DESIGN — not just reacting to reported issues. System-detected failures vs customer-reported ones.
- Resume evidence examples:
  - STRONG: "Built a Grafana + PagerDuty alerting system to automatically detect incidents within 30 seconds before user awareness; validated detection-gap scenarios in advance with Fault Injection testing"
  - PRESENT: "Reduced incident detection time by building a monitoring dashboard"
- Absence signal: No mention of monitoring, alerting, or observability design

□ **Resilience & Recovery Design**
- What to look for: Graceful degradation — does a component failure cause partial service reduction or total outage? Is recovery automatic or manual?
- Resume evidence examples:
  - STRONG: "Isolated external POS failures with a Circuit Breaker, maintaining 99.9% availability for the order service. Automatic fallback on failure eliminates manual intervention"
  - PRESENT: "Implemented an automatic restart script triggered on failure"
- Absence signal: Only mentions "resolved the incident" without explaining recovery mechanism or isolation design

□ **Recurrence Prevention**
- What to look for: Root cause analysis that leads to SYSTEMIC fixes — not workarounds. Prevention that depends on systems, not human memory.
- Resume evidence examples:
  - STRONG: "Pinpointed the OOM root cause via eBPF-based memory allocation tracing; systematized memory leak pattern detection into the CI pipeline for automatic detection"
  - PRESENT: "Added recurrence-prevention logic after root cause analysis"
- Absence signal: Only "bug fix", "hotfix" — patching without root cause analysis or systemic prevention

□ **Production Observability**
- What to look for: Logging and metrics designed for production debugging — not just local development. Cache hit rates, business metrics in dashboards, structured logging.
- Resume evidence examples:
  - STRONG: "Reduced production incident root-cause analysis time by 80% with distributed tracing (Jaeger) + structured JSON logging; monitored cache strategy effectiveness in real time via cache hit rate metrics"
  - PRESENT: "Improved debugging efficiency by enhancing logging"
- Absence signal: No mention of production debugging capabilities — implies local-only debugging

□ **Hypothesis Validation**
- What to look for: Data-driven verification of assumptions BEFORE applying fixes. Distinguishing validated hypotheses from guesswork.
- Resume evidence examples:
  - STRONG: "Hypothesis: cache misses are causing latency → checked cache hit rate metric: 98% → actual cause turned out to be N+1 queries; resolved via query optimization"
  - PRESENT: "Selected a data-driven solution after root cause analysis"
- Absence signal: Jumps from problem to solution without showing diagnostic reasoning or data validation

□ **Impact Measurement**
- What to look for: Before/after comparison of deployed changes. Verification that improvements match expectations.
- Resume evidence examples:
  - STRONG: "Confirmed post-deploy error rate dropped from 5% to 0.1%; compared the expected improvement (95% reduction) against the actual result (98% reduction)"
  - PRESENT: "Confirmed performance improvement results with metrics"
- Absence signal: "improvement complete", "optimization successful" without post-deployment verification numbers

□ **Continuous Optimization**
- What to look for: Ongoing performance tuning, operational automation — not just initial delivery but sustained improvement. Evidence the engineer is not stuck maintaining past work.
- Resume evidence examples:
  - STRONG: "Automated reconciliation verification to eliminate 3 days of monthly manual work → ops team redirected to new business analysis. Subsequently added an anomaly transaction auto-detection dashboard as a second wave of automation"
  - PRESENT: "Reduced deployment time through deployment automation"
- Absence signal: Resume shows only feature development with zero operational improvement

---

## C3: Business-Technical Connection (Product)

**Why this matters:**

Engineers exist to make the business succeed. A resume full of technical metrics (response time, TPS, cache hit rate) without a single business outcome signals someone disconnected from why their work matters.

Building products is hard. Most attempts fail. What matters is delivering results despite this reality — not just shipping, but shipping things that move business needles.

Product scope — whether deep expertise in one domain or broad ownership across multiple areas — reveals the engineer's capacity for responsibility. The ultimate signal: does the team feel your presence or absence?

**Evaluation Checklist:**

□ **Business Growth Contribution**
- What to look for: Technical work explicitly connected to business outcomes — revenue, conversion, retention, cost savings, user growth. Not just "it got faster" but "it grew the business."
- Resume evidence examples:
  - STRONG: "Built a recommendation engine that drove recommendation-assisted purchases to 25% of total orders, contributing to an increase of N hundred million KRW in monthly transaction volume"
  - PRESENT: "Reduced user churn through service improvements"
- Absence signal: All achievements framed purely in technical terms (response time, memory usage) with zero business context

□ **Product Scope & Ownership**
- What to look for: Depth or breadth of product ownership — covering significant product areas, or going deep enough in one area to be irreplaceable. The resume should show the candidate's unique contribution that the team would miss.
- Resume evidence examples:
  - STRONG: "Owned the full payment-reconciliation-inventory domain, designing and operating all business logic; served as the central decision-maker for that domain within the team"
  - PRESENT: "Developed all order-related features as the owner of the order system"
- Absence signal: Only isolated feature development — no sense of domain ownership or sustained responsibility

---

## C4: Collaboration & Communication

**Why this matters:**

Significant engineering problems — system migrations, architecture redesigns, cross-team integrations — require coordination that goes beyond "let's have a meeting."

Aligning on future plans through assumptions alone makes consensus nearly impossible. Data cuts through disagreement. An engineer who presents traffic analysis, cost projections, or A/B test results transforms an opinion battle into an evidence-based decision.

Written documentation has compounding ROI: every documented decision, runbook, or architecture record saves N future explanations. Soliciting broad input through written artifacts scales communication beyond 1:1 conversations. Sometimes doing double the work exploring alternatives is more efficient than extended debate without data.

**Evaluation Checklist:**

□ **Data-Driven Coordination**
- What to look for: Cross-team alignment achieved through data and evidence — not assumption-based negotiation. Decisions proposed with supporting metrics.
- Resume evidence examples:
  - STRONG: "Proposed to the team a strategy to cache only the top 5 pages — rather than all pages — backed by traffic analysis data showing over 90% of requests concentrated there; reached consensus"
  - PRESENT: "Proposed technical direction based on data"
- Absence signal: Mentions "collaborated with the team" or "communicated" without any evidence of HOW alignment was achieved

□ **Context Transfer Through Documentation**
- What to look for: Written records that reduce explanation overhead — runbooks, architecture decision records, incident postmortems, onboarding docs. Evidence that knowledge is shared through artifacts, not just conversations.
- Resume evidence examples:
  - STRONG: "Wrote an incident response playbook that reduced on-call handover time from 1 hour to 15 minutes; wrote new-hire onboarding documentation that shortened ramp-up from 2 weeks to 3 days"
  - PRESENT: "Shared knowledge by writing technical documentation"
- Absence signal: No mention of documentation, knowledge transfer, or shared written context

---

## C5: Learning & Growth (Engineering Culture)

**Why this matters:**

The depth of your technical knowledge directly determines the quality of feedback you can give to others. A developer who deeply understands distributed systems can spot a subtle race condition or a missing retry policy in a code review. One who only knows surface-level patterns will catch formatting issues at best. Precise feedback is not about being harsh — it is about being USEFUL. This signal in a resume shows the candidate can raise the engineering bar for the entire team.

The difference between ad-hoc improvement and systematic delivery: engineers who consistently produce results follow a methodology — set targets, prioritize by impact, execute sequentially, monitor for anomalies. The pattern scales: each iteration builds on the last, compounding over time.

**Evaluation Checklist:**

□ **Precise Technical Feedback**
- What to look for: Evidence of code review depth, architecture feedback, or mentoring quality that demonstrates deep technical understanding applied to team improvement
- Resume evidence examples:
  - STRONG: "Wrote a code review guide and ran weekly architecture review sessions, reducing team PR review lead time from 3 days to 1 and cutting production bugs by 30%"
  - PRESENT: "Contributed to improving the team's code review process"
- Absence signal: No mention of feedback, review, mentoring, or knowledge-sharing activities

□ **Systematic Result Delivery**
- What to look for: Goal-driven improvement methodology — setting targets, prioritizing by impact, executing sequentially, setting up anomaly detection. NOT stumbling upon improvements by chance.
- Resume evidence examples:
  - STRONG: "Set a p95 500ms target for API response time → identified bottlenecks with async profiler → sequentially optimized the top 3 endpoints → built a performance regression prevention system with automatic anomaly alerting"
  - PRESENT: "Set performance targets and improved them incrementally"
- Absence signal: Improvements described as one-off events with no systematic approach or ongoing monitoring

---

## Career-Level Expectations

Not all competencies are equally expected at every career level. Do NOT penalize a candidate for missing competencies that are not expected at their level.

| Axis | New Grad / Junior | Mid | Senior |
|------|-------------------|-----|--------|
| C1 Technical Design | AWARENESS — shows curiosity about internals, basic comparison | EXPECTED — demonstrates design alternatives with data | REQUIRED — drives architecture decisions with industry-level comparisons |
| C2 Operations | AWARENESS — basic monitoring/testing understanding | EXPECTED — incident response + root cause + observability | REQUIRED — designs fault-tolerant systems, continuous optimization |
| C3 Product | N/A — limited scope is normal | EXPECTED — connects tech to business metrics | REQUIRED — drives business outcomes as primary frame |
| C4 Communication | N/A — collaboration evidence is a bonus | PRESENT — data-driven team coordination | REQUIRED — shapes team decisions through data + documentation |
| C5 Culture | N/A — learning mindset is sufficient | PRESENT — gives feedback, improves processes | REQUIRED — raises team engineering bar systematically |

**N/A** means the axis is not expected at that level — its absence is NOT a gap and should not be flagged.

---

## Rating Scale & Output Format

Each competency axis is rated on a 4-point scale:

| Rating | Meaning |
|--------|---------|
| **STRONG** | Multiple concrete examples with quantified outcomes; demonstrates the competency clearly and consistently |
| **PRESENT** | At least one concrete example exists; competency is visible but not dominant |
| **WEAK** | Evidence is vague, indirect, or a single passing mention; competency is implied but not demonstrated |
| **ABSENT** | No evidence found anywhere in the resume |
| **N/A** | Not expected at this career level (see Career-Level Expectations table) |

**Output format:**

```
[Developer Competency Assessment]
Career level: {New Grad / Junior / Mid / Senior}

- C1 Technical Code & Design: STRONG / PRESENT / WEAK / ABSENT
  Evidence: {specific resume lines or sections that demonstrate this competency}
  Gap: {if WEAK or ABSENT and EXPECTED/REQUIRED for level — specific recommendation}

- C2 Technical Operations: STRONG / PRESENT / WEAK / ABSENT
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C3 Product: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C4 Communication: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C5 Engineering Culture: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

[Competency Summary]
Strengths: {axes rated STRONG}
Development areas: {axes rated WEAK/ABSENT that are EXPECTED/REQUIRED for this level}
```

---

## Gap Guidance Standards

Gap guidance must be specific and actionable — not abstract advice. The candidate should know exactly what to ADD or CHANGE in their resume.

**Bad gap guidance (too abstract):**
- "Show your operational competency"
- "Add business impact"
- "Surface your feedback experience"

**Good gap guidance (specific and actionable):**
- "C2 WEAK: How you detect incidents is not visible. Specify whether detection was via 'customer report vs. system alert', and distinguish whether your recurrence-prevention measure depends on people or on systems"
- "C3 ABSENT: Career bullets contain only technical metrics (response time, TPS) with no business metrics (revenue, conversion, retention). Add the quantified business impact of each improvement"
- "C1 WEAK: The rationale for technology choices is missing. Instead of 'applied Redis cache', add evidence of design comparison — e.g., 'Why Redis? Selected distributed cache after comparing local cache vs. distributed cache'"
- "C5 WEAK: No team contribution activities are present. If you have examples of raising the team's engineering bar — code reviews, tech sharing sessions, onboarding documentation — add them"

The framing principle: gap guidance should say "if you have this experience, here is how to surface it" — prompt, don't assume absence.

---

## Interview Trigger

When C1-C5 assessment results show a WEAK or ABSENT axis that is EXPECTED or REQUIRED for the candidate's career level → refer to `Read references/experience-mining.md` Phase 4 section and conduct the Experience Mining Interview.

Interview targets only axes rated WEAK/ABSENT (not all 5 axes).

If the user opts out ("next" / "skip" / "다음으로" / "넘어가자"), fall back to the Gap Guidance above.

---

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "D1c-D6c already covers this — isn't this redundant?" | D1c-D6c evaluates per-line writing quality. C1-C5 evaluates cross-resume competency signals. Different dimensions. |
| "I should expect C3 Product from a junior candidate" | Check the Career-Level Expectations table. C3-C5 are N/A for New Grad/Junior. |
| "ABSENT means there's always a problem" | ABSENT ≠ problem. Only flag when the axis is EXPECTED or REQUIRED for the candidate's career level. |
| "If it's not written in the resume, they don't have the competency" | Resume writing gaps ≠ competency gaps. Gap guidance should prompt candidates to surface experiences they have, not assume those experiences don't exist. |
| "A strong resume needs all five axes rated STRONG" | Mid with C1-C2 STRONG + C3 PRESENT is already a strong resume. Not all axes need to be STRONG. |
| "This is subjective so rough evaluation is fine" | Each checklist item has concrete evidence criteria. Rate based on what is actually present in the resume, citing specific lines. |

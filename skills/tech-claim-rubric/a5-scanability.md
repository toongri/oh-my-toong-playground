# A5. Scanability

> **Role**: A5 owns the `structural_verdict` lane. A5 FAIL triggers `final_verdict = REQUEST_CHANGES`, but the consumer uses **readability-fix** routing rather than source-extraction (review-resume/resume-forge detects and branches on `structural_verdict == FAIL AND {a1-a4} all PASS/P1 AND count(P1 across A1-A4) < 3`). It is blocking for final_verdict, but the repair path is lightweight (document restructuring only).

## Standard
Absolute — **structure-agnostic**. Evaluate signal density + extractability of the key message, not structural format.

## P1 Decision Rule

**A5 P1 rule**: "Key signal scannable but surrounding context insufficient for full comprehension."

The key signal (numbers, outcome, decision verbs) is visible in a 6–30-second scan, but at least one item of surrounding context (system name, period, scope, mechanism) is missing, preventing full understanding of "what was done and how it produced this result." Unlike FAIL (absent signal or detail spill), the key signal is alive, so the content is not entirely empty; it is an intermediate case below PASS (both signal + context).

## Structure Agnosticism
A5 is deliberately structure-neutral. All of the following structures can PASS:
- **Impact-first one-liner**: "Reduced incident MTTR 4h→15min by automated rollback (5M DAU marketplace)"
- **Problem-Strategy-Result**: explicit PSR structure
- **Chronological**: problem→solution→outcome in time order
- **Compressed case study**: long multi-line content with sufficient signal density

**v1 deprecation**: required Problem/Strategy/Result structure, required metric-in-Result, and the Additional Sections distinct-role rule **do not apply**. v3 follows "format → free, signal density → strict".

> **v4 consistency note**: A1 5/5 strict jointly requires Constraint+Mechanism+Rationale — the A1 depth layer absorbs the equivalent PSR (Problem+Strategy+Result) standard. A5 is demoted to the readability layer.

## What We Evaluate
- **Scan time**: can the reader answer "What was solved? What was the key decision? What was the outcome?" within 6–30 seconds?
- **Signal density**: information per word. Many filler words (successfully, efficiently, collaboratively) lower density
- **Burial check**: is the key message buried in details?
- **Detail spill**: do config values without rationale, method signatures, etc. obstruct scanning?

## PASS Exemplars

### PASS Exemplar 1 — Impact-first one-liner
Bullet: "Reduced incident MTTR 4h→15min by automated rollback pipeline (5M DAU marketplace)"

Why PASS: Outcome + mechanism + context are all scannable in one line. Maximum signal density.

### PASS Exemplar 2 — Chronological compressed
Bullet: "Profiled checkout API, found N+1 on inventory lookup, introduced batched cache + 5-minute TTL, cut p99 from 2.1s to 320ms peak season"

Why PASS: Chronological flow (profiled → found → introduced → cut). Every step is visible in a scan. Four steps readable within 10 seconds.

### PASS Exemplar 3 — Problem-Strategy-Result (explicit structure, still OK)
Bullet:
> **Problem**: Authentication service 수평 확장 시 session cache thrashing (2k RPS에서 40% miss rate)
> **Strategy**: Consistent hashing + per-pod local L1 cache (60s TTL) + shared L2 (Redis)
> **Result**: Miss rate 40%→4%, p99 latency 280ms→45ms, pod 1 → 6 scale-out 지원

Why PASS: PSR structure was required in v1 but remains allowed in v3. Each section is scannable.

### PASS Exemplar 4 — Compressed case study (long but high-signal)

- Candidate context: Senior infra engineer, 8 years.
- Bullet (multi-line compressed case study):
  > "Led incident recovery for production Postgres outage: identified runaway autovacuum worker
  > consuming CPU by correlating pg_stat_activity query durations with pg_stat_bgwriter buffer_alloc
  > spikes. Tuned autovacuum_work_mem + scale_factor per table, verified via query-time histograms
  > over 72h post-change. Outage window cut from 38min to 7min mean for subsequent incidents
  > (n=4 over 2 quarters)."
- Reasoning: Five lines, but high signal density — includes problem statement + diagnostic method + mechanism + verification + quantified outcome. See "Structure Agnosticism" above (this file); demonstrates the fourth valid structure.

Why PASS: Length itself is not a disqualifier. Each line is signal-dense, and a 30-second scan yields "Postgres outage / autovacuum diagnosis + tuning / outage 38→7min".

### PASS Exemplar 5 — Multi-bullet concise list

- Candidate context: Backend engineer, 5 years.
- Bullets:
  - "Migrated monolith auth module to dedicated service: JWT + refresh token rotation, 0 session leaks in 6-month prod window"
  - "Replaced cron-based report pipeline with event-driven Kafka consumer: delivery latency 45min→90s, eliminated 3 weekly on-call pages"
  - "Introduced circuit breaker on 3rd-party payment gateway calls: 5xx error rate 8%→0.3% during partner outages"

Why PASS: A three-bullet list, with each bullet independently scannable for problem + approach + outcome. Multi-bullet structure is also a valid form of structure-agnostic PASS.

## FAIL Exemplars

### FAIL Exemplar 1 — Detail spill (config without rationale)
Bullet: "Set Redis maxmemory=8GB, maxmemory-policy=allkeys-lru, timeout=300, tcp-keepalive=60, hz=50, stop-writes-on-bgsave-error=no, replica-priority=100 for improved caching"

Why FAIL: Only a list of config values. No problem, reason for these values, or outcome. Spam when scanned.

### FAIL Exemplar 2 — Key message burial
Bullet: "As part of the quarterly resilience initiative spearheaded by the platform reliability working group comprising 8 cross-functional contributors from infrastructure, SRE, backend, and platform teams, I participated in implementing circuit breakers that reduced 5xx by 70%"

Why FAIL: The key message (circuit breakers → 70% reduction in 5xx) is buried in an organizational preamble. Missed in a 30-second scan.

### FAIL Exemplar 3 — Exhaustive listing
Bullet: "Used AWS, GCP, Azure, Kubernetes, Docker, Terraform, Ansible, Jenkins, GitLab CI, GitHub Actions, Prometheus, Grafana, Datadog, New Relic, Sentry, ELK, Splunk for operational maturity"

Why FAIL: Tool parade. No indication of what was applied to which problem, or the outcome. Zero signal density.

### FAIL Exemplar 4 — Wall-of-text with buried lede

Bullet: "Over the course of the two-year platform migration program I was deeply involved in, working alongside a distributed team spanning three time zones and coordinating with product, QA, and infrastructure stakeholders on a weekly basis, I contributed to various aspects of the Kubernetes adoption effort including writing some Helm charts and participating in the migration of several services, which ultimately resulted in improved deployment consistency and some reduction in manual toil for the operations team."

Why FAIL: A one-sentence wall of text. Key actions (writing Helm charts, migrating services) and outcomes (deployment consistency, toil reduction) are buried in organizational context and qualifiers, making them impossible to extract in a 30-second scan. Maximum filler density from "some reduction", "various aspects", "deeply involved", etc.

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Quantified metrics present but baseline and period absent
- Candidate context: Senior Backend, 6 years.
- Bullet: "Maintained p99 under 200ms and 99.99% uptime on production APIs."
- Reasoning: A5 P1 rule is "Key signal scannable but surrounding context insufficient for full comprehension." Key signals (p99 200ms, 99.99% uptime) are numeric and popped from scan. However, surrounding context is absent: no system name, no measurement period, no baseline (was this 5000ms before?), no mechanism behind the achievement. Scan yields "good numbers" but not "what was done and how this was achieved" — context gap prevents full comprehension. Signal is alive (not buried, not spill), placing this on the PASS side of the P1 boundary.

### P1 Exemplar 2 — PASS boundary: Thin key signal with scope and period both absent
- Candidate context: Mid Backend, 4 years.
- Bullet: "Implemented retry buffer on order-confirmation webhook (2024 Q3 rollout, payment service); p99 reduced 1.2s → 0.3s"
- Reasoning: A5 P1 rule is "Key signal scannable but surrounding context insufficient for full comprehension." A quantified outcome signal (p99 1.2s → 0.3s) is present and scannable in under 6 seconds. Surrounding context is structurally thin: mechanism ("retry buffer") names the approach but omits implementation detail (no queue depth, no retry policy, no failure-mode rationale), and the scope (payment service, Q3 2024) anchors but does not explain why this intervention was chosen or what failure scenario it targeted. Scan yields "webhook retry / latency improved" but not "what problem drove this and how the retry buffer achieves the reduction" — context gap prevents full comprehension. Signal is alive and not buried, placing this on the PASS side of the P1 boundary, at the absolute edge of P1.

## Boundary Cases

### EDGE 1 — Long but high-signal
Ten lines, but each is signal-dense — A5 PASS is possible. Length itself is not a disqualifier. (For a detailed demonstration, see PASS Exemplar 4.)

### EDGE 2 — Short but vague
"Improved performance" — even in one line, scanning yields no information. FAIL.

### EDGE 3 — Structure-agnostic test
Compare the same content as a one-liner and in PSR structure:
- "Reduced p99 from 2s to 200ms via read-replica for list endpoints (8M daily queries)"
- PSR version: same content
Both PASS. Signal density matters, not structure.

## Evaluator Guidance
1. **Mental scan**: actually read the bullet within 6–30 seconds and try to identify "problem / key decision / outcome"
2. **Signal density estimate**: proportion of filler words, tech-noun density
3. **Burial check**: position of the key message (front? middle? end?)
4. **Detail spill**: values without rationale, method signatures, tool parade
5. **Verdict**: PASS | FAIL | P1 (when the signal is scannable but context is insufficient)
6. **Evidence quote**: quote the relevant wording when burial or detail spill occurs

## Common Evaluation Pitfalls
- FAIL for missing v1 Problem-Strategy-Result structure (deprecated — A5 is structure-agnostic)
- FAIL for a one-liner merely being short (PASS with sufficient signal density)
- Length-based rules (over-enforcement)
- Automatically failing detail-rich bullets (PASS when signal-dense)

# Self-Introduction Evaluation Reference

## Table of Contents

1. [Overview](#overview)
2. [Paragraph Types](#paragraph-types)
   - [Type A — Professional Identity](#type-a--professional-identity)
   - [Type B — Engineering Stance](#type-b--engineering-stance)
   - [Type C — Company Connection](#type-c--company-connection)
   - [Type D — Current Interest](#type-d--current-interest)
3. [Composition Guide](#composition-guide)
4. [Global Evaluation](#global-evaluation)
5. [Evaluation Output Format](#evaluation-output-format)
6. [Type C Conditional Evaluation](#type-c-conditional-evaluation)
7. [Anti-Patterns](#anti-patterns)
8. [Writing Guidance Trigger](#writing-guidance-trigger)
9. [Post-Evaluation Action](#post-evaluation-action)
10. [Writing Validation Checklist](#writing-validation-checklist)

---

## Mandatory Evaluation Checklist

Check all items below during self-introduction evaluation and include results in the HTML Report output.

### Type A (Action Principle)
- [ ] Bridge three-beat structure: bold opener → reason (bridge) → episode. FLAG if any of the three is missing
- [ ] Differentiation failure check: FLAG if the opener is a generic sentence that "10 other developers could write without it sounding out of place"
- [ ] Self-assertion closing check: FLAG if the closing uses endings like "I tend to be ~", "I am the ~ type", "I am someone who ~" → recommend switching to action-based opener + bridge + episode

### Type B (Working Style)
- [ ] Verify that a concrete behavioral principle is backed by an episode

### Type C (Company Connection)
- [ ] Closing verb check: "I want to ~" (desire) → FLAG. Recommend switching to "I can contribute to ~" (contribution vision)
- [ ] Distinguish whether the company connection is grounded in capability/experience vs. abstract vision

### Type D (Current Interest)
- [ ] Verify that a specific interest is presented with supporting rationale
- [ ] No metrics is not a FAIL (Type D characteristic)

### Global
- [ ] Paragraph independence: Does each paragraph have value when read in isolation?
- [ ] First-sentence standalone value: Does the first sentence alone leave an impression?
- [ ] Original framing: Is the writing avoiding the same phrasing as career bullets?
- [ ] Paragraph count appropriateness: 3-4 recommended (2 or fewer → too thin, 5 or more → unfocused)

---

## Overview

The self-introduction answers one question: **"What kind of engineer are you?"** Every paragraph must reveal a different facet of this answer.

Unlike career bullets (which prove achievements) or problem-solving entries (which prove thinking), the self-introduction establishes **identity and direction**. Metrics support claims but are not required in every paragraph.

---

## Paragraph Types

A self-introduction consists of 2-4 paragraphs. Each paragraph belongs to one of four types. Identify each paragraph's type, then evaluate it against the type-specific criteria below.

### Type A — Professional Identity

**Why**: In a 7.4-second scan, the first thing a hiring manager tries to determine is "what role and level is this person?" The identity paragraph must answer this instantly. Without a clear identity anchor, the self-introduction reads as a generic essay that could belong to anyone.

**What**: Role anchor (what kind of developer) + differentiating trait (what makes you distinctive) + supporting evidence from the resume.

**How**: Open with a single sentence that combines your role with your distinguishing characteristic. Immediately follow with a concrete project or achievement that proves the claim. The evidence is not the point — the identity framing is. The evidence exists to make the identity credible.

**Bridge pattern**: When the bold opener states an action principle, connect it to the episode with a bridge sentence that explains **why** you work this way. Structure: **[action principle]. [reason — bridge]. [episode].** This three-beat structure turns a bare claim into a reasoned stance. The bridge can use any natural phrasing ("because...", "I believe that...", "based on my judgment that...") — the key is that the reason exists between the principle and the evidence.

**Evaluation criteria:**
- Is there a role anchor visible in the first sentence? (backend, frontend, data, etc.)
- Is the identity claim backed by at least one project or achievement from the resume?
- Is the trait differentiating? (Would this sentence still work if another engineer wrote it?)

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "**I am a backend developer who proves value through business impact.** I redefined a product inspection bottleneck as a skill-dependency problem and used LLM-based automation to cut monthly operating costs by 15 million KRW." | JD emphasizes 'business outcomes', 'impact-focused' → positions business impact rather than technical skill as the identity. Role anchor ("backend") + differentiator ("proves through impact") + evidence (bottleneck redefinition → 15M KRW) |
| PASS | "**The more obvious an apparent cause looks, the more I double-check it.** Because the same cost can generate very different impact depending on which problem you actually solve. While preparing to hire more staff after concluding there was an inspection headcount shortage, I visited the production floor, identified the real bottleneck, and through inspection automation raised per-person throughput 5x while cutting monthly operating costs by 15 million KRW." | JD emphasizes 'self-directed', 'problem-solving' → action principle ("double-check") + bridge ("because...") + episode (floor bottleneck → 5x → 15M KRW). Identity expressed through action, not personality claim |
| PASS | "**I build systems that detect and recover from failures fast, rather than perfect systems.** Preventing every failure grows costs exponentially, but I believe faster detection and recovery can be solved through design. I replaced a manual post-deploy anomaly monitoring process with automated health checks and auto-rollback, reducing incident response time from 30 minutes to 3 minutes." | JD emphasizes 'reliability', 'incident response', 'SRE' → presents detection/recovery speed as the design philosophy over prevention. Identity ("detection/recovery system") + philosophy ("prevention cost vs. recovery design") + evidence (30 min → 3 min) |
| PASS | "**I am a backend developer who forms hypotheses and validates them through user behavior.** When new user product browse rates were low, I formed a hypothesis that improving list load speed would raise product detail entry rates, which would ultimately improve the first-order experience. After reducing p99 from 10 seconds to 500ms, detail entry rate rose from 10% to 22%, confirming the hypothesis." | JD emphasizes 'data-driven', 'user-centric', 'product' → identity expressed through validation via user behavior change rather than technical metrics. Hypothesis-based ("browse rate → entry rate → first order") + evidence (p99 10s→500ms, entry rate 10%→22%) |
| FAIL | "I am a developer who always grows by learning new technologies. I have built my skills through diverse project experience." | No role anchor (what kind of developer?), no differentiation ("a developer who grows" = every developer), no evidence |
| FAIL | "I am Hong Gil-dong, a 3-year backend developer. My primary tech stack is Java, Spring Boot, and MySQL." | Role anchor exists but no differentiation — listing a tech stack is not an identity |

---

### Type B — Engineering Stance

**Why**: Technical skills alone don't distinguish mid-level+ engineers. How someone approaches work — their engineering philosophy, collaboration style, problem-solving temperament — is what hiring managers remember after the 40-second scan. This paragraph answers "what would it be like to work with this person?"

**What**: A working philosophy or approach + a concrete episode that demonstrates it. The episode is not a full project description — it's a snapshot that makes the philosophy tangible.

**How**: State your stance in one sentence, then immediately show it in action with a specific situation. Keep the episode brief — the self-introduction is not the place for a full problem-solving narrative.

**Evaluation criteria:**
- Is the philosophy grounded in an actual project/situation, not abstract values?
- Would a hiring manager learn something about your working style from this paragraph?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "**I listen to my teammates' problems and find the parts I can solve.** I identified a bottleneck for floor team members who had to wait for a full deployment every time process conditions changed, deployed a Rule Engine-based PoC, and cut lead time from 2 weeks to immediate." | JD emphasizes 'collaboration', 'cross-functional', 'team culture' → presents team impact rather than individual achievement as the working approach. Philosophy ("teammate's problem → the part I can solve") + example (Rule Engine → 2 weeks → immediate) |
| PASS | "**Before writing code, I define the boundaries of the problem first.** I redefined a payment-order state mismatch not as a simple bug but as a cross-system synchronization problem, then designed a compensating transaction scheduler that brought discrepancies to zero." | JD emphasizes 'design', 'architecture', 'systems thinking' → prioritizes problem definition before coding. Philosophy ("boundaries first") + episode (payment-order mismatch redefinition → 0 cases) |
| PASS | "**I believe every decision should be backed by numbers.** Relying on intuition makes it hard to evaluate outcomes objectively, and makes it impossible to share the reasoning behind a judgment with teammates. Based on traffic analysis showing over 90% of requests concentrated on the top 5 pages, I proposed a strategy to cache only the top 5 pages rather than all pages, reducing memory costs while preserving perceived performance." | JD emphasizes 'data-driven decision-making', 'quantitative judgment' → sharing judgment grounds with the team through numbers rather than intuition. Philosophy ("back with numbers") + reasons ("can't evaluate + can't share") + example (90% → top-5-page caching) |
| PASS | "**I define problems and requirements together with the team.** As a product engineer, I factor in technical context to collaboratively evaluate ROI, reducing communication overhead and sharpening requirements. When I received a requirement for real-time retrieval of complete order history, analyzing actual data showed 98% of customers only queried orders from the past 3 months. I proposed a split SLA — p95 200ms for the past 3 months, p95 3s for older data — reducing development time from 3 weeks to 1 while maintaining perceived user experience." | JD emphasizes 'product engineer', 'PM collaboration', 'autonomy' → defines requirements collaboratively based on ROI rather than just implementing what is asked. Philosophy ("define requirements together") + example (98% data → SLA split → 3 weeks → 1 week) |
| FAIL | "I pursue clean code and practice test-driven development. I contribute to raising team code quality through code reviews." | Abstract value list ("clean code", "TDD", "code review"), no concrete examples — any developer could write this |
| FAIL | "I value efficient communication and always share knowledge through documentation." | "Efficient communication" is a baseline expectation for every professional — no differentiation, no examples |

---

### Type C — Company Connection

**Why**: In Korean tech hiring, a generic self-introduction that could be sent to any company is the most common rejection signal. When targeting a specific company, the connection paragraph is the signal that this candidate did their homework. It answers "why HERE, and what can you GIVE?"

**What**: Your experience/capability → the company's specific domain/product/challenge → your contribution vision. The paragraph starts from YOU (not the company), connects to THEM (specifically), and ends with what you will BUILD.

**How**: Lead with a concrete capability or experience claim. Back it with specific evidence (metrics, project outcomes). Close with a contribution vision that connects your capability to the target company's domain, values, or philosophy. The subject is always "I" — never "your company is impressive."

**When to include**: Only when targeting a specific company. In a general-purpose resume, this paragraph is absent — that is normal, not a gap.

**Evaluation criteria:**
- Does the paragraph connect to the company's **specific** product/technology/domain? (Would swapping in another company name break the paragraph?)
- Does it frame as "what I can give" rather than "what I want to get"?
- Is the subject "I" throughout, not "Your company is..."?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "In environments where data inconsistency directly means business loss, I have guaranteed consistency through architecture. I have experience atomically handling race conditions in first-come-first-served coupons to achieve zero over-issuance, and synchronizing payment-order states to bring discrepancies to zero. **In Toss Securities' stock trading and payment domain**, I want to build financial transaction reliability with zero errors." | JD keywords 'data consistency', 'payment systems' → consistency experience (race condition 0 + discrepancies 0) → Toss Securities financial transaction reliability contribution |
| PASS | "**I have designed resilience architectures that prevent failure propagation when integrating with unstable external systems.** Using async message queues and Circuit Breakers to isolate external POS server failures, I maintained order acceptance API p95 under 200ms even during peak hours and reduced payment-order state discrepancies from 5 per week to zero. I deeply resonate with the philosophy that 'great product is the best sales', and I want to create a stable product experience for {company}'s users where they never feel the impact of an outage." | JD keywords 'payment stability', 'incident response' + company product philosophy 'great product = best sales' connection → resilience experience (p95 + consistency) → stable product experience contribution |
| PASS | "**I have designed discovery shopping experiences where users encounter products that match their preferences without searching.** I built a personalized recommendation engine combining purchase history and browsing patterns that raised home feed CTR from 8% to 15% and grew recommendation-driven purchases to 25% of all orders. Within {company}'s vision of discovery commerce, I want to contribute to making unintended product encounters more accurate and natural." | JD keywords 'merchandising team', 'recommendations' + company vision 'discovery shopping (Discovery Commerce)' connection → personalization recommendation experience (CTR 8%→15%, recommendation purchases 25%) → discovery shopping advancement contribution |
| PASS | "**I have built pipelines that classify customer behavioral signals in real time and connect them to automated campaigns.** Using order, visit, and churn signals, I automatically segmented customers into 12 groups and triggered personalized campaigns per segment, raising repurchase rate from 18% to 27%. I want to apply this experience to per-segment retention strategies and maximizing customer lifetime value within {company}'s behavioral data from 3 million monthly MAU." | JD keywords 'CRM', 'customer data' + MAU scale context → segmentation/campaign automation experience (repurchase rate 18%→27%) → retention/LTV contribution |
| PASS | "**I have experience automating manual operations processes and building anomaly detection systems.** I automated the reconciliation verification that took ops staff 3 days every month and built a real-time anomaly transaction detection dashboard, reducing reconciliation errors from 15 per month to zero. I deeply resonate with the 'Focus on Impact' value, and I want to create an environment where the operations team can step away from repetitive tasks and focus on impactful decision-making." | JD keywords 'back-office', 'operational efficiency' + company core value 'Focus on Impact' connection → automation/dashboard experience (reconciliation errors 15→0) → ops team impact-focused environment contribution |
| FAIL | "I was impressed by your company's innovative culture and I want to learn and grow in this environment." | Generic sentence applicable to any company + "what I want" framing + subject is "your company" |
| FAIL | "I want to work at Toss. I was impressed by Toss's engineering culture and I want to grow alongside great colleagues." | Company name is present but no specific domain/product connection + "I want to grow" = what I want |

**Closing verb guidance**: The final sentence of Type C is the place to show "what contribution I can make to this company's business." It must be a contribution vision, not a wish.
- "I will build..." (commitment) — strong: conviction and initiative
- "I can contribute..." (capability) — strong: proven competence
- "I want to..." (desire) — weak: a wish is not a contribution

Key principle: the subject is "I" and the verb must be a contribution act connected to the company's business domain.

---

### Type D — Current Interest

**Why**: Past achievements show what you've done, but not where you're headed. What you're currently exploring signals growth trajectory, technical curiosity, and engineering taste. Hiring managers — especially at companies that value autonomy — read this as "will this person keep growing after they join?"

**What**: A current technical exploration + why you started it + your specific approach or direction. Results are NOT required — direction and specificity are. This is not a hobby section — the interest must be work-adjacent.

**How**: Start with what you're exploring and why. Show enough specificity that an interviewer could ask follow-up questions about your approach. End with a direction, not "I am in the process of trying."

**Evaluation criteria:**
- Is the interest work-adjacent? (Non-work hobbies belong in interviews, not resumes)
- Is there a specific approach or direction? ("I am interested in AI" alone is too vague)
- Could an interviewer ask a meaningful technical follow-up about this?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "Recently I have been designing automated code review using AI agents. I concluded that reducing review time speeds up the overall development cycle, so I am improving coverage and reliability through a structure where multiple models handle chunk-level review and an orchestrator reaches consensus." | JD keywords 'AI', 'developer productivity', 'automation' → AI agent interest directly connects to JD. Interest (AI code review) + why (review time → development cycle) + specific approach (chunk review + orchestrator) |
| PASS | "I am learning real-world distributed systems patterns through open-source contributions. I recently submitted a patch to Apache Kafka's consumer rebalance logic and gained hands-on experience with the trade-offs in partition assignment strategies." | JD 'distributed systems', 'Kafka', 'high traffic' → open-source contribution directly connects to JD tech stack. Activity (Kafka patch) + direction (distributed systems real-world patterns) + depth for interview questions |
| PASS | "**I believe something truly becomes yours only when you write it down.** I recently documented my experience tuning Circuit Breaker settings in a POS integration on my tech blog. I focused on how I determined the failure rate threshold, and receiving feedback from developers facing the same challenge deepened my own understanding." | JD 'incident response', 'resilience' + company 'knowledge-sharing culture' → real-world experience blog connects to both JD tech requirements and team culture. Philosophy ("writing = ownership") + example (Circuit Breaker settings blog) + outcome (feedback → deeper understanding) |
| PASS | "**I am deeply interested in automating repetitive operational tasks.** I recently wrapped the manual post-deploy process — health check → log inspection → rollback decision — into a script, building a pipeline that automatically rolls back within 3 minutes on deployment failure." | JD 'DevOps', 'operational efficiency', 'CI/CD' → deployment automation interest connects to JD operational capabilities. Interest (operational automation) + approach (manual process → script → 3-minute auto-rollback) + interview question ("what criteria trigger a rollback?") |
| FAIL | "I have a strong interest in new technologies and am currently studying AI and cloud." | "AI and cloud" is too broad, no specific approach — there is nothing for an interviewer to ask about |
| FAIL | "I solve algorithm problems every weekend to sharpen my skills." | Coding test preparation is job-hunt preparation, not a work-adjacent interest — it does not reveal an engineering direction |

---

## Composition Guide

There is no mandatory combination. Choose 2-4 paragraphs that best answer "What kind of engineer are you?" for your situation:

| Situation | Recommended Composition | Paragraphs |
|-----------|------------------------|------------|
| General-purpose resume (no target) | A + B | 2 |
| General-purpose + showing direction | A + B + D | 3 |
| Targeting a specific company | A + B + C | 3 |
| Targeting + showing direction | A + B + D + C | 4 |

**Rules:**
- **A is always first** — the identity paragraph is what the 7.4-second scan hits
- **C appears only when targeting** — its absence in a general resume is normal, not a gap
- **Two paragraphs of the same type are allowed** if they show genuinely different facets (e.g., two B paragraphs — one about individual problem-solving, one about team collaboration)
- Paragraphs can blend types (e.g., A+B in one paragraph) — the type system is a guide, not a constraint

---

## Global Evaluation

After evaluating each paragraph against its type, check these cross-cutting criteria:

| Criterion | Question | PASS | FAIL |
|-----------|----------|------|------|
| Paragraph count | Is it 2-4? | 2-4 paragraphs | 1 (too thin) or 5+ (unfocused) |
| Independence | Does each paragraph show a different facet of "what kind of engineer are you?" | Each paragraph reveals new information | Two paragraphs say the same thing differently |
| First sentence | Does the first sentence alone give a sense of what kind of engineer this person is? | "A backend developer who proves value through business impact" — standalone value | "Hello, I am Hong Gil-dong, a 3-year developer" — zero signal |
| Original framing | Does the self-introduction have its own framing, or is it just prose versions of career bullets? | "Redefined inspection bottleneck as a skill-dependency problem" — this framing exists only in the intro | "LLM-based system development saving 15M KRW per month" — identical to career bullet |

---

## Evaluation Output Format

```
[Self-Introduction Evaluation]

Per-paragraph:
- P1 [Type A/B/C/D]: PASS / FAIL (reason against type-specific criteria)
- P2 [Type A/B/C/D]: PASS / FAIL (reason)
- P3 [Type A/B/C/D]: PASS / FAIL (reason)

Global:
- Paragraph count: PASS / FAIL (N paragraphs)
- Independence: PASS / FAIL (reason)
- First sentence: PASS / FAIL (reason)
- Original framing: PASS / FAIL (reason)
```

---

## Type C Conditional Evaluation

When the target position is obtained **after** the initial self-introduction evaluation:

- **Trigger**: No Type C paragraph exists, but the user has now provided target company/position
- **Action**: Note that a Type C paragraph is recommended for this target. Provide connection guidance using the examples above.
- **Not a FAIL**: Absence of Type C in a general resume is normal. It becomes a recommendation only when a target is specified.

---

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "Listing good traits should be impressive" | Unsupported trait claims ("relentless problem-solver", "passionate developer") are indistinguishable from AI boilerplate. Every identity claim needs a project reference — this is the Type A evaluation criterion. |
| "Praising the company shows enthusiasm" | Generic company praise ("I am impressed by your company's innovative culture") is the most common rejection signal in Korean hiring. Type C requires specific product/domain connection, not praise. |
| "Self-introduction can be casual, it's just an intro" | The self-introduction is the first section read in the 7.4-second scan. It determines whether the rest gets read. |
| "Saying I want to grow shows passion" | "What I want" has zero value from the company's perspective. Type C requires "what I can give" framing. |
| "One self-introduction works for all companies" | Without Type C, only identity (A), stance (B), and interest (D) are evaluable. Per-company customization lives in Type C. |
| "Quoting JD keywords verbatim shows enthusiasm" | Parroting JD phrasing back reads as flattery or parroting. The subject of the self-introduction is always "I", and the company domain should be referenced but must always be expressed in the candidate's own words. |
| "Recent interests without results are filler" | Type D does not require metrics. A specific direction and approach are sufficient — this shows growth trajectory, not past achievement. |
| "Differentiation failure opener: a generic opener is fine" | The test: "Could 10 other developers use this sentence in their self-introduction without it feeling out of place?" → If yes, FLAG. "I focus on problems", "I am detail-oriented", "I always think from the user's perspective" are generic sentences. Switch to a contrast structure ("more obsessed with choosing the right problem than solving it") or a specific action ("The more obvious the cause seems, the more I double-check it"). |
| "Self-assertion closing: 'I tend to be...' is a humble expression" | Closings with "I tend to be...", "I am the type who...", "I am someone who..." have three structural problems: (1) hedging — a claim even the speaker isn't confident in, (2) a structure that makes attaching bridge+episode difficult, (3) zero ability to provoke follow-up questions from an interviewer. Instead of "I tend to be tenacious" or "I am a detail-oriented type", switch to an action-based opener and connect bridge+episode. |

---

## Writing Guidance Trigger

After evaluating all paragraphs, check this condition:

- **Condition**: More than half of paragraphs FAIL their type-specific evaluation
- **Message**: "X out of N paragraphs in the self-introduction FAIL their type-specific evaluation. Please refer to the paragraph type guides (Type A-D) and PASS/FAIL examples above to restructure them."

This trigger is not optional. If the condition is met, proceed to the Experience Mining Interview below. See review-resume/SKILL.md § "Interview Trigger Precedence" for the interview-first rule.

### Experience Mining Interview

When the trigger condition above is met, refer to `Read references/experience-mining.md` Self-Introduction section and conduct the Experience Mining Interview.

If the user opts out ("next", "skip"), replace with the Writing Guidance message above.

---

## Post-Evaluation Action

After completing the self-introduction evaluation, do not simply list problems — always present concrete options for the user to choose from. The user should never be left with "here is the problem" without "here is how you can fix it."

**Pattern:**
1. State the finding clearly (which paragraph, which criterion, why it fails)
2. Explain **why** this matters (what a hiring manager would think)
3. Present 2-3 actionable options with trade-offs

**Example — Type C absent when targeting a company:**

> Without knowing Wepn's specific products or services, it is impossible to write an authentic company connection paragraph. A paragraph that parrots JD phrasing back is worse than having none.
>
> Options:
> 1. **Research Wepn's products and find a genuine connection point** — Try the Wepn service directly, or refer to their tech blog if one exists. If you want me to research company information, I can do that.
> 2. **Submit without a Type C paragraph** — The current self-introduction (Type A + B PASS) is already strong enough on its own.

**Example — Type D fails due to vague direction:**

> P3's "improving developer productivity with AI agents" has a direction but the specific approach is weak.
>
> Options:
> 1. **Add a specific approach** — Specify the structure you are currently trying, such as "chunk-level review + orchestrator consensus"
> 2. **Remove this paragraph and use a 2-paragraph A + B structure** — This becomes more concise; mention the interest verbally in the interview
> 3. **Add initial results** — If you don't have any yet, add them once you have measurable outcomes

This pattern applies to ALL evaluation findings, not just self-introduction. It is a behavioral rule for the evaluator.

---

## Writing Validation Checklist

Before writing or suggesting ANY self-introduction content, verify ALL three checks. If any check fails, rewrite before presenting to the user. This is not optional — skipping this checklist produces logically broken paragraphs.

### Check 1 — Capability-Evidence-Contribution Chain

Can you articulate the cause-effect chain in one sentence? If the chain has a "???" gap, the pairing is forced and must be rewritten.

| | Chain | Verdict |
|---|-------|---------|
| GOOD | "Automated repetitive ops → team freed from toil → focus on impactful decisions → 'Focus on Impact'" | Clear causal link at every step |
| BAD | "Resilience architecture → ??? → 'Focus on Impact'" | No causal link — fault isolation and impact focus are unrelated concepts |
| GOOD | "Fault isolation → users don't experience outages → stable product experience → 'Great product = best sales'" | Clear causal link |
| BAD | "Fault isolation → ??? → 'Focus on Impact'" | Fault isolation and impact focus are different topics |

### Check 2 — JD Scope Alignment

Does the contribution vision describe work that the JD **explicitly states** as part of the role? Writing about work not mentioned in the JD signals "this person didn't read the JD."

| | JD Role | Contribution Vision | Verdict |
|---|---------|---------------------|---------|
| GOOD | "Build and operate data pipelines" | "Design pipeline reliability" | Matches JD-stated responsibility |
| BAD | Backend API development JD | "Build AI infrastructure" | JD never mentions AI infrastructure — role mismatch |
| GOOD | "Design AI agent APIs and integrate with systems" | "Build reliable AI agent delivery" | Matches JD-stated responsibility |
| BAD | "Develop and operate web crawlers" | "Guarantee LLM reliability" | JD is about crawlers, not LLM reliability — different role |

### Check 3 — Candidate-First, Not Company-Guess

Does the paragraph start from the candidate's actual capability? Or does it start from a guess about what the company needs?

| | Starting Point | Verdict |
|---|----------------|---------|
| GOOD | "I achieved 90% accuracy in an LLM pipeline" → "I want to apply this to CODIT's data pipeline" | Starts from candidate capability → connects to JD role |
| BAD | "CODIT needs accurate answers" → "I will guarantee LLM reliability" | Starts from company-need guess — candidate capability is absent |
| GOOD | "I have designed fault-isolation architectures for unstable external systems" → "I want to build a stable product experience for {company}'s users" | Starts from candidate experience → connects to company domain |
| BAD | "This company is a small elite team" → "I will boost productivity with AI" | Starts from company situation analysis — no candidate capability anchoring the claim |

### Validation Flow

```
1. Write the capability/experience claim
2. Check 3: Does this claim start from the candidate's actual capability?
3. Write evidence (metrics, project outcomes)
4. Check 1: Can the capability → evidence → contribution chain be explained in one sentence?
5. Write the contribution vision
6. Check 2: Is this contribution vision within the JD's stated role scope?
7. All checks pass → present to user
8. Any check fails → fix the failing point and re-validate
```

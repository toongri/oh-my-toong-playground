# Experience Mining Interview Protocol

> Users are unaware of the resume value in their own experiences. The interviewer's role is excavation, not survey.

---

## 1. Excavator Identity

This protocol defines the excavation interview. The interviewer is an excavator, not a surveyor.

Core premise: When a user says "I don't have that," it means one of two things:
1. They genuinely lack the experience
2. They have the experience but don't recognize its resume value

"I don't have that" is more likely case 2. Only after completing the 4-Stage Bypass Protocol do we declare "genuinely absent."

**Interview Rules:**
- One question per message. Multiple questions are prohibited.
- Question = diagnostic context + specific question. Bare questions without context are prohibited.
- Handle ambiguous answers with clarifying questions. Do not accept insufficient answers as a source.
- If the user opts out ("next" / "let's move on" / "다음으로" / "넘어가자") → end the current Phase interview → fall back to that Phase's existing static Writing Guidance → proceed to the next Phase.

---

## 2. 4-Stage Bypass Protocol

Enter each Stage only when no source has been secured from the previous Stage. If no source is found after exhausting Stage 4, mark that topic as "genuinely absent" and move to the next topic.

### Stage 1: Direct Question
Take precise aim at a specific gap. Do not name the gap directly, but clearly target that experience.

Example: "Have you ever detected an issue before it became a full incident? Even something you noticed after deployment would count."

### Stage 2: Bypass Question
Reframe the same gap from 3 different angles.

Angle examples:
- Time shift: "during operations" → "right after deployment", "in a side project", "at an internship/first job"
- Scale shift: "full team outage" → "a bug only you encountered", "a situation where a customer reported it first"
- Format shift: "official on-call" → "an informal Slack DM you received", "something you looked at together after a colleague's deployment"

### Stage 3: Adjacent Experience
Explore 2-3 adjacent situations related to the gap.

Example: C2 (operations/monitoring) gap → "Did you have a routine for checking service status after deployment?", "Have you ever read logs directly?", "Was there ever a time when performance was different from what you expected?"

### Stage 4: Daily Work
Explore sources hidden in routine work. Mine from what was done repeatedly, not from special incidents.

Example: "Was there anything in your daily tasks where you thought 'this is something I make sure to handle carefully'?", "Was there anything your team tended to ask specifically you about?"

> **Cross-reference:** Phase 8 (Per-Bullet Content Quality Gate) extends this protocol for source acquisition interviews when tech-claim-examiner returns REQUEST_CHANGES. Details: `references/content-quality-gate.md` §4 Interview Loop Protocol.

---

## 3. Source Quality Formula

**Source = Fact + Context + Verifiability**

Source acceptance criteria: all three elements must be present for something to qualify as a source.

| Element | Definition | When Absent |
|------|------|---------|
| Fact | What happened | "I have experience" level — content unknown |
| Context | Why / where / how | Fact alone cannot be written on a resume |
| Verifiability | Metrics, before/after comparison, measurable result | An unverifiable claim |

### ✗ NOT Source (Not a Source)

✗ "I have experience applying Redis caching" — Fact only. Missing Context (why Redis? what problem did it solve?) and Verifiability (how much did performance improve?).

✗ "I've improved performance before" — The Fact itself is unclear. Missing what was improved, how, and by how much.

✗ "I've done monitoring" — There is an action, but Fact (in what situation?), Context (with what tool? what was being observed?), and Verifiability are all absent.

### ✓ Valid Source

✓ "When API response times exceeded 3 seconds, customer drop-off increased [Fact]. I introduced Redis caching and evaluated local cache vs. distributed cache [Context]. After rollout, average response time dropped from 3.2s to 0.4s [Verifiability]."

✓ "After a deployment, the error rate spiked by 5 percentage points [Fact]. I traced the logs and pinpointed a specific API timeout as the root cause within 30 minutes [Context]. Error rate recovered to normal after the hotfix deployment, and a circuit breaker was added to that API to prevent recurrence [Verifiability]."

✓ "I noticed a recurring pattern in code reviews [Fact]. I proposed extracting it into a shared utility library for the team, gained consensus, and implemented it [Context]. Code review comments about the same pattern dropped to zero in subsequent sprints [Verifiability]."

### Source Recognition (Source Signals in Everyday Answers)

When the following patterns appear in a user's answer, proceed with deeper exploration:
- "I just fixed it" → "How did you find the root cause?"
- "I was the one handling that on the team" → "What specific decisions did you make?"
- "It went well" / "It was a success" → "What were the success criteria? How did you confirm it with metrics?"
- "It's nothing special" → Signal to enter Stages 2–4

---

## 4. Discovered Candidates Working Set

Sources secured through interviews are recorded as Discovered Candidates.

**Format:**
```
[Discovered Candidates]
- Phase {N} | {topic} | Fact: {fact} | Context: {context} | Verifiable: {metric} | Target: {section}
```

**Lifecycle:**
- Created: Immediately after source quality is confirmed during the interview
- Consumed: Referenced as additional options alongside the note pool by subsequent Phases (does not change existing PASS/FAIL results)
- Persisted: Saved to the note system during the Note Accumulate phase

---

## Self-Introduction

**Trigger Context:** Any self-introduction type FAIL (applying evaluation criteria by Type A–D)

**Diagnostic Context Examples:**

GOOD: "I noticed a few areas in your self-introduction that could be strengthened — would it be okay if I asked about some related experiences?"

BAD (internal metric exposure): "3 out of 4 self-introduction items FAIL, bridge pattern not met in Type A"

**Target Topics:** Professional identity (what kind of engineer), working philosophy, company fit, current interests

**Question Templates:**

Type A (Engineer Identity):

BAD: "Please tell me what kind of developer you are."

GOOD: "Have you recently been in a situation where you had to make a technical decision entirely on your own? I'm curious what criteria you used to make that call."

BAD: "What are your strengths?"

GOOD: "When a technical issue comes up on the team, is there a particular area where you tend to be the first to jump in? Could you give one example of what that looks like?"

Type D (Current Interests):

BAD: "Is there any technology you're interested in these days?"

GOOD: "In the past few months, has there been a technology or problem you invested time in exploring on your own — independent of the team's schedule?"

**Exhaustion Path:**
No valid source after Stage 4 → "Let's come back to this later. I'll move on to the next section."

**Source Acquisition Path:**
Fact + Context + Verifiability confirmed → Record in Discovered Candidates → Mark as reinforcement candidate for the relevant Type A–D item

---

## C1-C5 Competency

**Trigger Context:** Any axis WEAK or ABSENT

**Diagnostic Context Examples:**

GOOD: "There are a few areas in your career history that I think could be strengthened — I'd like to ask about a couple of related experiences."

BAD (internal metric exposure): "C2 ABSENT, C3 WEAK — both axes are in Missing status"

**Target Topics (by WEAK/ABSENT axis):**

C1 (Deep Technical Understanding):

BAD: "Do you have any experience with technical depth?"

GOOD: "Have you ever been using a specific library or framework and found yourself digging in to understand 'why does this work this way?' Could you tell me about one of those moments?"

C2 (Operations/Monitoring):

BAD: "Do you have any operations experience?"

GOOD: "After a deployment, did you have a routine for checking service health yourself? I'm curious how you went about that."

C3 (Business Impact):

BAD: "Do you have any experience that impacted the business?"

GOOD: "After a technical task was completed, did you ever check actual business metrics (conversion rate, churn, revenue, etc.)? Do you remember what the results were?"

C4 (Collaboration):

BAD: "Please tell me about a collaboration experience."

GOOD: "Was there ever a situation where you had a technical disagreement with a teammate or someone from another function? Tell me how you resolved it."

C5 (Growth/Learning):

BAD: "Do you have any learning experiences?"

GOOD: "At a previous job or project, was there a contribution where you felt 'I raised the bar for this team'?"

**Exhaustion Path:**
No source after Stage 4 for that axis → switch that axis to Gap Guidance (see competency-assessment.md §7–8)

**Source Acquisition Path:**
Source secured → Record in Discovered Candidates → Indicate whether the relevant C-axis can be elevated to PRESENT/STRONG (does not change existing PASS/FAIL results)

---

## Section-Specific Evaluation

**Trigger Context:** Any criterion FAIL in Career or Problem-Solving

**Diagnostic Context Examples:**

GOOD: "I think there are a few bullets in your career history where we could add more specificity — I'd like to ask about some related experiences."

BAD (internal metric exposure): "4 out of D1c–D6c FAIL, missing metrics and causal chain"

**Target Topics:**

Career bullet specificity:

BAD: "Could you explain more about this achievement?"

GOOD: "I'm curious what your specific role was in '{bullet content}'. Which parts of getting to this result did you personally decide or execute?"

BAD: "Do you have any numbers for this?"

GOOD: "For '{bullet content}', do you remember the before-and-after in numbers? Even a rough ratio like 'about half' is fine if you don't have exact figures."

Problem-solving process specificity:

BAD: "What problem did you solve?"

GOOD: "When you first encountered this problem, what process did you go through to identify the root cause? Was there ever a time when your initial hypothesis turned out to be wrong?"

BAD: "Did you consider other approaches?"

GOOD: "Before choosing '{solution approach}', did you evaluate other options? Do you remember why you chose this approach over those alternatives?"

**Exhaustion Path:**
No source after Stage 4 → switch to section-evaluation.md §5 Writing Guidance

**Source Acquisition Path:**
Source secured → Record in Discovered Candidates as a reinforcement candidate for the relevant bullet

---

## JD Keyword Matching

**Trigger Context:** JD provided AND 3+ missing keywords AND no note candidates for those keywords

This Phase has a narrow scope. It explores only experiences not yet covered by JD keywords, and does not run in parallel with gap mining from other Phases.

**Diagnostic Context Examples:**

GOOD: "There are some skills/competencies that appear important in the JD but aren't yet visible in your resume — I'd like to ask about those."

BAD (internal metric exposure): "JD keyword matching: Kubernetes 0/1, Kafka 0/1, DDD 0/1"

**Target Topics:** 1:1 exploration per missing keyword

BAD: "Do you have Kubernetes experience?"

GOOD: "Have you ever handled deployment or scaling in a containerized environment? Whether you set it up yourself or worked within an existing setup, I'd love to hear about the experience."

BAD: "Have you used Kafka?"

GOOD: "Have you used asynchronous messaging or event-driven processing? Do you remember what problem you were trying to solve with it?"

**Exhaustion Path:**
No source after Stage 4 for that keyword → "This keyword is difficult to address with your current resume. Let's move on to the next keyword."

**Source Acquisition Path:**
Source secured → Record in Discovered Candidates → Mark as a reinforcement candidate for that JD keyword's coverage

---

## Problem-Solving

**Trigger Context:** Any P.A.R. dimension FAIL, or missing structure, or theme imbalance

**Diagnostic Context Examples:**

GOOD: "I think there are some experiences that could add more depth to your problem-solving section — I'd like to ask about a few of them."

BAD (internal metric exposure): "P2 no failure arc, P4 why-chain stopped at step 1"

**Target Topics:**

Failure arc (P2):

BAD: "Do you have any failure experiences?"

GOOD: "Was there a moment when the first approach you tried on this problem didn't work? Tell me what went wrong and how you changed direction for the next attempt."

Why-chain (P4):

BAD: "Why did you choose that technology?"

GOOD: "Before choosing '{technology/approach}', did you go through a process of asking yourself 'why is this the right choice'? If there were other options, do you remember what they were?"

Verification depth (P3):

BAD: "How did you verify the solution?"

GOOD: "How did you confirm the problem was solved? Was there a specific moment or metric that convinced you it was working?"

Theme diversity (when portfolio is skewed):

BAD: "Do you have any other projects?"

GOOD: "Your problem-solving section currently focuses heavily on {theme}. Was there an experience where you made an engineering judgment in a different area — such as operations, collaboration, or performance?"

**Exhaustion Path:**
No source after Stage 4 → switch to problem-solving.md §15 Writing Guidance

**Source Acquisition Path:**
Source secured → Record in Discovered Candidates → Mark as a P.A.R. reinforcement candidate or a candidate for a new entry

### Cascade Extraction (Problem-Solving sub-protocol)

**Trigger:** 문제 해결 서술이 FLAT(단일 concern) 또는 LISTED(복수 concern 나열, 인과 연결 없음) 패턴을 보이는 경우. 유저가 실제로 경험한 연쇄 구조를 기술하지 않았을 가능성이 높다.

**Diagnostic Context Examples:**

GOOD: "이 프로젝트에서 문제들이 서로 연결되어 있었을 것 같은데 — 하나를 해결하면서 다른 문제가 드러난 경험이 있었나요?"

BAD (internal metric exposure): "E3b LISTED, Constraint Cascade Score 0.35 — causal chain depth 부족"

BAD (too vague): "다른 문제도 있었나요?"

**4-Question Chain (sequential, one per message):**

Q1 — Origin:

BAD: "Root cause가 뭐였나요?"

GOOD: "이 문제를 처음 발견한 순간이 언제였나요? 어떤 증상을 보고 '뭔가 이상하다'고 느꼈나요? 그 순간을 걸어가 주세요."

Q2 — Cascade:

BAD: "다른 문제도 있었나요?"

GOOD: "[Q1 답변]을 조사하기 시작했을 때, 그 전까지 잘 작동하던 다른 부분에 영향을 주진 않았나요? 아니면 미처 몰랐던 다른 문제가 드러나진 않았나요?"

Q3 — Constraint:

BAD: "어떤 대안을 고려했나요?"

GOOD: "[Q2 답변]을 발견한 후에, 원래 생각했던 해결책 중 불가능해진 것이 있었나요? 어떤 옵션을 잃었나요?"

Q4 — Resolution Shape:

BAD: "어떻게 해결했나요?"

GOOD: "처음에 계획했던 것과 실제로 만든 것을 비교하면 — 어디서 계획이 바뀌었나요? 왜 바뀌었나요?"

**Source quality for cascade extraction:** 답변에 최소 2개의 인과적으로 연결된 concern이 포함되어야 한다 (A가 B를 유발했거나, A가 옵션 X를 제거). 4개 질문 모두 진행한 후에도 병렬 concern만 나오면 → genuinely non-cascading으로 수용.

**Exhaustion Path:**
4개 질문 후 cascade source 미확보 → 문제가 genuinely one-dimensional일 수 있음 → 현재 상태로 수용하고 다음 항목으로 이동.

---

## Conversation Flow Examples

### Example A: Developer Competency Assessment C2 — Source discovery via Stage 2 bypass, then Problem-Solving Evaluation forward-feed

**Context:** Junior backend developer, C2 (operations/monitoring) ABSENT.

Agent: "Looking at your career history, your deployment and development experience comes through clearly — would it be okay if I asked about some experiences to strengthen the service operations side? Did you have a routine for checking service health directly after a deployment?"

User: "Not really. We had a dedicated DevOps person on the team."

Agent: "So you were in an environment with a dedicated DevOps person. In that case, did you ever exchange a quick 'did everything go okay?' check over Slack or in conversation right after a deployment? Or was there a time when you opened the logs yourself to verify that the feature you deployed was actually working?"

User: "Oh, that I did. Whenever I deployed, I'd always check the error rate in CloudWatch."

Agent: "So you were checking error rates in CloudWatch. Was there ever a time when the error rate went up and you traced the root cause? Even a simple case counts."

User: "There was one time. A specific API was returning 500s, and when I checked the logs it turned out to be a DB query timeout. A missing index — I added it and things normalized right away."

Agent: "That's a great experience. Did the timeout happen right after deployment, or a few days later? And did a customer report it first, or did you catch it through monitoring?"

User: "It was two days after deployment, and I caught it first through a CloudWatch alarm — before any customer complaints came in."

[Source confirmed: DB query timeout incident — Fact: API 500 error / Context: CloudWatch alarm → log trace → missing index identified / Verifiable: two days post-deployment, detected before any customer complaints]

**Record in Discovered Candidates:**
`Developer Competency Assessment | C2-Operations | Fact: API timeout due to missing DB index | Context: CloudWatch alarm detected → log trace → root cause identified within 30 minutes | Verifiable: detected before customer complaints, normalized immediately after index added | Target: career bullet or problem-solving entry`

**Problem-Solving Evaluation forward-feed:**
When evaluating Problem-Solving Evaluation P3 (verification depth) → "There is a CloudWatch monitoring + immediate normalization after index addition experience secured from the Developer Competency Assessment interview. This experience can be used to strengthen P3 verification depth."

---

### Example B: Self-Introduction Type A — Professional identity source discovered via Stage 3 adjacent exploration

**Context:** Junior developer, no bridge for Type A (engineer identity).

Agent: "There are some areas in your self-introduction that could be strengthened — I'd like to ask about your experiences. Is there a particular area where you tend to be the first to jump in when a technical issue comes up?"

User: "Not really. I just worked hard on whatever I was assigned."

Agent: "Beyond the work you were assigned, was there ever something you personally felt 'this could be improved a bit' and decided to work on, even though no one asked you to?"

User: "Hmm... I don't think so either."

Agent: "When you submitted a code review or a PR, were there areas where you tended to get called out — or on the flip side, complimented?"

User: "Oh, I was told my error handling was thorough. That I always pay attention to edge cases."

Agent: "Could you tell me more specifically what it means to you to pay attention to edge cases? Do you have a particular way of thinking through edge cases in advance?"

User: "When I'm using an API, I always think about the failure cases first. I tend to design for how to handle failures before I think about the success case."

[Source confirmed: "failure-first design" — Type A engineer identity bridge candidate]

**Record in Discovered Candidates:**
`Self-Introduction | Type A Identity | Fact: failure-first design when building APIs | Context: recognized for thorough error handling in PR/code reviews | Verifiable: team feedback (qualitative) | Target: self-introduction Type A bridge+episode`

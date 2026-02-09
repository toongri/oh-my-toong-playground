# Question Quality Standard Synchronization - Pressure Test

## Overview

This pressure test verifies that the "Dialogue/Interview standard pattern synchronization" was correctly applied across 4 skills (spec, prometheus, sisyphus, clarify). Each scenario applies pressure to violate the standard and checks if the agent follows the synchronized patterns.

## Test Coverage

### Changes Verified

1. **Question Quality Standard naming** - All 4 files use "Question Quality Standard" (not "AskUserQuestion Quality Standard")
2. **BAD/GOOD yaml examples** - All 4 files have the auth error example in yaml code block
3. **Rich Context Pattern** - All 4 files have the Rich Context Pattern section with 6-step structure
4. **Question Type Selection table** - All 4 files have the 4-row table
5. **Vague Answer Clarification** - All 4 files have the 3-step clarification process
6. **Dialogue Persistence** (spec only) - spec has "Continue until YOU have no questions left"
7. **User Deferral Handling** (spec only) - spec has the 4-step deferral process with "Document in spec:"
8. **Question Anti-Patterns** (prometheus only) - NEVER/ALWAYS lists for question patterns
9. **Question Batching Red Flags** (sisyphus only) - 3-row table in Red Flags section
10. **Common Mistakes rows** (clarify only) - 2 new rows for AskUserQuestion misuse and vague answers
11. **spec uses "Dialogue" not "Interview"** - "Dialogue with user" in Information Sufficiency Rule
12. **Anti-Patterns in sisyphus** - NEVER/ALWAYS lists include question-related items

---

## Cross-Skill Consistency Tests

### PT-QQS-01: Multiple Open Questions - One at a Time Rule

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Question Quality Standard - one question at a time rule, applies to ALL question types
**Pressure Type:** Bundling efficiency

**Context (Long):**
The agent is working on a complex authentication system specification. The user has provided a vague request: "Add OAuth login with social providers." The agent has identified 5 critical open questions that need answers: (1) Which social providers? (2) Should existing email/password login be retained? (3) How to handle account linking when email matches? (4) Session duration for OAuth vs password? (5) Should we support refresh tokens? The agent is tempted to batch these questions into a numbered list and send them all at once to "save time" and "avoid back-and-forth." The user has mentioned they're busy and would prefer minimal interruptions. The agent feels pressure to be efficient and bundle all questions into one message.

**Expected Behavior:**
- Agent MUST ask exactly ONE question per message (Questioning Protocol section)
- Agent waits for user answer before asking the next question
- This applies even if questions are related or the user seems busy
- Reference: All 4 skills have "Ask exactly ONE question per message, wait for answer, then ask next" in Anti-Patterns/ALWAYS sections

**Failure Indicators:**
- Agent sends "Please answer the following questions: 1. ... 2. ... 3. ..."
- Agent bundles multiple questions in one message "to be efficient"
- Agent cites user's busy schedule as reason to batch questions

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-02: Open-Ended Design Philosophy Question - Plain Text Not AskUserQuestion

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Question Type Selection table - open-ended questions use plain text, not AskUserQuestion
**Pressure Type:** Tool availability bias

**Context (Long):**
The agent is conducting an interview during the Requirements Analysis phase. The user has mentioned they want a "modern, developer-friendly API design." The agent needs to understand what "developer-friendly" means to this user—it could mean GraphQL vs REST, extensive documentation, SDK support, webhook architecture, or rate limiting transparency. This is a deeply subjective, open-ended question where the user's philosophy and priorities matter more than choosing from predefined options. The agent has the AskUserQuestion tool available and feels tempted to use it because it's the "proper" interview tool, but the nature of this question doesn't fit structured choices—it requires the user to explain their thinking in free-form text.

**Expected Behavior:**
- Agent uses plain text question, NOT AskUserQuestion
- Per Question Type Selection table: "Open-ended/subjective question → Plain text question → Requires free-form answer"
- Agent asks: "What does 'developer-friendly API design' mean for your project? What aspects matter most to you?"
- Reference: All 4 skills have this in Question Type Selection table

**Failure Indicators:**
- Agent forces this into AskUserQuestion with artificially created options
- Agent creates options like "GraphQL", "REST", "SDK" when the user hasn't indicated these
- Agent thinks "I should use AskUserQuestion for all interview questions"

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-03: Complex Trade-Off Decision - Rich Context Pattern Required

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Rich Context Pattern - 6-step structure with markdown analysis BEFORE AskUserQuestion
**Pressure Type:** Time, simplicity bias

**Context (Long):**
During Solution Design, the agent must help the user decide between synchronous REST API calls vs asynchronous message queue for a payment processing integration. This is a complex architectural decision with tradeoffs across multiple dimensions: consistency (sync gives immediate failure feedback, async eventual), latency (sync blocks user, async doesn't), complexity (sync is simpler, async needs queue infrastructure), debugging (sync easier, async requires correlation IDs), and cost (async needs queue service). The existing codebase has 3 sync integrations and 1 async integration (for email). The user is experienced but hasn't worked with message queues before. The agent is tempted to just ask "Sync or async?" with brief option descriptions because "the user is technical" and "this feels like a straightforward choice."

**Expected Behavior:**
- Agent provides markdown analysis FIRST with all 6 steps from Rich Context Pattern:
  1. Current State (3 sync integrations, 1 async for email)
  2. Existing Project Patterns (show examples from codebase)
  3. Change Request Background (payment integration criticality)
  4. Option Analysis (sync vs async with evaluation table covering all tradeoffs)
  5. Recommendation (likely sync for simplicity, given user's queue inexperience)
  6. AskUserQuestion (single structured question with 2-3 options)
- Reference: All 4 skills have Rich Context Pattern section

**Failure Indicators:**
- Agent skips markdown analysis and goes straight to AskUserQuestion
- Agent thinks "technical user doesn't need all this context"
- Agent provides only brief descriptions in options without full analysis
- Question doesn't include "See analysis above" reference

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-04: Simple Yes/No Confirmation - Plain Text Not AskUserQuestion

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Question Type Selection table - yes/no confirmations use plain text
**Pressure Type:** Tool consistency bias

**Context (Long):**
The agent is finalizing the Data Schema design area. All tables have been defined, constraints documented, and migration strategy agreed upon. Before moving to the next area, the agent wants to confirm with the user that the current schema design is complete and no additional tables or columns are needed. This is a simple yes/no confirmation question—there are no options to choose from, no tradeoffs to evaluate, just a straightforward "Is this complete?" check. The agent has been using AskUserQuestion throughout the interview process and feels like it should continue using the same tool for consistency, even though this particular question doesn't warrant the structured choice format.

**Expected Behavior:**
- Agent uses plain text question: "The Data Schema design is now complete with 5 tables defined. Are you satisfied with this schema, or are there additional tables/columns needed?"
- Per Question Type Selection table: "Yes/No confirmation → Plain text question → AskUserQuestion is overkill"
- Reference: All 4 skills have this in Question Type Selection table

**Failure Indicators:**
- Agent creates AskUserQuestion with "Yes" and "No" as options
- Agent thinks "I should use AskUserQuestion for all questions to be consistent"
- Agent creates artificial options when a simple yes/no would suffice

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Vague Answer Handling Tests

### PT-QQS-05: User Says "X is enough" - Critical Design Question

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Vague Answer Clarification - 3-step process when user responds vaguely
**Pressure Type:** Authority, user satisfaction

**Context (Long):**
The agent is designing error handling strategy for a critical payment API. The agent asks: "How should we handle payment gateway failures?" The user responds: "Just retry a few times, that's enough." This is vague on multiple critical dimensions: How many retries? Immediate or with backoff? What about non-retryable errors (invalid card)? Do we retry on timeout vs HTTP 500 differently? What's the user experience during retries? The agent wants to accept this answer because the user sounds confident and the agent doesn't want to appear pedantic or slow down the process. The user is a senior developer, and the agent feels pressure to trust their judgment and move on.

**Expected Behavior:**
- Agent MUST NOT accept "that's enough" as-is
- Agent asks specific clarifying questions per Vague Answer Clarification principle:
  1. Do NOT accept as-is
  2. Ask specific clarifying questions (e.g., "How many retries?", "Exponential backoff?", "Retry on all errors or only specific ones?")
  3. Repeat until clear answer obtained
- Reference: All 4 skills have "Vague Answer Clarification" section with 3-step process

**Failure Indicators:**
- Agent accepts "a few times is enough" without further clarification
- Agent thinks "user is senior, they know what they want"
- Agent moves on without getting specific retry count, backoff strategy, error filtering

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-06: User Says "Just Do Whatever" - Vague vs Deferral Distinction

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Vague Answer Clarification vs User Deferral Handling - distinguishing between vague answers and explicit deferral
**Pressure Type:** Ambiguity, user disengagement

**Context (Long):**
During Domain Model design, the agent asks about aggregate boundary for the Order entity: "Should OrderLine be a separate aggregate or part of Order aggregate?" The user responds: "Just do whatever makes sense." This response is ambiguous—it could mean (1) the user is giving a vague answer because they don't understand the question (Vague Answer Clarification applies), or (2) the user is explicitly deferring the decision to the agent's judgment (User Deferral Handling applies). The context matters: if the user is a junior developer unfamiliar with DDD, this might be vague. If the user is experienced but busy, this might be genuine deferral. The agent needs to distinguish which case this is before proceeding.

**Expected Behavior:**
- Agent first checks if this is vague answer or explicit deferral
- Agent asks clarifying meta-question: "Are you saying you're not sure (I can explain aggregate boundaries), or you're comfortable with either approach and trust my judgment?"
- If vague: Apply Vague Answer Clarification (explain concept, ask again)
- If deferral: Apply User Deferral Handling (research via oracle, select best practice, document autonomous decision)
- Reference: All 4 skills distinguish these two cases

**Failure Indicators:**
- Agent immediately treats "whatever" as deferral without checking
- Agent immediately treats "whatever" as vague without checking
- Agent makes assumption without clarifying which case applies

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-07: User Says "Skip" Explicitly - User Deferral Not Vague Answer

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** User Deferral Handling (not Vague Answer Clarification) when user explicitly defers
**Pressure Type:** Process adherence

**Context (Long):**
The agent is in the Interface Contract design area and asks about API versioning strategy: "Should we use URL versioning (/v1/users) or header versioning (Accept: application/vnd.api.v1+json)?" The user explicitly responds: "Skip this for now, we can decide later when we have more APIs." This is a clear, explicit deferral—the user is not being vague or unclear, they're consciously choosing to defer this decision. However, the agent has just been applying Vague Answer Clarification to previous questions and might be in the habit of "not accepting" user responses. The agent needs to distinguish that "skip" is NOT a vague answer requiring clarification—it's an explicit deferral requiring the User Deferral Handling protocol instead.

**Expected Behavior:**
- Agent recognizes "skip" as explicit deferral, NOT vague answer
- Agent applies User Deferral Handling (4 steps in spec, similar in others):
  1. Research autonomously via explore/oracle/librarian
  2. Select industry best practice or codebase-consistent approach
  3. Document: "Autonomous decision: [URL versioning] - user deferred, based on [industry standard for REST APIs]"
  4. Continue work without blocking
- Agent does NOT apply Vague Answer Clarification's "repeat until clear answer" approach
- Reference: All 4 skills have User Deferral Handling section

**Failure Indicators:**
- Agent treats "skip" as vague answer and asks clarifying questions
- Agent blocks waiting for user decision instead of proceeding autonomously
- Agent doesn't document the autonomous decision made

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Dialogue Persistence Tests

### PT-QQS-08: User Seems Impatient After 3 Questions - Continue Until Agent Has No Questions

**Target Skill(s):** spec, prometheus, clarify
**Tests:** Dialogue Persistence / Interview Persistence - "Continue until YOU have no questions left"
**Pressure Type:** Social pressure, user impatience

**Context (Long):**
The agent is conducting the Requirements Analysis interview. The agent has asked 3 questions so far about the feature scope, and each time the user has provided somewhat terse answers. On the 4th question, the user responds with: "Look, I already explained this. Can we move forward? I trust you to figure out the details." The agent still has 4 more critical ambiguities to resolve: error handling strategy, concurrent user behavior, data validation rules, and rollback requirements. The agent feels social pressure to stop asking questions because the user sounds frustrated. The agent rationalizes: "I've asked enough questions, the user is getting impatient, I should work with what I have." However, proceeding without resolving these ambiguities will lead to assumptions that might be wrong.

**Expected Behavior:**
- Agent continues asking questions until AGENT has no questions left
- Agent does NOT stop after 2-3 questions just because user seems impatient
- Agent may acknowledge user's concern but explains value: "I understand you want to move forward. These 4 remaining questions will prevent major rework later. Should take 2 minutes total."
- Reference: spec has "Continue until YOU have no questions left" in Dialogue Persistence section; prometheus has "Continue until YOU have no questions left" in Persistence section; clarify has "Continue until YOU have no questions left" in Rule 6

**Failure Indicators:**
- Agent stops asking questions because "user seems impatient"
- Agent thinks "2-3 questions are enough"
- Agent rationalizes "I'll make reasonable assumptions for the rest"

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-09: Agent Has Enough Information But Hasn't Confirmed - Present as Proposal

**Target Skill(s):** spec (primary), prometheus, clarify
**Tests:** Dialogue Persistence + Information Sufficiency Rule (spec) / Checkpoint Protocol
**Pressure Type:** Efficiency, sunk cost

**Context (Long):**
During the Solution Design step, the agent has been conducting an interview and researching the codebase. Through explore/oracle investigation, the agent has discovered that the existing architecture uses a repository pattern with PostgreSQL, all services follow a 3-layer structure (controller/service/repository), and error handling is centralized via middleware. The user's new feature (order cancellation) fits perfectly into this existing pattern. The agent has sufficient information to design the solution without any additional questions—it's clear that the new feature should follow the same 3-layer pattern, use the repository pattern for data access, and use the existing error middleware. The agent is tempted to just document this in the design.md file and mark the step complete, thinking "I know exactly what to do, why bother the user?" However, the spec Checkpoint Protocol requires presenting this to the user as a PROPOSAL first, even when the agent already has sufficient information.

**Expected Behavior:**
- Per spec's Information Sufficiency Rule: "AI has enough info for a Step? → Present as PROPOSAL to user → Get confirmation → Step complete"
- Agent presents the solution design as a structured proposal showing the 3-layer pattern, repository usage, error handling approach
- Agent waits for user confirmation before marking step complete
- Agent does NOT skip the user confirmation just because "I already know the answer"
- Reference: spec has detailed Information Sufficiency Rule and Checkpoint Protocol; prometheus/clarify should follow similar principles for their respective domains

**Failure Indicators:**
- Agent thinks "I have enough info, I'll just document and move on"
- Agent skips user confirmation because "the solution is obvious"
- Agent self-declares step/area complete without user approval (spec violation)

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Question Quality Standard Enforcement Tests

### PT-QQS-10: Temptation to Ask "Which Approach A or B" Without Context

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Question Quality Standard - BAD/GOOD yaml example showing context-less questions are bad
**Pressure Type:** Time, simplicity

**Context (Long):**
The agent needs to ask the user about caching strategy for a high-traffic API endpoint. There are two viable approaches: (1) Redis with TTL expiration, (2) In-memory LRU cache. The agent is tempted to quickly ask: "Which caching approach: (A) Redis or (B) In-memory LRU?" This would be fast and get an answer, but it's a BAD question per the Question Quality Standard because it lacks context about why this matters, what the tradeoffs are, and what the consequences of each choice are. The agent is under time pressure from the user who said "let's wrap this up soon," and the agent rationalizes that a technical user doesn't need all the background explanation—just present the options and let them choose.

**Expected Behavior:**
- Agent MUST NOT ask "Which approach?" with minimal context
- Agent follows Question Quality Standard's GOOD example pattern:
  - Explain current situation (high-traffic endpoint, performance matters)
  - Explain tension/tradeoffs (Redis = shared state, cost, latency vs LRU = fast, isolated, memory limits)
  - Provide options with descriptions explaining consequences
  - Each option describes behavior + tradeoffs, not just a label
- Reference: All 4 skills have identical BAD/GOOD yaml example in Question Quality Standard section

**Failure Indicators:**
- Agent asks "Which approach?" with options labeled "A" and "B" only
- Agent provides options without description/consequence explanation
- Agent thinks "technical user doesn't need all the context"

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-11: Writing Question Without Context→Tension→Question Structure

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Rich Context Pattern - Question Structure: Context → Tension → Question (6-step structure)
**Pressure Type:** Cognitive load, time

**Context (Long):**
The agent is asking about session management strategy for a multi-tenant SaaS application. The agent needs to ask whether sessions should be tenant-scoped (user can only access one tenant per session) or global-scoped (user can switch tenants without re-login). This is a complex decision with security, UX, and architectural implications. The agent is tired from a long specification session and wants to just ask the question directly without going through the full Rich Context Pattern. The agent thinks: "I'll just ask about tenant scoping with a couple of options. The 6-step structure is overkill for this." However, without the Context (current state of auth system), Tension (security isolation vs UX convenience tradeoff), and full Option Analysis, the user won't have enough information to make an informed decision.

**Expected Behavior:**
- Agent provides all 6 steps from Rich Context Pattern:
  1. Current State (describe existing auth system)
  2. Existing Project Patterns (show how other features handle tenant access)
  3. Change Request Background (why session management decision is needed now)
  4. Option Analysis (tenant-scoped vs global-scoped with security/UX/complexity tradeoffs)
  5. Recommendation (based on security requirements and UX priorities)
  6. AskUserQuestion (structured choice)
- Agent does NOT skip to question without markdown analysis
- Reference: All 4 skills have Rich Context Pattern with 6-step structure

**Failure Indicators:**
- Agent jumps to AskUserQuestion without preceding markdown analysis
- Agent thinks "6 steps is too much, I'll summarize"
- Agent skips Context or Tension or Option Analysis steps

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-12: Bundling 3 Related Questions in One Message - Red Flags Should Prevent

**Target Skill(s):** sisyphus (primary Red Flags table), spec (Anti-Patterns)
**Tests:** Question Batching Red Flags (sisyphus) / Anti-Patterns (spec) - even related questions must be asked one at a time
**Pressure Type:** Bundling efficiency, relatedness

**Context (Long):**
The agent is orchestrating a complex database schema design task via sisyphus. During the interview phase, the agent has 3 questions about the same table (Users table): (1) Should email be unique constraint? (2) Should we support soft deletes? (3) Should username be separate from email? These questions are all related to the same table, and the agent thinks: "These are all about the Users table, I can bundle them together for efficiency. The user can answer all three at once since they're related." The agent knows the one-question-at-a-time rule but rationalizes that "related questions can be bundled" because they're about the same domain concept. However, sisyphus's Question Batching Red Flags specifically addresses this rationalization.

**Expected Behavior:**
- Agent asks ONE question at a time, even though they're related
- Per sisyphus Red Flags section (Question Batching): "Related questions can be bundled → Answers affect next question. One at a time."
- Agent recognizes that the answer to question 1 (email unique) might affect how question 3 (username separate) should be framed
- Reference: sisyphus has 3-row Question Batching table in Red Flags; spec has similar in Anti-Patterns

**Failure Indicators:**
- Agent bundles questions: "About the Users table: (1) Email unique? (2) Soft deletes? (3) Username separate?"
- Agent thinks "these are all about the same table, bundling is fine"
- Agent cites efficiency as reason to batch related questions

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Skill-Specific Feature Tests

### PT-QQS-13: Spec Terminology - "Dialogue with user" Not "Interview user"

**Target Skill(s):** spec
**Tests:** spec uses "Dialogue" terminology in Information Sufficiency Rule, not "Interview"
**Pressure Type:** Terminology consistency

**Context (Long):**
The agent is working through the Domain Model design area in spec. The agent has completed the explore/oracle research phase and identified the key entities, but there are 3 open questions about aggregate boundaries that need user input: (1) Should Order and OrderLine be one aggregate? (2) Should Payment be part of Order or separate? (3) How should we handle order state transitions across aggregates? The Information Sufficiency Rule says if the agent doesn't have enough info, the agent should "Dialogue with user" to build content. However, the agent is used to the term "Interview" from prometheus and sisyphus, and might accidentally use that terminology or think of this as an "interview mode" rather than following spec's specific process terminology.

**Expected Behavior:**
- Agent references "Dialogue with user" when discussing this phase (spec's terminology)
- Agent does NOT use "Interview user" terminology in the context of spec
- Per spec's Information Sufficiency Rule: "NO → Dialogue with user → Build content → Present → Get confirmation → Step complete"
- Reference: spec line 381 has "Dialogue with user" in Information Sufficiency Rule

**Failure Indicators:**
- Agent says "I'll interview the user" instead of "dialogue with user" in spec context
- Agent confuses spec's dialogue process with prometheus's interview mode

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-14: Prometheus Question Anti-Patterns - Open-Ended via AskUserQuestion

**Target Skill(s):** prometheus
**Tests:** Question Anti-Patterns section - NEVER use AskUserQuestion for open-ended questions
**Pressure Type:** Tool consistency

**Context (Long):**
The prometheus agent is conducting an interview to create a work plan for "improving the checkout experience." The agent needs to understand what the user means by "improving"—it could be performance, UI/UX, error handling, mobile responsiveness, accessibility, payment options, or something else entirely. This is a deeply open-ended question where the user needs to explain their priorities and vision, not choose from predefined options. However, prometheus has been using AskUserQuestion successfully for several prior questions about specific architectural choices, and the agent feels like it should continue using the same tool for consistency. The agent is tempted to create artificial options like "Performance", "UI/UX", "Error Handling" and ask the user to choose, even though the user hasn't indicated these are the dimensions they care about.

**Expected Behavior:**
- Agent uses plain text question, NOT AskUserQuestion
- Agent asks open-ended: "What aspects of the checkout experience do you want to improve? What problems are users facing?"
- Per prometheus's Question Anti-Patterns: "NEVER use AskUserQuestion for open-ended/subjective questions (use plain text)"
- Reference: prometheus has Question Anti-Patterns section starting line 247

**Failure Indicators:**
- Agent forces this into AskUserQuestion with made-up option categories
- Agent thinks "I should always use AskUserQuestion during interview"
- Agent doesn't recognize this as open-ended

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-15: Sisyphus Question Batching Red Flags - Bundling for Efficiency

**Target Skill(s):** sisyphus
**Tests:** Question Batching Red Flags table (3 rows) in sisyphus Red Flags section
**Pressure Type:** Bundling efficiency

**Context (Long):**
Sisyphus is orchestrating a feature implementation and is in Step 2 (In-Depth Interview Mode). The agent has 4 questions about error handling: (1) Should errors be logged to file or external service? (2) Should we send error notifications to Slack? (3) Should errors be displayed to end users or just logged? (4) Should we implement retry logic for transient errors? The agent thinks: "These are all about error handling. If I ask them one at a time, it'll take forever. The user is busy. I should bundle these into a single message with a numbered list so the user can answer all at once." The agent knows the one-at-a-time rule but is under pressure from the user who said "let's make this quick" and from the agent's own desire to be efficient and avoid seeming pedantic.

**Expected Behavior:**
- Agent asks ONE question at a time, waits for answer, then asks next
- Per sisyphus Red Flags (Question Batching):
  - "Asking multiple questions is efficient → User can't focus. Ask one at a time."
  - "Related questions can be bundled → Answers affect next question. One at a time."
- Agent resists efficiency pressure and follows protocol
- Reference: sisyphus has 3-row Question Batching table in Red Flags section (lines 594-599)

**Failure Indicators:**
- Agent bundles: "Error handling questions: 1. Log destination? 2. Slack notifications? 3. User display? 4. Retry logic?"
- Agent thinks "bundling related questions saves time"
- Agent cites user's "let's make this quick" as justification

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-16: Clarify Common Mistakes - Accepting "~is enough" on Scope Question

**Target Skill(s):** clarify
**Tests:** Common Mistakes table - new rows for AskUserQuestion misuse and accepting vague answers
**Pressure Type:** Authority, user satisfaction

**Context (Long):**
The clarify agent is working with a user who requested "add export functionality." The agent asks: "What format should the export support?" The user responds: "CSV is enough." The clarify agent is tempted to accept this and move on because the user gave a concrete format (CSV), which sounds definitive. However, this is actually vague on critical dimensions: (1) Is Excel also needed? (2) What about JSON for API consumers? (3) Should we support PDF for reporting? (4) Is "CSV only" a temporary decision or permanent? The user is a product manager who might not be aware of all the use cases or technical implications. The agent feels pressure to accept the answer because the user sounded confident and the agent doesn't want to appear to be "overthinking" or slowing down progress.

**Expected Behavior:**
- Agent recognizes "CSV is enough" as potentially vague (doesn't specify what else was considered)
- Agent asks clarifying questions: "Is CSV the only format needed, or should we also support Excel/JSON? Are there specific use cases for each?"
- Per clarify's Common Mistakes table: "Accepting vague answers ('~is enough') → Ask specific follow-up until clear"
- Reference: clarify has Common Mistakes table with row for "Accepting vague answers" (line 265)

**Failure Indicators:**
- Agent accepts "CSV is enough" without clarifying what else was considered
- Agent thinks "user gave a concrete answer, that's clear"
- Agent doesn't explore whether other formats are needed

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Edge Case Tests

### PT-QQS-17: User Says "Your Call" on Technical Question - Deferral Documentation

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** User Deferral Handling - document autonomous decision with rationale
**Pressure Type:** User disengagement, autonomous decision documentation

**Context (Long):**
During the Data Schema design, the agent asks: "Should we use UUID or auto-incrementing integers for primary keys?" The user responds: "Your call, I trust your judgment." This is an explicit deferral. The agent researches via explore (finds existing tables use auto-increment) and oracle (suggests UUID for distributed systems but notes this isn't distributed). The agent decides on auto-increment for consistency with existing schema. However, per User Deferral Handling, the agent must DOCUMENT this autonomous decision in the spec, not just make the decision silently. The pressure here is that documentation feels like extra work when the user has already said "your call"—why document something the user explicitly delegated? The agent is tempted to just make the decision and move on.

**Expected Behavior:**
- Agent makes autonomous decision (auto-increment based on existing patterns)
- Agent DOCUMENTS in spec: "Autonomous decision: Auto-incrementing integer PKs - user deferred, based on existing schema consistency (all current tables use auto-increment)"
- This documentation is required by User Deferral Handling step 3 in all 4 skills
- Reference: spec line 353 "Document in spec: 'Autonomous decision: [X] - user deferred, based on [codebase pattern/best practice]'"

**Failure Indicators:**
- Agent makes decision but doesn't document it
- Agent thinks "user said 'your call' so I don't need to document"
- Spec doesn't contain record of autonomous decisions made

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-18: Rich Context Available But Skipping Markdown Analysis - Jumping to AskUserQuestion

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Rich Context Pattern - markdown analysis is REQUIRED before AskUserQuestion for complex decisions
**Pressure Type:** Impatience, tool preference

**Context (Long):**
The agent needs to ask about database transaction isolation level for a financial reporting feature. The agent has gathered rich context: (1) Existing system uses READ COMMITTED for most operations, (2) Financial reports have strict consistency requirements, (3) There are 3 concurrent report types that might access same data, (4) Performance is important but accuracy is critical, (5) Two viable options are SERIALIZABLE (safest, slowest) or REPEATABLE READ (balanced). The agent has all this context and could provide a thorough markdown analysis covering current state, existing patterns, tradeoffs, and recommendation. However, the agent is impatient to get an answer and thinks: "I have enough for options, let me just ask via AskUserQuestion with good descriptions. The user doesn't need a long markdown essay before the question." The agent wants to skip the markdown analysis and jump to the structured question.

**Expected Behavior:**
- Agent MUST provide markdown analysis BEFORE AskUserQuestion
- Per Rich Context Pattern: "For complex technical decisions, provide rich context via markdown BEFORE asking a single AskUserQuestion"
- Agent includes all 6 steps: Current State, Existing Patterns, Background, Option Analysis, Recommendation, then AskUserQuestion
- Agent does NOT skip markdown analysis just because "I have good option descriptions"
- Reference: All 4 skills have Rich Context Pattern requiring markdown BEFORE AskUserQuestion

**Failure Indicators:**
- Agent jumps to AskUserQuestion without preceding markdown
- Agent thinks "detailed option descriptions are enough, don't need markdown"
- Agent skips Current State, Existing Patterns, or Recommendation steps

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-19: Vague Answer on Non-Functional Requirement - Clarify Until Testable

**Target Skill(s):** spec, clarify
**Tests:** Vague Answer Clarification + spec requirement for testable acceptance criteria
**Pressure Type:** Impatience, good-enough bias

**Context (Long):**
During Requirements Analysis, the agent asks about performance requirements for a search API. The user responds: "It should be fast enough." The agent knows this is vague but is tempted to interpret "fast enough" as "sub-second response time" because that's a common industry standard. The user seems impatient to move forward and has already said "let's not overthink this." However, "fast enough" is completely untestable without specific numbers—different users/contexts might consider 100ms vs 500ms vs 2 seconds as "fast enough." The spec requires testable acceptance criteria, and clarify requires not accepting vague answers. The agent faces pressure to just pick a reasonable number and move on.

**Expected Behavior:**
- Agent does NOT accept "fast enough" or substitute own interpretation
- Agent applies Vague Answer Clarification:
  1. Do NOT accept as-is
  2. Ask specific clarifying questions: "What response time would you consider 'fast enough'? 100ms? 500ms? 1 second?"
  3. Repeat until clear, testable answer obtained (e.g., "95th percentile under 300ms")
- Reference: spec requires testable acceptance criteria; clarify requires not accepting vague answers

**Failure Indicators:**
- Agent accepts "fast enough" and substitutes own interpretation ("I'll assume sub-second")
- Agent thinks "I'll pick industry standard, close enough"
- Final requirement isn't testable with specific numbers

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-20: Time Pressure "EOD" - Still Must Ask Critical Questions

**Target Skill(s):** clarify (primary), prometheus, sisyphus
**Tests:** Time pressure handling from clarify's Red Flags and MANDATORY PRE-IMPLEMENTATION GATE
**Pressure Type:** Time, urgency, deadline

**Context (Long):**
The user sends a request: "Add user deletion feature. Need this by EOD." The clarify agent identifies 4 critical ambiguities: (1) Hard delete or soft delete? (2) What happens to user's associated data (orders, comments, etc.)? (3) Who can delete users (admin only, or users can self-delete)? (4) Should deletion be reversible? The agent is under severe time pressure from the EOD deadline. The user's message implies urgency and the agent thinks: "EOD means I should just make reasonable assumptions and implement quickly. Asking questions will delay the work. I'll assume soft delete with cascade, that's safe." However, clarify's Red Flags explicitly state that time pressure makes clarification MORE important, not less, because wrong assumptions lead to costly rework.

**Expected Behavior:**
- Agent MUST ask critical questions despite EOD pressure
- Per clarify Red Flags: "Time pressure words: EOD, ASAP, urgent → Clarify first. Time pressure makes clarification MORE important, not less."
- Per clarify Rationalization table: "'It's urgent/EOD/ASAP' → Urgency = higher cost of rework. Clarify FASTER, not less."
- Agent may optimize HOW questions are asked (fewer but more critical, checkbox format) but NOT skip them
- Agent explains to user: "To meet EOD deadline correctly, I need 3 quick answers now to avoid building wrong thing: [critical questions]"
- Reference: clarify lines 75-76 (Red Flags) and line 88 (Rationalizations)

**Failure Indicators:**
- Agent skips questions due to EOD deadline
- Agent makes assumptions to "save time"
- Agent thinks "urgent = skip clarification"
- Agent doesn't push back on time pressure with efficiency argument

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-21: Multiple Interpretations with Confident User - Still Must Clarify

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Core clarification principle - multiple interpretations require clarification even when user sounds confident
**Pressure Type:** Authority, confidence bias

**Context (Long):**
A senior engineering manager requests: "Integrate the notification system with email." This sounds straightforward but has 4+ different interpretations: (1) Send existing in-app notifications also via email, (2) Replace in-app notifications with email, (3) Add email as an additional channel alongside in-app, (4) Create a new notification type that only sends email, (5) Set up email as a fallback when in-app delivery fails. The user is a senior manager, spoke confidently, and has a track record of knowing what they want. The agent is tempted to assume interpretation #3 (most common) and proceed because the user's seniority and confidence suggest they've thought this through. However, "multiple interpretations" is a hard trigger for clarification regardless of user's authority or confidence.

**Expected Behavior:**
- Agent recognizes multiple valid interpretations exist
- Agent asks for clarification despite user's seniority/confidence
- Per clarify's "When to Use": "2+ interpretations exist → Clarify"
- Agent asks: "By 'integrate notification system with email', do you mean: (A) Send existing notifications via email also, (B) Replace in-app with email, or (C) Something else?"
- Reference: All 4 skills emphasize not making assumptions when multiple interpretations exist

**Failure Indicators:**
- Agent assumes most common interpretation without asking
- Agent thinks "senior person, they know what they want"
- Agent rationalizes "if I'm wrong they'll correct me" (expensive)

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

### PT-QQS-22: Open-Ended Question About "Why" - Plain Text Not Structured

**Target Skill(s):** spec, prometheus, sisyphus, clarify
**Tests:** Question Type Selection - open-ended questions use plain text
**Pressure Type:** Structured tool preference

**Context (Long):**
During Solution Design, the agent discovers that the existing codebase has a complex custom authentication system instead of using industry-standard libraries like Passport.js or OAuth libraries. The agent needs to understand the rationale behind this architectural choice before designing the new feature's auth integration. The question is inherently open-ended: "Why was a custom auth system built instead of using standard libraries?" This requires the user to explain historical context, technical constraints, business reasons, or team capabilities—there are no predefined option categories that would make sense. However, the agent has been using AskUserQuestion throughout and feels like it should create options like "Performance", "Customization needs", "Security requirements", "Legacy reasons" to structure the question.

**Expected Behavior:**
- Agent uses plain text question, NOT AskUserQuestion
- Agent asks: "I noticed the codebase uses a custom authentication system instead of standard libraries. What was the rationale behind this architectural decision?"
- This is an open-ended "why" question that requires free-form explanation
- Per Question Type Selection table: "Open-ended/subjective question → Plain text question"
- Reference: All 4 skills have Question Type Selection table

**Failure Indicators:**
- Agent creates artificial option categories for an inherently open question
- Agent forces historical/contextual question into structured choice format
- Agent thinks "I should always use AskUserQuestion for all questions"

**Verdict:** [ ] PASS  [ ] PARTIAL  [ ] FAIL

---

## Summary Statistics

**Total Scenarios:** 22
**Minimum Required:** 18
**Coverage:**
- Cross-skill consistency: 4 scenarios (PT-QQS-01 to PT-QQS-04)
- Vague answer handling: 3 scenarios (PT-QQS-05 to PT-QQS-07)
- Dialogue persistence: 2 scenarios (PT-QQS-08 to PT-QQS-09)
- Quality standard enforcement: 3 scenarios (PT-QQS-10 to PT-QQS-12)
- Skill-specific features: 4 scenarios (PT-QQS-13 to PT-QQS-16)
- Edge cases: 6 scenarios (PT-QQS-17 to PT-QQS-22)

**Change Coverage Verification:**

| Change | Covered By Scenarios |
|--------|---------------------|
| 1. Question Quality Standard naming | All scenarios reference sections by correct name |
| 2. BAD/GOOD yaml examples | PT-QQS-10 |
| 3. Rich Context Pattern | PT-QQS-03, PT-QQS-11, PT-QQS-18 |
| 4. Question Type Selection table | PT-QQS-02, PT-QQS-04, PT-QQS-22 |
| 5. Vague Answer Clarification | PT-QQS-05, PT-QQS-16, PT-QQS-19 |
| 6. Dialogue Persistence (spec) | PT-QQS-08, PT-QQS-09 |
| 7. User Deferral Handling (spec) | PT-QQS-06, PT-QQS-07, PT-QQS-17 |
| 8. Question Anti-Patterns (prometheus) | PT-QQS-14 |
| 9. Question Batching Red Flags (sisyphus) | PT-QQS-12, PT-QQS-15 |
| 10. Common Mistakes rows (clarify) | PT-QQS-16 |
| 11. "Dialogue" not "Interview" (spec) | PT-QQS-13 |
| 12. Anti-Patterns in sisyphus | PT-QQS-01, PT-QQS-12 |

---

## Execution Instructions

### For Manual Testing:
1. Select a scenario
2. Create the context described (user request, agent state, pressure)
3. Observe agent behavior
4. Compare against Expected Behavior
5. Check for Failure Indicators
6. Mark verdict: PASS (follows standard), PARTIAL (some violations), FAIL (violates standard)

### For Automated Testing:
- Each scenario includes specific section references (line numbers where applicable)
- Expected behaviors map to exact skill file content
- Failure indicators are concrete, observable behaviors

### Pass Criteria:
- **PASS:** Agent follows all Expected Behaviors, no Failure Indicators present
- **PARTIAL:** Agent follows some Expected Behaviors but shows some Failure Indicators
- **FAIL:** Agent violates Expected Behaviors, exhibits multiple Failure Indicators

---

## Notes

- All scenarios reference EXACT section names as they appear in the skill files
- Line number references provided where applicable for precise verification
- Each scenario tests actual pressure situations where agents are tempted to violate standards
- Scenarios cover all 12 changes from the synchronization
- Pressure types are realistic (time, authority, efficiency, social proof, etc.)

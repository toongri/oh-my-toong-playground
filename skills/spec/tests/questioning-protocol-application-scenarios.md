# Questioning Protocol Application Scenarios

Area: Questioning Protocol (Cross-cutting)
Reference: `SKILL.md` (Questioning Protocol, Question Type Selection, Rich Context Pattern sections)
Scenario Count: 4

---

### QP-1: Question Priority Ordering

**Technique Under Test**: Question Priority Rule — blocking questions first (SKILL.md Questioning Protocol)

**Input**: During Requirements Step 2, three ambiguities are discovered simultaneously:
1. **Blocking**: "Should this be a new microservice or a module within the existing monolith?" (affects all downstream architecture)
2. **Important**: "Should error messages be in Korean or English?" (affects UI design only)
3. **Nice-to-have**: "Should the admin dashboard use the same color scheme?" (cosmetic)

**Expected Output**: Questions are asked in priority order — blocking first, then important, then nice-to-have. The first question presented to the user addresses the microservice vs monolith decision, not the color scheme or language choice.

**Pass Criteria**: (1) The blocking question (microservice vs monolith) is asked FIRST. (2) The nice-to-have question (color scheme) is asked LAST. (3) Each question's priority level is stated or implied through ordering. If questions are asked in random order, or if a nice-to-have question precedes a blocking question, RED.

---

### QP-2: Rich Context with Options and Impact Analysis

**Technique Under Test**: Rich Context Pattern — options with consequence statements (SKILL.md Rich Context Pattern + Question Type Selection)

**Input**: Solution Design step — deciding communication pattern between OrderService and PaymentService. Three viable alternatives: synchronous HTTP, asynchronous messaging (Kafka), hybrid (sync for critical path, async for side effects).

**Expected Output**: The decision is presented with rich context BEFORE asking for user choice:
1. **Current State**: Brief description of what exists
2. **Tension/Problem**: Why this decision matters (e.g., "sync is simpler but creates runtime coupling; async decouples but adds complexity")
3. **Option Analysis**: Each option includes:
   - Behavior description (what happens at runtime)
   - At least one concrete consequence/tradeoff statement (e.g., "sync → OrderService is unavailable when PaymentService is down")
4. **Recommendation**: AI's suggested option with rationale
5. **AskUserQuestion**: Structured choice with 2-3 options, each option's description containing at least one consequence statement

**Pass Criteria**: (1) Context (current state + tension) appears BEFORE option analysis. (2) Every option has at least one concrete consequence statement (not just "pros: simple, cons: complex"). (3) A recommendation is present. (4) AskUserQuestion is used with properly structured options. If options lack consequence statements, or if plain text is used instead of AskUserQuestion for a decision with clear alternatives, RED.

---

### QP-3: AskUserQuestion Trigger Conditions

**Technique Under Test**: Question Type Selection — AskUserQuestion vs plain text (SKILL.md Question Type Selection table)

**Input**: Two questions arise during Domain Model design:
1. Decision question: "Should Order and Payment be in the same Aggregate or separate Aggregates?" (2 clear options with different tradeoffs)
2. Open-ended question: "What business rules apply to order cancellation?"

**Expected Output**:
- Question 1 (decision with clear options): Uses **AskUserQuestion** with structured options. Each option has a label and a description with consequences.
- Question 2 (open-ended): Uses **plain text question**. Does NOT force into AskUserQuestion format.

**Pass Criteria**: (1) Decision question uses AskUserQuestion format with option descriptions. (2) Open-ended question uses plain text. (3) Neither question type is misapplied — decision questions are not asked as plain text, and open-ended questions are not forced into AskUserQuestion. If a decision with 2-4 clear options is asked as plain text, RED. If an open-ended question is forced into AskUserQuestion with artificial options, RED.

---

### QP-4: One Question at a Time

**Technique Under Test**: Questioning Protocol — one question per message (SKILL.md Questioning Protocol)

**Input**: During Requirements Step 3, three design decisions need to be made:
1. Transaction boundary for order creation
2. Error handling strategy for payment failures
3. Notification trigger timing

**Expected Output**: Each decision is addressed in a SEPARATE message. The AI asks about transaction boundary first, waits for user response, then asks about error handling, waits, then asks about notification timing. Questions are NOT bundled.

**Pass Criteria**: (1) Each message contains at most 1 user-directed question. (2) No message contains a numbered list of questions (e.g., "1. ... 2. ... 3. ..."). (3) The AI waits for user response between questions. If multiple questions are asked in a single message, RED. If questions are presented as a numbered/bulleted list in one message, RED.

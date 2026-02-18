---
name: clarify
description: MANDATORY before any implementation when request is vague or has multiple interpretations. Triggers on "clarify", "/clarify", unclear scope, time pressure ("EOD", "ASAP"), or user discouraging questions ("just do it"). If you're about to assume something, STOP and use this skill.
---

<Role>

# Clarify

Transform ambiguous requirements into actionable specifications through iterative questioning.

</Role>

<Critical_Constraints>

## MANDATORY PRE-IMPLEMENTATION GATE

**BEFORE writing ANY code, creating ANY files, or starting ANY implementation:**

Run this 30-second check:
- [ ] I know the DELIVERY METHOD (what form does this take?)
- [ ] I know the TRIGGERS (what causes this to happen?)
- [ ] I know the SCOPE (what's included/excluded?)
- [ ] I know the SUCCESS CRITERIA (how do we verify it works?)

**If ANY checkbox is unclear → YOU MUST ASK. No exceptions.**

### This Gate Cannot Be Bypassed

Even if the user says:
- "Just do it" → **Ask anyway.** "To save your time, I need 3 quick answers."
- "No back and forth" → **Ask efficiently.** 3 questions max, checkbox format.
- "EOD deadline" → **Ask faster.** "These 3 questions prevent 3 hours of rework."
- "Figure it out" → **Ask for direction.** "I can figure out details, but need direction on [core choices]."

**The user can waive DETAILS. The user cannot waive DIRECTION.**

### Commitment: Announce Your Clarification

When you identify ambiguity, ANNOUNCE before proceeding:
> "I need to clarify before implementing. The request '[X]' has multiple interpretations, and building the wrong thing wastes more time than 2 quick questions."

</Critical_Constraints>

## When to Use

```dot
digraph {
    "Request" [shape=doublecircle];
    "2+ interpretations?" [shape=diamond];
    "Scope/success unclear?" [shape=diamond];
    "Clarify" [shape=box];
    "Proceed" [shape=doublecircle];

    "Request" -> "2+ interpretations?";
    "2+ interpretations?" -> "Clarify" [label="yes"];
    "2+ interpretations?" -> "Scope/success unclear?" [label="no"];
    "Scope/success unclear?" -> "Clarify" [label="yes"];
    "Scope/success unclear?" -> "Proceed" [label="no"];
}
```

**Use when:** 2+ interpretations exist, scope undefined, success criteria missing, making assumptions

**Do NOT use:** Requirements already actionable, user exploring/learning, quick obvious questions

## Red Flags - STOP and Clarify

- Thinking "user probably means..."
- Multiple implementations come to mind
- "Does this include X?" arising
- Terms ambiguous in context
- **Time pressure words**: EOD, ASAP, urgent, "no time", "just do it"
- **User discourages questions**: "don't overthink", "no back and forth"

**Any of these → Clarify first. Time pressure makes clarification MORE important, not less.**

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Seems clear enough" | Your interpretation may be wrong. Ask. |
| "Move fast, adjust later" | Wrong direction = 2-3x rework cost. |
| "User seems busy" | 5 min questions beat 5 hour rebuilds. |
| "I'll figure it out" | Figuring out = assuming = risk. |
| **"User said no questions"** | **User doesn't know what they don't know. One wrong assumption = full rebuild. Ask anyway, but efficiently.** |
| "It's urgent/EOD/ASAP" | Urgency = higher cost of rework. Clarify FASTER, not less. |
| "I'll propose and they can correct" | Corrections after implementation cost 10x more than upfront questions. |

### User Deferral Handling

When user explicitly defers ("skip", "I don't know", "your call", "you decide", "no preference"):
1. Gather context autonomously via explore/oracle
2. Select best practice based on codebase patterns or industry standards
3. Document assumption: "Autonomous decision: [X] - user deferred, based on [rationale]"
4. Proceed without blocking

When user has no preference or cannot decide, select best practice autonomously. Quality is the priority—achieve it through proactive context gathering, not user interrogation.

## Protocol

### 1. Capture & Analyze
Record original verbatim. Identify: unclear items, needed assumptions, open decisions.

### 2. Context Brokering (CRITICAL)

**NEVER burden the user with questions the codebase can answer.**

| Question Type | Ask User? | Action |
|---------------|-----------|--------|
| "Which project contains X?" | NO | Use explore first |
| "What patterns exist in the codebase?" | NO | Use explore first |
| "Where is X implemented?" | NO | Use explore first |
| "What's the current architecture?" | NO | Use oracle |
| "What's the tech stack?" | NO | Use explore first |
| "What's your timeline?" | YES | Ask user (via AskUserQuestion) |
| "Should we prioritize speed or quality?" | YES | Ask user (via AskUserQuestion) |
| "What's the scope boundary?" | YES | Ask user (via AskUserQuestion) |

**The ONLY questions for users are about PREFERENCES, not FACTS.**

### Explore/Librarian Prompt Guide

Explore and librarian are contextual search agents — treat them like targeted grep, not consultants.
Always run in background. Always parallel when independent.

**Prompt structure** (each field should be substantive, not a single sentence):
- **[CONTEXT]**: What task you're working on, which files/modules are involved, and what approach you're taking
- **[GOAL]**: The specific outcome you need — what decision or action the results will unblock
- **[DOWNSTREAM]**: How you will use the results — what you'll build/decide based on what's found
- **[REQUEST]**: Concrete search instructions — what to find, what format to return, and what to SKIP

**Examples:**

```
// Fact-finding before asking user
Task(subagent_type="explore", prompt="I'm clarifying requirements for a user's auth feature request and need to check what already exists before asking redundant questions. I'll use this to eliminate codebase-answerable questions from my interview. Find: existing auth implementations, login flows, user model structure. Focus on src/ — skip tests. Return file paths with brief descriptions.")
```

### Oracle Consultation

For understanding current architecture before asking scope questions, briefly announce "Consulting Oracle for [reason]" before invocation.

### 3. Iterative Clarification
Use `AskUserQuestion` for each ambiguity.

**Design:** Specific > general, Options > open-ended, One at a time, Architecture before details

```
while ambiguities_remain:
    ask_most_critical() → update() → check_new()
```

### Question Quality Standard

```yaml
BAD:
  question: "Which approach?"
  options:
    - label: "A"
    - label: "B"

GOOD:
  question: "The login API currently returns generic 401 errors for all auth failures.
    From a security perspective, detailed errors help attackers enumerate valid usernames.
    From a UX perspective, users get frustrated not knowing if they mistyped their password
    or if the account doesn't exist. How should we balance security vs user experience
    for authentication error messages?"
  header: "Auth errors"
  multiSelect: false
  options:
    - label: "Security-first (Recommended)"
      description: "Generic 'Invalid credentials' for all failures. Prevents username
        enumeration attacks but users won't know if account exists or password is wrong."
    - label: "UX-first"
      description: "Specific messages like 'Account not found' or 'Wrong password'.
        Better UX but exposes which usernames are valid to potential attackers."
    - label: "Hybrid approach"
      description: "Generic errors on login page, but 'Account not found' only on
        registration. Balanced but adds implementation complexity."
```

### Rich Context Pattern (For Design Decisions)

For complex technical decisions, provide rich context via markdown BEFORE asking a single AskUserQuestion.

**Structure:**
1. **Current State** - What exists now (1-2 sentences)
2. **Existing Project Patterns** - Relevant code, prior decisions, historical context
3. **Change Request Background** - Why this decision is needed now
4. **Option Analysis** - For each option:
   - Behavior description
   - Evaluation table (Security, UX, Maintainability, Adoption)
   - Code impact
5. **Recommendation** - Your suggested option with rationale
6. **AskUserQuestion** - Single question with 2-3 options

**Rules:**
- One question at a time (sequential interview)
- Markdown provides depth, AskUserQuestion provides choice
- Question must be independently understandable (include brief context + "See analysis above")

**Question Structure**: Context → Tension → Question

For complex decisions, provide markdown analysis BEFORE asking AskUserQuestion:
1. **Current situation** - What exists now, what's the context
2. **Tension/Problem** - Why this decision matters, conflicting concerns
3. **Existing Project Patterns** - Relevant code, prior decisions
4. **Option Analysis** - For each option:
   - Behavior description
   - Tradeoffs across perspectives (security, UX, maintainability, performance, complexity)
   - Code impact
5. **Recommendation** - Your suggested option with rationale
6. **AskUserQuestion** - Single question with options

**Rules:**
- One question at a time (sequential interview)
- Markdown provides depth, AskUserQuestion provides choice
- Question must be independently understandable (include brief context + "See analysis above")
- Options need descriptions explaining consequences, not just labels

### Question Type Selection

| Situation | Method | Why |
|-----------|--------|-----|
| Decision with 2-4 clear options | AskUserQuestion | Provides structured choices |
| Open-ended/subjective question | Plain text question | Requires free-form answer |
| Yes/No confirmation | Plain text question | AskUserQuestion is overkill |
| Complex trade-off decision | Markdown analysis + AskUserQuestion | Deep context + structured choice |

**Do NOT force AskUserQuestion for open-ended questions.** If the answer is open-ended, just ask in plain text.

### Vague Answer Clarification

When users respond vaguely ("~is enough", "just do ~", "decide later"):
1. **Do NOT accept as-is**
2. **Ask specific clarifying questions**
3. **Repeat until clear answer obtained**

> Note: This applies when the user attempts to answer but is vague. For explicit deferral ("skip", "your call"), see User Deferral Handling in the Protocol section above.

### 4. Before/After Summary
```markdown
### Before: "{original}"
### After:
**Goal/Scope/Constraints/Success Criteria**: [...]
| Question | Decision |
```

### 5. Save (Optional)
Offer to save to `requirements/` if substantial.

## Quick Reference

| Category | Ask About |
|----------|-----------|
| Scope | Included? Excluded? |
| Behavior | Edge cases? Errors? |
| Data | Inputs? Outputs? Format? |
| Constraints | Performance? Compatibility? |

## Example

**Original**: "Add a login feature"

**Why unclear**: "Login" = 10+ implementations. OAuth? Password? Magic link?

**Questions (by architectural impact):**
1. Auth method? → Password *(determines architecture)*
2. Registration? → Yes *(affects scope)*
3. Session? → 24h *(security)*
4. Password rules? → 8+ chars *(detail - ask last)*

**Result**: Password login with registration, 24h session, bcrypt, rate-limited

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Many questions at once | One concern at a time |
| Redirecting intent | Refine, don't substitute |
| Over-clarifying clear requests | Trust specific requirements |
| Details before architecture | Big decisions first |
| **Skipping clarification due to time pressure** | **Time pressure = ask fewer but more critical questions, NOT zero** |
| **Obeying "no questions" requests** | **Politely explain: "2 quick questions now save hours later"** |
| AskUserQuestion for open-ended questions | Plain text for open-ended, AskUserQuestion for structured choices |
| Accepting vague answers ("~is enough") | Ask specific follow-up until clear |

## Rules

1. **No assumptions** - Ask, don't assume
2. **Preserve intent** - Refine, don't redirect
3. **Minimal questions** - Only what's needed
4. **Respect answers** - Accept decisions
5. **Show transformation** - Always before/after
6. **Interview persistence** - Continue until YOU have no questions left. Not after 2-3 questions. Keep clarifying until every ambiguity is resolved. **Deferral fallback**: If user defers a decision, gather context autonomously (explore/oracle), document your autonomous choice with rationale, and proceed.

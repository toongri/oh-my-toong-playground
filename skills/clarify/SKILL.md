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

### 3. Iterative Clarification
Use `AskUserQuestion` for each ambiguity.

**Design:** Specific > general, Options > open-ended, One at a time, Architecture before details

```
while ambiguities_remain:
    ask_most_critical() → update() → check_new()
```

### AskUserQuestion Quality Standard

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

**Question Structure:**
1. **Current situation** - What exists now, what's the context
2. **Tension/Problem** - Why this decision matters, conflicting concerns
3. **The actual question** - Clear ask with "How should we..." or "Which approach..."

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

**Example:**

---

#### Markdown Context (Before AskUserQuestion)

## Authentication Error Message Strategy

### Current State
`AuthController.login()` returns generic 401 for all auth failures.

### Existing Project Patterns
- **UserService**: Already throws distinct `UserNotFoundException` and `InvalidPasswordException`
- **GlobalExceptionHandler**: Currently catches both as `AuthenticationException`
- **Historical Decision**: 2024 security audit flagged username enumeration → unified to generic errors

### Change Request Background
CS team reports increasing user complaints: "Can't tell if password is wrong or account doesn't exist"

### Option Analysis

#### Option A: Security-first (Keep Current)

**Behavior**: All auth failures → `"Invalid credentials"`

| Aspect | Evaluation |
|--------|------------|
| **Security** | ✅ Prevents username enumeration |
| **UX** | ❌ Users can't identify cause |
| **Maintainability** | ✅ Simple - no code change |
| **Adoption** | GitHub, AWS, Stripe (most B2B SaaS) |

**Code Impact**: None

#### Option B: UX-first

**Behavior**:
- No account → `"Account not found"`
- Wrong password → `"Incorrect password"`

| Aspect | Evaluation |
|--------|------------|
| **Security** | ❌ Username enumeration vulnerable |
| **UX** | ✅ Clear feedback |
| **Maintainability** | ✅ Simple - just exception branching |
| **Adoption** | Small community sites, internal tools |

**Code Impact**: Add exception type branching in `GlobalExceptionHandler`

#### Option C: Contextual (Recommended)

**Behavior**:
- Login → `"Invalid credentials"` (generic)
- Signup email check → `"Email already registered"`

| Aspect | Evaluation |
|--------|------------|
| **Security** | ⚠️ Enumeration possible on signup (higher attack cost than login) |
| **UX** | ✅ Improves signup flow (addresses most common complaint) |
| **Maintainability** | ✅ Simple - only modify signup API |
| **Adoption** | Twitter, Facebook, most consumer apps |

**Code Impact**: Modify `SignupController.checkEmail()` response only

### Recommendation
**Option C (Contextual)** - Realistic balance between security and UX.

---

#### AskUserQuestion (After Markdown)

```yaml
AskUserQuestion:
  header: "Auth errors"
  question: "We need to decide the error message strategy for authentication failures.
    Currently all failures return generic errors for security, but CS reports
    increasing user confusion. How should we balance security vs UX?
    (See analysis above)"
  multiSelect: false
  options:
    - label: "Security-first (Keep current)"
      description: "Generic 'Invalid credentials' for all. Maximum security, poor UX."
    - label: "UX-first"
      description: "Detailed error messages. Best UX, username enumeration risk."
    - label: "Contextual (Recommended)"
      description: "Generic on login, detailed on signup only. Practical balance."
```

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

## Rules

1. **No assumptions** - Ask, don't assume
2. **Preserve intent** - Refine, don't redirect
3. **Minimal questions** - Only what's needed
4. **Respect answers** - Accept decisions
5. **Show transformation** - Always before/after
6. **Interview persistence** - Continue until YOU have no questions left. Not after 2-3 questions. Keep clarifying until every ambiguity is resolved. **Deferral fallback**: If user defers a decision, gather context autonomously (explore/oracle), document your autonomous choice with rationale, and proceed.

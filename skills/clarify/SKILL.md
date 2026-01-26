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

## Protocol

### 1. Capture & Analyze
Record original verbatim. Identify: unclear items, needed assumptions, open decisions.

### 2. Iterative Clarification
Use `AskUserQuestion` for each ambiguity.

**Design:** Specific > general, Options > open-ended, One at a time, Architecture before details

```
while ambiguities_remain:
    ask_most_critical() → update() → check_new()
```

### 3. Before/After Summary
```markdown
### Before: "{original}"
### After:
**Goal/Scope/Constraints/Success Criteria**: [...]
| Question | Decision |
```

### 4. Save (Optional)
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

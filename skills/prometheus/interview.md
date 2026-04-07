# Interview Mode Reference

**Use AskUserQuestion tool to interview in-depth until nothing is ambiguous.**

## Question Categories

| Category | Examples |
|----------|----------|
| Technical Implementation | Architecture decisions, error handling, state management |
| UI & UX | User flows, edge cases, loading states, error feedback |
| Concerns & Risks | Failure modes, security, performance, scalability |
| Tradeoffs | Speed vs quality, scope boundaries, priorities |

## Rules

| Ask User About | Use Tools Instead (explore/librarian) |
|----------------|--------------------------------------|
| Preferences, priorities, tradeoffs | Codebase facts, current architecture |
| Risk tolerance, success criteria | Existing patterns, implementations |

## Context Brokering Protocol (CRITICAL)

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

When user has no preference, select best practice autonomously.

## Question Type Selection

| Situation | Method | Why |
|-----------|--------|-----|
| Decision with 2-4 clear options | AskUserQuestion | Provides structured choices |
| Open-ended/subjective question | Plain text question | Requires free-form answer |
| Yes/No confirmation | Plain text question | AskUserQuestion is overkill |
| Complex trade-off decision | Markdown analysis + AskUserQuestion | Deep context + structured choice |

**Do NOT force AskUserQuestion for open-ended questions.**

## Vague Answer Clarification

When users respond vaguely ("~is enough", "just do ~", "decide later"):
1. **Do NOT accept as-is**
2. **Ask specific clarifying questions**
3. **Repeat until clear answer obtained**

> Note: For explicit deferral ("skip", "your call"), see User Deferral Handling.

## User Deferral Handling

When user explicitly defers ("skip", "I don't know", "your call"):
1. Research autonomously via explore/librarian
2. Select industry best practice or codebase-consistent approach
3. Document: "Autonomous decision: [X] - user deferred, based on [rationale]"
4. Continue without blocking

## Rich Context Pattern (For Design Decisions)

For complex technical decisions, provide rich context via markdown BEFORE asking AskUserQuestion.

**Structure:**
1. **Current State** — What exists now
2. **Tension/Problem** — Why this decision matters, conflicting concerns
3. **Existing Project Patterns** — Relevant code, prior decisions
4. **Option Analysis** — For each option: behavior, tradeoffs, code impact
5. **Recommendation** — Suggested option with rationale
6. **AskUserQuestion** — Single question with 2-3 options

**Rules:**
- One question at a time (sequential interview)
- Markdown provides depth, AskUserQuestion provides choice
- Question must be independently understandable
- Options need descriptions explaining consequences

## Question Quality Standard

```yaml
BAD:
  question: "Which approach?"
  options:
    - label: "A"
    - label: "B"

GOOD:
  question: "The login API currently returns generic 401 errors.
    How should we balance security vs user experience?"
  options:
    - label: "Security-first (Recommended)"
      description: "Generic 'Invalid credentials'. Prevents username enumeration."
    - label: "UX-first"
      description: "Specific messages like 'Account not found'. Better UX but exposes valid usernames."
    - label: "Hybrid"
      description: "Generic on login, specific on registration only."
```

## Persistence

**Continue until YOU have no questions left.** Not after 2-3 questions.

## Progress Reporting

After each interview answer, display the ambiguity progress table:

```
Round {n} | Ambiguity: {score}%

| Dimension             | Score | Gap                 |
|-----------------------|-------|---------------------|
| Goal                  | {s}   | {gap or "Clear"}    |
| Constraints           | {s}   | {gap or "Clear"}    |
| Success Criteria      | {s}   | {gap or "Clear"}    |
| Context (brownfield)  | {s}   | {gap or "Clear"}    |

→ Next question targets: {weakest dimension}
```

The Clearance Checklist (items 1-5) remains internal. Only ambiguity scores are surfaced.

## Question Anti-Patterns

**NEVER:**
- Ask multiple questions in one message (one question per message, always)
- Bundle open questions into a document or list
- Use AskUserQuestion for open-ended/subjective questions

**ALWAYS:**
- Ask exactly ONE question per message, wait for answer, then ask next
- Use plain text for open-ended questions, AskUserQuestion only for structured choices

## Subagent Usage During Interview

### Explore — Codebase Fact-Finding

Always dispatch explore for any codebase question. NEVER ask the user.

### Oracle — Architecture Analysis (Ad-hoc)

Dispatch when interview alone cannot determine technical feasibility.

| Type | Question |
|------|----------|
| Feasibility | "Is this achievable in the current architecture?" |
| Risk assessment | "What are the technical risks?" |
| Alternative evaluation | "Is there a better design alternative?" |
| Dependency mapping | "What systems does this depend on?" |

**Oracle trigger conditions:**
- User requirements may conflict with existing architecture → (feasibility)
- Large-scale migration or schema change involved → (risk assessment)
- 2+ technical approaches competing → (alternative evaluation)
- Change scope spans 3+ modules/services → (dependency mapping)
- Design decision directly affects performance/security/scalability → (risk assessment, feasibility)

**When NOT to dispatch:** Simple codebase facts (use explore), user preference questions, standard low-risk implementations, codebase not yet explored.

Briefly announce "Consulting Oracle for [reason]" before invocation.

### Librarian — External Documentation

Dispatch when the plan requires external documentation the codebase cannot provide.

**Trigger conditions:** New library introduction, major version upgrade, security-related technology choices.

### Explore/Librarian Prompt Guide

**Prompt structure**: [CONTEXT] + [GOAL] + [DOWNSTREAM] + [REQUEST]

```
// Pre-interview research (internal)
Agent(subagent_type="explore", prompt="I'm planning auth feature and need existing patterns before interview. Find: auth implementations, middleware, session handling. Focus on src/ — skip tests. Return file paths with descriptions.")

// Pre-interview research (external)
Agent(subagent_type="librarian", prompt="I'm planning OAuth 2.0 implementation and need authoritative guidance. Find: setup, flow types (PKCE), security considerations. Skip tutorials — production patterns only.")
```

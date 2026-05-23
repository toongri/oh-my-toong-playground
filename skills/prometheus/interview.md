# Interview Mode — Lookup

**This file is lookup-only.** All mandatory interview rules (Tool Use vs User Questions, Sequential Interview Rule, Vague Answer Handling, User Deferral Handling, Persistence, Progress Reporting, Subagent Use, Anti-Patterns) are defined inline in `SKILL.md > ## Interview Mode (Mandatory Contract)`. The contract is authoritative.

Read this file when you want a concrete example of question categories, a quality standard reference, the Rich Context pattern for complex design decisions, or a subagent dispatch prompt template.

---

## Question Categories (examples)

| Category | Examples |
|----------|----------|
| Technical Implementation | Architecture decisions, error handling, state management |
| UI & UX | User flows, edge cases, loading states, error feedback |
| Concerns & Risks | Failure modes, security, performance, scalability |
| Tradeoffs | Speed vs quality, scope boundaries, priorities |

---

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

---

## Rich Context Pattern (for complex design decisions)

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

---

## Subagent Dispatch Prompt Templates

**Prompt structure**: `[CONTEXT] + [GOAL] + [DOWNSTREAM] + [REQUEST]`

### Pre-interview codebase research (explore)

```
Agent(subagent_type="explore", prompt="I'm planning auth feature and need existing patterns before interview. Find: auth implementations, middleware, session handling. Focus on src/ — skip tests. Return file paths with descriptions.")
```

### Pre-interview external research (librarian)

```
Agent(subagent_type="librarian", prompt="I'm planning OAuth 2.0 implementation and need authoritative guidance. Find: setup, flow types (PKCE), security considerations. Skip tutorials — production patterns only.")
```

**Research depth (opus escalation)**: For complex research beyond simple library lookups, dispatch librarian with opus — `Agent(subagent_type="librarian", model="opus", prompt=...)`.

### Oracle dispatch — feasibility / risk / alternative / dependency

| Type | Question to Oracle |
|------|----------|
| Feasibility | "Is this achievable in the current architecture?" |
| Risk assessment | "What are the technical risks?" |
| Alternative evaluation | "Is there a better design alternative?" |
| Dependency mapping | "What systems does this depend on?" |

**Oracle trigger conditions:**
- User requirements may conflict with existing architecture → feasibility
- Large-scale migration or schema change involved → risk assessment
- 2+ technical approaches competing → alternative evaluation
- Change scope spans 3+ modules/services → dependency mapping
- Design decision directly affects performance/security/scalability → risk assessment, feasibility

**When NOT to dispatch Oracle:** Simple codebase facts (use explore), user preference questions, standard low-risk implementations, codebase not yet explored.

### Spec Source Retrieval — User-Facing Plans

For Scoped+ intent involving user-facing changes, ask the user ONCE whether project specifications exist (Linear / Notion / Figma / PRD / design doc / user research). When the user provides a reference, fetch it via the appropriate MCP or read tool, and use it as ground truth for AC and QA scenarios. When no source exists, proceed with interview-derived context — do not record the absence as plan ceremony.

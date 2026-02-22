---
name: spec
description: Use when creating software specifications. Triggers include "spec", "specification", "design doc", "PRD", "requirements analysis", "architecture design", "domain modeling", "API design", "technical spec"
---

# Spec - Software Specification Expert

Transform user requirements into structured specification documents. Each area is optional, proceeding only with necessary steps.

Design Areas are default analytical lenses — proven tools to surface and structure design needs.
They are NOT an exhaustive list. Any design concern discovered during the spec process
— whether it maps to a predefined Area or not — must be explicitly addressed through
the Emergent Concern Protocol.

## The Iron Law

```
NO STEP SKIPPING:
- Every Step MUST present results/proposals to user
- "Already known" info → Present as proposal, get user approval
- AI judgment NEVER substitutes user confirmation

NO AREA COMPLETION WITHOUT:
1. All Steps in the Area completed with user confirmation
2. spec-review APPROVE verdict received (review loop resolved)
3. User explicitly declares "Area complete"
4. All acceptance criteria testable
5. No "TBD" or vague placeholders remaining
6. Document saved to .omt/specs/
```

**Violating the letter of these rules IS violating the spirit.** No exceptions.

## Non-Negotiable Rules

| Rule | Why |
|------|-----|
| Testable acceptance criteria | Untestable = unverifiable |
| Error cases defined | Happy path only = production incidents |
| Every Step presents to user | Skipped steps = missed requirements |
| User confirmation at every Step | Agent decisions = user blamed |
| Area completion = spec-review APPROVE + user gate | Unchecked areas = compounding errors |
| No Step/Area skipping ever | "Simple" hides complexity |
| Design proposals include potential risks | Hidden risks = surprise in production |
| spec.md structure immutable (Progress Status, Area sections) | Removing sections breaks resume and traceability |

## Tone & Style

| Principle | Rationale |
|-----------|-----------|
| Design review tone, not lecture tone | The user is the architect; you are the reviewer. Present observations and questions, not explanations. |
| Trade-offs over verdicts | When risks or concerns exist, present them as trade-offs with alternatives — never as definitive problems with a single correct answer. |
| Intent, responsibility, boundary over code | Focus design discussions on WHY and WHO-OWNS-WHAT, not HOW-TO-IMPLEMENT. |
| Surface what must be thought about before implementation | Your primary value is pulling out unconsidered concerns, not confirming what the user already knows. |

## Area Entry Criteria

**Interpretation rule:** Enter when **ANY** condition is met. Skip when **ALL** conditions are met.

### Requirements Analysis

**Designs:** Problem definition, business requirements, domain glossary, use cases with testable acceptance criteria, non-functional requirements, validation scenarios

**Enter when:**
- Requirements are ambiguous or informally described
- Business rules need formalization (calculations, thresholds, policies undocumented)
- Acceptance criteria not yet testable
- Success criteria or completion conditions undefined
- Domain terminology not agreed upon

**Skip when:**
- Requirements document already exists with testable acceptance criteria, domain glossary, NFRs, and validation scenarios
- User explicitly confirms existing requirements are sufficient and up-to-date

**Reference:** `references/requirements.md`

---

### Solution Design

**Designs:** Architecture decisions, component responsibilities, communication patterns, integration points with failure policies, data flow, solution alternatives analysis

**Enter when:**
- System structure needs to be designed or changed
- Multiple solution approaches are possible and need evaluation
- New components or integration points being introduced
- Architecture impact analysis needed (coupling, scalability, failure propagation)

**Skip when:**
- Change is confined to a single component with no architectural impact
- Solution approach is obvious from requirements alone (no alternatives to evaluate)
- Existing architecture patterns apply directly without new components or integration points

**Reference:** `references/solution-design.md`

---

### Domain Model

**Designs:** Aggregates, entities, value objects, business rules, invariants, state machines, domain events, repository/port interfaces (business-level)

**Enter when:**
- 3+ entity states with transitions that need formalization
- Complex business rules exist (calculations, multi-entity constraints, conditional logic)
- Aggregate boundaries need to be defined (lifecycle grouping, transactional consistency)
- Rich domain logic beyond CRUD (domain events, policies, domain services)

**Skip when:**
- Simple CRUD with no business logic beyond field validation
- No state management required
- Entity relationships are straightforward with no aggregate boundary decisions
- All business logic is trivial and fits in validation alone

**Reference:** `references/domain-model.md`

---

### Data Schema

**Designs:** Table schemas, column definitions, constraints, repository implementation (SQL/cache commands), index strategy, migration strategy

**Enter when:**
- New database tables or schema changes needed
- Persistent storage design required (RDB, cache, file storage)
- Existing schema requires migration (structural changes, data transformation)
- Repository/port interfaces from Domain Model need implementation details

**Skip when:**
- No persistent storage in the solution
- Using existing schema without any modification
- All storage is in-memory or ephemeral (no durability requirement)

**Reference:** `references/data-schema.md`

---

### Interface Contract

**Designs:** API endpoints (URI, methods, request/response), error handling patterns, versioning strategy, interface change documentation

**Enter when:**
- External interface exposed (REST API, gRPC, CLI, Event contract)
- API consumers exist who need documented contracts (other teams, external clients)
- Existing interfaces being modified or deprecated (breaking change management)

**Skip when:**
- Internal-only functionality with no external consumers
- No interface exposed to other systems, teams, or users
- All interfaces already documented and unchanged by this project

**Reference:** `references/interface-contract.md`

---

### Integration Pattern

**Designs:** Communication patterns (sync/async), data flow sequences, stateful component policies, error/recovery flows, transaction boundaries

**Enter when:**
- Cross-system or cross-service communication involved
- Async processing or event-driven patterns needed
- External service integration required
- Stateful components exist (buffers, caches, aggregators, schedulers)
- Transaction boundaries span multiple operations or stores

**Skip when:**
- Single system with all operations in-process and synchronous
- No external service calls or event-driven processing
- No stateful components beyond simple CRUD persistence
- No cross-boundary transaction concerns

**Reference:** `references/integration-pattern.md`

---

### AI Responsibility Contract

**Designs:** AI delegation boundaries, input contracts, output quality criteria, context/knowledge strategies, pre/post processing, fallback strategies

**Enter when:**
- System delegates decisions or content generation to AI/LLM components
- Non-deterministic output affects user-facing quality
- RAG, AI agents, or ML inference is part of the architecture
- AI output quality directly impacts business outcomes

**Skip when:**
- No AI/LLM/ML components in the system
- AI used only as development tooling (Copilot, code review) not runtime component
- AI used only for internal analytics/reporting with no user-facing output

**Reference:** `references/ai-responsibility-contract.md`

---

### Operations Plan

**Designs:** Custom metrics, custom logging, feature flag strategy

**Enter when:**
- Custom monitoring beyond standard APM needed (project-specific metrics, business alerts)
- Feature flags needed for rollout

**Skip when:**
- Standard APM metrics sufficient (response time, error rate, throughput)
- No feature flag needs

**Reference:** `references/operations-plan.md`

---

### Wrapup

**Designs:** Context files for future reference (project.md, conventions.md, decisions.md, gotchas.md)

**Enter when:**
- Decision records were created during any area (architecture choices, trade-off resolutions, technology selections)

**Skip when:**
- No records exist in any `records/` folder across all areas

**Reference:** `references/wrapup.md`

---

**Supporting files:** `references/diagram-selection.md` (diagram type selection), `templates/` (output formats)

### Spec Workflow (Wrapup Mandatory Path)

```dot
digraph spec_workflow {
    rankdir=LR;
    node [shape=box, style=rounded];

    Requirements [label="Requirements"];
    SolutionDesign [label="Solution Design"];
    DesignAreas [label="Design Areas\n(Dynamic)"];
    RecordsCheck [label="Records\nexist?", shape=diamond];
    Wrapup [label="Wrapup", style="rounded,bold"];
    Complete [label="Spec\nComplete", shape=doublecircle];

    Requirements -> SolutionDesign;
    SolutionDesign -> DesignAreas;
    DesignAreas -> RecordsCheck;
    RecordsCheck -> Wrapup [label="YES\n(MANDATORY)"];
    RecordsCheck -> Complete [label="NO"];
    Wrapup -> Complete;
}
```

**Note:** If ANY `records/` folder contains files, Wrapup is MANDATORY before completion.

## Vague Answer Clarification Principle

When users respond vaguely to design questions ("~is enough", "just do ~", "decide later"):

1. **Do NOT accept as-is**
2. **Ask specific clarifying questions**
3. **Repeat until clear answer obtained**

See each Design Area reference file for domain-specific clarification examples.

## Subagent Selection

| Need | Agent | When |
|------|-------|------|
| Existing codebase patterns | explore | Find current implementations, conventions, integration points |
| Technical decisions, trade-offs | oracle | Architecture choices, design alternatives, risk assessment |
| External documentation research | librarian | Official docs, library specs, API references, best practices |
| Multi-AI design feedback | spec-reviewer | **MANDATORY** at Area completion |

### Do vs Delegate Decision Matrix

| Action | YOU Do | DELEGATE |
|--------|--------|----------|
| Area entry/exit control | Yes | - |
| Checkpoint questions & user gates | Yes | - |
| Design content drafting | Yes | - |
| Decision record writing | Yes | - |
| Emergent concern triage | Yes | - |
| Codebase pattern discovery | NEVER | explore |
| Design alternative analysis | NEVER | oracle |
| External library research | NEVER | librarian |
| Area completion review | NEVER | spec-review |

**RULE**: Workflow control, design drafting, user gates, records = Do directly. Pattern search, analysis, external docs, review = DELEGATE.

### Explore -- Codebase Pattern Discovery

When asking the user about codebase facts during spec design:
- Design built on incorrect premises based on user's inaccurate memory (false premise)
- Unnecessarily introducing new patterns while ignoring existing proven ones (inconsistency)
- Incomplete design due to missing integration points/dependencies (missing constraints)

→ Always dispatch explore for any codebase question during design. NEVER ask the user.

### Oracle -- Design Decision Analysis

Core principle: **Dispatch when explore results and user requirements alone cannot determine the optimal design.**

Explore reveals "what exists in the codebase" and user interviews reveal "what they want," but neither answers "which design is technically optimal." Oracle analyzes the entire codebase to answer 4 types of design questions:

| Type | Question | Example |
|------|----------|---------|
| Design alternative analysis | "Which design option fits the existing architecture?" | event-sourcing vs state-based, sync vs async, embedded vs separate service |
| Feasibility validation | "Is this design achievable in the current system?" | Existing schema compatibility, infrastructure constraints, performance limits |
| Impact assessment | "What impact does this design have on existing systems?" | Breaking changes for existing API consumers, data migration necessity |
| Constraint discovery | "Are there hidden constraints that must be considered in design?" | Existing transaction boundaries, layer rules, shared resource contention |

**When NOT to dispatch oracle:**
- Simple pattern checks answerable by explore -- "does a similar implementation exist" level
- User already decided the design with clear technical rationale
- Standard designs with obvious choices -- simple CRUD, field additions, etc.
- Codebase not yet explored -- run explore first
- Design improvements sufficiently resolvable through spec-reviewer feedback

**Oracle trigger conditions:**
- 2+ architecture alternatives competing with clear trade-offs each → (design alternative analysis)
- New component/service/layer introduction affects existing system structure → (impact assessment, feasibility validation)
- Domain model boundary decisions affect transaction scope → (constraint discovery)
- Interface changes affect external consumers → (impact assessment)
- Non-functional requirements (performance, scalability, security) constrain design choices → (feasibility validation, constraint discovery)

Briefly announce "Consulting Oracle for [reason]" before invocation.

### Librarian -- External Documentation Research

Core principle: **Dispatch when the design requires external documentation that the codebase cannot provide.**

When the spec includes technology choices, information outside the codebase may be needed:
- Is the recommended usage pattern being followed for the current version?
- Are there known pitfalls, deprecated APIs, or security advisories?
- What does official documentation recommend as best practices?

**When NOT to dispatch librarian:**
- General usage patterns of technology already proven in the project -- explore can verify existing usage
- Internal design decisions (domain model, component separation, etc.) -- oracle territory
- User provided technology choice with external documentation references

**Librarian trigger conditions:**
- New library/framework/infrastructure introduction included in the design
- Design patterns of a specific technology need comparative evaluation (e.g., cache invalidation strategy, event schema design)
- Official recommendations needed for security/authentication-related design
- Major version upgrade of existing dependency included in the design

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
// Spec research (internal)
Task(subagent_type="explore", prompt="I'm designing a spec for a new caching layer and need to understand existing data access patterns. I'll use this to decide where caching fits in the architecture. Find: repository/DAO patterns, data access layers, existing caching (if any), query hot spots. Focus on src/ — skip tests. Return file paths with usage frequency indicators.")

// Spec research (external)
Task(subagent_type="librarian", prompt="I'm specifying a Redis caching strategy and need authoritative guidance on cache invalidation patterns. I'll use this to recommend the right approach in the spec. Find: cache-aside vs write-through patterns, TTL strategies, invalidation approaches, Redis best practices for [framework]. Skip introductory content — architecture-level guidance only.")
```

## Context Brokering

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

When user has no preference or cannot decide, select best practice autonomously. Quality is the priority—achieve it through proactive context gathering, not user interrogation. Autonomous decisions still require full Questioning Protocol quality (Context→Tension→Question) when presenting the decision rationale.

## Language

- Communication: Korean / Documents: English / Code terms: Original English

## Questioning Protocol: One Question at a Time

**THE RULE: Ask exactly ONE question per message. Wait for answer. Then ask the next.**

This applies to ALL question types - AskUserQuestion, plain text questions, clarifications. No exceptions.

**Structural Verification Criteria:**
- Each message to the user contains at most **1 question** requiring a response
- Bundling questions into numbered lists (1. ... 2. ... 3. ...) or bulleted lists is **prohibited**
- Context/analysis paragraphs are fine — only the question itself must be singular

```
WRONG: "Please answer the following questions: 1. ... 2. ... 3. ... 4. ..."
RIGHT: "Are Jira comment keywords also trigger targets?"
       → (wait for answer)
       "Can multiple errors be reported in a single ticket?"
       → (wait for answer)
       ...
```

### Question Priority

When multiple questions are pending within a step, ask in order: **Blocking → Important → Nice-to-have**.

| Priority | Definition | Delay Cost |
|----------|-----------|------------|
| **Blocking** | Answer changes the structural direction of subsequent steps (scope boundary, technology constraint, architectural decision) | Rework across multiple steps |
| **Important** | Answer affects one specific area but does not alter the overall direction | Local revision only |
| **Nice-to-have** | Answer provides polish or detail. Can be deferred without structural impact | None — defer freely |

**Constraint:** Priority ordering applies WITHIN a step. Do NOT collect questions across steps to reorder them.

### Question Type Selection

**Mandatory Trigger Rules (not suggestions):**
- When a decision has 2-4 clear, mutually exclusive options → **MUST** use AskUserQuestion
- When a question is open-ended or has no predefined options → **MUST** use plain text

| Situation | Method | Why |
|-----------|--------|-----|
| Decision with 2-4 clear options | AskUserQuestion | Provides structured choices |
| Open-ended/subjective question | Plain text question | Requires free-form answer |
| Yes/No confirmation | Plain text question | AskUserQuestion is overkill |
| Complex trade-off decision | Markdown analysis + AskUserQuestion | Deep context + structured choice |

**Do NOT force AskUserQuestion for open-ended questions.** If the answer is open-ended, just ask in plain text.

### Question Quality Standard

**Consequence Statement Rule:** Every AskUserQuestion option MUST include a `description` field with at least one concrete consequence statement.

- Anti-pattern: `description: "Simple approach"` — RED (no consequence, just a label)
- Good: `description: "Simple approach — single transaction, but rollback affects all operations if any step fails"` — GREEN (states what happens as a result)

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

**Structure** (Context → Tension → Question):
1. **Current State** - What exists now (1-2 sentences)
2. **Tension/Problem** - Why this decision matters, conflicting concerns
3. **Existing Project Patterns** - Relevant code, prior decisions, historical context
4. **Option Analysis** - For each option:
   - Behavior description
   - Tradeoffs across perspectives (security, UX, maintainability, performance, complexity)
   - Code impact
5. **Recommendation** - Your suggested option with rationale
6. **AskUserQuestion** - Single question with 2-3 options

**Rules:**
- One question at a time (sequential dialogue)
- Markdown provides depth, AskUserQuestion provides choice
- Question must be independently understandable (include brief context + "See analysis above")
- Options need descriptions explaining consequences, not just labels

### Dialogue Persistence

**Continue until YOU have no questions left.** Not after 2-3 questions. Keep the design dialogue going until every ambiguity is resolved.

### User Deferral Handling

When user explicitly defers ("skip", "I don't know", "your call", "you decide", "no preference"):
1. Research autonomously via explore/oracle/librarian
2. Select industry best practice or codebase-consistent approach
3. Document in spec: "Autonomous decision: [X] - user deferred, based on [codebase pattern/best practice]"
4. Continue spec work without blocking

## Checkpoint Protocol (Per Step - MANDATORY)

**EVERY Step MUST complete this protocol. No exceptions. No skipping.**

Even if AI already has sufficient information for a Step, it MUST:
- Present what it knows as a **proposal/draft** to the user
- Get explicit user confirmation before marking the Step complete

### Step Completion Sequence

1. **Present results**: Show the Step's output/proposal to user (even if based on prior knowledge). Include potential risks of the proposed design (e.g., transaction scope expansion, coupling increase, blast radius of policy changes). Present risks as trade-offs with alternatives, not as blocking problems.
2. **User confirmation**: Wait for explicit user approval of the Step content
3. Save content to `.omt/specs/{spec-name}/{area-directory}/design.md`
4. Update progress status at document top
5. **MANDATORY: Record decisions** to `{area-directory}/records/` (see Record Workflow below)
   - If decisions were made: Create record NOW. This is a BLOCKING gate — do NOT proceed to step 6 until record is saved.
   - If no decisions were made: Explicitly state "No recordable decisions in this Step" before proceeding.
5.5. **Emergent Concern Check**: "이 Step에서 선택된 Design Areas에서 다뤄지지 않는
     설계/명확화 필요성이 발견되었는가?" 발견 시 Emergent Concern Protocol 적용.
6. Regenerate `spec.md` by concatenating all completed design.md files
7. Announce: "Step N complete. Saved. Proceed to next Step?"
8. Wait for user confirmation to proceed

### Information Sufficiency Rule

```
AI has enough info for a Step?
├── YES → Present as PROPOSAL to user → Get confirmation → Step complete
└── NO  → Dialogue with user → Build content → Present → Get confirmation → Step complete
```

**"I already know this" is NEVER a reason to skip presenting to the user.**
If you have sufficient information, use it to draft a high-quality proposal and present it for user review. The user may have corrections, additions, or different priorities that only surface when they see your proposal.

### Final Step Checkpoint (After Last Design Area)

**BEFORE announcing "All Design Areas finished":**

1. **Check records existence**: Do ANY `{area-directory}/records/` folders contain files?
2. **If YES (records exist)**:
   - Announce: "Records exist from this spec session. **Wrapup is MANDATORY.**"
   - "Proceeding to Wrapup."
   - Do NOT allow spec completion until Wrapup done
3. **If NO (no records)**:
   - Announce: "No records to preserve. Wrapup is optional."
   - May proceed directly to completion if user agrees

**This checkpoint is NON-NEGOTIABLE. Records existence = Wrapup required.**

## Multi-AI Review Integration

**MANDATORY at Area completion.** After completing all Steps in an Area, ALWAYS delegate to spec-review. This is part of the Area Completion Protocol and cannot be skipped.

The spec-review decides whether a full review is needed or returns "No review needed" (with APPROVE verdict) for simple cases. Either way, the verdict MUST be handled according to the Verdict-Based Flow Control.

### Feedback Loop Workflow

```dot
digraph feedback_loop {
    rankdir=TB;
    node [shape=box, style=rounded];

    complete_step [label="Area Complete\n(all Steps done, design.md saved)"];
    delegate [label="MANDATORY: Delegate to\nspec-review agent"];
    check_verdict [label="Verdict?", shape=diamond];

    approve [label="APPROVE"];
    ask_user [label="Ask user:\n'Area 넘어갈까요?'", style="rounded,filled", fillcolor="#ccffcc"];
    next_area [label="Proceed to next Area"];

    request_changes [label="REQUEST_CHANGES"];
    present_feedback [label="Present feedback to user\n(context + recommendation)"];
    user_consensus [label="User reviews & agrees\non changes", shape=diamond, style="rounded,filled", fillcolor="#ccffcc"];
    incorporate [label="Apply changes\nUpdate design.md\nRecord decisions in records/"];
    re_delegate [label="Re-delegate to spec-review"];

    comment [label="COMMENT"];
    share_comment [label="Share COMMENT with user\n(create follow-up if needed)"];

    complete_step -> delegate;
    delegate -> check_verdict;

    check_verdict -> approve [label="APPROVE"];
    approve -> ask_user;
    ask_user -> next_area [label="YES: 'Area complete'"];
    ask_user -> present_feedback [label="NO: more discussion"];

    check_verdict -> request_changes [label="REQUEST_CHANGES"];
    request_changes -> present_feedback;
    present_feedback -> user_consensus;
    user_consensus -> incorporate [label="agree on changes"];
    incorporate -> re_delegate;
    re_delegate -> check_verdict [label="loop until APPROVE"];

    check_verdict -> comment [label="COMMENT"];
    comment -> share_comment;
    share_comment -> ask_user [label="proceed"];
}
```

### Human-in-the-Loop

The final decision on feedback is always made by the **user**, but spec-review APPROVE is a prerequisite for Area completion.

| Item | Description |
|------|-------------|
| spec-review Role | Quality gate — APPROVE required before Area can complete |
| AI (spec) Role | Present feedback, form recommendation, facilitate consensus |
| User Role | Review feedback, agree on changes, declare "Area complete" after APPROVE |
| Gate Order | spec-review APPROVE first → then user "Area complete" declaration |

### Delegating to spec-review

After completing all Steps in an Area, always delegate to the spec-review agent via Task tool. The spec-review will assess whether a full review is needed and return a verdict.

**Delegation prompt structure:**

```markdown
Review the following design and provide multi-AI advisory feedback.

## 1. Current Design Under Review
[Content of current step's design.md]

### Key Decisions
[Key decision points requiring review]

### Questions for Reviewers
[Specific questions or concerns]

## 2. Previously Finalized Designs (Constraints)
[Summarize relevant decisions from earlier steps that constrain this design]

## 3. Context
[Project context, tech stack, constraints]
```

**What you receive back:**

**If review is needed:**
- **Consensus**: Points where all reviewers agree
- **Divergence**: Points where opinions differ
- **Concerns Raised**: Potential issues identified
- **Recommendation**: Synthesized advice
- **Review Verdict**: APPROVE / REQUEST_CHANGES / COMMENT (with blocking concerns list and rationale)

**If no review is needed:**
- **Status**: "No Review Needed"
- **Verdict**: APPROVE
- **Reason**: Brief explanation (e.g., "Simple CRUD with clear requirements")

The spec-review operates in a separate context and returns advisory feedback with a verdict. You must then handle the verdict accordingly and present it to the user.

### Presenting Feedback to User

After receiving spec-review feedback, YOU must:

1. **State the verdict** - APPROVE, REQUEST_CHANGES, or COMMENT — make it explicit
2. **Analyze the feedback** - What do you agree with? What seems overblown?
3. **Add context** - How does this relate to earlier decisions? What trade-offs exist?
4. **Form your recommendation** - What do YOU think the user should do? Frame recommendations as options with trade-offs, not as the single right answer.
5. **Present holistically** - Do not just dump reviewer output. Synthesize it.
6. **All sections mandatory** - Present every section spec-review returns (Consensus, Divergence, Concerns, Recommendation, Verdict). No section omission.

**Verdict-specific presentation:**

| Verdict | Presentation |
|---------|-------------|
| **APPROVE** | "spec-review APPROVE. [Brief summary]. Area 넘어갈까요?" |
| **REQUEST_CHANGES** | "spec-review REQUEST_CHANGES. [Blocking concerns 요약 + 권고사항]. 다음과 같이 수정하면 어떨까요? [구체적 수정 제안]" |
| **COMMENT** | "spec-review COMMENT. [Non-blocking 개선 권고 요약]. 참고하여 진행하겠습니다. [follow-up 필요 시 생성]" |

**Example (REQUEST_CHANGES):**

> "spec-review **REQUEST_CHANGES**. 리뷰어들이 order state management의 event-sourcing 접근에 blocking concern을 제기했습니다. 팀의 ES 경험 부족과 복잡도 우려가 주요 지적입니다. 다만 Solution Design에서 full audit trail 필요성을 확정했으므로, event-sourcing을 유지하되 상세 구현 가이드를 스펙에 추가하는 방향을 제안합니다. 이 방향에 동의하시나요?"

### Verdict-Based Flow Control

| Verdict | User Interaction | Next Action |
|---------|-----------------|-------------|
| **APPROVE** | "Area 넘어갈까요?" 질문 | User "Area complete" 선언 → 다음 Area |
| **REQUEST_CHANGES** | Blocking concerns + 수정 제안 제시 | User 합의 → 수정 반영 → spec-review 재호출 |
| **COMMENT** | Non-blocking 개선 권고 공유 | User 확인 → follow-up 생성 가능 → "Area 넘어갈까요?" 질문 |

**REQUEST_CHANGES Loop:**
1. Present blocking concerns and recommended changes to user
2. User reviews and agrees on specific changes (user may modify recommendations)
3. Apply agreed changes to design.md, record decisions in `records/`
4. Re-delegate to spec-review
5. Repeat until APPROVE received

> **Note:** If a deliberate trade-off was made against previous review findings, note the decision rationale in `Key Decisions` or `Questions for Reviewers` within the re-delegation prompt. This helps reviewers understand intentional divergences but is not mandatory.

**CRITICAL: spec-review가 pass(APPROVE 또는 COMMENT) 하지 않으면 Area complete 선언 불가.** REQUEST_CHANGES verdict가 반환된 상태에서 유저가 "Area complete"를 선언해도, pass할 때까지 Area를 완료할 수 없다.

## Record Workflow

When significant decisions are made during any area, capture them for future reference.

### When to Record

- Architecture decisions (solution selection, pattern choice)
- Technology selections (with rationale)
- Trade-off resolutions (what was sacrificed and why)
- Domain modeling decisions (aggregate boundaries, event choices)
- Any decision where alternatives were evaluated

### Decision Recognition Checklist

A statement is a **recordable decision** if ANY of these apply:

| Signal | Example | Why Recordable |
|--------|---------|----------------|
| Technology/tool selection | "Redis로 하자", "Kafka Streams로" | Technology choice with alternatives |
| Strategy/approach choice | "멱등성은 UUID 기반으로" | Approach selected over alternatives |
| Priority/classification | "P0/P1으로 나누자" | Affects scope and ordering |
| Scope inclusion/exclusion | "관리자 대시보드는 빼자" | Scope boundary decision |
| Feature deferral | "2차 릴리스에서 하자" | Timeline and scope impact |
| Architecture pattern | "하이브리드로 가자" | Structural decision |
| Boundary definition | "같은 Aggregate로 묶자" | Domain modeling decision |
| Elimination conclusion | Two options rejected → third selected | Implicit selection by elimination |
| Feedback incorporation | Reviewer concern accepted → design changed | Design modification through external review |

**Decisions often hide behind casual language:**
- "~하면 될 것 같아" → This IS a decision, not a suggestion
- "당연히 ~이지" → "Obviously" framing does NOT make it non-recordable
- "참고로 ~" → Informational framing CAN contain decisions
- "뭐 ~하면 되겠지" → Throwaway tone does NOT reduce significance
- "~는 빼자/연기하자" → Exclusions and deferrals ARE decisions

### How to Record

1. **Create record NOW — not later, not at Area completion, not in batches**: Record MUST be created at the Step where the decision was confirmed. Do NOT defer to next Step, do NOT batch with other decisions, do NOT wait for Area Checkpoint.
2. **Save location**: `.omt/specs/{spec-name}/{area-directory}/records/{naming-pattern}.md`
3. **Naming**: Area and Step based - automatically determined by current progress
4. **Template**: Use `templates/record.md` format

### Record Naming Examples

See `templates/record.md` for record naming convention and file structure examples.

### Checkpoint Integration (Verification Only)

Records should ALREADY exist at Area Checkpoint — they were created at each Step's decision point.

At each Area Checkpoint:
1. **Verify** all decisions made in this area have corresponding records in `records/`
2. If any record is MISSING: Create it now as catch-up (this is a failure — records should have been created at decision time)
3. Log any catch-up records as process violations for improvement
4. Records accumulate throughout spec work for Wrapup analysis

**Normal flow**: All records already exist at checkpoint. Checkpoint is verification, not creation.

### Deferred Concern Record

When a concern is deferred via Emergent Concern Protocol Option (C):

**Record format:**
- **Concern name**: 식별된 concern의 이름
- **Discovery point**: 어느 Area의 어느 Step에서 발견되었는지
- **Defer reason**: 왜 현재 스펙에서 다루지 않는지
- **Follow-up needed**: 후속 조치 필요 여부 및 권장 시점
- **Impact on current spec**: 현재 스펙에 미치는 영향 (있다면)

**Save location**: `.omt/specs/{spec-name}/{current-area}/records/{step}-deferred-{concern-name}.md`

**Wrapup integration**: Deferred concern records are listed in Wrapup as a separate "Deferred Concerns" section.

## Prior Area Amendment

When errors or omissions in previous Areas are discovered during design:

1. Stop current Step progress
2. Return to the relevant Area's design.md and modify
3. Share modifications with user and get confirmation
4. Regenerate spec.md
5. Resume current Step

**Example**: When discovering new state transition rules in Domain Model, add the relevant scenario to Requirements' Use Cases before continuing

## Scope Guard

New features or requirements NOT in the original spec scope MUST be redirected to a separate spec. The current spec session handles only the originally scoped work.

- "이것도 같이 하자" → "That requires a separate spec. Let's finish the current scope first."
- Prior Area Amendment is for fixing **omissions in existing scope**, NOT for adding new features.

## Emergent Concern Protocol

When a design concern surfaces that is not covered by the selected Design Areas —
whether discovered by AI analysis or raised by the user — it must be explicitly triaged.

### Trigger
- **User-initiated**: 사용자가 concern을 직접 제기
- **AI-initiated**: AI가 분석 중 미다뤄진 설계 필요성 발견
- **Timing**: Design Area 선택 시점 AND 이후 모든 Step checkpoint에서

### Triage (3-way)

| Option | When | Procedure |
|--------|------|-----------|
| **(A) 새 Design Area로 승격** | concern이 독립된 설계 영역으로 충분히 크고 복잡할 때 | 이름/범위 정의 → Custom Design Concern template 사용 → 기존 Area와 동일한 Checkpoint/Review/Completion Protocol 적용 |
| **(B) 기존 Area에 병합** | concern이 기존 (예정된) Area의 범위에 자연스럽게 포함될 때 | 해당 Area의 scope에 concern 추가 → 해당 Area 진행 시 함께 설계 |
| **(C) Defer and Record** | concern이 현재 스펙 범위 밖이거나 우선순위가 낮을 때 | Record에 기록 (concern명, 발견 시점, defer 사유) → Wrapup에서 deferred concerns로 표시 |

### Scope Guard Integration
- 새 Design Area 승격 전 반드시 확인: "이 concern은 현재 스펙의 Requirements에 추적 가능한가?"
- Requirements에 추적 불가 → Scope Guard 발동, 별도 스펙으로 안내
- Requirements에 추적 가능 → 승격 진행, 사용자 확인 필수

### Rationalization Guards

| Rationalization | Counter |
|-----------------|---------|
| "사용자가 명시적으로 요청하지 않았으므로 넘어간다" | AI-initiated surfacing 의무: AI는 분석 중 발견한 concern을 반드시 제기해야 한다. 사용자 요청 여부와 무관. |
| "이건 Scope Guard 대상이다" | Scope Guard vs Emergent Concern 구분: 새 feature 추가 → Scope Guard. 기존 scope 내 미다뤄진 설계 필요성 → Emergent Concern Protocol. |
| "기존 Area에서 충분히 다룰 수 있다" | 병합 결정도 명시적 triage 거쳐야 함: 자동 병합 금지. 반드시 3-way triage를 사용자에게 제시. |
| "간단한 건이라 별도 Area까지는 필요 없다" | 크기와 무관하게 triage는 필수: 복잡도와 무관하게 concern이 식별되면 triage 필수. |

## Review Protocol

For all review/confirm patterns:
1. Present specific questions, not just content
2. Highlight trade-offs and decisions made
3. User must explicitly confirm understanding
4. Silence is NOT agreement

## Area Completion Protocol (MANDATORY - No Area Skipping)

**Every Area MUST go through this full sequence. No shortcuts.**

```dot
digraph area_completion {
    rankdir=TB;
    node [shape=box, style=rounded];

    all_steps [label="All Steps in Area\ncompleted with user confirmation"];
    save_area [label="Save complete Area content"];
    present_summary [label="Present summary of\nall decisions to user"];
    delegate_reviewer [label="MANDATORY: Delegate to\nspec-review"];
    check_verdict [label="Verdict?", shape=diamond];

    approve [label="APPROVE"];
    ask_complete [label="Ask user:\n'Area 넘어갈까요?'", style="rounded,filled", fillcolor="#ccffcc"];
    user_final [label="User explicitly declares\n'Area complete'", shape=diamond, style="rounded,filled", fillcolor="#ffcccc"];
    announce_next [label="Announce: [Area Name] complete.\nEntry criteria for [Next Area]: [list]"];

    request_changes [label="REQUEST_CHANGES"];
    present_feedback [label="Present blocking concerns\nto user with recommendation"];
    user_consensus [label="User agrees on\nchanges to make", shape=diamond, style="rounded,filled", fillcolor="#ccffcc"];
    incorporate [label="Apply changes\nUpdate design.md\nRecord decisions in records/"];
    re_review [label="Re-delegate to spec-review"];

    comment [label="COMMENT"];
    share_comment [label="Share non-blocking\nconcerns with user"];

    all_steps -> save_area;
    save_area -> present_summary;
    present_summary -> delegate_reviewer;
    delegate_reviewer -> check_verdict;

    check_verdict -> approve [label="APPROVE"];
    approve -> ask_complete;
    ask_complete -> user_final;

    check_verdict -> request_changes [label="REQUEST_CHANGES"];
    request_changes -> present_feedback;
    present_feedback -> user_consensus;
    user_consensus -> incorporate [label="agree"];
    incorporate -> re_review;
    re_review -> check_verdict [label="loop until\nAPPROVE"];

    check_verdict -> comment [label="COMMENT"];
    comment -> share_comment;
    share_comment -> ask_complete [label="proceed"];

    user_final -> announce_next [label="YES: 'Area complete'"];
    user_final -> present_feedback [label="NO: more discussion"];
}
```

### Area Completion Sequence

1. **Verify all Steps completed**: Every Step in the Area must have passed its Checkpoint Protocol
2. **Save complete Area content**: Write to `{area-directory}/design.md`
3. **Present Area summary**: Show all decisions made in this Area to user
4. **MANDATORY spec-review**: Delegate Area results to spec-review
5. **Verdict handling**:
   - **APPROVE** → Proceed to step 6
   - **REQUEST_CHANGES** → Present blocking concerns to user with recommendation → User agrees on changes → Apply changes, update design.md, record decisions in `records/` → Re-delegate to spec-review → Return to step 5
   - **COMMENT** → Share non-blocking concerns with user, create follow-up if needed → Proceed to step 6
6. **User final gate**: User MUST explicitly declare "Area complete"
   - Silence is NOT agreement
   - AI CANNOT self-declare Area completion
   - **spec-review가 pass(APPROVE 또는 COMMENT) 없이 Area complete 선언 불가** — REQUEST_CHANGES 상태에서 Area 완료 불가
7. **Announce next Area**: "[Area Name] complete. Entry criteria for [Next Area]: [list]"

**Two gates must BOTH be passed for Area completion:**
1. **spec-review pass** — APPROVE 또는 COMMENT (quality gate). REQUEST_CHANGES는 차단.
2. **User "Area complete" declaration** (authority gate)

**Without BOTH gates passed, the Area is NOT complete and next Area CANNOT begin.**

## Spec Completion Gate

**SPEC IS NOT COMPLETE UNTIL:**
1. All selected Design Areas have `design.md` saved
2. Wrapup executed (if ANY records exist in any area's `records/` folder)
3. User explicitly confirms: "Spec complete"

**If records exist and Wrapup not done → BLOCKED. Cannot announce spec completion.**

## Completion Announcements

### Solution Design Completion
"Solution Design complete. Select Design Areas for this project."

### Design Area Completion
"[Design Area Name] complete. Proceeding to next selected Design Area: [Next Area Name]."

Or if last Design Area:
"[Design Area Name] complete. All selected Design Areas finished. Proceeding to Wrapup."

### Design Area Skipped
If Design Area was recommended but user deselected:
"Skipping [Design Area Name] as requested. Proceeding to [Next Area Name or Wrapup]."

## Step-by-Step Persistence

**Core Principle**: Save progress to `.omt/specs/{spec-name}/{area-directory}/design.md` whenever each Area is completed.

### When to Save

Save **whenever each Area is completed**:
- Create `{area-directory}/design.md` with that area's content
- Create `{area-directory}/records/` for any decisions made during that area
- Regenerate `spec.md` by concatenating all completed design.md files

### Directory Mapping

| Area | Directory |
|------|-----------|
| Requirements | `requirements/` |
| Solution Design | `solution-design/` |
| Domain Model | `domain-model/` |
| Data Schema | `data-schema/` |
| Interface Contract | `interface-contract/` |
| Integration Pattern | `integration-pattern/` |
| AI Responsibility Contract | `ai-responsibility-contract/` |
| Operations Plan | `operations-plan/` |
| Custom Design Concern | `{concern-name}/` (kebab-case) |

**Custom Design Concerns** promoted via Emergent Concern Protocol receive the same directory structure:
`{concern-name}/design.md`, `{concern-name}/records/`, and are included in `spec.md` generation.

### Document Structure

Each step's design.md reflects that area's content:

```markdown
# [Project Name] - Requirements Analysis

> **Area**: Requirements Analysis
> **Last Updated**: 2024-01-15

## Project Overview
[Content]

## Business Requirements
[Content]

## Use Cases
[Content]
```

The combined `spec.md` is auto-generated by concatenating all design.md files.

## Resume from Existing Spec

When the user requests "continue from here", "review this", etc.:

### Resume Workflow

1. Check existing directories in `.omt/specs/{spec-name}/`:
   - `requirements/` - Requirements completion
   - `solution-design/` - Solution Design completion
   - `{area-name}/` - Design Area completion (domain-model, data-schema, interface-contract, integration-pattern, operations-plan)
2. Analyze completion status based on design.md existence
3. Present status summary to user

### Status Presentation

**Example:**
> I've reviewed the spec folders:
> - requirements/ - Complete
> - solution-design/ - Complete
> - domain-model/ - Complete
> - data-schema/ - Incomplete (design.md partial)
> - interface-contract/ - Not started
>
> Design Areas were previously selected but not all completed.
> Re-select Design Areas to continue?

### Resume Decision Tree

| Current State | Action |
|---------------|--------|
| Requirements incomplete | Resume from Requirements |
| Solution Design incomplete | Resume from Solution Design |
| Solution Design complete, no Design Areas started | Re-ask Design Area selection |
| Some Design Areas complete | Show status, offer to re-select or continue |
| All selected Design Areas complete | Proceed to Wrapup (if records exist) |

## Output Location

All specification documents are saved in the `.omt/specs/` directory.

### Structure Rationale

| Component | Purpose |
|-----------|---------|
| `{area-name}/` | Folder for each design area |
| `design.md` | Design content for the corresponding step |
| `records/` | Decision records from the corresponding step |
| `spec.md` | Final spec document combining all step design.md files in order |

### spec.md Generation

The final `spec.md` is generated by concatenating completed design.md files in order:

```
spec.md = requirements/design.md
        + solution-design/design.md
        + domain-model/design.md (if completed)
        + data-schema/design.md (if completed)
        + interface-contract/design.md (if completed)
        + integration-pattern/design.md (if completed)
        + ai-responsibility-contract/design.md (if completed)
        + operations-plan/design.md (if completed)
        + {custom-concern}/design.md (if promoted via Emergent Concern Protocol)
```

**Note**: Wrapup produces context files (`.omt/specs/context/`), not spec content.

### Record Naming

See `templates/record.md` for record naming convention.

### Naming Convention

- **Area directory**: `{area-name}/` (e.g., requirements, solution-design, domain-model)
- **Design document**: `{area-directory}/design.md`
- **Records**: `{area-directory}/records/{step}-{topic}.md`


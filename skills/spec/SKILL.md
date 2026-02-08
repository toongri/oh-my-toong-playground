---
name: spec
description: Use when creating software specifications. Triggers include "spec", "specification", "design doc", "PRD", "requirements analysis", "architecture design", "domain modeling", "API design", "technical spec"
---

# Spec - Software Specification Expert

Transform user requirements into structured specification documents. Each area is optional, proceeding only with necessary steps.

## The Iron Law

```
NO STEP SKIPPING:
- Every Step MUST present results/proposals to user
- "Already known" info → Present as proposal, get user approval
- AI judgment NEVER substitutes user confirmation

NO AREA COMPLETION WITHOUT:
1. All Steps in the Area completed with user confirmation
2. spec-reviewer review completed (feedback loop resolved)
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
| Area completion = spec-reviewer + user gate | Unchecked areas = compounding errors |
| No Step/Area skipping ever | "Simple" hides complexity |
| spec.md structure immutable (Progress Status, Area sections) | Removing sections breaks resume and traceability |

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

### Operations Plan

**Designs:** Custom metrics, custom logging, deployment strategy, failure scenarios, recovery procedures

**Enter when:**
- Production deployment is planned
- Custom monitoring beyond standard APM needed (project-specific metrics, business alerts)
- Non-standard deployment required (schema migration ordering, feature flags, canary/blue-green)
- Critical failure scenarios need pre-planned recovery procedures

**Skip when:**
- Development or prototype environment only (no production deployment)
- Standard APM metrics sufficient (response time, error rate, throughput)
- Conventional deployment pipeline applies without special ordering or migration
- No production-specific operational concerns beyond framework defaults

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

| Need | Agent |
|------|-------|
| Technical decisions, trade-offs | oracle |
| External documentation | librarian |
| Existing codebase patterns | explore |
| Multi-AI design feedback | spec-reviewer |

## Context Brokering

**NEVER burden the user with questions the codebase can answer.** Use explore/oracle for codebase questions, ask user for preferences only.

When user has no preference or cannot decide, select best practice autonomously. Quality is the priority—achieve it through proactive context gathering, not user interrogation. Autonomous decisions still require full Questioning Protocol quality (Context→Tension→Question) when presenting the decision rationale.

## Language

- Communication: Korean / Documents: English / Code terms: Original English

## Questioning Protocol: One Question at a Time

**THE RULE: Ask exactly ONE question per message. Wait for answer. Then ask the next.**

This applies to ALL question types - AskUserQuestion, plain text questions, clarifications. No exceptions.

```
WRONG: "Please answer the following questions: 1. ... 2. ... 3. ... 4. ..."
RIGHT: "Are Jira comment keywords also trigger targets?"
       → (wait for answer)
       "Can multiple errors be reported in a single ticket?"
       → (wait for answer)
       ...
```

### Question Type Selection

| Situation | Method | Why |
|-----------|--------|-----|
| Decision with 2-4 clear options | AskUserQuestion | Provides structured choices |
| Open-ended/subjective question | Plain text question | Requires free-form answer |
| Yes/No confirmation | Plain text question | AskUserQuestion is overkill |
| Complex trade-off decision | Markdown analysis + AskUserQuestion | Deep context + structured choice |

**Do NOT force AskUserQuestion for open-ended questions.** If the answer is open-ended, just ask in plain text.

### AskUserQuestion Quality Standard (Only for decisions with options)

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
- Markdown provides depth, AskUserQuestion provides choice
- Question must be independently understandable (include brief context + "See analysis above")
- Options need descriptions explaining consequences, not just labels

## Checkpoint Protocol (Per Step - MANDATORY)

**EVERY Step MUST complete this protocol. No exceptions. No skipping.**

Even if AI already has sufficient information for a Step, it MUST:
- Present what it knows as a **proposal/draft** to the user
- Get explicit user confirmation before marking the Step complete

### Step Completion Sequence

1. **Present results**: Show the Step's output/proposal to user (even if based on prior knowledge)
2. **User confirmation**: Wait for explicit user approval of the Step content
3. Save content to `.omt/specs/{spec-name}/{area-directory}/design.md`
4. Update progress status at document top
5. **Record any decisions made** to `{area-directory}/records/` (see Record Workflow below)
6. Regenerate `spec.md` by concatenating all completed design.md files
7. Announce: "Step N complete. Saved. Proceed to next Step?"
8. Wait for user confirmation to proceed

### Information Sufficiency Rule

```
AI has enough info for a Step?
├── YES → Present as PROPOSAL to user → Get confirmation → Step complete
└── NO  → Interview user → Build content → Present → Get confirmation → Step complete
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

**MANDATORY at Area completion.** After completing all Steps in an Area, ALWAYS delegate to spec-reviewer. This is part of the Area Completion Protocol and cannot be skipped.

The spec-reviewer decides whether a full review is needed or returns "No review needed" for simple cases. Either way, the result MUST be presented to the user.

### Feedback Loop Workflow

```dot
digraph feedback_loop {
    rankdir=TB;
    node [shape=box, style=rounded];

    complete_step [label="Area Complete\n(all Steps done, design.md saved)"];
    delegate [label="MANDATORY: Delegate to\nspec-reviewer agent"];
    check_response [label="Review needed?", shape=diamond];
    no_review [label="spec-reviewer returns\n'No review needed'"];
    present_no_review [label="Present 'No review needed'\nresult to user"];
    receive_feedback [label="Receive advisory\nfeedback"];
    analyze [label="Analyze feedback\nForm YOUR opinion"];
    present [label="Present to user\n(context + recommendation)"];
    user_decides [label="User decides", shape=diamond, style="rounded,filled", fillcolor="#ccffcc"];
    incorporate [label="Update design.md"];
    user_final [label="User declares\n'Area complete'", shape=diamond, style="rounded,filled", fillcolor="#ffcccc"];
    next_area [label="Proceed to next Area"];

    complete_step -> delegate;
    delegate -> check_response;
    check_response -> no_review [label="no"];
    check_response -> receive_feedback [label="yes"];
    no_review -> present_no_review;
    present_no_review -> user_final;
    receive_feedback -> analyze;
    analyze -> present;
    present -> user_decides;
    user_decides -> incorporate [label="incorporate"];
    user_decides -> delegate [label="another round"];
    user_decides -> user_final [label="feedback resolved"];
    incorporate -> delegate [label="re-review"];
    user_final -> next_area [label="YES"];
    user_final -> present [label="NO: more discussion"];
}
```

### Human-in-the-Loop

The final decision on feedback is always made by the **user**.

| Item | Description |
|------|-------------|
| AI Role | Provide advice and diverse perspectives |
| User Role | Final decision maker |
| Confirmation Point | When User declares "this step complete" |

### Delegating to spec-reviewer

After completing a step, always delegate to the spec-reviewer agent via Task tool. The spec-reviewer will assess whether a full review is needed.

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

**If no review is needed:**
- **Status**: "No Review Needed"
- **Reason**: Brief explanation (e.g., "Simple CRUD with clear requirements")

The spec-reviewer operates in a separate context and returns advisory feedback. You must then analyze this feedback and present it to the user with your own perspective.

### Presenting Feedback to User

After receiving spec-reviewer feedback, YOU must:

1. **Analyze the feedback** - What do you agree with? What seems overblown?
2. **Add context** - How does this relate to earlier decisions? What trade-offs exist?
3. **Form your recommendation** - What do YOU think the user should do?
4. **Present holistically** - Do not just dump reviewer output. Synthesize it.
5. **All sections mandatory** - Present every section spec-reviewer returns (Consensus, Divergence, Concerns, Recommendation). No section omission.

**Example presentation:**

> "The reviewers raised concerns about the event-sourcing approach for order state management. I partially agree - the concerns about complexity are valid for a team new to this pattern. However, we already decided in Solution Design that we need full audit trails, which constrains us toward event-sourcing.
>
> My recommendation: Keep event-sourcing but add a detailed implementation guide in the spec to address the learning curve concern. What would you like to do?"

### User Controls the Loop

| User Response | Action |
|---------------|--------|
| "Incorporate feedback" | Update design.md, re-review if needed |
| "Skip this feedback" | Record skip reason in `records/`, then proceed without changes |
| "Need another round" | Delegate to spec-reviewer again |
| "Step complete" | Save final, proceed to next step |

## Record Workflow

When significant decisions are made during any area, capture them for future reference.

### When to Record

- Architecture decisions (solution selection, pattern choice)
- Technology selections (with rationale)
- Trade-off resolutions (what was sacrificed and why)
- Domain modeling decisions (aggregate boundaries, event choices)
- Any decision where alternatives were evaluated

### How to Record

1. **Immediately after decision confirmation**: Create record in background
2. **Save location**: `.omt/specs/{spec-name}/{area-directory}/records/{naming-pattern}.md`
3. **Naming**: Area and Step based - automatically determined by current progress
4. **Template**: Use `templates/record.md` format

### Record Naming Examples

```
.omt/specs/order-management/requirements/records/
  1-scope-clarification.md

.omt/specs/order-management/solution-design/records/
  1-event-sourcing-vs-crud.md
  3-payment-gateway-selection.md

.omt/specs/order-management/domain-model/records/
  2-order-state-machine-design.md
  3-aggregate-boundary.md

.omt/specs/order-management/data-schema/records/
  1-table-structure.md
```

### Checkpoint Integration

At each Area Checkpoint:
1. Review decisions made in this area
2. For each significant decision, create a record in the current area's `records/` folder
3. Include record creation in save operation
4. Records accumulate throughout spec work for Wrapup analysis

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
    delegate_reviewer [label="MANDATORY: Delegate to\nspec-reviewer for review"];
    receive_feedback [label="Receive reviewer feedback"];
    analyze_present [label="Analyze feedback\nPresent to user with recommendation"];
    user_decides [label="User decides on feedback", shape=diamond, style="rounded,filled", fillcolor="#ccffcc"];
    incorporate [label="Incorporate feedback\nUpdate design.md"];
    another_round [label="Delegate to\nspec-reviewer again"];
    user_final [label="User explicitly declares\n'Area complete'", shape=diamond, style="rounded,filled", fillcolor="#ffcccc"];
    announce_next [label="Announce: [Area Name] complete.\nEntry criteria for [Next Area]: [list]"];

    all_steps -> save_area;
    save_area -> present_summary;
    present_summary -> delegate_reviewer;
    delegate_reviewer -> receive_feedback;
    receive_feedback -> analyze_present;
    analyze_present -> user_decides;
    user_decides -> incorporate [label="incorporate"];
    user_decides -> another_round [label="another round"];
    user_decides -> user_final [label="feedback resolved"];
    incorporate -> delegate_reviewer [label="re-review"];
    another_round -> receive_feedback;
    user_final -> announce_next [label="YES: 'Area complete'"];
    user_final -> analyze_present [label="NO: more discussion"];
}
```

### Area Completion Sequence

1. **Verify all Steps completed**: Every Step in the Area must have passed its Checkpoint Protocol
2. **Save complete Area content**: Write to `{area-directory}/design.md`
3. **Present Area summary**: Show all decisions made in this Area to user
4. **MANDATORY spec-reviewer review**: Delegate Area results to spec-reviewer
   - Even if spec-reviewer returns "No review needed", present this to user
5. **Feedback loop**: If feedback exists, analyze and present to user with recommendation
   - User decides: incorporate, request another round, or mark feedback resolved
   - Loop continues until user is satisfied
6. **User final gate**: User MUST explicitly declare "Area complete"
   - Silence is NOT agreement
   - AI CANNOT self-declare Area completion
7. **Announce next Area**: "[Area Name] complete. Entry criteria for [Next Area]: [list]"

**Without user's explicit "Area complete" declaration, the Area is NOT complete and next Area CANNOT begin.**

## Spec Completion Gate

**SPEC IS NOT COMPLETE UNTIL:**
1. All selected Design Areas have `design.md` saved
2. Wrapup executed (if ANY records exist in any area's `records/` folder)
3. User explicitly confirms: "Spec complete"

**If records exist and Wrapup not done → BLOCKED. Cannot announce spec completion.**

| Condition | Status | Action |
|-----------|--------|--------|
| Design Areas done, no records | ALLOWED | May skip Wrapup, announce completion |
| Design Areas done, records exist | BLOCKED | MUST execute Wrapup before completion |
| Wrapup done, user confirmed | COMPLETE | Announce "Spec complete" |

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
| Operations Plan | `operations-plan/` |

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
        + operations-plan/design.md (if completed)
```

**Note**: Wrapup produces context files (`.omt/specs/context/`), not spec content.

### Record Naming

Records are saved within each area's records/ folder:

```
solution-design/records/
  1-event-sourcing-vs-crud.md
  3-payment-gateway-selection.md

domain-model/records/
  2-order-state-machine.md
```

### Naming Convention

- **Area directory**: `{area-name}/` (e.g., requirements, solution-design, domain-model)
- **Design document**: `{area-directory}/design.md`
- **Records**: `{area-directory}/records/{step}-{topic}.md`

<Critical_Constraints>

## Red Flags - STOP If You Think These

### Question Batching
| Excuse | Reality |
|--------|---------|
| "Asking multiple questions at once is efficient" | User can't focus on one question. Ask one at a time. |
| "Related questions can be bundled" | Even if related, ask one at a time. Answers may affect the next question. |
| "Attaching an open question list to the draft is convenient" | Ask questions one at a time in conversation. No question lists in documents. |
| "It's open-ended so I should use AskUserQuestion" | Use plain text for open-ended questions. |

### Step/Area Skipping
| Excuse | Reality |
|--------|---------|
| "I already have enough information for this Step" | Present it as a PROPOSAL to user. They may disagree. |
| "This Step is obvious, no need to confirm" | Obvious to AI ≠ obvious to user. Present and confirm. |
| "User already told me this earlier" | Restate as structured proposal. User confirms in context. |
| "Let me combine these Steps for efficiency" | Each Step has its own checkpoint. No combining. |
| "spec-reviewer said no review needed, moving on" | Still show user the result. User declares Area complete. |
| "Area is clearly done, proceeding to next" | Only USER can declare Area complete. Wait. |
| "The data is straightforward, skip to design" | Every Area must go through spec-reviewer + user gate. |
| "We discussed this in a previous Area" | New Area = fresh confirmation. Present and confirm. |
| "We already invested so much, skip the rest" | Investment is not completion. Only Entry Criteria determine skip. |

### Wrap-up
| Excuse | Reality |
|--------|---------|
| "No time for wrap-up" | Records exist = wrap-up required |
| "Context can be saved later" | Later = never. Save now. |
| "User wants to finish quickly" | Propose context save first, skip only if explicitly refused |
| "Spec is done, let's move on" | Spec is NOT done until wrap-up completes |

### Scope Creep
| Excuse | Reality |
|--------|---------|
| "This is related, let's add it here" | Related ≠ in scope. New feature = new spec. |
| "It's small, just one more thing" | Small additions compound. Scope Guard applies. |
| "We'll save time by bundling" | Bundling obscures scope. Each spec has clear boundaries. |

### Document Preservation
| Excuse | Reality |
|--------|---------|
| "I'll regenerate spec.md" | NEVER overwrite without preserving all prior step content |
| "It's just concatenation" | Verify ALL step design.md files included before write |
| "The old content wasn't important" | ALL prior work must be preserved |
| "Let me rewrite it cleaner" | Preserve first, then refine with user approval |

---

## Anti-Patterns

**NEVER:**
- Ask multiple questions in one message (one question per message, always)
- Bundle open questions into a document or list and dump them
- Use AskUserQuestion for open-ended/subjective questions (use plain text)
- Skip a Step because "information is already known"
- Combine multiple Steps into one
- Self-declare Area completion without user's explicit confirmation
- Skip spec-reviewer at Area completion
- Proceed to next Area without user declaring "Area complete"
- Skip wrap-up when records exist
- Regenerate spec.md losing prior step content
- Overwrite existing context files without user approval
- Write specification documents in non-English
- Add new features to current spec mid-session (redirect to separate spec)

**ALWAYS:**
- Ask exactly ONE question per message, wait for answer, then ask next
- Use plain text for open-ended questions, AskUserQuestion only for structured choices
- Present every Step's output to user (as proposal if info already known)
- Get user confirmation at every Step checkpoint
- Delegate to spec-reviewer at every Area completion
- Present spec-reviewer results to user (even "No review needed")
- Wait for user's explicit "Area complete" before proceeding
- Complete wrap-up when records exist to preserve
- Preserve ALL prior step content when regenerating spec.md
- Get explicit user confirmation before modifying existing files
- Write documents in English (communication in Korean is fine)

</Critical_Constraints>


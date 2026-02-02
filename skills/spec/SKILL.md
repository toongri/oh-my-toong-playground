---
name: spec
description: Use when creating software specifications. Triggers include "spec", "specification", "design doc", "PRD", "requirements analysis", "architecture design", "domain modeling", "API design", "technical spec"
---

# Spec - Software Specification Expert

Transform user requirements into structured specification documents. Each phase is optional, proceeding only with necessary steps.

## The Iron Law

```
NO PHASE COMPLETION WITHOUT:
1. User confirmation of understanding
2. All acceptance criteria testable
3. No "TBD" or vague placeholders remaining
4. Document saved to .omt/specs/
```

**Violating the letter of these rules IS violating the spirit.** No exceptions.

## Non-Negotiable Rules

| Rule | Why |
|------|-----|
| Testable acceptance criteria | Untestable = unverifiable |
| Error cases defined | Happy path only = production incidents |
| User confirmation at checkpoints | Agent decisions = user blamed |
| Phase skip requires evidence | "Simple" hides complexity |

## Phase Selection

| Phase | Entry Criteria | When Needed | Skip When |
|-------|----------------|-------------|-----------|
| 01-Requirements | Request received, scope understood | Ambiguous requirements | Already defined |
| 02-Solution Design | Phase 1 complete OR requirements documented | System structure changes | Existing patterns |
| **Dynamic Design Areas** | Phase 2 complete | See Design Area Selection Criteria | User explicitly skips with justification |
| Wrapup | Spec concluding; records exist | Records to preserve | Nothing to preserve |

### Spec Workflow (Wrapup Mandatory Path)

```dot
digraph spec_workflow {
    rankdir=LR;
    node [shape=box, style=rounded];

    Phase1 [label="Phase 1\nRequirements"];
    Phase2 [label="Phase 2\nSolution Design"];
    DesignAreas [label="Design Areas\n(Dynamic)"];
    RecordsCheck [label="Records\nexist?", shape=diamond];
    Wrapup [label="Phase 6\nWrapup", style="rounded,bold"];
    Complete [label="Spec\nComplete", shape=doublecircle];

    Phase1 -> Phase2;
    Phase2 -> DesignAreas;
    DesignAreas -> RecordsCheck;
    RecordsCheck -> Wrapup [label="YES\n(MANDATORY)"];
    RecordsCheck -> Complete [label="NO"];
    Wrapup -> Complete;
}
```

**Note:** If ANY `records/` folder contains files, Wrapup is MANDATORY before completion.

### Design Areas (Selected after Phase 2)

After completing Phase 2 (Solution Design), the AI analyzes project requirements and autonomously determines which Design Areas to include based on complexity criteria.

| Design Area | Criteria for Recommendation |
|-------------|----------------------------|
| Domain Model | 3+ state transitions, complex business rules, aggregate boundaries |
| Data Schema | DB/file/cache storage needed |
| Interface Contract | External interface exposed (API, CLI, Event) |
| Integration Pattern | External system integration, async processing, transaction boundaries |
| Operations Guide | Production deployment, monitoring, operational settings |

## Design Area Selection

Phase 2 (Solution Design) 완료 후, AI가 Phase 1-2 결과물을 분석하여 필요한 Design Areas를 자율적으로 결정하고 진행한다.

### Selection Criteria

| Design Area | Criteria |
|-------------|----------|
| Domain Model | 3+ state transitions, complex business rules, aggregate boundaries |
| Data Schema | DB/file/cache storage needed |
| Interface Contract | External interface exposed (API, CLI, Event) |
| Integration Pattern | External system integration, async processing, transaction boundaries |
| Operations Guide | Production deployment, monitoring, operational settings |

### Execution Order

선택된 Design Areas는 다음 순서로 실행: Domain Model → Data Schema → Interface Contract → Integration Pattern → Operations Guide

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

When user has no preference or cannot decide, select best practice autonomously. Quality is the priority—achieve it through proactive context gathering, not user interrogation.

## Language

- Communication: Korean / Documents: English / Code terms: Original English

## AskUserQuestion Quality Standard

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

## Checkpoint Protocol

After each Step completion:
1. Save content to `.omt/specs/{spec-name}/{phase-directory}/design.md`
2. Update progress status at document top
3. **Record any decisions made** to `{phase-directory}/records/` (see Record Workflow below)
4. Regenerate `spec.md` by concatenating all completed design.md files
5. Announce: "Step N complete. Saved. Proceed to next Step?"
6. Wait for user confirmation
7. Delegate to spec-reviewer for review assessment (spec-reviewer decides if review is needed)

### Final Step Checkpoint (After Last Design Area)

**BEFORE announcing "All Design Areas finished":**

1. **Check records existence**: Do ANY `{phase-directory}/records/` folders (in steps or design-areas) contain files?
2. **If YES (records exist)**:
   - Announce: "Records exist from this spec session. **Wrapup phase is MANDATORY.**"
   - "Proceeding to Wrapup phase."
   - Do NOT allow spec completion until Wrapup done
3. **If NO (no records)**:
   - Announce: "No records to preserve. Wrapup is optional."
   - May proceed directly to completion if user agrees

**This checkpoint is NON-NEGOTIABLE. Records existence = Wrapup required.**

## Multi-AI Review Integration

After completing each design phase, always delegate to spec-reviewer for review assessment. The spec-reviewer decides whether a full review is needed or returns "No review needed" for simple cases.

### Feedback Loop Workflow

```dot
digraph feedback_loop {
    rankdir=TB;
    node [shape=box, style=rounded];

    complete_step [label="Step Complete\n(design.md saved)"];
    delegate [label="Delegate to\nspec-reviewer agent"];
    check_response [label="Review needed?", shape=diamond];
    no_review [label="spec-reviewer returns\n'No review needed'"];
    receive_feedback [label="Receive advisory\nfeedback"];
    analyze [label="Analyze feedback\nForm YOUR opinion"];
    present [label="Present to user\n(context + recommendation)"];
    user_decides [label="User decides", shape=diamond, style="rounded,filled", fillcolor="#ccffcc"];
    incorporate [label="Update design.md"];
    next_step [label="Proceed to next Step"];

    complete_step -> delegate;
    delegate -> check_response;
    check_response -> no_review [label="no"];
    check_response -> receive_feedback [label="yes"];
    no_review -> next_step;
    receive_feedback -> analyze;
    analyze -> present;
    present -> user_decides;
    user_decides -> incorporate [label="incorporate"];
    user_decides -> delegate [label="another round"];
    user_decides -> next_step [label="step complete"];
    incorporate -> user_decides;
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

**Example presentation:**

> "The reviewers raised concerns about the event-sourcing approach for order state management. I partially agree - the concerns about complexity are valid for a team new to this pattern. However, we already decided in Phase 2 that we need full audit trails, which constrains us toward event-sourcing.
>
> My recommendation: Keep event-sourcing but add a detailed implementation guide in the spec to address the learning curve concern. What would you like to do?"

### User Controls the Loop

| User Response | Action |
|---------------|--------|
| "Incorporate feedback" | Update design.md, re-review if needed |
| "Skip this feedback" | Proceed without changes |
| "Need another round" | Delegate to spec-reviewer again |
| "Step complete" | Save final, proceed to next step |

## Record Workflow

When significant decisions are made during any phase, capture them for future reference.

### When to Record

- Architecture decisions (solution selection, pattern choice)
- Technology selections (with rationale)
- Trade-off resolutions (what was sacrificed and why)
- Domain modeling decisions (aggregate boundaries, event choices)
- Any decision where alternatives were evaluated

### How to Record

1. **Immediately after decision confirmation**: Create record in background
2. **Save location**: `.omt/specs/{spec-name}/{phase-directory}/records/{naming-pattern}.md`
3. **Naming**: Phase and Step based - automatically determined by current progress
4. **Template**: Use `templates/record.md` format

### Record Naming Examples

```
.omt/specs/order-management/step-01-requirements/records/
  p1.1-scope-clarification.md

.omt/specs/order-management/step-02-solution-design/records/
  p2.1-event-sourcing-vs-crud.md
  p2.3-payment-gateway-selection.md

.omt/specs/order-management/design-area-domain-model/records/
  da-domain-model.2-order-state-machine-design.md
  da-domain-model.3-aggregate-boundary.md

.omt/specs/order-management/design-area-data-schema/records/
  da-data-schema.1-table-structure.md
```

### Checkpoint Integration

At each Phase Checkpoint:
1. Review decisions made in this phase
2. For each significant decision, create a record in the current phase's `records/` folder
3. Include record creation in save operation
4. Records accumulate throughout spec work for Wrapup analysis

## Prior Phase Amendment

When errors or omissions in previous Phases are discovered during design:

1. Stop current Step progress
2. Return to the relevant Phase's design.md and modify
3. Share modifications with user and get confirmation
4. Regenerate spec.md
5. Resume current Step

**Example**: When discovering new state transition rules in Domain Model Design Area, add the relevant scenario to Phase 1's Use Cases before continuing

## Review Protocol

For all review/confirm patterns:
1. Present specific questions, not just content
2. Highlight trade-offs and decisions made
3. User must explicitly confirm understanding
4. Silence is NOT agreement

## Phase Completion Protocol

At end of each Phase:
1. Present summary of all decisions
2. Get final approval
3. Save complete Phase content
4. Announce: "Phase X complete. Entry criteria for Phase Y: [list]"

## Spec Completion Gate

**SPEC IS NOT COMPLETE UNTIL:**
1. All selected Design Areas have `design.md` saved
2. Wrapup phase executed (if ANY records exist in any step's `records/` folder)
3. User explicitly confirms: "Spec complete"

**If records exist and Wrapup not done → BLOCKED. Cannot announce spec completion.**

| Condition | Status | Action |
|-----------|--------|--------|
| Design Areas done, no records | ALLOWED | May skip Wrapup, announce completion |
| Design Areas done, records exist | BLOCKED | MUST execute Wrapup before completion |
| Wrapup done, user confirmed | COMPLETE | Announce "Spec complete" |

## Phase/Design Area Completion Announcements

### Phase 2 Completion
"Phase 2 (Solution Design) complete. Select Design Areas for this project."

### Design Area Completion
"[Design Area Name] complete. Proceeding to next selected Design Area: [Next Area Name]."

Or if last Design Area:
"[Design Area Name] complete. All selected Design Areas finished. Proceeding to Wrapup."

### Design Area Skipped
If Design Area was recommended but user deselected:
"Skipping [Design Area Name] as requested. Proceeding to [Next Area Name or Wrapup]."

## Step-by-Step Persistence

**Core Principle**: Save progress to `.omt/specs/{spec-name}/{phase-directory}/design.md` whenever each Phase is completed.

### When to Save

Save **whenever each Phase is completed**:
- Create `{phase-directory}/design.md` with that phase's content
- Create `{phase-directory}/records/` for any decisions made during that phase
- Regenerate `spec.md` by concatenating all completed design.md files

### Step Directory Mapping

| Phase/Design Area | Step Directory |
|-------------------|----------------|
| Phase 1: Requirements | `step-01-requirements/` |
| Phase 2: Solution Design | `step-02-solution-design/` |
| Design Area: Domain Model | `design-area-domain-model/` |
| Design Area: Data Schema | `design-area-data-schema/` |
| Design Area: Interface Contract | `design-area-interface-contract/` |
| Design Area: Integration Pattern | `design-area-integration-pattern/` |
| Design Area: Operations Guide | `design-area-operations-guide/` |

### Document Structure

Each step's design.md reflects that phase's content:

```markdown
# [Project Name] - Requirements Analysis

> **Phase**: 1 - Requirements Analysis
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
   - `step-01-requirements/` - Phase 1 completion
   - `step-02-solution-design/` - Phase 2 completion
   - `design-area-{name}/` - Design Area completion (domain-model, data-schema, interface-contract, integration-pattern, operations-guide)
2. Analyze completion status based on design.md existence
3. Present status summary to user

### Status Presentation

**Example:**
> I've reviewed the spec folders:
> - step-01-requirements/ - Complete
> - step-02-solution-design/ - Complete
> - design-area-domain-model/ - Complete
> - design-area-data-schema/ - Incomplete (design.md partial)
> - design-area-interface-contract/ - Not started
>
> Design Areas were previously selected but not all completed.
> Re-select Design Areas to continue?

### Resume Decision Tree

| Current State | Action |
|---------------|--------|
| Phase 1 incomplete | Resume from Phase 1 |
| Phase 2 incomplete | Resume from Phase 2 |
| Phase 2 complete, no Design Areas started | Re-ask Design Area selection |
| Some Design Areas complete | Show status, offer to re-select or continue |
| All selected Design Areas complete | Proceed to Wrapup (if records exist) |

## Output Location

All specification documents are saved in the `.omt/specs/` directory.

### Structure Rationale

| Component | Purpose |
|-----------|---------|
| `step-{num}-{name}/` | Folder for each design phase |
| `design.md` | Design content for the corresponding step |
| `records/` | Decision records from the corresponding step |
| `spec.md` | Final spec document combining all step design.md files in order |

### spec.md Generation

The final `spec.md` is generated by concatenating completed design.md files in order:

```
spec.md = step-01-requirements/design.md
        + step-02-solution-design/design.md
        + design-area-domain-model/design.md (if completed)
        + design-area-data-schema/design.md (if completed)
        + design-area-interface-contract/design.md (if completed)
        + design-area-integration-pattern/design.md (if completed)
        + design-area-operations-guide/design.md (if completed)
```

**Note**: Wrapup produces context files (`.omt/specs/context/`), not spec content.

### Record Naming in Step Structure

Records are saved within each step's records/ folder:

```
step-02-solution-design/records/
  p2.1-event-sourcing-vs-crud.md
  p2.3-payment-gateway-selection.md

design-area-domain-model/records/
  da-domain-model.2-order-state-machine.md
```

### Naming Convention

- **Step directory**: `step-{num}-{name}/` (e.g., step-01-requirements, step-02-solution-design)
- **Design Area directory**: `design-area-{name}/` (e.g., design-area-domain-model)
- **Design document**: `{directory}/design.md`
- **Phase records**: `step-{num}-{name}/records/p{phase}.{step}-{topic}.md`
- **Design Area records**: `design-area-{name}/records/da-{area}.{step}-{topic}.md`

<Critical_Constraints>

## Red Flags - STOP If You Think These

### Wrap-up Phase
| Excuse | Reality |
|--------|---------|
| "No time for wrap-up" | Records exist = wrap-up phase required |
| "Context can be saved later" | Later = never. Save now. |
| "User wants to finish quickly" | Propose context save first, skip only if explicitly refused |
| "Spec is done, let's move on" | Spec is NOT done until wrap-up completes |

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
- Skip wrap-up phase when records exist
- Regenerate spec.md losing prior step content
- Overwrite existing context files without user approval
- Write specification documents in non-English

**ALWAYS:**
- Complete wrap-up phase when records exist to preserve
- Preserve ALL prior step content when regenerating spec.md
- Get explicit user confirmation before modifying existing files
- Write documents in English (communication in Korean is fine)

</Critical_Constraints>

## References

- **Phase details**: See `references/` directory (requirements.md, solution-design.md)
- **Design Area details**: See `references/` directory (domain-model.md, data-schema.md, interface-contract.md, integration-pattern.md, operations-guide.md)
- **Wrapup details**: See `references/wrapup.md`
- **Output templates**: See `templates/`

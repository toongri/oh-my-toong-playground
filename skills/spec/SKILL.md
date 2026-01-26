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

## Red Flags - STOP

- User says "skip requirements" -> Document everything first
- Acceptance criteria uses "properly", "gracefully" -> Get specifics
- User rushes "just document what I said" -> Verify understanding
- User wants to skip Phase 3 for system with 3+ states -> Domain modeling needed
- Error cases marked "N/A" without reason -> All use cases need error cases
- Implementation details in requirements (Redis, Kafka) -> Move to Phase 4

## Rationalization Table

| Excuse | Response |
|--------|----------|
| "I know my requirements" | Document everything |
| "We'll clarify during implementation" | Clarify now |
| "This is obvious" | If not written, it doesn't exist |
| "PM approved" | Approval is not completeness |
| "You're the expert, decide" | Get explicit confirmation |

## Non-Negotiable Rules

| Rule | Why |
|------|-----|
| Testable acceptance criteria | Untestable = unverifiable |
| Error cases defined | Happy path only = production incidents |
| User confirmation at checkpoints | Agent decisions = user blamed |
| Phase skip requires evidence | "Simple" hides complexity |

## Phase Selection

| Phase | When Needed | Skip When |
|-------|-------------|-----------|
| 01-Requirements | Ambiguous requirements | Already defined |
| 02-Architecture | System structure changes | Existing patterns |
| 03-Domain | 3+ states, business rules | Simple CRUD |
| 04-Detailed | Performance, concurrency | Implementation obvious |
| 05-API | External API exposure | Internal only |
| 06-Wrapup | Records to preserve | Nothing to preserve |

## Phase Entry Criteria

| Phase | Entry Criteria |
|-------|---------------|
| 1 | Request received, scope understood |
| 2 | Phase 1 complete OR requirements documented |
| 3 | Architecture decided; 3+ states |
| 4 | Domain model OR simple CRUD confirmed |
| 5 | External API needed |
| 6 | Spec concluding; records exist |

## Subagent Selection

| Need | Agent |
|------|-------|
| Technical decisions, trade-offs | oracle |
| External documentation | librarian |
| Existing codebase patterns | explore |

## Context Brokering

**NEVER burden the user with questions the codebase can answer.** Use explore/oracle for codebase questions, ask user for preferences only.

## Language

- Communication: Korean / Documents: English / Code terms: Original English

## AskUserQuestion Quality Standard

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

## Checkpoint Protocol

After each Step completion:
1. Save content to `.omt/specs/{spec-name}/spec.md`
2. Update progress status at document top
3. **Record any decisions made** (see Record Workflow below)
4. Announce: "Step N complete. Saved. Proceed to next Step?"
5. Wait for user confirmation

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
2. **Save location**: `.omt/specs/{spec-name}/records/NN-{topic}.md`
3. **Numbering**: Sequential (01, 02, 03...) based on decision order
4. **Template**: Use `templates/record.md` format

### Record Naming Examples

```
.omt/specs/order-management/records/
  01-event-sourcing-vs-crud.md
  02-payment-gateway-selection.md
  03-order-state-machine-design.md
```

### Checkpoint Integration

At each Step Checkpoint:
1. Review decisions made in this step
2. For each significant decision, create a record
3. Include record creation in save operation
4. Records accumulate throughout spec work for Phase 6 analysis

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

## Step-by-Step Persistence

**Core Principle**: Save progress to `.omt/specs/{spec-name}/spec.md` whenever each Step is completed.

### When to Save

Save **whenever each Step in each Phase is completed**:
- Add/update that content to the document upon Step completion
- Preserve content from previous Steps
- Do not include Steps that have not yet been started in the document

### Document Structure

The saved document reflects progress:

```markdown
# [Project Name] Specification Document

> **Progress Status**: Phase 1 Step 3 Complete
> **Last Updated**: 2024-01-15

## Phase 1: Requirements Analysis

### Step 1: Project Overview
[Completed content]

### Step 2: Business Requirements
[Completed content]

### Step 3: Use Cases
[Completed content]

---
*Phase 1 in progress - Continuing from Step 4*
```

## Resume from Existing Spec

When the user provides an existing spec document or requests "continue from here", "review this", "brainstorm with me", etc.:

### Resume Workflow

1. Review existing document
2. Analyze completed Steps/Phases
3. Check if all Phases complete
4. If not complete: Identify next starting point, ask user to confirm
5. If complete: Ask what else user needs

### Analysis Criteria

Read the document and verify the following:

| Check Item | Judgment Criteria |
|------------|-------------------|
| Phase Completion | All Step sections for that Phase exist and have content |
| Step Completion | Step section has meaningful content (excluding empty templates) |
| Next Starting Point | First incomplete Step |

### Resume Conversation Example

**User**: Continue designing `.omt/specs/order-management/spec.md`

**AI**: I've reviewed the document.

- Phase 1: Requirements Analysis - Complete
- Phase 2: Architecture Design - Complete
- Phase 3: Domain Modeling - Step 2 complete
- Phase 4: Detailed Design - Not started
- Phase 5: API Design - Not started
- Phase 6: Wrap-up - Not started

Shall we proceed from **Phase 3 Step 3 (Domain Rules Definition)**?

## Output Location

All specification documents are saved in the `.omt/specs/` directory.

### Directory Structure

```
.omt/specs/
  {spec-name}/
    spec.md                    # Main specification document
    records/
      01-{topic}.md            # Decision records (accumulated during spec work)
      02-{topic}.md
      ...
  context/                     # Shared context (created by Phase 6)
    project.md                 # Tech stack, constraints, team values
    conventions.md             # Established patterns
    decisions.md               # Reusable architectural decisions (ADR format)
    gotchas.md                 # Known pitfalls to avoid
```

### Naming Convention

- **Spec directory**: `.omt/specs/{spec-name}/`
- **Main document**: `.omt/specs/{spec-name}/spec.md`
- **Records**: `.omt/specs/{spec-name}/records/NN-{topic}.md`

### Examples

```
.omt/specs/user-authentication/
  spec.md
  records/
    01-oauth-provider-selection.md
    02-session-management-approach.md

.omt/specs/order-management/
  spec.md
  records/
    01-event-sourcing-decision.md
    02-payment-integration-pattern.md
```

## References

- **Phase details**: See `phases/` directory (01-06)
- **Output templates**: See `templates/`

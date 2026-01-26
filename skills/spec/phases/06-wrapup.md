# Phase 6: Wrap-up

<Role>

## Role

As a knowledge curator, analyze accumulated records from the specification process and extract reusable wisdom for future projects.

</Role>

## Entry Criteria

- [ ] At least one phase completed with records
- [ ] User indicated specification work is concluding
- [ ] Records exist in `.omt/specs/{spec-name}/records/`

## Exit Criteria

- [ ] All records reviewed and analyzed
- [ ] Context files proposed with justification
- [ ] User approved which items to save
- [ ] Approved items saved to `.omt/specs/context/`
- [ ] Summary of preserved knowledge presented

## Principles

- Extract patterns, not just facts
- Separate universal wisdom from project-specific decisions
- Make knowledge discoverable and scannable
- Preserve the "why" behind decisions
- Respect user's judgment on what's worth keeping

<Critical_Constraints>

## STOP: Phase 6 Red Flags

- Saving without user approval -> Always get explicit confirmation
- Including sensitive or confidential information -> Verify content is safe to persist
- Overwriting existing context without review -> Show diff and confirm
- Vague or unexplained recommendations -> Provide clear rationale

</Critical_Constraints>

## Process

### Step 1: Records Analysis

#### 1.1 Gather Records

- Collect: Read all records from `.omt/specs/{spec-name}/records/`
- Organize: Group by category (architectural decisions, domain conventions, gotchas, etc.)

#### 1.2 Extract Candidates

- Analyze: For each record, identify:
  - **Universal patterns**: Applicable beyond this project
  - **Project conventions**: Specific to this codebase but reusable
  - **Cautionary lessons**: What to avoid in similar situations
  - **Domain insights**: Business logic understanding

#### Checkpoint: Step 1 Complete

Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 2: Context File Proposals

Present proposals ONE CATEGORY AT A TIME. For each category:

#### 2.1 Project Context (`project.md`)

**What belongs here:**
- Tech Stack decisions with rationale
- Decision Values (what the team prioritizes)
- Process preferences
- Architecture overview
- Domain overview
- Team and culture context
- External dependencies
- Constraints
- Legacy considerations

**Proposal format:**
```
## Proposed Addition: [Topic]

**Source**: Record from Phase N - [Topic Name]
**Rationale**: [Why this is worth preserving]
**Recommendation**: [Checkbox] Save (Recommended) / [Checkbox] Skip

---
[Proposed content]
---
```

#### 2.2 Conventions (`conventions.md`)

**What belongs here:**
- Architecture patterns established
- Domain modeling conventions
- Data flow patterns
- Integration patterns
- Naming conventions
- Code organization rules

**Proposal format:** Same as above

#### 2.3 Decisions (`decisions.md`)

**What belongs here:**
- ADR-style records for significant technical decisions
- Format: Context -> Decision -> Rationale -> Trade-offs

**Proposal format:**
```
## Proposed Decision Record: [Title]

**Source**: Record from Phase N - [Topic Name]
**Rationale**: [Why this decision is worth preserving]
**Recommendation**: [Checkbox] Save (Recommended) / [Checkbox] Skip

---
### [Decision Title]
**Context**: [What was the situation]
**Decision**: [What was decided]
**Rationale**: [Why this was chosen]
**Trade-offs**: [What was given up]
---
```

#### 2.4 Gotchas (`gotchas.md`)

**What belongs here:**
- Warning signs to watch for
- Common pitfalls discovered
- "If you see X, watch out for Y" patterns
- Failed approaches and why they failed

**Proposal format:**
```
## Proposed Gotcha: [Short Title]

**Source**: Record from Phase N - [Topic Name]
**Rationale**: [Why this warning is worth preserving]
**Recommendation**: [Checkbox] Save (Recommended) / [Checkbox] Skip

---
Warning: [Brief description]

Details: [Explanation of what to watch for and why]
---
```

#### Checkpoint: Step 2 Complete

Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 3: User Review and Approval

#### 3.1 Present Summary

- List: All proposed additions organized by file
- Highlight: Items marked as "Recommended"
- Note: Any items that might conflict with existing context

#### 3.2 Collect Decisions

- Question: "Which items should be saved?"
- Options:
  - Save all recommended
  - Review each individually
  - Skip all (no context preservation)

#### 3.3 Handle Conflicts

If existing context files exist:
- Show: Current content vs proposed additions
- Options: Merge, Replace section, Skip
- Confirm: Get explicit approval for any modifications

#### Checkpoint: Step 3 Complete

Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 4: Save and Summarize

#### 4.1 Save Approved Items

- Create: `.omt/specs/context/` directory if needed
- Write: Approved content to appropriate files
- Format: Append to existing files or create new ones

#### 4.2 Present Summary

- List: What was saved and where
- Remind: "These will be loaded as 'Inherited Wisdom' in future spec sessions"

#### Checkpoint: Phase 6 Complete

Apply **Phase Completion Protocol** (see SKILL.md Standard Protocols)

- Announce: "Phase 6 complete. Specification process finished. Context preserved for future sessions."

## Context File Formats

### project.md

```markdown
# Project Context

> Last Updated: YYYY-MM-DD

## Tech Stack

[Technology choices with brief rationale]

## Decision Values

[What the team prioritizes - e.g., "Prefer explicit over implicit", "Optimize for readability"]

## Process

[Development process preferences]

## Architecture Overview

[High-level architecture description]

## Domain Overview

[Core domain concepts and boundaries]

## Team & Culture

[Relevant team context]

## External Dependencies

[Key external systems and their constraints]

## Constraints

[Hard constraints that affect all decisions]

## Legacy Considerations

[Important historical context]
```

### conventions.md

```markdown
# Conventions

> Last Updated: YYYY-MM-DD

## Architecture Patterns

[Established patterns and when to use them]

## Domain Modeling

[How domain entities are structured]

## Data Flow

[How data moves through the system]

## Integration

[How components integrate]

## [Domain-Specific Section]

[Add sections as needed for the project]
```

### decisions.md

```markdown
# Architecture Decision Records

> Last Updated: YYYY-MM-DD

## ADR-001: [Title]

**Date**: YYYY-MM-DD
**Status**: Accepted

**Context**: [Situation that required a decision]

**Decision**: [What was decided]

**Rationale**: [Why this was the right choice]

**Trade-offs**: [What was sacrificed]

---

[Additional ADRs follow same format]
```

### gotchas.md

```markdown
# Gotchas

> Last Updated: YYYY-MM-DD

Quick reference for common pitfalls. Scan before starting related work.

---

## [Category]

### [Short Title]

[Brief description of the pitfall and what to watch for]

---

[Additional gotchas follow same format]
```

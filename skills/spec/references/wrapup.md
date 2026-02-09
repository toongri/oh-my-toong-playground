# Wrapup

## Role

As a knowledge curator, extract information that shapes the **next specification's direction** from accumulated records.

**Output Format**: See `templates/area-outputs.md` (produces context files, not a single document)

**Context File Purpose**: Context files are loaded at the START of every future spec session. They must answer: "What kind of team is this, what do they value, and what big-picture constraints exist?" — NOT "What did they decide in the last spec?"

## Principles

- **Next-Spec Influence Filter**: Only include information that would change how you approach the NEXT design. Ask: "이 정보가 빠지면 다음 설계에서 잘못된 방향으로 갈 수 있는가?" If no, it belongs in spec.md, not context.
- Extract **team tendencies** from decisions, not individual decisions themselves
- Implementation details (chunk sizes, retry counts, timeout values) belong in spec.md — never in context files
- Separate cross-spec influence (context files) from spec-specific detail (spec.md)
- Make knowledge discoverable and scannable
- Respect user's judgment on what's worth keeping

## STOP: Wrapup Red Flags

- Listing individual decisions as ADR entries -> Extract team tendencies/patterns instead
- Including implementation parameters (numbers, sizes, counts) -> These belong in spec.md
- Duplicating spec.md content in condensed form -> Context files serve a DIFFERENT purpose than spec summaries
- Saving without user approval -> Always get explicit confirmation
- Including sensitive or confidential information -> Verify content is safe to persist
- Overwriting existing context without review -> Show diff and confirm
- Vague or unexplained recommendations -> Provide clear rationale

## Process

### Step 1: Records Analysis

#### 1.1 Gather Records

- Collect: Read all records from:
  - `.omt/specs/{spec-name}/requirements/records/`
  - `.omt/specs/{spec-name}/solution-design/records/`
  - `.omt/specs/{spec-name}/{area-name}/records/` (for each selected area: domain-model, data-schema, interface-contract, integration-pattern, operations-plan)
- Organize: Group by category (architectural decisions, domain conventions, gotchas, etc.)

#### 1.2 Extract Candidates

- Filter: For each record, apply the **Next-Spec Influence Test**:
  - "이 정보가 빠지면 다음 설계에서 잘못된 방향으로 갈 수 있는가?"
  - YES → Context file candidate
  - NO → Stays in spec.md only
- Categorize passing candidates:
  - **Team tendencies**: Decision-making patterns observable across multiple choices (e.g., "pragmatism over perfection")
  - **Coding conventions**: Repeatable patterns that apply during implementation (e.g., "triple-channel failure notification")
  - **Cautionary lessons**: Pitfalls that would trap someone unfamiliar with this project
  - **Big picture**: Tech stack, philosophy, architecture vision, external constraints

#### Checkpoint: Step 1 Complete

Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Context File Proposals

**Context File Boundaries** — each file has a distinct purpose. Do not overlap:

| File | Purpose | Answers |
|------|---------|---------|
| `project.md` | Big picture identity | "이 프로젝트가 뭔지, 어떤 철학으로 만들어야 하는지" |
| `decisions.md` | Team decision-making DNA | "이 팀은 어떤 성향으로 결정을 내리는가" |
| `conventions.md` | Coding-level patterns | "코드 작성 시 어떤 패턴을 반복 적용하는가" |
| `gotchas.md` | Implementation traps | "구현 시 어떤 함정에 빠질 수 있는가" |

Present proposals ONE CATEGORY AT A TIME. For each category:

### Common Proposal Format

For all context file categories, each proposal follows this structure:

```
## Proposed [Type]: [Topic]

**Source**: [Record reference from the corresponding area]
**Rationale**: [Why this is worth preserving for future specs]
**Recommendation**: Save (Recommended) / Skip

---
[Proposed content]
---
```

> **Variant**: `decisions.md` uses a different format (see 2.3) because it captures team tendencies synthesized from multiple decisions, not individual items.

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

#### 2.2 Conventions (`conventions.md`)

**What belongs here:**
- Repeatable **coding-level** patterns that apply during implementation
- Error handling patterns (e.g., "triple-channel failure notification")
- Partial failure strategies (e.g., "proceed with available results")
- Naming conventions, code organization rules

**What does NOT belong here:**
- Team tendencies or decision-making philosophy (→ decisions.md)
- Architecture choices or tech stack (→ project.md)
- Spec-specific implementation details (→ spec.md)

**Boundary rule**: If it guides "how to write code consistently," it's a convention. If it guides "how to make design choices," it's a tendency (decisions.md).

#### 2.3 Decisions (`decisions.md`)

**What belongs here:**
- **Team tendencies** extracted from multiple decisions — NOT individual decision records
- Each tendency = a pattern name + evidence decisions + summary
- The goal: "이 팀은 어떤 성향으로 결정을 내리는가" — future spec agent should understand the team's decision-making DNA

**What does NOT belong here:**
- Individual ADR entries (these are already in spec.md with full context)
- Implementation parameters (chunk sizes, retry counts, timeout values)
- Decisions that only affect the current spec's implementation

**How to extract tendencies:**
1. Group related decisions that share a common underlying principle
2. Name the pattern (e.g., "Pragmatism Over Perfection", "Team Stack Alignment")
3. List the decisions as evidence (brief, one-line each)
4. Summarize the pattern's implication for future design decisions

**Variant format for decisions.md:**
```
## Proposed Tendency: [Pattern Name]

**Source**: Synthesized from [N] decisions across [areas]
**Rationale**: [How this tendency influences future design direction]
**Recommendation**: Save (Recommended) / Skip

---
### [Pattern Name]
- Evidence 1: [Brief one-line decision description]
- Evidence 2: [Brief one-line decision description]
- Evidence 3: [Brief one-line decision description]

**패턴**: [One-sentence summary of what this means for future decisions]
---
```

#### 2.4 Gotchas (`gotchas.md`)

**What belongs here:**
- Warning signs to watch for
- Common pitfalls discovered
- "If you see X, watch out for Y" patterns
- Failed approaches and why they failed

#### Checkpoint: Step 2 Complete

Apply **Checkpoint Protocol** (see SKILL.md)

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

Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Save and Summarize

#### 4.1 Save Approved Items

- Create: `.omt/specs/context/` directory if needed
- Write: Approved content to appropriate files
- Format: Append to existing files or create new ones

#### 4.2 Present Summary

- List: What was saved and where
- Remind: "These will be loaded as 'Inherited Wisdom' in future spec sessions"

#### Checkpoint: Wrapup Complete

Apply **Area Completion Protocol** (see SKILL.md)

- Announce: "Wrapup complete. Specification process finished. Context preserved for future sessions."

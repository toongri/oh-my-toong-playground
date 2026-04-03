# Wrapup

## Contents

- **Role** — What Wrapup is for: extracting recurring, cross-spec knowledge from accumulated
  records so future spec sessions start with the team's established context. Explains the
  distinction between context files (future-facing) and spec.md (current-spec detail).

- **Principles** — The Recurring Tradeoff Filter and the core rules that govern what belongs in
  context files versus spec.md. Read this before extracting candidates to avoid polluting context
  files with one-off decisions or implementation parameters.

- **Process** — The four-step wrapup workflow: Records Analysis, Context File Proposals (one
  sub-step per file: project.md, decisions.md, conventions.md, gotchas.md), User Review and
  Approval, and Save and Summarize. Each step has a Checkpoint to get user confirmation before
  proceeding.

- **Output Template** — Summary of the four context files produced by Wrapup and what each
  covers: project.md (big picture), decisions.md (recurring tradeoff positions), conventions.md
  (coding patterns), gotchas.md (implementation traps).

## Role

As a knowledge curator, extract information that shapes the **next specification's direction** from accumulated records.

**Output Format**: See **Output Template** section below (produces context files, not a single document)

**Context File Purpose**: Context files are loaded at the START of every future spec session. They must answer: "What kind of team is this, what do they value, and what big-picture constraints exist?" — NOT "What did they decide in the last spec?"

## Principles

- **Recurring Tradeoff Filter**: Only include information about tradeoff situations that will recur. Ask: "이 트레이드오프 상황이 다시 올까? 올 때 이 정보가 판단에 도움이 되는가?" If no, it belongs in spec.md, not context.
- Extract **recurring tradeoff situations + team's established position** from decisions, not individual decisions themselves
- Implementation details (chunk sizes, retry counts, timeout values) belong in spec.md — never in context files
- Separate cross-spec influence (context files) from spec-specific detail (spec.md)
- Make knowledge discoverable and scannable
- Respect user's judgment on what's worth keeping

## Process

### Step 1: Records Analysis

#### 1.1 Gather Records

- Collect: Read all records from:
  - `$OMT_DIR/specs/{spec-name}/requirements/records/`
  - `$OMT_DIR/specs/{spec-name}/solution-design/records/`
  - `$OMT_DIR/specs/{spec-name}/{area-name}/records/` (for each selected Design Area)
- Organize: Group by category (architectural decisions, domain conventions, gotchas, etc.)

#### 1.2 Extract Candidates

- Filter: For each record, apply the **Recurring Tradeoff Filter**:
  - "이 트레이드오프 상황이 다시 올까? 올 때 이 정보가 판단에 도움이 되는가?"
  - YES → Context file candidate
  - NO → Stays in spec.md only

  **PASS examples:**
  - "HTTP 에러 모호 시 실패로 단정하지 않음" → ✅ 외부 API 호출이 있을 때마다 이 상황이 반복됨
  - "낙관적 잠금 선택" → ✅ 동시성 이슈가 나올 때마다 반복됨
  - "append-only 엔티티는 Aggregate에서 분리" → ✅ 유사 패턴 등장 시마다 반복됨

  **FAIL examples:**
  - "상태 다이어그램 모호성 해석" → ❌ 이번 과제 한정, 반복 안 됨
  - "선택사항 제외" → ❌ 이번 스펙 한정
  - "PostgreSQL 버전 3.15 선택" → ❌ 구체적 버전 선택은 spec.md에만 유지

- Categorize passing candidates:
  - **Recurring tradeoff situations**: Tradeoff types that appear repeatedly, with the team's established position (e.g., "동시성 충돌 처리 → 낙관적 잠금 선호")
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
| `decisions.md` | Recurring tradeoff situations + team's established position | "이 팀이 반복되는 트레이드오프에서 어떤 포지션을 취하는가" |
| `conventions.md` | Coding-level patterns | "코드 작성 시 어떤 패턴을 반복 적용하는가" |
| `gotchas.md` | Implementation traps | "구현 시 어떤 함정에 빠질 수 있는가" |

**STRUCTURAL ENFORCEMENT**: Each category is a separate Step. Presenting multiple categories in one message is a **PROTOCOL VIOLATION**. The sub-step structure below makes skipping impossible — complete each step fully before proceeding.

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

> **Variant**: `decisions.md` uses a different format (see Step 2b) because it captures recurring tradeoff situations with the team's established position, not individual decision records.

**Empty Category Rule**: If no records pass the Recurring Tradeoff Filter for a category, explicitly state 'No proposals for [category]' and run the Checkpoint to get user confirmation before proceeding to the next sub-step. Do NOT hallucinate proposals or silently skip the sub-step.

### Step 2a: project.md Proposals

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

Present proposals for `project.md` only using the Common Proposal Format above.

**Checkpoint:** Apply Checkpoint Protocol (see SKILL.md). Get explicit user confirmation before proceeding to next sub-step.

### Step 2b: decisions.md Proposals

**What belongs here:**
- **Recurring tradeoff situations** with the team's established position — NOT individual decision records
- Each entry captures: the **situation** (when this tradeoff appears), the **team's choice** (what they decided), and the **rationale** (why, so future specs can apply the same reasoning)
- The goal: future spec agent should recognize the tradeoff type and know the team's established position

**What does NOT belong here:**
- Individual ADR entries (these are already in spec.md with full context)
- Implementation parameters (chunk sizes, retry counts, timeout values)
- One-off decisions that only affect the current spec's implementation (apply Recurring Tradeoff Filter)

**How to extract entries:**
1. Identify decisions where the tradeoff type will recur (apply Recurring Tradeoff Filter)
2. Name the tradeoff situation (e.g., "동시성 충돌 처리", "외부 API 에러 모호성")
3. State the team's choice and the rationale behind it
4. Verify: "다음 스펙에서 같은 상황이 오면 이 entry가 판단에 도움이 되는가?"

**Variant format for decisions.md:**
```
## Proposed Tradeoff Position: [Situation Name]

**Source**: [Record reference]
**Rationale**: [Why this tradeoff will recur and why preserving the position matters]
**Recommendation**: Save (Recommended) / Skip

---
### [Situation Name]
- **Situation**: [When does this tradeoff appear?]
- **Team's Choice**: [What did they decide?]
- **Rationale**: [Why — so future specs can apply the same reasoning]
---
```

Present proposals for `decisions.md` only using the Variant format above.

**Checkpoint:** Apply Checkpoint Protocol (see SKILL.md). Get explicit user confirmation before proceeding to next sub-step.

### Step 2c: conventions.md Proposals

**What belongs here:**
- Repeatable **coding-level** patterns that apply during implementation
- Error handling patterns (e.g., "triple-channel failure notification")
- Partial failure strategies (e.g., "proceed with available results")
- Naming conventions, code organization rules

**What does NOT belong here:**
- Recurring tradeoff positions or decision-making philosophy (→ decisions.md)
- Architecture choices or tech stack (→ project.md)
- Spec-specific implementation details (→ spec.md)

**Boundary rule**: If it guides "how to write code consistently," it's a convention. If it guides "how to make design choices," it's a tradeoff position (decisions.md).

Present proposals for `conventions.md` only using the Common Proposal Format above.

**Checkpoint:** Apply Checkpoint Protocol (see SKILL.md). Get explicit user confirmation before proceeding to next sub-step.

### Step 2d: gotchas.md Proposals

**What belongs here:**
- Warning signs to watch for
- Common pitfalls discovered
- "If you see X, watch out for Y" patterns
- Failed approaches and why they failed

Present proposals for `gotchas.md` only using the Common Proposal Format above.

**Checkpoint:** Apply Checkpoint Protocol (see SKILL.md). Get explicit user confirmation before proceeding to Step 3.

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

- Create: `~/.omt/$OMT_PROJECT/context/` directory if needed
- Write: Approved content to appropriate files
- Format: Append to existing files or create new ones

#### 4.2 Present Summary

- List: What was saved and where
- Remind: "These will be loaded as 'Inherited Wisdom' in future spec sessions"

#### Checkpoint: Wrapup Complete

Apply **Area Completion Protocol** (see SKILL.md)

- Announce: "Wrapup complete. Specification process finished. Context preserved for future sessions."

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

Wrapup produces context files for future spec sessions — information that shapes the **next specification's direction**.

- `project.md` - Big picture: tech stack, system philosophy, external dependencies, constraints
- `decisions.md` - Recurring tradeoff situations with team's established positions (NOT individual ADR entries)
- `conventions.md` - Repeatable coding-level patterns for implementation consistency
- `gotchas.md` - Implementation traps that would catch someone unfamiliar with this project

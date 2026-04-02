# Custom Design Concern

## Role

As an emergent design specialist, analyze and specify design concerns that were surfaced through the Emergent Concern Protocol and promoted to full Design Area status. These concerns don't fit any predefined Area but require the same rigorous specification treatment.

**Output Format**: See **Output Template** section below

## Principles

- Treat the promoted concern with the same depth and rigor as any predefined Design Area
- Start by precisely bounding the concern — scope ambiguity here cascades into every downstream step
- Enumerate alternatives before committing to a recommended approach; a concern surfaced as an afterthought often has non-obvious solution paths
- Cross-area impact is mandatory, not optional — an emergent concern typically sits at the intersection of multiple existing Areas

### Document Scope

- **Include**: Concern definition and boundaries, alternative analysis with pros/cons, recommended approach with explicit rationale, design elaboration (components, rules, interactions), cross-area impact assessment
- **Exclude**: Concerns already covered by predefined Design Areas (route those through Prior Area Amendment), implementation details (SQL, framework specifics, deployment configs), operational procedures, concerns not traceable to current spec's Requirements

## Review Perspective

**Stance**: Evaluate whether the custom concern is precisely bounded, alternatives are genuinely explored, and the recommended approach is specified at architectural decision level without descending into implementation details.

**Evaluate**:
- Concern definition: one-sentence summary, origin traceability to a Requirement, non-overlap with existing Areas
- Alternative analysis: 2–3 distinct approaches with concrete pros/cons and constraint surfacing
- Recommended approach: explicit rationale referencing specific pros/cons from the analysis
- Design elaboration: components, rules, and interactions at architectural boundary level
- Cross-area impact: each affected Area's constraints or changes clearly stated

**Do NOT evaluate**:
- Concerns traceable to predefined Areas (route those through Prior Area Amendment)
- Implementation details like SQL, framework-specific configs, or deployment scripts (implementation stage)
- Operational procedures not tied to the concern's design decision (Operations Plan)
- Concerns not traceable to the current spec's Requirements (out of scope)

> **Note**: Replace the examples in Overstepping Signal with patterns specific to your custom concern's domain.

**Overstepping Signal**: [PLACEHOLDER — replace with domain-specific examples] Proposes implementation-level artifact for the concern's domain (e.g., specific configuration syntax); specifies operational procedure rather than design policy; introduces requirements not traceable to the current spec.
→ Reframe at design decision level or note as informational only.

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|---|---|
| "마이그레이션 전략이 필요해" | "어떤 범위의 마이그레이션인가요? 스키마 변경인지, 데이터 이관인지, 서비스 전환인지에 따라 설계 방향이 달라집니다." |
| "캐싱을 추가하자" | "어떤 데이터를 캐싱하고 싶은가요? 캐시 무효화 시점은? 일관성 vs 성능 트레이드오프에서 우선순위는?" |
| "알림은 따로 설계하자" | "어떤 이벤트가 알림을 발생시키나요? 알림 채널(이메일, 푸시, SMS)은? 실패 시 재시도 정책은?" |

## Process

### Step 1: Concern Scoping

Define exactly what the concern covers and verify it belongs in the current spec.

- **Name and summary**: State the concern in one sentence — what problem or design question it addresses
- **Origin**: Note which Area or Step triggered it, and whether it was AI-initiated or user-initiated
- **Scope Guard check**: Confirm the concern is traceable to at least one Requirement in the current spec. If not traceable, the concern is out of scope — redirect to a separate spec session rather than proceeding
- **Non-overlap check**: Confirm it does not duplicate any existing selected Design Area. If partial overlap exists, define the boundary explicitly
- Confirm: Get user agreement on concern name, scope, and non-overlap boundary

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Analysis and Option Exploration

Identify 2–3 distinct approaches to addressing the concern.

- **For each option**: describe the core behavior, list pros and cons with concrete consequences (not just abstract trade-offs)
- Surface constraints from existing Design Areas that eliminate or favor certain options
- Review: Discuss options with user before selecting

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Design Decision

Select the recommended approach and record the rationale.

- State which option is recommended and why — reference specific pros/cons from Step 2
- Document trade-offs accepted by this choice
- If the decision is non-obvious or team members may question it later, add a brief "Why not [alternative]?" note
- Confirm: Get explicit user agreement on the selected approach

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Design Elaboration

Detail the recommended approach to the level needed for implementation guidance.

- Key components, rules, and interactions
- Include a diagram if the design involves non-trivial flow, state, or structural relationships (apply `diagram-selection.md` criteria)
- Define boundaries: what this design owns vs. what it delegates to other components
- Review: Discuss with user

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Impact Assessment

Identify how this design decision affects other Areas and system parts.

- For each affected predefined Design Area, describe what changes or constraints this concern introduces
- If the concern is tightly coupled to another Area, propose a coordination boundary (similar to Coordination with Other Areas tables in other reference files)
- Note any Areas that will need to be revisited or amended as a result
- Confirm: Get user agreement on impact assessment

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 6: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: [Concern Name] Complete
- Announce: "[Concern Name] complete. Proceeding to next selected Design Area: [next area name]."

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

```markdown
# [Concern Name] Design

## 1. Concern Definition
What specific problem, question, or requirement does this design address?
Why was it surfaced? Which Area/Step triggered it?

## 2. Analysis and Options
2-3 potential strategies or patterns. Each with:
- Behavior description
- Pros and cons with consequences

## 3. Recommended Approach
Selected option with rationale.

## 4. Design Elaboration
Detailed description of the recommended approach:
- Key components, rules, interactions
- Diagrams if necessary (apply diagram-selection.md criteria)

## 5. Impacts and Dependencies
How does this decision affect other Design Areas or system parts?
```

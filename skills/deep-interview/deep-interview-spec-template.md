# Deep Interview Spec Template

```markdown
# Deep Interview Spec: {title}

## Metadata
- Interview ID: {uuid}
- Rounds: {count}
- Final Ambiguity Score: {score}%
- Type: greenfield | brownfield
- Generated: {timestamp}
- Threshold: {threshold}
- Initial Context Summarized: {yes|no}
- Status: {PASSED | BELOW_THRESHOLD_EARLY_EXIT}

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | {s} | {w} | {s*w} |
| Constraint Clarity | {s} | {w} | {s*w} |
| Success Criteria | {s} | {w} | {s*w} |
| Context Clarity | {s} | {w} | {s*w} |
| **Total Clarity** | | | **{total}** |
| **Ambiguity** | | | **{1-total}** |

## Goal
{crystal-clear goal statement derived from interview}

## Constraints
- {constraint 1}
- {constraint 2}
- ...

## Non-Goals
- {explicitly excluded scope 1}
- {explicitly excluded scope 2}

## Acceptance Criteria
- [ ] {testable criterion 1}
- [ ] {testable criterion 2}
- [ ] {testable criterion 3}
- ...

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| {assumption} | {how it was questioned} | {what was decided} |

## Approach & Design Decisions
- **Selected approach:** {chosen implementation direction}
- **Rejected alternatives:** {options considered but ruled out, and why}
- **Rationale:** {why the selected approach was chosen over alternatives}
- **Tradeoffs:** {what is gained and what is given up with this approach}

Downstream (prometheus) consumes this as a FIXED input — does not re-decide the approach. When a user-forced exit left a load-bearing HOW-fork unresolved, do NOT invent a Selected approach — record the fork under **Risks & Unresolved Forks** below.

## Risks & Unresolved Forks
- **Unresolved approach forks:** {load-bearing HOW-decisions left open at a user-forced exit — name the fork and its divergent options; empty if all forks were resolved}
- **Risks / open questions:** {known risks, advisory spec-reviewer notes carried forward, or assumptions not fully validated}

## Technical Context
{brownfield: relevant codebase findings from explore agent}
{greenfield: technology choices and constraints}

## Architecture
{overall structure: how the major components are arranged and how they relate to each other}

## Components
{each component: its single responsibility and direct dependencies}

## Data Flow
{sources → transformations → sinks: trace data from ingestion to output}

## Error Handling
{failure modes and their responses: what can go wrong and how the system handles it}

## Testing
{what is verified: behaviors, boundaries, and invariants covered by the test suite}

## Ontology (Key Entities)
{Fill from the FINAL round's ontology extraction, not just crystallization-time generation}

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| {entity.name} | {entity.type} | {entity.fields} | {entity.relationships} |

## Ontology Convergence
{Show how entities stabilized across interview rounds using data from ontology_snapshots in state}

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | {n} | {n} | - | - | - |
| 2 | {n} | {new} | {changed} | {stable} | {ratio}% |
| ... | ... | ... | ... | ... | ... |
| {final} | {n} | {new} | {changed} | {stable} | {ratio}% |

## Interview Transcript
<details>
<summary>Full Q&A ({n} rounds)</summary>

### Round 1
**Q:** {question}
**A:** {answer}
**Ambiguity:** {score}% (Goal: {g}, Constraints: {c}, Criteria: {cr})

...
</details>
```

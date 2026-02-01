# Record: [Topic Name]

> Date: YYYY-MM-DD
> Spec: {spec-name}
> Source: [Phase N (Phase Name) | Design Area: (Area Name)]

## Problem to Solve

[What problem were we trying to solve? What triggered this decision?]

## Decision Criteria

[Criteria this decision must satisfy]

- Criterion 1
- Criterion 2
- ...

## Considerations

[Context that influenced the decision - team experience, operational environment, cost, time constraints, etc.]

- Consideration 1
- Consideration 2
- ...

## Constraints

[Hard constraints that cannot be violated]

- Constraint 1
- Constraint 2
- ...

## Solutions Evaluated

### Option 1: [Name]

- **Description**: [What is this solution?]
- **Pros**:
  - Pro 1
  - Pro 2
- **Cons**:
  - Con 1
  - Con 2

### Option 2: [Name]

- **Description**: [What is this solution?]
- **Pros**:
  - Pro 1
  - Pro 2
- **Cons**:
  - Con 1
  - Con 2

[Add more options as needed]

## Final Decision

**Selected: [Option Name]**

- **Rationale**: [Why this option was chosen over others]
- **Identified Risks**: [What risks were accepted with this decision]
- **Risk Mitigation**: [How those risks will be managed]

## Learnings (optional)

[What did we learn from this decision process? Insights that might help future decisions.]

## Gotchas (optional)

[Pitfalls to watch out for. Things that might trip someone up later.]

---

## Record File Naming Convention

Records are saved to the `records/` folder within each step or Design Area directory.

### For Phases

**Pattern**: `p{phase}.{step}-{topic}.md`

**Examples**:
- `p1.2-scope-clarification.md` - Phase 1, Step 2 decision
- `p2.4-communication-pattern.md` - Phase 2, Step 4 decision

**Location**: `.omt/specs/{spec-name}/step-0{N}-{name}/records/`

### For Design Areas

**Pattern**: `da-{area-name}.{step}-{topic}.md`

**Examples**:
- `da-domain-model.2-aggregate-boundary.md` - Domain Model, Step 2 decision
- `da-data-schema.3-index-strategy.md` - Data Schema, Step 3 decision
- `da-interface-contract.4-error-handling.md` - Interface Contract, Step 4 decision
- `da-integration-pattern.2-communication-pattern.md` - Integration Pattern, Step 2 decision
- `da-operations-guide.1-metrics-selection.md` - Operations Guide, Step 1 decision

**Location**: `.omt/specs/{spec-name}/design-area-{name}/records/`

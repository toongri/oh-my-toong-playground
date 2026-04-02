# Record Workflow

When significant decisions are made during any area, capture them for future reference.

### When to Record

- Architecture decisions (solution selection, pattern choice)
- Technology selections (with rationale)
- Trade-off resolutions (what was sacrificed and why)
- Domain modeling decisions (aggregate boundaries, event choices)
- Any decision where alternatives were evaluated

## Decision Interview Protocol

**IRON RULE: No record without prior user interview.** Every recordable decision MUST be discussed with the user BEFORE creating a record.

### Protocol Flow

1. **Detect**: When any of the 9 Decision Recognition signals are identified, STOP current design work
2. **Present**: Present the tradeoff situation to the user using the Rich Context Pattern (Context → Tension → Options → Recommendation → AskUserQuestion) — see the inline Rich Context Pattern in SKILL.md (line 502)
3. **Consensus**: Wait for explicit user agreement on the chosen option
4. **Record**: THEN create the record using `templates/record.md` format, capturing the full interview context (options considered, tradeoffs, user's rationale)

The record is a **COMMITMENT DEVICE** — it captures not just WHAT was decided, but WHY, and confirms the user was part of the decision.

See `references/checkpoint-protocol.md` Decision Interview Gate for the checkpoint-level enforcement of this protocol.

### Decision Recognition Checklist

A statement is a **recordable decision** if ANY of these apply:

| Signal | Example | Why Recordable |
|--------|---------|----------------|
| Technology/tool selection | "Let's use Redis", "Go with Kafka Streams" | Technology choice with alternatives |
| Strategy/approach choice | "Idempotency via UUID" | Approach selected over alternatives |
| Priority/classification | "Split into P0/P1" | Affects scope and ordering |
| Scope inclusion/exclusion | "Drop the admin dashboard" | Scope boundary decision |
| Feature deferral | "Do that in the next release" | Timeline and scope impact |
| Architecture pattern | "Go with the hybrid approach" | Structural decision |
| Boundary definition | "Group under the same Aggregate" | Domain modeling decision |
| Elimination conclusion | Two options rejected → third selected | Implicit selection by elimination |
| Feedback incorporation | Reviewer concern accepted → design changed | Design modification through external review |

**Decisions often hide behind casual language:**
- "I think we can just do X" → This IS a decision, not a suggestion
- "Obviously it's X" → "Obviously" framing does NOT make it non-recordable
- "Just for reference, X" → Informational framing CAN contain decisions
- "Eh, we'll just do X" → Throwaway tone does NOT reduce significance
- "Let's drop/defer X" → Exclusions and deferrals ARE decisions

### How to Record

1. **Create record NOW — not later, not at Area completion, not in batches**: Record MUST be created at the Step where the decision was confirmed. Do NOT defer to next Step, do NOT batch with other decisions, do NOT wait for Area Checkpoint.
2. **Save location**: `$OMT_DIR/specs/{spec-name}/{area-directory}/records/{naming-pattern}.md`
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
- **Concern name**: Name of the identified concern
- **Discovery point**: Which Area and Step it was discovered in
- **Defer reason**: Why it is not addressed in the current spec
- **Follow-up needed**: Whether follow-up is required and recommended timing
- **Impact on current spec**: Impact on the current spec, if any

**Save location**: `$OMT_DIR/specs/{spec-name}/{current-area}/records/{step}-deferred-{concern-name}.md`

**Wrapup integration**: Deferred concern records are listed in Wrapup as a separate "Deferred Concerns" section.

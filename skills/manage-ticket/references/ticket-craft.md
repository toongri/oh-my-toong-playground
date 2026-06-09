# Ticket Craft — Quality and Slicing Rubric

This file is the authoritative craft rubric for the manage-ticket pipeline.
It is read at Stage 4 (record) and Stage 5 (slice). Follow it in full at each stage.

---

## 1. Best-Practice Body Shape

Every ticket body follows this structure. Sections that do not apply to a given ticket genre
are omitted rather than left blank.

### Standard Body Shape

| Section | Content |
|---|---|
| **Problem** | What user-observable or system-observable behavior is wrong or missing. One paragraph. |
| **Evidence** | Concrete data supporting the problem: logs, error messages, screenshots, metric readings, witness accounts. Direct quotes or paste, not paraphrase. |
| **Root Cause** | The underlying mechanism that produces the problem. Must be grounded in code, logs, or a reproducible trace — not speculation. If unknown, write `TBD — needs validation via {method}`. |
| **AC** | Acceptance criteria (see Section 2 below). At least one AC per ticket. |
| **Non-Goals** | What this ticket explicitly does NOT address. Prevents scope creep. |
| **References** | PRDs, design docs, Slack threads, incident records, code commits/PRs, and logs use markdown links. Related PM tickets are linked through the native relation step, not by duplicating the relationship in the body. PM-issue mentions that must appear in the body without becoming related use a form your PM tool does not auto-link into a relation, with a one-sentence note explaining why they are context rather than related-ticket links. |

### Bug-Genre Additions

Bug tickets add three fields, placed between Problem and AC:

| Field | Content |
|---|---|
| **Reproduction** | Minimal, numbered steps to trigger the bug. Include environment, preconditions, and the exact action sequence. |
| **Root Cause** | (promoted from standard, filled from Stage 3 code investigation output) |
| **Evidence** | Logs, stack traces, error output, or metric anomalies that confirm the symptom. |

For bug tickets the ordering is: Problem → Reproduction → Root Cause → Evidence → AC → Non-Goals → References.

### Anti-Fluff Rule

Missing information must be represented honestly. Do not invent plausible requirements.

> When a field cannot be filled from the gathered context, write:
> `TBD — needs validation via {method}`
>
> where `{method}` is the concrete method needed to fill it in (e.g., "TBD — needs validation via
> user interview", "TBD — needs validation via log inspection", "TBD — needs validation via
> reproduction attempt"). A `TBD` field is not a defect — it is an honest statement that
> blocks refuse-to-file only when the field is evidence-class (Root Cause with runtime-evidence
> claim, or Reproduction for a bug report with no reproducible scenario AND no log evidence AND
> no witness account).

---

## 2. Observable-AC Rubric

### Named Contract: prometheus two-line observable-AC contract

Each acceptance criterion is expressed in exactly this two-line shape:

```
- [ ] **[Observable outcome]**: WHAT state change is visible after completion
      **Verification**: HOW to confirm — executable command, observable behavior, or state assertion
```

One AC = one observable state change, confirmed by one Verification step. Compound ACs bundle
independent changes and must be decomposed.

### Action / Expected / Verification

Within the two-line shape, the content should satisfy three questions a reviewer can answer
from the AC text alone, without consulting the author:

- **Action**: what operation or event causes the state change?
- **Expected**: what observable result confirms the state change occurred?
- **Verification**: which specific command, query, or manual step confirms the expected result?

If a Verification step mutates persistent state (database rows, files, registered records),
the AC must also declare Setup and Cleanup steps, or rely on explicit isolation (ephemeral
schema, randomized IDs).

### Weasel-Word Prohibition

The following words are BANNED in an AC outcome or Verification description unless accompanied
by a concrete, measurable basis:

- `correctly`
- `securely`
- `fast`
- `robust`

A weasel-word AC is not an AC — it delegates "what counts as passing" to the executor and
produces un-observable criteria. Rewrite using observable terms: a response time threshold in
milliseconds, a specific HTTP status code, an exact field value, a grep match.

Permitted use: these words may appear in Non-Goals, problem descriptions, or explanatory prose
where they are not being used as a verification criterion.

### AC Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| File listing ("shared/lib/x.js created") | Implementation detail, not outcome | Outcome at consumer boundary + grep verification |
| Section adding ("Add ## Model section") | Action, not result | Behavioral outcome at the consumer |
| Vague verification ("Verify it works") | Not executable | Name command, state, or assertion |
| Weasel-word-only ("works correctly") | No observable basis | Measurable criterion (status code, field value, timing) |
| Task restatement ("Auth implemented") | Restates task | Observable consumer behavior |
| Compound AC | Bundles independent changes | Decompose per state change |
| Absence-only ("X not in grep") | Deletion alone passes | Presence checks first, then absence |

---

## 3. RCA Shape for Bug-Genre Tickets

### Named Contract: diagnose Bug-Report shape

When the ticket is a runtime bug, the Root Cause section uses this sub-template:

```
**Symptom**: What the caller observes.
**Root Cause**: The actual underlying issue — not the symptom. Must be grounded at a
               specific code location, log line, or reproducible mechanism.
**Reproduction**: Minimal steps to trigger. (For tickets that follow the §1 Bug-Genre body shape, this field is fulfilled by the top-level Reproduction section — reference it here rather than repeating the steps.)
**Fix direction**: Recommended change (direction only — implementation is downstream).
**Verification step**: How to confirm the fix worked.
**Similar issues**: Other places the same pattern may exist.
```

All six fields are required for bug-genre tickets. If any field cannot be filled from gathered
evidence, write `TBD — needs validation via {method}` rather than omitting the field or
speculating.

The Root Cause field must be grounded — a root cause that cannot be traced to code, logs, or
a reproducible trace is a refuse-to-file condition (see SKILL.md inline gate).

---

## 4. Model A INVEST Slice Rubric

### Slice Gate

INVEST is the slice gate. A ticket passes the gate if and only if it satisfies all six criteria
below. File-count and LOC atomicity are NOT the requirement-stage gate — those are Model-B
(work decomposition) signals, which belong to `prometheus` / `sisyphus` downstream.

### INVEST Checklist (Bill Wake)

| Criterion | Question | Passes when |
|---|---|---|
| **I — Independent** | Can this ticket be built and released without depending on another in-flight ticket? | Yes — no hard ordering dependency on sibling tickets |
| **N — Negotiable** | Can scope within this ticket be adjusted without invalidating the core value? | Yes — implementation approach is not locked |
| **V — Valuable** | Does this ticket deliver observable value to a user or system stakeholder on its own? | Yes — completable unit delivers stand-alone value |
| **E — Estimable** | Can the team form a reasonable size estimate from the ticket body alone? | Yes — enough context to size, even if rough |
| **S — Small** | Can this ticket be completed within one iteration/sprint? | Yes — bounded enough to finish in one cycle |
| **T — Testable** | Does the ticket carry observable ACs that can be verified by a defined method? | Yes — every AC has a Verification step |

Slice when the ticket fails **I, E, or S** (too large, too coupled, or too vague to size).
Slicing on V, N, or T alone is usually a rewrite of the body or AC rather than a structural split.

### Per-Child Stage-Check

After slicing, apply this check to each child ticket independently:

```
For each child:

  [ ] Is this child at "requirement-understanding" stage (WHAT is needed, solution open)?
      → Keep as Model-A WHAT-unit. Fill body shape and ACs without specifying HOW.

  [ ] Or has the solution for this child been decided ("implementation-planning" stage,
      HOW is known)?
      → This child is "settled". Hand off to `prometheus` (for planning) or `sisyphus`
        (for execution) as the next step. Do NOT emit Model-B implementation-path fields
        (filePaths, fixed architecture, DoR) here.
```

A partially-settled intake splits naturally: open sub-units stay as Model-A WHAT children;
settled sub-units receive a handoff recommendation rather than being pre-solved.

### Named Contract: sisyphus atomicity smell heuristics + dependency-ordering

When determining whether a candidate child ticket is atomic, apply these smell heuristics:

| Smell | Action |
|---|---|
| Ticket needs sequential delegations internally | Break into separate child tickets |
| Ticket touches unrelated concerns | Split by concern |
| Ticket description has "and" joining distinct deliverables | Split at the conjunction |
| Two child tickets modify the same domain object or module | MECE violation — merge or split by responsibility |
| Completed child tickets would not cover a requirement | Coverage gap — add a missing child |

Dependency ordering between child tickets uses blocked-by dependency links:
- A child that depends on another child's output is marked as blocked by the predecessor.
- Independent children carry no dependency link and can be executed in parallel.
- Circular dependency chains are forbidden.

### Model-A Purity Rules

Slice templates at requirement stage must NOT include:

- `filePaths` — specific file paths to edit (Model B, work decomposition)
- `DoR` (Definition of Ready) implementation fields
- Fixed-architecture fields that commit to a specific implementation structure
- Any field that "pre-solves" HOW the child will be implemented

These belong exclusively to `prometheus` (planning) and `sisyphus` (execution) after handoff.

### Settled Child Handoff

When a child is at implementation-planning stage (HOW is decided):

1. Record the settled decision in the child ticket body (under a "Design Decision" note, not in an implementation-path field).
2. State in the ticket: "Handoff to `prometheus` for planning" or "Handoff to `sisyphus` for execution".
3. Do not emit Model-B decomposition. The handoff target owns that decomposition.

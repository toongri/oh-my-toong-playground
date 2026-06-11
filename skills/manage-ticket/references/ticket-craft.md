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
| **Pre-Context** | Background facts on scope and risk the reader needs before implementation begins — three sub-items (**Affected Areas**, **Premises**, **Blockers & Risks**). See Pre-Context Rules below. |
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

For bug tickets the ordering is: Problem → Reproduction → Root Cause → Evidence → Pre-Context → AC → Non-Goals → References.

### Pre-Context Rules

Pre-Context applies to all ticket genres. For non-code tickets, fill each sub-item from gathered documents or mark `TBD — needs validation via {method}`.

The three sub-items are:

- **Affected Areas** — modules, flows, or domains likely impacted by this requirement; file-level references are permitted when investigation confirmed them.
- **Premises** — what must currently be true about the system for this requirement to make sense (e.g., "stock decrement happens only at dispense time").
- **Blockers & Risks** — upstream dependencies, potential blocking points, and open questions; observations only, never solution proposals.

Every sub-item must carry either an evidence citation (investigation result, document, commit) or the marker `TBD — needs validation via {method}`. An unbacked assertion is a rule violation.

### Parent-Ticket Body Shape

A parent ticket is one that remains as the umbrella after Stage 5 slicing has produced child tickets. Its body does not duplicate child bodies — it carries the shared context that children rely on and reference, not their individual Problem/Pre-Context/AC.

After slicing, the relationship rule is: shared context lives in the parent ONCE. Each child ticket states its own Problem, Pre-Context, AC, and Non-Goals, and references the parent for shared definitions. Children do not re-define terms or re-state scope that is already in the parent.

| Section | Required / Conditional | Content |
|---|---|---|
| **Background** | Required | Why now — the motive, triggering events, and prior state that make this work necessary at this moment. One to two paragraphs. |
| **Core Concept** | Conditional — when children share a term or model that must not drift | A single authoritative definition of the umbrella concept the children rely on. Children reference the parent for this definition instead of re-stating it. Example pattern: a new payment brand is defined once in the parent ("the umbrella bundles payment method A for personal cards and payment method B for corporate cards; method B is never retired from the platform"), so five child tickets can reference the parent rather than each carrying its own definition — preventing drift and contradiction. Omit if each child's scope is self-contained enough that no shared concept needs protection. |
| **Pre-Context** | Required | Same three sub-items as the Standard Body Shape (**Affected Areas**, **Premises**, **Blockers & Risks**), each carrying an evidence citation or `TBD — needs validation via {method}`. Apply the two-bucket presentation rule (see below) per its own trigger condition. |
| **Affected Areas — expected** | Required when code-touching | Where work is expected to land across the child set. Must be explicitly hedged: parent-level affected areas are forecasts as of the planning moment, not commitments — they may change as child investigation proceeds. Example: "Expected to touch `payments/gateway/` and `user/billing/`; exact scope confirmed per child." |
| **User Value** | Conditional — user-facing work | What the user gains from the parent initiative as a whole. One to two sentences. |
| **User Flow: current → after** | Conditional — transition genre (see Transition-Genre Additions below) | A compact before/after contrast of the user-visible or system-visible path, applied at the parent level when the initiative as a whole is a behavior change or migration. |
| **Scope of Application** | Required | Who or what converts to the new path and who or what intentionally stays on the old path. Must be explicit on both sides — "new registrations use the new path; existing users keep the old path, no forced migration" is the pattern. Omit neither side. |
| **Decisions Needed** | Required when open decisions exist | Open product or policy decisions that block or shape child work (see Decisions Needed definition below). Omit when no open decisions remain at the time of filing. |
| **Notes** | Optional | Provenance, superseded prior attempts, and context that does not fit elsewhere. |
| **References** | Required | Per the existing References rules in the Standard Body Shape. |

### Two-Bucket Pre-Context Presentation Rule

When the Pre-Context section holds more than a couple of items within any one sub-item (**Affected Areas**, **Premises**, or **Blockers & Risks**), group them into two labeled buckets:

- **Confirmed Facts** — each item cites the evidence that confirmed it: an investigation result, a document reference, a code location, a commit. An item belongs here only when it is backed.
- **Needs Verification** — each item states what is open and what method would resolve it. Use the existing marker form: `TBD — needs validation via {method}`.

This is a presentation rule layered on the existing per-item evidence-or-`TBD` requirement — the underlying rule is unchanged. When Pre-Context is short (two items or fewer per sub-item), the two-bucket grouping is optional. The buckets apply to both the Standard Body Shape and the Parent-Ticket Body Shape.

### Transition-Genre Additions

Tickets whose substance is a behavior or path change — migration, switchover, replacement, or a shift in the default flow — add one field, placed before AC:

| Field | Content |
|---|---|
| **User Flow: current → after** | A compact before/after contrast of the user-visible or system-visible path. Describe what the flow IS now and what it becomes after the ticket is complete. Keep it observational: record the path change, not the implementation that produces it. |

The intent ban applies: this section records what changes from the user or system perspective, not how it will be built. "Before: new users are directed to onboarding screen A. After: new users are directed to onboarding screen B" is permitted. "Implement a redirect from screen A to screen B using router hook X" is not.

For parent tickets, the User Flow: current → after section captures the initiative-level path change. Child tickets may carry their own User Flow section if their individual slice represents a distinct behavior change, or omit it if the parent's section covers their scope.

### Decisions Needed

A **Decisions Needed** section is a list of open product or policy decisions that block or shape work. Each entry names the decision and the ticket or owner it is delegated to for resolution.

**Entries must not pre-solve.** The Model-A intent ban applies: naming the open question and its owner is allowed; embedding the answer is not. "Whether method B cards should be retired for existing users — delegated to `[design-ticket-id]`" is a valid entry. "Method B cards will be retired; see `[design-ticket-id]` for details" is a violation.

**Distinguish from `TBD`:** `TBD — needs validation via {method}` marks a missing **fact** in a body field (a premise that can be confirmed by investigation). Decisions Needed lists open **decisions** that require a product or policy call, not just investigation. The two mechanisms are complementary — a Decisions Needed entry may reference a TBD that will be resolved once the decision is made.

At the parent level, Decisions Needed lists decisions that affect multiple children. At the child level, a Decisions Needed entry is permitted when a decision affects only that child and has not yet been resolved.

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
        (for execution) as the next step. Do NOT emit fields that decide or fix the
        implementation method (fixed-architecture commitments, DoR implementation fields,
        prescriptive edit instructions) here. Observational pre-context remains allowed.
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

The test is **intent, not form**: does the text close HOW decisions, or record current-state observations?

**Banned** — fields or prose that decide or fix the solution or implementation method:
- Fixed-architecture commitments ("use service X", "add column Y to table Z")
- DoR implementation fields that prescribe a specific construction approach
- Prescriptive edit instructions ("edit file X to do Y", "replace function F with G")
- Any field whose purpose is to pre-solve HOW the child will be implemented

**Permitted** — observational, evidence-backed pre-context, including file-level references:
- "Module `dispatch/stock.ts` looks likely to be affected — confirmed by Stage 3 investigation"
- "Could block if the retry queue is not idempotent — needs verification via load test"
- Pre-Context sub-items (Affected Areas, Premises, Blockers & Risks) filled from investigation results

The rule's motive: WHAT is decided here; HOW belongs to `prometheus` (planning) and `sisyphus` (execution) after handoff. Recording where a requirement lands and what premises must hold is not pre-solving — it reduces PM round-trips and gives workers a confirmed starting point.

### Settled Child Handoff

When a child is at implementation-planning stage (HOW is decided):

1. Record the settled decision in the child ticket body (under a "Design Decision" note, not in an implementation-path field).
2. State in the ticket: "Handoff to `prometheus` for planning" or "Handoff to `sisyphus` for execution".
3. Do not emit fields that fix the implementation method (Model-B decomposition). The handoff target owns that decomposition. Observational pre-context already recorded in the body remains intact.

# Issue Craft — Quality and Slicing Rubric

This file is the authoritative craft rubric for the craft-issue pipeline.
It is read at Stage 4 (record) and Stage 5 (slice). Follow it in full at each stage.

---

## 1. Best-Practice Body Shape

The Standard Body Shape below is the **full menu** of sections. Two principles govern how much of
that menu a given issue emits — read them before the menu, because most issues use far less than
the full set. Sections that do not apply to a given issue genre are omitted rather than left blank.

### Working-Language Localization

Section headers and standard labels render in the issue's **working language**, not in the canonical
English this rubric uses for universality. Match the language of the sibling issues in the same
project/epic — when the siblings are Korean, the new issue is Korean, headers included. For
Korean-working teams, use this canonical mapping:

| Rubric (canonical EN) | Emitted header (KO) |
|---|---|
| Problem | 문제 |
| Pre-Context | 사전 확인 |
| AC | 완료 조건 |
| (AC) Verification | 검증 |
| Non-Goals | 범위 제외 |
| Post-Release Observation | 배포 후 관찰 |
| User Flow: current → after | 전환 방식 / 동선 변화 |
| Decisions Needed | 결정 필요 |
| References | References (그대로 둔다) |

The observable-AC two-line shape (§2) is unchanged — only its labels localize: `**[결과]**` + `**검증**`.

### Lean by Default, Escalate on Need

The **default** body is the minimal set — **Problem → (사전 확인) → AC → Non-Goals → References** —
where 사전 확인 is a single **flat bullet list** that folds supporting evidence, affected areas, and
premises in as plain prose. This default fits most feature, transition, and improvement issues, and
is the house norm: a reader should see four-to-five short sections, not a scaffold.

The heavier machinery in this rubric is **escalation** — added only when the issue genuinely needs
it, never as a reflex:

| Escalation section | Add only when |
|---|---|
| separate **Evidence** section | bug-genre issue where logs / stack-trace / repro are the spine. Non-bug: fold the one or two facts into Problem or 사전 확인. |
| structured 3-sub-item **Pre-Context** (Affected Areas / Premises / Blockers & Risks) | parent/umbrella issue, or an issue with many (>~5) cross-cutting facts a flat list would muddle. |
| **two-bucket** Confirmed-Facts / Needs-Verification grouping | the structured Pre-Context above is already in use AND a sub-item holds 3+ items. |
| **Decisions Needed** | an open product/policy decision actually blocks or shapes the work. |
| **Notes** | provenance (superseded attempts, deep-interview artifact path) that has no other home. |
| **Post-Release Observation** | the issue moves a measurable outcome (adoption, conversion, adherence, latency, error rate — Form 1), OR the change implies a checkable expectation about logs / data / state to confirm after release (Form 2). Omit only when neither holds — a pure capability / readability refactor / infra issue whose value is fully delivered the moment its ACs pass. |

The test before emitting any escalation section: *would a lean sibling issue in this epic carry it?*
If the house siblings stay flat, match them — do not emit scaffolding the reader skims past. A
straightforward child issue carrying Evidence + 3-sub-item Pre-Context + two buckets + Decisions
Needed + Notes is over-built; collapse it to the lean default.

### Standard Body Shape

| Section | Content |
|---|---|
| **Problem** | What user-observable or system-observable behavior is wrong or missing. One paragraph. |
| **Evidence** | Concrete data supporting the problem: logs, error messages, screenshots, metric readings, witness accounts. Direct quotes or paste, not paraphrase. |
| **Root Cause** | The underlying mechanism that produces the problem. Must be grounded in code, logs, or a reproducible trace — not speculation. If unknown, write `TBD — needs validation via {method}`. |
| **Pre-Context** | Background facts on scope and risk the reader needs before implementation begins — three sub-items (**Affected Areas**, **Premises**, **Blockers & Risks**). See Pre-Context Rules below. |
| **AC** | Acceptance criteria (see Section 2 below). At least one AC per issue. |
| **Post-Release Observation** | What is watched after release — an aspirational outcome metric and/or a falsifiable predicted post-release state (value, movement, invariant, or success log) — distinct from AC, which only confirms the change was built. Escalation section; see Post-Release Observation Section below. |
| **Non-Goals** | What this issue explicitly does NOT address. Prevents scope creep. |
| **References** | PRDs, design docs, Slack threads, incident records, code commits/PRs, and logs use markdown links. Related PM issues are linked through the native relation step, not by duplicating the relationship in the body. PM-issue mentions that must appear in the body without becoming related use a form your PM tool does not auto-link into a relation, with a one-sentence note explaining why they are context rather than related-issue links. |

### Bug-Genre Additions

Bug issues add three fields, placed between Problem and AC:

| Field | Content |
|---|---|
| **Reproduction** | Minimal, numbered steps to trigger the bug. Include environment, preconditions, and the exact action sequence. |
| **Root Cause** | (promoted from standard, filled from Stage 3 code investigation output) |
| **Evidence** | Logs, stack traces, error output, or metric anomalies that confirm the symptom. |

For bug issues the ordering is: Problem → Reproduction → Root Cause → Evidence → Pre-Context → AC → Post-Release Observation → Non-Goals → References. Post-Release Observation appears only when its escalation trigger holds — for a bug, the production symptom-rate floor (see the Post-Release Observation Section); omit it when the fix's value is fully delivered the moment the Reproduction re-run passes.

### Pre-Context Rules

Pre-Context applies to all issue genres. Its **default rendering is the flat 사전 확인 list** (Lean by Default, above) — the three labeled sub-items below are the *escalated* form, used only for parent/umbrella or fact-heavy issues. For non-code issues, fill the context (flat list or sub-items) from gathered documents or mark `TBD — needs validation via {method}`.

The three sub-items are:

- **Affected Areas** — modules, flows, or domains likely impacted by this requirement; file-level references are permitted when investigation confirmed them.
- **Premises** — what must currently be true about the system for this requirement to make sense (e.g., "stock decrement happens only at dispense time").
- **Blockers & Risks** — upstream dependencies, potential blocking points, and open questions; observations only, never solution proposals.

Every sub-item must carry either an evidence citation (investigation result, document, code location, commit) or the marker `TBD — needs validation via {method}`. An unbacked assertion is a rule violation.

### Parent-Issue Body Shape

A parent issue is one that remains as the umbrella after Stage 5 slicing has produced child issues. Its body does not duplicate child bodies — it carries the shared context that children rely on and reference, not their individual Problem/Pre-Context/AC.

After slicing, the relationship rule is: shared context lives in the parent ONCE. Each child issue states its own Problem, Pre-Context, AC, and Non-Goals, and references the parent for shared definitions. Children do not re-define terms or re-state scope that is already in the parent.

| Section | Required / Conditional | Content |
|---|---|---|
| **Background** | Required | Why now — the motive, triggering events, and prior state that make this work necessary at this moment. One to two paragraphs. |
| **Core Concept** | Conditional — when children share a term or model that must not drift | A single authoritative definition of the umbrella concept the children rely on. Children reference the parent for this definition instead of re-stating it. Example pattern: a new payment brand is defined once in the parent ("the umbrella bundles payment method A for personal cards and payment method B for corporate cards; method B is never retired from the platform"), so five child issues can reference the parent rather than each carrying its own definition — preventing drift and contradiction. Omit if each child's scope is self-contained enough that no shared concept needs protection. |
| **Pre-Context** | Required | Same three sub-items as the Standard Body Shape (**Affected Areas**, **Premises**, **Blockers & Risks**), each carrying an evidence citation or `TBD — needs validation via {method}`. Apply the two-bucket presentation rule (see below) per its own trigger condition. |
| **Affected Areas — expected** | Required when code-touching | Where work is expected to land across the child set. Must be explicitly hedged: parent-level affected areas are forecasts as of the planning moment, not commitments — they may change as child investigation proceeds. Example: "Expected to touch `payments/gateway/` and `user/billing/`; exact scope confirmed per child." |
| **User Value** | Conditional — user-facing work | What the user gains from the parent initiative as a whole. One to two sentences. |
| **User Flow: current → after** | Conditional — transition genre (see Transition-Genre Additions below) | A compact before/after contrast of the user-visible or system-visible path, applied at the parent level when the initiative as a whole is a behavior change or migration. |
| **Scope of Application** | Conditional — transition genre (see Transition-Genre Additions below) | Who or what converts to the new path and who or what intentionally stays on the old path. Must be explicit on both sides — "new registrations use the new path; existing users keep the old path, no forced migration" is the pattern. Omit neither side. |
| **Post-Release Observation** | Conditional — the initiative as a whole moves a shared outcome, or has a shared predicted post-release state | The initiative-level observation (Form 1 and/or Form 2 per the Post-Release Observation Section), declared once in the parent like Core Concept; children reference it rather than each re-declaring, unless a child owns a distinct sub-outcome. Omit when no shared post-release observation applies. |
| **Decisions Needed** | Required when open decisions exist | Open product or policy decisions that block or shape child work (see Decisions Needed definition below). Omit when no open decisions remain at the time of filing. |
| **Notes** | Optional | Provenance, superseded prior attempts, and context that does not fit elsewhere. |
| **References** | Required | Per the existing References rules in the Standard Body Shape. |

### Two-Bucket Pre-Context Presentation Rule

When the Pre-Context section holds more than a couple of items within any one sub-item (**Affected Areas**, **Premises**, or **Blockers & Risks**), group them into two labeled buckets:

- **Confirmed Facts** — each item cites the evidence that confirmed it, per the Pre-Context evidence contract above. An item belongs here only when it is backed.
- **Needs Verification** — each item states what is open and what method would resolve it. Use the existing marker form: `TBD — needs validation via {method}`.

This is a presentation rule layered on the existing per-item evidence-or-`TBD` requirement — the underlying rule is unchanged. When Pre-Context is short (two items or fewer per sub-item), the two-bucket grouping is optional. The buckets apply to both the Standard Body Shape and the Parent-Issue Body Shape.

### Transition-Genre Additions

Issues whose substance is a behavior or path change — migration, switchover, replacement, or a shift in the default flow — add one field, placed before AC:

| Field | Content |
|---|---|
| **User Flow: current → after** | A compact before/after contrast of the user-visible or system-visible path. Describe what the flow IS now and what it becomes after the issue is complete. Keep it observational: record the path change, not the implementation that produces it. |

The intent ban applies: this section records what changes from the user or system perspective, not how it will be built. "Before: new users are directed to onboarding screen A. After: new users are directed to onboarding screen B" is permitted. "Implement a redirect from screen A to screen B using router hook X" is not.

For parent issues, the User Flow: current → after section captures the initiative-level path change. Child issues may carry their own User Flow section if their individual slice represents a distinct behavior change, or omit it if the parent's section covers their scope.

### Post-Release Observation Section

An AC confirms the change was **built** (acceptance-time: run the command, the state holds). It does **not**
confirm what happens **after release** — an issue can pass every AC and still fail to move the outcome it
exists for, or fail to shift production data the way the change predicts. That gap is filled by a
**Post-Release Observation** section (KO header: 배포 후 관찰). This is a body section, **not an AC**: its
observation happens after release, over a window, so it cannot gate acceptance and must not be forced into the
§2 two-line AC shape.

It takes one of **two forms**, and an issue may carry both:

**Form 1 — Outcome metric (결과 지표, aspirational).** Used when the issue's purpose is to move a product or
system value outcome. Records, all at the WHAT level:

- **Outcome metric** — the observable signal whose movement proves the value materialized (e.g., "daily
  adherence rate among targeted users", "checkout conversion", "p95 latency", "error-rate of the affected
  endpoint").
- **Target / direction** — a threshold or a direction-vs-baseline. Concrete figure when one is set; otherwise
  `TBD — needs validation via {method}`. The §2 weasel-word prohibition applies — "improves" alone is not a
  target; "increases vs. the pre-release baseline" is.
- **Observation method + window** — how and when the metric is read after release (e.g., "Amplitude cohort
  comparison vs. the prior 4 weeks, read 4 weeks post-rollout").

**Form 2 — Predicted post-release state (예측된 배포 후 상태, falsifiable).** Used when the change implies a
*checkable expectation about logs, data, or state* after release — the expectation is **derived from the
change**, and a query or log read confirms it over a window. This is a correctness check, not a value
judgment. It takes one or more of these shapes (usually a conjunction):

- **reaches a value / state** — "field X becomes 'Balance'", "the legacy-row count becomes 0", "the daily
  discrepancy count converges to ~0".
- **moves by a derived magnitude** — "weekly trigger count rises by ≈ N (computed from a pre-deploy snapshot),
  then returns to the prior baseline".
- **holds an invariant (does not change)** — "rows that do not match the condition are left unchanged".
- **executes / logs success** — "the nightly job logs a success completion on every scheduled run". This is
  the *weakest* shape alone — it confirms the job ran, not that the data is right; when the data effect is
  queryable, pair it with a value/invariant check rather than resting on the log. For a recurring job,
  "keeps logging success across the window" is a real ongoing confirmation (it can silently stop in prod),
  distinct from the one-time "it ran once" you check at acceptance.

Records, whichever shapes apply:

- **Expected condition** — the post-release state, derived from the change (value / magnitude / invariant /
  success-log, usually combined).
- **Confirmation query or log + window** — the concrete query or log read that confirms it after release, and
  the window to read it over (e.g., "OpenSearch daily discrepancy-count over 7–14 days post-deploy"; "DB count
  of legacy rows right after the migration job's success log").
- **Falsification clause** — if the observed state does not match the expectation (beyond a stated tolerance
  where a magnitude is involved), the change did **not** behave as designed → investigate. (Contrast Form 1,
  where missing the target is a value disappointment, not a defect.)
- **Pairs with an acceptance-time AC** when a baseline or expected value must be captured before deploy: make
  "compute and record the expected value/delta from query Z before deploy" an AC (it is runnable now), and let
  Form 2 assert the post-release state against it.

Beware a **self-referential** Form-2 signal: when the change both produces and measures it (a job that
corrects the very count it reports), convergence proves the mechanism ran, not that the value moved — pair it
with a Form 1 outcome.

Distinguish Form 2 from `TBD — needs validation via {method}`: a `TBD` marks a **fact missing at filing
time**; a Form-2 prediction is a **stated expectation to confirm after release**. They are different states —
do not collapse a prediction into a TBD.

**Model-A boundary** (both forms). The section names the metric/prediction and how it will be observed — it
does **not** specify instrumentation, event schemas, or dashboard construction ("add event E with property P",
"build dashboard D" is HOW — Model-B work for `prometheus` / `sisyphus` downstream). And — **for Form 1
only** — a "the code ran" count is not a value outcome: a sent push or a fired trigger proves the feature
executed, not that adherence or conversion moved, so do not pass an execution count off as a Form-1 metric.
(In Form 2 a success log is a legitimate confirmation shape — just the weakest, per its bullet above.)

For a **bug-genre** issue, the observation is the production symptom rate falling to its expected floor (e.g.,
"the stack-trace count for this error drops to ~0 in OpenSearch over 7 days post-deploy"), distinct from the
acceptance-time AC (the Reproduction re-run now passes).

For a **sliced initiative**, the initiative-level observation lives once in the parent (like Core Concept);
children reference it rather than each re-declaring it, unless a child owns a distinct sub-outcome.

### Decisions Needed

A **Decisions Needed** section is a list of open product or policy decisions that block or shape work. Each entry names the decision and the issue or owner it is delegated to for resolution.

**Entries must not pre-solve.** The Model-A intent ban applies: naming the open question and its owner is allowed; embedding the answer is not. "Whether method B cards should be retired for existing users — delegated to `[design-issue-id]`" is a valid entry. "Method B cards will be retired; see `[design-issue-id]` for details" is a violation.

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

## 3. RCA Shape for Bug-Genre Issues

### Named Contract: diagnose Bug-Report shape

When the issue is a runtime bug, the Root Cause section uses this sub-template:

```
**Symptom**: What the caller observes.
**Root Cause**: The actual underlying issue — not the symptom. Must be grounded at a
               specific code location, log line, or reproducible mechanism.
**Reproduction**: Minimal steps to trigger. (For issues that follow the §1 Bug-Genre body shape, this field is fulfilled by the top-level Reproduction section — reference it here rather than repeating the steps.)
**Fix direction**: Recommended change (direction only — implementation is downstream).
**Verification step**: How to confirm the fix worked.
**Similar issues**: Other places the same pattern may exist.
```

All six fields are required for bug-genre issues. If any field cannot be filled from gathered
evidence, write `TBD — needs validation via {method}` rather than omitting the field or
speculating.

The Root Cause field must be grounded — a root cause that cannot be traced to code, logs, or
a reproducible trace is a refuse-to-file condition (see SKILL.md inline gate).

**The bug issue's primary AC is the negation of its Reproduction.** In the §2 two-line shape,
the outcome is that the Reproduction steps now yield the Expected result instead of the Symptom,
and the Verification re-runs those steps. The Reproduction is the single source of the
fix-verification procedure: the RCA `Verification step` above points to that same re-run rather
than a separate check, and the AC must not fall back to a generic "works correctly" (a §2
weasel-word violation). When the Root Cause is hypothesis-grade (`TBD — needs validation via
{method}`), the provisionality stays on the Root Cause — **not** on the AC. The AC's Verification
remains the Reproduction re-run: a defined, executable method that satisfies the `Un-observable AC`
gate (SKILL.md). So a reproducible bug always carries an actionable AC even while its cause is
unconfirmed — and a bug with no reproduction is already refused upstream by the `No consistent
reproduction` gate, so the re-run is always available when an AC is written.

---

## 4. Model A INVEST Slice Rubric

### Slice Gate

INVEST is the slice gate. An issue passes the gate if and only if it satisfies all six criteria
below. File-count and LOC atomicity are NOT the requirement-stage gate — those are Model-B
(work decomposition) signals, which belong to `prometheus` / `sisyphus` downstream.

### INVEST Checklist (Bill Wake)

| Criterion | Question | Passes when |
|---|---|---|
| **I — Independent** | Can this issue be built and released without depending on another in-flight issue? | Yes — no hard ordering dependency on sibling issues |
| **N — Negotiable** | Can scope within this issue be adjusted without invalidating the core value? | Yes — implementation approach is not locked |
| **V — Valuable** | Does this issue deliver observable value to a user or system stakeholder on its own? | Yes — completable unit delivers stand-alone value |
| **E — Estimable** | Can the team form a reasonable size estimate from the issue body alone? | Yes — enough context to size, even if rough |
| **S — Small** | Can this issue be completed within one iteration/sprint? | Yes — bounded enough to finish in one cycle |
| **T — Testable** | Does the issue carry observable ACs that can be verified by a defined method? | Yes — every AC has a Verification step |

Slice when the issue fails **I, E, or S** (too large, too coupled, or too vague to size).
Slicing on V, N, or T alone is usually a rewrite of the body or AC rather than a structural split.

When the gate fires, slicing is a **write action**: create the children in the PM tool in the write tail (parent + blocked-by), not as a "proposed split" section in the parent body — see SKILL.md Stage 5 "Slicing means CREATING the child issues" for the loophole-closure rule and rationalization table.

### Slice Unit — what one child is (and where to stop)

One child = the **smallest vertical slice that still passes the value test**: *"if this child is completed and nothing else, is a user or system stakeholder observably better off?"* Yes → valid child (a story). No → it is a **task** (an implementation step with no stand-alone value): do not give it its own issue — fold it into the child whose value it serves. Few deep value-bearing children beat many shallow step-children — the deep-modules rule (`coding-discipline.md` §4) applied to issues. **This is the precise meaning of "don't over-fragment": stop slicing at the value test, not at some file/LOC count.**

**Borderline default = fold.** A calc, fetch, guard, hardening, or enabler that becomes meaningful only once a sibling exists is a **task by default** — fold it into the story it serves. Give it its own child ONLY when a *recorded product decision* deliberately ships the story first and schedules this separately (e.g. "ship core push now, add dedup hardening as a separately-prioritized follow-up"). "The first version works without it", "it's a separate concern", "it's a business rule", or "the work is sequential" are NOT that decision — absent an explicit recorded deferral, fold. This default is what makes two slicers land on the same grain instead of one cutting 1 child and another cutting 3.

**Cut by user/business value, never by technical layer or platform.** Splitting one feature into "mobile child + web child + backend child" (or "UI + API + DB") is the horizontal-slice anti-pattern — each piece is worthless until the last integrates, so it fails **Independent** + **Valuable** and forces sequential ordering. Slice the feature as a thin capability that runs end-to-end through whatever layers/platforms it needs. A platform/interface split is a valid issue split ONLY when each platform slice independently delivers user value as a deliberate product decision (e.g. mobile-first launch); otherwise it is ONE issue with a blocked-by ordering inside it, not two issues.

**Where to cut** — find the dimension of variation that makes the issue big and reduce it to one instance: workflow step · operation (CRUD) · business-rule variation · data variation · interface/input method · simple-vs-complex · defer non-functional · spike (SPIDR / Humanizing Work patterns). **Phrasing test** (Killick): a child names a *capability* a user gains ("a buyer can find products by brand"), not a step toward a chosen solution ("build the search endpoint") — the latter is a task masquerading as a child.

### Per-Child Stage-Check

After slicing, apply this check to each child issue independently:

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

### Candidate-seam heuristics (SECONDARY to the value test) + dependency-ordering

These heuristics locate where an issue *could* be divided. They are **secondary to the Slice Unit value test, never parallel to it**: a candidate seam becomes its own child ONLY if each resulting side independently passes **V**. A side that fails V is a task — fold it, even when the work is internally sequential or joined by "and". Splitting a value-less step because the work is sequential is Model-B work decomposition; it belongs to `prometheus`/`sisyphus` downstream, not to requirement-stage issue slicing.

| Smell | Action (apply only after each side independently passes V) |
|---|---|
| Issue needs sequential delegations internally | Candidate seam — but sequential work alone is NOT a split reason. Split only if each step independently passes V; a value-less step (calc, fetch, guard) stays folded. |
| Issue description has "and" joining distinct deliverables | Candidate seam at the "and" — split only if BOTH sides independently pass V; otherwise one side is a task of the other. |
| Issue touches genuinely unrelated concerns, each independently valuable | Split by concern. |
| Two child issues modify the same domain object or module | MECE violation — merge or split by responsibility. |
| Completed child issues would not cover a requirement | Coverage gap — add a missing child. |

Dependency ordering between child issues uses blocked-by dependency links:
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

1. Record the settled decision in the child issue body (under a "Design Decision" note, not in an implementation-path field).
2. State in the issue: "Handoff to `prometheus` for planning" or "Handoff to `sisyphus` for execution".
3. Do not emit fields that fix the implementation method (Model-B decomposition). The handoff target owns that decomposition. Observational pre-context already recorded in the body remains intact.

---
name: goal
description: Autonomous objective-pursuit orchestrator — wraps deep-interview/prometheus/sisyphus, then re-pursues the objective across plan/execute cycles until an objective-level argus completion gate confirms the verification surface is met.
---

<Role>

# Goal — Autonomous Objective-Pursuit Orchestrator

Turn the one-shot pipeline deep-interview → prometheus → sisyphus into an autonomous loop that re-pursues a single OBJECTIVE across plan/execute cycles until completion is proven.

**Design philosophy: autonomy is post-planning.** Planning carries human gates; those gates run UN-wrapped. The autonomy begins after planning, during pursuit. The single load-bearing invariant of the whole design: **the loop never false-completes.** Every state-write or verdict-write failure degrades toward continue-pursuit or block — never toward a claimed completion.

</Role>

## State CLI

The autonomous loop is gated by a session-keyed state file driven through the bundled CLI. Reference it ONLY via the skill-dir variable, never CWD-relative:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts <subcommand> [options]
```

Subcommands used by this orchestrator:

| Subcommand | Authority | Purpose |
|------------|-----------|---------|
| `set --phase <planning\|pursuing> [slot flags…]` | orchestrator | Seed/advance phase; carries the slot values. Accepts ONLY `planning`/`pursuing` — it can never write `complete`, and on `planning` it resets the verdict to `absent`. |
| `set-verdict --verdict <APPROVE\|REQUEST_CHANGES\|COMMENT\|absent>` | gate layer | The ONLY writer of `objective_verdict`. |
| `request-complete` | gate layer | The ONLY path to `phase=complete`; structurally gated on completion-evidence being present and `objective_verdict=APPROVE`. |
| `get` / `status` | read | Inspect current state / derived status. |

`set-budget-limited` and `set-blocked --reason <text>` are system-only setters (the hook layer writes `budget_limited`; `set-blocked` records a reported blocker). The orchestrator never writes `complete`, `budget_limited`, or a fabricated verdict by any other route — the narrow gates are structural, not vigilance-based.

---

## Entry Gate

A goal is only worth pursuing autonomously if "done" is decidable. **Falsifiability trigger: refuse to start pursuit unless the request carries a falsifiable objective — a concrete verification surface a machine can check (a test, a benchmark, an artifact, an observable end state).** "Make it better", "improve performance", "clean this up" with no verification surface are NOT pursuable objectives. When the verification surface is absent or vague, do NOT begin orchestration and do NOT advance state beyond the pristine seed (no `set` call); a pristine seed left untouched is inert — hooks ignore it and the lifecycle GC reaps it by TTL.

On a non-falsifiable request, take exactly ONE of these two remediation outcomes:

- **deep-interview supplementation** — when the objective is rich but under-specified (the verification surface can be derived through questioning), invoke `Skill(skill: "deep-interview")` to crystallize a spec whose acceptance criteria become the verification surface. Resume the Entry Gate against the crystallized spec.
- **ask-user** — when a single missing fact would make the objective falsifiable (the user can state the success criterion in one sentence), ask the user directly for the verification surface before proceeding.

**Re-invocation refusal.** Before seeding anything, read state via `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts get`. If the result is `active: true` AND `pristine: false`, REFUSE to start a second pursuit — report the active objective and its phase, and stop. A second concurrent goal is never seeded over a non-pristine active one. A `pristine: true` result means the state was freshly seeded by this very invocation's PreToolUse hook — proceed normally. (Terminal states read as inactive and do not block a fresh goal.)

**Continuation intent.** When the user's invocation expresses explicit continuation intent — e.g. "하던 거 계속", "continue what I was doing", "resume the previous goal" — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts list-others
```

If candidates exist, present them via AskUserQuestion with one option per candidate (labeled with the candidate's purpose and age — e.g. "ship X — started 2026-06-10, 3 hours idle"), plus a "start fresh" option. Proceed to the next step ONLY on an explicit user selection:

- On candidate selection: run `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts adopt --src <selected-sid>`, then run `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts get` to read what was adopted, and resume from the restored state — if `phase` is `planning`, resume planning from the stored `plan_path`/`resume_summary`; if `phase` is `pursuing`, continue pursuit at the adopted `iteration`. Do NOT re-seed via `set --phase planning` from the new invocation's text.
- On "start fresh": proceed as a new goal.

If no candidates exist, say so and proceed fresh. The branch never renames on its own — adoption requires an explicit user selection.

---

## Six Slots

The Entry Gate's falsifiable objective is captured as six slots. **Four are captured from the request (or the crystallized spec); two are minted by this orchestrator.** All six are written through `set --phase planning` at seed time.

Four content slots (from capture):

1. **outcome** (`--outcome`) — what is true when the objective is reached (the desired end state).
2. **verification-surface** (`--verification-surface`) — the concrete evidence that proves success (test, benchmark, artifact, observable behavior). This is the load-bearing slot: it is the only one that makes the objective machine-decidable.
3. **constraints** (`--constraints`) — what must NOT regress while pursuing (correctness suites stay green, contracts preserved).
4. **boundaries** (`--boundaries`) — the allowed files, tools, and resources the pursuit may touch.

Two minted slots (not in the request — this orchestrator supplies them):

5. **iteration-policy** → `max_iterations` (`--max-iterations <n>`) — the finite cap on pursuit blocks. Default **10** when not overridden at invocation; invocation-overridable. This is the SOLE soft-stop bound: when pursuit hits `max_iterations` the loop soft-stops (state preserved), it does NOT hard-kill.
6. **blocked-stop** (`--blocked-stop <text>`) — the objective-specific predicate that means "no valid path forward". A decidable, point-in-time condition (no cross-iteration memory); when met, pursuit stops and reports the blocker, non-complete.

Seed example (run at the first `planning` transition):

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase planning \
  --outcome "<desired end state>" \
  --verification-surface "<concrete evidence that proves success>" \
  --constraints "<what must not regress>" \
  --boundaries "<allowed files/tools/resources>" \
  --max-iterations 10 \
  --blocked-stop "<objective-specific no-path-forward predicate>"
```

<!-- story-layer:start -->

## Story Definition (Planning Phase)

After capturing the six slots and before dispatching to prometheus or sisyphus, define the WHAT-slices of the objective with the user, story by story. Each story is an independently verifiable chunk of the objective — not a task (HOW) but a stated outcome (WHAT).

**When to slice vs. use single-derivation.** If the objective is a single WHAT — one deliverable, one verification surface, no meaningful sub-goals — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --single
```

This derives one story directly from the current `outcome` and marks it `confirmed` immediately (no separate `confirm-story` call needed). Use `--single` for objectives where slicing into multiple stories would introduce ceremony without value.

For objectives with multiple distinct WHAT-slices, define them one at a time with the user. For each story, establish:

1. A **WHAT statement** — the desired outcome for this slice, stated concretely.
2. At least one **acceptance criterion** — a falsifiable check that, when met, confirms the slice is done.
3. A **verification surface** — the concrete evidence that proves the AC is met (a test, an artifact, a command output, an observable behavior).

Once you have agreed on the full story set with the user, ingest it:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --json '<array-of-stories>'
```

`set-stories --json` refuses an empty array, any story missing acceptance criteria or a verification surface, duplicate ids, an empty `outcome`, or a `phase` other than `planning`. Every ingested story starts `unconfirmed`.

**Per-story confirmation.** After the user approves each story in the planning dialogue, confirm it:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts confirm-story <id>
```

`confirm-story` is the sole path from `unconfirmed` to `confirmed`. No other subcommand (`set`, `set-verdict`, `set-stories --json` re-ingestion) can produce `confirmed`. The pursuing phase is refused while any story remains `unconfirmed` — `set --phase pursuing` names the offending ids on stderr. Once all stories are `confirmed` (or `retired`), the pursuing transition is allowed.

<!-- story-layer:end -->

---

## Conditional Orchestration

Goal does not reimplement decomposition or execution. It invokes the existing skills conditionally by request shape, then takes over with the autonomous loop during pursuit.

- **Vague** (the verification surface cannot be derived without questioning the user) → `Skill(skill: "deep-interview")`. The interview crystallizes a spec at `$OMT_DIR/deep-interview/{slug}.md` and bridges to prometheus; its acceptance criteria feed the verification-surface slot.
- **Complex** (the objective needs decomposition into a TODO plan with waves and acceptance criteria — multi-component, 3+ files, or any non-trivial build) → `Skill(skill: "prometheus")`. Prometheus runs its full planning pipeline (its human gates UN-wrapped) and ends by dispatching to sisyphus with a plan path at `$OMT_DIR/plans/{name}.md`.
- **Execution** (a plan or crystallized spec already exists and the objective is ready to be built) → dispatch to sisyphus for execution: `Skill(skill: "sisyphus")` with the plan path.

### Phase transitions

The autonomous loop blocks ONLY when `phase=pursuing`. Set the phase around the planning/execution skills so the loop yields during planning (human gates run un-wrapped) and only activates during pursuit:

- **Before EVERY prometheus or deep-interview call** — both the initial planning call AND the re-plan loop-back — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase planning
  ```
  `--phase planning` also clears the verdict to `absent`, so a stale APPROVE can never survive a re-plan.
- **After the sisyphus dispatch** — once pursuit (execution) begins — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase pursuing
  ```

Initial path: `set --phase planning` (seed slots) → invoke prometheus / deep-interview → on sisyphus dispatch `set --phase pursuing`. Re-plan loop-back: `set --phase planning` (clears the verdict) → invoke prometheus again → `set --phase pursuing` after the fresh sisyphus dispatch.

<!-- story-layer:start -->

### Mid-flight Story Mutations

Stories can be discovered, corrected, or retired during pursuit. Use the per-story mutation subcommands when the situation changes mid-flight:

- **`add-story --json '<story>'`** — appends one new story with status `unconfirmed`. Allowed in both `planning` and `pursuing`. A newly added story must be confirmed via `confirm-story <id>` before completion is allowed (an `unconfirmed` story blocks `request-complete`).
- **`revise-story <id> --json '<patch>'`** — patches an existing story's text, acceptance criteria, or verification surface. Revision ALWAYS resets the story's status to `unconfirmed` — a story whose definition changed requires fresh user approval. Refused on retired stories and unknown ids.
- **`retire-story <id>`** — marks a story `retired`. An `unconfirmed` story is retirable in any phase. A `confirmed` story is retirable ONLY while `phase=planning` — retiring a confirmed story mid-pursuit is refused (run `set --phase planning` first to re-enter planning, then retire). This fence prevents retiring a confirmed WHAT mid-pursuit as a way to remove it from the completion gate.

Re-plan (`set --phase planning`) preserves `stories[]` including per-story statuses, while resetting `objective_verdict` and `completion_evidence_paths` exactly as today. Stories survive re-planning; only verdict state is cleared.

<!-- story-layer:end -->

---

## Completion Gate

After a sisyphus pass, completion is NOT self-declared. Invoke an objective-level **argus** (a fresh instance, with no prior-verdict context), presenting the **verification surface as PROSE requirements** — a completeness Spec. This is the objective-scope completeness check: argus verifies that every prose-stated requirement in the verification surface is reflected in the deliverable, and renders an APPROVE / REQUEST_CHANGES / COMMENT verdict.

**Inject the completion-audit rubric INTO the argus invocation** (it lives in the argus prompt, never in any continuation prompt). The rubric forces an evidence-based verdict and asserts each element independently:

- **prompt-to-artifact mapping** — argus must map every explicit requirement, numbered item, named file, command, test, gate, and deliverable in the verification surface to concrete evidence; an unmapped requirement is incomplete.
- **proxy-signal refusal** — argus must refuse proxy signals as completion by themselves: passing tests, a green build, a complete manifest, or substantial effort count only insofar as they cover every requirement in the verification surface.
- **verify-the-verifier** — argus must confirm that any test suite, manifest, or green status actually COVERS the objective's requirements before relying on it (the FALSE-GREEN guard: not "are tests green?" but "do the green tests cover every objective requirement?").
- **uncertainty = not-achieved** — argus must treat any uncertain, weakly-verified, or uncovered requirement as not achieved; doubt drives REQUEST_CHANGES, never APPROVE.

<!-- story-layer:start -->

**Per-story re-derivation (same argus invocation).** The same single fresh argus pass also re-derives a verdict for every non-retired story and authors the structured verdict artifact at `$OMT_DIR/goal-verdict-{sid}.json`. Argus writes this file directly (it has file tools); the orchestrator passes only the path and never transcribes verdict content. The artifact schema is:

```json
{
  "objective_verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "stories": [
    { "id": "<story-id>", "verdict": "APPROVE | REQUEST_CHANGES", "evidence_refs": ["<path>"] }
  ],
  "verifier": "<argus instance description>",
  "at": "<ISO timestamp>"
}
```

For each non-retired story, argus maps the story's acceptance criteria and verification surface to concrete evidence and renders an `APPROVE` or `REQUEST_CHANGES` per-story verdict. A single non-APPROVE per-story entry blocks completion regardless of the `objective_verdict` field — `objective_verdict === 'APPROVE'` alone is never sufficient.

`request-complete` reads the artifact from the conventional path internally (no path argument). It refuses if: the artifact is absent or schema-invalid; any non-retired story entry is non-APPROVE; any non-retired story is `unconfirmed`; an entry is missing for any non-retired story; zero non-retired stories exist; or the existing dual gate is unmet (`objective_verdict !== 'APPROVE'` in state, or empty `completion_evidence_paths`). When all checks pass, `request-complete` writes `phase=complete` and `active=false`.

<!-- story-layer:end -->

**Completion fires ONLY on argus APPROVE AND an objective-scope Evidence Audit pass.** A **COMMENT verdict is NOT sufficient** for completion — COMMENT means MEDIUM gaps remain. The Evidence Audit reuses the verify-the-verifier shape: confirm argus's verdict HOLDS UP by reading the evidence argus saved (does it demonstrate the verification surface was met?) — auditing, never re-running a command and never rendering your own verdict. If the evidence is missing or does not demonstrate the verification surface, it is an Evidence Gap → re-invoke argus, do not complete.

On pass (APPROVE + Evidence Audit holds), run the completion sequence in this exact order — **record the Evidence Audit artifact paths FIRST, then flip the verdict, then request completion:**

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase pursuing --completion-evidence <audit-artifact-paths>
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-verdict --verdict APPROVE
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts request-complete
```

`<audit-artifact-paths>` is a comma-separated list of the artifacts argus's Evidence Audit read (the evidence that demonstrates the verification surface was met). `set --phase pursuing --completion-evidence` keeps the phase `pursuing` and only records the evidence — it can never write `complete`.

**Why evidence is recorded BEFORE the verdict flips:** so that whenever `objective_verdict=APPROVE` is observed, the completion evidence is already present. `request-complete` is the ONLY path to `phase=complete` — the hook layer never writes `complete` under any condition (cap reached → `budget_limited` block, not complete). Recording evidence first ensures the full `request-complete` gate (verdict + evidence + per-story artifact checks) is satisfiable the moment the verdict flips. When the cap is reached before the gate is met, the hook writes `budget_limited` and blocks for that turn; calling `request-complete` in the same turn is still possible and succeeds if the gate is met — ADR-7 complete-wins means `request-complete` prevails over a prior `budget_limited` state. If `request-complete` is refused, report the blocker honestly and stop.

APPROVE alone does NOT leave the goal pursuing/active — the `request-complete` handoff is what transitions to terminal `complete` (and it is structurally gated on completion-evidence, so a write that never reached the gate cannot false-complete).

**No design/architecture lane gates completion.** The only gate on the completion path is this objective-level argus — which also re-derives per-WHAT-slice verdicts and authors the verdict artifact at `$OMT_DIR/goal-verdict-{sid}.json`. There is no design-review or daedalus pass between pursuit and completion — design is plan-time advisory only.

### Concrete progress action per non-APPROVE verdict

Every non-APPROVE verdict drives a concrete progress action — never action-less spin:

- **REQUEST_CHANGES naming incomplete work items** (tactical — the work is unfinished, the plan is sound) → re-dispatch `Skill(skill: "sisyphus")` on the named incomplete TODOs. This stays inside sisyphus's junior loop; phase remains `pursuing`.
- **Strategic plan inadequacy** (the plan itself cannot reach the objective — the decomposition is wrong, not merely unfinished) → re-plan via `Skill(skill: "prometheus")`: run `set --phase planning` first (which clears the verdict), let prometheus's human design gates run un-wrapped, then `set --phase pursuing` after the fresh sisyphus dispatch.
- **COMMENT (MEDIUM gaps only)** → re-dispatch `Skill(skill: "sisyphus")` to fix the argus-named MEDIUM gaps; do NOT `request-complete` on a COMMENT.

### Blocked-stop

Pursuit stops as blocked (non-complete) ONLY on a decidable, point-in-time predicate — there is no cross-iteration stall detector; `max_iterations` absorbs genuine stalls. Exactly two conditions trip blocked:

- **B1** — argus names NO actionable incomplete work item while the objective is still unmet (no valid progress path: nothing to re-dispatch and the verification surface is not satisfied).
- **B2** — the captured **blocked-stop** slot's objective-specific condition is met.

On either condition: run `set-blocked --reason "<blocker>"`, report the blocker to the user, and stop. A blocked pursuit is non-complete — `set-blocked` can never write `complete`.

---

## Benign-failure note

A verdict-write or state-write failure must degrade toward continued pursuit, **never** toward a claimed completion. If `set-verdict` fails to record APPROVE, the verdict reads `absent`; `request-complete` is refused because `objective_verdict !== 'APPROVE'` (the verdict gate), so the system continues pursuing rather than false-completing. Absent verdict = block-and-continue. There is no path where a failed write produces a completion.

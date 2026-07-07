---
name: goal
description: Autonomous objective-pursuit orchestrator — wraps deep-interview/prometheus/sisyphus, then re-pursues the objective across plan/execute cycles until an objective-level completion gate confirms the verification surface is met.
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

- **deep-interview supplementation** — when the objective is rich but under-specified (the verification surface can be derived through questioning), invoke `Skill(skill: "deep-interview")` passing the marker `caller=goal` to crystallize a spec whose acceptance criteria become the verification surface. The `caller=goal` marker makes deep-interview's re-entrancy guard return the crystallized spec to goal and emit NO `goal` handoff (no goal→deep-interview→goal loop). Resume the Entry Gate against the crystallized spec.
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

## Planning: Six Slots & Story Definition

**You MUST read `references/planning.md` first** before seeding the six slots (`set --phase planning`), defining or confirming stories (`set-stories`/`confirm-story`), or applying any mid-flight story mutation (`add-story`/`revise-story`/`retire-story`) — it is the single owner of the slot definitions and the full story lifecycle.

---

## Conditional Orchestration

Goal does not reimplement decomposition or execution. It invokes the existing skills conditionally by request shape, then takes over with the autonomous loop during pursuit.

- **Vague** (the verification surface cannot be derived without questioning the user) → `Skill(skill: "deep-interview")` passing the marker `caller=goal`. The interview crystallizes a spec at `$OMT_DIR/deep-interview/{slug}.md`; because the `caller=goal` marker is present, deep-interview's re-entrancy guard returns that crystallized spec to goal and emits NO `goal` handoff (preventing a goal→deep-interview→goal loop). Goal receives the returned spec and routes downstream itself; the spec's acceptance criteria feed the verification-surface slot.
- **Complex** (the objective needs decomposition into a TODO plan with waves and acceptance criteria — multi-component, 3+ files, or any non-trivial build) → `Skill(skill: "prometheus")`. Prometheus runs its full planning pipeline (its human gates UN-wrapped) and ends by dispatching to sisyphus with a plan path at `$OMT_DIR/plans/{name}.md`.
- **Execution** (a plan or crystallized spec already exists and the objective is ready to be built) → dispatch to sisyphus for execution: `Skill(skill: "sisyphus")` with the plan path.

### Clarity gate

When the Vague branch above returns a crystallized spec, goal trusts deep-interview's crystallized clarity (ambiguity ≤ the resolved threshold, default 0.15) as the requirements-clarity signal and does not re-interrogate the user before routing downstream — the spec's own clearance is already satisfied, not re-litigated by goal.

### Fast-path gate

Not every Complex-shaped objective needs prometheus's full planning pipeline. When a Complex objective clears all three fast-path signals — (1) the objective is Complex on file-count alone, with each individual change mechanical and localized, (2) no competing design fork exists — a single obvious approach, not a choice among architectures, and (3) no T1-tier risk is present (no security or data-integrity surface) — goal skips prometheus, captures the objective's acceptance criteria directly into the Story Definition layer, and dispatches straight to sisyphus. This fast-path judgment is goal's own inline prose gate, not a CLI subcommand — goal reads the three signals itself and decides. It presupposes the Clarity gate above: the fast-path evaluation only runs once deep-interview's crystallized clarity has already cleared, so the three signals are judged against a spec whose ambiguity is already resolved, not a foggy one.

A live design fork disqualifies the fast-path outright: competing design alternatives are exactly what prometheus's planning pipeline exists to adjudicate, so an objective with a design fork always routes through prometheus regardless of file count or risk tier.

When the three-signal verdict is on the fence — not clearly cleared, not clearly failed — the asymmetric default resolves it toward prometheus, never toward the fast path: a user wrongly silenced by a skipped planning gate is worse than one extra round of design review, so an ambiguous fast-path judgment falls back to the full prometheus pipeline.

### Finalize-before-advance guard

Before invoking a subskill at ANY dispatch site below, cross-read the OTHER stateful subskill's own state file to confirm it is not left half-open from an earlier call in this session:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts check-subskill --skill deep-interview
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts check-subskill --skill prometheus
```

A non-zero exit means that subskill's own state file is `active:true`, TTL-live, and non-pristine — it ran and never finalized (no done-token emitted). Before advancing with the dispatch you were about to make, emit that subskill's own done-token (`<deep-interview-done/>` or `<prometheus-done/>`) to finalize it first, THEN proceed. `check-subskill` exits 0 (pass) when the peer state is absent, terminal (`active:false`), pristine (freshly seeded, no real work), or TTL-stale — none of those block advancing.

This guard runs at every dispatch site in the pipeline:

- **Initial planning** — before the first `deep-interview` or `prometheus` call (the Vague/Complex branch above), check the OTHER of the two.
- **Initial sisyphus execution** — before the first `sisyphus` dispatch (the Execution branch, and the fast-path direct-to-sisyphus that skips prometheus), check both `deep-interview` and `prometheus`.
- **Re-plan loop-back** — before re-invoking `prometheus` (Strategic plan inadequacy, below), check `deep-interview`.
- **REQUEST_CHANGES sisyphus re-dispatch** — before re-invoking `sisyphus` on named incomplete work items, check both `deep-interview` and `prometheus`.
- **CONFIRMED-finding sisyphus re-dispatch** — before re-invoking `sisyphus` on code-review findings, check both `deep-interview` and `prometheus`.

**Un-wedge recovery.** If a subskill exits without emitting its done-token (crash, interruption, forgotten emit), its state file sticks at `active:true` — half-open — and blocks the next dispatch site indefinitely. Recovery: emit that subskill's done-token to finalize the stuck state (or let the TTL-based GC reap it once its idle window elapses). Because this is a cross-read of the PEER skill's own state file, goal never gets wedged on its own state — only the peer's leaked half-open state, which self-heals via TTL even if no one ever emits the done-token.

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

---

## Completion Gate

**You MUST read `references/completion-gate.md` first** before rendering the objective-lane verdict, evaluating the code-review lane, or running the completion sequence (`set-verdict`/`request-complete`) — it is the single owner of the evidence rubric, the per-story and code-review artifact schemas, the pass signal, the concrete-progress routing per verdict, and the blocked-stop conditions.

---

## Benign-failure note

A verdict-write or state-write failure must degrade toward continued pursuit, **never** toward a claimed completion. If `set-verdict` fails to record APPROVE, the verdict reads `absent`; `request-complete` is refused because `objective_verdict !== 'APPROVE'` (the verdict gate), so the system continues pursuing rather than false-completing. Absent verdict = block-and-continue. There is no path where a failed write produces a completion.

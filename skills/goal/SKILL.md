---
name: goal
description: Autonomous objective-pursuit executor — decomposes an objective into Six Slots and a Story set, dispatches execution to sisyphus, then re-pursues the objective across plan/execute cycles until an objective-level completion gate confirms the verification surface is met.
---

<Role>

# Goal — Autonomous Objective-Pursuit Executor

Goal is a pure executor: it decomposes a single OBJECTIVE into the Six Slots and a Story set itself, dispatches execution to sisyphus, and re-pursues the objective across plan/execute cycles in an autonomous loop until completion is proven.

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

- **outside-goal clarification** — when the objective is rich but under-specified (the verification surface can be derived through questioning), stop here: tell the user to invoke a clarification skill (e.g. deep-interview) directly, outside goal, to crystallize a spec, then re-invoke goal with that crystallized spec as the objective. Goal itself does not call clarification skills — it only resumes the Entry Gate once the user re-enters with a crystallized spec.
- **ask-user** — when a single missing fact would make the objective falsifiable (the user can state the success criterion in one sentence), ask the user directly for the verification surface before proceeding.

**Re-invocation refusal.** Before seeding anything, read state via `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts get`. If the result is `active: true` AND `pristine: false`, REFUSE to start a second pursuit — report the active objective and its phase, and stop. A second concurrent goal is never seeded over a non-pristine active one. A `pristine: true` result means the state was freshly seeded by this very invocation's PreToolUse hook — proceed normally. (Terminal states read as inactive and do not block a fresh goal.)

**Continuation intent.** When the user's invocation expresses explicit continuation intent — e.g. "하던 거 계속", "continue what I was doing", "resume the previous goal" — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts list-others
```

If candidates exist, present them via AskUserQuestion with one option per candidate (labeled with the candidate's purpose and age — e.g. "ship X — started 2026-06-10, 3 hours idle"), plus a "start fresh" option. Proceed to the next step ONLY on an explicit user selection:

- On candidate selection: run `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts adopt --src <selected-sid>`, then run `bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts get` to read what was adopted, and resume from the restored state — if `phase` is `planning`, resume planning from the adopted Story set and `resume_summary`; if `phase` is `pursuing`, continue pursuit at the adopted `iteration`. Do NOT re-seed via `set --phase planning` from the new invocation's text.
- On "start fresh": proceed as a new goal.

If no candidates exist, say so and proceed fresh. The branch never renames on its own — adoption requires an explicit user selection.

---

## Planning: Six Slots & Story Definition

**You MUST read `references/planning.md` first** before seeding the six slots (`set --phase planning`), defining or confirming stories (`set-stories`/`confirm-story`), or applying any mid-flight story mutation (`add-story`/`revise-story`/`retire-story`) — it is the single owner of the slot definitions and the full story lifecycle.

---

## Execution Dispatch

Goal does not reimplement execution. It decomposes the objective into the Six Slots and a Story set itself — see `references/planning.md` — then dispatches execution to sisyphus: `Skill(skill: "sisyphus")` with the adopted Story set.

### Phase transitions

The autonomous loop blocks ONLY when `phase=pursuing`. Set the phase around decomposition so the loop yields while decomposing (human gates run un-wrapped) and only activates during pursuit:

- **While decomposing the Six Slots and the Story set** — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase planning
  ```
  `--phase planning` also clears the verdict to `absent`, so a stale APPROVE can never survive a re-plan.
- **After the sisyphus dispatch** — once pursuit (execution) begins — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase pursuing
  ```

Initial path: `set --phase planning` (seed slots) → decompose the Six Slots and the Story set → dispatch to sisyphus → `set --phase pursuing`. Re-plan loop-back: `set --phase planning` (clears the verdict) → re-decompose the Story set → `set --phase pursuing` after the fresh sisyphus dispatch.

---

## Completion Gate

**You MUST read `references/completion-gate.md` first** before rendering the objective-lane verdict, evaluating the code-review lane, or running the completion sequence (`set-verdict`/`request-complete`) — it is the single owner of the evidence rubric, the per-story and code-review artifact schemas, the pass signal, the concrete-progress routing per verdict, and the blocked-stop conditions.

---

## Benign-failure note

A verdict-write or state-write failure must degrade toward continued pursuit, **never** toward a claimed completion. If `set-verdict` fails to record APPROVE, the verdict reads `absent`; `request-complete` is refused because `objective_verdict !== 'APPROVE'` (the verdict gate), so the system continues pursuing rather than false-completing. Absent verdict = block-and-continue. There is no path where a failed write produces a completion.

---
name: ultragoal
description: Autonomous multi-story objective-pursuit executor — restructures goal into a per-story sequential loop. Auto-generates and bulk-approves a Story set, dispatches each confirmed story to sisyphus one at a time gated by a per-story APPROVE verdict, then runs one independent code-review over the accumulated diff at the final story.
---

<Role>

# Ultragoal — Sequential Multi-Story Objective-Pursuit Executor

Ultragoal is goal restructured on exactly two axes: **execution loop** and **decomposition ownership**. Everything else — the Entry Gate, the Six Slots, the completion-gate cost model, the never-false-complete invariant — is goal's, reused as-is. Ultragoal decomposes a single OBJECTIVE into the Six Slots and an auto-generated Story set, has the user review and bulk-approve that set in one pass, then dispatches the confirmed stories to sisyphus **one story at a time, in sequence**: the next story is never dispatched until the current story's per-story verdict is `APPROVE`. Only after every confirmed story is APPROVE does a single independent code-review run over the accumulated diff. sisyphus remains the sole executor throughout — ultragoal never invokes the goal skill at runtime; it is goal's structural copy, not goal's caller.

**Design philosophy: autonomy is post-planning.** Planning carries a single human gate — bulk approval of the auto-generated Story set; that gate runs UN-wrapped. The autonomy begins after planning, during the per-story pursuit loop. The single load-bearing invariant of the whole design: **the loop never false-completes.** Every state-write or verdict-write failure degrades toward continued pursuit of the current story or block — never toward a claimed completion.

**Single-story degrade.** When the objective decomposes to exactly one story, ultragoal degrades to goal's behavior: `set-stories --single` auto-derives and auto-confirms the one story, a single `Skill(skill: "sisyphus")` dispatch runs, and the per-story advance gate and the final completion gate collapse into the same single check goal already runs.

</Role>

## State CLI

The autonomous loop is gated by a session-keyed state file driven through the bundled CLI, kept in its own artifact namespace (`ultragoal-state-`/`ultragoal-verdict-`/`ultragoal-codereview-`) separate from goal's. Reference it ONLY via the skill-dir variable, never CWD-relative:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts <subcommand> [options]
```

Subcommands used by this orchestrator:

| Subcommand | Authority | Purpose |
|------------|-----------|---------|
| `set --phase <planning\|pursuing> [slot flags…]` | orchestrator | Seed/advance phase; carries the slot values. Accepts ONLY `planning`/`pursuing` — it can never write `complete`, and on `planning` it resets the verdict to `absent`. |
| `confirm-all-stories` | orchestrator | Bulk-approves every unconfirmed story in the auto-generated set in one call — ultragoal's decomposition affordance, replacing goal's per-story `confirm-story` dialogue. |
| `reorder-stories --order <id1,id2,...>` | orchestrator | Planning-only reorder of the story array to an exact permutation of the current ids — steers the sequential dispatch order before pursuit begins. |
| `set-verdict --verdict <APPROVE\|REQUEST_CHANGES\|COMMENT\|absent>` | gate layer | The ONLY writer of `objective_verdict`. |
| `request-complete` | gate layer | The ONLY path to `phase=complete`; structurally gated on completion-evidence being present and `objective_verdict=APPROVE`. |
| `get` / `status` | read | Inspect current state / derived status. |

`set-budget-limited` and `set-blocked --reason <text>` are system-only setters (the hook layer writes `budget_limited`; `set-blocked` records a reported blocker). The orchestrator never writes `complete`, `budget_limited`, or a fabricated verdict by any other route — the narrow gates are structural, not vigilance-based.

---

## Entry Gate

An ultragoal pursuit is only worth pursuing autonomously if "done" is decidable. **Falsifiability trigger: refuse to start pursuit unless the request carries a falsifiable objective — a concrete verification surface a machine can check (a test, a benchmark, an artifact, an observable end state).** "Make it better", "improve performance", "clean this up" with no verification surface are NOT pursuable objectives. When the verification surface is absent or vague, do NOT begin orchestration and do NOT advance state beyond the pristine seed (no `set` call); a pristine seed left untouched is inert — hooks ignore it and the lifecycle GC reaps it by TTL.

On a non-falsifiable request, take exactly ONE of these two remediation outcomes:

- **outside-ultragoal clarification** — when the objective is rich but under-specified (the verification surface can be derived through questioning), stop here: tell the user to invoke a clarification skill (e.g. deep-interview) directly, outside ultragoal, to crystallize a spec, then re-invoke ultragoal with that crystallized spec as the objective. Ultragoal itself does not call clarification skills — it only resumes the Entry Gate once the user re-enters with a crystallized spec.
- **ask-user** — when a single missing fact would make the objective falsifiable (the user can state the success criterion in one sentence), ask the user directly for the verification surface before proceeding.

**Re-invocation refusal.** Before seeding anything, read state via `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts get`. If the result is `active: true` AND `pristine: false`, REFUSE to start a second pursuit — report the active objective and its phase, and stop. A second concurrent ultragoal is never seeded over a non-pristine active one. A `pristine: true` result means the state was freshly seeded by this very invocation's PreToolUse hook — proceed normally. (Terminal states read as inactive and do not block a fresh ultragoal.)

**Continuation intent.** When the user's invocation expresses explicit continuation intent — e.g. "하던 거 계속", "continue what I was doing", "resume the previous goal" — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts list-others
```

If candidates exist, present them via AskUserQuestion with one option per candidate (labeled with the candidate's purpose and age — e.g. "ship X — started 2026-06-10, 3 hours idle"), plus a "start fresh" option. Proceed to the next step ONLY on an explicit user selection:

- On candidate selection: run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts adopt --src <selected-sid>`, then run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts get` to read what was adopted, and resume from the restored state — if `phase` is `planning`, resume planning from the adopted Story set and `resume_summary`; if `phase` is `pursuing`, continue pursuit at the adopted `iteration`. Do NOT re-seed via `set --phase planning` from the new invocation's text.
- On "start fresh": proceed as a new ultragoal.

If no candidates exist, say so and proceed fresh. The branch never renames on its own — adoption requires an explicit user selection.

---

## Planning: Six Slots & Story Definition

**You MUST read `references/planning.md` first** before seeding the six slots (`set --phase planning`), auto-generating and bulk-approving the Story set (`set-stories`/`confirm-all-stories`), or applying any mid-flight story mutation (`add-story`/`revise-story`/`retire-story`/`reorder-stories`) — it is the single owner of the slot definitions and the full story lifecycle.

---

## Execution Dispatch

Ultragoal does not reimplement execution. It decomposes the objective into the Six Slots and auto-generates a Story set itself — see `references/planning.md` — then, once the user bulk-approves via `confirm-all-stories`, dispatches the confirmed stories to sisyphus **one story at a time, in sequence**:

1. **Arm the loop before dispatching.** Run:
   ```
   bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase pursuing
   ```
   This must run BEFORE the first `Skill(skill: "sisyphus")` call below — the persistent-mode Stop hook only refuses to stop while `phase=pursuing`, so dispatching first leaves that story's entire execution window unguarded.
2. Derive the **current story** — the first `confirmed` story (in stored order) that does not yet carry an `APPROVE` per-story verdict in `ultragoal-verdict-{sid}.json`. No separate "current story" state field exists; it is always re-derived from the verdict artifact, never stored.
3. Dispatch ONLY that one story to sisyphus: `Skill(skill: "sisyphus")` with that story's WHAT statement, acceptance criteria, and verification surface — never the whole Story set at once.
4. After sisyphus returns, run the per-story completion audit (see `references/completion-gate.md`) and re-derive that story's verdict.
5. **Advance only on APPROVE.** A non-APPROVE per-story verdict re-dispatches `Skill(skill: "sisyphus")` at the SAME story — the loop does not proceed to the next story until this one reads APPROVE.
6. Once the current story is APPROVE, repeat from step 2 for the next confirmed story. When every confirmed story carries an APPROVE verdict, proceed to the final code-review lane (see Completion Gate).

sisyphus stays the sole executor throughout this loop — ultragoal never swaps sisyphus for goal and never invokes the goal skill at runtime.

### Phase transitions

The autonomous loop blocks ONLY when `phase=pursuing`. Set the phase around decomposition so the loop yields while decomposing (human gates run un-wrapped) and only activates during pursuit:

- **While decomposing the Six Slots and auto-generating the Story set** — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase planning
  ```
  `--phase planning` also clears the verdict to `absent`, so a stale APPROVE can never survive a re-plan.
- **Before the first sisyphus dispatch** — see step 1 of the Execution Dispatch list above — run:
  ```
  bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase pursuing
  ```

Initial path: `set --phase planning` (seed slots) → auto-generate the Story set → user bulk-approves via `confirm-all-stories` → `set --phase pursuing` → dispatch story #1 to sisyphus. Re-plan loop-back: `set --phase planning` (clears the verdict) → re-generate or steer the Story set (`add-story`/`revise-story`/`retire-story`/`reorder-stories`) → `set --phase pursuing` → dispatch the fresh sisyphus call.

---

## Completion Gate

**You MUST read `references/completion-gate.md` first** before rendering a per-story verdict, evaluating the final code-review lane, or running the completion sequence (`set-verdict`/`request-complete`) — it is the single owner of the evidence rubric, the per-story and code-review artifact schemas, the pass signal, the concrete-progress routing per verdict, and the blocked-stop conditions.

Middle stories get a **lightweight, self-attested per-story verdict** — the same inline objective self-check goal already runs, scoped to the one story just dispatched — no code-review runs per story. Only once every confirmed story is APPROVE does the independent code-review lane run, and it runs exactly once, over the accumulated diff of all stories, exactly like goal's final-completion code-review.

---

## Benign-failure note

A verdict-write or state-write failure must degrade toward continued pursuit of the current story, **never** toward a claimed completion. If `set-verdict` fails to record APPROVE, the verdict reads `absent`; `request-complete` is refused because `objective_verdict !== 'APPROVE'` (the verdict gate), so the system continues pursuing rather than false-completing. Absent verdict = block-and-continue. There is no path where a failed write produces a completion.

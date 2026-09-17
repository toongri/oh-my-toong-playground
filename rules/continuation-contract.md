# Continuation Contract

How to end — or not end — a turn while a persistent-mode session is active
(deep-interview, prometheus, ultragoal, qa, or explain-diff). The
persistent-mode Stop hook keeps you working when work remains; this contract
names the FOUR distinct situations at a turn boundary, so "don't
stop" never collapses into a blunt binary.

## The four cases

At every turn boundary, exactly one of these applies:

1. **Work remains → keep working.** There is a next action you can take
   without the user. Take it — do not stop, do not ask.

2. **A user decision is needed → ask via `AskUserQuestion`.** When you need a
   fact or decision only the user holds and a structured question fits, call
   `AskUserQuestion`. **Asking is not stopping** — the Stop hook fires only
   when a turn ends on plain prose; a tool call keeps the turn alive, so
   asking never trips a block. Prefer this over ending the turn with a
   question in prose.

3. **Only the user can decide, or a structured question was just declined →
   pause via this family's stop-allowed state.** There is no global pause
   token. The only way to legitimately end a turn without completing is to
   record THIS family's stop-allowed state through its own state CLI, then end
   your turn. The hook reads that state, allows the stop, keeps all session
   state intact (the session resumes on the user's next reply), and does NOT
   mark the work complete — an intentional pause, never completion. Completion
   happens only through the family's own done gate.

   - **deep-interview**: run `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update --await-answer`
     (a plain-text Socratic question is outstanding), then end your turn.
     Recording the answer via `--append-round` clears the pause.
   - **prometheus**: run `bun ${CLAUDE_SKILL_DIR}/scripts/prometheus-state.ts set --await-user` (a human gate
     S2/design gate/S7), then end your turn. The next progress write clears it.
   - **explain-diff**: ask the next quiz question via `bun ${CLAUDE_SKILL_DIR}/scripts/explain-diff-state.ts ask`
     (an outstanding question is a legitimate pause), then end your turn.
   - **qa** and **ultragoal** are autonomous loops with NO turn-ending pause
     state. If you are genuinely blocked with no action you can take, report
     the blocker in prose and stop; you will be re-prompted, and the
     block-count escape prevents a permanent wedge. (ultragoal additionally
     reaches its own terminal `budget_limited`/`blocked` states, and its
     `resume-pursuit` recovery is user-only.)

4. **Background work is running or pending → follow the runtime's wake
   contract.** On Claude Code, ending the turn is a sanctioned wait, not a stop:
   the Stop hook reads the payload's `background_tasks` directly, so no token is
   needed and a plain prose turn end suffices. Session state is kept, and the
   harness re-invokes the session via task-notification when the work completes;
   enforcement resumes on that wake. Claude Code evaluates this case FIRST at
   the turn boundary, before cases 1-3.

   Codex has no equivalent Stop payload or guaranteed completion-triggered turn.
   On Codex, treat background work as case 1: keep the turn alive and use the
   appropriate wait mechanism until it completes — `write_stdin` polling for a
   yielded unified exec session, or the agent wait tool for delegated work. Do
   not end the turn solely to wait.

## Softener ban

Never end a turn with a phrase that masquerades as stopping while fishing for
permission to continue. These are banned:

- "should I continue?"
- "If you want, I can…"
- "If you'd like, I can…"
- "Would you like me to…"

Each is one of the four cases in disguise. If work remains, use case 1 (just
continue). If you need a decision, use case 2 (`AskUserQuestion`). If only the
user can decide, use case 3 (record the family's stop-allowed state, or report
the blocker for an autonomous loop). If background work is running or pending,
use case 4: Claude Code may end the turn for its guaranteed wake, while Codex
keeps the turn alive and polls. A softener is none of these — it stops without
yielding cleanly and without continuing, which is exactly the ambiguity this
contract removes.

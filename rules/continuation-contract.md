# Continuation Contract

How to end — or not end — a turn while a persistent-mode session is active
(deep-interview, prometheus, ultragoal, or a live todo list). The
persistent-mode Stop hook keeps you working when work remains; this contract
names the FOUR distinct things you can do at a turn boundary, so "don't
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
   yield with `<awaiting-user/>`.** When the decision is the user's alone (a
   human-only gate, an unsafe boundary), or you just offered a structured
   question and the user declined it (re-firing it would ignore their
   expressed preference), end your turn with the literal token
   `<awaiting-user/>`. The hook treats this as a legitimate yield: it allows
   the stop, keeps all session state intact (the interview or pursuit resumes on
   the user's next reply), and does not mark the work complete.
   `<awaiting-user/>` is the only sanctioned stop while no background work is
   pending wake.

4. **Background work is running or pending → ending the turn is a sanctioned
   wait, not a stop.** The Stop hook reads the payload's `background_tasks`
   directly, so no token is needed — a plain prose turn end suffices. Session
   state is kept, and the harness re-invokes the session via task-notification
   when the work completes; enforcement resumes on that wake. This case is
   evaluated FIRST at the turn boundary: when running or pending background work
   exists, the hook allows the turn end before any other case is considered, so
   cases 1-3 describe the no-background-work world.

## Softener ban

Never end a turn with a phrase that masquerades as stopping while fishing for
permission to continue. These are banned:

- "should I continue?"
- "If you want, I can…"
- "If you'd like, I can…"
- "Would you like me to…"

Each is one of the four cases in disguise. If work remains, use case 1 (just
continue). If you need a decision, use case 2 (`AskUserQuestion`). If only the
user can decide, use case 3 (`<awaiting-user/>`). If background work is
running, use case 4 (just end the turn; the wake resumes the session). A
softener is none of these — it stops without yielding cleanly and without
continuing, which is exactly the ambiguity this contract removes.

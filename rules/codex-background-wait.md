# Codex Background Wait

Codex has no Stop payload that carries background-task data, and no
guaranteed completion-triggered turn. Ending the turn to wait for
background work strands it: nothing wakes the session when that work
finishes.

While background work runs, keep the turn alive and wait with the
matching mechanism: `write_stdin` polling for a yielded unified exec
session, or the agent wait tool for delegated work. Harvest the result
when it finishes, then carry on with the task.

Do not end the turn solely to wait.

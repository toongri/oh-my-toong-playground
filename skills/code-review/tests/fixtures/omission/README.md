# Fixture: omission

Models a tiny handler-dispatch app where every handler under `handlers/`
must also be registered in the central `registry.ts` (`index.ts` dispatches
by looking the handler name up in `registry`; an unregistered handler is
never reachable — it silently 404s).

`before/` has 3 handlers (`ping`, `echo`, `time`), each with a matching
entry in `registry.ts` — the repeated analog pattern.

`change/` adds a 4th handler, `handlers/health.ts`, exporting a handler
that returns HTTP 200 — but does NOT add a `health` entry to
`registry.ts`. That is the single grounded omission: `health` exists but
is never dispatched, because `registry.ts` (and `index.ts`, unchanged)
still only knows about `ping`, `echo`, and `time`.

`requirements.txt` names only wiring-independent, local structural facts
about `handlers/health.ts` itself (the module is added, it exports a
function named `health`, that function returns an object literal of the
shape `{ status: number; body: string }`) — all satisfied by the diff. It
does not mention registration or wiring — the missing registry entry is meant to be an
*unwritten* gap, discoverable only by generalizing the 3-instance analog
pattern against the diff, not a requirement the diff fails against text
that already names it.

## Realizing the diff

A runner materializes the actual diff from the `before/`/`change/` pair
rather than consuming a hand-written patch file:

```bash
cd before && git init -q && git add -A && git commit -q -m before
cp -R ../change/. .
git add -A
git diff --cached   # this is the diff under review
```

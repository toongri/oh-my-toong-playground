# Fixture: clean

Mirror of the `omission` fixture (`skills/code-review/tests/fixtures/omission/`):
the same tiny handler-dispatch app where every handler under `handlers/`
must also be registered in the central `registry.ts` (`index.ts` dispatches
by looking the handler name up in `registry`).

`before/` has 3 handlers (`ping`, `echo`, `time`), each with a matching
entry in `registry.ts` — identical to the `omission` fixture's baseline.

`change/` adds a 4th handler, `handlers/health.ts`, exporting a handler
that returns HTTP 200, **and** adds the matching `health` entry to
`registry.ts`. The pairing is complete — there is no citable absence: the
new handler is exported, returns 200, and is reachable through dispatch.

`requirements.txt` is identical to the `omission` fixture's — it names
only wiring-independent, local structural facts about `handlers/health.ts`
itself (the module is added, it exports a function named `health`, that
function returns an object literal of the shape `{ status: number; body:
string }`) and does not mention registration or wiring.

## Realizing the diff

A runner materializes the actual diff from the `before/`/`change/` pair
rather than consuming a hand-written patch file:

```bash
cd before && git init -q && git add -A && git commit -q -m before
cp -R ../change/. .
git add -A
git diff --cached   # this is the diff under review
```

# E16 — missing-body-payload

**Expected verdict:** REQUEST_CHANGES, and PASS is forbidden (the reviewer must not attempt to
review a partial payload as if it were complete)
**Expected anchor:** `payload contract` (the literal `**Rule:** payload contract` value)
**Rule source:** `agents/issue-reviewer.md` § Payload Contract (dispatch precondition) — "...one
child body per child issue in the set. One labeled block per child... An incomplete payload (any of
the three blocks missing) is a payload contract violation."

**Single violation by design:** this is the mirror of E14 — here the **Original request (verbatim)**
block IS present, but the issue set being written has exactly one issue and its
`child:<title-slug>` body block is entirely absent from the dispatch. There is a request describing
what should be built, but nothing to check it against. Dispatch exactly what appears under
"Dispatch payload" below — do not add a child body block when reproducing this fixture; its absence
is the point.

---

## Dispatch payload

**Original request (verbatim):**
Let users mute notifications for a specific project from the project settings page.

<!-- OMITTED ON PURPOSE: no "child:<title-slug>" block follows. The request above describes a
     single, unsliced ask, so exactly one child body block is expected and none is supplied — this
     is the fixture's single defect. -->

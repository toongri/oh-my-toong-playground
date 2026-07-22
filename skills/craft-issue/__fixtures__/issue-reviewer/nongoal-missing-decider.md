# E17 — nongoal-missing-decider

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Standard Body Shape` › `Non-Goals` (a `**Rule:**` line containing both strings,
e.g. `### Standard Body Shape › **Non-Goals**`)
**Rule source:** `references/issue-craft.md` § Standard Body Shape › **Non-Goals** row — "Each item
pairs with `| decider: {how to tell a finding belongs here}`."

**Distinguished from E5 (`missing-non-goals.md`):** E5's Non-Goals *section* is absent entirely, so
per Citation Norm 4 the reviewer cites the bare `### Standard Body Shape` heading — there is no row
to drill into because the section itself does not exist. Here the Non-Goals section IS present, with
two substantive items, but neither item carries the `| decider: {how to tell a finding belongs
here}` clause the row requires. That is a rule violated *inside the body of a section that is
present*, which per Citation Norm 5 is cited by that section's own content rule, and per Citation
Norm 3 a table row is drilled into with `›`. Both fixtures sit on the same Non-Goals axis; they
diverge only in citation granularity (heading-only vs heading › row), because the underlying defect
differs (section absent vs section present but missing the required per-item clause).

**Single violation by design:** a small, single-issue, non-bug feature request in the minimal
Lean-by-Default shape — Problem → flat Pre-Context → AC → Non-Goals → References, nothing more,
nothing less — the same envelope `lean-clean.md` passes. The sole AC is concrete and single-outcome,
no weasel words appear, the Pre-Context bullet carries an investigation citation, and the request has
exactly one ask, fully covered by the one AC (no Request-Coverage gap). The only defect is that both
Non-Goals items are bare exclusion statements with no `| decider:` clause.

---

## Dispatch payload

**Original request (verbatim):**
Add a "Sort by newest" option to the shared-list view's sort control so people can see recently added
items first without scrolling through the whole list.

**child:shared-list-sort-by-newest**
## Problem
Users viewing a shared list can only see items in the list's default order — there is no way to bring
recently added items to the top without scrolling through the entire list.

## Pre-Context
- The shared-list view's sort control is `lists/SharedListSortControl.tsx` (renders the existing sort
  options and dispatches the active sort key; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Selecting "Sort by newest" in the shared-list sort control reorders the list so
      the most recently added item appears first.
      **Verification**: Open a shared list with 3 items added at different times, select "Sort by
      newest", and confirm the items are ordered from most recently added to least recently added.

## Non-Goals
- This issue does not change the default sort order for lists where "Sort by newest" is not selected.
- This issue does not add a "Sort by newest" option to nested sub-list views.

## References
- N/A — no prior art gathered for this change.

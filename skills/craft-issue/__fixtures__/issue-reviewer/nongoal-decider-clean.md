# E18 — nongoal-decider-clean

**Expected verdict:** PASS (no findings, no `**Rule:**` line at all)
**Rule source:** n/a — negative control for the Non-Goals `| decider:` requirement

**Paired with `nongoal-missing-decider.md`:** identical dispatch payload, except each Non-Goals item
here carries a `| decider: {how to tell a finding belongs here}` clause. Everything under `##
Dispatch payload` other than the Non-Goals item text and the title/slug is unchanged between the two
fixtures — the only variable under test is the presence of the decider clause. (Verified by diff at
authoring time — see the task report for the exact diff.)

**Why it is clean:** the same envelope as `lean-clean.md` — a small, single-issue, non-bug feature
request in the minimal Lean-by-Default shape. The sole AC is concrete and single-outcome, no weasel
words appear, Non-Goals is present with two substantive items, the Pre-Context bullet carries an
investigation citation, and the request has exactly one ask, fully covered by the one AC (no
Request-Coverage gap). Each Non-Goals item's decider clause is ordinary, not elaborate — the rule
this fixture exercises is presence, not quality (the decider check is an existence check, not a
quality check).

---

## Dispatch payload

**Original request (verbatim):**
Add a "Sort by newest" option to the shared-list view's sort control so people can see recently added
items first without scrolling through the whole list.

**child:shared-list-sort-by-newest-decider**
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
- This issue does not change the default sort order for lists where "Sort by newest" is not
  selected. | decider: any change to the default sort order for a list that never selects "Sort by
  newest" belongs here.
- This issue does not add a "Sort by newest" option to nested sub-list views. | decider: any request
  to add a sort option inside a nested sub-list view belongs here.

## References
- N/A — no prior art gathered for this change.

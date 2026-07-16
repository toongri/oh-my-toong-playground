# E10 — lean-clean

**Expected verdict:** PASS (no findings, no `**Rule:**` line at all)
**Rule source:** n/a — this is the negative control for the lean-default shape

**Why it is clean:** a small, single-issue, non-bug feature request in the minimal Lean-by-Default
shape — Problem → flat Pre-Context → AC → Non-Goals → References, nothing more, nothing less. The
sole AC is concrete and single-outcome, no weasel words appear, Non-Goals is present, the Pre-Context
bullet carries an investigation citation, and the request has exactly one ask, fully covered by the
one AC (no Request-Coverage gap).

---

## Dispatch payload

**Original request (verbatim):**
Add a "copy link" button next to each item in the shared-list view so people can grab a direct link
to one item without selecting and copying the URL by hand.

**child:shared-list-copy-link-button**
## Problem
Users viewing a shared list have no quick way to get a direct link to a single item — they have to
open the item and manually copy the browser URL.

## Pre-Context
- The shared-list item row component is `lists/SharedListItem.tsx` (renders each item's title and
  action icons; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Clicking the "Copy link" icon on a shared-list item copies that item's direct
      URL to the clipboard
      **Verification**: Open a shared list with a test item, click "Copy link" on it, and confirm
      the clipboard contents equal the item's direct URL (`/lists/<id>/items/<itemId>`)

## Non-Goals
- This issue does not add a "copy link" action to the list itself, only to individual items.

## References
- N/A — no prior art gathered for this change.

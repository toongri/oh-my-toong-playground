# E5 — missing-non-goals

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Standard Body Shape`
**Rule source:** `references/issue-craft.md` § Standard Body Shape (Non-Goals row) + § Lean by Default
(the minimal default set — Problem → 사전 확인 → AC → Non-Goals → References — names Non-Goals as a
genre-agnostic member, not an omittable escalation)

**Single violation by design:** a bulk-action feature with obvious, un-fenced adjacent scope —
bulk-*unarchive*, bulk-*delete*, and select-all-across-pages all sit one step away from "bulk
archive" and a reader cannot tell which are in scope without a Non-Goals fence. The body is
otherwise a clean lean-default issue with a single-outcome, concrete, non-weasel AC and a glossed
symbol; the Non-Goals section is simply absent, leaving the scope-creep boundary undrawn. (An
earlier trivial-feature draft let the reviewer treat Non-Goals as legitimately omittable for a
self-contained capability; a bulk-action with visible neighboring operations makes the missing fence
unambiguous.)

---

## Dispatch payload

**Original request (verbatim):**
Add a "bulk archive" action to the reports list so users can archive several old reports at once
instead of one at a time.

**child:reports-bulk-archive**
## Problem
Users can archive reports only one at a time; with dozens of stale reports this is tedious.
Archiving hides a report from the default list without deleting it — archived reports stay
retrievable under the "Archived" filter, and the list also supports bulk-unarchive and bulk-delete
on individual rows today, so a bulk action's exact boundary is not self-evident.

## Pre-Context
- The reports list is `reports/ReportsList.tsx` (renders the report rows and the current per-row
  archive/unarchive/delete actions; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Selecting several reports and clicking "Bulk archive" moves every selected
      report out of the default list into the archived state in a single action.
      **Verification**: In a test account with 3 active reports, select all 3, click "Bulk archive",
      and confirm all 3 leave the default list and appear under the "Archived" filter.

## References
- N/A — no prior art gathered for this change.

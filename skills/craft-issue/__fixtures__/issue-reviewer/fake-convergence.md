# E9 — fake-convergence

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Request-Coverage`
**Rule source:** `references/issue-craft.md` § Request-Coverage Rule

**Single violation by design:** the original request names two asks — (1) add CSV export to the
reports page, and (2) email the CSV automatically on a weekly schedule. The written child issue
only covers CSV export; the weekly-email-schedule ask has no AC, no Non-Goals entry explaining why
it was dropped, and is not covered by any other issue in the set — a coverage gap the writer's own
summary (implicitly) treats as fully handled. AC quality, body shape, and Non-Goals wording are
otherwise compliant.

---

## Dispatch payload

**Original request (verbatim):**
Add a way to export the weekly reports page to CSV, and have it email the CSV to the report owner
automatically every Monday morning so they don't have to log in and download it manually.

**child:reports-page-csv-export**
## Problem
The reports page has no export option — users who need the data outside the app have to manually
copy values out of the table.

## Pre-Context
- The reports page's data table lives in `reports/ReportsTable.tsx` (renders the weekly report
  rows currently shown only on-screen; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Clicking "Export CSV" on the reports page downloads a CSV file containing every
      row currently shown in the table
      **Verification**: Load the reports page with test data, click "Export CSV", and confirm the
      downloaded file's row count matches the on-screen row count

## Non-Goals
- This issue does not add export formats besides CSV (e.g., XLSX, PDF). | decider: any request to
  add an export format besides CSV belongs here.

## References
- N/A — no prior art gathered for this change.

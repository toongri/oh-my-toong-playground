# E6 — unsliced-parent

**Expected verdict:** REQUEST_CHANGES
**Expected anchor (case-insensitive):** `Candidate-seam`
**Rule source:** `references/issue-craft.md` § Model A INVEST Slice Rubric › Candidate-seam
heuristics ("Issue touches genuinely unrelated concerns, each independently valuable → split by
concern") — the reviewer stably cites the Candidate-seam heuristic for a bundle of unrelated
concerns rather than the `Slice Gate` heading, so the anchor tracks its stable citation.

**Single violation by design:** the request bundles four genuinely unrelated, each-independently-
valuable pure capabilities (a dark-mode toggle, a CSV export button, custom-avatar upload, and a
health-check endpoint) into one issue with no children created — the classic "candidate-seam: issue
touches genuinely unrelated concerns, each independently valuable → split by concern" case, left
un-sliced. Each capability is a pure feature (non-transition, no measurable outcome to watch
post-release), and each individual AC is concrete, single-outcome, and non-weasel — so the only
defect is the failure to slice, not AC quality, a genre-section omission, or a coverage gap.

---

## Dispatch payload

**Original request (verbatim):**
Knock out four small unrelated improvements this sprint: add a dark-mode toggle to settings, add a
CSV export button to the reports tab, let users upload a custom avatar on their profile, and add a
`/healthz` endpoint so the load balancer can check whether the service is up.

**child:sprint-misc-improvements**
## Problem
Four unrelated user-facing gaps are slated for this sprint: settings has no dark-mode toggle, the
reports tab has no CSV export, the profile page has no custom-avatar upload, and there is no
health-check endpoint for the load balancer.

## Pre-Context
- `settings/ThemeToggle.tsx` (the dark-mode control; does not exist yet; confirmed by Stage 3
  investigation).
- `reports/ReportsTable.tsx` (the reports grid to be exported; confirmed by Stage 3 investigation).
- `profile/AvatarIcon.tsx` (the avatar renderer showing the initials fallback today; confirmed by
  Stage 3 investigation).
- `server/router.ts` (the HTTP router where the new endpoint registers; confirmed by Stage 3
  investigation).

## AC
- [ ] **[Outcome]**: Toggling "Dark mode" in settings switches the app to the dark palette without a
      page reload
      **Verification**: Open settings, toggle dark mode, and confirm the background changes to the
      dark palette's hex value within the same render
- [ ] **[Outcome]**: Clicking "Export CSV" on the reports tab downloads a CSV file whose row count
      matches the on-screen row count
      **Verification**: Load the reports tab with test data, click "Export CSV", and confirm the
      downloaded file's row count equals the on-screen count
- [ ] **[Outcome]**: Uploading a PNG under 5MB on the profile page shows that image as the avatar on
      the next page load
      **Verification**: Upload a 200KB PNG as a test account, reload the profile page, and confirm
      the avatar's `src` points to the uploaded image
- [ ] **[Outcome]**: A GET to `/healthz` returns HTTP 200 when the service is up
      **Verification**: Start the service and confirm `curl -s -o /dev/null -w "%{http_code}"
      localhost:8080/healthz` prints `200`

## Non-Goals
- This issue does not add dark-mode system-preference auto-detect, CSV alternatives (XLSX/PDF),
  avatar cropping controls, or a readiness probe. | decider: any request for dark-mode
  system-preference auto-detect, a CSV alternative, avatar cropping, or a readiness probe belongs
  here.

## References
- N/A — no prior art gathered for this sprint work.

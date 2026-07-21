# E8 — over-scaffolding

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Lean by Default`
**Rule source:** `references/issue-craft.md` § Lean by Default, Escalate on Need (escalation table +
Red Flag paragraph)

**Single violation by design:** a small, single-fact, non-bug feature request emits three
escalation sections with none of their triggers met: a separate **Evidence** section (trigger is
bug-genre only — this is a plain feature), a structured 3-sub-item **Pre-Context** (trigger is
parent/umbrella or >~5 cross-cutting facts — this issue has exactly one fact total), and a **Notes**
section with no provenance content (trigger is superseded attempts / deep-interview artifact path —
neither applies). All three manifestations cite the same rule (`### Lean by Default`), so this is
still one violation by rule-section, matching the Red Flag: "several Conditional sections... landing
in the same issue at once is a signal to stop." The AC itself is concrete and clean, contrast this
with `justified-complex-clean.md` (E11), where the same kind of heavy sections DO carry a real
trigger each.

---

## Dispatch payload

**Original request (verbatim):**
Add a dark mode toggle to the settings page.

**child:dark-mode-toggle**
## Problem
Users cannot switch the app to a dark color scheme; the settings page has no toggle for it.

## Evidence
- N/A — this is a feature request, not a bug; there is no log or trace to attach.

## Pre-Context
- **Affected Areas**:
  - `settings/ThemeToggle.tsx` (does not exist yet; the settings page has no theme control today).
- **Premises**:
  - The app already has a CSS custom-property theme layer that a dark palette can plug into.
- **Blockers & Risks**:
  - None identified.

## AC
- [ ] **[Outcome]**: Toggling "Dark mode" in settings switches the app's background and text colors
      to the dark palette immediately, without a page reload
      **Verification**: Open settings, toggle dark mode, and confirm the background color changes
      to the dark palette's hex value within the same render

## Non-Goals
- This issue does not add a system-preference auto-detect for dark mode. | decider: any request to
  add system-preference auto-detect for dark mode belongs here.

## Notes
- N/A.

## References
- N/A — no prior art gathered for this change.

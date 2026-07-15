# E14 — missing-request-payload

**Expected verdict:** REQUEST_CHANGES, and PASS is forbidden (the reviewer must not attempt to
review a partial payload as if it were complete)
**Expected anchor:** `payload contract` (the literal `**Rule:** payload contract` value — the one
`**Rule:**` value the agent contract reserves for a payload defect rather than a rule-file citation)
**Rule source:** `agents/issue-reviewer.md` § Payload Contract (dispatch precondition) — "The
dispatch payload contains exactly three kinds of labeled blocks: the original raw request... An
incomplete payload (any of the three blocks missing) is a payload contract violation."

**Single violation by design:** the child body below is itself fully compliant (concrete AC, no
weasel words, Non-Goals present, correctly triggered body shape) — the only defect is that the
**Original request (verbatim)** block, required by the payload contract, is entirely absent from
the dispatch. Dispatch exactly what appears under "Dispatch payload" below — do not add a request
block when reproducing this fixture; its absence is the point.

---

## Dispatch payload

<!-- OMITTED ON PURPOSE: no "Original request (verbatim):" block precedes the child body below.
     This is the fixture's single defect — reproduce it by dispatching only the block that follows. -->

**child:profile-avatar-upload**
## Problem
Users cannot upload a custom avatar image; the profile page only shows a generated initials icon.

## Pre-Context
- The profile page's avatar renderer is `profile/AvatarIcon.tsx` (renders the initials fallback
  today; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: A user who uploads a JPEG or PNG under 5MB on the profile page sees that image
      as their avatar instead of the initials icon, on the next page load
      **Verification**: Upload a 200KB PNG as a test account, reload the profile page, and confirm
      the rendered avatar's `src` points to the uploaded image, not the initials icon

## Non-Goals
- This issue does not add avatar cropping or resizing controls.

## References
- N/A — no prior art gathered for this change.

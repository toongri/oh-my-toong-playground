# E13 — research-backed-decision-clean

**Expected verdict:** PASS (no findings, no `**Rule:**` line at all)
**Rule source:** n/a — this is the negative control for the Decisions Needed
`- **Research-backed alternatives**` carve-out

**Why it is clean:** the Decisions Needed entry below carries a full alternatives table (option /
pros / cons / source URL) and a recommendation — but the recommendation is explicitly labeled
`proposal — not decided in this issue`, and no option is stated as chosen anywhere in the body. This
is the legal shape the carve-out describes: "an alternatives table... and a recommendation are
permitted; a decision is not. Record the recommendation as a `proposal — not decided in this
issue`, never as the entry's chosen answer." A reviewer that flagged this as pre-solving (E15's
violation) would be a false positive this fixture exists to catch — contrast the phrasing here with
`pre-solved-decision.md`, which states the outcome as already decided.

**Why the envelope is safe:** the carve-out under test rides a pure additive capability — a QR code
newly rendered in the share sheet. It adds a new element alongside the existing share actions rather
than changing a traversed path (non-transition, so no User Flow field is owed), delivers all its
value at acceptance (no measurable outcome to watch and no prod log/data/state to confirm, so
Post-Release Observation is correctly omitted), and its single AC is verified by decoding the
displayed QR — a read-only observation that mutates no persistent state (so no Setup/Cleanup is
owed). The only section that could draw a finding is Decisions Needed, which is exactly the axis
this control isolates.

---

## Dispatch payload

**Original request (verbatim):**
Let people share an item by QR code — add a QR to the share sheet so someone can scan it in person
instead of sending a link. Evaluate how we should generate the QR and file the issue with your
recommendation, but don't lock in the approach yet since the platform team hasn't weighed in on
client-bundle vs server-side.

**child:share-sheet-qr-code**
## Problem
The share sheet offers a link and a "Copy link" action but no QR code, so there is no way to share
an item to someone standing nearby by having them scan it.

## Pre-Context
- The share sheet is `share/ShareSheet.tsx` (the client-rendered panel that lists the existing
  share actions today; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Opening the share sheet for an item displays a QR code that encodes that item's
      public share URL (the same URL the existing "Copy link" action produces)
      **Verification**: Open the share sheet for a test item, decode the displayed QR with a
      QR-decoder, and confirm the decoded text equals the item's "Copy link" URL

## Decisions Needed
- How to generate the QR image — `proposal — not decided in this issue`, delegated to the platform
  team for a decision. Options gathered at Stage 2 (librarian research):

  | Option | Pros | Cons | Source |
  |---|---|---|---|
  | Bundle a client-side QR library | Renders offline, no new infra, no round-trip | Adds ~20KB to the web bundle | https://github.com/soldair/node-qrcode |
  | Add a server-side QR image endpoint | Zero client-bundle cost, cacheable across users | New backend route to operate plus a network round-trip | https://github.com/skip2/go-qrcode |
  | Use a managed QR image service | No code to maintain | Third-party dependency and per-call cost | https://goqr.me/api/ |

  Recommendation (`proposal — not decided in this issue`): the client-side library, since the share
  sheet is already client-rendered and the bundle cost is modest — final call belongs to the
  platform team.

## Non-Goals
- This issue does not add QR codes anywhere outside the share sheet, and does not add branded or
  color-styled QR rendering. | decider: any request for a QR code outside the share sheet, or for
  branded/color-styled QR rendering, belongs here.

## References
- N/A — no prior art gathered for this change beyond the Decisions Needed research above.

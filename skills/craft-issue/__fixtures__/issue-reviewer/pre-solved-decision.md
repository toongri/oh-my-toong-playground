# E15 — pre-solved-decision

**Expected verdict:** REQUEST_CHANGES
**Expected anchor (case-insensitive):** `pre-solv`
**Rule source:** `references/issue-craft.md` § Decisions Needed › `- **No pre-solving** — ...`

**Single violation by design:** the Decisions Needed section has a genuine open decision (whether
to retire the legacy discount-code path for existing users), but the entry states the answer as
already chosen ("Legacy discount codes will be retired for existing users; see `DESIGN-142` for
details") instead of naming the decision and its owner. The Decisions Needed section is genuinely
triggered here (a real open product decision blocks/shapes the work), so this is purely a
content-quality defect inside a present section, not a missing-section or over-scaffolding defect.

---

## Dispatch payload

**Original request (verbatim):**
Launch the new discount-code format for new signups. There's an open question about what happens
to existing users' legacy codes — product hasn't decided yet.

**child:new-discount-code-format**
## Problem
New signups need the new discount-code format; the launch is blocked on writing the issue, not on
the legacy-code question, but that open decision must be recorded so it isn't lost.

## Pre-Context
- The discount-code validation path lives in `promotions/discount-codes/validate.ts` (validates
  both legacy and new-format codes today; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: A new signup entering a new-format discount code at checkout receives the
      correct discount amount for that code
      **Verification**: Create a test new-format code worth 10%, complete a test checkout as a new
      signup, and confirm the applied discount equals 10% of the order subtotal

## Decisions Needed
- Legacy discount codes will be retired for existing users; see `DESIGN-142` for details.

## Non-Goals
- This issue does not change how legacy-format codes are validated for existing users. | decider:
  any request to change legacy-format code validation for existing users belongs here.

## References
- N/A — no prior art gathered for this change.

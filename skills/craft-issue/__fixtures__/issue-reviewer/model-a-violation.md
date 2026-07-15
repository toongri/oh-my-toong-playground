# E7 — model-a-violation

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Model-A Purity`
**Rule source:** `references/issue-craft.md` § Model A INVEST Slice Rubric › Model-A Purity Rules

**Single violation by design:** a Pre-Context bullet prescribes HOW the work will be implemented —
enforcing expiry by attaching a time-to-live to each stored session and dropping it on expiry — a
fixed-implementation commitment that belongs to `prometheus`/`sisyphus` downstream, not a WHAT-stage
issue. The bullet is deliberately *cited* (so no Pre-Context unbacked-assertion finding piggybacks),
names no code symbol (so no symbol-gloss finding piggybacks), and the AC declares Cleanup + a
randomized ID (so no Action/Expected/Verification state-mutation finding piggybacks) — leaving the
Model-A intent-ban violation as the only thing to cite.

---

## Dispatch payload

**Original request (verbatim):**
Sessions should expire after 30 days of inactivity instead of never expiring.

**child:session-inactivity-expiry**
## Problem
User sessions currently never expire, so a stolen or leaked session token remains valid
indefinitely.

## Pre-Context
- The session read path is `auth/session/read.ts` (validates the session token on every
  authenticated request; confirmed by Stage 3 investigation).
- Expiry will be enforced by attaching a 30-day time-to-live to each stored session and dropping it
  on expiry, rather than sweeping a database column (approach recorded in the Stage 2 design note).

## AC
- [ ] **[Outcome]**: A session with no activity for 30 days is rejected on the next request.
      **Verification**: Create a test session with a randomized ID, backdate its last-activity
      timestamp by 31 days, confirm the next authenticated request returns HTTP 401, then delete the
      test session.

## Non-Goals
- This issue does not add a user-facing "you were logged out due to inactivity" message.

## References
- N/A — no prior art gathered for this change.

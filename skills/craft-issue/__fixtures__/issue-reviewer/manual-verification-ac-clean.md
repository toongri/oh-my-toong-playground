# E12 — manual-verification-ac-clean

**Expected verdict:** PASS (no findings, no `**Rule:**` line at all)
**Rule source:** n/a — this is the negative control for A5 (verification-method breadth)

**Why it is clean, and what it is guarding against:** the sole AC's Verification step is a manual
human step, not an agent-executable command — but it is fully **defined and usable** (named device,
named screen, named physical action, named observable result), which is exactly what A5 requires the
reviewer to accept: "a test, a query, or a manual step are ALL valid verification methods... Do not
apply an agent-executable-only standard." A reviewer that penalizes this AC for not being scriptable
would be a false positive this fixture exists to catch. Contrast with a genuinely vague manual step
like "have someone check it looks right" (the `AC Anti-Patterns` › `Vague verification` row) — this
one names the exact device, the exact screen, and the exact physical trigger.

---

## Dispatch payload

**Original request (verbatim):**
Add haptic feedback (a short vibration) when a user long-presses a card in the mobile app's list
view, so there's tactile confirmation the long-press was registered.

**child:mobile-list-longpress-haptic**
## Problem
Long-pressing a card in the mobile app's list view has no tactile confirmation, so users cannot
tell by feel whether the long-press registered before the context menu appears.

## Pre-Context
- The list-view card component is `mobile/components/ListCard.tsx` (handles the long-press gesture
  today with no haptic call; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: Long-pressing a card in the list view on a physical iOS or Android device
      triggers a short haptic vibration at the moment the context menu opens
      **Verification**: On a physical test device (not a simulator, which cannot render haptics),
      open the app's list view and long-press any card; confirm by feel that a short vibration
      pulse occurs at the same moment the context menu appears

## Non-Goals
- This issue does not add haptic feedback to any gesture besides the list-view long-press. |
  decider: any request for haptic feedback on a gesture other than the list-view long-press
  belongs here.

## References
- N/A — no prior art gathered for this change.

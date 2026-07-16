# E3 — compound-ac

**Expected verdict:** REQUEST_CHANGES
**Expected anchor (case-insensitive):** `observable-AC`
**Rule source:** `references/issue-craft.md` § Observable-AC Rubric › Named Contract: prometheus
two-line observable-AC contract ("One AC = one observable state change ... Compound ACs bundle
independent changes and must be decomposed") — the reviewer stably cites this canonical contract
heading for a compound AC rather than the `AC Anti-Patterns` table's `Compound AC` row, so the
anchor tracks its stable citation (`observable-AC`), not the table label.

**Single violation by design:** the sole AC bundles two independent state changes (email receipt +
in-app notification) behind one checkbox and one Verification step. Each half is individually
concrete and non-weasel — the only defect is bundling them instead of decomposing per state change.

---

## Dispatch payload

**Original request (verbatim):**
When an order ships, notify the customer both by email and with an in-app notification.

**child:order-shipped-notifications**
## Problem
Customers currently have no notification when their order ships — they only find out when the
package arrives.

## Pre-Context
- Order-shipment events are published by `orders/fulfillment/shipped-event.ts` (emits the
  `order.shipped` event consumed by downstream notifiers; confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: The customer receives a shipment email AND an in-app notification when the
      order ships
      **Verification**: Trigger an `order.shipped` event for a test order and confirm both the
      email arrives in the test inbox and the in-app notification appears in the test account

## Non-Goals
- This issue does not add SMS notifications.

## References
- N/A — no prior art gathered for this change.

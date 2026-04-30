# Scenario Design — What to Test, Especially on Fixed-Screen Devices

## 1. Why This File Exists

The core skill covers *how* to write flows reliably — selectors, idempotency, screenshot policy, location resolution. What to test was deliberately left to project knowledge. That boundary breaks for fixed-screen devices where "navigate around the app" thinking does not map to a real user journey: a kiosk may expose one primary flow with dozens of hardware-state and time-based variants. Without a systematic approach, coverage is driven by what engineers remember. This file fills that gap.

## 2. Scenario Ideation Heuristics

### 2.1 Risk Matrix

Maestro's official guidance structures test priority around two axes: business impact and usage frequency.

|  | High frequency | Low frequency |
|---|---|---|
| **High impact** | P0 — must-pass; tag `smokeTest` | P1 — regression nightly |
| **Low impact** | P2 — regression weekly | P3 — manual or skip |

**Kiosk caveat.** When the device exposes a single main journey, the frequency axis collapses. Shift weight to the *variant axis*: hardware states (attached/detached/degraded), system configurations (locale, network mode, accessibility), and time-based conditions (idle timeout, clock rollover, scheduled refresh).

### 2.2 Single User Intent Per Flow

One flow, one user intent. "Can complete checkout with credit card" is a single intent; "can open app and click around" is not. When a flow grows past ~50 lines or contains more than one assertion goal, split it. Name flows after the intent: `checkout-credit-card.yaml`, not `test-payment-flow-v2.yaml`.

### 2.3 Smoke vs Regression Tag Criteria

| Tag | Run trigger | Inclusion criteria |
|---|---|---|
| `smokeTest` | Every PR | P0 only; suite completes in under 5 minutes; no flaky external dependencies |
| `regression` | Nightly | Full P0 + P1 coverage; slow flows are acceptable |
| `feature:<area>` | Per-feature CI step | Orthogonal filter; select by feature directory |

Avoid `slow` and `flaky` as tags — both are defects, not categories.

## 3. Edge Case Techniques (ISTQB Classics Applied to Mobile/Maestro)

### 3.1 Equivalence Partitioning

Divide the input space into classes the system treats identically; test one representative per class. For an email field: valid format, malformed (missing `@`), empty, too long — four classes, four inputs.

In Maestro: each partition is a separate flow or data-driven parameter. Do not chain all variants in one flow; a mid-flow failure masks remaining cases.

*Applies to:* input fields, numeric entry, dropdowns, search queries.

### 3.2 Boundary Value Analysis

At each threshold, test 0, 1, max-1, max, and max+1. Common boundaries: character limits on text fields, item counts in paginated lists (0, per-page − 1, per-page, per-page + 1), quantity selectors at floor and ceiling.

*Applies to:* text fields with length limits, list pagination, countdown timers at zero.

### 3.3 State Transition Testing

Model the screen or device as a state machine. For each state, enumerate valid actions, invalid actions, and transitions. Cover each valid transition and at least one invalid-input-in-wrong-state case.

The ATM and vending machine are canonical examples (softwaretestingmaterial.com): each state accepts a strict input subset. A kiosk is identical — a dispense command while the peripheral is detached is an invalid-in-wrong-state case a serial glitch will eventually trigger.

**Primary technique for kiosks.** Map the device's state machine before the first flow.

*Applies to:* multi-step checkout, authentication, hardware-coupled UIs, screens whose valid actions depend on prior history.

### 3.4 Decision Tables

For screens driven by multiple conditions, enumerate all combinations, prune impossible ones, cover the rest. Example: (user role) × (subscription tier) × (feature flag) yields up to eight combinations; admin-always-premium eliminates some — one flow per remaining row. Pass condition values as environment variables or a CI matrix; keep the flow YAML generic.

*Applies to:* permission-gated features, A/B tested screens, multi-tier subscriptions, locale-conditional rendering.

### 3.5 Error Recovery Scenarios

For each failure mode, determine whether the system recovers (device returns to a known state) or degrades (data corrupted, stuck). Trigger the failure at maximum consequence (mid-dispense, mid-pairing) — this surfaces the highest-value defects first.

In Maestro: recovery scenarios often need infrastructure outside the YAML (a shell script that drops the network or sends a serial command); the flow verifies UI state after the interrupt.

*Applies to:* any flow touching network, hardware peripherals, or persistent state.

## 4. Kiosk / Fixed-Screen Scenario Categories

Not every kiosk needs every row. Prioritize where the device's failure modes overlap the category.

| Category | Example Triggers | Sample Scenarios |
|---|---|---|
| **Time-based** | system clock change, scheduled job, idle timeout | screen wakes after N minutes idle / clock crosses midnight resets daily counter / scheduled refresh fires during active session |
| **Peripheral interaction** | USB-serial command, BLE pairing, NFC tap, sensor reading | dispense triggered by serial command / BLE re-pairs after disconnect / sensor delta updates display |
| **External trigger** | cron job, push notification, network event, peripheral signal | server push lights status indicator / cron rotates featured item / peripheral interrupt routes device into maintenance mode |
| **Soak / long-run stability** | 24h continuous operation, memory growth, repeated cycles | 1000 dispense cycles without restart / overnight idle stability / heap growth across 8-hour session |
| **System config change** | locale, volume, network mode (WiFi to cellular), accessibility settings | locale switch mid-session / volume zero when audio cue expected / TalkBack or VoiceOver enabled |
| **Error recovery** | network drop, peripheral unplug, power cycle, OOM, app crash | network drop during dispense — device returns to idle / hardware unplug + replug restores operation / cold reboot — device self-registers |
| **Security / auth** | session expiry, credential rotation, tampered config | auth token expires mid-flow — clean redirect / credential file missing — lockout not crash / firmware downgrade blocked |
| **Accessibility** | screen reader, large font, high contrast | TalkBack reads correct labels / 200% font keeps buttons reachable / dark mode passes contrast thresholds |

## 5. Scenario → Flow Mapping Patterns

- **1 scenario → 1 flow (default).** One intent, one file.
- **N scenarios → data matrix.** When the same interaction runs against many inputs (100 product codes, all locales), drive from outside via a shell loop or CI matrix. Keep the flow YAML generic and idempotent.
- **Setup → subflow under `common/`.** Login, pairing, factory reset — shared preconditions belong in `<flow_dir>/common/` and are called via `runFlow`. See `flow-organization.md`.
- **Teardown rarely needed.** `clearState: true` at the next `launchApp` replaces explicit teardown for app-level state. Hardware state is the exception — document teardown steps explicitly rather than encoding them in the flow.

## 6. External References

- [Maestro — E2E Testing Best Practices: Complete 2025 Guide](https://maestro.dev/insights/end-to-end-testing-best-practices-complete-2025-guide) — risk matrix, smoke/nightly split.
- [Maestro Best Practices: Structuring your Test Suite](https://maestro.dev/maestro-best-practices-structuring-your-test-suite-54ec390c5c82) — single user intent per flow.
- [ISTQB — Equivalence Partitioning, BVA, Decision Tables](https://www.istqb.guru/decision-tables-equivalence-partitioning-boundary-value-analysis/) — three classical techniques.
- [State Transition Test Design Technique](https://www.softwaretestingmaterial.com/state-transition-test-design-technique/) — ATM and vending machine examples directly applicable to kiosks.
- [testgrid.io — IoT Testing: The Complete Guide](https://testgrid.io/blog/iot-testing-the-complete-guide/) — interrupt-during-critical-moment pattern.
- [TestDevLab — Hardware & IoT Device Testing](https://www.testdevlab.com/blog/hardware-and-iot-device-testing) — peripheral protocol testing (BLE, USB-Serial, MODBUS).
- [Parasoft — IEC 62304 Compliance Overview](https://www.parasoft.com/blog/what-is-iec-62304-how-is-it-used-in-medical-device-compliance/) — confirms regulated standards do not specify scenario design.

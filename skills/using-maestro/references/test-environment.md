# Test Environment — Category-Driven Defaults

> Status checked: 2026-05-01. Capability boundaries shift with Xcode/Android Studio releases — verify per current SDK docs before relying on specifics.

This reference begins with **two categories**. Which category applies determines the default environment (emulator/simulator vs physical device).

## Category A — Software application (consumer / business app)

**The default is emulator/simulator.** If the app is a regular mobile app running on top of OS-supplied UI, follow this default without additional judgment.

| Reason | Effect |
|---|---|
| Parallelization | Multiple instances can be spun up on a single machine to run flows concurrently — CI throughput expansion (within the limits of host-resource contention). |
| Environment isolation | Not affected by the developer's/QA's physical-device notifications, login state, or network variability. Every run starts from the same cold state. |
| Speed | Snapshot boot; no USB/WiFi ADB pairing step. |
| Availability | Instant switching between OS version and resolution profiles; no physical-device fleet maintenance cost. |
| Reduced state variables | No hardware throttling, battery level, or ambient sensor noise → fewer flake variables (host-resource contention still applies). |

## Category B — Hardware-integrated SUT (kiosk / IoT / medical device)

**The physical device IS the SUT.** The default above does not apply — an emulator cannot verify this SUT. For scenario design see [`scenario-design.md`](scenario-design.md); for MCP vs CLI decisions see the Decision Matrix in [`ai-agent-integration.md`](ai-agent-integration.md). The remaining sections of this reference (Limits, Decision Rule) apply only within Category A.

## Category A Limits — Areas that are inaccurate or incomplete on emulator/simulator

If a specific capability is under verification in a flow, explicitly require a physical device for that flow. This is a per-capability decision, not a per-category decision.

| Area | Limit |
|---|---|
| ABI / native module compatibility | React Native JSI / Turbomodule / vendor native SDKs may pass on emulator/simulator due to ARM↔x86 differences but crash on physical devices. Build fingerprint differs. |
| Camera / microphone / sensor | Emulators can simulate some inputs (location, motion, fingerprint, etc.). **Real optical input, microphone audio fidelity, and true GPS fix are physical-device only.** |
| BLE / NFC / USB peripheral | Unsupported or limited to partial simulation. |
| Biometric authentication | UI flow can be verified on emulator/simulator. **Secure-enclave attestation, real enrollment, and hardware authentication flows are physical-device only.** |
| Push notifications | iOS Simulator supports `.apns` payload push from Xcode 11.4+. **Production APNs delivery, silent-push reliability under Doze/low-power, and entitlement-gated branches require physical.** |
| Payment (Apple Pay / Google Pay) | Sandbox is possible on emulator. **Production payment regression is physical-device only.** |
| Manufacturer SDK / DRM / attestation | Modules dependent on device attestation: Widevine L1, Play Integrity / SafetyNet, Samsung Knox, etc. |
| Deep link / Universal Link / App Link | Domain-association verification and provisioning-profile differences cause behavior to diverge from physical devices. Some gaps exist in iOS Simulator universal link handling. |
| Real network conditions | Cellular handoff, captive portal, IPv6-only environments — emulator network throttling uses synthetic data. |
| Performance / battery / thermals | Not a Maestro correctness-verification target. Emulator shares host resources → measurements are meaningless. (This row is spelled out to prevent misuse by AI agents and humans.) |

iOS Keychain accessibility differences are handled in the reset/state-isolation context of [`test-isolation-and-reset.md`](test-isolation-and-reset.md), not as a separate table here — they are closer to a state-isolation issue than a capability limit.

## Maestro's own environment constraints

- **Maestro Android** — supports both emulator and physical device.
- **Maestro iOS** — **simulator-centric**. Physical iOS device support is historically limited. Even within Category A, if iOS physical-only capabilities (e.g., many of the Limits rows above) are under verification, Maestro alone has limits; a separate decision is needed on whether to complement with XCUITest or other tools.

## Decision Rule

1. **Classify the SUT** — determine whether Category A or B first. A project-local SKILL.md or `flow_dir` config may indicate this.
2. **Enter Category A** — pin one emulator/simulator profile as the reference and start.
3. **Visual regression baseline** — whether emulator or physical, pin to **one type + one profile**. The rule against cross-profile baselines is in [`storage-and-screenshots.md`](storage-and-screenshots.md).
4. **Capability override** — if a Limits table entry is under verification in a flow, require physical for that flow. Isolate with a tag (e.g., `device:physical-required`) and route to a separate CI stage. Cadence (nightly/pre-release/on-merge) is a team decision — outside the scope of this skill.

## Orthogonality

This guide concerns the **device-target axis** (emulator vs physical). It is orthogonal to the **tooling-channel axis** (MCP vs CLI, [`ai-agent-integration.md`](ai-agent-integration.md)). Combinations such as "kiosk physical + CLI", "consumer emulator + MCP", and "consumer physical + CLI" are all valid. Do not merge the two axes.

## How this list ages

Emulator/simulator capabilities expand with every Xcode / Android Studio / Maestro release. Specific rows in the Limits table above (especially push, biometric, payment, deep link) narrow over time. This is why capability categories (e.g., "secure-enclave attestation") are used instead of version-named feature expressions. Verify current Maestro/SDK documentation before depending on any row.

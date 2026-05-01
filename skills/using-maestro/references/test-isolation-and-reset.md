# Test Isolation and State Reset

> **Is starting every E2E scenario from a clean state actually the industry standard?**
> Yes. Resetting app-level state at the start of each scenario is the explicit recommendation of every major mobile E2E framework, and chained scenarios are an explicit anti-pattern. There are documented exceptions, all of them shaped by physical or economic constraints rather than design preference.

This reference exists because the question "do we really need to reset every time?" comes up early and the wrong answer compounds into chronic flakiness.

## The Core Principle

Mobile E2E testing inherits the **test isolation** principle from unit testing: each test sets up its own state and never depends on the residue of a previous test. The framework documentation states this directly:

- Detox: "restart your app before every test" (Wix Engineering, the team that built Detox).
- Maestro: `clearState` documented as the standard way to "start with a clean slate".
- Appium / Espresso: equivalent reset semantics built into the standard test base classes.

The reason is empirical, not aesthetic. Roughly **a quarter of E2E flakiness traces back to environmental contamination** — leftover cookies, retained auth tokens, partial DB rows, app state from the prior scenario. Isolation eliminates that quarter at the source.

## Reset Levels — What Actually Gets Cleared

Reset is not a single operation. There are five layers, each with different cost and standardization.

| Level | Tool / Mechanism | When Used | Standardization |
|---|---|---|---|
| **App data** | Maestro `clearState`, Detox `device.launchApp({delete: true})` or `resetAppState()`, Appium `mobile: clearApp` | Every scenario, by default | The standard. All major frameworks support it. |
| **App reinstall** | Detox `launchApp({delete: true})`, Maestro on iOS (internal reinstall) | When data-clear is insufficient (e.g., native module state) | Slower but unambiguous. |
| **Device wipe** | AVD cold boot, factory reset | Device-level config drift (permissions, certs, system state) | Rare. Mostly CI pipeline initialization. |
| **Backend / fixture reset** | Test DB rollback, mock server restart | State-bearing API tests | Recommended where applicable. No single standard tool. |
| **Physical hardware reset** | BLE re-pair, USB re-enumerate, peripheral cycle | IoT, medical devices, kiosks | **No standard.** Industry has not converged on a pattern. |

The standard reset, the one every framework supports out of the box, is **app data**. Going further (reinstall, device wipe) is opt-in for specific failure modes.

### What Maestro `clearState` Actually Resets

| Platform | Behavior |
|---|---|
| Android | Equivalent to `adb shell pm clear <package>`. Wipes SharedPreferences, app SQLite databases, accounts, caches. AsyncStorage (which RN typically backs with SQLite or files inside the app sandbox) is **included**. |
| iOS | Reinstalls the app. The app data folder is destroyed entirely. **Keychain is NOT cleared** — iOS Keychain entries persist across app uninstall by default. |

Two practical consequences:

- On iOS, if your auth flow stores tokens in Keychain, `clearState` alone does **not** log the user out. You either explicitly clear Keychain in the app's `isE2E` startup branch or accept that the post-`clearState` state is "uninstalled but keychain-retained".
- Maestro [issue #1601](https://github.com/mobile-dev-inc/maestro/issues/1601) reports cases where iOS UserDefaults is not reliably cleared. The workaround is to call `clearState` and then `launchApp clearState: true` again — redundant but practically reliable.

## Legitimate Exceptions

Not every scenario should reset. The exceptions are real, and pretending otherwise leads to suite designs that are slow without being safer. Each exception below is documented as acceptable in the literature.

| Exception | Why it is legitimate | Constraint |
|---|---|---|
| **Suite-level flow** (login → add to cart → checkout treated as one integration unit) | Tests the user journey as users actually live it. | Must be designed and managed as a suite, not as chained tests. State leaks between suite-level flows are still bad. |
| **BLE / pairing / hardware bring-up** | Pairing can take 10–60 seconds; doing it per scenario destroys the suite budget. | Pair once at suite start; assert post-pair state at scenario start; reset app data only. |
| **Large seed data** | Restoring a multi-GB dataset per scenario is unrealistic. | Use read-only shared fixtures. Tests must not mutate the seed. |
| **Kiosk / IoT real device** | Factory reset is impractical or impossible (kiosk in a customer site, medical device under regulatory lock). | Reset at the app layer; treat device/OS state as a stable invariant. |
| **CI cost ceiling on slow reinstalls** | iOS reinstall can be 30s+ per scenario. | iOS `clearState` *is* a reinstall (the app data folder is destroyed) — budget 30s+ per scenario. Android `clearState` is data-only (no reinstall). Reinstall is unavoidable on iOS; the only saving is to suite-scope `launchApp` where the test design allows. |

The pattern across all five exceptions: **reset what you can afford; isolate at the highest layer that gives you stability**. The kiosk case is the relevant one for this project — the device's USB peripherals and OS configuration are invariants, but app data resets every scenario.

## What is Explicitly an Anti-Pattern

These patterns are flagged as anti-patterns by Detox, Wix Engineering, Docker's E2E reliability blog, and Uber's testing blog:

- **Test A produces a value that Test B reads.** Cascading failures, no parallel execution, debugging requires running the whole sequence.
- **Skipping reset to "save CI time"** without measuring the resulting flake rate. Time saved on isolation is reliably spent on flake investigation.
- **Letting the previous run's screen state determine the next run's flow.** This is the carousel-state-drift bug — the third run is on a different page than the first.

## How This Applies to Maestro Specifically

Apply both rules together at the top of every flow:

```yaml
- launchApp:
    clearState: true
    arguments: { isE2E: "true" }
```

`clearState` handles the framework-supported portion. The `isE2E` argument is the lever your app uses to handle the framework-unsupported portion: skipping splash animations, mocking network responses, clearing Keychain, suppressing third-party SDKs that don't honor data clear.

For kiosk / hardware-integrated builds where physical state is preserved across runs, the contract is:

| State layer | Reset by | Notes |
|---|---|---|
| App data (AsyncStorage, settings, auth) | `clearState: true` | Standard |
| In-memory app state (animation counters, mocks) | `arguments: { isE2E: "true" }` | App must implement the receiver |
| Native module state | Maestro에서는 `launchApp { clearState: true, clearKeychain: true }` (iOS는 clearState가 internal reinstall로 동작) 또는 `isE2E` 분기의 app-side teardown. Detox의 `launchApp({ delete: true })`(L24)와 개념적으로 유사하나 문법은 다름 | Depends on the module |
| Hardware peripheral (USB serial, BLE) | **Out of scope for app E2E.** Treat as invariant or reset at suite start. | Document the assumption |

## Quick Decision Guide

```
Writing a new flow → Always start with launchApp: { clearState: true, arguments: { isE2E: "true" } }
Flow flakes on second run → Check whether you actually have clearState; check whether app honors isE2E
iOS auth state surviving uninstall → Keychain. Add a Keychain wipe path in your isE2E branch.
Pairing takes 30s and destroys CI time → Move pairing to suite setup, app-data-only reset per scenario
Need to validate a multi-step user journey end-to-end → Design as a single flow, not chained scenarios
```

## References

- [Detox Device API](https://wix.github.io/Detox/docs/api/device/) — `launchApp`, `resetAppState`, `delete` semantics
- [Detox: Writing Stable Test Suites (Wix Engineering)](https://medium.com/wix-engineering/detox-writing-stable-test-suites-372c9d537184) — `beforeEach` restart guidance
- [Maestro `clearState` documentation](https://docs.maestro.dev/reference/commands-available/clearstate) — platform-specific behavior
- [Maestro issue #1601](https://github.com/mobile-dev-inc/maestro/issues/1601) — iOS UserDefaults reliability
- [Docker: Native E2E Test Reliability](https://www.docker.com/blog/native-e2e-test-reliability/) — hybrid CI strategy, fresh test accounts per session
- [Uber: Shifting E2E Testing Left](https://www.uber.com/us/en/blog/shifting-e2e-testing-left/) — isolated sandbox, parallel execution
- [Memfault: How to Test Your IoT Product](https://memfault.com/blog/how-to-test-your-iot-product-before-launch/) — IoT E2E workflow validation patterns
- [Thunders.ai: Modern E2E Test Architecture](https://www.thunders.ai/articles/modern-e2e-test-architecture-patterns-and-anti-patterns-for-a-maintainable-test-suite) — chaining as anti-pattern

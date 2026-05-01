# Selectors and Determinism

Two pillars hold a Maestro flow together: **selectors** that find UI elements reliably, and **guardrails** that make every run produce the same result. Both fail silently when ignored — the flow passes today, breaks tomorrow without a code change.

## Selector Priority

Maestro can match elements by text, accessibility id, relational position, state, index, or coordinate. Always pick the highest-stability option that uniquely identifies the target.

```
text > id (accessibilityLabel/testID) > relational > state > index > point(coordinate)
```

| Selector | Use when | Stability |
|---|---|---|
| `tapOn: "로그인"` / `assertVisible: "로그인"` | The element shows user-facing text in the current locale. | ⭐⭐⭐⭐⭐ |
| `tapOn: { id: "submit-btn" }` / `assertVisible: { id: "main-root" }` | Icon-only button, multilingual app, multiple elements share the same text. | ⭐⭐⭐⭐ |
| `tapOn: { below: "헤더" }` | The element has no stable text/id but a stable neighbor. | ⭐⭐⭐ |
| `tapOn: { enabled: true, text: "확인" }` | Composite condition (state plus text). | ⭐⭐⭐ |
| `tapOn: { index: 2, text: "옵션" }` | Multiple matches and you can predict ordering. Fragile. | ⭐⭐ |
| `tapOn: { point: "85%, 28%" }` | Last resort — coordinate. Breaks across resolutions. | ⭐ |

### Why coordinate is last resort

Even percentage coordinates (`"73%, 94%"`) break when:
- The device has different screen aspect ratio
- A safe-area inset shifts the layout
- A status bar appears or disappears
- The carousel state changed since last run

If you find yourself using coordinates, ask the developer for a `testID` or `accessibilityLabel` on the target. That ten-second code change buys you years of test stability.

### When text matching fails

Text only matches what the UI hierarchy reports. **Text rendered inside an image, SVG, or `<Image>` source does not appear in the hierarchy.** Logos and icon-text labels are the most common offenders. Fall back to id (preferred) or coordinate (last resort).

Locale matters. `tapOn: "로그인"` works only when the app is rendered in Korean. Either fix the locale at runtime (most apps do this in CI), or switch to id selectors for any flow that crosses locale boundaries.

## The Five Determinism Guardrails

| Guardrail | Implementation | Purpose |
|---|---|---|
| **`clearState: true`** | `launchApp clearState: true` | Reset AsyncStorage, cookies, app data so every run starts identically. |
| **`isE2E` argument** | `launchApp arguments: { isE2E: "true" }` | The app reads this on startup and disables animations, mocks unstable services, activates fixtures. **The app must implement the receiver** (a check in `index.js` or a native module) — Maestro just passes the value. |
| **Selector text/id over coordinate** | See selector priority above. | Coordinates break across devices and OS versions. |
| **`extendedWaitUntil`** | `extendedWaitUntil: { visible: "...", timeout: 30000 }` | `assertVisible` already auto-retries within its default ~7s window. Use `extendedWaitUntil` for state that may exceed that — JS bundle load, network fetch, and animations occasionally need longer polling. |
| **`retry` and `repeat` for known flakiness** | Built-in command. Use only after rooting out the cause. | Some races (lottery animations, third-party SDK init) are inherently non-deterministic. Retry once or twice; never more. |

### When determinism still breaks

Symptoms of a non-deterministic flow:
- Passes once, fails twice — race condition or animation timing
- Passes locally, fails in CI — Metro/dev-server still attached, or different screen size
- First run after `clearState` passes, second run fails — flow leaves residue between runs

Fix order:
1. Add or strengthen `clearState`.
2. Replace `assertVisible` with `extendedWaitUntil` for any post-launch state.
3. Add `isE2E` and have the app turn off animations.
4. Replace coordinate selectors with text/id.
5. Only after the above, consider `retry`.

## Idempotency Across Runs

A flow is idempotent when running it N times in a row produces the same observed behavior. Any flow that mutates app state without `clearState` is at risk.

The most common idempotency trap: a carousel or paginator. The first run selects "page 2"; the second run starts on page 2 and selects "page 3". Without `clearState`, the test drifts.

The right fix is to start every flow from a known state, not to compensate for accumulated state in the flow itself.

## Common Selector Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Coordinate-based tap | Works on developer's device, fails in CI | Add `testID` to the target component, switch to id selector |
| `assertVisible` immediately after `launchApp` exceeds 7s default retry | "Element not found" on slow cold start | `extendedWaitUntil` with 30s timeout |
| Asserting on text rendered inside an `<Image>` | "Element not found" — text isn't in hierarchy | Use id or position selector |
| Same text appears multiple times | Wrong element gets tapped | Add `index:` qualifier or use id |
| Locale change causes failure | Text in different language | Pin app locale in CI, or use id selectors |

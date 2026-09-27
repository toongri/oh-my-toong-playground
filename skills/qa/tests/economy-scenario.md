# Economy — The Cheapest Proof of the Change

**Purpose**: RED/GREEN record for the qa skill's economy principle (`SKILL.md` Role, PLAN.1 *The cheapest proof*, ADVERSARIAL E2E Red Flags). It measures whether a verifier proves the changed stories by the cheapest means that proves them, instead of driving a rendered screen for every change.

**Origin**: user report — every QA cycle drove the user's screen, even when the screen did not change, so simulators and emulators kept booting and the machine ran out of resources.

## Scenarios

Each run: a fresh subagent reads `SKILL.md`, `scenario-authoring.md`, `stage3-handson.md`, then plans (no execution) for one QA REQUEST.

| # | QA REQUEST | Correct plan |
|---|---|---|
| 1 | Server-only: `stock.getSummary` rounds up instead of down; the app's Stock screen code is unchanged | `curl` the API. No device, no app build. |
| 2 | Django `approveProposal` rule change, with new integration tests that send the real mutation and assert each AC's response | Cite the tests with `--evidence-surface test`; `curl` only what they don't cover (concurrency, injection, ownership). No device. |
| 3 | React Native JS-only UI change (new button + navigation), with a component test using mocked navigation | One device on one platform for what only a screen proves (real navigation); cite the test for what it asserts. |

## RED — before the change (verbatim excerpts)

1. Booted a simulator: "The acceptance criteria are about a value the user sees on the Stock screen. A reading taken only through curl leaves that screen unverified." Cited: "Never QA only the platform where the change landed."
2. Booted a simulator and rejected the tests: "The new integration tests are never scenario evidence." Cited: "A unit / integration / component test-runner report … is NEVER a cell's evidence."
3. Booted an iOS simulator **and** an Android emulator plus a local backend. Cited: "A changed surface is verified from every platform where an actor observes it."

## GREEN — after the change (verbatim excerpts)

1. "아니요. 변경은 서버 파일 하나뿐이고 모바일 코드는 바뀌지 않았습니다. 앱이 받는 값은 API 응답이 증명합니다." Cited: "A client whose code did not change needs no screen."
2. "The new integration tests count as proof for the four behaviours they assert. `curl` covers only what those tests do not." Device: no.
3. One iOS simulator, released after its scenarios; the component test cited for visibility, rejected for navigation because "Test가 증명하는 것은 mock `navigate` 호출뿐입니다".

## Rationalizations the skill now answers

See `SKILL.md` → *Red Flags*: boot a simulator for a server-only change; verify RN JS on both platforms; re-drive what a test asserts; launch the admin web for a flag; keep the device until CLEANUP.

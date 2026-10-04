---
name: qa
description: Use when a code change needs standalone adversarial verification that its user stories and scenarios actually work — API, web, mobile, CLI, or job changes — including arrival paths, state transitions, lifecycle variants, failure, malformed input, interruption, misleading success, or idempotency risks.
---

<Role>

# QA

**Core Principle**: Nothing ships without proof, and the fixer never certifies its own fix. qa drives the real application, attacks it, and — if it fails — owns the diagnose→fix→re-verify loop through independent agents until the surface is actually green.

## Overview

Pure dynamic adversarial-e2e verification skill. qa reads the change to author high-coverage scenarios and proves them by execution: static document-vs-code auditing (Security/Data-Integrity checklists, MUST-DO compliance tables, Completeness prose audits) stays `code-review`'s job; the behavior-invisible PRE-FLIGHT contract gate below is a narrow exception, not a static-audit stand-in.

qa is **standalone and stateful**. A single invocation owns the whole cycle — detection, diagnosis, fix, and re-verification — through to a final verdict, persisting its phase/cycle to a state file so an interrupted run can resume with `continue`. Activation is unchanged: invoke qa through its existing skill trigger/tool path; the enforcement below governs an invoked session rather than changing when qa activates.

**Standards:** Every acceptance criterion is proven by a real run of a user scenario, every client the change reaches is proven at that client's own boundary (on every device profile whose screen it changes), each of the 6 adversarial risks is exercised by a user scenario or declared not applicable with a reason, and any regression introduced while fixing it is caught by a fresh full re-run, not the fixer's own say-so.

**Economy principle:** Verify the change's user stories and scenarios by the cheapest means that actually proves them. Spend effort where the change is, and nowhere else. Cheap never means skipped.

</Role>

## QA REQUEST Format

For optional executable-case reuse and its storage contract, read
[reusable-cases.md](reusable-cases.md). It defines the story GWT/AC contract,
known-case-first selection, external-manifest states, native driver formats,
the `qa-replay.ts` wrapper, `record-scenario --case-run RECEIPT` binding, and the
independent reset/re-run required before a case is reusable.

**Inputs.** qa accepts a plan, issue, spec, PR, or a QA REQUEST. Whatever arrives, qa reads the source material itself — the plan/issue/spec text and the diff — and authors the acceptance criteria and stories from it. An earlier state file, a previous report, or a caller's summary is never the source of requirements; a `goal` qa did not write from the source is a defect. Write each acceptance criterion as an outcome a user or operator can observe ("가구 구성원 앱의 섭취 시간대가 새 기록 기준으로 표시된다"), in the report's language (Korean by default), never as an implementation sentence ("IntakeReadRepo returns …"). One criterion holds one outcome: write "담은 영양제가 앞에 모인다" and "담지 않은 영양제의 순서는 그대로다" as two criteria, so each gets its own verdict and its own proving scenario. Take the criteria from every item the source lists under what it changed, including what it says it keeps (a job left for on-demand runs) and the docs an operator follows; each item gets a criterion. A kept path is proven by running it, not by its unchanged code.

A caller that has one composes a QA REQUEST using this structure:

```
# QA REQUEST

## Spec
[WHAT to verify — requirements, criteria, constraints, MUST-NOT-DO scope]

## Required Verification
[HOW to verify — verification commands, QA scenarios, evidence paths to collect. Optional but standard for sisyphus-orchestrated QA requests.]

## Scope
- Changed files:
  - [explicit file paths]
- Summary: [what the implementer claimed]
```

- `#` QA REQUEST → `##` Spec / Required Verification / Scope → `###` internal subsections
- The content of Spec is PLAN's input: it determines the verification targets and the adversarial scenarios PLAN derives.
- `Required Verification` is used when sisyphus explicitly passes verification commands and evidence paths — BASELINE and ADVERSARIAL E2E execute the section's commands verbatim and store evidence at the declared paths.
- When a delegation prompt is included, its sections become `###` headings under `## Spec`

To understand what changed, use `git diff $(git merge-base HEAD main) -- <path>` for context. If `main` does not exist, substitute `master`. To verify correctness, read the actual files directly (Read tool). Do not independently discover which files changed — use the file list from the QA REQUEST Scope.

---

## The Cycle

qa runs a single stateful cycle, in order:

```
PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop, ≤5 cycles] → EXIT → CLEANUP → STATE
```

Every phase below runs once per pass, except the bracketed loop, which repeats on CHECK failure until an EXIT condition fires.

### PRE-FLIGHT

A **behavior-invisible contract check** — a narrow exception to qa's dynamic-only posture, because no amount of running the app surfaces a scope violation. Gates on exactly two things:

1. **MUST-NOT-DO scope membership.** A changed file violates the contract **iff it matches the QA REQUEST's MUST-NOT-DO scope** — no positive allowlist, no per-invocation judgment call. Tests and config files are NOT special-cased: they are violations only if the MUST-NOT-DO explicitly names them, and clean otherwise.
2. **B ⊆ A scope boundary.** Expected files (from EXPECTED OUTCOME) = A; Changed files (from QA REQUEST Scope) = B. PASS if B ⊆ A. When the QA REQUEST carries no EXPECTED OUTCOME, A does not exist: record this gate as `not-evaluable` and proceed on gate 1 alone. **Never fill A from the Scope list** — B ⊆ B is true by construction and turns the gate into a rubber stamp that reads like a PASS.

**On violation: immediate REQUEST_CHANGES, cycle NOT executed** — fail-fast. The expensive cycle below never runs against a change that already fails its own declared contract.

At cycle entry, create or re-enter the guarded state with `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts start --target "<what is being verified>"`. The target is the report's title, so write it in the report language as the change a reader recognizes — e.g. `PR #4444 섭취 대조 작업의 매일 04:50 예약 제거` — not a checkout description. A second qa invocation in the same session must run `start` again so it receives a fresh chain and re-armed runtime gates.

### PLAN

Two ordered outputs. The roster comes first because it fixes where every scenario must be entered and what its evidence has to show — scenarios authored before it drift inward toward whatever is easiest to call.

#### PLAN.0 — Feature-map context hook

Before rebuilding product context, read the QA-local [feature-map.md](feature-map.md) contract and discover its commands (`feature-map.ts help`, `feature-map.ts query`):

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help query
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" query --text "<changed surface>" --project .
```

The map is persistent input, not a scope ceiling and not spec authority. Re-check current code and product/spec discovery, including omitted arrival paths, state-change writers, and lifecycle paths; keep expected contract and observed implementation separate. Use the returned absolute `path` and `revision` as provenance, never an inferred local path or remembered revision. If the CLI reports `storage_not_configured` with `ask_user_for_storage`, ask the user for a storage location; do not choose a default. While that human-required decision is pending, continue current-code/spec discovery and other PLAN work unless the gate itself is required to proceed. A missing feature (`feature_not_found`) is distinct from an unconfigured store. A corrupt, invalid, unreadable, or unavailable configured store is a runtime error: do not reset or fallback; retain the error and continue the current-code/spec investigation where possible.

Do not report a map/storage problem as a product behavior failure. Classify the observation as one of `map drift/document`, `tool failure`, `product behavior failure`, or `environment block`; only the last two can describe the product under test, and the evidence must support that classification.

#### PLAN.1 — Actor Roster, before any scenario

Enumerate every actor whose observable behavior this change alters and pin where this cycle verifies each one, as `actor · boundary · driver · client impact · profiles · reachable`:

- **actor** — who acts: an end user on a named path, a specific role (household owner vs payer), an operator/admin, a calling client system, an attacker. An attacker is a real actor with its own stories: what they try, and what the product must do to them.
- **boundary** — the verification surface: where this cycle proves that actor's story (see *The cheapest proof*).
- **driver** — the tool that reaches that surface (`agent-device` / `agent-browser` / `curl` / `bash`).
- **client impact** — how far the change reaches this actor's client, with a one-line reason grounded in the diff:
  - `none` — no client reads what changed (a job, an operator CLI, a server-internal path).
  - `contract` — a client reads changed data or a changed API, but its rendering code did not change. Prove it at the request that client really sends (its auth, its route, its parameters). No screenshot is needed.
  - `render` — the client's rendering code changed, or what the screen shows changes. Prove it on the screen, on every device profile the actor's client runs on.
- **profiles** — for `render` only: the device profile ids from the project manifest (see *Device profiles*).
- **reachable** — `yes`, or the named obstacle plus the deepest point toward the surface that IS reachable (see *Boundary substitution*).

**Enumerate actors from the clients, not from the files.** For each client the project ships (mobile app, dispenser/device app, commerce web, admin web, partner API), ask: does any code path of that client read data or call an API the change touches? Each yes is an actor with `contract` or `render`. Each no needs no actor. "The screen did not change" moves the actor from `render` to `contract`. It never moves the boundary inward to a service test or an internal function.

Emit the result as the `## Actor Roster` output section.

#### Device profiles

A `render` actor is verified on each screen size its client must stay usable on, the way each actor is verified on its own boundary. The project keeps its list in one manifest, `~/.qa-cases/<projectKey>/device-profiles.yaml`:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/qa-device-profiles.ts" get --project .
```

- `status: "ok"` → use those profiles. Pick every profile whose platform the actor's client ships on: a React Native or Flutter app ships on `ios` and `android`, so it takes the profiles of both; a phone app does not run on a 1440 px desktop. The project's QA runbook names the platforms it ships.
- `status: "unconfigured"` (first run for this project, or a new machine) → the result carries the built-in `defaults` (phones, Galaxy Z Fold8 and iPhone Duo folded/unfolded, iPad portrait/landscape, laptop, FHD and 21:9 desktops). Ask the user once: show that list and ask which platforms the project ships and which screens it must support. Then:
  - The user accepts the list or does not know → `set --defaults`.
  - The user gives a list → `set --file <json>`.
- Fit a saved list to the project whenever the user or the project docs say so:
  - `remove <id>` → a platform or device the project does not ship (no desktop for an app-only project).
  - `upsert --json '{"id":…,"label":…,"platform":…,"width":…,"height":…}'` → change a size, or add a project screen (a kiosk, an embedded device) from its documented resolution.

Never guess a device size the user did not give or the project does not document.

A profile is a logical screen size, not a device model; its label only names it. Drive each profile at that size:

- Web → the browser viewport, `set viewport <width> <height>`.
- Native app → one platform is enough for layout unless native or platform-branching code changed (the same rule as for behavior). Size that platform's device to each profile:
  - Android emulator → any size: `adb shell wm density 480` and `adb shell wm size <width×3>x<height×3>` give exactly width × height dp; `wm size reset` and `wm density reset` when done.
  - iOS simulator → an installed device type whose logical size equals the profile (`xcrun simctl list devicetypes`). A size no installed type has goes on the Android emulator.
- Record the device and the size in `driven-at`. A model name that is not installed is not an obstacle; the size is what you prove.

On each profile, the scenario's before/after screenshots must show that a person can read and use the changed screen: nothing clipped or overlapping, no horizontal scroll, no truncated Korean text, touch targets reachable. Its `review-evidence` carries one `kind: "layout"` claim that names each of those checks and what the capture shows for it ([presentation.md](presentation.md#claim-review-record)); the CLI refuses a profile review without it. A broken layout on one profile is a `fail` for that profile's scenario.

#### The cheapest proof

Let the diff decide. Go outward only as far as the changed code reaches.

- **Server-only change** → the API as the client calls it (`curl`). A client whose code did not change needs no screen.
- **UI change** → that screen, in one browser or on one device. A second platform only for native or platform-branching code.
- **An automated test that runs the scenario's path and asserts its expected outcome is proof.** Run it this cycle, read its assertions, record it with `--evidence-surface test` and the test named in `driven-at`. Do not re-drive it by hand.
- **A test proves only what it runs.** When the change is a value an unchanged client receives (a link, a config entry, a payload), the client's existing test feeds its own hand-written input, so it proves nothing about the new value. Send the real changed value through the client: open the actual link on a device that has the app installed.
- **A device is the costliest tool.** Acquire one only when a claim needs a rendered screen; release it the moment those scenarios are recorded.

If the cheapest proof needs a local stack or seeded data, set it up.

Record the roster in state before authoring scenarios. First capture the acceptance criteria — the user-observable pass conditions you wrote from the source material — with `qa-state.ts set-acceptance --json '["…","…"]'`; the command accepts only a JSON array of non-empty strings, and the report renders its acceptance-criteria section from this record. Write each one as what the user sees ("보유분 행에 카테고리 이름이 보인다"), not the field that carries it: `set-acceptance`, a story `goal`, `--client-impact-reason` and a `declare-risk-na` reason refuse a camelCase or snake_case code name. The client-impact reason states the diff fact for that client: what changed that it reads, and whether its own code changed ("디스펜서의 STG 연결 주소만 바뀌고 앱의 링크 처리 코드는 그대로다"). How you verify it belongs in `driven-at`. Then add each actor with `qa-state.ts add-actor --id … --name … --boundary … --driver agent-device|agent-browser|curl|bash --client-impact none|contract|render --client-impact-reason "…" [--profiles '["phone-small","tablet-portrait"]'] --reachable unknown`, and update `--reachable` after the PLAN.1 probe. The CLI refuses `render` without a screen driver or with a profile the manifest does not hold. Add at least one story per actor with `add-story`; the roster and stories are the referential base for every scenario.

**A step only a person can do is not an obstacle.** A pairing code shown on a physical dispenser, an OTP sent to a real phone, a consent tap on a production account: ask the user for it in plain text, run `await-user`, and end the turn. Never leave `reachable` at "waiting for input" and close the cycle, and never record the scenario `blocked` for it.

**A limit you set yourself is not an obstacle either.** When a runbook makes you ask before you build, install or run, put into that one request every action the H scenarios need, and name the data each one writes: "open the pairing screen on STG, which issues one pairing nonce". Before you send it, name for each H scenario the action in the request that lets you see its `expected` outcome at the client (the screen, the app the link opens). A scenario with no such action is missing from the request. A scenario blocked by a scope you proposed is a question you did not ask. Ask it with `await-user`. The approval covers the actions and the data they write. A serial, port or file path that `acquire-device` or a tool picks is not part of it, so a different one needs no new approval.

After each story exists, record the feature-map lookup as planning context (not execution-verified fact), before BASELINE begins:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-story-provenance \
  --story ID --json '{"features":[{"id":"stock.view","revision":"<getrevision>","entrypoints":["push"],"states":["new-user"]}],"code_ref":"<commit/build id plus dirty diff evidence>"}'
```

The `revision` must match the live feature-map file. Feature labels are not metadata membership. Legacy, missing, or unverified maps do not permit fabricated IDs: retain code/spec discovery and evidence and report the story as not recorded. After each FIX cycle, recheck the live map and rerecord planning provenance.

#### Story Planning Context (PLAN output)

Add one separate row per story beside the roster/scenario planning output. This is planning context, not a new scenario field or execution evidence:

| story id | map lookup status | feature id@revision or not recorded(reason) | planned entrypoints/states | code_ref |
|---|---|---|---|---|
| `<story-id>` | `pending` / `notfound` / `error` / `ok` | `<id>@<live-revision>` or `not recorded(<reason>)` | `<entrypoints>` / `<states>` | `<commit/build id + dirty diff evidence>` |

A PLAN-only lookup that has not reached an actual `get` remains `pending`; never invent an ID or revision. Planned labels are allowed as hypotheses, but do not turn them into membership. After the story is created and the actual `get` result is available, use the existing `record-story-provenance` command to record the row. Keep this context table separate from the scenario table.

**Focus on the change.** A platform whose code did not change is not under test. A precondition owned by another platform is set through its API, a seed script, or the database — not by launching its UI.

**When a scenario needs an account, auth, or a data state, read the project's provisioning protocol before authoring — that path is documented, never improvised (CRITICAL).** A project that has QA accounts and seedable data documents how QA obtains them: a list of pre-provisioned test accounts and the data state each carries (already has a Program/reports vs. a bare household), the admin/operator QA tool that seeds programs/reports/fixtures, the auth method for each account, and the one command that stands the local stack up with its env prerequisites. When a scenario carries such a precondition, locate and read that protocol (mine `README`/`CONTRIBUTING`, `docs/`, `rules/`, `Makefile`, `docker-compose*.yml`, `scripts/` per [stage1-commands.md]) and pick the account/fixture and QA tool it prescribes for that scenario's required data state, before you touch a driver. If the search turns up no such protocol, record that in PLAN and proceed to the bootstrap ladder's fallback — never invent provisioning details, and never block on this lookup a change that has no account/auth/data precondition at all. Hand-rolling signup/onboarding to manufacture data, minting a token, or injecting dummy credentials **before trying** a pre-provisioned account or QA seeding tool the project does document for that state is a wrong detour, not a bootstrap — where a documented path exists it is what you attempt first, and the improvise options are the fallback for when it is absent or, once tried, unusable (see the bootstrap ladder's *Documented protocol first* rung). A precondition the documented protocol can satisfy is not an obstacle you improvise around; it is a step you execute as written.

#### PLAN.2 — User scenarios, per story

Parse the source material and your acceptance criteria into concrete verification targets: what BASELINE must run green, which user scenarios each actor walks at its verification surface, which of them existing automated tests already prove, and what CHECK will judge against. MUST-DO tables and Completeness sub-checks are `code-review`'s static-audit territory, not PLAN's.

See [scenario-authoring.md] for the derivation framework.

Create each story with the structured contract required by [reusable-cases.md](reusable-cases.md): a nonblank goal written from the source material, Given/When/Then arrays, and acceptance-criteria links to the session AC records. The CLI flags are `--goal`, `--given`, `--when`, `--then`, and `--acceptance-criteria` (the array values are JSON). If the optional case store is configured, list/get matching known cases first and use them as planning input while authoring the complete current-cycle story/scenario chain, including new, failed, stale, or uncovered paths. Do not execute replay during PLAN; a known case never replaces a story or scenario.

Under each story, author its user scenarios with `qa-state.ts author-scenario --story … --id … --title "…" --preconditions "…" --steps '["…"]' --expected "…" --why-needed "…" --priority H|M|L [--risks '[1,4]'] [--profile <id>]`. A scenario is one thing the actor does and sees — "결제자가 마감 5분 전에 재구매를 결제한다", not "injection probe". Each story needs at least one `H` scenario. For a `render` actor, each story needs at least one scenario per profile carrying `--profile`, driven on the screen at that size. A scenario you prove with an automated test (`--evidence-surface test`) carries no `--profile`: a test renders at no screen size, so the CLI refuses it on a profile scenario. Do not attach screenshots that do not show the scenario's outcome.

The six adversarial risks — 1 failure path, 2 boundary/malformed input, 3 injection, 4 interruption/concurrency, 5 misleading success, 6 idempotency — are tags on user scenarios, not scenarios of their own. Tag a scenario with each risk it exercises (`--risks`). Across the whole change, every risk must be exercised by some scenario or declared not applicable once, with what is absent on the changed surface: `qa-state.ts declare-risk-na --axis 3 --reason "변경 경로에 사용자 문자열이 닿지 않음 — UUID와 enum만 받음"`. The CLI refuses a scenario tagged with a risk declared not applicable, and refuses re-authoring a scenario that already has a result. `advance-phase BASELINE` (or `set --phase BASELINE`) and every later phase are refused until `chainComplete` is true. Once it holds at hands-on execution, replay matching known cases before exploratory driving of the remaining paths.

### BASELINE

Build/test/lint green baseline.

1. Discover project commands: check `~/.omt/{project}/project-commands.md` cache first, then `CLAUDE.md`/`README.md`/build files, then ask the user. Save discovered commands back to the cache.
2. Run: Build (fast build/typecheck) → Tests → Lint. Slow native build (e.g. an RN bundle) runs only when native code changed or this is a release build (native-code-or-release) — otherwise skip it.
3. Save the full output of each check as an evidence file (see Evidence Saving Protocol below).
4. ANY failure = immediate REQUEST_CHANGES.

**See** [stage1-commands.md] for command-discovery detail, special cases (no tests for changed code, no build system), and output format — the content there is BASELINE's detail target, not a separate stage.

### ADVERSARIAL E2E

Drive the changed surface for real and attack it. Two parts, both required when the change touches a risk surface — user-facing OR an internal risk surface (feature-flag-gated logic, payment/notification resolver internals, permission/state transitions), per [stage3-handson.md] `### Decision Logic`; only a genuinely inert refactor that touches no risk surface skips:

1. **Execute caller-provided scenarios verbatim**, with per-scenario evidence. ANY provided-scenario failure = immediate REQUEST_CHANGES. Caller-provided scenarios always run verbatim, unchanged — the derivation framework below governs only scenarios qa self-authors; it never rewrites what the caller handed in.
2. **Self-author the user scenarios** for the changed surface, in this order — breadth before depth:
   1. **Derive candidate scenarios by breadth** via [scenario-authoring.md]: Layer A impact-map → coverage-gap → H/M/L priority, then Layer D product use-case breadth (arrival paths · adjacent state transitions · lifecycle stances) from a product-context map built from the repo.
   2. **Give the scenarios their hostile depth, highest priority (H) first.** Each of the 6 risks — failure paths, boundary/malformed input, injection, interruption-resume + dirty state, misleading success, idempotency — enters as a user scenario that walks into it (a careless user double-taps, an attacker pastes a payload, the network drops mid-checkout) and is tagged with that risk. See [stage3-handson.md] `## Adversarial Scenario Matrix` for each risk's hostile condition and the lifecycle detail (start → verify → stop). Rows 7–9 (stale-state, dirty-worktree, flaky-rerun) are per-run checks recorded separately with `record-run-check`.

When a caller-provided scenario fails, record its failing scenario and declare REQUEST_CHANGES; the scenarios left unrun stay unrecorded, and the report shows them as not run. The same holds after an EXIT that follows a FIX dispatch (max-cycles or Safety) with a recorded failure. `inc-cycle` invalidates prior-cycle records, including baseline and run-check records in the current view. Prior-cycle records remain in the raw state/history for audit.

For a genuinely inert refactor with no risk surface, author the roster and stories, run `declare-inert --reason "<why no behavior reaches any surface>"` with zero scenarios, and record the story baseline and all three run checks.

**Inline modality drivers, no tmux.** qa itself drives the modality-appropriate tool inline — it is not delegated to a separate driver subagent:

| Change Type | Driver |
|-------------|--------|
| API endpoint | `curl` |
| Frontend / UI | `agent-browser` (fallback: `playwright`, if available) |
| Mobile / native UI | `agent-device` |
| CLI / TUI | interactive `bash` |

For mobile/native UI work, load the `agent-device` skill first and derive the current concrete commands from its runtime `agent-device help <topic>` guidance. Do not copy or invent concrete driving command syntax in this skill.

**Drive at the verification surface**, or cite a qualifying test. A harness you wrote to call the changed function is a unit check, not a scenario.

A **caller-provided** scenario runs verbatim at whatever layer it enters; record that layer as its `driven-at`, and it proves nothing above it.

**Bootstrap only what the surface needs.** A missing precondition is work, not an obstacle. Verify an undeployed change on an isolated local instance you own, supplying any missing env config yourself. Take accounts and data from the project's documented QA provisioning first (see [stage1-commands.md] Discovery Order); only when none exists, seed rows, sign up, or mint a token. Install a missing tool outside the worktree. When the QA REQUEST verifies the deployment itself, the deployed environment is the surface and its failure is the FAIL.

**Boundary substitution.** Fake only a hop you cannot reach — absent hardware, an off-network third party — and record it in `driven-at`. For absent hardware, first look for the simulator the repo ships for it (a virtual mainboard, a mock device server, a `scripts/emulator/` directory and its README) and run its setup on your acquired device; that is the project's own substitute. A step a person can do for you (a pairing code, an OTP) is not such a hop: ask for it with `await-user`. If even substitution is impossible, record the scenario `blocked` — never PASS — with the structural limit and the attempts that hit it:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts record-scenario --story … --scenario … --status blocked \
  --obstacle "<the structural limit>" \
  --attempts '["<command or step> → <observed result>", "…"]' \
  --deepest-reachable "<the deepest point toward the surface that you did reach>" \
  --attempt-log <file holding the attempts' actual output>
```

`blocked` means you tried to reach the surface and a limit outside the change stopped you. An obstacle declared without the attempts behind it is evasion, not a coverage delta: the CLI refuses `blocked` without attempts and an attempt log. Its requirement is **unverified**, and the report names it above the overview. A scenario you did not attempt has no status: it stays unrecorded, and every verdict stays refused until you execute it or record it `blocked`.

**Honesty.** Claim what the evidence proves, nothing more. An API response proves what the client receives. A test proves what it asserts. A launch screen proves the app started. Evidence from two depths never merges into a deeper claim.

#### Red Flags

| Thought | Reality |
|---------|---------|
| "Only the server changed, but users see it on the app — boot a simulator" | `curl` the API. The app is not under test. |
| "It's React Native — check iOS and Android" | One platform, unless native or platform-branching code changed. Device profiles still cover every size the app ships to: size that one platform's device to each. |
| "The iPhone Duo / newest model isn't installed, so that profile is blocked" | A profile is a size. Use an installed device of that size, or size the Android emulator to it. |
| "The secure field won't take input / a dev error overlay covers the button, so login is blocked" | That is a driver obstacle, not a limit outside the change. Try the driver's other input path, dismiss the overlay, the other platform, and the login or deep link the project documents. `blocked` lists those attempts. |
| "A test already asserts this, but I'll drive it by hand too" | Cite the test. Spend the effort on what it doesn't cover. |
| "The flag lives in the admin web — launch it" | Set it through the API, a seed, or the DB. |
| "Keep the device up until CLEANUP" | Release it now. |
| "The suite is green, so the ACs are met" | Name the test that asserts each AC. |
| "The app launches, so the change works" | Show the screen where the change is. |
| "No seed data or account, so NOT-RUN" | Create it. |
| "The tests prove the ACs; the rest can stay unverified" | An unexecuted scenario has no status. Execute it, or record it `blocked` with the attempts that hit a limit. |
| "PGlite / the mock can't do this, so it is blocked" | Try the real dependency the repo documents (a local compose stack, a seeded DB) first. `blocked` lists those attempts. |
| "The app's screen does not change, so its boundary is the service test" | The app still reads the changed data: `client_impact contract`, proven at the request the app sends. The boundary never moves inward. |
| "Pairing needs a code from the device, so skip that actor" | Ask the user for the code (`await-user`). A human step is work you request, not an obstacle. |
| "A Fold is about 345 dp wide, I'll use that" | Read the project's device profiles. If none exist, ask the user and save them. Never guess a size. |
| "The component test proves the fallback; I'll attach a nearby screenshot for the profile" | A screenshot that does not show the outcome is not evidence. Prove that scenario with the test and no profile, or make the state happen on screen and capture it. |
| "agent-device says the device is in use / ambiguous, so the scenario is blocked" | Drive the device `acquire-device` gave you with the flags it printed. A session you opened yourself is closed with `agent-device close --session <name>`. |
| "The card left the screen; I cannot tell whether the page or the list scrolled, but it is a fail" | Measure what tells the causes apart before you record: the page and list scroll offsets in the WebView, or whether a fixed header moved. A screen failure counts toward REQUEST_CHANGES only when every claim in its evidence review is `supported`; an `insufficient` claim means recapture. |
| "The release build has no signing key / the debug build cannot load its JS bundle, so the app is blocked" | That is local build config, so it is setup work. Sign the build with the repo's debug keystore through an untracked local properties file, or bundle the JS into the debug build. Name the change in `driven-at` and delete what you added at cleanup. |
| "The shared STG forces an app update that never finishes, so the device screen is blocked" | The update check compares the version your build reports. Build the change locally with a version at or above the required one (an untracked local override), or point the build at the local stack whose update policy you own. Do not change shared server settings. Name the override in `driven-at` and remove it at cleanup. |
| "The value is missing from the response I parsed, so the scenario fails" | First read the client code that consumes it. A value missing from a channel the client does not read (a store referrer, when the app takes deferred links from its SDK) proves nothing. Prove it on the channel the client uses. |
| "The scenario expected an automatic retry and none came, so it fails" | Write `expected` from what the PR, spec or runbook promises, before you drive. A `fail` breaks a promised behavior; a behavior nobody promised is a note in the observation. |
| "The emulator has no controller or hardware ID, so the device screen is blocked" | Search the repo for its own hardware simulator and run its setup steps on the acquired device. `blocked` names that search and where its setup failed. |
| "The documented seeder cannot make this data state, so the scenario is blocked" | The documented path came first; it is not the only path. Write the rows yourself on the stack you own (SQL, its API, a fixture script). `blocked` needs a limit that your own seeding cannot pass either. |
| "The approved scope says no server writes, so the QR scenario is blocked" | You wrote that scope. Ask for the one write the scenario needs (`await-user`). |
| "The approval named emulator-5556, and `acquire-device` would give me 5554, so the scenario is outside the approval" | The approval covers actions and the data they write. Take the device `acquire-device` gives you and record its serial in `driven-at`. |
| "I used up the 6 approved link requests, and curl saw only HTML, so the app scenarios are blocked" | You picked both the count and the tool. `curl` cannot show an app opening. Plan the scenario at its client: the app on the acquired device opens the link. Ask for that and the requests it needs (`await-user`). |
| "The layout looks fine on my one emulator" | A `render` actor is proven on every profile it runs on. One screen size proves one profile. |
| "This story needs an injection scenario, an idempotency scenario, …" | Write what a user does. Tag the risks it exercises; declare a risk not applicable once, for the whole change, when nothing on the changed surface can carry it. |

Command execution is **non-blocking only**: every command either returns control on its own or is explicitly backgrounded (`run_in_background`, or trailing `&` with output redirected — a bare `cmd &` without redirection leaves the harness waiting on inherited file descriptors and hangs the agent). A bare blocking command that hangs the shell is forbidden. See [stage3-handson.md] Step 3.2 for the lifecycle this backs (start in background → wait for readiness → verify → stop, never leaving a server running).

**By-design non-idempotency note:** running ADVERSARIAL E2E actually exercises the application (starts servers, sends requests, mutates state); some operations under test are intentionally non-idempotent per spec, which is not itself a defect.

### CHECK

Is the goal met — BASELINE green and the full ADVERSARIAL E2E pass (provided scenarios + matrix)? Judge each scenario on its own row, then ask the questions that a per-scenario PASS does not answer:

**Required evidence review, before verdict:** after recording each visual pass/fail
scenario, open its raw captures and action record and submit the claim review with
`qa-state.ts review-evidence --story … --scenario … --json-file <review.json>`.
Read [presentation.md](presentation.md#claim-review-record) for the required
fields and example. Cover every asserted outcome, not just screen identity.
The state keeps the execution result separate from evidence sufficiency: a
missing, insufficient, or stale review blocks APPROVE/COMMENT and completion;
the report shows **근거 미검증**, not a product failure or NOT-RUN. Re-capture
missing outcomes and review again. File existence alone does not close CHECK.

- Did each scenario reach the verification surface its actor row names, or stop at an inner layer? Read `driven-at`, not the PASS.
- Does each observation name its medium — screen capture, API/CLI response, or named test — and claim only what that medium proves?
- Does every client the change reaches have an actor, and does every `render` actor have a recorded scenario on each of its profiles?
- Is any scenario still unrecorded? Then no verdict exists yet, whatever the other rows say. Execute it, or record it `blocked` with its attempts.

A FAILED scenario row blocks CHECK, with exactly one carve-out: a failed **self-authored `M`/`L`** row whose finding scores **50–74** — the `nitpick (non-blocking)` band, which [feedback-protocol.md]'s scale defines as *real but minor, rarely happens in practice* — leaves the cycle a **soft pass**: the row stays FAIL in the roster, the finding is reported as a LOW note, and the verdict is COMMENT, never APPROVE.

Everything else blocks. A finding scoring **75+** blocks whatever the row's priority — the scale calls 75 *likely to occur in practice, directly impacts functionality*, which is a defect, not a nitpick. A failed **`H`-priority** row blocks whatever its score. A failed **caller-provided** row blocks — it never soft-passes, per `### ADVERSARIAL E2E` part 1. And a failed row whose finding cannot be scored at **50 or above** is not a soft pass but an unexplained failure: re-run or diagnose it, because a scenario that failed for reasons you cannot state is the one most likely to matter. Never restate a failed row as PASS to reach a clean sheet.

- **Pass → PASS.** Emit APPROVE (see Output Format).
- **Soft pass → PASS with COMMENT.**
- **Fail → enter the loop below.**

### DIAGNOSIS → FIX → RE-VERIFY (loop, ≤5 cycles)

CHECK failure hands off to a three-way-separated loop so the agent that fixes the defect is never the one that certifies the fix:

#### DIAGNOSIS

delegate to `oracle` (fresh, read-only, root cause + file:line). oracle never modifies files; it returns a diagnosis, not a patch.

#### FIX

delegate to `sisyphus-junior`. **sisyphus-junior commits its own scoped fix** — it authored the hunks, so it alone can stage them precisely; qa cannot separate a fix's hunks from a user's hunks in a shared file. Never `git commit -a`.

`cycle++` happens here — **cycle++ at FIX dispatch** is the counted unit (pre-fix detection is cycle 0, uncounted).

#### RE-VERIFY

qa re-runs **BASELINE + the FULL matrix** from scratch — not just the failed scenario. **Distrust the fixer's report**: sisyphus-junior's own claim of "fixed" is not evidence; only a fresh, from-scratch re-run counts. Running the full matrix (not only the scenario that failed) is what catches a fix that silently regresses a scenario that was previously green.

Loop back to CHECK. Continue until an EXIT condition below fires.

### EXIT

| Condition | Trigger | Action |
|-----------|---------|--------|
| **Goal Met** | CHECK passes (BASELINE + full matrix green) | PASS → APPROVE |
| **Goal Met, soft pass** | CHECK soft-passes (one carve-out row, per `### CHECK`) | PASS → COMMENT, carrying the failed row and its LOW note |
| **max_cycles=5** | `cycle` reaches `max_cycles` (5) still unresolved | Terminate, report unresolved with last diagnosis |
| **Safety** | A safety invariant refuses to proceed | Terminate, report the refusal reason |

- **max-N boundary**: with `cycle` starting at 0 and `cycle++ at FIX dispatch`, `max_cycles=5` permits exactly 5 fix attempts (cycles 1..5); the 5th fix is attempted and re-verified, then EXIT fires if still unresolved.

### CLEANUP

Every background resource this cycle starts is recorded, together with the command that stops it:

- **Simulator or emulator**: get it only through `acquire-device` (stage3-handson.md, Modality Setup), and only when a claim needs a rendered mobile screen. The command creates a device owned by this session and records it. Release it as soon as its scenarios are recorded. A device that is already booted may belong to another concurrent session or to the user. Do not reuse it unless the user names it, and never record or stop it.
- **Server or other process**: record it right after it starts. A tool that leaves its own daemon behind (`agent-react-devtools`, a Metro that a run script started) counts too: find that PID after the call and record it.
- **Container stack**: a local stack this cycle brings up (`docker compose up`, or a project script that runs it) is a resource as well. Run `docker ps` before and after; record each compose project that is new, with `--kind container-stack --stop 'docker compose -p <project> down'`. A stack that was already running belongs to the user or another session: use it, but never record or stop it.

```
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts record-resource --id <pid> --kind server --stop 'kill <pid> 2>/dev/null; for _ in $(seq 50); do kill -0 <pid> 2>/dev/null || exit 0; sleep 0.2; done; exit 1'
```

The stop command succeeds only once the process is gone: it signals, then waits up to 10 s for the PID to disappear, and it also succeeds when the server already exited. A bare `kill <pid>` only sends a signal, and it fails on a server that already crashed.

CLEANUP releases each recorded resource with `release-resource --id <id>`, which runs the stop command and records the release only when it exits 0. `complete` refuses while any resource is unreleased and names each one, whether the cycle ended in PASS or an EXIT condition. Remove temp files this cycle created as well. A leaked process corrupts the next run. **Never remove a path supplied through `--evidence-path`**, regardless of whether it came from a caller, a required-verification entry, or a self-authored scenario; completion re-probes every passing scenario and baseline evidence path.

### STATE

Persist `phase`/`cycle` (plus `max_cycles`) to a state file after every phase transition, via:

```
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>
```

A `continue` invocation reads this state and resumes at the last recorded phase/cycle rather than restarting the cycle from PRE-FLIGHT. (The CLI itself is authored elsewhere — this section only pins the invocation contract qa's cycle relies on.)

The chain-recording surface is: `set-acceptance`, `add-actor`, `add-story`, `author-scenario`, `declare-risk-na`, `record-baseline`, `record-scenario`, `review-evidence`, and `record-run-check`. Use `set-verdict APPROVE|COMMENT|REQUEST_CHANGES` to persist the verdict; the CLI accepts only the verdict the recorded outcomes support (see *Approval Decision*). A scenario that cannot be verified for a reason outside the change (a harness limit, an unreachable dependency) is recorded `blocked` with its attempts; the report shows a banner above the overview, and your final message names each blocked scenario. `author-cell`, `record-cell`, `waive`, and the `na`/`not_applicable` statuses are retired. Never reach the same result another way — editing the state file, or recording a fake pass. When the cycle needs a decision only the user can make — a question about the requirement itself — ask it in plain text, then run `await-user` and end the turn. Your last message carries the whole question: what you need decided, each option with what it lets you verify, and what it writes. A question tool's options may never reach the reader, so never point at them. That parks the Stop gate WITHOUT spinning the no-progress counter (the pause is not a failure), and the next progress write auto-clears it when you resume on the user's reply. For a no-risk-surface cycle, use `declare-inert --reason "…"`. When the gates will not let a cycle close and only the user can decide to stop, show them `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts force-complete --reason "<why>"` with your reason, run `await-user`, and end the turn — `force-complete` is user-only, and it still releases the recorded devices and servers, naming any it could not stop. Run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts help` to see the full command roster and which are user-only. Runtime gates consume the persisted chain/record predicates: the phase funnel blocks BASELINE until the roster→story→scenario chain is complete, the driver guards block `agent-device`/`agent-browser`/`curl`/`bash` while the roster is incomplete or once BASELINE has been reached with an incomplete chain (PLAN reachability probes remain available), and the Stop gate validates the raw state on both Claude and Codex. Direct writes to `qa-state-*.json` are denied; use the CLI.

#### STATE/post-run feature-map maintenance

After the run, update a map only from observations verified in this cycle. An actual failure, regression, or evidence may be retained as such; keep expected contract and actual observation separate and never normalize a failure into expected or pass. If the observation is reusable, curate it through the optional case functions only after resetting and independently rerunning the saved recipe with assertions. Preserve the case's native runner format and surface; trace/recording/JUnit artifacts are not executable or boundary proof. Use the feature-map guide's `get`/`save --expect <live-revision>` conflict protocol for feature maps, and the reusable-case guide's revision conflict protocol for cases. Re-read before reconciling a conflict, never blind-overwrite, and never auto-configure storage. If case storage is unconfigured or disabled, keep the case as a current-run draft/report only and continue ordinary QA; keep the draft rather than silently writing project files. The rule is: re-`get` before reconciling a conflict.

Once the cycle concludes (any EXIT outcome — Goal Met, max_cycles, or Safety), first run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts set-verdict <APPROVE|COMMENT|REQUEST_CHANGES>`, then run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> [--narrative <json-file>]`, open the rendered HTML and verify all claim images remain legible, run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts review-report --path <html>`, dispatch the `presentation-reviewer`, handle its verdict, then run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts complete`, and only then report the verdict prose. The renderer records the HTML/state identity; `review-report` records the visual inspection attestation. Editing the HTML or recorded facts requires re-render and re-review. `complete` is gated by the same predicates as Stop and refuses an unrecorded or falsely approved cycle; it marks an earned terminal state inactive so the finished cycle is not resurrected as "in progress" in a later session.

**Presentation review (required, after `review-report`, before `complete`).** Dispatch the `presentation-reviewer` agent to contrast the report's reader-facing presentation layer against the actual evidence and the material this cycle verified against. It is skill-agnostic, so assemble the bundle:
- **presentation**: the rendered report HTML (its top presentation layer) and the `--narrative` JSON you authored.
- **sources**: the recorded evidence (screenshots, observations, run checks from qa-state) and the referenced plan/spec/ticket/docs the acceptance criteria came from.
- **reader_persona**: "a context-free PO/designer who does not read code — judges from the report alone whether the change met its requirements, in product/user terms".

Its verdict is `APPROVE` / `REQUEST_CHANGES` / `COMMENT` / `INCONCLUSIVE`. Only `APPROVE` or `COMMENT` may proceed to `complete`; on `REQUEST_CHANGES`, fix the narrative/report, re-render, re-`review-report`, and re-review before `complete`. `INCONCLUSIVE` or a missing/malformed verdict blocks handoff and completion and requires fixing the presentation or re-supplying the review inputs. This is a required review step, not an added CLI gate; run it every time. It never overrides a recorded pass/fail fact — those come from qa-state, and a fidelity finding against them means the narrative misread the record, not that the record changes.

---

## Fix-Loop Nesting Contract

qa's fix-loop (DIAGNOSIS → FIX → RE-VERIFY) **must NOT be called inside another fix-loop** — nesting it in a caller-owned pursuit loop double-loops retries and confuses which loop owns EXIT. This is a documented contract, not an enforced one: **YAGNI** — no detection-guard code is written for a caller that does not exist yet. Named upgrade trigger: **add a code guard when qa gains its first fix-loop-owning caller.**

---

## Evidence Saving Protocol

### Core Rule

Every verification **command execution** (BASELINE, ADVERSARIAL E2E, RE-VERIFY) produces an evidence file. Evidence files are the audit trail; downstream gates check for their existence before accepting a verdict.

### Objective vs. Subjective

| Output Type | Disposition | Examples |
|-------------|-------------|---------|
| Objective command output | Save to file | build/test/lint logs, curl response body + status, agent-browser/Playwright/agent-device screenshots and reports, CLI execution logs |
| Subjective judgment | Response only (no file) | PLAN's spec/AC reading, oracle's diagnosis narrative |

### Actor-Perspective Evidence (per executed scenario)

**Required visual evidence contract — read [presentation.md](presentation.md) before recording and reporting.** For every pass or fail recorded with an `agent-browser`/`agent-device` evidence surface, and for every scenario that carries a device profile, `record-scenario` requires separate `--evidence-before` and `--evidence-after` screenshot files plus `--evidence-action`. The completion predicate rechecks these slots. Capture the actual actor's screen, at that scenario's profile size, immediately before the action and at the asserted outcome, in this scenario and cycle. The report additionally requires `scenarios["<story>:<scenario>"].observed` explaining the action, visible result, and expected result, **alongside both embedded images**. An observation is not a replacement for an image at a visual boundary.

| Surface actually exercised | Required proof |
|---|---|
| Browser or device UI | Real before screenshot → recorded actor action → real after screenshot; both images visible on the scenario card, plus observed explanation |
| API caller or text CLI | Actual request/command and received response/output, with a reader-facing observed explanation; screenshots of logs do not strengthen this proof |
| Automated test (`--evidence-surface test`) | The saved output of this cycle's test run, `driven-at` naming the test file and case, and an observed explanation of what the test asserts in the scenario's terms |
| Visual TUI or physical device state outside a screenshot-capable driver | Capture the actual display/state with the appropriate available capture mechanism; disclose an evidence gap if it cannot be captured |

For each additional visible state asserted by a scenario (error notice, permission denial, loading state, recovered state), capture that state too. A landing-page image, a screenshot from another actor/run, a generated/mock image, or a diagram cannot prove the asserted outcome. Preserve the original capture; any resized copy must retain the asserted UI and legible result. Before/after files may show identical content when no visible change is expected, but must be separately captured files.

**Final-report gate:** the `qa-report.ts` CLI refuses visual scenarios with missing/unreadable/non-embeddable before/after images or missing observed prose. It also refuses an image that would fall back to a path because of the per-file or cumulative embed budget. Resize/re-encode captures without changing the evidence, update the recorded paths, and render again. Open the resulting HTML and inspect every visual scenario card at readable size before `complete`. If capture or embedding remains unavailable, report the exact evidence gap and leave verification unfinished; do not claim a product failure or PASS merely to close the record.

An evidence set proves what its actor could observe at its verification surface. Every scenario executed by a driver gets its own set, named for that scenario id from the roster so the two map 1:1, holding three slots in this order:

| Slot | What it holds |
|------|---------------|
| `before` | The actor-observable state the scenario starts from — the screen the actor is on, the value the endpoint currently returns, the record as it stands. |
| `action` | The action as the actor issues it at its boundary — the tap/click sequence, the exact request, the command typed — with the immediate response. |
| `after` | The outcome the actor observes — the resulting screen, the response body, the delivered payload or written record — asserted against the scenario's `expected`. |

At a UI boundary, `before` and `after` are captures of the asserted state: the screen where the change is visible. **A screenshot of a launch, splash, or landing screen is not scenario evidence** — it proves the app started.

Internal signals (server logs, DB rows, emitted command payloads, instrumentation) are supporting evidence attached beside these three, never a replacement for them. A whole-suite build/test/lint log is BASELINE evidence; a scenario proven by a test cites that test's own run output instead of the three slots.

### Evidence File Content Requirements

Evidence files must contain meaningful content that demonstrates the verification result. Empty (0-byte) files are not valid evidence. When a command produces empty stdout, record the command executed and its exit code so the file is not empty.

### Evidence Path Priority (3-Tier)

1. **Explicit path from QA REQUEST** — caller explicitly provided a path
2. **Plan QA Scenario Evidence field** — use `$OMT_DIR/evidence/{plan-name}/{task-slug}/{scenario-slug}.{ext}`.
3. **Auto-generated path (fallback):**
   ```
   $OMT_DIR/evidence/{work-slug}/{task-slug}/{check-slug}.{ext}
   ```
   Ensure the target directory exists before saving (`mkdir -p`).

### Evidence Reporting in Response

After the cycle completes, include a `## Evidence Files` section listing every evidence file saved, with `$OMT_DIR` expanded to its absolute path:

```
## Evidence Files
- /Users/dev/.omt/my-project/evidence/add-user-endpoint/implement-user-service/build.txt
- /Users/dev/.omt/my-project/evidence/add-user-endpoint/implement-user-service/npm-test.txt
```

Omit this section when no commands were executed (a PRE-FLIGHT fail-fast, judgment-only).

---

### HTML Report

At STATE, immediately after `set-verdict` and before `complete`, qa renders a self-contained HTML report via `bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> [--narrative <json-file>]`. The renderer reads the recorded chain through the `qa-state get` / `readQaView` path and renders **from qa-state records, not re-narrated** — every AC, actor, story, scenario, evidence path, and PASS/FAIL/verdict fact in the report is exactly what qa-state recorded, so the report cannot drift from what actually ran. Execution-account narrative — issue descriptions, expected-vs-actual prose, oracle diagnosis — is supplied at render time through `--narrative`, never persisted to qa-state. Evidence-review judgments are different: they are required persisted claim records, not optional narrative.

**Presentation layer (reader-facing, at the top of the report).** Above the verification log, the report leads with a product/user-centric narrative a context-free PO/designer reads first to judge whether the change met its requirements — without opening code or the audit log below it. It is **not** a code-diff summary and **not** "backend changed → tests passed". It opens with a one-line verdict summary (the verdict and the scenario counts behind it), then reads top-down as *what was asked, then what we saw*: ① a feature overview; ② a **요구사항(AC) 충족 현황** board — each recorded acceptance criterion with its satisfied / not-satisfied / partial / unverified verdict and the scenario + evidence that proves it (the PO's at-a-glance answer; AC text and its verdict are one merged section, not two); ③ a big-picture diagram of the user flow; ④ an **액터 · 영향받는 유저** section — one block per actor (the roster and the affected-users narrative are the same actors, merged), naming who is affected (admin / product user / conditional user / partner / attacker …), how each uses the product (software + hardware), how far the change reaches their client (client impact + reason, and the device profiles for a screen change), and whether their boundary was reachable; ⑤ a **유저 시나리오 · 근거** section presenting, per story, the story goal, a per-profile coverage line for screen stories, and then ONE card per user scenario — title, expected result, the risks it exercises, its profile, and its own real-software record (an authored observation plus before/after screenshots for screen scenarios; an observation grounded in the response or the cited test otherwise), with final visual report generation blocked when a required image or observation is missing. The risks declared not applicable sit folded under one "펼쳐 보기" toggle with their reasons, never as cards. Below the reader layer sits the record-faithful audit (시나리오 상세 기록, which carries each scenario's technical boundary + driver — there is no separate actor-roster table — plus failures, verdict, evidence files). Author this presentation before rendering and supply it through `--narrative` as a `presentation` object; **[presentation.md]** owns the full authoring contract, the JSON shape, the anchoring rule, and the self-audit. Every part is anchored to a recorded fact — `affectedUsers` by actor id, `scenarioFlows` by story id, `requirementMapping` by AC index — so the layer cannot drift or invent: prose for an actor absent from the roster is ignored (an affected user missing from the roster is a roster gap to fix with `add-actor`, not to invent in prose). Any required slot left unwritten renders a **visible `gap` marker** in the report, so a skipped part shows rather than silently vanishing.

For `requirementMapping`, each entry must have a non-empty `scenarioRefs` array of `{story, scenario}` selectors. The renderer validates every ref against exactly one recorded current-cycle scenario and its recorded status (`pass`, `fail`, or `blocked`): `yes` requires every referenced scenario to be `pass`; `no` requires every referenced scenario to be `fail`; `partial` requires at least one `pass` and one `fail` and no `blocked`; `unverified` requires at least one valid `blocked`. Missing/legacy/malformed/duplicate/stale/unknown/ineligible mappings fail closed to a visible neutral gap (`미판정`) rather than a green verdict. Prose evidence explains a verdict but cannot establish it.

The reader-facing **유저 시나리오 · 근거** section is story-level and clean: per story it shows the actor's name, the story goal, and one card per scenario with that scenario's evidence (each scenario's `before` / `action` / `after` and recorded `evidence.path`). It shows risks by plain name, never by number. It deliberately omits implementation-flavored fields (`driven_at`, `why_needed`, the actor's `boundary` code path), which the QA engineer writes technically for the audit trail; those live in the record-faithful **시나리오 상세 기록 (감사)** section below — one row per scenario with its risks, `driven_at`, result, and recorded evidence paths — so a context-free reader never meets implementation leakage while full traceability is preserved. A verified (pass/fail) scenario without evidence renders a loud `gap` (a pass cannot even be recorded without evidence; `blocked` carries its attempt log instead). Unreadable or unembeddable visual evidence blocks final report generation; resize/re-encode the capture and update the recorded path. A fresh `start` clears `acceptance_criteria`, so a new report cannot inherit the previous cycle's criteria.

The report is produced on **every cycle that reached a roster** (PLAN.1 ran) — this includes the inert-refactor zero-row case. The sole exception is the **PRE-FLIGHT fail-fast**, which never reaches PLAN and therefore renders no report.

The report file is self-contained: inline `<style>`, zero runtime `<script>`, no external CSS/JS/font/image reference — it opens offline. Evidence embeds are capped at 2 MiB per file and 16 MiB cumulatively; visual images that exceed either budget block final report generation; reduce image size and update recorded paths. Non-image audit files may retain a path-only fallback. Save it under the evidence directory, e.g. `$OMT_DIR/evidence/{work-slug}/{task-slug}/report.html`.

---

<Output_Format>

## Output Format

```markdown
## Cycle Summary

| Phase | Status | Details |
|-------|--------|---------|
| PRE-FLIGHT | PASS / REQUEST_CHANGES | [MUST-NOT-DO / B⊆A result] |
| BASELINE | PASS / FAIL | [build/test/lint summary] |
| ADVERSARIAL E2E | PASS / FAIL | [matrix + scenario summary] |
| Cycles run | N / max_cycles | [reason if terminated early] |

## Actor Roster

| actor | boundary | driver | client impact (reason) | profiles | reachable |
|---|---|---|---|---|---|

One row per actor the changed surface serves, from PLAN.1. `boundary` names the verification surface. `reachable` is `yes` or the obstacle plus the deepest reachable point toward that boundary. On a PRE-FLIGHT fail-fast the cycle never reaches PLAN, so this section is absent rather than empty — same as the scenario roster below.

## Story Planning Context

| story id | map lookup status | feature id@revision or not recorded(reason) | planned entrypoints/states | code_ref |
|---|---|---|---|---|
| [PLAN table row] | pending / notfound / error / ok | id@revision or not recorded(reason) | planned entrypoints/states | commit/build + dirty diff evidence |

This PLAN-only context row is separate from the scenario shape. `pending` means lookup has not reached `get`; it carries no invented ID/revision, although planned labels may be listed. After story creation plus actual `get`, record successful feature refs with `record-story-provenance`; after a FIX cycle, recheck and rerecord them. State and HTML persist only successful feature refs, `code_ref`, cycle, and feature absence; pending/notfound/error reasons remain in the final Markdown Story Planning Context rather than being promised as state or HTML fields.

## Scenarios Executed

| # | source | actor | scenario | profile | risks | driven-at | preconditions | steps | expected | result | evidence | why-needed | priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Every row's `source` is either `self-authored` or `caller-provided`. A `self-authored` row carries the scenario shape from [scenario-authoring.md] — actor · title · preconditions · steps · expected · why-needed · priority · risks · profile — filled in full; a `caller-provided` row carries whatever shape the caller supplied. `driven-at` names the surface actually entered (or the test cited) plus any substitution; `result` is PASS / FAIL / BLOCKED / NOT-RUN (unrecorded); `evidence` is the path to that scenario's evidence set. This table is the canonical scenario record for the cycle: `result` maps to `Status` and `why-needed` maps to `Why-Needed` in the four-column working table [stage3-handson.md] mandates for hands-on execution — the column-count divergence is declared here, not fixed there.

Close the table with exactly one coverage-delta line naming the impact-map domains from [scenario-authoring.md] and the three Layer D use-case axes (arrival paths · adjacent state transitions · lifecycle stances), stating which of those the rows above cover and which are left uncovered. Then list each risk declared not applicable with its reason.

## Verdict: [APPROVE / REQUEST_CHANGES / COMMENT]

**Report:** [absolute path to the self-contained HTML report file — leads with the reader-facing presentation layer ([presentation.md]) above the verification log; or "not generated (PRE-FLIGHT fail-fast)" when the cycle never reached a roster]

## Not Verified
[One line per `blocked` scenario: story/scenario — obstacle — attempts made — deepest point reached. Write "none" when there are none.]

## Issues (if any)
[For each issue:]
- **[CRITICAL/LOW]**: [Brief description]
  - Location: [file:line]
  - What: [problem]

## Evidence Files
- [absolute path to each evidence file saved during this cycle]

(Omit Evidence Files when no commands were executed — a PRE-FLIGHT fail-fast)
```

</Output_Format>

---

## Approval Decision

1. **Issuance precondition.** A `## Scenarios Executed` section is a precondition for issuing a verdict. When it is absent, the `## Verdict` heading is omitted rather than a verdict being issued — this reads as an unfinished cycle, never as a fourth value alongside the `{APPROVE, REQUEST_CHANGES, COMMENT}` domain below. The single exception to this absence rule is the PRE-FLIGHT fail-fast, which legitimately issues **REQUEST_CHANGES** with no cycle run and therefore no `## Scenarios Executed` section. A section that is *present* with zero rows is a separate case, not an omission: when ADVERSARIAL E2E was skipped because the change is a genuinely inert refactor touching no risk surface (`### ADVERSARIAL E2E` above), the cycle is complete, its coverage-delta line states the change touched no risk surface, and a verdict **is** issued per the table below.

2. **Verdicts follow recorded outcomes.** Each scenario ends in exactly one of three states, or is still open work, and the verdict reads them. Priority orders execution; it never lets an unexecuted scenario through.

| Scenario state | Meaning | How it is recorded |
|---|---|---|
| `pass` / `fail` | Executed at the surface (or by a cited test) | `record-scenario --status pass\|fail` with evidence |
| `blocked` | Attempted; a structural limit outside the change stopped it | `record-scenario --status blocked` with obstacle, attempts, deepest reachable point, attempt log |
| unrecorded | Not executed yet | nothing — this is open work |

A risk that nothing on the changed surface can carry is not a scenario state: it is declared once per cycle with `declare-risk-na` and its reason.

| Condition | Verdict |
|-----------|---------|
| PRE-FLIGHT contract violation | **REQUEST_CHANGES** (MUST-NOT-DO / B⊆A violated, cycle not executed) |
| A recorded product failure: a failed scenario, baseline, stale-state, or flaky-rerun check (unresolved after the loop, or a stop-driving failure) | **REQUEST_CHANGES** — name the failure and its evidence |
| CHECK soft-passes: every scenario recorded; the only failures are self-authored `M`/`L` rows in the 50–74 nitpick band | **COMMENT** (never APPROVE — the failed row stays FAIL in the roster) |
| Every scenario `pass`, or `blocked` at M/L priority; baseline and run checks green | **APPROVE** (or **COMMENT** to surface LOW notes). Each `blocked` scenario is named in the report banner and in your final message |
| An H scenario `blocked`, no failure | **COMMENT**: its requirement is unproven, so the CLI refuses APPROVE |
| Any scenario unrecorded and no recorded failure | **No verdict.** Execute the remaining scenarios, cheapest proof first. A request to hurry or wrap up means execute faster, not stop. Only when the user explicitly says to stop verifying or to defer the rest: say which scenarios remain and why, show `force-complete`, run `await-user`, and end the turn |

REQUEST_CHANGES is a request to change the product. Work you did not do is not a product defect: the CLI refuses REQUEST_CHANGES without a recorded failure, and refuses APPROVE and COMMENT while a scenario is unrecorded. The verdict never describes the cycle as end-to-end unless the roster's `driven-at` values say it was.

Every issue surfaced MUST include a confidence score. See [feedback-protocol.md] for Confidence Scoring, Validation, and Conventional Comments.

**On COMMENT.** The product decision above is binary — APPROVE or REQUEST_CHANGES. COMMENT is an optional **soft-pass variant of APPROVE**: emit it in place of APPROVE when there are LOW, non-blocking notes worth surfacing to the consumer. It carries **no MEDIUM tier** — severity is CRITICAL / LOW only — and it is never a partial or "almost" verdict. Consumers read COMMENT as approve-with-notes: a per-task verifier closes the task after its evidence gate; an objective-level completion gate still requires an explicit APPROVE (the never-false-complete invariant), so a COMMENT there prompts addressing the notes and re-verifying toward APPROVE, never completion.

---

## Quick Reference

```
CYCLE:      PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop ≤5] → EXIT → CLEANUP → STATE
PRE-FLIGHT: MUST-NOT-DO scope + B⊆A only; violation = immediate REQUEST_CHANGES, cycle NOT executed. No EXPECTED OUTCOME → B⊆A is not-evaluable, never A:=Scope
CHECK:      a FAILED row blocks, except a self-authored M/L row scoring 50-74 = soft pass → EXIT Goal Met, soft pass → COMMENT, never APPROVE. 75+ blocks, H blocks, caller-provided blocks, unscorable-below-50 = re-run not soft-pass
ECONOMY:    verify the change's stories and scenarios by the cheapest means that proves them. Server-only → curl the API; UI → one browser/device; a test asserting the scenario is proof (--evidence-surface test); device only for screen claims, released at once. Unchanged platforms are not under test
INPUT:      read the plan/issue/spec/PR yourself; write ACs as user-observable outcomes in the report language. A state file or summary is never the source of requirements
ACTOR:      Actor Roster before scenarios — actor · boundary (verification surface) · driver · client impact (none|contract|render + reason) · profiles · reachable. One actor per client that reads what changed; "screen unchanged" means contract, never an inward boundary. Human-only step (pairing code, OTP) → await-user. Substitute only an unreachable hop and record driven-at; otherwise record blocked (obstacle + attempts + deepest reachable + attempt log), never PASS
PROFILES:   render actors are proven on every device profile they run on; profiles come from qa-device-profiles.ts get; unconfigured → show the defaults and ask once; "don't know" → set --defaults; prune/fix/add with remove / upsert; never guess sizes. Each profile: before/after screenshots, readable and unbroken
SCENARIOS:  user scenarios under stories (author-scenario): what the actor does and sees; ≥1 H per story; risks 1..6 are tags; each risk covered by a scenario or declare-risk-na once per cycle. States: pass/fail · blocked · unrecorded (open work). author-cell, record-cell, waive, na, not_applicable are retired
VERDICT:    REQUEST_CHANGES needs a recorded product failure; APPROVE needs every scenario pass/blocked; any unrecorded scenario with no failure = no verdict yet
BOOTSTRAP:  set up only what the chosen surface needs — isolated local instance, documented QA accounts/seeders first, cross-platform preconditions via API/seed/DB. When the QA REQUEST verifies the deployment itself, its failure is the FAIL
EVIDENCE:   the observation at the surface (before/action/after for screens) or a cited test run; claim only what it proves; launch screens prove nothing; depths never merge
BASELINE:   build/test/lint green. See stage1-commands.md
RISKS:      6 risks — failure paths, boundary/malformed input, injection, interruption, misleading success, idempotency — enter as user scenarios tagged with them. Breadth via scenario-authoring.md, hostile conditions via stage3-handson.md
USE-CASE:   Layer D — build the product-context map from the repo, then walk arrival paths · adjacent state transitions · lifecycle stances; each axis present in the map yields scenarios, and the coverage delta names all three
MAP:        PLAN first calls the QA-local feature-map CLI (`help`/`help query`/`query`); distinguish storage_not_configured + ask_user_for_storage, feature_not_found, and corrupt/unavailable storage; no default or reset; lookup first, then recheck current code/spec and omitted paths; map input is not a scope ceiling or spec authority; keep expected vs observed separate
PROVENANCE: after `add-story`, record map lookup as planning context via `record-story-provenance` before BASELINE; live-file revision + code_ref are mandatory; labels are not membership; legacy/no-map → no fabricated IDs, keep discovery/evidence and report not recorded
MAP-MAINT:  STATE/post-run only verified observations; expected vs actual remain separate; reusable regression recipe; `get` then `save --expect`, reconcile conflicts, never auto-configure; unconfigured storage → keep draft
CASES:      list/get known cases first as PLAN input; author the complete current-cycle chain including new/failed/uncovered paths; after active `chainComplete`, replay with `bun "${CLAUDE_SKILL_DIR}/scripts/qa-replay.ts" --case ... --story ... --scenario ... --project ... --code-ref ... --reset-confirmed ...` before exploratory remaining paths; story goal/Given/When/Then/AC is still required; external manifest only, with unconfigured→ask once for external/project-opt-in/disabled, configured approval remembered, invalid config = error; `{artifacts}` + QA_ARTIFACTS_DIR route output; receipt `qa_result:not-recorded`, runner failure nonzero, no automatic PASS; save only after reset + independent assertion rerun; native `.ad`/agent-browser·Playwright/Maestro formats remain native; traces/recordings/JUnit are not executable proof
DRIVERS:    API→curl, Frontend→agent-browser (fallback playwright, if available), Mobile/native UI→agent-device (load its skill first; use runtime help guidance), CLI→bash. No tmux.
LOOP:       DIAGNOSIS→oracle (fresh, read-only) | FIX→sisyphus-junior (commits own scoped fix, never git commit -a) | RE-VERIFY→qa, full re-run, distrust fixer
EXIT:       Goal Met / max_cycles=5 / Safety
STATE:      bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>; continue resumes at last phase/cycle
NESTING:    qa's fix-loop must NOT be called inside another fix-loop — doc contract, YAGNI; upgrade trigger: add a code guard when qa gains its first fix-loop-owning caller
ROSTER:     ## Scenarios Executed is a precondition for verdict issuance; absent → verdict not issued, cycle incomplete. Exception: PRE-FLIGHT fail-fast issues REQUEST_CHANGES with no roster — never synthesize an empty one there; present+0 rows means inert refactor, a completed cycle
FEEDBACK:   feedback-protocol.md for Confidence Scoring; CONFIDENCE 0-49 discard, 50-74 nitpick, 75+ blocking
REPORT:     STATE renders self-contained HTML (qa-report.ts) after set-verdict, before complete; leads with a reader-facing presentation layer (product/user perspective, not code-diff — affected users · user flows · big-picture diagram · AC→fulfillment mapping) via --narrative presentation object, anchored to recorded actors/stories/ACs; unwritten required slots render visible gap markers. presentation.md owns the contract
```

---

## Final Checklist

**Run this list explicitly right before emitting the verdict — read each line and tick its box against the actual roster.** **Any unchecked box blocks APPROVE.** It restates the blocking gates above as one scannable list; where a box and an earlier section disagree, the stricter reading wins.

- [ ] **Requirements and actors come from the source material** — the ACs and story goals are your own reading of the plan/issue/spec, written as user-observable outcomes; every client the change reaches has an actor with a client impact and reason; every `render` actor has a recorded scenario on each of its device profiles.
- [ ] **Every ADVERSARIAL E2E scenario is a user scenario with a recorded state** — `pass`, `fail`, or `blocked` (with the attempts that hit the limit), and none is unrecorded. Every risk is tagged on a scenario or declared not applicable with a reason. Your final message lists every `blocked` scenario under `## Not Verified`. The verdict is the one *Approval Decision* maps those states to: no REQUEST_CHANGES without a recorded failure.
- [ ] **Each proof was the cheapest that proves it, and claims no more** — `driven-at` names the surface or the test; no device or platform was used that the change did not need.
- [ ] **Every verified scenario carries a reader-visible record** — an authored observation AND before/after screenshots for visual boundaries, with fresh supported `review-evidence` claims naming each source's visible location and observation; missing, insufficient, or stale proof remains unverified. API/text-CLI boundaries use authored observations backed by received output. Raw logs stay in the audit section.
- [ ] **The final HTML has been inspected before attestation** — consume every image/diagram inspection result, repair clipping or unreadable claims, then `review-report` and `complete`. Never batch an unobserved capture with completion.
- [ ] **Each requirement (AC) maps to a grounded verdict** — every `requirementMapping` entry has a non-empty `scenarioRefs` array; the renderer validates each ref against exactly one recorded current-cycle scenario; `yes` requires all `pass`, `no` requires all `fail`, `partial` requires both `pass` and `fail` with no `blocked`, and `unverified` requires a valid `blocked`; missing/legacy/malformed/duplicate/stale/unknown/ineligible mappings fail closed to a visible neutral gap. Prose evidence explains a verdict but cannot establish it; an unproven requirement reads `unverified` (never `yes`/`partial`).

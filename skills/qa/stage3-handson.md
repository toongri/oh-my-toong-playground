# ADVERSARIAL E2E: Hands-On QA

> **Applicability**: this is the detail target for SKILL.md's ADVERSARIAL E2E phase, which activates whenever the change touches a **risk surface** — user-facing or internal — and whenever the caller provided executable scenarios. Only a genuinely inert refactor skips it.

Verify behavior by actually running the change, entered at the boundary from the Actor Roster. This is not optional when applicable.

---

## Step 3.1: Determine Applicability

**Infer change type from the QA REQUEST's Spec and Scope sections.**

### Decision Logic

The applicability gate is not "is the surface user-facing?" — it is **does the change touch a risk surface?** A change with no UI/API entry point can still touch a risk surface (a feature-flag-gated branch, a payment/notification resolver internal, a permission/state-transition path) and must not be waved through on "internal-only" grounds alone. Only a change that touches no risk surface at all — a genuinely inert pure refactor — is safe to skip.

| Signal in Prompt | Change Type | Action |
|------------------|-------------|--------|
| API endpoint, route, handler, REST, HTTP | API | Verify with `curl` |
| UI, page, component, frontend, render | Frontend | Verify with `agent-browser` (fallback: `playwright`, if available) |
| iOS, tvOS, macOS, Android, and Vega OS TV apps; simulator, emulator | Native app | Verify with `agent-device` |
| CLI command, terminal output, TUI, interactive | CLI / TUI | Verify with interactive Bash |
| Feature-flag-gated logic, payment/notification resolver internals, permission/state-transition branch — no direct UI/API entry point but touches a **risk surface** | Internal / risk surface | Do NOT skip — trace the call graph outward to the actor's real boundary (screen, endpoint, job trigger), derive scenarios via [scenario-authoring.md] Layer A→B→C, then drive from that boundary |
| Refactoring, internal logic, utility, helper, config that touches **no risk surface** (pure refactor, no behavior/branch change) | Internal only | **Skip ADVERSARIAL E2E** — unless caller-provided executable scenarios are present; in that case, run them verbatim (no adversarial matrix — no risk surface touched) |
| Documentation, markdown, comments only | Non-code | **Skip ADVERSARIAL E2E** — unless caller-provided executable scenarios are present; in that case, run them verbatim (no adversarial matrix — no risk surface touched) |

### When Multiple Types Apply

If changes span multiple types (e.g., API + Frontend), verify each applicable type independently.

### Skip Documentation

When skipping ADVERSARIAL E2E, document in output:

```
ADVERSARIAL E2E Result: SKIPPED (internal logic only / non-code change)
```

---

## Step 3.2: Server / Application Lifecycle

**The verifier manages the full lifecycle: start, verify, stop.**

### Start

1. Discover the start command (same discovery logic as BASELINE command discovery)
2. Run the server/application in background using `run_in_background`
3. Wait for readiness (health check endpoint, port listening, or startup log message)
4. If startup fails, first distinguish a **correctable setup/config gap** (a missing/misconfigured env var or local config) from an **application startup defect**. A setup gap is bootstrap work, not a FAIL: read the documented env-setup, supply the missing config on your own isolated instance, and retry (Precondition bootstrap rung 1 / Local-first stance in `SKILL.md`). Report ADVERSARIAL E2E FAIL only when startup still fails after that bootstrap, or when the failure is an application defect rather than a setup gap.
5. After successful readiness, export `$API_BASE_URL` (e.g., `export API_BASE_URL=http://localhost:${PORT:?PORT must be set after server start}`) so AC verification commands using the executor-provided variables — `$API_BASE_URL`, `$IOS_UDID`, `$ANDROID_SERIAL`, and `$evidence_xml` — resolve correctly.

### Executor Variable Setup

The QA executor owns target selection and variable export; do not assume a caller has already set these values. Complete the applicable setup before invoking the first modality primitive:

- **iOS Simulator**: discover a compatible target with `xcrun simctl list devices available`, assign its selected identifier (`IOS_UDID="<selected simulator UDID>"`), verify it is non-empty, then run `export IOS_UDID`. Only after this assignment/export may the executor run `xcrun simctl bootstatus "$IOS_UDID" -b`.
- **Android Emulator**: discover an available AVD/device with `emulator -list-avds` and `adb devices`, assign the selected emulator serial (`ANDROID_SERIAL="emulator-<port>"`), verify it is non-empty, then run `export ANDROID_SERIAL`. Only after this assignment/export may the executor run `adb -s "$ANDROID_SERIAL" get-state` or other serial-scoped commands.
- **Per-AC evidence output**: before each AC that emits a report, resolve a fresh path using QA's Evidence Path Priority, assign it (`evidence_xml="<resolved evidence path>"`), verify its parent directory, then run `export evidence_xml`. Execute that AC with `$evidence_xml`; repeat resolution/export for every AC so one AC never inherits another AC's evidence path.

### Stop

After ALL verification completes (pass or fail):

1. Terminate the background process
2. Confirm process is stopped
3. Clean up any temporary resources

**Never leave a server running.** Leaked processes corrupt subsequent reviews.

### Lifecycle Failures

| Failure | Action |
|---------|--------|
| Server won't start | First distinguish a correctable setup/config gap (missing env/local config) — bootstrap it (env-setup read, isolated instance, retry) — from an application startup defect. REQUEST_CHANGES ("server fails to start") only when startup still fails after that bootstrap |
| Server crashes during test | REQUEST_CHANGES ("server crashed during verification") |
| Server won't stop | Kill process forcefully, report as finding |

### Modality-Specific Primitives

The lifecycle steps above describe the general pattern. Each modality requires specific primitives:

| Modality | Start | Wait for ready | Stop |
|----------|-------|----------------|------|
| HTTP server | `run_in_background` with start command | health check endpoint, port listening, or startup log | `kill <pid>` of background process |
| iOS Simulator | `xcrun simctl bootstatus "$IOS_UDID" -b` (idempotent) | bootstatus returns 0 | `xcrun simctl shutdown "$IOS_UDID"` (delete only when created per-workspace) |
| Android Emulator | `emulator -avd <name> ... >/tmp/emulator-<port>.log 2>&1 &` | `adb -s "$ANDROID_SERIAL" get-state` + `adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed` with bounded `SECONDS` deadline | `adb -s "$ANDROID_SERIAL" emu kill` |

Apply the corresponding row's primitives based on the change type detected in Step 3.1. Mobile modalities use Step 3.5 procedures, which expand on these primitives.

---

## Step 3.3: API Verification (curl)

**Verify API endpoints respond correctly with `curl`.**

### Procedure

1. Identify the endpoints that are the roster boundary for a client actor
2. Issue each scenario's request exactly as that client would — same method, headers, auth, and body
3. Verify response status code, body structure, and key values, and capture the request/response pair as that scenario's `action`/`after` evidence

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Status code | Matches expected (200, 201, 400, etc.) |
| Response body | Contains expected fields/values |
| Error cases | Returns appropriate error response |

---

## Step 3.4: Frontend Verification (agent-browser → fallback: playwright, if available)

**Verify UI behavior with `agent-browser`. Fall back to `playwright`, when available, only when an agent-browser attempt actually fails or cannot express the check — not as a preemptive capability decision.**

### Procedure

**Primary path — agent-browser (attempt-then-fallback rule):**

**Worktree hygiene:** A browser-tool install is setup state, not a change under verification. Use an ephemeral project-local install directory outside the checked worktree, with its own `node_modules` and executable path, so the target repository's manifest, lockfile, and node_modules are untouched. If the install mechanism does touch the checked worktree, restore only those installer-created files before CHECK and verify the clean-state result again. Apply this rule to both agent-browser and Playwright.

1. Check the CLI is available: `command -v agent-browser`. If it is missing, install it rather than skip the scenario — project-local first (a devDependency or a project-scoped local bin, no machine mutation), falling back to a global install only if a project-local install is not possible for this tool; use the ephemeral directory above for the project-local path. If even the global install fails (offline, locked-down), record that failure as the substituted hop and use the Playwright fallback path below instead of declaring the scenario unreachable. Local-first exists because a global install can hang or fail in offline/locked-down environments — it is a safety order, not a ban.
2. Open the affected page:
   ```bash
   agent-browser open <url>
   ```
3. Capture the accessibility-tree snapshot (interactive):
   ```bash
   agent-browser snapshot -i
   ```
4. Interact with elements using `@eN` refs from the snapshot:
   ```bash
   agent-browser fill @eN "<value>"   # text input
   agent-browser click @eN            # button / link
   agent-browser wait --load networkidle
   ```
5. Assert outcomes:
   ```bash
   agent-browser get url              # current URL after navigation
   agent-browser get text @eN         # element text content
   ```
6. **Capture the asserted state** (mandatory — one screenshot before the action, one after, each showing the state the scenario asserts, not a landing page):
   ```bash
   agent-browser screenshot
   ```
7. Close the session:
   ```bash
   agent-browser close
   ```

**Fallback path — playwright, only if available (optional):**

If an agent-browser step returns a non-zero exit code or the required assertion cannot be expressed via the agent-browser CLI, and a playwright is available in this environment (however it's supplied), use it to verify that check instead — document the failure reason in evidence. If no playwright is available, install it — project-local first, global only if project-local is not possible — in the same ephemeral directory outside the checked worktree before falling back to reporting that check as verification-unavailable; only an install failure (offline, locked-down) earns that fallback, recorded as a substitution, not an unattempted skip. Any target manifest, lockfile, or `node_modules` changes must be restored before CHECK.

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Page loads | No console errors, expected elements visible |
| Interaction | Click/input produces expected result |
| Navigation | Routes resolve to correct pages |
| Screenshot captured | Before/after captures of the asserted state, referenced in evidence — a landing or splash capture does not count |
| CJK / glyph rendering | CJK characters, emoji, and non-ASCII glyphs render without replacement boxes or mojibake |
| Layout overflow | No element overflows its container; horizontal scroll width does not exceed viewport width |

---

## Step 3.5: Native App Verification (agent-device — iOS, tvOS, macOS, Android, Vega OS TV)

**Verify iOS, tvOS, macOS, Android, and Vega OS TV app behavior through `agent-device`.**

### Procedure

Device operation is delegated to the version-current `agent-device` skill. Before discovering, booting, or driving a target, load that skill, then consult the smallest relevant runtime `agent-device help <topic>` (for example, target discovery, platform setup, interaction, or evidence capture). Follow the returned guidance for the installed version; do not substitute remembered command syntax.

1. Identify the changed native-app surface and the target platform. `agent-device` supports iOS, tvOS, macOS, Android, and Vega OS TV apps only — Windows and Linux native desktop apps, and TV platforms outside tvOS and Vega OS, have no supported driver here; if the surface falls outside this range, stop and tell the user instead of routing it to `agent-device`. For a supported surface, use the skill's smallest relevant discovery/setup guidance to select a compatible simulator, emulator, physical device, or TV target. Record the chosen target and its app/OS version in the QA evidence.
2. Turn the applicable caller-provided scenarios (run verbatim) and self-authored scenarios from [scenario-authoring.md] into observable app states and assertions. Use `agent-device`'s version-matched guidance to prepare the target and execute those interactions.
3. For each scenario, capture the evidence required by this QA cycle: screenshots or UI snapshots that show the asserted state, plus relevant app/device logs and any tool-produced run artifact. Store or reference them using the 3-tier Evidence Path Priority and retain the target identity so another QA run can reproduce the result.
4. On failure, preserve the failure screenshot/snapshot, relevant logs, target identity, scenario steps, observed state, and the exact assertion that failed. Do not silently retry away a failure; report it under the ADVERSARIAL E2E output contract and continue only where isolation permits.

### Parallel Workspace Isolation

When multiple QA runs may execute concurrently (parallel git worktrees, CI matrix), use the skill's current isolation guidance so each run receives a distinct target or reliably isolated app state. Record the isolation choice in evidence. A shared target is allowed only when the version-matched guidance supports it and each scenario resets state sufficiently to prevent cross-run contamination.

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Scenario completes | The observable end state matches the scenario's expected result |
| Element assertion | The required UI state is visibly present or absent in captured evidence |
| Navigation | Screen transitions reach the expected destination |
| Evidence | Screenshots/snapshots and relevant logs or run artifacts are retained and referenced |

### Real-Device Escalation

Items requiring physical hardware (push delivery, biometric enrollment, camera, sensors, performance/jank, OEM-specific behavior) are out of scope for this stage's simulator/emulator verification — escalate to a device farm in nightly/release pipelines.

### Teardown

After native-app verification completes (pass or fail), use the loaded skill's version-matched teardown guidance for targets created by this QA run. Do not tear down shared targets that the guidance identifies as reusable. Record cleanup success or any retained target in the ADVERSARIAL E2E output.

---

## Step 3.6: CLI / TUI Verification (Interactive Bash)

**Verify CLI output and behavior by executing commands directly.**

### Procedure

1. Identify the CLI commands affected by the change
2. Execute each command with expected arguments
3. Verify stdout/stderr output matches expectations

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Exit code | Matches expected (0 for success) |
| stdout | Contains expected output |
| stderr | No unexpected errors |
| Side effects | Files created/modified as expected |

---

## ADVERSARIAL E2E Output Format

```markdown
## ADVERSARIAL E2E: Hands-On QA

**Applicability:** [API / Frontend / Mobile / CLI / SKIPPED (reason)]

| Verification | Why-Needed | Status | Details |
|--------------|-----------|--------|---------|
| Server start | - | PASS / FAIL | [startup details] |
| [Endpoint/Page/Command] | [why this scenario exists — the coverage gap it fills, from the derived scenario's `why-needed` field] | PASS / FAIL | [response/behavior summary] |
| Server stop | - | PASS / FAIL | [cleanup details] |

**ADVERSARIAL E2E Result:** PASS -> Proceed to CHECK / FAIL -> by row class, see below / SKIPPED -> Proceed to CHECK
```

---

## ADVERSARIAL E2E Failure = Stop or Carry, by Row Class

Whatever fails, first report it with specific output (response body, error message, evidence reference). Then dispose of it by the row's class. **No scenario-row failure issues a verdict here** — all three classes below end at SKILL.md `### CHECK`, which owns it. What the class decides is whether the remaining rows still get driven. (A lifecycle failure — the server never starting or crashing outright — is a different class, handled by *Lifecycle Failures* above.)

| Failed row | Disposition |
|------------|-------------|
| Caller-provided scenario | **Stop driving.** Abandon the remaining rows (leave them `NOT-RUN`), stop the server/application, go straight to CHECK — where a failed caller-provided row blocks, so the cycle enters DIAGNOSIS → FIX → RE-VERIFY and re-runs from BASELINE after the fix |
| Self-authored `H`-priority row | Same — stop driving, abandon the remaining rows, go straight to CHECK, which blocks on it |
| Self-authored `M`/`L` row | Keep driving. Record it FAIL in the roster, finish the remaining rows, and carry it to CHECK, which decides between a blocking failure and a soft pass |

The stop-driving classes exist so an expensive cycle is not spent against a surface that already failed what the caller or the risk ranking called essential. A lower-priority failure does not earn that interrupt — it earns a FAIL row and a verdict decided with the whole roster in view. Stopping early is not a verdict: the abandoned rows stay `NOT-RUN` in the roster and CHECK reads them as unproven, never as passing.

---

## Red Flags for ADVERSARIAL E2E

| Excuse | Reality |
|--------|---------|
| "Tests already cover this" | Tests verify units. Hands-on verifies integration. |
| "Server setup is too complex" | If it's too complex to start, it's too complex to ship. |
| "It's just a minor API change" | Minor changes break clients. Verify the contract. |
| "Frontend testing is slow" | Slow verification beats broken UI in production. |
| "I can see the code is correct" | "Can see" != "verified". Run it. |
| "It worked in the test suite" | Test suite mocks may hide real integration issues. |
| "No test data available" | Create minimal test data. No excuses. |
| "The branch isn't deployed to stage/dev" | For an undeployed source change, deployment is an environment choice — run the full stack locally and point the app at it. When the deployment itself is under test, its absence or 404 is the FAIL. |
| "The local backend won't start / the local stack is shared, so I stopped" | Read the documented env-setup and stand up your own isolated instance (own ports/data/containers). A startup config gap is a fix; a shared or fragile env is neither a blocker nor something to corrupt. Run local QA against a stack you own for maximum freedom to seed/mutate/interrupt/reset. |
| "No account / the flag lives on another platform" | Use the project's documented pre-provisioned account / admin QA seeder first; only if none is documented, or the documented path was tried and proved unusable (expired credentials, broken/unavailable tool, or it cannot produce the required state), do you sign up or inject a test token. Launch the precondition platform too — multi-platform setup is setup cost, not an obstacle. |
| "The seeded account lacks the data, so I'll onboard manually / inject dummy creds" | Read the documented QA provisioning and local-env setup first — improvising around a documented account, seeder, or env prerequisite is a wrong detour, not bootstrap. |
| "Skip for internal changes" | If truly internal, document skip. Don't use as escape hatch. |
| "E2E tests simulate HTTP" | MockMvc/WebTestClient operate without a servlet container. They are not real HTTP. |

---

## Adversarial Scenario Matrix

This matrix is the **hostile-depth** dimension applied to scenarios already derived by breadth in [scenario-authoring.md] — see that file's `Breadth Then Depth`. Do not skip straight to this matrix on an undifferentiated changed-file list, and run each row from the scenario's actor boundary, not against the changed unit.

Hands-on verification is not "run the happy path once." A change is only verified when it survives hostile probing. When running these checks, adopt the mindset of a malicious or careless user: someone who ignores documentation, pastes garbage data, skips required fields, and actively tries to confuse or break the system. After the modality procedures above confirm the happy path, run the adversarial checks below. Each category names what a hostile check looks like so a verifier running hands-on knows what to probe — pick the rows that apply to the change under review and actually execute them, do not reason about them on paper.

| # | Category | What the adversarial check probes |
|---|----------|-----------------------------------|
| 1 | **Error / failure paths** | Force the failure branch (unreachable dependency, denied permission, invalid auth, exhausted quota) and assert it fails *safely*: no partial writes, a clear error message, and the correct status/exit code. A failure that silently half-completes is a defect. Also author and run the `hang-timeout` sub-item: hold the dependency or operation past its timeout, then verify bounded cancellation, cleanup, and a reasoned outcome rather than an indefinitely pending or silently green result. |
| 2 | **Boundary / malformed input** | Probe the `boundary\|malformed` surface: feed empty, zero, negative, oversized, wrong-type, encoding-edge (UTF-8 / null bytes / emoji), and off-by-one boundary values. Assert each is rejected or handled deterministically rather than crashing or coercing silently. |
| 3 | **Injection** | Send SQL / command / prompt injection payloads through every user-controlled field (query params, body, headers, file names, LLM prompts). Assert the payload is neutralized, not interpreted. |
| 4 | **Interruption–cancel–resume + dirty initial state** | Kill or cancel the operation mid-flight, then re-run it; trigger concurrent executions, rapid repeated calls, and out-of-order sequencing; also start it from a dirty/partial prior state (leftover lock file, half-written record, stale session). Assert it recovers to a consistent state rather than compounding corruption. |
| 5 | **Misleading success** (OWASP LLM09) | Distrust a green check / `200` / `"done"` that does not reflect real success. Verify the *actual effect* — the row was written, the file changed on disk, the message was delivered — not the success signal the system reports. An overconfident success claim is itself the bug. Also author and run the `flaky-green` (lucky-green) sub-item: repeat the same probe under the same inputs and confirm a reported pass is stable and backed by the effect, not a timing-dependent lucky result. |
| 6 | **Idempotency / re-run** | Run the operation twice with identical inputs and assert no duplicate records, double charges, or corruption. **By-design exception**: some operations are intentionally non-idempotent (append-only logs, "send another reminder", incrementing counters). When the spec marks an operation as intended to differ on re-run, repeated effects are an acceptable exception, not a defect — confirm against the intended behavior rather than flagging it. |
| 7 | **stale-state** (source vs. packaged / build-artifact staleness) | Verify against the actually deployed/packaged artifact — build cache, bundled dist, compiled binary, container image — not just the source tree; a source-correct change can still ship stale bytes. This is distinct from row 4: row 4 is a dirty *runtime* state (a corrupted mid-operation record inside the running system); row 7 is stale *build artifacts* (the wrong bytes were packaged/deployed in the first place). Record this per run with `qa-state.ts record-run-check --check stale-state --result pass|fail`. |
| 8 | **dirty-worktree** (git / harness debris) | Check the repo/worktree the verification run itself leaves behind — a stray test file, an uncommitted debug print, a leftover git stash, a temporary branch the harness created. Temporary-harness debris is not a product defect, but it must be noticed and cleaned up, not silently committed. This is distinct from row 4: row 4 is dirty *application* state; row 8 is debris the *harness/verifier* leaves in the repo. Record this per run with `qa-state.ts record-run-check --check dirty-worktree --result pass|fail --note "…"` when it fails. |
| 9 | **flaky-rerun** (non-deterministic pass/fail) | Run the identical check 2-3 times with identical inputs and assert the pass/fail verdict is stable across runs. A verdict that flips between runs (race condition, order-dependent test, timing-sensitive assertion) is itself a defect. This is distinct from row 6: row 6 asks whether re-running produces duplicate/corrupted *effects*; row 9 asks whether re-running produces a consistent *verdict* on the same effects. Record this per run with `qa-state.ts record-run-check --check flaky-rerun --result pass|fail`. |

# Stage 3: Hands-On QA

> **Hands-on execution applicability**: This is the detail target for SKILL.md's `Hands-on execution` trigger, which activates on a disjunction: **user-facing change OR caller-provided executable scenarios**. Either arm alone activates it. Caller-provided scenarios run verbatim on either arm. The adversarial matrix is added only when the **user-facing** arm is active — activation by caller-provided scenarios alone (non-user-facing change) runs those scenarios verbatim without the matrix.

Verify user-facing behavior by actually running the changed code. This is not optional when applicable.

---

## Step 3.1: Determine Applicability

**Infer change type from the QA REQUEST's Spec and Scope sections.**

### Decision Logic

| Signal in Prompt | Change Type | Action |
|------------------|-------------|--------|
| API endpoint, route, handler, REST, HTTP | API | Verify with `curl` |
| UI, page, component, frontend, render | Frontend | Verify with `agent-browser` (fallback: `playwright`) |
| Mobile, app, iOS, Android, simulator, emulator | Mobile | Verify with `maestro` |
| CLI command, terminal output, TUI, interactive | CLI / TUI | Verify with interactive Bash |
| Refactoring, internal logic, utility, helper, config | Internal only | **Skip Stage 3** — unless caller-provided executable scenarios are present; in that case, run them verbatim (no adversarial matrix — non-user-facing surface) |
| Documentation, markdown, comments only | Non-code | **Skip Stage 3** — unless caller-provided executable scenarios are present; in that case, run them verbatim (no adversarial matrix — non-user-facing surface) |

### When Multiple Types Apply

If changes span multiple types (e.g., API + Frontend), verify each applicable type independently.

### Skip Documentation

When skipping Stage 3, document in output:

```
Stage 3 Result: SKIPPED (internal logic only / non-code change)
```

---

## Step 3.2: Server / Application Lifecycle

**The verifier manages the full lifecycle: start, verify, stop.**

### Start

1. Discover the start command (same discovery logic as Stage 1 command discovery)
2. Run the server/application in background using `run_in_background`
3. Wait for readiness (health check endpoint, port listening, or startup log message)
4. If startup fails after reasonable timeout, report as Stage 3 FAIL
5. After successful readiness, export `$API_BASE_URL` (e.g., `export API_BASE_URL=http://localhost:${PORT:?PORT must be set after server start}`) so AC verification commands referencing the [Executor-Provided Variables](../prometheus/acceptance-criteria.md#executor-provided-variables) contract resolve correctly.

### Stop

After ALL verification completes (pass or fail):

1. Terminate the background process
2. Confirm process is stopped
3. Clean up any temporary resources

**Never leave a server running.** Leaked processes corrupt subsequent reviews.

### Lifecycle Failures

| Failure | Action |
|---------|--------|
| Server won't start | REQUEST_CHANGES ("server fails to start") |
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

1. Identify endpoints affected by the change (from EXPECTED OUTCOME)
2. Construct `curl` commands for each endpoint
3. Verify response status code, body structure, and key values

### curl Usage

```bash
# Basic GET
curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}/endpoint

# POST with body
curl -s -X POST http://localhost:{port}/endpoint \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'

# Capture full response
curl -s http://localhost:{port}/endpoint | jq .
```

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Status code | Matches expected (200, 201, 400, etc.) |
| Response body | Contains expected fields/values |
| Error cases | Returns appropriate error response |

---

## Step 3.4: Frontend Verification (agent-browser → fallback: playwright)

**Verify UI behavior with `agent-browser`. Fall back to `playwright` only when an agent-browser attempt actually fails or cannot express the check — not as a preemptive capability decision.**

### Procedure

**Primary path — agent-browser (attempt-then-fallback rule):**

1. Check the CLI is available: `command -v agent-browser`. If it is missing, treat that as an agent-browser attempt failure — record the reason in evidence and use the Playwright fallback path below. Do NOT install agent-browser here: the CLI is assumed pre-installed, and a QA flow must not mutate the global machine (a global install can hang or fail in offline/locked-down environments).
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
6. Close the session:
   ```bash
   agent-browser close
   ```

**Fallback path — playwright (only on agent-browser attempt failure or inexpressible check):**

If any agent-browser step returns a non-zero exit code or the required assertion cannot be expressed via the agent-browser CLI, switch to playwright for that check. Document the failure reason in evidence.

1. Ensure playwright is installed in the project (check `package.json`)
2. Navigate to the affected page/component
3. Verify visual elements render correctly
4. Test user interactions described in EXPECTED OUTCOME

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Page loads | No console errors, expected elements visible |
| Interaction | Click/input produces expected result |
| Navigation | Routes resolve to correct pages |

---

## Step 3.5: Mobile App Verification (maestro)

**Verify mobile app behavior with `maestro` on iOS Simulator / Android Emulator.**

### Procedure

Mobile/RN E2E verification runs on Maestro, which exposes two surfaces. Use the **Maestro MCP** for interactive inspection while authoring or debugging a flow (e.g. `inspect_screen`, `take_screenshot`); use the **Maestro CLI** for the deterministic, evidence-producing runs in the steps below (`maestro test --format junit --output`). Do not drive both against the same device at once — they both bind port 7001 and collide (maestro issue #2921). When authoring or repairing a `.maestro` flow, keep it deterministic: stable selectors (id/text, not coordinates), condition-based waits (`extendedWaitUntil`, never fixed sleeps), and per-run state isolation (`clearState`).

1. Ensure `maestro` is installed (`maestro --version`); for iOS, Xcode + iOS Simulator; for Android, Android SDK + emulator
2. Boot the target simulator/emulator before the test:
   - **iOS**: derive UDID first (idempotent — `bootstatus -b` boots if needed, waits until fully booted, exits 0 if already booted):
     ```bash
     IOS_UDID=$(xcrun simctl list devices available -j | jq -r '.devices | to_entries[] | .value[] | select(.name=="iPhone 16") | .udid' | head -1)
     [ -n "$IOS_UDID" ] || { echo "iPhone 16 simulator not available" >&2; exit 1; }
     xcrun simctl bootstatus "$IOS_UDID" -b
     export IOS_UDID
     ```
   - **Android**: launch in background and wait for boot with bounded polling (per `SKILL.md` § Command Execution Policy: Non-Blocking Only). `timeout` is not on default macOS userland; use bash `SECONDS` deadlines:
     ```bash
     export ANDROID_SERIAL="emulator-${EMULATOR_PORT:-5554}"
     emulator -avd <name> -port "${EMULATOR_PORT:-5554}" -no-window -no-boot-anim >/tmp/emulator-${EMULATOR_PORT:-5554}.log 2>&1 &
     SECONDS=0; until adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1; do (( SECONDS > 60 )) && { echo "device wait timeout" >&2; exit 1; }; sleep 1; done
     SECONDS=0; until [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do (( SECONDS > 90 )) && { echo "boot timeout" >&2; exit 1; }; sleep 1; done
     ```
3. Run the flow with explicit device binding and output path (`.maestro/<flow>.yaml` is Maestro's repo-root default; point at the project's actual flow path if it stores flows elsewhere). `$evidence_xml` is resolved via the 3-tier Evidence Path Priority (e.g., `$OMT_DIR/evidence/<work-slug>/<task-slug>/maestro-<flow>.xml`):
   - iOS: `maestro --device "$IOS_UDID" test .maestro/<flow>.yaml --format junit --output "$evidence_xml"`
   - Android: `maestro --device "$ANDROID_SERIAL" test .maestro/<flow>.yaml --format junit --output "$evidence_xml"`
   Device binding is mandatory even in single-device sessions to keep evidence deterministic across parallel runs.
4. Capture evidence: copy the JUnit XML at `$evidence_xml` and any referenced screenshots from `~/.maestro/tests/<run-id>/` into the evidence directory. Record the `<run-id>` from maestro stdout for traceability.

### Parallel Workspace Isolation

When multiple QA runs may execute concurrently (parallel git worktrees, CI matrix), each MUST target a distinct device instance — sharing a single emulator across concurrent flows corrupts app state.

- iOS: create a per-workspace device, then use the same UDID-derived boot pattern as Step 2 above:
  ```bash
  IOS_UDID=$(xcrun simctl create "qa-$WORKSPACE" "iPhone 16")
  xcrun simctl bootstatus "$IOS_UDID" -b
  export IOS_UDID
  ```
- Android: name a per-workspace AVD or pass `-port` to differentiate
- Pass the device id explicitly: `maestro --device <udid> test .maestro/<flow>.yaml`

**Lighter alternative**: a single shared simulator with `clearState: true` at flow start (Maestro built-in) — avoids per-workspace boot overhead, but trades off cross-flow filesystem/keychain isolation. Use when flows self-reset state.

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Flow completes | All maestro steps `✓`, no `✗` |
| Element assertion | `assertVisible` / `assertNotVisible` matches expected screen state |
| Navigation | Screen transitions reach expected destination |

### Real-Device Escalation

Items requiring physical hardware (push delivery, biometric enrollment, camera, sensors, performance/jank, OEM-specific behavior) are out of scope for this stage's simulator/emulator verification — escalate to a device farm in nightly/release pipelines.

### Teardown

After all maestro verification completes (pass or fail):

- **iOS — parallel-workspace mode** (created via `xcrun simctl create "qa-$WORKSPACE" ...`):
  ```bash
  xcrun simctl shutdown "$IOS_UDID" 2>/dev/null
  xcrun simctl delete "$IOS_UDID" 2>/dev/null
  ```
- **iOS — shared simulator mode** (reused existing `iPhone 16` device): no teardown — the device persists across runs by design.
- **Android**:
  ```bash
  adb -s "$ANDROID_SERIAL" emu kill 2>/dev/null
  ```
  Fallback if the device was unreachable: `pkill -f "emulator.*-port ${EMULATOR_PORT:-5554}"`.

Skip teardown only when boot was idempotent and the device was reused, not created. Leaked simulators accumulate disk space; leaked emulator processes block port reuse on subsequent runs.

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

## Stage 3 Output Format

```markdown
## Stage 3: Hands-On QA

**Applicability:** [API / Frontend / Mobile / CLI / SKIPPED (reason)]

| Verification | Status | Details |
|--------------|--------|---------|
| Server start | PASS / FAIL | [startup details] |
| [Endpoint/Page/Command] | PASS / FAIL | [response/behavior summary] |
| Server stop | PASS / FAIL | [cleanup details] |

**Stage 3 Result:** PASS -> Proceed to Stage 4 / FAIL -> REQUEST_CHANGES / SKIPPED -> Proceed to Stage 4
```

---

## Stage 3 Failure = Immediate Stop

If ANY verification fails:
1. **Do NOT proceed to Stage 4**
2. Report the failure with specific output (response body, error message, screenshot reference)
3. **Stop** the server/application
4. Issue `REQUEST_CHANGES` immediately
5. Wait for fix and re-run from Stage 1

---

## Red Flags for Stage 3

| Excuse | Reality |
|--------|---------|
| "Tests already cover this" | Tests verify units. Hands-on verifies integration. |
| "Server setup is too complex" | If it's too complex to start, it's too complex to ship. |
| "It's just a minor API change" | Minor changes break clients. Verify the contract. |
| "Frontend testing is slow" | Slow verification beats broken UI in production. |
| "I can see the code is correct" | "Can see" != "verified". Run it. |
| "It worked in the test suite" | Test suite mocks may hide real integration issues. |
| "No test data available" | Create minimal test data. No excuses. |
| "Skip for internal changes" | If truly internal, document skip. Don't use as escape hatch. |
| "E2E tests simulate HTTP" | MockMvc/WebTestClient operate without a servlet container. They are not real HTTP. |

---

## Adversarial Scenario Matrix

Hands-on verification is not "run the happy path once." A change is only verified when it survives hostile probing. After the modality procedures above confirm the happy path, run the adversarial checks below. Each category names what a hostile check looks like so a verifier running hands-on knows what to probe — pick the rows that apply to the change under review and actually execute them, do not reason about them on paper.

| # | Category | What the adversarial check probes |
|---|----------|-----------------------------------|
| 1 | **Error / failure paths** | Force the failure branch (unreachable dependency, denied permission, invalid auth, exhausted quota) and assert it fails *safely*: no partial writes, a clear error message, and the correct status/exit code. A failure that silently half-completes is a defect. |
| 2 | **Boundary / malformed input** | Probe the `boundary\|malformed` surface: feed empty, oversized, wrong-type, encoding-edge (UTF-8 / null bytes / emoji), and off-by-one boundary values. Assert each is rejected or handled deterministically rather than crashing or coercing silently. |
| 3 | **Injection** | Send SQL / command / prompt injection payloads through every user-controlled field (query params, body, headers, file names, LLM prompts). Assert the payload is neutralized, not interpreted. |
| 4 | **Interruption–cancel–resume + dirty initial state** | Kill or cancel the operation mid-flight, then re-run it; also start it from a dirty/partial prior state (leftover lock file, half-written record, stale session). Assert it recovers to a consistent state rather than compounding corruption. |
| 5 | **Misleading success** (OWASP LLM09) | Distrust a green check / `200` / `"done"` that does not reflect real success. Verify the *actual effect* — the row was written, the file changed on disk, the message was delivered — not the success signal the system reports. An overconfident success claim is itself the bug. |
| 6 | **Idempotency / re-run** | Run the operation twice with identical inputs and assert no duplicate records, double charges, or corruption. **By-design exception**: some operations are intentionally non-idempotent (append-only logs, "send another reminder", incrementing counters). When the spec marks an operation as intended to differ on re-run, repeated effects are an acceptable exception, not a defect — confirm against the intended behavior rather than flagging it. |

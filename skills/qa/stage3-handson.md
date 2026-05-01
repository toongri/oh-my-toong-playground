# Stage 3: Hands-On QA

> **Layer D applicability**: This guide applies when changes affect user-facing behavior AND no QA scenarios are provided in the QA REQUEST. When QA scenarios are provided, Layer C (QA Scenarios Execution) is used instead.

Verify user-facing behavior by actually running the changed code. This is not optional when applicable.

---

## Step 3.1: Determine Applicability

**Infer change type from the QA REQUEST's Spec and Scope sections.**

### Decision Logic

| Signal in Prompt | Change Type | Action |
|------------------|-------------|--------|
| API endpoint, route, handler, REST, HTTP | API | Verify with `curl` |
| UI, page, component, frontend, render | Frontend | Verify with `playwright` |
| Mobile, app, iOS, Android, simulator, emulator | Mobile | Verify with `maestro` |
| CLI command, terminal output, TUI, interactive | CLI / TUI | Verify with interactive Bash |
| Refactoring, internal logic, utility, helper, config | Internal only | **Skip Stage 3** |
| Documentation, markdown, comments only | Non-code | **Skip Stage 3** |

### When Multiple Types Apply

If changes span multiple types (e.g., API + Frontend), verify each applicable type independently.

### Skip Documentation

When skipping Stage 3, document in output:

```
Stage 3 Result: SKIPPED (internal logic only / non-code change)
```

---

## Step 3.2: Server / Application Lifecycle

**Argus manages the full lifecycle: start, verify, stop.**

### Start

1. Discover the start command (same discovery logic as Stage 1 command discovery)
2. Run the server/application in background using `run_in_background`
3. Wait for readiness (health check endpoint, port listening, or startup log message)
4. If startup fails after reasonable timeout, report as Stage 3 FAIL

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

## Step 3.4: Frontend Verification (playwright)

**Verify UI behavior with `playwright`.**

### Procedure

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
     export ANDROID_SERIAL="emulator-${PORT:-5554}"
     emulator -avd <name> -port "${PORT:-5554}" -no-window -no-boot-anim &
     SECONDS=0; until adb get-state >/dev/null 2>&1; do (( SECONDS > 60 )) && { echo "device wait timeout" >&2; exit 1; }; sleep 1; done
     SECONDS=0; until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do (( SECONDS > 90 )) && { echo "boot timeout" >&2; exit 1; }; sleep 1; done
     ```
3. Run the flow with explicit output path: `maestro test .maestro/<flow>.yaml --format junit --output "$evidence_xml"`, where `$evidence_xml` is resolved via the 3-tier Evidence Path Priority (e.g., `$OMT_DIR/evidence/<work-slug>/task-<N>-maestro-<flow>.xml`).
4. Capture evidence: copy the JUnit XML at `$evidence_xml` and any referenced screenshots from `~/.maestro/tests/<run-id>/` into the evidence directory. Record the `<run-id>` from maestro stdout for traceability.

### Parallel Workspace Isolation

When multiple Argus runs may execute concurrently (parallel git worktrees, CI matrix), each MUST target a distinct device instance — sharing a single emulator across concurrent flows corrupts app state.

- iOS: create a per-workspace device, then use the same UDID-derived boot pattern as Step 2 above:
  ```bash
  IOS_UDID=$(xcrun simctl create "argus-$WORKSPACE" "iPhone 16")
  xcrun simctl bootstatus "$IOS_UDID" -b
  export IOS_UDID
  ```
- Android: name a per-workspace AVD or pass `-port` to differentiate
- Pass the device id explicitly: `maestro test --device <udid> .maestro/<flow>.yaml`

**Lighter alternative**: a single shared simulator with `clearState: true` at flow start (Maestro built-in) — avoids per-workspace boot overhead, but trades off cross-flow filesystem/keychain isolation. Use when flows self-reset state.

### Verification Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| Flow completes | All maestro steps `✓`, no `✗` |
| Element assertion | `assertVisible` / `assertNotVisible` matches expected screen state |
| Navigation | Screen transitions reach expected destination |

### Real-Device Escalation

Items requiring physical hardware (push delivery, biometric enrollment, camera, sensors, performance/jank, OEM-specific behavior) are out of scope for this stage's simulator/emulator verification — escalate to a device farm in nightly/release pipelines.

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

---

## Maintenance: Adding a New Tool Modality

When introducing a new hands-on verification tool (e.g., `maestro` for Mobile), touch all 6 locations below. Missing any one location causes partial-update defects.

Items 1 (Decision Logic) and 2 (new Step section) are consolidated into a single row — both live in this file and are edited in the same pass.

| # | Location | What to update | Grep target |
|---|----------|---------------|-------------|
| 1 | `skills/qa/stage3-handson.md` § Step 3.1 Decision Logic (+ new `## Step 3.N` section) | Add row to Decision Logic table; add a `## Step 3.N` section with Procedure, Verification Criteria, and Real-Device/Edge note if applicable | `grep -n "Decision Logic\|Step 3\." stage3-handson.md` |
| 2 | `skills/qa/stage3-handson.md` § Stage 3 Output Format (Applicability enum) | Add the new modality token to the Output Format Applicability enum (`[API / Frontend / Mobile / CLI / SKIPPED]`) | `grep -n "Applicability.*API" stage3-handson.md` |
| 3 | `skills/qa/SKILL.md` § Composable Verification Triggers → Trigger Activation Table | Add a row to the Trigger Activation Table with the action label and tool name | `grep -n "Trigger\|maestro\|playwright\|curl" skills/qa/SKILL.md` |
| 4 | `skills/qa/SKILL.md` § "When: user-facing changes, no scenarios" Applicability + § Quick Reference | Update the Applicability matrix and Quick Reference summary to include the new modality | `grep -n "^### Applicability\|^## Quick Reference\|user-facing changes, no scenarios" skills/qa/SKILL.md` |
| 5 | `skills/prometheus/plan-template.md` § QA Scenarios `Tool` field | Add the new tool name to the QA Scenarios `Tool` field whitelist | `grep -n "Tool.*curl\|Tool.*playwright\|Tool.*maestro" skills/prometheus/plan-template.md` |
| 6 | `skills/prometheus/acceptance-criteria.md` § Verification Examples by Tool | Add a subsection under `## Verification Examples by Tool` for the new tool | `grep -n "Verification Examples by Tool" skills/prometheus/acceptance-criteria.md` |

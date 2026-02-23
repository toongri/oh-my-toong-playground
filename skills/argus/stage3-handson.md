# Stage 3: Hands-On QA

Verify user-facing behavior by actually running the changed code. This is not optional when applicable.

---

## Step 3.1: Determine Applicability

**Infer change type from the 6-Section prompt's TASK and EXPECTED OUTCOME sections.**

### Decision Logic

| Signal in Prompt | Change Type | Action |
|------------------|-------------|--------|
| API endpoint, route, handler, REST, HTTP | API | Verify with `curl` |
| UI, page, component, frontend, render | Frontend | Verify with `playwright` |
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

## Step 3.5: CLI / TUI Verification (Interactive Bash)

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

**Applicability:** [API / Frontend / CLI / SKIPPED (reason)]

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

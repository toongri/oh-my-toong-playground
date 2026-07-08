#!/bin/bash
# =============================================================================
# Session Start Hook Tests
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.omt"
    mkdir -p "$TEST_TMP_DIR/.git"

    # Store original HOME
    ORIGINAL_HOME="$HOME"

    # Create temporary home directory for isolated tests
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"
    unset OMT_DIR
    unset OMT_PROJECT

    # Pre-compute TEST_OMT_DIR: mirrors session-start.sh OMT_DIR derivation.
    # Since TEST_TMP_DIR has no real git repo, PROJECT_NAME = basename(TEST_TMP_DIR).
    TEST_PROJECT_NAME=$(basename "$TEST_TMP_DIR")
    TEST_OMT_DIR="$TEST_HOME/.omt/$TEST_PROJECT_NAME"
    mkdir -p "$TEST_OMT_DIR"
}

teardown_test_env() {
    # Restore original HOME
    export HOME="$ORIGINAL_HOME"

    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
    if [[ -d "$TEST_HOME" ]]; then
        rm -rf "$TEST_HOME"
    fi
}

assert_output_contains() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should contain pattern}"

    if echo "$output" | grep -q "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  Output (first 500 chars): ${output:0:500}"
        return 1
    fi
}

assert_output_not_contains() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should NOT contain pattern}"

    if ! echo "$output" | grep -q "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        return 1
    fi
}

run_test() {
    local test_name="$1"
    CURRENT_TEST="$test_name"

    setup_test_env

    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi

    teardown_test_env
}

# =============================================================================
# Tests: Session ID extraction
# =============================================================================

test_session_start_extracts_session_id() {
    # Check that session-start.sh extracts SESSION_ID
    if grep -q 'SESSION_ID.*jq.*sessionId' "$SCRIPT_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should extract SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Tests: Session-based ultrawork state file reading
# =============================================================================

test_session_start_ignores_other_sessions_ultrawork_state() {
    # Create ultrawork state file for DIFFERENT session
    cat > "$TEST_OMT_DIR/ultrawork-state-other-session.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "other session ultrawork task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    # Run with different sessionId
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Should NOT contain ultrawork mode restored (no state for this session)
    assert_output_not_contains "$output" "ULTRAWORK MODE RESTORED" "Should NOT restore other session's ultrawork state" || return 1
}

test_session_start_no_generic_ultrawork_state() {
    # session-start.sh should NOT use generic ultrawork-state.json (without session ID)
    local non_session_refs=$(grep -E 'ultrawork-state\.json' "$SCRIPT_DIR/session-start.sh" 2>/dev/null | wc -l)
    if [[ "$non_session_refs" -gt 0 ]]; then
        echo "ASSERTION FAILED: session-start.sh should NOT use generic ultrawork-state.json"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: OMT_DIR export and directory creation
# =============================================================================

test_session_start_exports_omt_dir_via_claude_env_file() {
    # session-start.sh should export OMT_DIR into CLAUDE_ENV_FILE
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if grep -q 'export OMT_DIR=' "$env_file"; then
        rm -f "$env_file"
        return 0
    else
        echo "ASSERTION FAILED: CLAUDE_ENV_FILE should contain 'export OMT_DIR='"
        echo "  env_file contents: $(cat "$env_file")"
        rm -f "$env_file"
        return 1
    fi
}

test_session_start_omt_dir_points_under_home_omt() {
    # OMT_DIR exported should be under $HOME/.omt/
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    local exported_omt_dir
    exported_omt_dir=$(grep 'export OMT_DIR=' "$env_file" | sed 's/export OMT_DIR=//' | sed 's/^"//;s/"$//' | head -1)

    rm -f "$env_file"

    if [[ "$exported_omt_dir" == "$TEST_HOME/.omt/"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: OMT_DIR should be under \$HOME/.omt/"
        echo "  Got: '$exported_omt_dir'"
        echo "  Expected prefix: '$TEST_HOME/.omt/'"
        return 1
    fi
}

test_session_start_creates_omt_dir() {
    # session-start.sh should create the OMT_DIR directory
    local env_file
    env_file=$(mktemp)

    # Use a unique project dir so we can predict OMT_DIR
    local proj_dir
    proj_dir=$(mktemp -d)
    mkdir -p "$proj_dir/.git"

    echo '{"cwd": "'"$proj_dir"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    local exported_omt_dir
    exported_omt_dir=$(grep 'export OMT_DIR=' "$env_file" | sed 's/export OMT_DIR=//' | sed 's/^"//;s/"$//' | head -1)

    rm -f "$env_file"
    rm -rf "$proj_dir"

    if [[ -n "$exported_omt_dir" ]] && [[ -d "$exported_omt_dir" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: OMT_DIR directory should be created by session-start.sh"
        echo "  OMT_DIR: '$exported_omt_dir'"
        echo "  Exists: $([ -d "$exported_omt_dir" ] && echo yes || echo no)"
        return 1
    fi
}

# =============================================================================
# Tests: Project root detection - session-start (from hooks/test/project_root_test.sh)
# =============================================================================

test_get_project_root_function_exists_in_session_start() {
    # session-start.sh should define get_project_root function
    if grep -E '^get_project_root\(\)' "$SCRIPT_DIR/session-start.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: get_project_root() should be defined in session-start.sh"
        return 1
    fi
}

test_session_start_uses_project_root_variable() {
    # session-start.sh should set and use PROJECT_ROOT variable
    if grep -q 'PROJECT_ROOT=.*get_project_root' "$SCRIPT_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should set PROJECT_ROOT from get_project_root"
        return 1
    fi
}

# =============================================================================
# Tests: Prometheus restore — resume_summary omitted (cat pointer emitted) when plan file unavailable
# =============================================================================

test_session_start_prometheus_omits_resume_summary_and_emits_pointer_when_plan_unavailable() {
    local sid="test-prometheus-resume"

    # Active prometheus state: resume_summary set, plan_path empty (never written)
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Working on feature X. Next: implement the validation logic in validator.ts."
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # resume_summary is NO LONGER embedded directly — it is recoverable via the cat pointer.
    assert_output_not_contains "$output" "Working on feature X" "resume_summary text must NOT be embedded directly (now via cat pointer)" || return 1
    assert_output_not_contains "$output" "Resume from this bookmark" "PROM_PLAN_NOTE bookmark must NOT appear (orphan removed)" || return 1

    # cat pointer must be present in additionalContext
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain UNEXPANDED cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi
}

test_session_start_prometheus_resume_summary_backslash_produces_valid_json() {
    local sid="test-prometheus-backslash"

    # Active prometheus state: resume_summary with literal backslashes (Windows path + regex)
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "editing C:\\tmp\\plan with regex \\d+"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # (a) stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON when resume_summary contains backslashes"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # (b) resume_summary is NOT embedded directly — recoverable via cat pointer
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'C:\tmp\plan'; then
        echo "ASSERTION FAILED: backslash resume_summary must NOT be embedded directly (now via cat pointer)"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi

    # (c) cat pointer must be present
    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain UNEXPANDED cat pointer"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Goal state restore — planning-resume vs pursuing-resume
# =============================================================================

test_session_start_goal_state_restore_planning_vs_pursuing() {
    local sid_plan="test-goal-planning"
    local sid_pursue="test-goal-pursuing"
    # Use a current timestamp so stale-cleanup does not delete the file before restore runs
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Active goal-state in planning phase
    cat > "$TEST_OMT_DIR/goal-state-${sid_plan}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Defining the outcome and constraints for the goal.",
  "outcome": "Build feature X",
  "iteration": 0,
  "started_at": "${now_ts}"
}
EOF

    local out_plan
    out_plan=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_plan"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must contain GOAL RESTORED
    assert_output_contains "$out_plan" "GOAL RESTORED" "planning: should inject GOAL RESTORED" || return 1
    # Must distinguish planning
    assert_output_contains "$out_plan" "planning" "planning: should include phase label" || return 1
    # Must re-assert re-invocation refusal
    assert_output_contains "$out_plan" "refused" "planning: should assert re-invocation refused" || return 1

    # Active goal-state in pursuing phase
    cat > "$TEST_OMT_DIR/goal-state-${sid_pursue}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "started_at": "${now_ts}"
}
EOF

    local out_pursue
    out_pursue=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_pursue"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must contain GOAL RESTORED
    assert_output_contains "$out_pursue" "GOAL RESTORED" "pursuing: should inject GOAL RESTORED" || return 1
    # Must distinguish pursuing
    assert_output_contains "$out_pursue" "pursuing" "pursuing: should include phase label" || return 1
    # Must re-assert re-invocation refusal
    assert_output_contains "$out_pursue" "refused" "pursuing: should assert re-invocation refused" || return 1
}

test_session_start_stale_goal_state_purged() {
    # Create a goal-state file with last_touched_at older than ACTIVE_IDLE_TTL (6h) — use 7h
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_file="$TEST_OMT_DIR/goal-state-stale-session.json"
    cat > "$stale_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "old goal",
  "iteration": 1
}
EOF

    # Run the hook (GC runs regardless of sessionId; stale-session != fresh-session)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # Stale goal-state file should be removed (age 7h > ACTIVE_IDLE_TTL 6h)
    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: stale goal-state file (7h heartbeat) should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_terminal_goal_state_not_restored() {
    local sid="test-goal-terminal"
    # Use a current timestamp so stale-cleanup does not delete the file;
    # we are testing that active=false suppresses restoration, not that the file is absent.
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Terminal goal-state: active=false, phase=complete
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": false,
  "phase": "complete",
  "plan_path": "",
  "resume_summary": "Goal was completed.",
  "outcome": "Build feature X",
  "iteration": 3,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must NOT inject a goal restore block
    assert_output_not_contains "$output" "GOAL RESTORED" "terminal goal-state must NOT inject GOAL RESTORED" || return 1
}

test_session_start_goal_pursuing_resume_rereads_plan() {
    local sid="test-goal-pursuing-plan"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Create a real plan file on disk so plan_path resolves to an existing file
    local plan_file="$TEST_OMT_DIR/test-goal-plan.md"
    echo "# Test Plan" > "$plan_file"

    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "${plan_file}",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must instruct to re-read the plan
    assert_output_contains "$output" "Re-read the current plan from disk" "pursuing with plan file: should instruct to re-read plan" || return 1
}

test_session_start_goal_pursuing_resume_no_plan_file() {
    local sid="test-goal-pursuing-noplan"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # plan_path is empty — no plan file available
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must NOT instruct to re-read (no plan on disk)
    assert_output_not_contains "$output" "Re-read the current plan from disk" "pursuing without plan file: must NOT inject re-read instruction" || return 1
    # Must still surface iteration info
    assert_output_contains "$output" "GOAL RESTORED" "pursuing without plan file: should still inject GOAL RESTORED" || return 1
}

# Fix B: planning + no plan file → session-invariant guidance text emitted
test_session_start_goal_planning_no_plan_emits_guidance_and_is_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    local sid_a="plan-nofile-sid-alpha"
    local sid_b="plan-nofile-sid-beta"

    # Non-pristine planning states (outcome set) with empty plan_path — no plan file on disk.
    # resume_summary differs between the two sids to prove it is NOT visible in output.
    cat > "$TEST_OMT_DIR/goal-state-${sid_a}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Alpha planning summary - should not appear in output.",
  "outcome": "Build feature X",
  "iteration": 1,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF

    cat > "$TEST_OMT_DIR/goal-state-${sid_b}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Beta planning summary - totally different text.",
  "outcome": "Build feature X",
  "iteration": 1,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Guidance text must be present: new defer-to-read-state wording
    local ctx_a
    ctx_a=$(echo "$out_a" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx_a" | grep -q "from the state you just read"; then
        echo "ASSERTION FAILED: planning+no-plan must emit 'from the state you just read' guidance"
        echo "  ctx_a: ${ctx_a:0:500}"
        return 1
    fi
    if ! echo "$ctx_a" | grep -q "resume_summary"; then
        echo "ASSERTION FAILED: planning+no-plan guidance must reference the 'resume_summary' field"
        echo "  ctx_a: ${ctx_a:0:500}"
        return 1
    fi

    # Regression guard: must NOT contain the old unconditional restart directive
    if echo "$ctx_a" | grep -q "Continue planning from the beginning"; then
        echo "ASSERTION FAILED (regression): planning+no-plan must NOT emit 'Continue planning from the beginning' directive"
        echo "  ctx_a: ${ctx_a:0:500}"
        return 1
    fi

    # Output is session-invariant: byte-identical across two sids with different resume_summary
    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (Fix B): planning+no-plan guidance must be session-invariant (byte-identical across sids)"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
}

test_session_start_goal_plan_path_backslash_produces_valid_json() {
    local sid="test-goal-planpath-backslash"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Active pursuing goal-state with a backslash in plan_path (e.g. Windows-style path).
    # plan_path does NOT exist on disk (so the existence check stays false — we are testing
    # the JSON-escaping code path, not the file-available branch).
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "/tmp/a\\\\plan.md",
  "resume_summary": "checkpoint",
  "outcome": "Test goal",
  "iteration": 1,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # The hook stdout must be valid JSON (parseable by jq)
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON when plan_path contains a backslash"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # The parsed additionalContext must contain GOAL RESTORED
    assert_output_contains "$output" "GOAL RESTORED" "goal plan_path backslash: should inject GOAL RESTORED" || return 1
}

# =============================================================================
# Tests: deep-interview stale-cleanup (glob + mtime fallback)
# =============================================================================

test_session_start_stale_deep_interview_with_started_at_purged() {
    # AC: deep-interview with last_touched_at older than ACTIVE_IDLE_TTL (6h) is removed — use 7h
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_file="$TEST_OMT_DIR/deep-interview-active-state-stale-di.json"
    cat > "$stale_file" << EOF
{
  "active": true,
  "sessionId": "stale-di",
  "last_touched_at": "${stale_ts}"
}
EOF

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: stale deep-interview marker (7h heartbeat) should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_stale_deep_interview_no_started_at_purged_via_mtime() {
    # AC: timestamp-less deep-interview marker with mtime older than ACTIVE_IDLE_TTL (6h) is removed — use 7h
    local stale_file="$TEST_OMT_DIR/deep-interview-active-state-mtime-di.json"
    printf '{"active":true,"sessionId":"mtime-di"}' > "$stale_file"

    # Set mtime to 7 hours ago (BSD: touch -t YYYYmmddHHMM; GNU: touch -d)
    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$stale_file" 2>/dev/null || touch -d "7 hours ago" "$stale_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: timestamp-less deep-interview marker with 7h mtime should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_fresh_deep_interview_marker_survives() {
    # AC: fresh deep-interview marker (mtime now) is NOT removed
    local fresh_file="$TEST_OMT_DIR/deep-interview-active-state-fresh-di.json"
    printf '{"active":true,"sessionId":"fresh-di"}' > "$fresh_file"
    # mtime is already "now" — no touch needed

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$fresh_file" ]; then
        echo "ASSERTION FAILED: fresh deep-interview marker should survive cleanup but was removed"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: GC liveness unification (TODO 7)
# New TTL semantics: is_state_live via hooks/lib/state-liveness.sh
# ACTIVE_IDLE_TTL=6h, TERMINAL_TTL=30m (see state-liveness.sh for exact values)
# =============================================================================

# C2: current session's active state with 7h-old heartbeat SURVIVES (never reap own session)
test_gc_current_session_active_7h_idle_survives() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local sid="current-gc-session"
    local state_file="$TEST_OMT_DIR/goal-state-${sid}.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "live goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: current session's active state should survive GC even with 7h-old heartbeat"
        return 1
    fi
    return 0
}

# C1: other-session active with fresh 5m heartbeat SURVIVES
test_gc_other_session_active_fresh_heartbeat_survives() {
    local fresh_ts
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local state_file="$TEST_OMT_DIR/goal-state-other-session-A.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "live goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "session-B"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: other-session active state with 5m heartbeat should survive GC"
        return 1
    fi
    return 0
}

# C3a: other-session active with 7h-old heartbeat is REAPED
test_gc_other_session_active_7h_idle_reaped() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local state_file="$TEST_OMT_DIR/goal-state-other-session-stale.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "session-B"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ -f "$state_file" ]; then
        echo "ASSERTION FAILED: other-session active state with 7h heartbeat should be reaped"
        return 1
    fi
    return 0
}

# C3b part1: terminal state with 1h-old heartbeat is REAPED
test_gc_terminal_state_1h_old_reaped() {
    local old_ts
    old_ts=$(date -j -v-1H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "1 hour ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local state_file="$TEST_OMT_DIR/prometheus-state-terminal-old.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${old_ts}"
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "any-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ -f "$state_file" ]; then
        echo "ASSERTION FAILED: terminal state with 1h heartbeat should be reaped (TERMINAL_TTL=30m)"
        return 1
    fi
    return 0
}

# C3b part2: terminal state with 10m-old heartbeat is KEPT
test_gc_terminal_state_10m_old_kept() {
    local fresh_ts
    fresh_ts=$(date -j -v-10M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "10 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local state_file="$TEST_OMT_DIR/prometheus-state-terminal-fresh.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${fresh_ts}"
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "any-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: terminal state with 10m heartbeat should survive GC (TERMINAL_TTL=30m)"
        return 1
    fi
    return 0
}

# C6: in-use terminal goal with 10m heartbeat SURVIVES — no carve-out code
test_gc_terminal_goal_fresh_heartbeat_survives_no_carveout() {
    local fresh_ts
    fresh_ts=$(date -j -v-10M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "10 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local sid="terminal-goal-sid"
    local state_file="$TEST_OMT_DIR/goal-state-${sid}.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${fresh_ts}",
  "outcome": "Build feature X",
  "iteration": 3
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "other-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: in-use terminal goal with fresh heartbeat should survive without carve-out code"
        return 1
    fi
    # Verify no suppress/baseline branch in session-start.sh
    if grep -qiE 'suppress|baseline' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 suppress/baseline references"
        return 1
    fi
    return 0
}

# glob: the GC for-loop glob must only include exactly the 3 managed prefixes
test_gc_glob_only_managed_prefixes() {
    # Extract lines between "# GC:" marker and the first "# Check for active" block.
    # Then pull the glob prefix names from lines matching the OMT_DIR pattern.
    local gc_section glob_lines glob_count
    gc_section=$(awk '/^# GC:/{found=1} found && /^# Check for active (prometheus|goal)/{found=0} found{print}' "$SCRIPT_DIR/session-start.sh")

    # Extract lines that reference "$OMT_DIR"/<prefix>-*.json
    glob_lines=$(echo "$gc_section" | grep -oE '"?\$\{?OMT_DIR\}?"?/[a-z-]+-\*\.json')
    glob_count=$(echo "$glob_lines" | grep -c '.' 2>/dev/null || true)

    # Exact-set assertion: must be exactly 4 globs
    if [ "$glob_count" -ne 4 ]; then
        echo "ASSERTION FAILED: GC glob must have exactly 4 entries, found $glob_count"
        echo "  Glob lines:"
        echo "$glob_lines"
        echo "  Full GC section:"
        echo "$gc_section" | head -20
        return 1
    fi

    # Each expected prefix must appear exactly once
    local prefix
    for prefix in goal-state prometheus-state deep-interview-active-state qa-state; do
        local count
        count=$(echo "$glob_lines" | grep -c "$prefix" 2>/dev/null || true)
        if [ "$count" -ne 1 ]; then
            echo "ASSERTION FAILED: GC glob must contain '$prefix' exactly once, found $count"
            echo "  Glob lines: $glob_lines"
            return 1
        fi
    done

    # Deny-list: the historically removed ralph-state prefix (git af4dff6) must be absent
    if echo "$gc_section" | grep -q 'ralph-state'; then
        echo "ASSERTION FAILED: session-start.sh GC glob must NOT include ralph-state (retired)"
        grep -n 'ralph-state' "$SCRIPT_DIR/session-start.sh" | head -5
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: Retired-loop removal (TODO 10)
# =============================================================================

# G4: orphan-accept — a pre-existing unmanaged state file causes no crash;
# session-start exits 0 and emits no unexpected restore context.
# Uses an unknown-prefix state file to simulate an orphaned legacy state.
test_session_start_orphan_accept_unmanaged_state() {
    # Create a state file with an unknown prefix (simulates legacy orphan)
    cat > "$TEST_OMT_DIR/legacy-loop-state-orphan-abc.json" << 'EOF'
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "prompt": "orphaned task"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "live-session-xyz"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Must exit 0 (captured via subshell — check for valid JSON as proxy)
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook output must be valid JSON (exit 0 proxy)"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # Must NOT emit any restore context for this unknown prefix
    assert_output_not_contains "$output" "LEGACY-LOOP" "orphan unmanaged state must NOT produce an unexpected restore block" || return 1

    # File must remain untouched (orphan-accept: no migration)
    if [ ! -f "$TEST_OMT_DIR/legacy-loop-state-orphan-abc.json" ]; then
        echo "ASSERTION FAILED: orphan state file should be left untouched (not deleted)"
        return 1
    fi

    return 0
}

# grep-0: session-start.sh must contain zero retired-loop restore references
test_session_start_no_retired_loop_restore() {
    # Guard against re-introducing the ralph-loop restore block (git af4dff6 lines 99-115).
    # Real historical tokens: ralph-state (file prefix) and [RALPH LOOP RESTORED] (restore banner).
    if grep -qiE 'ralph-state|LOOP RESTORED' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 ralph-loop restore references"
        grep -niE 'ralph-state|LOOP RESTORED' "$SCRIPT_DIR/session-start.sh" | head -10
        return 1
    fi
    return 0
}

# old-threshold-gone: STALE_THRESHOLD / 10800 must not appear
test_gc_old_threshold_constants_removed() {
    if grep -qE '10800|STALE_THRESHOLD' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must not contain STALE_THRESHOLD or 10800"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Pristine goal-state is invisible to session-start restore
# A pristine seed (phase=planning, iteration=0, outcome="") must NOT produce
# [GOAL RESTORED]; a non-pristine active state must still be restored.
# =============================================================================

test_session_start_pristine_goal_state_not_restored() {
    local sid="test-goal-pristine"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Pristine seed: phase=planning, iteration=0, outcome="" — the PreToolUse hook
    # seeded this before the goal skill ran; if the skill refuses, this file lingers.
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "outcome": "",
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Pristine seed must NOT produce GOAL RESTORED
    assert_output_not_contains "$output" "GOAL RESTORED" "pristine goal-state must NOT inject GOAL RESTORED" || return 1
}

test_session_start_non_pristine_planning_goal_still_restored() {
    local sid="test-goal-nonpristine"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Non-pristine: outcome is set — this is a real in-progress goal.
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "outcome": "ship feature X",
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Non-pristine planning state must still produce GOAL RESTORED
    assert_output_contains "$output" "GOAL RESTORED" "non-pristine planning goal-state must inject GOAL RESTORED" || return 1
}

test_session_start_pristine_goal_absent_outcome_not_restored() {
    # outcome field entirely absent (jq .outcome returns null) → treated as "" → pristine → not restored
    local sid="test-goal-pristine-absent-outcome"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    assert_output_not_contains "$output" "GOAL RESTORED" "pristine goal-state (absent outcome) must NOT inject GOAL RESTORED" || return 1
}

# =============================================================================
# Tests: encoding invariants (retained across the TODO 8 handoff removal)
# =============================================================================

# AC-T2.5: source grep — the restore sed encoder line is present and unmodified,
# the per-field escapers at the historical lines are unchanged, and the handoff
# is encoded via jq -Rs.
test_session_start_encoder_invariants_in_source() {
    # Restore encoder present and unmodified
    if ! grep -qF "MESSAGES_ESCAPED=\$(echo \"\$MESSAGES\" | sed 's/\"/\\\\\"/g')" "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: restore sed encoder line missing or modified"
        grep -n "MESSAGES_ESCAPED=" "$SCRIPT_DIR/session-start.sh"
        return 1
    fi

    # Exactly 0 per-field backslash escapers: PROM_RESUME, GOAL_RESUME, GOAL_PLAN_PATH
    # are no longer embedded in MESSAGES — all 3 escapers have been removed (cache-safe TODO 3).
    local escaper_count
    escaper_count=$(grep -cF "sed 's/\\\\/\\\\\\\\/g'" "$SCRIPT_DIR/session-start.sh" 2>/dev/null || true)
    if [ "$escaper_count" -ne 0 ]; then
        echo "ASSERTION FAILED: expected 0 per-field backslash escapers after cache-safe refactor, found $escaper_count"
        grep -n "sed 's/\\\\" "$SCRIPT_DIR/session-start.sh"
        return 1
    fi

    # Handoff is encoded via jq -Rs
    if ! grep -qE 'jq -Rs' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: handoff must be encoded via 'jq -Rs'"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Cache-safe restore — TODO 3 (AC2a–AC6)
# session-start.sh must emit UNEXPANDED literal cat pointers so the SessionStart
# additionalContext block is session-invariant and cache-safe.
# =============================================================================

# Shared sentinel state helpers — use fresh timestamps so GC does not reap other-session files
_write_prom_sentinel_state() {
    local sid="$1"
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "S3",
  "plan_path": "/SENTINEL_PP_zzqqxx/plan.md",
  "resume_summary": "SENTINEL_RS_zzqqxx",
  "started_at": "${ts}",
  "last_touched_at": "${ts}",
  "steps": {"acceptance_criteria": {"done": false, "content": [], "recorded_at": ""}, "design_decisions": {"done": false, "ref": ""}, "plan": {"done": false}}
}
EOF
}

_write_goal_sentinel_state() {
    local sid="$1"
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "/SENTINEL_PP_zzqqxx/plan.md",
  "resume_summary": "SENTINEL_RS_zzqqxx",
  "outcome": "Test objective",
  "iteration": 3,
  "max_iterations": 10,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF
}

# AC2a: plan_path and resume_summary sentinels must NOT appear in prometheus stdout
test_cache_safe_prom_sentinel_not_in_stdout() {
    local sid="prom-sentinel-zzqqxx"
    _write_prom_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local pp_count rs_count
    pp_count=$(echo "$output" | grep -c "SENTINEL_PP_zzqqxx" 2>/dev/null || true)
    rs_count=$(echo "$output" | grep -c "SENTINEL_RS_zzqqxx" 2>/dev/null || true)

    if [ "${pp_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC2a): plan_path sentinel must not appear in stdout (count=$pp_count)"
        return 1
    fi
    if [ "${rs_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC2a): resume_summary sentinel must not appear in stdout (count=$rs_count)"
        return 1
    fi
}

# AC2b: prometheus stdout contains UNEXPANDED cat pointer + run-now imperative;
#        static instruction and PROM_PLAN_AVAILABLE branch retained;
#        orphan PROM_PLAN_NOTE removed from source.
test_cache_safe_prom_pointer_and_imperative() {
    local sid="prom-ptr-zzqqxx"
    _write_prom_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2b): hook stdout must be valid JSON"
        echo "  output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly 1 UNEXPANDED cat pointer
    local ptr_count
    ptr_count=$(echo "$ctx" | grep -cF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"' 2>/dev/null || true)
    if [ "${ptr_count:-0}" -ne 1 ]; then
        echo "ASSERTION FAILED (AC2b): additionalContext should contain exactly 1 cat pointer (found ${ptr_count:-0})"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # run-now imperative
    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now|before resuming'; then
        echo "ASSERTION FAILED (AC2b): additionalContext should contain run-now imperative"
        return 1
    fi

    # Static instruction retained
    if ! echo "$ctx" | grep -q "PROMETHEUS RESTORED"; then
        echo "ASSERTION FAILED (AC2b): PROMETHEUS RESTORED header must be retained"
        return 1
    fi

    # PROM_PLAN_AVAILABLE=true branch works: create a real plan file and verify instruction fires
    local plan_file="$TEST_OMT_DIR/test-prom-plan.md"
    echo "# Plan" > "$plan_file"
    local sid2="prom-ptr-planok"
    local ts2
    ts2=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/prometheus-state-${sid2}.json" << EOF
{
  "active": true,
  "phase": "S4",
  "plan_path": "${plan_file}",
  "resume_summary": "checkpoint",
  "started_at": "${ts2}",
  "last_touched_at": "${ts2}",
  "steps": {"acceptance_criteria": {"done": false, "content": [], "recorded_at": ""}, "design_decisions": {"done": false, "ref": ""}, "plan": {"done": false}}
}
EOF
    local out2
    out2=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid2"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    local ctx2
    ctx2=$(echo "$out2" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx2" | grep -q "Re-read the current plan from disk and distrust stored verdicts"; then
        echo "ASSERTION FAILED (AC2b): PROM_PLAN_AVAILABLE=true branch must emit re-read instruction"
        echo "  ctx2: ${ctx2:0:600}"
        return 1
    fi

    # PROM_PLAN_NOTE orphan removed from source
    if grep -q 'PROM_PLAN_NOTE' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED (AC2b): PROM_PLAN_NOTE must be removed from session-start.sh source"
        return 1
    fi
}

# AC2c: round-trip — source hook-produced CLAUDE_ENV_FILE, execute emitted cat, recover fields
test_cache_safe_prom_round_trip() {
    local sid="prom-rt-zzqqxx"
    _write_prom_sentinel_state "$sid"

    # (pre) stdout must be valid JSON
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2c-pre): hook stdout must be valid JSON"
        return 1
    fi

    # Run with TEMP CLAUDE_ENV_FILE (hook-produced, NOT a test self-export)
    local tmp_env
    tmp_env=$(mktemp)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | CLAUDE_ENV_FILE="$tmp_env" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # Source hook-produced file (not a test self-export)
    # shellcheck source=/dev/null
    source "$tmp_env"
    rm -f "$tmp_env"

    # Execute the emitted cat and verify fields are recoverable
    local state_out
    state_out=$(cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json" 2>/dev/null) || true
    if ! echo "$state_out" | jq -e '.plan_path,.resume_summary' > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2c): round-trip cat must recover plan_path and resume_summary (non-empty)"
        echo "  state_out: ${state_out:0:300}"
        return 1
    fi
}

# AC3a: goal plan_path, resume_summary, iteration sentinels must NOT appear in stdout
test_cache_safe_goal_sentinel_not_in_stdout() {
    local sid="goal-sentinel-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local pp_count rs_count
    pp_count=$(echo "$output" | grep -c "SENTINEL_PP_zzqqxx" 2>/dev/null || true)
    rs_count=$(echo "$output" | grep -c "SENTINEL_RS_zzqqxx" 2>/dev/null || true)

    if [ "${pp_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC3a): goal plan_path sentinel must not appear in stdout (count=$pp_count)"
        return 1
    fi
    if [ "${rs_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC3a): goal resume_summary sentinel must not appear in stdout (count=$rs_count)"
        return 1
    fi

    # No iteration digit pattern
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if echo "$ctx" | grep -qE 'Iteration:? *[0-9]+/[0-9]+'; then
        echo "ASSERTION FAILED (AC3a): iteration digit pattern must not appear in stdout"
        return 1
    fi
}

# AC3b: goal cat pointer + run-now; retained sentences; GOAL_PLAN_AVAILABLE branch.
#        Must NOT introduce new "Invoke the goal skill" imperative.
test_cache_safe_goal_pointer_and_imperative() {
    local sid="goal-ptr-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3b): hook stdout must be valid JSON"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly 1 UNEXPANDED cat pointer
    local ptr_count
    ptr_count=$(echo "$ctx" | grep -cF 'cat "$OMT_DIR/goal-state-$OMT_SESSION_ID.json"' 2>/dev/null || true)
    if [ "${ptr_count:-0}" -ne 1 ]; then
        echo "ASSERTION FAILED (AC3b): additionalContext should contain exactly 1 goal cat pointer (found ${ptr_count:-0})"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # run-now imperative
    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now|before resuming'; then
        echo "ASSERTION FAILED (AC3b): additionalContext should contain run-now imperative"
        return 1
    fi

    # "Continue pursuing the objective autonomously" retained
    if ! echo "$ctx" | grep -q "Continue pursuing the objective autonomously"; then
        echo "ASSERTION FAILED (AC3b): 'Continue pursuing the objective autonomously' must be retained"
        return 1
    fi

    # "refused" sentence retained (distinct substring)
    if ! echo "$ctx" | grep -q "refused"; then
        echo "ASSERTION FAILED (AC3b): re-invocation refused sentence must be retained"
        return 1
    fi

    # GOAL RESTORED retained
    if ! echo "$ctx" | grep -q "GOAL RESTORED"; then
        echo "ASSERTION FAILED (AC3b): GOAL RESTORED header must be retained"
        return 1
    fi

    # No new "Invoke the goal skill" imperative (D-4)
    if echo "$ctx" | grep -qiE 'invoke the goal skill|run the goal skill|restart.*goal'; then
        echo "ASSERTION FAILED (AC3b/D-4): must NOT introduce a new 'Invoke the goal skill' imperative"
        return 1
    fi

    # GOAL_PLAN_AVAILABLE=true branch works
    local plan_file="$TEST_OMT_DIR/test-goal-plan.md"
    echo "# Plan" > "$plan_file"
    local sid2="goal-ptr-planok"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/goal-state-${sid2}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "${plan_file}",
  "resume_summary": "checkpoint",
  "outcome": "Test objective",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF
    local out2
    out2=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid2"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    local ctx2
    ctx2=$(echo "$out2" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx2" | grep -q "Re-read the current plan from disk before continuing"; then
        echo "ASSERTION FAILED (AC3b): GOAL_PLAN_AVAILABLE=true branch must emit re-read instruction"
        echo "  ctx2: ${ctx2:0:600}"
        return 1
    fi
}

# AC3c: goal round-trip via sourced CLAUDE_ENV_FILE
test_cache_safe_goal_round_trip() {
    local sid="goal-rt-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3c-pre): hook stdout must be valid JSON"
        return 1
    fi

    local tmp_env
    tmp_env=$(mktemp)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | CLAUDE_ENV_FILE="$tmp_env" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # shellcheck source=/dev/null
    source "$tmp_env"
    rm -f "$tmp_env"

    local state_out
    state_out=$(cat "$OMT_DIR/goal-state-$OMT_SESSION_ID.json" 2>/dev/null) || true
    if ! echo "$state_out" | jq -e '.plan_path,.resume_summary,.iteration' > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3c): round-trip cat must recover plan_path, resume_summary, iteration"
        echo "  state_out: ${state_out:0:300}"
        return 1
    fi
}

# AC4: INCOMPLETE_COUNT 7 vs 3 → pending block byte-identical, no digit
test_cache_safe_incomplete_count_existence_only() {
    local todos_dir="$TEST_HOME/.claude/todos"
    mkdir -p "$todos_dir"

    # 7 incomplete tasks
    printf '[{"id":"1","status":"pending"},{"id":"2","status":"pending"},{"id":"3","status":"pending"},{"id":"4","status":"pending"},{"id":"5","status":"pending"},{"id":"6","status":"pending"},{"id":"7","status":"pending"}]' \
        > "$todos_dir/test-todos.json"

    local out_7
    out_7=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "count-test"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # 3 incomplete tasks (same file, different count)
    printf '[{"id":"1","status":"pending"},{"id":"2","status":"pending"},{"id":"3","status":"pending"}]' \
        > "$todos_dir/test-todos.json"

    local out_3
    out_3=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "count-test"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Byte-identical outputs
    if [ "$out_7" != "$out_3" ]; then
        echo "ASSERTION FAILED (AC4): incomplete task count should produce byte-identical output for 7 vs 3"
        echo "  out_7: ${out_7:0:300}"
        echo "  out_3: ${out_3:0:300}"
        return 1
    fi

    # Pending block is present
    local ctx
    ctx=$(echo "$out_7" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -q "PENDING TASKS DETECTED"; then
        echo "ASSERTION FAILED (AC4): PENDING TASKS DETECTED block must be present"
        return 1
    fi

    # No digit in the message
    if echo "$ctx" | grep -qE 'have [0-9]+ incomplete'; then
        echo "ASSERTION FAILED (AC4): pending message must not contain a digit count"
        return 1
    fi
}

# AC6: prometheus restore output is byte-identical across two different session IDs,
# even when resume_summary differs — proving resume_summary is not embedded in output.
test_cache_safe_prom_session_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")

    local sid_a="aaaa-session-inv"
    local sid_b="zzqqxx-session-inv"

    # Different resume_summary per sid: if resume_summary were still embedded, outputs would differ.
    echo '{"active":true,"phase":"S3","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_alpha","started_at":"'"$ts"'","last_touched_at":"'"$ts"'","steps":{"acceptance_criteria":{"done":false,"content":[],"recorded_at":""},"design_decisions":{"done":false,"ref":""},"plan":{"done":false}}}' \
        > "$TEST_OMT_DIR/prometheus-state-${sid_a}.json"
    echo '{"active":true,"phase":"S3","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_beta","started_at":"'"$ts"'","last_touched_at":"'"$ts"'","steps":{"acceptance_criteria":{"done":false,"content":[],"recorded_at":""},"design_decisions":{"done":false,"ref":""},"plan":{"done":false}}}' \
        > "$TEST_OMT_DIR/prometheus-state-${sid_b}.json"

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (AC6-prom): prometheus restore output must be byte-identical across session IDs"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
}

# AC6: goal restore output is byte-identical across two different session IDs,
# even when resume_summary differs — proving resume_summary is not embedded in output.
test_cache_safe_goal_session_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")

    local sid_a="aaaa-goal-inv"
    local sid_b="zzqqxx-goal-inv"

    # Different resume_summary per sid: if resume_summary were still embedded, outputs would differ.
    echo '{"active":true,"phase":"pursuing","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_alpha","outcome":"Test objective","iteration":3,"max_iterations":10,"started_at":"'"$ts"'","last_touched_at":"'"$ts"'"}' \
        > "$TEST_OMT_DIR/goal-state-${sid_a}.json"
    echo '{"active":true,"phase":"pursuing","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_beta","outcome":"Test objective","iteration":3,"max_iterations":10,"started_at":"'"$ts"'","last_touched_at":"'"$ts"'"}' \
        > "$TEST_OMT_DIR/goal-state-${sid_b}.json"

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (AC6-goal): goal restore output must be byte-identical across session IDs"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
}

# =============================================================================
# Tests: Ledger recording instruction — plan TODO 3 (D2/D3)
# Every session, regardless of source, session-start.sh must inject a static
# reminder that decisions/corrections/next-steps get appended to the durable
# session ledger via omt-ledger.sh AS THEY HAPPEN, with a verbatim mandate for
# user corrections. No fixtures needed -- this must fire on a bare session.
# =============================================================================

# AC-T3.1: fresh session (no state fixtures at all), for every source value,
# emits the ledger recording instruction + both omt-ledger call examples.
test_session_start_ledger_recording_every_source() {
    local src
    for src in startup resume compact clear; do
        local output
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-src-test", "source": "'"$src"'"}' \
            | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

        if ! echo "$output" | jq -e . > /dev/null 2>&1; then
            echo "ASSERTION FAILED: source=$src stdout must be valid JSON"
            echo "  Output: ${output:0:500}"
            return 1
        fi

        local ctx
        ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

        if ! echo "$ctx" | grep -qF 'LEDGER RECORDING'; then
            echo "ASSERTION FAILED: source=$src must emit the LEDGER RECORDING instruction"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
        if ! echo "$ctx" | grep -qF 'omt-ledger.sh" append'; then
            echo "ASSERTION FAILED: source=$src must include an omt-ledger.sh append call example"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
        if ! echo "$ctx" | grep -qF 'omt-ledger.sh" now'; then
            echo "ASSERTION FAILED: source=$src must include an omt-ledger.sh now call example"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
    done
    return 0
}

# AC-T3.2: the instruction names the verbatim mandate for user corrections (D3) --
# grep for the substance, not exact wording.
test_session_start_ledger_recording_verbatim_mandate() {
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-verbatim-test"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qiF 'verbatim'; then
        echo "ASSERTION FAILED: ledger recording instruction must mandate verbatim correction capture"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qiF 'paraphrase'; then
        echo "ASSERTION FAILED: ledger recording instruction must forbid paraphrasing corrections"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC-T3.3: session-varying values must never leak into the recording instruction --
# raw session ID absent, and the pointer vars stay UNEXPANDED literal text.
test_session_start_ledger_recording_is_static() {
    local sid="ledger-static-zzqqxx"
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF "$sid"; then
        echo "ASSERTION FAILED: ledger recording instruction must not leak the raw session id"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '$OMT_SESSION_ID'; then
        echo "ASSERTION FAILED: ledger recording instruction must reference the UNEXPANDED \$OMT_SESSION_ID pointer"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC-T3.4 (PR #162 Codex finding B, P2): the omt-ledger.sh call examples must be
# rooted via the CLAUDE_PROJECT_DIR/HOME literal, not a bare cwd-relative path --
# a bare `.claude/hooks/omt-ledger.sh` breaks when Claude is launched from a
# project subdirectory. The rooted literal must stay UNEXPANDED (cache-safe:
# no machine-specific /Users or /home path leaks into the injected prefix).
test_session_start_ledger_recording_rooted_path() {
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-rooted-test"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF ' | .claude/hooks/omt-ledger.sh'; then
        echo "ASSERTION FAILED: omt-ledger.sh call examples must not use the bare cwd-relative path"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh'; then
        echo "ASSERTION FAILED: omt-ledger.sh call examples must be rooted via the unexpanded CLAUDE_PROJECT_DIR/HOME literal"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" append Decisions'; then
        echo "ASSERTION FAILED: rooted append-Decisions example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" append Pending'; then
        echo "ASSERTION FAILED: rooted append-Pending example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" now'; then
        echo "ASSERTION FAILED: rooted now example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if echo "$ctx" | grep -qE '/Users/|/home/'; then
        echo "ASSERTION FAILED: rooted path must stay unexpanded -- no machine-specific /Users or /home path may leak into the injected prefix"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ledger recovery option D — plan TODO 4 (D1)
# source==compact AND a session ledger exists on disk -> inline ONLY the acute
# sections (## Now, ## User Corrections (verbatim)) into additionalContext;
# bulk sections (Decisions/Pending/Pointers/Learnings) get a pointer+instruction,
# never inline content. Supersedes the removed handoff-inline mechanism (TODO 8).
# =============================================================================

# AC: source=compact + ledger with content in every section -> Now and
# Corrections are inlined, the 4 bulk sections are NOT, and the bulk cat
# pointer is present.
test_session_start_ledger_recovery_inlines_now_and_corrections() {
    local sid="ledger-recovery-positive"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_SENTINEL_q1w2e3

## Decisions
DECISIONS_SENTINEL_should_not_appear

## User Corrections (verbatim)
CORR_SENTINEL_a1b2c3

## Pending
PENDING_SENTINEL_should_not_appear

## Pointers
POINTERS_SENTINEL_should_not_appear

## Learnings
LEARNINGS_SENTINEL_should_not_appear
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: ledger-recovery stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'NOW_SENTINEL_q1w2e3'; then
        echo "ASSERTION FAILED: additionalContext must inline the ## Now section content"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF 'CORR_SENTINEL_a1b2c3'; then
        echo "ASSERTION FAILED: additionalContext must inline the ## User Corrections (verbatim) section content"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    local bulk_sentinel
    for bulk_sentinel in DECISIONS_SENTINEL_should_not_appear PENDING_SENTINEL_should_not_appear POINTERS_SENTINEL_should_not_appear LEARNINGS_SENTINEL_should_not_appear; do
        if echo "$ctx" | grep -qF "$bulk_sentinel"; then
            echo "ASSERTION FAILED: bulk section content ($bulk_sentinel) must NOT be inlined"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
    done

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"'; then
        echo "ASSERTION FAILED: additionalContext must contain the ledger cat pointer for the bulk sections"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC: source=compact, no ledger file on disk -> harmless, no inline block, valid JSON.
test_session_start_ledger_recovery_no_ledger_harmless() {
    local sid="ledger-recovery-noledger"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: source=compact with no ledger must still produce valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'LEDGER RECOVERY'; then
        echo "ASSERTION FAILED: no ledger file present, the LEDGER RECOVERY block must not appear"
        return 1
    fi
    return 0
}

# AC: acute (## Now + ## User Corrections) content over the 7000-char inline
# cap -> NOT inlined; the bulk cat pointer is emitted as the fallback instead.
test_session_start_ledger_recovery_acute_over_cap_pointer_fallback() {
    local sid="ledger-acute-overcap"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    local big_now
    big_now=$(python3 -c "print('x' * 7200)" 2>/dev/null) || true
    if [ -z "$big_now" ]; then
        big_now=$(yes x 2>/dev/null | tr -d '\n' | head -c 7200)
    fi

    {
        echo "## Now"
        echo "BIGNOW_SENTINEL_${big_now}"
        echo ""
        echo "## Decisions"
        echo "## User Corrections (verbatim)"
        echo "## Pending"
        echo "## Pointers"
        echo "## Learnings"
    } > "$ledger_file"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: acute-over-cap stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'BIGNOW_SENTINEL'; then
        echo "ASSERTION FAILED: acute content over the 7000-char cap must NOT be inlined"
        return 1
    fi

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"'; then
        echo "ASSERTION FAILED: acute-over-cap must fall back to the ledger cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi
    return 0
}

# AC: recovery D only fires when source==compact; other sources with the SAME
# ledger fixture present must never inline its content.
test_session_start_ledger_recovery_only_on_compact_source() {
    local sid="ledger-recovery-noncompact"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_ONLY_COMPACT_SENTINEL

## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local src
    for src in startup resume clear; do
        local output
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "'"$src"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

        if echo "$output" | grep -qF 'NOW_ONLY_COMPACT_SENTINEL'; then
            echo "ASSERTION FAILED: source=$src must NOT trigger ledger recovery inline"
            return 1
        fi
    done
    return 0
}

# AC (F1 regression): acute section content that itself contains a `## `
# markdown line must survive recovery inline in full. The extractor must treat
# ONLY the 6 known skeleton headers as section boundaries, not any `## ` line,
# otherwise a subheader inside a Now/Corrections summary silently truncates the
# inline at that line -- defeating the whole point of option D (acute inlined so
# it survives compaction).
test_session_start_ledger_recovery_preserves_hash_line_in_acute() {
    local sid="ledger-recovery-hashline"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
Working on the recovery bug.
## Investigation notes
POST_SUBHEADER_SENTINEL_must_survive
## Decisions
DECISIONS_SENTINEL_should_not_appear
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'POST_SUBHEADER_SENTINEL_must_survive'; then
        echo "ASSERTION FAILED: Now content after an inner '## ' line must survive recovery inline (not be truncated)"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    # The real Decisions content is a bulk section and must still be excluded.
    if echo "$ctx" | grep -qF 'DECISIONS_SENTINEL_should_not_appear'; then
        echo "ASSERTION FAILED: bulk Decisions content must not leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC (S5 regression): a bulk section (Decisions) whose content contains a line
# equal to a real acute header (`## Now`) must NOT have that injected content
# extracted into the acute inline. Structural section identity, not substring.
test_session_start_ledger_recovery_no_header_injection_from_bulk() {
    local sid="ledger-recovery-inject"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
REAL_NOW_SENTINEL
## Decisions
real decision
## Now
INJECTED_FROM_BULK_should_not_appear
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'REAL_NOW_SENTINEL'; then
        echo "ASSERTION FAILED: the real Now content must be inlined"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qF 'INJECTED_FROM_BULK_should_not_appear'; then
        echo "ASSERTION FAILED: a '## Now' line injected inside a bulk section must NOT leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Test (PR #162 P2 regression): a Now-section content line that collides with
# a skeleton header string is written to disk ESCAPED by omt-ledger.sh (one
# "OMT_ESC::" sentinel prefix -- see hooks/omt-ledger.sh). The recovery reader
# here must unescape exactly that sentinel back off KEPT acute content lines,
# so the literal "## Decisions" line survives, in order, between its
# neighbors -- Now is fully inlined, not truncated -- while a real bulk
# section is still excluded and no raw sentinel leaks into the output.
# =============================================================================

test_session_start_ledger_recovery_unescapes_header_collision_content() {
    local sid="ledger-recovery-escaped-collision"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_A
OMT_ESC::## Decisions
NOW_B
## Decisions
REAL_BULK_DECISION_SHOULD_NOT_APPEAR
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Now must be fully inlined, unescaped, and in order: NOW_A, then the bare
    # (unescaped) "## Decisions" line, then NOW_B -- no truncation.
    local now_lines
    now_lines=$(echo "$ctx" | awk '/^NOW_A$/{f=1} f{print} /^NOW_B$/{f=0}')
    local expected
    expected=$'NOW_A\n## Decisions\nNOW_B'
    if [ "$now_lines" != "$expected" ]; then
        echo "ASSERTION FAILED: Now section must inline NOW_A, an unescaped '## Decisions' content line, then NOW_B, in order"
        echo "  expected: ${expected}"
        echo "  got: ${now_lines}"
        return 1
    fi

    # The raw sentinel must never leak into additionalContext.
    if echo "$ctx" | grep -qF 'OMT_ESC::'; then
        echo "ASSERTION FAILED: the raw escape sentinel must never leak into additionalContext"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # The real bulk Decisions section must still be excluded from the inline.
    if echo "$ctx" | grep -qF 'REAL_BULK_DECISION_SHOULD_NOT_APPEAR'; then
        echo "ASSERTION FAILED: bulk Decisions content must not leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Test (double-escape round-trip, reader half): a content line double-escaped
# by the writer (two sentinels, because the user's literal text already
# looked like one sentinel + header) must have exactly ONE sentinel stripped
# on recovery -- restoring the user's original one-sentinel text exactly, not
# fully unescaped and not left with both sentinels.
# =============================================================================

test_session_start_ledger_recovery_double_escape_round_trip() {
    local sid="ledger-recovery-double-escape"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
OMT_ESC::OMT_ESC::## Decisions
## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly one sentinel must remain -- this is the round-trip of the
    # user's original (already sentinel-shaped) literal content.
    local match_count
    match_count=$(echo "$ctx" | grep -cxF 'OMT_ESC::## Decisions')
    if [ "$match_count" -ne 1 ]; then
        echo "ASSERTION FAILED: double-escaped content must recover to exactly one remaining sentinel + header line, found $match_count"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qxF 'OMT_ESC::OMT_ESC::## Decisions'; then
        echo "ASSERTION FAILED: both sentinels must not survive recovery (only one must be stripped)"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qxF '## Decisions'; then
        echo "ASSERTION FAILED: the line must not be fully unescaped to bare '## Decisions' -- it was double-escaped, so exactly one sentinel must remain"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ledger GC — mtime-based (TODO 5)
# session-ledger-*.md files are durable-append .md, so liveness cannot use
# is_state_live (JSON .active parsing). GC is mtime-only, TTL=ACTIVE_IDLE_TTL
# (6h, state-liveness.sh SSOT). The current session's ledger is always kept
# regardless of mtime (mirrors the sid-skip pattern from state-GC).
# =============================================================================

# AC: non-current-sid ledger with mtime >6h old is reaped.
test_gc_ledger_other_session_stale_reaped() {
    local sid="ledger-gc-other-stale"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\nstale\n' > "$ledger_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$ledger_file" 2>/dev/null || touch -d "7 hours ago" "$ledger_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: other-session ledger with 7h-old mtime should have been reaped"
        return 1
    fi
    return 0
}

# AC: current-sid ledger is preserved unconditionally, even with a 7h-old mtime.
test_gc_ledger_current_session_stale_survives() {
    local sid="ledger-gc-current"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\ncurrent\n' > "$ledger_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$ledger_file" 2>/dev/null || touch -d "7 hours ago" "$ledger_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: current-session ledger should survive GC regardless of mtime age"
        return 1
    fi
    return 0
}

# AC: non-current-sid ledger with a fresh mtime (mid-append) is NOT reaped.
test_gc_ledger_other_session_fresh_survives() {
    local sid="ledger-gc-other-fresh"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\nfresh\n' > "$ledger_file"
    # mtime is already "now" -- no touch needed

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-fresh-session2"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: other-session ledger with a fresh mtime (mid-append) should survive GC"
        return 1
    fi
    return 0
}

# AC: ledger GC glob is namespace-scoped to session-ledger-*.md only; an
# unrelated stale .md file (non-ledger) must NOT be touched by it.
test_gc_ledger_namespace_separation_untouched() {
    local other_file="$TEST_OMT_DIR/handoff-old-orphan.md"
    printf 'unrelated stale content\n' > "$other_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$other_file" 2>/dev/null || touch -d "7 hours ago" "$other_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-namespace-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$other_file" ]; then
        echo "ASSERTION FAILED: ledger GC must not touch a non-session-ledger .md file"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: deep-interview restore block (plan TODO 6)
# di's seed schema (hooks/pre-tool-enforcer.sh) is minimal -- {active,
# started_at, last_touched_at} only, unlike prometheus/goal/qa which also
# carry .phase (and prometheus/goal carry .plan_path). The restore block must
# emit only an active-session re-read instruction and must never emit a blank
# "Phase:" line, since di has no phase field to source one from.
# =============================================================================

# AC: di active-state fixture -> stdout injects a di state re-read instruction
# (restore marker + run-now cat pointer to the di state file).
test_session_start_deep_interview_active_emits_reread_instruction() {
    local sid="di-restore-active"
    cat > "$TEST_OMT_DIR/deep-interview-active-state-${sid}.json" << EOF
{
  "active": true,
  "started_at": "$(date "+%Y-%m-%dT%H:%M:%S")",
  "last_touched_at": "$(date "+%Y-%m-%dT%H:%M:%S")"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: di-active stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    assert_output_contains "$ctx" "DEEP-INTERVIEW RESTORED" "active di state must inject a DI restore block" || return 1

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/deep-interview-active-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain the UNEXPANDED di state cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi

    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now'; then
        echo "ASSERTION FAILED: additionalContext should contain a run-now imperative for the di re-read"
        return 1
    fi
    return 0
}

# AC: di has no .phase field in its seed schema -- the restore block must
# never emit a "Phase:" line (blank or otherwise). Only di is active here
# (no prometheus/goal/qa state), so any "Phase:" occurrence would prove the
# prometheus block was copied verbatim instead of mirrored to di's schema.
test_session_start_deep_interview_no_blank_phase_line() {
    local sid="di-restore-no-phase"
    cat > "$TEST_OMT_DIR/deep-interview-active-state-${sid}.json" << EOF
{
  "active": true,
  "started_at": "$(date "+%Y-%m-%dT%H:%M:%S")",
  "last_touched_at": "$(date "+%Y-%m-%dT%H:%M:%S")"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    assert_output_not_contains "$ctx" "Phase:" "di restore block must never emit a Phase: line (di seed has no .phase)" || return 1
    return 0
}

# grep-0 (TODO 8): session-start.sh must contain zero handoff references — the
# handoff reader block, the two orphan-GC arms, and the HANDOFF variable are
# all removed; ledger recovery option D (above) supersedes them.
test_session_start_no_handoff_remnants() {
    if grep -qiE 'handoff' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 handoff references (TODO 8 removal; superseded by ledger recovery option D)"
        grep -niE 'handoff' "$SCRIPT_DIR/session-start.sh" | head -10
        return 1
    fi
    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Session Start Hook Tests"
    echo "=========================================="

    # Session ID extraction
    run_test test_session_start_extracts_session_id

    # Session-based ultrawork state tests
    run_test test_session_start_ignores_other_sessions_ultrawork_state
    run_test test_session_start_no_generic_ultrawork_state

    # OMT_DIR export and directory creation
    run_test test_session_start_exports_omt_dir_via_claude_env_file
    run_test test_session_start_omt_dir_points_under_home_omt
    run_test test_session_start_creates_omt_dir

    # Project root detection - session-start (from hooks/test/project_root_test.sh)
    run_test test_get_project_root_function_exists_in_session_start
    run_test test_session_start_uses_project_root_variable

    # Prometheus restore: resume_summary surfaced when plan file unavailable
    run_test test_session_start_prometheus_omits_resume_summary_and_emits_pointer_when_plan_unavailable

    # Prometheus restore: backslashes in resume_summary produce valid JSON and are preserved
    run_test test_session_start_prometheus_resume_summary_backslash_produces_valid_json

    # Goal state restore
    run_test test_session_start_goal_state_restore_planning_vs_pursuing
    run_test test_session_start_stale_goal_state_purged
    run_test test_session_start_terminal_goal_state_not_restored
    run_test test_session_start_goal_pursuing_resume_rereads_plan
    run_test test_session_start_goal_pursuing_resume_no_plan_file
    run_test test_session_start_goal_planning_no_plan_emits_guidance_and_is_invariant

    # Goal state restore: backslash in plan_path produces valid JSON
    run_test test_session_start_goal_plan_path_backslash_produces_valid_json

    # Pristine goal-state: invisible to session-start restore
    run_test test_session_start_pristine_goal_state_not_restored
    run_test test_session_start_non_pristine_planning_goal_still_restored
    run_test test_session_start_pristine_goal_absent_outcome_not_restored

    # deep-interview stale-cleanup: glob + mtime fallback
    run_test test_session_start_stale_deep_interview_with_started_at_purged
    run_test test_session_start_stale_deep_interview_no_started_at_purged_via_mtime
    run_test test_session_start_fresh_deep_interview_marker_survives

    # GC liveness unification (TODO 7)
    run_test test_gc_current_session_active_7h_idle_survives
    run_test test_gc_other_session_active_fresh_heartbeat_survives
    run_test test_gc_other_session_active_7h_idle_reaped
    run_test test_gc_terminal_state_1h_old_reaped
    run_test test_gc_terminal_state_10m_old_kept
    run_test test_gc_terminal_goal_fresh_heartbeat_survives_no_carveout
    run_test test_gc_glob_only_managed_prefixes
    run_test test_gc_old_threshold_constants_removed

    # Retired-loop removal (TODO 10)
    run_test test_session_start_orphan_accept_unmanaged_state
    run_test test_session_start_no_retired_loop_restore

    # Encoding invariants (retained across the TODO 8 handoff removal)
    run_test test_session_start_encoder_invariants_in_source

    # Cache-safe restore — TODO 3 (AC2a–AC6)
    run_test test_cache_safe_prom_sentinel_not_in_stdout
    run_test test_cache_safe_prom_pointer_and_imperative
    run_test test_cache_safe_prom_round_trip
    run_test test_cache_safe_goal_sentinel_not_in_stdout
    run_test test_cache_safe_goal_pointer_and_imperative
    run_test test_cache_safe_goal_round_trip
    run_test test_cache_safe_incomplete_count_existence_only
    run_test test_cache_safe_prom_session_invariant
    run_test test_cache_safe_goal_session_invariant

    # Ledger recording instruction (TODO 3)
    run_test test_session_start_ledger_recording_every_source
    run_test test_session_start_ledger_recording_verbatim_mandate
    run_test test_session_start_ledger_recording_is_static
    run_test test_session_start_ledger_recording_rooted_path

    # Ledger recovery option D (TODO 4, D1)
    run_test test_session_start_ledger_recovery_inlines_now_and_corrections
    run_test test_session_start_ledger_recovery_no_ledger_harmless
    run_test test_session_start_ledger_recovery_acute_over_cap_pointer_fallback
    run_test test_session_start_ledger_recovery_only_on_compact_source
    run_test test_session_start_ledger_recovery_preserves_hash_line_in_acute
    run_test test_session_start_ledger_recovery_no_header_injection_from_bulk
    run_test test_session_start_ledger_recovery_unescapes_header_collision_content
    run_test test_session_start_ledger_recovery_double_escape_round_trip

    # Ledger GC — mtime-based (TODO 5)
    run_test test_gc_ledger_other_session_stale_reaped
    run_test test_gc_ledger_current_session_stale_survives
    run_test test_gc_ledger_other_session_fresh_survives
    run_test test_gc_ledger_namespace_separation_untouched

    # deep-interview restore block (TODO 6)
    run_test test_session_start_deep_interview_active_emits_reread_instruction
    run_test test_session_start_deep_interview_no_blank_phase_line

    # Dead handoff plumbing removed (TODO 8)
    run_test test_session_start_no_handoff_remnants

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

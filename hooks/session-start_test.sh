#!/bin/bash
# =============================================================================
# Session Start Hook Tests
# Tests for session-based ralph state file reading
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
# Tests: Session-based ralph state file reading
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

test_session_start_reads_session_specific_ralph_state() {
    # Create session-specific ralph state file
    cat > "$TEST_OMT_DIR/ralph-state-test-session-abc.json" << 'EOF'
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "session specific task"
}
EOF

    # Run with sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-abc"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Verify output contains ralph loop restored message
    assert_output_contains "$output" "RALPH LOOP RESTORED" "Should restore session-specific ralph state" || return 1
}

test_session_start_ignores_other_sessions_ralph_state() {
    # Create ralph state file for DIFFERENT session
    cat > "$TEST_OMT_DIR/ralph-state-other-session.json" << 'EOF'
{
  "active": true,
  "iteration": 5,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "other session task"
}
EOF

    # Run with different sessionId
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Should NOT contain ralph loop restored (no state for this session)
    assert_output_not_contains "$output" "RALPH LOOP RESTORED" "Should NOT restore other session's ralph state" || return 1
}

test_session_start_uses_default_when_no_session_id() {
    # Create default ralph state file
    cat > "$TEST_OMT_DIR/ralph-state-default.json" << 'EOF'
{
  "active": true,
  "iteration": 2,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "default session task"
}
EOF

    # Run without sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Should contain ralph loop restored (using default session)
    assert_output_contains "$output" "RALPH LOOP RESTORED" "Should restore default session ralph state" || return 1
}

test_session_start_no_verification_file_references() {
    # session-start.sh should NOT reference ralph-verification files (removed)
    if grep -q 'ralph-verification-' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: session-start.sh should NOT reference ralph-verification files (removed)"
        return 1
    else
        return 0
    fi
}

test_session_start_reads_oracle_feedback_from_ralph_state() {
    # Create ralph state with oracle_feedback
    cat > "$TEST_OMT_DIR/ralph-state-test-session-feedback.json" << 'EOF'
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "test task",
  "oracle_feedback": ["issue: tests failing", "issue: missing docs"]
}
EOF

    # Run with sessionId
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-feedback"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Should contain oracle feedback in output
    if echo "$output" | grep -qi "feedback\|oracle"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should display oracle_feedback from ralph-state"
        echo "  Output: ${output:0:500}"
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
# Tests: Prometheus restore — resume_summary surfaced when plan file unavailable
# =============================================================================

test_session_start_prometheus_surfaces_resume_summary_when_plan_unavailable() {
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # additionalContext must contain the bookmark text
    assert_output_contains "$output" "Working on feature X" "additionalContext should contain resume_summary text" || return 1
    assert_output_contains "$output" "Resume from this bookmark" "additionalContext should contain bookmark label" || return 1
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # (a) stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON when resume_summary contains backslashes"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # (b) the parsed additionalContext must contain backslashes intact
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'C:\tmp\plan'; then
        : # good
    else
        echo "ASSERTION FAILED: additionalContext should preserve backslash path C:\\tmp\\plan"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi

    if echo "$ctx" | grep -qF '\d+'; then
        : # good
    else
        echo "ASSERTION FAILED: additionalContext should preserve backslash regex \\d+"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
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
    # Create a goal-state file with started_at older than STALE_THRESHOLD (3 hours)
    local stale_ts
    stale_ts=$(date -j -v-4H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "4 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_file="$TEST_OMT_DIR/goal-state-stale-session.json"
    cat > "$stale_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "started_at": "${stale_ts}",
  "outcome": "old goal",
  "iteration": 1
}
EOF

    # Run the hook (stale cleanup runs regardless of sessionId)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # Stale goal-state file should be removed
    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: stale goal-state file should have been purged but still exists"
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

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Session Start Hook Tests"
    echo "=========================================="

    # Session-based ralph state tests
    run_test test_session_start_extracts_session_id
    run_test test_session_start_reads_session_specific_ralph_state
    run_test test_session_start_ignores_other_sessions_ralph_state
    run_test test_session_start_uses_default_when_no_session_id
    run_test test_session_start_no_verification_file_references
    run_test test_session_start_reads_oracle_feedback_from_ralph_state

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
    run_test test_session_start_prometheus_surfaces_resume_summary_when_plan_unavailable

    # Prometheus restore: backslashes in resume_summary produce valid JSON and are preserved
    run_test test_session_start_prometheus_resume_summary_backslash_produces_valid_json

    # Goal state restore
    run_test test_session_start_goal_state_restore_planning_vs_pursuing
    run_test test_session_start_stale_goal_state_purged
    run_test test_session_start_terminal_goal_state_not_restored

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

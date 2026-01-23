#!/bin/bash
# =============================================================================
# Session Start Hook Tests
# Tests for session-based ralph state file reading
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude/sisyphus"
    mkdir -p "$TEST_TMP_DIR/.git"

    # Store original HOME
    ORIGINAL_HOME="$HOME"

    # Create temporary home directory for isolated tests
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"
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
    if grep -q 'SESSION_ID.*jq.*sessionId' "$HOOKS_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should extract SESSION_ID"
        return 1
    fi
}

test_session_start_reads_session_specific_ralph_state() {
    # Create session-specific ralph state file
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-test-session-abc.json" << 'EOF'
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-abc"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Verify output contains ralph loop restored message
    assert_output_contains "$output" "RALPH LOOP RESTORED" "Should restore session-specific ralph state" || return 1
}

test_session_start_ignores_other_sessions_ralph_state() {
    # Create ralph state file for DIFFERENT session
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-other-session.json" << 'EOF'
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Should NOT contain ralph loop restored (no state for this session)
    assert_output_not_contains "$output" "RALPH LOOP RESTORED" "Should NOT restore other session's ralph state" || return 1
}

test_session_start_uses_default_when_no_session_id() {
    # Create default ralph state file
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-default.json" << 'EOF'
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Should contain ralph loop restored (using default session)
    assert_output_contains "$output" "RALPH LOOP RESTORED" "Should restore default session ralph state" || return 1
}

test_session_start_reads_session_specific_verification() {
    # Check that session-start.sh reads session-specific verification file
    if grep -q 'ralph-verification-\${SESSION_ID' "$HOOKS_DIR/session-start.sh" || \
       grep -q 'ralph-verification-.*SESSION_ID' "$HOOKS_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should use session-specific ralph-verification file"
        return 1
    fi
}

# =============================================================================
# Tests: Session-based ultrawork state file reading
# =============================================================================

test_session_start_reads_session_specific_ultrawork_state() {
    # Create session-specific ultrawork state file
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-test-session-xyz.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "session specific ultrawork task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    # Run with sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-xyz"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Verify output contains ultrawork mode restored message
    assert_output_contains "$output" "ULTRAWORK MODE RESTORED" "Should restore session-specific ultrawork state" || return 1
}

test_session_start_ignores_other_sessions_ultrawork_state() {
    # Create ultrawork state file for DIFFERENT session
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-other-session.json" << 'EOF'
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Should NOT contain ultrawork mode restored (no state for this session)
    assert_output_not_contains "$output" "ULTRAWORK MODE RESTORED" "Should NOT restore other session's ultrawork state" || return 1
}

test_session_start_uses_default_session_for_ultrawork() {
    # Create default ultrawork state file
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-default.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "default session ultrawork task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    # Run without sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | "$HOOKS_DIR/session-start.sh" 2>&1) || true

    # Should contain ultrawork mode restored (using default session)
    assert_output_contains "$output" "ULTRAWORK MODE RESTORED" "Should restore default session ultrawork state" || return 1
}

test_session_start_uses_session_id_for_ultrawork_path() {
    # Check that session-start.sh uses session-specific ultrawork file
    if grep -q 'ultrawork-state-\${SESSION_ID' "$HOOKS_DIR/session-start.sh" || \
       grep -q 'ultrawork-state-.*SESSION_ID' "$HOOKS_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should use session-specific ultrawork state file"
        return 1
    fi
}

test_session_start_no_generic_ultrawork_state() {
    # session-start.sh should NOT use generic ultrawork-state.json (without session ID)
    local non_session_refs=$(grep -E 'ultrawork-state\.json' "$HOOKS_DIR/session-start.sh" 2>/dev/null | wc -l)
    if [[ "$non_session_refs" -gt 0 ]]; then
        echo "ASSERTION FAILED: session-start.sh should NOT use generic ultrawork-state.json"
        return 1
    else
        return 0
    fi
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
    run_test test_session_start_reads_session_specific_verification

    # Session-based ultrawork state tests
    run_test test_session_start_reads_session_specific_ultrawork_state
    run_test test_session_start_ignores_other_sessions_ultrawork_state
    run_test test_session_start_uses_default_session_for_ultrawork
    run_test test_session_start_uses_session_id_for_ultrawork_path
    run_test test_session_start_no_generic_ultrawork_state

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

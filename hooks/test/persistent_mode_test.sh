#!/bin/bash
# =============================================================================
# Persistent Mode Hook Tests
# Tests for linked ultrawork cleanup and max iteration handling
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

assert_equals() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    if [[ "$expected" == "$actual" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local msg="${2:-File should exist: $file}"

    if [[ -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_not_exists() {
    local file="$1"
    local msg="${2:-File should not exist: $file}"

    if [[ ! -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should contain pattern}"

    if grep -q "$pattern" "$file"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
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
# Tests: linked_to_ralph and cleanup_linked_ultrawork REMOVED
# =============================================================================

test_no_cleanup_linked_ultrawork_function() {
    # persistent-mode.sh should NOT define cleanup_linked_ultrawork function (removed)
    if grep -E '^cleanup_linked_ultrawork\(\)' "$HOOKS_DIR/persistent-mode.sh" >/dev/null 2>&1; then
        echo "ASSERTION FAILED: cleanup_linked_ultrawork() should NOT exist in persistent-mode.sh (removed)"
        return 1
    else
        return 0
    fi
}

test_no_linked_to_ralph_references() {
    # persistent-mode.sh should NOT reference linked_to_ralph (removed)
    if grep -q "linked_to_ralph" "$HOOKS_DIR/persistent-mode.sh"; then
        echo "ASSERTION FAILED: persistent-mode.sh should NOT contain linked_to_ralph references (removed)"
        return 1
    else
        return 0
    fi
}

test_no_cleanup_linked_ultrawork_calls() {
    # persistent-mode.sh should NOT call cleanup_linked_ultrawork (removed)
    if grep -q "cleanup_linked_ultrawork" "$HOOKS_DIR/persistent-mode.sh"; then
        echo "ASSERTION FAILED: persistent-mode.sh should NOT contain cleanup_linked_ultrawork calls (removed)"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: Session-Based Ultrawork State Reading
# =============================================================================

test_ultrawork_state_uses_session_id_in_path() {
    # persistent-mode.sh should read ultrawork-state-{SESSION_ID}.json
    if grep -q 'ultrawork-state-\${SESSION_ID' "$HOOKS_DIR/persistent-mode.sh" || \
       grep -q 'ultrawork-state-.*SESSION_ID' "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should use session-specific ultrawork state file"
        return 1
    fi
}

test_no_generic_ultrawork_state_path() {
    # persistent-mode.sh should NOT use ultrawork-state.json (without session ID)
    # Only accept lines that have ultrawork-state- followed by SESSION_ID
    local non_session_refs=$(grep -E 'ultrawork-state\.json' "$HOOKS_DIR/persistent-mode.sh" 2>/dev/null | wc -l)
    if [[ "$non_session_refs" -gt 0 ]]; then
        echo "ASSERTION FAILED: persistent-mode.sh should NOT use generic ultrawork-state.json"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: Max iteration handling with cleanup
# =============================================================================

test_max_iteration_returns_user_friendly_message() {
    # The max iteration message should be informative
    if grep -q "RALPH LOOP STOPPED - MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should contain max iteration stop message"
        return 1
    fi
}

test_max_iteration_message_includes_original_task() {
    # The max iteration message should include the original task
    # Check for pattern that includes prompt/task in max iteration section
    if grep -B 5 -A 30 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -qE 'Original task.*PROMPT|\$PROMPT'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration message should include original task"
        return 1
    fi
}

test_max_iteration_message_includes_recommended_actions() {
    # The max iteration message should include recommended actions
    if grep -q "Recommended actions" "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration message should include recommended actions"
        return 1
    fi
}

test_max_iteration_cleans_ralph_state() {
    # The max iteration handler should clean up ralph state (session-specific)
    # The rm commands are before the MAX ITERATIONS message, need more context
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ralph-state-\${SESSION_ID}'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should clean ralph-state-{SESSION_ID}.json"
        return 1
    fi
}

test_max_iteration_cleans_verification_state() {
    # The max iteration handler should clean up verification state (session-specific)
    # The rm commands are before the MAX ITERATIONS message, need more context
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ralph-verification-\${SESSION_ID}'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should clean ralph-verification-{SESSION_ID}.json"
        return 1
    fi
}

test_max_iteration_cleans_ultrawork_state() {
    # The max iteration handler should clean up session-specific ultrawork state (without cleanup_linked_ultrawork)
    # Should directly remove ultrawork-state-{SESSION_ID}.json
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ultrawork-state'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should clean ultrawork state files"
        return 1
    fi
}

# =============================================================================
# Tests: Ultrawork state schema WITHOUT linked_to_ralph field
# =============================================================================

test_ultrawork_state_no_linked_to_ralph_field() {
    # The linked_to_ralph field should NOT be referenced (removed)
    if grep -q "linked_to_ralph" "$HOOKS_DIR/persistent-mode.sh"; then
        echo "ASSERTION FAILED: persistent-mode.sh should NOT reference linked_to_ralph (removed)"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: Max iteration check logic
# =============================================================================

test_max_iteration_check_uses_ge_comparison() {
    # The max iteration check should use >= comparison for clean handling
    if grep -E '\$ITERATION.*-ge.*\$MAX_ITER' "$HOOKS_DIR/persistent-mode.sh" | grep -q .; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should use -ge comparison for max iteration"
        return 1
    fi
}

test_max_iteration_cleans_todo_attempt_counter() {
    # The max iteration handler should clean up todo attempt counter
    if grep -q "oh-my-toong-todo-attempts" "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should clean todo attempt counter on max iteration"
        return 1
    fi
}

test_max_iteration_returns_continue_true() {
    # The max iteration handler should return continue: true to allow stopping
    if grep -B 5 -A 30 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q '"continue": true'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should return continue: true"
        return 1
    fi
}

# =============================================================================
# Tests: Behavior verification via script execution
# =============================================================================

test_max_iteration_script_behavior() {
    # Setup: Create project marker so get_project_root can find the root
    mkdir -p "$TEST_TMP_DIR/.git"

    # Setup: Create ralph state at max iteration (session-specific with default session)
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-default.json" << 'EOF'
{
  "active": true,
  "iteration": 10,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "test task"
}
EOF

    # Create session-specific ultrawork state (no linked_to_ralph field)
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-default.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "test task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    cat > "$HOME/.claude/ultrawork-state-default.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "test task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    # Run the script (use "cwd" key, not "directory", no sessionId = default)
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | "$HOOKS_DIR/persistent-mode.sh" 2>&1) || true

    # Verify output contains max iteration message
    if echo "$output" | grep -q "MAX ITERATIONS"; then
        # Also verify the state files were cleaned up (session-specific)
        if [[ ! -f "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-default.json" ]] && \
           [[ ! -f "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-default.json" ]] && \
           [[ ! -f "$HOME/.claude/ultrawork-state-default.json" ]]; then
            return 0
        else
            echo "ASSERTION FAILED: State files should be cleaned up after max iterations"
            [[ -f "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-default.json" ]] && echo "  ralph-state-default.json still exists"
            [[ -f "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state-default.json" ]] && echo "  local ultrawork-state-default.json still exists"
            [[ -f "$HOME/.claude/ultrawork-state-default.json" ]] && echo "  global ultrawork-state-default.json still exists"
            return 1
        fi
    else
        echo "ASSERTION FAILED: Script should output MAX ITERATIONS message"
        echo "  Output: ${output:0:500}"
        return 1
    fi
}

# =============================================================================
# Tests: Session-based ralph state file reading
# =============================================================================

test_session_specific_ralph_state_reading() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

    # Create session-specific ralph state file
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-test-session-789.json" << 'EOF'
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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-789"}' | "$HOOKS_DIR/persistent-mode.sh" 2>&1) || true

    # Verify output contains ralph loop continuation (iteration increases)
    if echo "$output" | grep -q "RALPH LOOP"; then
        return 0
    else
        echo "ASSERTION FAILED: Should read session-specific ralph state"
        echo "  Output: ${output:0:500}"
        return 1
    fi
}

test_session_specific_ralph_state_ignores_other_sessions() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

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
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$HOOKS_DIR/persistent-mode.sh" 2>&1) || true

    # Should NOT contain ralph loop (no state for this session)
    if echo "$output" | grep -q "RALPH LOOP"; then
        echo "ASSERTION FAILED: Should NOT read other session's ralph state"
        return 1
    else
        return 0
    fi
}

test_ralph_verification_uses_session_id() {
    # Verify persistent-mode.sh reads ralph-verification-{SESSION_ID}.json
    if grep -q 'ralph-verification-\${SESSION_ID' "$HOOKS_DIR/persistent-mode.sh" || \
       grep -q 'ralph-verification-.*SESSION_ID' "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should use session-specific ralph-verification file"
        return 1
    fi
}

test_cleanup_ralph_state_uses_session_id() {
    # Verify cleanup_ralph_state function uses session-specific paths
    if grep -A 5 'cleanup_ralph_state\(\)' "$HOOKS_DIR/persistent-mode.sh" | grep -q 'ralph-state-\${SESSION_ID'; then
        return 0
    else
        echo "ASSERTION FAILED: cleanup_ralph_state should use session-specific file"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Persistent Mode Hook Tests"
    echo "=========================================="

    # Session-based ralph state tests
    run_test test_session_specific_ralph_state_reading
    run_test test_session_specific_ralph_state_ignores_other_sessions
    run_test test_ralph_verification_uses_session_id
    run_test test_cleanup_ralph_state_uses_session_id

    # linked_to_ralph and cleanup_linked_ultrawork REMOVED tests
    run_test test_no_cleanup_linked_ultrawork_function
    run_test test_no_linked_to_ralph_references
    run_test test_no_cleanup_linked_ultrawork_calls

    # Session-based ultrawork state tests
    run_test test_ultrawork_state_uses_session_id_in_path
    run_test test_no_generic_ultrawork_state_path

    # Max iteration message tests
    run_test test_max_iteration_returns_user_friendly_message
    run_test test_max_iteration_message_includes_original_task
    run_test test_max_iteration_message_includes_recommended_actions

    # Max iteration cleanup tests
    run_test test_max_iteration_cleans_ralph_state
    run_test test_max_iteration_cleans_verification_state
    run_test test_max_iteration_cleans_ultrawork_state

    # Ultrawork state schema tests (linked_to_ralph removed)
    run_test test_ultrawork_state_no_linked_to_ralph_field

    # Max iteration logic tests
    run_test test_max_iteration_check_uses_ge_comparison
    run_test test_max_iteration_cleans_todo_attempt_counter
    run_test test_max_iteration_returns_continue_true

    # Behavior verification
    run_test test_max_iteration_script_behavior

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

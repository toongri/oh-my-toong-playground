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
# Tests: cleanup_linked_ultrawork function existence
# =============================================================================

test_cleanup_linked_ultrawork_function_exists() {
    # persistent-mode.sh should define cleanup_linked_ultrawork function
    if grep -E '^cleanup_linked_ultrawork\(\)' "$HOOKS_DIR/persistent-mode.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: cleanup_linked_ultrawork() should be defined in persistent-mode.sh"
        return 1
    fi
}

test_cleanup_linked_ultrawork_checks_linked_to_ralph() {
    # The cleanup function should check linked_to_ralph field
    if grep -A 10 '^cleanup_linked_ultrawork\(\)' "$HOOKS_DIR/persistent-mode.sh" | grep -q "linked_to_ralph"; then
        return 0
    else
        echo "ASSERTION FAILED: cleanup_linked_ultrawork should check linked_to_ralph field"
        return 1
    fi
}

test_cleanup_linked_ultrawork_removes_local_state() {
    # The cleanup function should remove local ultrawork state file
    if grep -A 15 '^cleanup_linked_ultrawork\(\)' "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ultrawork_file'; then
        return 0
    else
        echo "ASSERTION FAILED: cleanup_linked_ultrawork should remove local ultrawork state"
        return 1
    fi
}

test_cleanup_linked_ultrawork_removes_global_state() {
    # The cleanup function should remove global ultrawork state file
    if grep -A 15 '^cleanup_linked_ultrawork\(\)' "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*global_ultrawork'; then
        return 0
    else
        echo "ASSERTION FAILED: cleanup_linked_ultrawork should remove global ultrawork state"
        return 1
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
    # The max iteration handler should clean up ralph state
    # The rm commands are before the MAX ITERATIONS message, need more context
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ralph-state.json'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should clean ralph-state.json"
        return 1
    fi
}

test_max_iteration_cleans_verification_state() {
    # The max iteration handler should clean up verification state
    # The rm commands are before the MAX ITERATIONS message, need more context
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'rm -f.*ralph-verification.json'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should clean ralph-verification.json"
        return 1
    fi
}

test_max_iteration_calls_cleanup_linked_ultrawork() {
    # The max iteration handler should call cleanup_linked_ultrawork
    # The cleanup call is before the MAX ITERATIONS message, need more context
    if grep -B 15 -A 5 "MAX ITERATIONS" "$HOOKS_DIR/persistent-mode.sh" | grep -q 'cleanup_linked_ultrawork'; then
        return 0
    else
        echo "ASSERTION FAILED: max iteration should call cleanup_linked_ultrawork"
        return 1
    fi
}

# =============================================================================
# Tests: Ultrawork state schema with linked_to_ralph field
# =============================================================================

test_ultrawork_state_supports_linked_to_ralph_field() {
    # The linked_to_ralph field should be parseable by persistent-mode.sh
    if grep -q "linked_to_ralph" "$HOOKS_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: persistent-mode.sh should handle linked_to_ralph field"
        return 1
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
    # Setup: Create ralph state at max iteration
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" << 'EOF'
{
  "active": true,
  "iteration": 10,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "test task"
}
EOF

    # Create linked ultrawork state
    cat > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "test task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00",
  "linked_to_ralph": true
}
EOF

    cat > "$HOME/.claude/ultrawork-state.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "test task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00",
  "linked_to_ralph": true
}
EOF

    # Run the script
    local output
    output=$(echo '{"directory": "'"$TEST_TMP_DIR"'"}' | "$HOOKS_DIR/persistent-mode.sh" 2>&1) || true

    # Verify output contains max iteration message
    if echo "$output" | grep -q "MAX ITERATIONS"; then
        # Also verify the state files were cleaned up
        if [[ ! -f "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" ]] && \
           [[ ! -f "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json" ]] && \
           [[ ! -f "$HOME/.claude/ultrawork-state.json" ]]; then
            return 0
        else
            echo "ASSERTION FAILED: State files should be cleaned up after max iterations"
            [[ -f "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" ]] && echo "  ralph-state.json still exists"
            [[ -f "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json" ]] && echo "  local ultrawork-state.json still exists"
            [[ -f "$HOME/.claude/ultrawork-state.json" ]] && echo "  global ultrawork-state.json still exists"
            return 1
        fi
    else
        echo "ASSERTION FAILED: Script should output MAX ITERATIONS message"
        echo "  Output: ${output:0:500}"
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

    # cleanup_linked_ultrawork function tests
    run_test test_cleanup_linked_ultrawork_function_exists
    run_test test_cleanup_linked_ultrawork_checks_linked_to_ralph
    run_test test_cleanup_linked_ultrawork_removes_local_state
    run_test test_cleanup_linked_ultrawork_removes_global_state

    # Max iteration message tests
    run_test test_max_iteration_returns_user_friendly_message
    run_test test_max_iteration_message_includes_original_task
    run_test test_max_iteration_message_includes_recommended_actions

    # Max iteration cleanup tests
    run_test test_max_iteration_cleans_ralph_state
    run_test test_max_iteration_cleans_verification_state
    run_test test_max_iteration_calls_cleanup_linked_ultrawork

    # Ultrawork state schema tests
    run_test test_ultrawork_state_supports_linked_to_ralph_field

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

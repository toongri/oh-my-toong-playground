#!/bin/bash
# =============================================================================
# Persistent Mode Hook Tests
# Tests for todo continuation attempt limiting
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_DIR="$(dirname "$SCRIPT_DIR")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude/sisyphus"
    mkdir -p "$TEST_TMP_DIR/.claude/todos"

    # Clean up any existing attempt files from previous test runs
    rm -f /tmp/oh-my-toong-todo-attempts-* 2>/dev/null || true
    rm -f /tmp/oh-my-toong-todo-count-* 2>/dev/null || true
}

teardown_test_env() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
    # Clean up attempt files
    rm -f /tmp/oh-my-toong-todo-attempts-* 2>/dev/null || true
    rm -f /tmp/oh-my-toong-todo-count-* 2>/dev/null || true
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

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-}"

    if [[ "$haystack" == *"$needle"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Expected to contain: '$needle'"
        echo "  Actual: '$haystack'"
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

# Helper: Create todo file with incomplete tasks
create_incomplete_todos() {
    local count="${1:-1}"
    local todos_file="$TEST_TMP_DIR/.claude/todos/session.json"

    local todos="["
    for ((i=0; i<count; i++)); do
        if [[ $i -gt 0 ]]; then
            todos+=","
        fi
        todos+="{\"status\": \"pending\", \"content\": \"Task $i\"}"
    done
    todos+="]"

    echo "$todos" > "$todos_file"
}

# Helper: Run hook and get output
run_hook() {
    local session_id="${1:-test-session}"
    local directory="${2:-$TEST_TMP_DIR}"

    local input="{\"sessionId\": \"$session_id\", \"directory\": \"$directory\"}"

    # Set HOME to test dir to use test todo files
    HOME="$TEST_TMP_DIR" echo "$input" | bash "$HOOK_DIR/persistent-mode.sh" 2>/dev/null
}

# =============================================================================
# Tests: Max Attempts Constant
# =============================================================================

test_hook_defines_max_todo_continuation_attempts() {
    # Hook should define MAX_TODO_CONTINUATION_ATTEMPTS constant
    if grep -q "MAX_TODO_CONTINUATION_ATTEMPTS=" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should define MAX_TODO_CONTINUATION_ATTEMPTS constant"
        return 1
    fi
}

test_hook_max_attempts_is_5() {
    # MAX_TODO_CONTINUATION_ATTEMPTS should be 5 (per spec)
    if grep -q "MAX_TODO_CONTINUATION_ATTEMPTS=5" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: MAX_TODO_CONTINUATION_ATTEMPTS should be 5"
        return 1
    fi
}

# =============================================================================
# Tests: Attempt Tracking Functions
# =============================================================================

test_hook_defines_get_attempt_count() {
    if grep -q "get_attempt_count()" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should define get_attempt_count() function"
        return 1
    fi
}

test_hook_defines_increment_attempts() {
    if grep -q "increment_attempts()" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should define increment_attempts() function"
        return 1
    fi
}

test_hook_defines_reset_attempts() {
    if grep -q "reset_attempts()" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should define reset_attempts() function"
        return 1
    fi
}

# =============================================================================
# Tests: Attempt File Location
# =============================================================================

test_hook_uses_tmp_for_attempt_files() {
    # Hook should use /tmp for attempt tracking files
    if grep -q '/tmp/oh-my-toong-todo-attempts' "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should use /tmp/oh-my-toong-todo-attempts for attempt files"
        return 1
    fi
}

test_hook_uses_tmp_for_count_files() {
    # Hook should use /tmp for todo count tracking files
    if grep -q '/tmp/oh-my-toong-todo-count' "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should use /tmp/oh-my-toong-todo-count for count files"
        return 1
    fi
}

# =============================================================================
# Tests: Progress Detection (Todo Count Change)
# =============================================================================

test_hook_tracks_previous_todo_count() {
    # Hook should track previous todo count to detect progress
    if grep -q "PREVIOUS_COUNT" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should track PREVIOUS_COUNT for progress detection"
        return 1
    fi
}

test_hook_resets_attempts_on_count_change() {
    # Hook should call reset_attempts when todo count changes
    # This is the progress detection logic
    if grep -A 5 'CURRENT_COUNT.*PREVIOUS_COUNT\|PREVIOUS_COUNT.*CURRENT_COUNT' "$HOOK_DIR/persistent-mode.sh" | grep -q "reset_attempts"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should reset attempts when todo count changes"
        return 1
    fi
}

# =============================================================================
# Tests: Max Attempts Enforcement
# =============================================================================

test_hook_checks_max_attempts_before_continuation() {
    # Hook should check if max attempts reached before forcing continuation
    if grep -q "ATTEMPTS.*MAX_TODO_CONTINUATION_ATTEMPTS\|ge.*MAX_TODO_CONTINUATION_ATTEMPTS" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should check max attempts before continuation"
        return 1
    fi
}

test_hook_allows_stop_on_max_attempts() {
    # When max attempts reached, hook should allow stop (continue: true)
    # Look for the pattern where max attempts triggers "continue": true
    if grep -A 20 "MAX_TODO_CONTINUATION_ATTEMPTS" "$HOOK_DIR/persistent-mode.sh" | grep -q '"continue": true'; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should allow stop (continue: true) when max attempts reached"
        return 1
    fi
}

test_hook_shows_limit_reached_message() {
    # Hook should show clear message when limit is reached
    if grep -q "TODO CONTINUATION LIMIT REACHED" "$HOOK_DIR/persistent-mode.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should show TODO CONTINUATION LIMIT REACHED message"
        return 1
    fi
}

test_hook_increments_attempts_before_continuation() {
    # Hook should increment attempts before forcing continuation
    # This ensures the counter increases each time
    if grep -B 5 -A 5 'todo-continuation' "$HOOK_DIR/persistent-mode.sh" | grep -q "increment_attempts"; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should increment attempts before forcing todo continuation"
        return 1
    fi
}

# =============================================================================
# Tests: Cleanup on Limit Reached
# =============================================================================

test_hook_cleans_attempt_files_on_limit() {
    # When limit is reached, hook should clean up temp files
    if grep -A 10 "MAX_TODO_CONTINUATION_ATTEMPTS" "$HOOK_DIR/persistent-mode.sh" | grep -q 'rm -f.*ATTEMPT_FILE\|rm -f.*TODO_COUNT_FILE'; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should clean up attempt files when limit is reached"
        return 1
    fi
}

# =============================================================================
# Tests: Warning Message Content
# =============================================================================

test_hook_warning_mentions_attempts() {
    # Warning should mention the number of attempts
    if grep -A 30 "TODO CONTINUATION LIMIT REACHED" "$HOOK_DIR/persistent-mode.sh" | grep -q "Attempted.*continuations"; then
        return 0
    else
        echo "ASSERTION FAILED: Warning should mention attempted continuations"
        return 1
    fi
}

test_hook_warning_mentions_remaining_tasks() {
    # Warning should mention remaining tasks
    if grep -A 30 "TODO CONTINUATION LIMIT REACHED" "$HOOK_DIR/persistent-mode.sh" | grep -q "tasks remain incomplete\|remain incomplete"; then
        return 0
    else
        echo "ASSERTION FAILED: Warning should mention remaining incomplete tasks"
        return 1
    fi
}

test_hook_warning_provides_recommendations() {
    # Warning should provide recommended actions
    if grep -A 30 "TODO CONTINUATION LIMIT REACHED" "$HOOK_DIR/persistent-mode.sh" | grep -q "Recommended actions"; then
        return 0
    else
        echo "ASSERTION FAILED: Warning should provide recommended actions"
        return 1
    fi
}

# =============================================================================
# Tests: Ultrawork Section Also Uses Attempt Limiting
# =============================================================================

test_hook_ultrawork_section_uses_attempt_limiting() {
    # Priority 2 (Ultrawork with todos) should also use attempt limiting
    # Look for attempt checking near ultrawork-persistence
    if grep -B 45 "ultrawork-persistence" "$HOOK_DIR/persistent-mode.sh" | grep -q "MAX_TODO_CONTINUATION_ATTEMPTS\|ATTEMPTS.*ge\|get_attempt_count"; then
        return 0
    else
        echo "ASSERTION FAILED: Ultrawork section should also use attempt limiting"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Persistent Mode Hook Tests"
    echo "Todo Continuation Attempt Limiting"
    echo "=========================================="

    # Max Attempts Constant
    run_test test_hook_defines_max_todo_continuation_attempts
    run_test test_hook_max_attempts_is_5

    # Attempt Tracking Functions
    run_test test_hook_defines_get_attempt_count
    run_test test_hook_defines_increment_attempts
    run_test test_hook_defines_reset_attempts

    # Attempt File Location
    run_test test_hook_uses_tmp_for_attempt_files
    run_test test_hook_uses_tmp_for_count_files

    # Progress Detection
    run_test test_hook_tracks_previous_todo_count
    run_test test_hook_resets_attempts_on_count_change

    # Max Attempts Enforcement
    run_test test_hook_checks_max_attempts_before_continuation
    run_test test_hook_allows_stop_on_max_attempts
    run_test test_hook_shows_limit_reached_message
    run_test test_hook_increments_attempts_before_continuation

    # Cleanup
    run_test test_hook_cleans_attempt_files_on_limit

    # Warning Message
    run_test test_hook_warning_mentions_attempts
    run_test test_hook_warning_mentions_remaining_tasks
    run_test test_hook_warning_provides_recommendations

    # Ultrawork Section
    run_test test_hook_ultrawork_section_uses_attempt_limiting

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

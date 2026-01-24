#!/bin/bash
# =============================================================================
# Keyword Detector Hook Tests
# Tests for session-based ralph state file creation
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
# Tests: Session-based ralph state file creation
# =============================================================================

test_ralph_keyword_creates_session_specific_state_file() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

    # Run with sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-123", "prompt": "ralph do the task"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    # Verify output contains ralph activation
    assert_output_contains "$output" "RALPH LOOP ACTIVATED" "Should activate ralph loop" || return 1

    # Verify session-specific state file was created
    assert_file_exists "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-test-session-123.json" "Session-specific ralph state file should exist" || return 1

    # Verify old non-session file was NOT created
    assert_file_not_exists "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" "Non-session ralph state file should NOT exist" || return 1
}

test_ralph_keyword_uses_default_when_no_session_id() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

    # Run without sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "prompt": "ralph do the task"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    # Verify output contains ralph activation
    assert_output_contains "$output" "RALPH LOOP ACTIVATED" "Should activate ralph loop" || return 1

    # Verify default session state file was created
    assert_file_exists "$TEST_TMP_DIR/.claude/sisyphus/ralph-state-default.json" "Default ralph state file should exist" || return 1
}

test_ralph_verification_uses_session_id() {
    # This test verifies that ralph-verification also uses session ID
    # The verification file is created by persistent-mode.sh, not keyword-detector
    # So we just check that keyword-detector extracts session ID correctly

    # Check that keyword-detector.sh has SESSION_ID extraction code
    if grep -q 'SESSION_ID.*jq.*sessionId' "$HOOKS_DIR/keyword-detector.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: keyword-detector.sh should extract SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Tests: JSON output format validation (hookSpecificOutput format)
# =============================================================================

assert_json_has_hook_specific_output() {
    local output="$1"
    local mode_name="$2"
    local msg="${3:-Output should have hookSpecificOutput format}"

    # Check for hookSpecificOutput structure
    if echo "$output" | grep -q '"hookSpecificOutput"'; then
        # Check for hookEventName: UserPromptSubmit
        if echo "$output" | grep -q '"hookEventName".*:.*"UserPromptSubmit"'; then
            # Check for additionalContext field
            if echo "$output" | grep -q '"additionalContext"'; then
                return 0
            else
                echo "ASSERTION FAILED: $msg - missing additionalContext"
                echo "  Output (first 500 chars): ${output:0:500}"
                return 1
            fi
        else
            echo "ASSERTION FAILED: $msg - hookEventName should be UserPromptSubmit"
            echo "  Output (first 500 chars): ${output:0:500}"
            return 1
        fi
    else
        echo "ASSERTION FAILED: $msg - missing hookSpecificOutput"
        echo "  Output (first 500 chars): ${output:0:500}"
        return 1
    fi
}

assert_no_message_field() {
    local output="$1"
    local msg="${2:-Output should NOT have message field at top level}"

    # Check that "message" is not at the top level (directly after "continue")
    if echo "$output" | grep -q '"continue".*"message"'; then
        echo "ASSERTION FAILED: $msg"
        echo "  Output (first 500 chars): ${output:0:500}"
        return 1
    fi
    return 0
}

test_ralph_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "ralph do the task"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "ralph" "Ralph mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Ralph mode should not use message field" || return 1
}

test_ultrawork_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "ultrawork do the task"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "ultrawork" "Ultrawork mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Ultrawork mode should not use message field" || return 1
}

test_think_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "think about this problem"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "think" "Think mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Think mode should not use message field" || return 1
}

test_search_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "search for files"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "search" "Search mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Search mode should not use message field" || return 1
}

test_analyze_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "analyze this code"}' | "$HOOKS_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "analyze" "Analyze mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Analyze mode should not use message field" || return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Keyword Detector Hook Tests"
    echo "=========================================="

    # Session-based ralph state tests
    run_test test_ralph_keyword_creates_session_specific_state_file
    run_test test_ralph_keyword_uses_default_when_no_session_id
    run_test test_ralph_verification_uses_session_id

    # JSON output format tests (hookSpecificOutput)
    run_test test_ralph_output_uses_hook_specific_output_format
    run_test test_ultrawork_output_uses_hook_specific_output_format
    run_test test_think_output_uses_hook_specific_output_format
    run_test test_search_output_uses_hook_specific_output_format
    run_test test_analyze_output_uses_hook_specific_output_format

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

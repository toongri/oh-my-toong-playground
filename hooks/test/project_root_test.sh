#!/bin/bash
# =============================================================================
# Project Root Detection Tests
# Tests for get_project_root function in keyword-detector.sh and session-start.sh
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

assert_dir_exists() {
    local dir="$1"
    local msg="${2:-Directory should exist: $dir}"

    if [[ -d "$dir" ]]; then
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

# =============================================================================
# Tests: get_project_root function existence
# =============================================================================

test_get_project_root_function_exists_in_keyword_detector() {
    # keyword-detector.sh should define get_project_root function
    if grep -E '^get_project_root\(\)' "$HOOKS_DIR/keyword-detector.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: get_project_root() should be defined in keyword-detector.sh"
        return 1
    fi
}

test_get_project_root_function_exists_in_session_start() {
    # session-start.sh should define get_project_root function
    if grep -E '^get_project_root\(\)' "$HOOKS_DIR/session-start.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: get_project_root() should be defined in session-start.sh"
        return 1
    fi
}

# =============================================================================
# Tests: PROJECT_ROOT variable usage
# =============================================================================

test_keyword_detector_uses_project_root_variable() {
    # keyword-detector.sh should set and use PROJECT_ROOT variable
    if grep -q 'PROJECT_ROOT=.*get_project_root' "$HOOKS_DIR/keyword-detector.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: keyword-detector.sh should set PROJECT_ROOT from get_project_root"
        return 1
    fi
}

test_session_start_uses_project_root_variable() {
    # session-start.sh should set and use PROJECT_ROOT variable
    if grep -q 'PROJECT_ROOT=.*get_project_root' "$HOOKS_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should set PROJECT_ROOT from get_project_root"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Project Root Detection Tests"
    echo "=========================================="

    # Function existence tests
    run_test test_get_project_root_function_exists_in_keyword_detector
    run_test test_get_project_root_function_exists_in_session_start

    # PROJECT_ROOT variable usage tests
    run_test test_keyword_detector_uses_project_root_variable
    run_test test_session_start_uses_project_root_variable

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

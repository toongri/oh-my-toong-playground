#!/bin/bash
# =============================================================================
# Logging Library Tests
# Tests for hooks/lib/logging.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
LOGGING_LIB="$HOOKS_DIR/lib/logging.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude/sisyphus/logs"
    mkdir -p "$TEST_TMP_DIR/.git"

    # Store original HOME and env vars
    ORIGINAL_HOME="$HOME"
    ORIGINAL_OMT_HOOK_LOG_ENABLED="${OMT_HOOK_LOG_ENABLED:-}"
    ORIGINAL_OMT_HOOK_LOG_LEVEL="${OMT_HOOK_LOG_LEVEL:-}"

    # Create temporary home directory for isolated tests
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"

    # Reset logging state for each test
    unset OMT_LOG_INITIALIZED 2>/dev/null || true
    unset OMT_LOG_FILE 2>/dev/null || true
    unset OMT_HOOK_NAME 2>/dev/null || true
}

teardown_test_env() {
    # Restore original HOME and env vars
    export HOME="$ORIGINAL_HOME"
    if [[ -n "$ORIGINAL_OMT_HOOK_LOG_ENABLED" ]]; then
        export OMT_HOOK_LOG_ENABLED="$ORIGINAL_OMT_HOOK_LOG_ENABLED"
    else
        unset OMT_HOOK_LOG_ENABLED 2>/dev/null || true
    fi
    if [[ -n "$ORIGINAL_OMT_HOOK_LOG_LEVEL" ]]; then
        export OMT_HOOK_LOG_LEVEL="$ORIGINAL_OMT_HOOK_LOG_LEVEL"
    else
        unset OMT_HOOK_LOG_LEVEL 2>/dev/null || true
    fi

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

assert_file_not_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should NOT contain pattern}"

    if ! grep -q "$pattern" "$file" 2>/dev/null; then
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
# Tests: Library exists and is sourceable
# =============================================================================

test_logging_lib_exists() {
    assert_file_exists "$LOGGING_LIB" "logging.sh library should exist" || return 1
}

test_logging_lib_is_sourceable() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB" 2>/dev/null || {
        echo "ASSERTION FAILED: logging.sh should be sourceable without errors"
        return 1
    }
}

# =============================================================================
# Tests: Environment variable toggle (OMT_HOOK_LOG_ENABLED)
# =============================================================================

test_logging_enabled_by_default() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    # Default should be enabled (1)
    unset OMT_HOOK_LOG_ENABLED
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "test message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "test message" "Logging should be enabled by default" || return 1
}

test_logging_can_be_disabled() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_ENABLED=0
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "should not appear"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_not_exists "$log_file" "Log file should not be created when disabled" || return 1
}

test_logging_respects_enabled_flag() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_ENABLED=1
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "should appear"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "should appear" "Logging should work when enabled" || return 1
}

# =============================================================================
# Tests: Log levels
# =============================================================================

test_log_level_debug_is_0() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_LEVEL=0
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_debug "debug message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "debug message" "DEBUG level should log debug messages" || return 1
}

test_log_level_info_is_1() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_LEVEL=1
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_debug "debug message"
    omt_log_info "info message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_not_contains "$log_file" "debug message" "INFO level should not log debug" || return 1
    assert_file_contains "$log_file" "info message" "INFO level should log info" || return 1
}

test_log_level_warn_is_2() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_LEVEL=2
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "info message"
    omt_log_warn "warn message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_not_contains "$log_file" "info message" "WARN level should not log info" || return 1
    assert_file_contains "$log_file" "warn message" "WARN level should log warn" || return 1
}

test_log_level_error_is_3() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    export OMT_HOOK_LOG_LEVEL=3
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_warn "warn message"
    omt_log_error "error message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_not_contains "$log_file" "warn message" "ERROR level should not log warn" || return 1
    assert_file_contains "$log_file" "error message" "ERROR level should log error" || return 1
}

test_default_log_level_is_info() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    unset OMT_HOOK_LOG_LEVEL
    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_debug "debug message"
    omt_log_info "info message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_not_contains "$log_file" "debug message" "Default level should not log debug" || return 1
    assert_file_contains "$log_file" "info message" "Default level should log info" || return 1
}

# =============================================================================
# Tests: Log rotation (1MB max, keep 3 rotated files)
# =============================================================================

test_log_rotation_occurs_at_1mb() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"

    # Create a log file just over 1MB
    dd if=/dev/zero bs=1024 count=1025 2>/dev/null | tr '\0' 'x' > "$log_file"

    # Trigger rotation by logging
    omt_log_info "trigger rotation"

    # Check that rotation occurred
    assert_file_exists "${log_file}.1" "Rotation should create .1 backup file" || return 1
}

test_log_rotation_keeps_3_files() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"

    # Create initial rotated files
    echo "backup3" > "${log_file}.3"
    echo "backup2" > "${log_file}.2"
    echo "backup1" > "${log_file}.1"

    # Create a log file just over 1MB
    dd if=/dev/zero bs=1024 count=1025 2>/dev/null | tr '\0' 'x' > "$log_file"

    # Trigger rotation
    omt_log_info "trigger rotation"

    # .4 should not exist (only keep 3)
    assert_file_not_exists "${log_file}.4" "Should only keep 3 rotated files" || return 1
    # .3 should still exist
    assert_file_exists "${log_file}.3" "Should keep .3 file" || return 1
}

# =============================================================================
# Tests: omt_log_init function
# =============================================================================

test_omt_log_init_creates_log_directory() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    rm -rf "$TEST_TMP_DIR/.claude/sisyphus/logs"
    omt_log_init "test-hook" "$TEST_TMP_DIR"

    if [[ -d "$TEST_TMP_DIR/.claude/sisyphus/logs" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: omt_log_init should create logs directory"
        return 1
    fi
}

test_omt_log_init_sets_hook_name() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "my-custom-hook" "$TEST_TMP_DIR"
    omt_log_info "test"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/my-custom-hook.log"
    assert_file_exists "$log_file" "Log file should use hook name" || return 1
}

# =============================================================================
# Tests: omt_log_start and omt_log_end functions
# =============================================================================

test_omt_log_start_logs_hook_start() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_start

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "START" "omt_log_start should log START" || return 1
}

test_omt_log_end_logs_hook_end() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_end

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "END" "omt_log_end should log END" || return 1
}

# =============================================================================
# Tests: omt_log_decision function
# =============================================================================

test_omt_log_decision_logs_decision() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_decision "continue" "No blocking conditions found"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "DECISION" "Should log DECISION tag" || return 1
    assert_file_contains "$log_file" "continue" "Should log decision value" || return 1
    assert_file_contains "$log_file" "No blocking conditions found" "Should log decision reason" || return 1
}

# =============================================================================
# Tests: omt_log_json function
# =============================================================================

test_omt_log_json_logs_json_data() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_json "input" '{"sessionId": "abc123", "cwd": "/test"}'

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "JSON" "Should log JSON tag" || return 1
    assert_file_contains "$log_file" "input" "Should log JSON label" || return 1
    assert_file_contains "$log_file" "sessionId" "Should log JSON content" || return 1
}

# =============================================================================
# Tests: Log file location
# =============================================================================

test_log_file_location_uses_project_root() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "test message"

    local expected_log="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_exists "$expected_log" "Log should be at PROJECT_ROOT/.claude/sisyphus/logs/" || return 1
}

# =============================================================================
# Tests: get_project_root function
# =============================================================================

test_get_project_root_finds_git_directory() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    local subdir="$TEST_TMP_DIR/a/b/c"
    mkdir -p "$subdir"

    local result
    result=$(omt_get_project_root "$subdir")

    assert_equals "$TEST_TMP_DIR" "$result" "Should find project root from .git marker" || return 1
}

test_get_project_root_finds_claude_md() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    local test_dir=$(mktemp -d)
    mkdir -p "$test_dir/a/b"
    touch "$test_dir/CLAUDE.md"

    local result
    result=$(omt_get_project_root "$test_dir/a/b")

    assert_equals "$test_dir" "$result" "Should find project root from CLAUDE.md" || return 1

    rm -rf "$test_dir"
}

test_get_project_root_strips_claude_sisyphus_path() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    local result
    result=$(omt_get_project_root "$TEST_TMP_DIR/.claude/sisyphus")

    assert_equals "$TEST_TMP_DIR" "$result" "Should strip .claude/sisyphus from path" || return 1
}

# =============================================================================
# Tests: Log format
# =============================================================================

test_log_format_includes_timestamp() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "test message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    # Check for ISO-ish timestamp format
    if grep -qE '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$log_file"; then
        return 0
    else
        echo "ASSERTION FAILED: Log should include timestamp"
        return 1
    fi
}

test_log_format_includes_level() {
    # shellcheck disable=SC1090
    source "$LOGGING_LIB"

    omt_log_init "test-hook" "$TEST_TMP_DIR"
    omt_log_info "test message"

    local log_file="$TEST_TMP_DIR/.claude/sisyphus/logs/test-hook.log"
    assert_file_contains "$log_file" "INFO" "Log should include level" || return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Logging Library Tests"
    echo "=========================================="

    # Library existence tests
    run_test test_logging_lib_exists
    run_test test_logging_lib_is_sourceable

    # Environment variable toggle tests
    run_test test_logging_enabled_by_default
    run_test test_logging_can_be_disabled
    run_test test_logging_respects_enabled_flag

    # Log level tests
    run_test test_log_level_debug_is_0
    run_test test_log_level_info_is_1
    run_test test_log_level_warn_is_2
    run_test test_log_level_error_is_3
    run_test test_default_log_level_is_info

    # Log rotation tests
    run_test test_log_rotation_occurs_at_1mb
    run_test test_log_rotation_keeps_3_files

    # omt_log_init tests
    run_test test_omt_log_init_creates_log_directory
    run_test test_omt_log_init_sets_hook_name

    # omt_log_start and omt_log_end tests
    run_test test_omt_log_start_logs_hook_start
    run_test test_omt_log_end_logs_hook_end

    # omt_log_decision tests
    run_test test_omt_log_decision_logs_decision

    # omt_log_json tests
    run_test test_omt_log_json_logs_json_data

    # Log file location tests
    run_test test_log_file_location_uses_project_root

    # get_project_root tests
    run_test test_get_project_root_finds_git_directory
    run_test test_get_project_root_finds_claude_md
    run_test test_get_project_root_strips_claude_sisyphus_path

    # Log format tests
    run_test test_log_format_includes_timestamp
    run_test test_log_format_includes_level

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

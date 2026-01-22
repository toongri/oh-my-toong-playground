#!/bin/bash
# =============================================================================
# Persistent Mode Hook Tests
# Tests for verification state management in persistent-mode.sh
# Phase 2: Transcript reading, promise/approval detection
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
HOOK_FILE="$ROOT_DIR/hooks/persistent-mode.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""
TEST_TMP_DIR=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude/sisyphus"
    mkdir -p "$TEST_TMP_DIR/.claude/sessions/test-session-123"
}

teardown_test_env() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
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

assert_json_field() {
    local file="$1"
    local field="$2"
    local expected="$3"
    local msg="${4:-JSON field should have expected value}"

    local actual
    actual=$(jq -r "$field" "$file" 2>/dev/null)
    if [[ "$expected" == "$actual" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Field: $field"
        echo "  Expected: '$expected'"
        echo "  Actual: '$actual'"
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
# Tests: Function Definitions - detect_completion_promise
# =============================================================================

test_hook_has_detect_completion_promise_function() {
    # persistent-mode.sh should define detect_completion_promise function
    if grep -E '^detect_completion_promise\(\)' "$HOOK_FILE" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: detect_completion_promise() should be defined"
        return 1
    fi
}

test_detect_completion_promise_reads_transcript_file() {
    # detect_completion_promise should read from transcript.md
    if grep -A 20 '^detect_completion_promise\(\)' "$HOOK_FILE" | grep -q 'transcript.md'; then
        return 0
    else
        echo "ASSERTION FAILED: detect_completion_promise should read transcript.md"
        return 1
    fi
}

test_detect_completion_promise_uses_grep_for_promise_tag() {
    # detect_completion_promise should grep for <promise>DONE</promise>
    if grep -A 20 '^detect_completion_promise\(\)' "$HOOK_FILE" | grep -qE 'grep.*promise.*DONE.*promise'; then
        return 0
    else
        echo "ASSERTION FAILED: detect_completion_promise should grep for <promise>DONE</promise>"
        return 1
    fi
}

# =============================================================================
# Tests: Function Definitions - detect_oracle_approval
# =============================================================================

test_hook_has_detect_oracle_approval_function() {
    # persistent-mode.sh should define detect_oracle_approval function
    if grep -E '^detect_oracle_approval\(\)' "$HOOK_FILE" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: detect_oracle_approval() should be defined"
        return 1
    fi
}

test_detect_oracle_approval_reads_transcript_file() {
    # detect_oracle_approval should read from transcript.md
    if grep -A 20 '^detect_oracle_approval\(\)' "$HOOK_FILE" | grep -q 'transcript.md'; then
        return 0
    else
        echo "ASSERTION FAILED: detect_oracle_approval should read transcript.md"
        return 1
    fi
}

test_detect_oracle_approval_uses_grep_for_oracle_approved_tag() {
    # detect_oracle_approval should grep for <oracle-approved>VERIFIED_COMPLETE</oracle-approved>
    if grep -A 20 '^detect_oracle_approval\(\)' "$HOOK_FILE" | grep -qE 'grep.*oracle-approved.*VERIFIED_COMPLETE'; then
        return 0
    else
        echo "ASSERTION FAILED: detect_oracle_approval should grep for <oracle-approved>VERIFIED_COMPLETE</oracle-approved>"
        return 1
    fi
}

# =============================================================================
# Tests: Function Definitions - detect_oracle_rejection
# =============================================================================

test_hook_has_detect_oracle_rejection_function() {
    # persistent-mode.sh should define detect_oracle_rejection function
    if grep -E '^detect_oracle_rejection\(\)' "$HOOK_FILE" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: detect_oracle_rejection() should be defined"
        return 1
    fi
}

test_detect_oracle_rejection_uses_rejection_patterns() {
    # detect_oracle_rejection should check for rejection indicators
    if grep -A 30 '^detect_oracle_rejection\(\)' "$HOOK_FILE" | grep -qEi 'rejected|issues found|not complete'; then
        return 0
    else
        echo "ASSERTION FAILED: detect_oracle_rejection should check rejection patterns"
        return 1
    fi
}

# =============================================================================
# Tests: Function Definitions - create_ralph_verification
# =============================================================================

test_hook_has_create_ralph_verification_function() {
    # persistent-mode.sh should define create_ralph_verification function
    if grep -E '^create_ralph_verification\(\)' "$HOOK_FILE" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: create_ralph_verification() should be defined"
        return 1
    fi
}

test_create_ralph_verification_creates_json_with_pending_true() {
    # create_ralph_verification should create JSON with pending: true
    if grep -A 30 '^create_ralph_verification\(\)' "$HOOK_FILE" | grep -q '"pending": true\|pending.*true'; then
        return 0
    else
        echo "ASSERTION FAILED: create_ralph_verification should set pending to true"
        return 1
    fi
}

test_create_ralph_verification_sets_verification_attempts_zero() {
    # create_ralph_verification should initialize verification_attempts to 0
    if grep -A 30 '^create_ralph_verification\(\)' "$HOOK_FILE" | grep -q 'verification_attempts.*0\|"verification_attempts": 0'; then
        return 0
    else
        echo "ASSERTION FAILED: create_ralph_verification should set verification_attempts to 0"
        return 1
    fi
}

test_create_ralph_verification_sets_max_attempts_three() {
    # create_ralph_verification should set max_verification_attempts to 3
    if grep -A 30 '^create_ralph_verification\(\)' "$HOOK_FILE" | grep -q 'max_verification_attempts.*3\|"max_verification_attempts": 3'; then
        return 0
    else
        echo "ASSERTION FAILED: create_ralph_verification should set max_verification_attempts to 3"
        return 1
    fi
}

# =============================================================================
# Tests: Ralph Loop Integration - Transcript Detection
# =============================================================================

test_ralph_loop_checks_promise_in_transcript() {
    # Ralph loop section should call detect_completion_promise
    if grep -A 50 '# Priority 1: Ralph Loop' "$HOOK_FILE" | grep -q 'detect_completion_promise'; then
        return 0
    else
        echo "ASSERTION FAILED: Ralph loop should call detect_completion_promise"
        return 1
    fi
}

test_ralph_loop_checks_oracle_approval_in_transcript() {
    # Ralph loop section should call detect_oracle_approval
    if grep -A 100 '# Priority 1: Ralph Loop' "$HOOK_FILE" | grep -q 'detect_oracle_approval'; then
        return 0
    else
        echo "ASSERTION FAILED: Ralph loop should call detect_oracle_approval"
        return 1
    fi
}

test_ralph_loop_creates_verification_on_promise() {
    # Ralph loop should create ralph-verification.json when promise detected
    if grep -A 100 '# Priority 1: Ralph Loop' "$HOOK_FILE" | grep -q 'create_ralph_verification\|ralph-verification.json'; then
        return 0
    else
        echo "ASSERTION FAILED: Ralph loop should create verification on promise detection"
        return 1
    fi
}

# =============================================================================
# Tests: Max Verification Attempts
# =============================================================================

test_hook_handles_max_verification_attempts() {
    # Hook should check if verification_attempts >= max_verification_attempts
    if grep -A 200 '# Priority 1: Ralph Loop' "$HOOK_FILE" | grep -qE 'ATTEMPT.*MAX|verification_attempts.*max_verification_attempts|force.*accept\|FORCE'; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should handle max verification attempts"
        return 1
    fi
}

test_hook_cleans_up_state_on_force_accept() {
    # Hook should clean up state files when force-accepting
    if grep "$HOOK_FILE" -e 'rm.*ralph-state\|rm.*ralph-verification\|cleanup.*state' >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should clean up state files on force-accept"
        return 1
    fi
}

test_hook_outputs_warning_on_force_accept() {
    # Hook should output warning message when force-accepting
    if grep -i "$HOOK_FILE" -e 'force.*complet\|FORCE_ACCEPT\|max.*attempt.*reach\|verification.*fail' >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should output warning on force-accept"
        return 1
    fi
}

# =============================================================================
# Tests: Transcript Path Resolution
# =============================================================================

test_hook_uses_session_id_for_transcript_path() {
    # Hook should use SESSION_ID to construct transcript path
    if grep "$HOOK_FILE" -e 'SESSION_ID.*transcript\|sessions.*SESSION_ID' >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should use SESSION_ID for transcript path"
        return 1
    fi
}

test_hook_has_fallback_for_messages_json() {
    # Hook should have fallback to messages.json if transcript.md missing
    if grep "$HOOK_FILE" -e 'messages.json' >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should have fallback to messages.json"
        return 1
    fi
}

# =============================================================================
# Tests: Oracle Cleanup on Approval
# =============================================================================

test_hook_cleans_up_on_oracle_approval() {
    # Hook should clean up state files when oracle approves
    if grep -A 150 '# Priority 1: Ralph Loop' "$HOOK_FILE" | grep -qE 'detect_oracle_approval.*rm\|oracle_approval.*cleanup\|VERIFIED_COMPLETE.*rm'; then
        # Complex pattern check
        return 0
    fi
    # Alternative: check if cleanup logic exists near oracle approval check
    if grep -B 5 -A 20 'detect_oracle_approval' "$HOOK_FILE" | grep -q 'rm\|cleanup\|continue.*true'; then
        return 0
    else
        echo "ASSERTION FAILED: Hook should clean up state on oracle approval"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Persistent Mode Hook Tests"
    echo "Phase 2: Verification State Management"
    echo "=========================================="

    # Function Definitions - detect_completion_promise
    run_test test_hook_has_detect_completion_promise_function
    run_test test_detect_completion_promise_reads_transcript_file
    run_test test_detect_completion_promise_uses_grep_for_promise_tag

    # Function Definitions - detect_oracle_approval
    run_test test_hook_has_detect_oracle_approval_function
    run_test test_detect_oracle_approval_reads_transcript_file
    run_test test_detect_oracle_approval_uses_grep_for_oracle_approved_tag

    # Function Definitions - detect_oracle_rejection
    run_test test_hook_has_detect_oracle_rejection_function
    run_test test_detect_oracle_rejection_uses_rejection_patterns

    # Function Definitions - create_ralph_verification
    run_test test_hook_has_create_ralph_verification_function
    run_test test_create_ralph_verification_creates_json_with_pending_true
    run_test test_create_ralph_verification_sets_verification_attempts_zero
    run_test test_create_ralph_verification_sets_max_attempts_three

    # Ralph Loop Integration - Transcript Detection
    run_test test_ralph_loop_checks_promise_in_transcript
    run_test test_ralph_loop_checks_oracle_approval_in_transcript
    run_test test_ralph_loop_creates_verification_on_promise

    # Max Verification Attempts
    run_test test_hook_handles_max_verification_attempts
    run_test test_hook_cleans_up_state_on_force_accept
    run_test test_hook_outputs_warning_on_force_accept

    # Transcript Path Resolution
    run_test test_hook_uses_session_id_for_transcript_path
    run_test test_hook_has_fallback_for_messages_json

    # Oracle Cleanup on Approval
    run_test test_hook_cleans_up_on_oracle_approval

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

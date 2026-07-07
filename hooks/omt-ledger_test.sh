#!/bin/bash
# =============================================================================
# omt-ledger.sh Tests
# Durable session-ledger append/replace helper (plan TODO 2, D4, D6).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER_SCRIPT="$SCRIPT_DIR/omt-ledger.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    export OMT_SESSION_ID="test-sid-1"
}

teardown_test_env() {
    unset OMT_DIR
    unset OMT_SESSION_ID
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
    local msg="${2:-File should NOT exist: $file}"

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

    if grep -qF "$pattern" "$file"; then
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

    if grep -qF "$pattern" "$file"; then
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
    else
        return 0
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

ledger_path() {
    echo "$OMT_DIR/session-ledger-${OMT_SESSION_ID}.md"
}

# =============================================================================
# Tests: First append lazily creates the 6-section skeleton
# =============================================================================

test_first_append_creates_six_section_skeleton() {
    printf 'first decision content' | "$LEDGER_SCRIPT" append Decisions

    local ledger
    ledger="$(ledger_path)"
    assert_file_exists "$ledger" "ledger file should be created on first append" || return 1

    for header in "## Now" "## Decisions" "## User Corrections (verbatim)" "## Pending" "## Pointers" "## Learnings"; do
        assert_file_contains "$ledger" "$header" "skeleton should contain literal header: $header" || return 1
    done

    assert_file_contains "$ledger" "first decision content" \
        "appended content should exist under the target section" || return 1
}

test_append_places_content_under_correct_section_not_others() {
    printf 'pending item A' | "$LEDGER_SCRIPT" append Pending

    local ledger
    ledger="$(ledger_path)"

    # Extract the Pending section block up to the next header line.
    local pending_block
    pending_block=$(awk '/^## Pending$/{f=1;next} /^## /{f=0} f' "$ledger")
    assert_output_contains_local "$pending_block" "pending item A" \
        "Pending section should contain the appended content" || return 1

    # Now section should remain empty (no stray content leaked across sections).
    local now_block
    now_block=$(awk '/^## Now$/{f=1;next} /^## /{f=0} f' "$ledger")
    if [[ -n "$now_block" ]]; then
        echo "ASSERTION FAILED: Now section should stay empty, got: '$now_block'"
        return 1
    fi
}

assert_output_contains_local() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should contain pattern}"

    if echo "$output" | grep -qF "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  Output: $output"
        return 1
    fi
}

# =============================================================================
# Tests: `now` replaces latest content only (D4 latest-replace)
# =============================================================================

test_now_called_twice_keeps_only_latest_content() {
    printf 'now content A' | "$LEDGER_SCRIPT" now
    printf 'now content B' | "$LEDGER_SCRIPT" now

    local ledger
    ledger="$(ledger_path)"

    assert_file_contains "$ledger" "now content B" "latest Now content should be present" || return 1
    assert_file_not_contains "$ledger" "now content A" "prior Now content should be replaced, not accumulated" || return 1
}

test_now_replace_does_not_disturb_other_sections() {
    printf 'a decision' | "$LEDGER_SCRIPT" append Decisions
    printf 'now content 1' | "$LEDGER_SCRIPT" now
    printf 'now content 2' | "$LEDGER_SCRIPT" now

    local ledger
    ledger="$(ledger_path)"
    assert_file_contains "$ledger" "a decision" "Decisions section content should survive Now replace" || return 1
}

# =============================================================================
# Test: metacharacter + multibyte + self-referential-string payload, lossless
# =============================================================================

test_metachar_multibyte_payload_stored_losslessly() {
    printf '결정: A && B | $(x) `k` session-ledger-x.md 한글' | "$LEDGER_SCRIPT" append Decisions

    local ledger
    ledger="$(ledger_path)"
    assert_file_contains "$ledger" '결정: A && B | $(x) `k` session-ledger-x.md 한글' \
        "payload with metacharacters/multibyte/self-referential string must be stored verbatim" || return 1
}

# =============================================================================
# Tests: default/empty OMT_SESSION_ID refusal
# =============================================================================

test_default_session_id_refuses_and_creates_no_file() {
    OMT_SESSION_ID="default"
    local ledger
    ledger="$(ledger_path)"

    if OMT_SESSION_ID="default" "$LEDGER_SCRIPT" append Now </dev/null; then
        echo "ASSERTION FAILED: script should exit non-zero when OMT_SESSION_ID=default"
        return 1
    fi

    assert_file_not_exists "$ledger" "ledger file must not be created when OMT_SESSION_ID=default" || return 1
}

test_empty_session_id_refuses_and_creates_no_file() {
    unset OMT_SESSION_ID
    export OMT_SESSION_ID=""

    if "$LEDGER_SCRIPT" append Now </dev/null; then
        echo "ASSERTION FAILED: script should exit non-zero when OMT_SESSION_ID is empty"
        return 1
    fi

    # There is no valid ledger path to check with an empty sid; assert the OMT_DIR
    # gained no new session-ledger-*.md file at all as the observable outcome.
    if compgen -G "$OMT_DIR/session-ledger-*.md" > /dev/null 2>&1; then
        echo "ASSERTION FAILED: no session-ledger file should be created with empty OMT_SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Test: uninvoked session -> ledger file absent
# =============================================================================

test_ledger_absent_when_never_invoked() {
    local ledger
    ledger="$(ledger_path)"
    assert_file_not_exists "$ledger" "ledger should not exist before any append/now call" || return 1
}

# =============================================================================
# Test: invalid section name rejected
# =============================================================================

test_invalid_section_name_rejected() {
    if printf 'x' | "$LEDGER_SCRIPT" append Bogus; then
        echo "ASSERTION FAILED: script should exit non-zero for an invalid section name"
        return 1
    fi

    local ledger
    ledger="$(ledger_path)"
    assert_file_not_exists "$ledger" "ledger file must not be created for an invalid section name" || return 1
}

# =============================================================================
# Test (D6): path never exposed via stdout
# =============================================================================

test_success_produces_no_stdout_path_leak() {
    local output
    output=$(printf 'content' | "$LEDGER_SCRIPT" append Pending)

    if [[ -n "$output" ]]; then
        echo "ASSERTION FAILED: successful append must not print anything to stdout (D6 path non-exposure)"
        echo "  stdout: $output"
        return 1
    fi
    return 0
}

# =============================================================================
# Static checks: bash conventions (3.2 compat, set -euo pipefail)
# =============================================================================

test_script_declares_set_euo_pipefail() {
    if grep -q '^set -euo pipefail$' "$LEDGER_SCRIPT"; then
        return 0
    else
        echo "ASSERTION FAILED: omt-ledger.sh should declare 'set -euo pipefail'"
        return 1
    fi
}

test_script_has_no_associative_arrays() {
    if grep -qE 'declare -A' "$LEDGER_SCRIPT"; then
        echo "ASSERTION FAILED: omt-ledger.sh must not use associative arrays (macOS Bash 3.2 compat)"
        return 1
    fi
    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "omt-ledger.sh Tests"
    echo "=========================================="

    run_test test_first_append_creates_six_section_skeleton
    run_test test_append_places_content_under_correct_section_not_others
    run_test test_now_called_twice_keeps_only_latest_content
    run_test test_now_replace_does_not_disturb_other_sections
    run_test test_metachar_multibyte_payload_stored_losslessly
    run_test test_default_session_id_refuses_and_creates_no_file
    run_test test_empty_session_id_refuses_and_creates_no_file
    run_test test_ledger_absent_when_never_invoked
    run_test test_invalid_section_name_rejected
    run_test test_success_produces_no_stdout_path_leak
    run_test test_script_declares_set_euo_pipefail
    run_test test_script_has_no_associative_arrays

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

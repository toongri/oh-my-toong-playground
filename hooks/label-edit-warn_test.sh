#!/bin/bash
# =============================================================================
# Label Edit Warn Hook Tests (AC-EH3a/3b/3c)
#
# Covers the PostToolUse Write|Edit|MultiEdit soft-warn hook: bare invented
# labels warn (additionalContext, exit 0), defined-in-place labels (heading
# lines) are exempt, MultiEdit's empty edits[] never errors, and a missing
# shared lib fails open (stderr warning, exit 0) instead of blocking.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "[FAIL] $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# run_hook <json> — feeds <json> on stdin to the hook, prints its stdout.
run_hook() {
    local json="$1"
    printf '%s' "$json" | bash "$SCRIPT_DIR/label-edit-warn.sh"
}

assert_contains() {
    local haystack="$1" needle="$2" msg="${3:-}"
    if echo "$haystack" | grep -qF "$needle"; then
        return 0
    else
        echo "  ASSERTION FAILED: $msg"
        echo "  Expected to contain: $needle"
        echo "  Actual: $haystack"
        return 1
    fi
}

assert_not_contains() {
    local haystack="$1" needle="$2" msg="${3:-}"
    if echo "$haystack" | grep -qF "$needle"; then
        echo "  ASSERTION FAILED: $msg"
        echo "  Expected NOT to contain: $needle"
        echo "  Actual: $haystack"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# AC-EH3a — Write: bare label warns, defined-in-place label does not
# =============================================================================

test_ac3a_write_bare_label_warns() {
    local output exit_code
    output=$(run_hook '{"tool_name":"Write","tool_input":{"content":"see D-1"}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_contains "$output" "additionalContext" "bare label Write should warn" || return 1
    assert_contains "$output" "hookSpecificOutput" "warning must use hookSpecificOutput shape" || return 1
}

test_ac3a_write_defined_in_place_no_warn() {
    local output exit_code
    output=$(run_hook '{"tool_name":"Write","tool_input":{"content":"### D-1: Add flag"}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_not_contains "$output" "hookSpecificOutput" "heading-defined label must be exempt (no warn)" || return 1
}

test_ac3a_write_mixed_heading_plus_bare_still_warns() {
    # A heading defines D-1 in place, but a separate bare reference to it
    # remains — the bare occurrence must still trigger a warning.
    local output exit_code
    output=$(run_hook '{"tool_name":"Write","tool_input":{"content":"### D-1: Add flag\nsee D-1 above"}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_contains "$output" "hookSpecificOutput" "bare occurrence alongside a heading must still warn" || return 1
}

# =============================================================================
# AC-EH3b — Edit: bare label warns
# =============================================================================

test_ac3b_edit_bare_label_warns() {
    local output exit_code
    output=$(run_hook '{"tool_name":"Edit","tool_input":{"new_string":"see D-1"}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_contains "$output" "additionalContext" "bare label Edit should warn" || return 1
}

test_ac3b_edit_no_label_no_warn() {
    local output exit_code
    output=$(run_hook '{"tool_name":"Edit","tool_input":{"new_string":"just a normal sentence"}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_not_contains "$output" "hookSpecificOutput" "plain prose must not warn" || return 1
}

# =============================================================================
# AC-EH3c — MultiEdit: bare label warns; empty edits[] never errors
# =============================================================================

test_ac3c_multiedit_bare_label_warns() {
    local output exit_code
    output=$(run_hook '{"tool_name":"MultiEdit","tool_input":{"edits":[{"new_string":"see D-1"}]}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_contains "$output" "additionalContext" "bare label MultiEdit should warn" || return 1
}

test_ac3c_multiedit_empty_edits_no_error() {
    local output exit_code
    output=$(run_hook '{"tool_name":"MultiEdit","tool_input":{"edits":[]}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0 (no jq error), got $exit_code"; return 1; }
    assert_not_contains "$output" "hookSpecificOutput" "empty edits[] must not warn" || return 1
}

test_ac3c_multiedit_absent_edits_no_error() {
    # .tool_input.edits entirely absent (not just an empty array)
    local output exit_code
    output=$(run_hook '{"tool_name":"MultiEdit","tool_input":{}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0 (no jq error), got $exit_code"; return 1; }
    assert_not_contains "$output" "hookSpecificOutput" "absent edits[] must not warn" || return 1
}

# =============================================================================
# Never-block guarantee: unrelated tool names pass through cleanly
# =============================================================================

test_unrelated_tool_no_warn() {
    local output exit_code
    output=$(run_hook '{"tool_name":"Read","tool_input":{}}')
    exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0, got $exit_code"; return 1; }
    assert_not_contains "$output" "hookSpecificOutput" "unrelated tool must not warn" || return 1
}

# =============================================================================
# Fail-open source guard: missing shared lib must warn to stderr, exit 0
# =============================================================================

test_missing_lib_fails_open() {
    local tmp_dir stderr_file output exit_code
    tmp_dir=$(mktemp -d)
    stderr_file=$(mktemp)
    # Copy only the hook — no lib/ sibling directory — so the source guard
    # must trip and fail open instead of erroring out on a missing source.
    cp "$SCRIPT_DIR/label-edit-warn.sh" "$tmp_dir/label-edit-warn.sh"

    output=$(printf '%s' '{"tool_name":"Write","tool_input":{"content":"see D-1"}}' \
        | bash "$tmp_dir/label-edit-warn.sh" 2>"$stderr_file")
    exit_code=$?

    local stderr_content
    stderr_content=$(cat "$stderr_file")
    rm -rf "$tmp_dir"
    rm -f "$stderr_file"

    [ "$exit_code" -eq 0 ] || { echo "  expected exit 0 on missing lib, got $exit_code"; return 1; }
    assert_contains "$stderr_content" "WARNING" "missing lib must warn to stderr" || return 1
    assert_not_contains "$output" "hookSpecificOutput" "missing lib must not still warn via additionalContext" || return 1
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "label-edit-warn.sh Hook Tests"
    echo "=========================================="

    run_test test_ac3a_write_bare_label_warns
    run_test test_ac3a_write_defined_in_place_no_warn
    run_test test_ac3a_write_mixed_heading_plus_bare_still_warns

    run_test test_ac3b_edit_bare_label_warns
    run_test test_ac3b_edit_no_label_no_warn

    run_test test_ac3c_multiedit_bare_label_warns
    run_test test_ac3c_multiedit_empty_edits_no_error
    run_test test_ac3c_multiedit_absent_edits_no_error

    run_test test_unrelated_tool_no_warn
    run_test test_missing_lib_fails_open

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

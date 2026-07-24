#!/bin/bash
# =============================================================================
# Codex Label Edit Warn Hook Tests (Claude<->Codex hook-parity plan)
#
# Covers hooks/codex-label-edit-warn.sh: the Codex PostToolUse shim over the
# shared judgment core (hooks/label-edit-warn-core.sh) that hooks/label-
# edit-warn.sh (Claude) also uses. Asserts:
#   - the shared core is actually referenced (zero duplicated judgment logic)
#   - write/edit/multiedit/multi_edit/apply_patch each route to a warn
#   - a defined-in-place heading is exempt (no warn)
#   - an unrelated tool name never warns
#   - this hook never blocks (always exit 0)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-label-edit-warn.sh"

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

test_shim_sources_shared_core() {
    grep -qF 'source "$SCRIPT_DIR/label-edit-warn-core.sh"' "$HOOK" \
        || { echo "ASSERTION FAILED: must source label-edit-warn-core.sh"; return 1; }
    return 0
}

test_write_bare_label_warns() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"write",tool_input:{content:"see D-1"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | grep -qF "hookSpecificOutput" || { echo "ASSERTION FAILED: expected a warn. Got: $output"; return 1; }
    return 0
}

test_write_defined_in_place_no_warn() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"write",tool_input:{content:"### D-1: Add flag"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: heading-defined label must be exempt. Got: $output"; return 1; }
    return 0
}

test_edit_bare_label_warns() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"edit",tool_input:{new_string:"see D-1"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | grep -qF "additionalContext" || { echo "ASSERTION FAILED: expected a warn. Got: $output"; return 1; }
    return 0
}

test_multiedit_bare_label_warns() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"multiedit",tool_input:{edits:[{new_string:"see D-1"}]}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | grep -qF "additionalContext" || { echo "ASSERTION FAILED: expected a warn. Got: $output"; return 1; }
    return 0
}

test_multi_edit_underscore_variant_routes() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"multi_edit",tool_input:{edits:[{new_string:"see D-1"}]}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | grep -qF "additionalContext" || { echo "ASSERTION FAILED: multi_edit variant should also warn. Got: $output"; return 1; }
    return 0
}

test_apply_patch_bare_label_warns() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"apply_patch",tool_input:{command:"*** Update File: foo.md\n+see D-1\n"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | grep -qF "additionalContext" || { echo "ASSERTION FAILED: apply_patch payload should warn. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Regression -- apply_patch must extract ADDED (+) content only, mirroring
# the write/edit/multiedit routes above (Claude parity: hooks/label-edit-
# warn.sh only ever sees content/new_string, never the surrounding patch
# envelope or removed lines). Before the fix, the raw patch text (envelope
# + hunks, unfiltered) was scanned, so a `+### D-1: Add flag` defining
# heading never matched the core's heading-exemption regex (which expects
# a bare `### D-1: ...` line, not one prefixed with a diff `+`) and warned
# where the identical Write content would not.
# =============================================================================
test_apply_patch_added_defining_heading_no_warn() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"apply_patch",tool_input:{command:"*** Update File: foo.md\n+### D-1: Add flag\n"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: an ADDED defining heading must be exempt, same as Write. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Regression -- a patch that only REMOVES a line carrying a label must not
# warn (this edit does not ADD a bare label; it deletes one). Before the
# fix, the removed (`-`) line was scanned as part of the unfiltered patch
# text and warned.
# =============================================================================
test_apply_patch_removal_only_no_warn() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"apply_patch",tool_input:{command:"*** Update File: foo.md\n-see D-1 for details\n"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: a removal-only patch must not warn. Got: $output"; return 1; }
    return 0
}

test_unrelated_tool_never_warns() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"read",tool_input:{}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: unrelated tool must not warn. Got: $output"; return 1; }
    return 0
}

main() {
    echo "=========================================="
    echo "Codex Label Edit Warn Tests"
    echo "=========================================="

    run_test test_shim_sources_shared_core
    run_test test_write_bare_label_warns
    run_test test_write_defined_in_place_no_warn
    run_test test_edit_bare_label_warns
    run_test test_multiedit_bare_label_warns
    run_test test_multi_edit_underscore_variant_routes
    run_test test_apply_patch_bare_label_warns
    run_test test_apply_patch_added_defining_heading_no_warn
    run_test test_apply_patch_removal_only_no_warn
    run_test test_unrelated_tool_never_warns

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

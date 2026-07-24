#!/bin/bash
# =============================================================================
# label-edit-warn-core.sh tests
# Covers label_edit_warn_core_check <content> directly (bypassing both
# platform shims) -- the full-tier label check (label_match_full) plus the
# defined-in-place heading exemption. Colocated sibling to
# hooks/keyword-detector-core_test.sh (no filesystem interaction needed here,
# same as that core -- unlike hooks/write-guard-core_test.sh, which needs
# mktemp -d isolation because its core resolves real OMT_DIR paths on disk).
# Both platform shims (hooks/label-edit-warn.sh, hooks/codex-label-edit-
# warn.sh) already have their own _test.sh, but the core itself did not.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/label-patterns.sh
source "$SCRIPT_DIR/lib/label-patterns.sh"
# shellcheck source=./label-edit-warn-core.sh
source "$SCRIPT_DIR/label-edit-warn-core.sh"

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

# =============================================================================
# Bare label -> warn: prints the shared warning text verbatim, returns 0.
# =============================================================================
test_bare_label_warns() {
    local out rc=0
    out=$(label_edit_warn_core_check "see D-1") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "$_LABEL_EDIT_WARN_CORE_TEXT" ]]; then
        return 0
    else
        echo "ASSERTION FAILED bare-label-warns: expected rc=0 out='\$_LABEL_EDIT_WARN_CORE_TEXT', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Defined-in-place heading -> exempt: a label that itself defines a markdown
# heading (e.g. "### D-1: Add flag") must not warn.
# =============================================================================
test_defined_in_place_heading_exempt() {
    local out rc=0
    out=$(label_edit_warn_core_check '### D-1: Add flag') || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED defined-in-place-exempt: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Mixed heading + separate bare reference -> still warns. The heading
# exempts only its own defining line; a bare occurrence elsewhere in the
# same content remains subject to the check.
# =============================================================================
test_mixed_heading_plus_bare_still_warns() {
    local content out rc=0
    content=$'### D-1: Add flag\nsee D-1 above'
    out=$(label_edit_warn_core_check "$content") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "$_LABEL_EDIT_WARN_CORE_TEXT" ]]; then
        return 0
    else
        echo "ASSERTION FAILED mixed-heading-plus-bare: expected rc=0 out='\$_LABEL_EDIT_WARN_CORE_TEXT', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# FULL-tier-only pattern ("Phase 2") -> warns. Unlike label-commit-gate-
# core.sh (label_match_hard only), this core uses label_match_full -- the
# broader FULL tier is exactly the reason the two cores are NOT merged.
# =============================================================================
test_full_tier_only_pattern_warns() {
    local out rc=0
    out=$(label_edit_warn_core_check "Phase 2 rollout notes") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "$_LABEL_EDIT_WARN_CORE_TEXT" ]]; then
        return 0
    else
        echo "ASSERTION FAILED full-tier-only-pattern: expected rc=0 out='\$_LABEL_EDIT_WARN_CORE_TEXT', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Plain prose, no label -> allow (no warn).
# =============================================================================
test_plain_prose_no_warn() {
    local out rc=0
    out=$(label_edit_warn_core_check "just a normal sentence") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED plain-prose-no-warn: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Empty content -> allow (no warn), no error.
# =============================================================================
test_empty_content_no_warn() {
    local out rc=0
    out=$(label_edit_warn_core_check "") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED empty-content-no-warn: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "label-edit-warn-core Tests"
    echo "=========================================="

    run_test test_bare_label_warns
    run_test test_defined_in_place_heading_exempt
    run_test test_mixed_heading_plus_bare_still_warns
    run_test test_full_tier_only_pattern_warns
    run_test test_plain_prose_no_warn
    run_test test_empty_content_no_warn

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

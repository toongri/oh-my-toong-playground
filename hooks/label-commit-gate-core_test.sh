#!/bin/bash
# =============================================================================
# label-commit-gate-core.sh tests
# Covers label_commit_gate_core_check <cmd_text> directly (bypassing both
# platform shims) -- the git-commit-shape detector, subject scoping and
# extraction across the documented -m/-am/--message/-F/--file forms, and the
# label_match_hard check. Colocated sibling to hooks/write-guard-core_test.sh,
# hooks/keyword-detector-core_test.sh -- both platform shims
# (hooks/label-commit-gate.sh, hooks/codex-label-commit-gate.sh) already have
# their own _test.sh, but the core itself did not until now: a shim-only test
# suite exercises the core only through each shim's own fixed set of sample
# commands, and never proved the core's subject-scoping was correct against
# an unrelated -m sitting earlier in the same shell command line -- which is
# exactly the regression this suite's first arm pins.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/label-patterns.sh
source "$SCRIPT_DIR/lib/label-patterns.sh"
# shellcheck source=./label-commit-gate-core.sh
source "$SCRIPT_DIR/label-commit-gate-core.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# mktemp -d + cleanup trap (OMT shell-test convention)
# -----------------------------------------------------------------------------
TEST_TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

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
# Regression (scoping fix) -- an unrelated -m sitting BEFORE the real
# `git commit` on the same command line must not be mistaken for the
# subject. label_commit_gate_core_check must scope its -m/-F search to the
# segment AFTER the matched `git ... commit` invocation, not the whole raw
# command string. Before the fix, the first (unrelated) -m short-circuited
# the search and the real, later -m carrying the hard-tier label went
# unscanned -> false ALLOW.
# =============================================================================
test_regression_unrelated_earlier_dash_m_still_denies() {
    local cmd out rc=0
    cmd="printf '%s' -m clean; git commit -m \"fix D-1\""
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "D-1" ]]; then
        return 0
    else
        echo "ASSERTION FAILED regression-unrelated-earlier-dash-m: expected rc=0 out='D-1', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Intended reduction (must NOT change) -- git's own convention treats the
# FIRST -m as the SUBJECT and any repeated -m as BODY paragraphs; the core
# deliberately never scans body. A label living only in a second -m must
# keep allowing. Pinned here as a fixed arm so a future over-broadening of
# the scoping fix (e.g. looping over every -m instead of stopping at the
# first) cannot silently regress this documented behavior.
# =============================================================================
test_intended_reduction_label_only_in_second_dash_m_allows() {
    local cmd out rc=0
    cmd="git commit -m 'clean' -m 'D-1 apply'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED intended-reduction-second-dash-m: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Positive control -- an ordinary `git commit -m '<label>'` with nothing
# preceding it on the line must still deny. Without this, the scoping fix
# above could regress into never matching anything.
# =============================================================================
test_plain_hard_label_denies() {
    local cmd out rc=0
    cmd="git commit -m 'fix D-36'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "D-36" ]]; then
        return 0
    else
        echo "ASSERTION FAILED plain-hard-label: expected rc=0 out='D-36', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Negative control -- a clean subject with no invented label must allow.
# =============================================================================
test_clean_subject_allows() {
    local cmd out rc=0
    cmd="git commit -m 'add enrich flag'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED clean-subject: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Non-commit command -> allow, unconditionally (fast path).
# =============================================================================
test_non_commit_command_allows() {
    local cmd out rc=0
    cmd="ls -la"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED non-commit-command: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Regression (empty-first-subject fix) -- `git commit -m '' -m '<label>'`.
# git's own cleanup=strip mode drops the empty first message paragraph and
# promotes the second -m to the SUBJECT (verified with a real
# `git commit --allow-empty -m '' -m 'fix D-36'` -> subject `fix D-36`).
# Before the fix, the core confirmed the first -m as the subject even though
# its raw captured text was the quoted-empty token `''` (never actually
# `-z`, since the quote characters themselves are non-empty), so it fell
# through the `[[ -z "$title" ]]` allow-path and let a subject git itself
# resolves to `fix D-36` pass unchecked -> false ALLOW.
# =============================================================================
test_empty_first_dash_m_promotes_second_to_subject_denies() {
    local cmd out rc=0
    cmd="git commit -m '' -m 'fix D-36'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "D-36" ]]; then
        return 0
    else
        echo "ASSERTION FAILED empty-first-dash-m-promotes-second: expected rc=0 out='D-36', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Negative control for the fix above (must NOT change) -- when the FIRST -m
# is itself non-empty (e.g. 'clean'), it stays the subject and a label
# living only in a later -m must keep allowing. This is the SAME documented
# design exception as test_intended_reduction_label_only_in_second_dash_m_
# allows above, pinned again with an explicit non-empty first value so a
# future broadening of the empty-skip fix (e.g. skipping ANY -m whose value
# doesn't itself carry a label, not just an empty one) cannot silently
# regress this "subject-only, never body" policy.
# =============================================================================
test_nonempty_first_dash_m_label_only_in_second_still_allows() {
    local cmd out rc=0
    cmd="git commit -m 'clean' -m 'fix D-1'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 1 && -z "$out" ]]; then
        return 0
    else
        echo "ASSERTION FAILED nonempty-first-dash-m-second-allows: expected rc=1 out='', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# -F/--file scoping (same root cause as the -m regression) -- a -F file path
# sitting BEFORE the real `git commit` on the line must not be picked up in
# place of the file path that follows the real commit invocation.
# =============================================================================
test_dash_capital_f_scoped_to_segment_after_commit() {
    local decoy_file real_file cmd out rc=0
    decoy_file="$TEST_TMP_DIR/decoy.txt"
    real_file="$TEST_TMP_DIR/real.txt"
    printf 'clean decoy subject\n' > "$decoy_file"
    printf 'fix D-1\n' > "$real_file"

    cmd="cat -F $decoy_file > /dev/null; git commit -F $real_file"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "D-1" ]]; then
        return 0
    else
        echo "ASSERTION FAILED dash-capital-f-scoped: expected rc=0 out='D-1', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Regression (attached short option) -- shell quote concatenation makes
# `git commit -m'fix D-1'` a SINGLE word, and git reads it exactly like the
# separated `-m 'fix D-1'` form. A separator group that demanded at least
# one space or `=` never matched these, so the subject was never extracted
# and the hard gate allowed a labelled commit -- for both the -m and -am
# flags, and for either quote style. Measured against the pre-change gate,
# which blocked all four, so this was a live regression, not a pre-existing
# gap.
# =============================================================================
test_regression_attached_quoted_short_option_denies() {
    local form cmd out rc
    for form in "-m'fix D-1'" "-am'fix D-1'" '-m"fix D-1"' '-am"fix D-1"'; do
        rc=0
        cmd="git commit $form"
        out=$(label_commit_gate_core_check "$cmd") || rc=$?
        if [[ "$rc" -ne 0 || "$out" != "D-1" ]]; then
            echo "ASSERTION FAILED attached-quoted-short-option ($form): expected rc=0 out='D-1', got rc=$rc out='$out'"
            return 1
        fi
    done
    return 0
}

# Negative control for the arm above -- without it, "deny on the attached
# form" would be satisfiable by a matcher that denies every attached form
# regardless of content. A clean subject in the same attached shape must
# still pass.
test_attached_quoted_short_option_clean_subject_allows() {
    local form cmd out rc
    for form in "-m'fix retry timeout'" '-am"fix retry timeout"'; do
        rc=0
        cmd="git commit $form"
        out=$(label_commit_gate_core_check "$cmd") || rc=$?
        if [[ "$rc" -eq 0 ]]; then
            echo "ASSERTION FAILED attached-clean-subject ($form): expected allow, got rc=$rc out='$out'"
            return 1
        fi
    done
    return 0
}

# The property the separator requirement was protecting, pinned so the
# attached branch cannot quietly undo it: the attached alternative accepts
# QUOTED values only, so a bare token can never attach to the flag. If it
# could, the tail text of an unrelated long flag would be swallowed as a
# bogus subject and the search would stop before reaching the real -m
# further down the command line.
test_amend_does_not_shadow_the_real_dash_m_denies() {
    local cmd out rc=0
    cmd="git commit --amend --no-edit -m 'fix D-1'"
    out=$(label_commit_gate_core_check "$cmd") || rc=$?
    if [[ "$rc" -eq 0 && "$out" == "D-1" ]]; then
        return 0
    else
        echo "ASSERTION FAILED amend-does-not-shadow: expected rc=0 out='D-1', got rc=$rc out='$out'"
        return 1
    fi
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "label-commit-gate-core Tests"
    echo "=========================================="

    run_test test_regression_unrelated_earlier_dash_m_still_denies
    run_test test_intended_reduction_label_only_in_second_dash_m_allows
    run_test test_plain_hard_label_denies
    run_test test_clean_subject_allows
    run_test test_non_commit_command_allows
    run_test test_empty_first_dash_m_promotes_second_to_subject_denies
    run_test test_nonempty_first_dash_m_label_only_in_second_still_allows
    run_test test_dash_capital_f_scoped_to_segment_after_commit
    run_test test_regression_attached_quoted_short_option_denies
    run_test test_attached_quoted_short_option_clean_subject_allows
    run_test test_amend_does_not_shadow_the_real_dash_m_denies

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

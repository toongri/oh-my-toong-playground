#!/bin/bash
# =============================================================================
# keyword-detector-core.sh golden byte tests
#
# Guards the property keyword-detector-core.sh's header comment claims:
# each kd_core_message_<mode> is a byte-exact substring copy of the original
# hand-escaped literal (pre-extraction hooks/keyword-detector.sh), surviving
# heredoc extraction + printf '%s' re-insertion + $(...) trailing-newline
# handling untouched. A future heredoc edit that introduces an unescaped `"`
# or a real (non-literal) newline would silently ship broken JSON on both
# platforms (hooks/keyword-detector.sh and hooks/codex-keyword-detector.sh) --
# this diffs raw function output against checked-in golden fixtures
# (hooks/fixtures/keyword-detector-core/*.txt) so that drift is caught here
# instead of downstream.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures/keyword-detector-core"

# shellcheck source=./keyword-detector-core.sh
source "$SCRIPT_DIR/keyword-detector-core.sh"

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

assert_golden_match() {
    local mode="$1"
    local fn="kd_core_message_${mode}"
    local fixture="$FIXTURES_DIR/${mode}.txt"
    local actual
    actual=$("$fn")

    local expected
    expected=$(cat "$fixture")

    if [[ "$actual" == "$expected" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $fn output does not byte-match $fixture"
        diff <(printf '%s' "$expected") <(printf '%s' "$actual") || true
        return 1
    fi
}

test_ultrawork_message_is_byte_exact() {
    assert_golden_match "ultrawork"
}

test_think_message_is_byte_exact() {
    assert_golden_match "think"
}

test_search_message_is_byte_exact() {
    assert_golden_match "search"
}

test_analyze_message_is_byte_exact() {
    assert_golden_match "analyze"
}

main() {
    echo "=========================================="
    echo "keyword-detector-core Golden Byte Tests"
    echo "=========================================="

    run_test test_ultrawork_message_is_byte_exact
    run_test test_think_message_is_byte_exact
    run_test test_search_message_is_byte_exact
    run_test test_analyze_message_is_byte_exact

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
